package stellarmotion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
)

type Experiment struct {
	FormalCovariance   *FormalCovariance `json:"formalCovariance,omitempty"`
	SchemaVersion      int               `json:"schemaVersion"`
	ManifestSHA256     string            `json:"manifestSha256"`
	RowsSHA256         string            `json:"rowsSha256"`
	OriginalManifest   []byte            `json:"originalManifestBase64"`
	OriginalRows       []byte            `json:"originalRowsCsvBase64"`
	SelectedSource     json.RawMessage   `json:"selectedSource"`
	Result             *Result           `json:"result"`
	ProvenanceBoundary string            `json:"provenanceBoundary"`
}

// FromCSVWithCovariance preserves the nominal source receipt and adds formal
// uncertainty only under an explicit supported policy. Omission computes no covariance.
func FromCSVWithCovariance(ctx context.Context, manifestBytes, rowsBytes []byte, id string, year float64, rvPolicy, covariancePolicy string) (*Experiment, error) {
	if covariancePolicy != "" && covariancePolicy != "independent-spectroscopic-rv" {
		return nil, fmt.Errorf("unsupported stellar covariance policy")
	}
	result, err := FromCSVContext(ctx, manifestBytes, rowsBytes, id, year, rvPolicy)
	if err != nil {
		return nil, err
	}
	if covariancePolicy != "" {
		result.FormalCovariance, err = PropagateFormalCovariance(ctx, result.SelectedSource, year, rvPolicy, covariancePolicy)
		if err != nil {
			return nil, err
		}
		result.Result.Limitations[3] = "First-order formal uncertainty is supplied separately under explicit independent RV errors; no systematics, acceleration, Galactic potential, observer parallax, deflection or aberration."
	}
	return result, nil
}

func digest(raw []byte) string { value := sha256.Sum256(raw); return hex.EncodeToString(value[:]) }

// FromCSV evaluates one original source row. It verifies the CSV receipt and
// selected input, not an upstream identity or the manifest's completeness claim.
func FromCSV(manifestBytes, rowsBytes []byte, id string, year float64, policy string) (*Experiment, error) {
	return FromCSVContext(context.Background(), manifestBytes, rowsBytes, id, year, policy)
}

// FromCSVContext checks cancellation before parsing and between bounded CSV rows.
func FromCSVContext(ctx context.Context, manifestBytes, rowsBytes []byte, id string, year float64, policy string) (*Experiment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(manifestBytes) == 0 || len(manifestBytes) > 1<<20 || len(rowsBytes) == 0 || len(rowsBytes) > 8<<20 {
		return nil, fmt.Errorf("Gaia source byte budget exceeded")
	}
	var manifest struct {
		Schema  int      `json:"schemaVersion"`
		Catalog string   `json:"catalog"`
		Table   string   `json:"table"`
		Frame   string   `json:"frame"`
		Epoch   float64  `json:"referenceEpochJulianYear"`
		Scale   string   `json:"referenceEpochTimeScale"`
		Rows    int      `json:"rows"`
		Columns []string `json:"columns"`
		Sources []struct {
			Path   string `json:"path"`
			SHA256 string `json:"sha256"`
			Bytes  int    `json:"bytes"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, err
	}
	if (manifest.Schema != 1 && manifest.Schema != 2) || manifest.Catalog != "Gaia DR3" || manifest.Table != "gaiadr3.gaia_source" || manifest.Frame != "ICRS" || manifest.Epoch != 2016 || manifest.Scale != "TCB" || manifest.Rows < 1 || manifest.Rows > 10000 {
		return nil, fmt.Errorf("unsupported Gaia CSV manifest")
	}
	expectedColumns := 28
	columnNames := "source_id,ref_epoch,ra,dec,ra_error,dec_error,parallax,parallax_error,pmra,pmra_error,pmdec,pmdec_error,ra_dec_corr,ra_parallax_corr,ra_pmra_corr,ra_pmdec_corr,dec_parallax_corr,dec_pmra_corr,dec_pmdec_corr,parallax_pmra_corr,parallax_pmdec_corr,pmra_pmdec_corr,astrometric_params_solved,ruwe,phot_g_mean_mag,bp_rp,radial_velocity,radial_velocity_error"
	if manifest.Schema == 2 {
		expectedColumns = 35
		columnNames += ",pseudocolour,pseudocolour_error,ra_pseudocolour_corr,dec_pseudocolour_corr,parallax_pseudocolour_corr,pmra_pseudocolour_corr,pmdec_pseudocolour_corr"
	}
	if len(manifest.Columns) != expectedColumns || strings.Join(manifest.Columns, ",") != columnNames {
		return nil, fmt.Errorf("invalid Gaia source columns")
	}
	names := map[string]bool{}
	for _, name := range manifest.Columns {
		if name == "" || names[name] {
			return nil, fmt.Errorf("duplicate or empty source column")
		}
		names[name] = true
	}
	matched := 0
	rowsHash := digest(rowsBytes)
	for _, source := range manifest.Sources {
		if source.Path == "rows.csv" {
			matched++
			if source.SHA256 != rowsHash || source.Bytes != len(rowsBytes) {
				return nil, fmt.Errorf("original Gaia CSV receipt mismatch")
			}
		}
	}
	if matched != 1 {
		return nil, fmt.Errorf("exactly one original rows.csv receipt required")
	}
	reader := csv.NewReader(bytes.NewReader(rowsBytes))
	reader.FieldsPerRecord = len(manifest.Columns)
	header, err := reader.Read()
	if err != nil || !reflect.DeepEqual(header, manifest.Columns) {
		return nil, fmt.Errorf("Gaia CSV header does not match manifest")
	}
	var selected []string
	count := 0
	var previous int64
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		count++
		if count > 10000 {
			return nil, fmt.Errorf("Gaia row budget exceeded")
		}
		identity, err := strconv.ParseInt(row[0], 10, 64)
		if err != nil || !sourceID.MatchString(row[0]) || identity <= previous {
			return nil, fmt.Errorf("source IDs must be unique ordered signed-64-bit strings")
		}
		previous = identity
		if row[0] == id {
			selected = row
		}
	}
	if count != manifest.Rows {
		return nil, fmt.Errorf("Gaia CSV row count mismatch")
	}
	if selected == nil {
		return nil, fmt.Errorf("selected source ID absent from original CSV")
	}
	record := map[string]any{"source_id": id}
	for i, name := range header {
		if i == 0 {
			continue
		}
		if selected[i] == "" {
			record[name] = nil
			continue
		}
		value, err := strconv.ParseFloat(selected[i], 64)
		if err != nil || !finite(value) {
			return nil, fmt.Errorf("invalid selected Gaia numeric field %s", name)
		}
		record[name] = value
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	var source Source
	if err = json.Unmarshal(raw, &source); err != nil {
		return nil, err
	}
	result, err := Propagate(source, year, policy)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &Experiment{SchemaVersion: 1, ManifestSHA256: digest(manifestBytes), RowsSHA256: rowsHash, OriginalManifest: append([]byte(nil), manifestBytes...), OriginalRows: append([]byte(nil), rowsBytes...), SelectedSource: raw, Result: result,
		ProvenanceBoundary: "Original CSV bytes agree with the supplied manifest receipt; this does not independently authenticate ESA or verify catalog completeness. No chunk or other source-file validation is implied."}, nil
}
