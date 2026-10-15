package stellarmotion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

const (
	maxGaiaMotionManifestBytes = 1 << 20
	maxGaiaMotionChunkBytes    = 32 << 20
	maxGaiaMotionManifestRows  = 100_000
	maxGaiaMotionChunks        = 2_592
	maxGaiaMotionSelectedBytes = 128 << 20
)

var gaiaMotionChunkPath = regexp.MustCompile(`^r([0-9]+)-d([0-9]+)\.json$`)

type GaiaChunkMotionResult struct {
	ManifestSHA256     string       `json:"manifestSha256"`
	ChunkPath          string       `json:"chunkPath"`
	ChunkSHA256        string       `json:"chunkSha256"`
	ProvenanceBoundary string       `json:"provenanceBoundary"`
	Motion             *BatchResult `json:"motion"`
}

type gaiaMotionSettings struct {
	RA           float64 `json:"raDeg"`
	Dec          float64 `json:"decDeg"`
	Radius       float64 `json:"radiusDeg"`
	MaxMagnitude float64 `json:"maxMagnitude"`
	MaxRows      int     `json:"maxRows"`
}

type gaiaMotionDescriptor struct {
	Path     string     `json:"path"`
	SHA256   string     `json:"sha256"`
	Bytes    int        `json:"bytes"`
	Rows     int        `json:"rows"`
	RARange  [2]float64 `json:"raRangeDeg"`
	DecRange [2]float64 `json:"decRangeDeg"`
}

type gaiaMotionRowCountEvidence struct {
	Method       string `json:"method"`
	Limit        int    `json:"limit"`
	ReturnedRows int    `json:"returnedRows"`
	Overflow     bool   `json:"overflow"`
}

type gaiaMotionManifest struct {
	SchemaVersion       int                         `json:"schemaVersion"`
	Catalog             string                      `json:"catalog"`
	Table               string                      `json:"table"`
	Frame               string                      `json:"frame"`
	ReferenceEpoch      float64                     `json:"referenceEpochJulianYear"`
	ReferenceEpochScale string                      `json:"referenceEpochTimeScale"`
	Rows                int                         `json:"rows"`
	Columns             []string                    `json:"columns"`
	QueryCountMatched   bool                        `json:"queryCountMatched"`
	RowCountEvidence    *gaiaMotionRowCountEvidence `json:"rowCountEvidence"`
	CatalogCompleteness *bool                       `json:"catalogCompletenessCertified"`
	Settings            gaiaMotionSettings          `json:"settings"`
	Chunks              []gaiaMotionDescriptor      `json:"chunks"`
}

type gaiaMotionChunkSource struct {
	Source
	SolutionNumber json.Number `json:"astrometric_params_solved"`
	PhotGMeanMag   *float64    `json:"phot_g_mean_mag"`
}

type gaiaMotionChunk struct {
	Key      string     `json:"key"`
	RARange  [2]float64 `json:"raRangeDeg"`
	DecRange [2]float64 `json:"decRangeDeg"`
}

func gaiaMotionColumns(schemaVersion int) []string {
	columns := []string{"source_id", "ref_epoch", "ra", "dec", "ra_error", "dec_error", "parallax", "parallax_error", "pmra", "pmra_error", "pmdec", "pmdec_error", "ra_dec_corr", "ra_parallax_corr", "ra_pmra_corr", "ra_pmdec_corr", "dec_parallax_corr", "dec_pmra_corr", "dec_pmdec_corr", "parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr", "astrometric_params_solved", "ruwe", "phot_g_mean_mag", "bp_rp", "radial_velocity", "radial_velocity_error"}
	if schemaVersion == 2 {
		columns = append(columns, "pseudocolour", "pseudocolour_error", "ra_pseudocolour_corr", "dec_pseudocolour_corr", "parallax_pseudocolour_corr", "pmra_pseudocolour_corr", "pmdec_pseudocolour_corr")
	}
	return columns
}

func verifyGaiaMotionManifest(raw []byte) (gaiaMotionManifest, map[string]gaiaMotionDescriptor, error) {
	var manifest gaiaMotionManifest
	if len(raw) == 0 || len(raw) > maxGaiaMotionManifestBytes {
		return manifest, nil, fmt.Errorf("Gaia motion manifest exceeds its byte budget")
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, nil, fmt.Errorf("invalid Gaia motion manifest: %w", err)
	}
	s := manifest.Settings
	if (manifest.SchemaVersion != 1 && manifest.SchemaVersion != 2) || manifest.Catalog != "Gaia DR3" || manifest.Table != "gaiadr3.gaia_source" || manifest.Frame != "ICRS" || manifest.ReferenceEpoch != 2016 || manifest.ReferenceEpochScale != "TCB" ||
		manifest.CatalogCompleteness == nil || *manifest.CatalogCompleteness || manifest.Rows < 1 || manifest.Rows > maxGaiaMotionManifestRows || len(manifest.Chunks) < 1 || len(manifest.Chunks) > maxGaiaMotionChunks ||
		!finite(s.RA) || s.RA < 0 || s.RA >= 360 || !finite(s.Dec) || math.Abs(s.Dec) > 90 || !finite(s.Radius) || s.Radius <= 0 || s.Radius > 2 ||
		!finite(s.MaxMagnitude) || s.MaxMagnitude < 3 || s.MaxMagnitude > 20 || s.MaxRows < 1 || s.MaxRows > maxGaiaMotionManifestRows || manifest.Rows > s.MaxRows {
		return manifest, nil, fmt.Errorf("unsupported Gaia motion manifest contract")
	}
	if len(manifest.Columns) != len(gaiaMotionColumns(manifest.SchemaVersion)) {
		return manifest, nil, fmt.Errorf("Gaia motion manifest columns mismatch")
	}
	for index, column := range gaiaMotionColumns(manifest.SchemaVersion) {
		if manifest.Columns[index] != column {
			return manifest, nil, fmt.Errorf("Gaia motion manifest columns mismatch")
		}
	}
	if manifest.RowCountEvidence != nil {
		e := manifest.RowCountEvidence
		if e.Method != "top-plus-one-sentinel" || e.Limit != s.MaxRows+1 || e.ReturnedRows != manifest.Rows || e.Overflow {
			return manifest, nil, fmt.Errorf("Gaia motion row-count evidence mismatch")
		}
	}
	if !manifest.QueryCountMatched && manifest.RowCountEvidence == nil {
		return manifest, nil, fmt.Errorf("Gaia motion manifest has no row-count evidence")
	}

	descriptors := make(map[string]gaiaMotionDescriptor, len(manifest.Chunks))
	rows, selectedBytes := 0, 0
	for _, descriptor := range manifest.Chunks {
		match := gaiaMotionChunkPath.FindStringSubmatch(descriptor.Path)
		if match == nil || descriptor.Bytes < 1 || descriptor.Bytes > maxGaiaMotionChunkBytes || descriptor.Rows < 1 || descriptor.Rows > MaxBatchRows || len(descriptor.SHA256) != 64 ||
			descriptor.SHA256 != strings.ToLower(descriptor.SHA256) {
			return manifest, nil, fmt.Errorf("invalid Gaia motion chunk descriptor")
		}
		if _, err := hex.DecodeString(descriptor.SHA256); err != nil {
			return manifest, nil, fmt.Errorf("invalid Gaia motion chunk checksum")
		}
		raIndex, errRA := strconv.Atoi(match[1])
		decIndex, errDec := strconv.Atoi(match[2])
		if errRA != nil || errDec != nil || raIndex > 71 || decIndex > 35 ||
			descriptor.RARange != [2]float64{float64(raIndex * 5), float64((raIndex + 1) * 5)} ||
			descriptor.DecRange != [2]float64{float64(decIndex*5 - 90), float64((decIndex+1)*5 - 90)} {
			return manifest, nil, fmt.Errorf("Gaia motion spatial bin mismatch")
		}
		if _, duplicate := descriptors[descriptor.Path]; duplicate {
			return manifest, nil, fmt.Errorf("duplicate Gaia motion chunk path")
		}
		descriptors[descriptor.Path] = descriptor
		rows += descriptor.Rows
		selectedBytes += descriptor.Bytes
		if selectedBytes > maxGaiaMotionSelectedBytes {
			return manifest, nil, fmt.Errorf("Gaia motion selected-byte budget exceeded")
		}
	}
	if rows != manifest.Rows {
		return manifest, nil, fmt.Errorf("Gaia motion manifest row count mismatch")
	}
	return manifest, descriptors, nil
}

// PropagateVerifiedChunk validates the chunk's exact bytes against its Gaia
// manifest descriptor before sending its rows through the SOFA model.
func PropagateVerifiedChunk(ctx context.Context, manifestBytes []byte, chunkPath string, chunkBytes []byte, targetYearTCB float64, rvPolicy string) (*GaiaChunkMotionResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	manifest, descriptors, err := verifyGaiaMotionManifest(manifestBytes)
	if err != nil {
		return nil, err
	}
	manifestHash := sha256.Sum256(manifestBytes)
	return propagateVerifiedGaiaMotionChunk(ctx, manifest, descriptors, manifestHash, chunkPath, chunkBytes, targetYearTCB, rvPolicy)
}

func propagateVerifiedGaiaMotionChunk(ctx context.Context, manifest gaiaMotionManifest, descriptors map[string]gaiaMotionDescriptor, manifestHash [sha256.Size]byte, chunkPath string, chunkBytes []byte, targetYearTCB float64, rvPolicy string) (*GaiaChunkMotionResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	descriptor, ok := descriptors[chunkPath]
	if !ok {
		return nil, fmt.Errorf("Gaia motion chunk is not declared by its manifest")
	}
	if len(chunkBytes) != descriptor.Bytes || len(chunkBytes) > maxGaiaMotionChunkBytes {
		return nil, fmt.Errorf("Gaia motion chunk size differs from its descriptor")
	}
	chunkHashBytes := sha256.Sum256(chunkBytes)
	chunkHash := hex.EncodeToString(chunkHashBytes[:])
	if chunkHash != descriptor.SHA256 {
		return nil, fmt.Errorf("Gaia motion chunk checksum mismatch")
	}

	sources, err := decodeGaiaMotionChunk(ctx, chunkBytes, chunkPath, descriptor, manifest.SchemaVersion, manifest.Settings)
	if err != nil {
		return nil, err
	}

	motion, err := PropagateBatchContext(ctx, sources, targetYearTCB, rvPolicy)
	if err != nil {
		return nil, err
	}
	return &GaiaChunkMotionResult{
		ManifestSHA256:     hex.EncodeToString(manifestHash[:]),
		ChunkPath:          chunkPath,
		ChunkSHA256:        chunkHash,
		ProvenanceBoundary: "The chunk bytes match the supplied Gaia manifest descriptor and schema. This does not independently authenticate ESA or establish catalog completeness.",
		Motion:             motion,
	}, nil
}

// decodeGaiaMotionChunk consumes source rows one at a time. Keeping a []RawMessage
// for the full sources array duplicates up to the 32 MiB chunk while the caller
// still owns its original bytes; streaming bounds that duplicate to one row.
func decodeGaiaMotionChunk(ctx context.Context, raw []byte, chunkPath string, descriptor gaiaMotionDescriptor, schemaVersion int, settings gaiaMotionSettings) ([]Source, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	opening, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
	}
	if opening != json.Delim('{') {
		return nil, fmt.Errorf("invalid Gaia motion chunk: expected an object")
	}

	var chunk gaiaMotionChunk
	var sources []Source
	sourcesSeen := false
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, fmt.Errorf("invalid Gaia motion chunk: expected an object key")
		}
		switch key {
		case "key":
			err = decoder.Decode(&chunk.Key)
		case "raRangeDeg":
			err = decoder.Decode(&chunk.RARange)
		case "decRangeDeg":
			err = decoder.Decode(&chunk.DecRange)
		case "sources":
			if sourcesSeen {
				return nil, fmt.Errorf("Gaia motion chunk contains duplicate sources fields")
			}
			sourcesSeen = true
			opening, err = decoder.Token()
			if err != nil || opening != json.Delim('[') {
				if err == nil {
					err = fmt.Errorf("expected a sources array")
				}
				return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
			}
			sources = make([]Source, 0, descriptor.Rows)
			previousID := int64(-1)
			for decoder.More() {
				if len(sources) >= descriptor.Rows {
					return nil, fmt.Errorf("Gaia motion chunk metadata differs from its descriptor")
				}
				if len(sources)&127 == 0 {
					if err := ctx.Err(); err != nil {
						return nil, err
					}
				}
				var rawRow json.RawMessage
				if err := decoder.Decode(&rawRow); err != nil {
					return nil, fmt.Errorf("invalid Gaia motion chunk source: %w", err)
				}
				row, err := decodeGaiaMotionSource(rawRow, schemaVersion)
				rawRow = nil
				if err != nil {
					return nil, err
				}
				id, err := strconv.ParseInt(row.ID, 10, 64)
				if err != nil || !sourceID.MatchString(row.ID) || id <= previousID {
					return nil, fmt.Errorf("Gaia motion source IDs must be unique ordered signed-64-bit strings")
				}
				previousID = id
				if row.Epoch != 2016 || row.RA == nil || row.Dec == nil || !finite(*row.RA) || !finite(*row.Dec) || *row.RA < 0 || *row.RA >= 360 || math.Abs(*row.Dec) > 90 ||
					math.Floor(*row.RA/5)*5 != descriptor.RARange[0] || math.Min(35, math.Floor((*row.Dec+90)/5))*5-90 != descriptor.DecRange[0] ||
					row.PhotGMeanMag == nil || !finite(*row.PhotGMeanMag) || *row.PhotGMeanMag > settings.MaxMagnitude || !gaiaMotionInsideCone(*row.RA, *row.Dec, settings) {
					return nil, fmt.Errorf("Gaia motion source does not match its frame, bin or cone")
				}
				if row.Source.Solution != 3 && row.Source.Solution != 31 && row.Source.Solution != 95 {
					return nil, fmt.Errorf("Gaia motion source has an unsupported astrometric solution")
				}
				for _, value := range []*float64{row.Parallax, row.PMRA, row.PMDec, row.RadialVelocity} {
					if value != nil && !finite(*value) {
						return nil, fmt.Errorf("Gaia motion source contains non-finite astrometry")
					}
				}
				sources = append(sources, row.Source)
			}
			closing, closeErr := decoder.Token()
			if closeErr != nil || closing != json.Delim(']') {
				if closeErr == nil {
					closeErr = fmt.Errorf("expected the end of the sources array")
				}
				return nil, fmt.Errorf("invalid Gaia motion chunk: %w", closeErr)
			}
			if len(sources) != descriptor.Rows {
				return nil, fmt.Errorf("Gaia motion chunk metadata differs from its descriptor")
			}
		default:
			err = skipGaiaMotionJSONValue(decoder)
		}
		if err != nil {
			return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') {
		if err == nil {
			err = fmt.Errorf("expected the end of the chunk object")
		}
		return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("trailing data after the chunk object")
		}
		return nil, fmt.Errorf("invalid Gaia motion chunk: %w", err)
	}
	if !sourcesSeen || chunk.Key != strings.TrimSuffix(chunkPath, ".json") || chunk.RARange != descriptor.RARange || chunk.DecRange != descriptor.DecRange || len(sources) != descriptor.Rows {
		return nil, fmt.Errorf("Gaia motion chunk metadata differs from its descriptor")
	}
	return sources, nil
}

// Skip unknown top-level values without materializing their complete JSON text.
func skipGaiaMotionJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	if delimiter != '{' && delimiter != '[' {
		return fmt.Errorf("unexpected JSON delimiter %q", delimiter)
	}
	for decoder.More() {
		if delimiter == '{' {
			if _, err := decoder.Token(); err != nil {
				return err
			}
		}
		if err := skipGaiaMotionJSONValue(decoder); err != nil {
			return err
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return err
	}
	expected := json.Delim(']')
	if delimiter == '{' {
		expected = json.Delim('}')
	}
	if closing != expected {
		return fmt.Errorf("mismatched JSON delimiter %q", closing)
	}
	return nil
}

func decodeGaiaMotionSource(raw json.RawMessage, schemaVersion int) (gaiaMotionChunkSource, error) {
	var row gaiaMotionChunkSource
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return row, fmt.Errorf("invalid Gaia motion source row")
	}
	columns := gaiaMotionColumns(schemaVersion)
	if len(fields) != len(columns) {
		return row, fmt.Errorf("Gaia motion source columns mismatch")
	}
	for _, column := range columns {
		value, ok := fields[column]
		if !ok {
			return row, fmt.Errorf("Gaia motion source columns mismatch")
		}
		trimmed := bytes.TrimSpace(value)
		if column == "source_id" {
			if len(trimmed) < 2 || trimmed[0] != '"' || trimmed[len(trimmed)-1] != '"' {
				return row, fmt.Errorf("invalid Gaia motion source ID")
			}
			continue
		}
		if bytes.Equal(trimmed, []byte("null")) {
			if column == "ref_epoch" || column == "astrometric_params_solved" || column == "phot_g_mean_mag" {
				return row, fmt.Errorf("required Gaia motion source field is null")
			}
			continue
		}
		value64, err := strconv.ParseFloat(string(trimmed), 64)
		if err != nil || !finite(value64) || strings.HasSuffix(column, "_error") && value64 < 0 || strings.HasSuffix(column, "_corr") && math.Abs(value64) > 1 {
			return row, fmt.Errorf("invalid Gaia motion numeric source field %s", column)
		}
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		return row, fmt.Errorf("invalid Gaia motion source fields: %w", err)
	}
	solution, err := strconv.ParseFloat(row.SolutionNumber.String(), 64)
	if err != nil || solution != 3 && solution != 31 && solution != 95 {
		return row, fmt.Errorf("invalid Gaia astrometric solution")
	}
	row.Source.Solution = int(solution)
	return row, nil
}

func gaiaMotionInsideCone(raDeg, decDeg float64, settings gaiaMotionSettings) bool {
	radians := math.Pi / 180
	dec, centerDec := decDeg*radians, settings.Dec*radians
	hav := math.Pow(math.Sin((dec-centerDec)/2), 2) + math.Cos(dec)*math.Cos(centerDec)*math.Pow(math.Sin((raDeg-settings.RA)*radians/2), 2)
	angle := 2 * math.Asin(math.Sqrt(math.Max(0, math.Min(1, hav)))) / radians
	return angle <= settings.Radius+1e-9
}
