package orbituncertainty

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func repositoryFixture(t *testing.T, path string) []byte {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate orbit uncertainty test source")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", ".."))
	value, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func fixtureSHA256(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func TestPropagateCovarianceMatchesIndependentDOP853Reference(t *testing.T) {
	source := repositoryFixture(t, "tests/fixtures/sbdb-eros-covariance.json")
	spkBytes := repositoryFixture(t, "public/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp")
	gmBytes := repositoryFixture(t, "src/data/gm_de440.tpc")
	var reference struct {
		ReferenceEpochTDB      float64 `json:"referenceEpochTdb"`
		SourceSHA256           string  `json:"sourceSha256"`
		GeneratorSHA256        string  `json:"generatorSha256"`
		CoordinateGeneratorSHA string  `json:"coordinateGeneratorSha256"`
		SPKSHA256              string  `json:"spkSha256"`
		GMSHA256               string  `json:"gmSha256"`
		Cases                  []struct {
			Solar1PN                 bool        `json:"solar1pn"`
			DurationSeconds          float64     `json:"durationSeconds"`
			Nominal                  []float64   `json:"nominal"`
			Matrix                   [][]float64 `json:"matrix"`
			RefinementMaxSigmaNormal float64     `json:"refinementMaxSigmaNormalized"`
		} `json:"cases"`
	}
	referenceBytes := repositoryFixture(t, "tests/fixtures/dynamics-covariance-reference-20260926.json")
	if err := json.Unmarshal(referenceBytes, &reference); err != nil {
		t.Fatal(err)
	}
	hashes := []struct{ name, got, want string }{
		{"SBDB source", fixtureSHA256(source), reference.SourceSHA256},
		{"DOP853 generator", fixtureSHA256(repositoryFixture(t, "scripts/reference-dynamics-covariance.py")), reference.GeneratorSHA256},
		{"coordinate generator", fixtureSHA256(repositoryFixture(t, "scripts/reference-orbit-covariance.py")), reference.CoordinateGeneratorSHA},
		{"DE440 SPK", fixtureSHA256(spkBytes), reference.SPKSHA256},
		{"DE440 GM", fixtureSHA256(gmBytes), reference.GMSHA256},
	}
	for _, hash := range hashes {
		if hash.got != hash.want {
			t.Fatalf("%s fixture hash mismatch: got %s, want %s", hash.name, hash.got, hash.want)
		}
	}
	if reference.GMSHA256 != de440GMHash || reference.SPKSHA256 != de440Hash {
		t.Fatal("independent covariance reference does not use the pinned DE440 sources")
	}
	if len(reference.Cases) != 6 {
		t.Fatalf("reference has %d cases, want six duration/model pairs", len(reference.Cases))
	}
	const day = 86400.0
	exclusions := make(map[int]float64, 11)
	for _, id := range []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9} {
		exclusions[id] = 0
	}
	for _, example := range reference.Cases {
		options := DE440Options{
			SPKBytes: spkBytes, GMBytes: gmBytes, ReferenceEpochTDB: reference.ReferenceEpochTDB,
			ElapsedRangeSeconds: [2]float64{-10 * day, 30 * day}, ExclusionKm: exclusions,
			SolarRelativity: example.Solar1PN,
		}
		result, err := PropagateCovariance(context.Background(), source, options, example.DurationSeconds)
		if err != nil {
			t.Fatalf("covariance propagation (1PN=%t, elapsed=%.17g s): %v", example.Solar1PN, example.DurationSeconds, err)
		}
		if (result.ForceModel.SolarRelativity != nil) != example.Solar1PN || len(example.Nominal) != 6 || len(example.Matrix) != 6 {
			t.Fatalf("incomplete force-model or covariance reference (1PN=%t, elapsed=%.17g s)", example.Solar1PN, example.DurationSeconds)
		}
		for i := 0; i < 6; i++ {
			if math.Abs(result.FinalCoordinates.Nominal[i]-example.Nominal[i]) >= map[bool]float64{true: 2e-14, false: 2e-12}[i >= 3] {
				t.Fatalf("nominal axis %d differs at 1PN=%t, elapsed=%.17g s: got %.17g, want %.17g", i, example.Solar1PN, example.DurationSeconds, result.FinalCoordinates.Nominal[i], example.Nominal[i])
			}
			if len(example.Matrix[i]) != 6 || len(result.FinalCoordinates.Matrix[i]) != 6 {
				t.Fatalf("covariance row %d has invalid width", i)
			}
			for j := 0; j < 6; j++ {
				scale := math.Sqrt(example.Matrix[i][i] * example.Matrix[j][j])
				normalizedError := math.Abs(result.FinalCoordinates.Matrix[i][j]-example.Matrix[i][j]) / scale
				if !finite(normalizedError) || normalizedError >= 2e-9 ||
					result.FinalCoordinates.Matrix[i][j] != result.FinalCoordinates.Matrix[j][i] {
					t.Fatalf("covariance [%d,%d] mismatch at 1PN=%t, elapsed=%.17g s: normalized error %.9g", i, j, example.Solar1PN, example.DurationSeconds, normalizedError)
				}
			}
		}
		if result.FinalCoordinates.Epoch != (RelativeEpoch{ReferenceEpochTDB: reference.ReferenceEpochTDB, ElapsedTDBSeconds: example.DurationSeconds}) {
			t.Fatalf("covariance epoch changed at 1PN=%t, elapsed=%.17g s", example.Solar1PN, example.DurationSeconds)
		}
		if !finite(example.RefinementMaxSigmaNormal) || example.RefinementMaxSigmaNormal >= 1e-11 {
			t.Fatalf("independent covariance reference lacks a converged refinement at 1PN=%t, elapsed=%.17g s", example.Solar1PN, example.DurationSeconds)
		}
	}
}
