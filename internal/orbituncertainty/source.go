// Package orbituncertainty preserves and audits SBDB solution-epoch covariance
// input. It does not infer force-model validity or propagate an orbit.
package orbituncertainty

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const MaxSourceBytes = 2 << 20

var decimalSourceNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

type Source struct {
	Designation             string      `json:"designation"`
	SPKID                   string      `json:"spkId"`
	SolutionID              string      `json:"solutionId"`
	SolutionDateLocal       *string     `json:"solutionDateLocal"`
	SolutionEpochTDB        float64     `json:"solutionEpochTdb"`
	StandardElementEpochTDB float64     `json:"standardElementEpochTdb"`
	Frame                   string      `json:"frame"`
	Labels                  []string    `json:"labels"`
	Units                   []*string   `json:"units"`
	Nominal                 []float64   `json:"nominal"`
	Matrix                  [][]float64 `json:"matrix"`
	MarginalSigmas          []float64   `json:"marginalSigmas"`
	Correlation             [][]float64 `json:"correlation"`
	CorrelationEigenvalues  []float64   `json:"correlationEigenvalues"`
	PositiveDefinite        bool        `json:"positiveDefinite"`
	AdditionalParameters    []string    `json:"additionalParameters"`
	PlanetaryEphemeris      *string     `json:"planetaryEphemeris"`
	SmallBodyEphemeris      *string     `json:"smallBodyEphemeris"`
}

type Inspection struct {
	Model                string `json:"model"`
	OriginalSBDBBase64   []byte `json:"originalSbdbBase64"`
	SourceSHA256         string `json:"sourceSha256"`
	SourceBytes          int    `json:"sourceBytes"`
	Source               Source `json:"source"`
	ProvenanceLimitation string `json:"provenanceLimitation"`
}

func record(value any, name string) (map[string]any, error) {
	v, ok := value.(map[string]any)
	if !ok || v == nil {
		return nil, fmt.Errorf("missing %s object", name)
	}
	return v, nil
}

func optionalText(value any) *string {
	v, ok := value.(string)
	if !ok || strings.TrimSpace(v) == "" {
		return nil
	}
	v = strings.TrimSpace(v)
	return &v
}

func requiredText(value any, name string) (string, error) {
	v := optionalText(value)
	if v == nil {
		return "", fmt.Errorf("missing %s", name)
	}
	return *v, nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func number(value any, name string) (float64, error) {
	var raw string
	switch v := value.(type) {
	case json.Number:
		raw = string(v)
	case string:
		raw = strings.TrimSpace(v)
	default:
		return 0, fmt.Errorf("nonfinite or missing %s", name)
	}
	if !decimalSourceNumber.MatchString(raw) {
		return 0, fmt.Errorf("invalid decimal numeric text for %s", name)
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || !finite(v) {
		return 0, fmt.Errorf("nonfinite or missing %s", name)
	}
	return v, nil
}

func namedEntries(value any, name string) (map[string]map[string]any, error) {
	rows, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("missing or invalid %s array", name)
	}
	if len(rows) > 64 {
		return nil, fmt.Errorf("%s array exceeds supported list size 64", name)
	}
	entries := make(map[string]map[string]any, len(rows))
	for _, raw := range rows {
		entry, err := record(raw, name)
		if err != nil {
			return nil, err
		}
		key, err := requiredText(entry["name"], name+" name")
		if err != nil {
			return nil, err
		}
		if _, exists := entries[key]; exists {
			return nil, fmt.Errorf("duplicate %s %s", name, key)
		}
		entries[key] = entry
	}
	return entries, nil
}

func validateCovarianceModelParameterAxes(labels []string, models map[string]map[string]any) error {
	estimated := make(map[string]bool)
	indices := make(map[int]string)
	for name, entry := range models {
		kind, ok := entry["kind"].(string)
		kind = strings.TrimSpace(kind)
		if !ok || (kind != "SET" && kind != "EST" && kind != "CON") {
			return fmt.Errorf("unsupported kind for model parameter %s", name)
		}
		if kind == "EST" {
			estimated[name] = true
		}
		if entry["n"] == nil {
			continue
		}
		rawIndex, err := number(entry["n"], "index for model parameter "+name)
		if err != nil || math.Trunc(rawIndex) != rawIndex || rawIndex < 0 || rawIndex > 64 ||
			(kind == "SET" && rawIndex != 0) || (kind != "SET" && rawIndex == 0) {
			return fmt.Errorf("invalid index for model parameter %s", name)
		}
		if kind != "SET" {
			index := int(rawIndex)
			if previous, exists := indices[index]; exists {
				return fmt.Errorf("duplicate model parameter index %d: %s and %s", index, previous, name)
			}
			indices[index] = name
		}
	}
	if len(labels) < 6 {
		return errors.New("covariance must begin with six orbital axes")
	}
	modelLabels := labels[6:]
	seenEstimated := make(map[string]bool, len(modelLabels))
	for _, label := range modelLabels {
		if !estimated[label] {
			return fmt.Errorf("covariance parameter %s is not estimated", label)
		}
		seenEstimated[label] = true
	}
	if len(seenEstimated) != len(estimated) {
		return errors.New("covariance labels omit an estimated model parameter")
	}
	previousIndex := 0
	for _, label := range modelLabels {
		rawIndex := models[label]["n"]
		if rawIndex == nil {
			continue
		}
		value, _ := number(rawIndex, "model parameter index") // validated above
		index := int(value)
		if index <= previousIndex {
			return errors.New("covariance model parameter labels disagree with SBDB model index order")
		}
		previousIndex = index
	}
	return nil
}

// Inspect owns the original bytes and retains every matrix axis, including
// estimated model parameters. Considered parameters remain in the owned source
// bytes but are not covariance axes under the SBDB contract. A digest binds the receipt to bytes, not to JPL's
// identity or the caller's claim that full-prec=1 was requested.
func Inspect(ctx context.Context, original []byte) (*Inspection, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(original) == 0 || len(original) > MaxSourceBytes || !utf8.Valid(original) {
		return nil, errors.New("expected nonempty UTF-8 SBDB JSON of at most 2 MiB")
	}
	owned := bytes.Clone(original)
	decoder := json.NewDecoder(bytes.NewReader(owned))
	decoder.UseNumber()
	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return nil, errors.New("invalid SBDB JSON")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, errors.New("expected exactly one SBDB JSON object")
	}
	source, err := parse(ctx, payload)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(owned)
	return &Inspection{
		Model: "sbdb-solution-covariance-inspection-v1", OriginalSBDBBase64: owned,
		SourceSHA256: hex.EncodeToString(digest[:]), SourceBytes: len(owned), Source: *source,
		ProvenanceLimitation: "Caller-supplied bytes; SHA-256 does not authenticate JPL origin, query precision, or force-model validity. No orbit propagation performed.",
	}, nil
}

func parse(ctx context.Context, payload any) (*Source, error) {
	root, err := record(payload, "SBDB response")
	if err != nil {
		return nil, err
	}
	signature, err := record(root["signature"], "signature")
	if err != nil {
		return nil, err
	}
	if signature["version"] != "1.3" || signature["source"] != "NASA/JPL Small-Body Database (SBDB) API" {
		return nil, errors.New("unsupported SBDB signature; expected NASA/JPL API version 1.3")
	}
	body, err := record(root["object"], "object")
	if err != nil {
		return nil, err
	}
	orbit, err := record(root["orbit"], "orbit")
	if err != nil {
		return nil, err
	}
	cov, err := record(orbit["covariance"], "orbit.covariance")
	if err != nil {
		return nil, err
	}
	if orbit["equinox"] != "J2000" {
		return nil, errors.New("unsupported covariance reference equinox")
	}
	source := &Source{Frame: "heliocentric-IAU76/80-ecliptic-J2000"}
	source.Designation, err = requiredText(body["des"], "designation")
	if err != nil {
		return nil, err
	}
	source.SPKID, err = requiredText(body["spkid"], "SPK identifier")
	if err != nil {
		return nil, err
	}
	source.SolutionID, err = requiredText(orbit["orbit_id"], "orbit solution identifier")
	if err != nil {
		return nil, err
	}
	if id, exists := body["orbit_id"]; exists && id != source.SolutionID {
		return nil, errors.New("conflicting orbit solution identifiers")
	}
	source.SolutionEpochTDB, err = number(cov["epoch"], "covariance epoch")
	if err != nil {
		return nil, err
	}
	source.StandardElementEpochTDB, err = number(orbit["epoch"], "element epoch")
	if err != nil {
		return nil, err
	}
	if orbit["cov_epoch"] != nil {
		epoch, err := number(orbit["cov_epoch"], "declared covariance epoch")
		if err != nil {
			return nil, err
		}
		if epoch != source.SolutionEpochTDB {
			return nil, errors.New("conflicting covariance epochs")
		}
	}
	rawElements := cov["elements"]
	if rawElements == nil && source.StandardElementEpochTDB == source.SolutionEpochTDB {
		rawElements = orbit["elements"]
	}
	elements, err := namedEntries(rawElements, "solution-epoch element")
	if err != nil {
		return nil, err
	}
	models := make(map[string]map[string]any)
	if orbit["model_pars"] != nil {
		models, err = namedEntries(orbit["model_pars"], "model parameter")
		if err != nil {
			return nil, err
		}
	}
	rawLabels, ok := cov["labels"].([]any)
	if !ok || len(rawLabels) < 6 || len(rawLabels) > 16 {
		return nil, errors.New("supported covariance dimension is 6 to 16")
	}
	definitions := map[string]struct{ name, unit string }{
		"e": {"e", ""}, "q": {"q", "au"}, "tp": {"tp", "TDB"},
		"node": {"om", "deg"}, "peri": {"w", "deg"}, "i": {"i", "deg"},
	}
	seen := make(map[string]bool)
	for index, raw := range rawLabels {
		label, err := requiredText(raw, "covariance label")
		if err != nil {
			return nil, err
		}
		if seen[label] {
			return nil, errors.New("duplicate covariance label")
		}
		seen[label] = true
		var entry map[string]any
		var unit *string
		if index < 6 {
			def, exists := definitions[label]
			if !exists {
				return nil, errors.New("first six covariance axes must be orbital elements")
			}
			entry = elements[def.name]
			if entry == nil {
				return nil, fmt.Errorf("missing nominal element %s", label)
			}
			if (def.unit == "" && entry["units"] != nil) || (def.unit != "" && entry["units"] != def.unit) {
				return nil, fmt.Errorf("unexpected units for %s", label)
			}
			if def.unit != "" {
				value := def.unit
				if label == "tp" {
					value = "d"
				}
				unit = &value
			}
		} else {
			entry = models[label]
			if entry == nil || entry["kind"] != "EST" {
				return nil, fmt.Errorf("missing estimated model parameter %s", label)
			}
			// Preserve absent units, but never coerce malformed units to dimensionless.
			if entry["units"] != nil {
				value, err := requiredText(entry["units"], "units for covariance parameter "+label)
				if err != nil {
					return nil, err
				}
				unit = &value
			}
		}
		value, err := number(entry["value"], "nominal "+label)
		if err != nil {
			return nil, err
		}
		if (label == "e" && value < 0) || (label == "q" && value <= 0) || (label == "i" && (value < 0 || value > 180)) {
			return nil, errors.New("invalid conic elements")
		}
		source.Labels = append(source.Labels, label)
		source.Units = append(source.Units, unit)
		source.Nominal = append(source.Nominal, value)
	}
	if err := validateCovarianceModelParameterAxes(source.Labels, models); err != nil {
		return nil, err
	}
	n := len(rawLabels)
	rows, ok := cov["data"].([]any)
	if !ok || len(rows) != n {
		return nil, errors.New("expected cov=mat full square matrix")
	}
	source.Matrix = make([][]float64, n)
	source.Correlation = make([][]float64, n)
	source.MarginalSigmas = make([]float64, n)
	for i, raw := range rows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		row, ok := raw.([]any)
		if !ok || len(row) != n {
			return nil, errors.New("matrix dimensions disagree with labels")
		}
		source.Matrix[i] = make([]float64, n)
		source.Correlation[i] = make([]float64, n)
		for j, rawValue := range row {
			value, err := number(rawValue, "covariance entry")
			if err != nil {
				return nil, err
			}
			source.Matrix[i][j] = value
		}
		if source.Matrix[i][i] <= 0 {
			return nil, errors.New("strictly positive marginal variances required")
		}
		source.MarginalSigmas[i] = math.Sqrt(source.Matrix[i][i])
	}
	for i := range source.Matrix {
		for j, value := range source.Matrix[i] {
			// Divide by the smaller scale first to avoid an intermediate
			// underflow when the final correlation is still representable.
			low := math.Min(source.MarginalSigmas[i], source.MarginalSigmas[j])
			high := math.Max(source.MarginalSigmas[i], source.MarginalSigmas[j])
			correlation := value / low / high
			if !finite(correlation) || math.Abs(correlation) > 1+1e-12 {
				return nil, errors.New("covariance violates pairwise variance bounds")
			}
			source.Correlation[i][j] = correlation
		}
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			a, b := source.Correlation[i][j], source.Correlation[j][i]
			if math.Abs(a-b) > 1e-12 {
				return nil, errors.New("covariance is asymmetric")
			}
			source.Correlation[i][j], source.Correlation[j][i] = (a+b)/2, (a+b)/2
		}
	}
	source.CorrelationEigenvalues, err = eigenvalues(ctx, source.Correlation)
	if err != nil {
		return nil, err
	}
	if source.CorrelationEigenvalues[0] < -1e-12 {
		return nil, errors.New("covariance is not positive semidefinite")
	}
	source.PositiveDefinite = source.CorrelationEigenvalues[0] > 1e-12
	source.AdditionalParameters = append([]string{}, source.Labels[6:]...)
	source.SolutionDateLocal = optionalText(orbit["soln_date"])
	source.PlanetaryEphemeris = optionalText(orbit["pe_used"])
	source.SmallBodyEphemeris = optionalText(orbit["sb_used"])
	return source, nil
}

// Jacobi rotations use the dimensionless symmetric correlation only. The raw
// covariance remains unchanged; no jitter or eigenvalue clipping is applied.
func eigenvalues(ctx context.Context, source [][]float64) ([]float64, error) {
	n := len(source)
	a := make([][]float64, n)
	for i := range source {
		a[i] = append([]float64(nil), source[i]...)
	}
	const epsilon = 0x1p-52
	for step := 0; step < 64*n*n; step++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		p, q, largest := 0, 1, 0.0
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				if magnitude := math.Abs(a[i][j]); magnitude > largest {
					p, q, largest = i, j, magnitude
				}
			}
		}
		if largest <= 8*epsilon*float64(n) {
			values := make([]float64, n)
			for i := range values {
				values[i] = a[i][i]
				if !finite(values[i]) {
					return nil, errors.New("nonfinite covariance eigenvalue")
				}
			}
			sort.Float64s(values)
			return values, nil
		}
		tau := (a[q][q] - a[p][p]) / (2 * a[p][q])
		t := math.Copysign(1, tau) / (math.Abs(tau) + math.Hypot(1, tau))
		c := 1 / math.Hypot(1, t)
		s, cross := t*c, a[p][q]
		a[p][p] -= t * cross
		a[q][q] += t * cross
		a[p][q], a[q][p] = 0, 0
		for k := 0; k < n; k++ {
			if k == p || k == q {
				continue
			}
			kp, kq := a[k][p], a[k][q]
			a[k][p], a[p][k] = c*kp-s*kq, c*kp-s*kq
			a[k][q], a[q][k] = s*kp+c*kq, s*kp+c*kq
		}
	}
	return nil, errors.New("covariance correlation eigensolver did not converge")
}
