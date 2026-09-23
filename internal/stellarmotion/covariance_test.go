package stellarmotion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"testing"
)

func TestIndependentERFACovariances(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/gaia-covariance-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var reference struct {
		SourceSHA256    string `json:"sourceSha256"`
		GeneratorSHA256 string `json:"generatorSha256"`
		Cases           []struct {
			Source   json.RawMessage `json:"source"`
			Year     float64         `json:"targetYearTCB"`
			Expected Matrix6         `json:"expected"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(raw, &reference); err != nil {
		t.Fatal(err)
	}
	for path, expected := range map[string]string{"../../tests/fixtures/gaia-six-20260923/r11-d22.json": reference.SourceSHA256, "../../scripts/reference-gaia-covariance.py": reference.GeneratorSHA256} {
		bytes, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(bytes)
		if hex.EncodeToString(hash[:]) != expected {
			t.Fatalf("reference receipt mismatch %s", path)
		}
	}
	if len(reference.Cases) != 64 {
		t.Fatal("incomplete covariance reference")
	}
	maximum := 0.
	for _, c := range reference.Cases {
		result, err := PropagateFormalCovariance(context.Background(), c.Source, c.Year, "spectroscopic-as-astrometric", "independent-spectroscopic-rv")
		if err != nil {
			t.Fatalf("epoch %v: %v", c.Year, err)
		}
		for i := 0; i < 6; i++ {
			for j := 0; j < 6; j++ {
				scale := math.Sqrt(c.Expected[i][i] * c.Expected[j][j])
				difference := math.Abs(result.Output[i][j]-c.Expected[i][j]) / scale
				maximum = math.Max(maximum, difference)
				if difference > 5e-4 {
					t.Fatalf("covariance mismatch epoch %v [%d,%d]: normalized difference %g", c.Year, i, j, difference)
				}
			}
		}
	}
	t.Logf("64 independent ERFA covariance cases; maximum standard-deviation-product-normalized difference %.9g", maximum)
}

func TestSeededNonlinearERFAEnsembles(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/gaia-covariance-ensemble.json")
	if err != nil {
		t.Fatal(err)
	}
	var reference struct {
		SourceHash    string `json:"sourceSha256"`
		LinearHash    string `json:"linearReferenceSha256"`
		GeneratorHash string `json:"generatorSha256"`
		Cases         []struct {
			ID     string  `json:"sourceId"`
			Year   float64 `json:"targetYearTCB"`
			Count  int     `json:"sampleCount"`
			Matrix Matrix6 `json:"sampleCovariance"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(raw, &reference); err != nil {
		t.Fatal(err)
	}
	for path, expected := range map[string]string{"../../tests/fixtures/gaia-six-20260923/r11-d22.json": reference.SourceHash, "../../tests/fixtures/gaia-covariance-reference.json": reference.LinearHash, "../../scripts/reference-gaia-covariance-ensemble.py": reference.GeneratorHash} {
		bytes, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(bytes)
		if hex.EncodeToString(hash[:]) != expected {
			t.Fatalf("ensemble receipt mismatch %s", path)
		}
	}
	sources := map[string]json.RawMessage{}
	for _, raw := range covarianceSources(t) {
		var source Source
		if err = json.Unmarshal(raw, &source); err != nil {
			t.Fatal(err)
		}
		sources[source.ID] = raw
	}
	if len(reference.Cases) != 6 {
		t.Fatal("incomplete ensemble evidence")
	}
	maximum := 0.
	for _, c := range reference.Cases {
		if c.Count != 32768 {
			t.Fatal("wrong ensemble size")
		}
		result, err := PropagateFormalCovariance(context.Background(), sources[c.ID], c.Year, "spectroscopic-as-astrometric", "independent-spectroscopic-rv")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 6; i++ {
			for j := 0; j < 6; j++ {
				difference := math.Abs(result.Output[i][j]-c.Matrix[i][j]) / math.Sqrt(result.Output[i][i]*result.Output[j][j])
				maximum = math.Max(maximum, difference)
				if difference > .05 {
					t.Fatalf("ensemble disagreement %s %v [%d,%d]: %g", c.ID, c.Year, i, j, difference)
				}
			}
		}
	}
	t.Logf("six seeded nonlinear ensembles, maximum normalized difference %.9g (includes sampling error)", maximum)
}

func covarianceSources(t *testing.T) []json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("../../tests/fixtures/gaia-six-20260923/r11-d22.json")
	if err != nil {
		t.Fatal(err)
	}
	var chunk struct {
		Sources []json.RawMessage `json:"sources"`
	}
	if err = json.Unmarshal(raw, &chunk); err != nil {
		t.Fatal(err)
	}
	return chunk.Sources
}

func TestFormalCovarianceEpochIdentity(t *testing.T) {
	count := 0
	for _, raw := range covarianceSources(t) {
		var source Source
		if err := json.Unmarshal(raw, &source); err != nil {
			t.Fatal(err)
		}
		if source.RadialVelocity == nil {
			continue
		}
		count++
		result, err := PropagateFormalCovariance(context.Background(), raw, 2016, "spectroscopic-as-astrometric", "independent-spectroscopic-rv")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 6; i++ {
			for j := 0; j < 6; j++ {
				scale := math.Sqrt(result.Input[i][i] * result.Input[j][j])
				if math.Abs(result.Output[i][j]-result.Input[i][j])/scale > 2e-5 {
					t.Fatalf("epoch identity failed %s [%d,%d]", source.ID, i, j)
				}
				if result.Output[i][j] != result.Output[j][i] {
					t.Fatal("asymmetric covariance")
				}
			}
		}
		for i := 0; i < 5; i++ {
			if result.Input[i][5] != 0 {
				t.Fatal("unexpected adopted RV cross covariance")
			}
		}
	}
	if count != 16 {
		t.Fatalf("expected 16 real RV sources, got %d", count)
	}
}

func TestFormalCovarianceContractsAndCancellation(t *testing.T) {
	var raw json.RawMessage
	for _, candidate := range covarianceSources(t) {
		var source Source
		if err := json.Unmarshal(candidate, &source); err != nil {
			t.Fatal(err)
		}
		if source.ID == "65212004581252736" {
			raw = candidate
			break
		}
	}
	if raw == nil {
		t.Fatal("missing reference source")
	}
	if _, err := FormalInputCovariance(raw, ""); err == nil {
		t.Fatal("implicit independence accepted")
	}
	for _, key := range []string{"radial_velocity_error", "ra_dec_corr", "ra_error"} {
		var record map[string]any
		if err := json.Unmarshal(raw, &record); err != nil {
			t.Fatal(err)
		}
		record[key] = nil
		altered, _ := json.Marshal(record)
		if _, err := FormalInputCovariance(altered, "independent-spectroscopic-rv"); err == nil {
			t.Fatalf("missing %s accepted", key)
		}
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	record["ra_dec_corr"] = .99
	record["ra_parallax_corr"] = .99
	record["dec_parallax_corr"] = -.99
	altered, _ := json.Marshal(record)
	if _, err := FormalInputCovariance(altered, "independent-spectroscopic-rv"); err == nil {
		t.Fatal("invalid joint correlations accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PropagateFormalCovariance(ctx, raw, 2026, "spectroscopic-as-astrometric", "independent-spectroscopic-rv"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	result, err := PropagateFormalCovariance(context.Background(), raw, 2026, "spectroscopic-as-astrometric", "independent-spectroscopic-rv")
	if err != nil {
		t.Fatal(err)
	}
	if result.Output[0][0] <= result.Input[0][0] || result.Output[1][1] <= result.Input[1][1] {
		t.Fatal("expected growing position variance for this source")
	}
	if len(result.Assumptions) != 4 || result.CoordinateLabels[5] != "radial-velocity" {
		t.Fatal("lost covariance semantics")
	}
}
