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

func TestDE440RestrictedIntegratorMatchesIndependentReference(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate orbit uncertainty test source")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", ".."))
	read := func(path string) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(repositoryRoot, filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	spkBytes := read("public/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp")
	gmBytes := read("src/data/gm_de440.tpc")
	referenceBytes := read("tests/fixtures/de440-dynamics-reference.json")
	var reference struct {
		ReferenceEpochTDB float64   `json:"referenceEpochTdb"`
		GMSHA256          string    `json:"gmSha256"`
		Initial           []float64 `json:"initial"`
		Masses            []struct {
			NAIFID int     `json:"naifId"`
			GM     float64 `json:"gmKm3PerSecond2"`
		} `json:"masses"`
		SourceStates []struct {
			Elapsed float64     `json:"elapsed"`
			States  [][]float64 `json:"states"`
		} `json:"sourceStates"`
		Cases []struct {
			Duration float64   `json:"duration"`
			Result   []float64 `json:"result"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(referenceBytes, &reference); err != nil {
		t.Fatal(err)
	}
	spkHash, gmHash := sha256.Sum256(spkBytes), sha256.Sum256(gmBytes)
	if hex.EncodeToString(spkHash[:]) != de440Hash || reference.GMSHA256 != de440GMHash || hex.EncodeToString(gmHash[:]) != de440GMHash {
		t.Fatal("DE440 source or independent reference hashes do not match the pinned inputs")
	}
	const day = 86400.0
	exclusions := make(map[int]float64, 11)
	for _, id := range []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9} {
		exclusions[id] = 0
	}
	ctx := context.Background()
	dynamics, err := NewDE440Dynamics(ctx, DE440Options{
		SPKBytes: spkBytes, GMBytes: gmBytes, ReferenceEpochTDB: reference.ReferenceEpochTDB,
		ElapsedRangeSeconds: [2]float64{-10 * day, 30 * day}, ExclusionKm: exclusions,
	})
	if err != nil {
		t.Fatal(err)
	}
	ids := []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9}
	if len(reference.Masses) != len(ids) || len(reference.SourceStates) == 0 || len(reference.Cases) == 0 {
		t.Fatal("independent DE440 reference fixture is incomplete")
	}
	for i, id := range ids {
		mass := dynamics.Evidence.Gravity.Masses[i]
		if reference.Masses[i].NAIFID != id || mass.NAIFID != id || math.Abs(mass.GMKm3PerSecond2/reference.Masses[i].GM-1) >= 2e-15 {
			t.Fatalf("DE440 mass source mismatch for NAIF %d", id)
		}
	}
	for _, epoch := range reference.SourceStates {
		if len(epoch.States) != len(ids) {
			t.Fatalf("fixture source-state count differs at elapsed %.17g", epoch.Elapsed)
		}
		for i, id := range ids {
			got, err := dynamics.State(ctx, id, epoch.Elapsed)
			if err != nil {
				t.Fatalf("DE440 state %d at %.17g: %v", id, epoch.Elapsed, err)
			}
			if len(epoch.States[i]) != len(got) {
				t.Fatalf("fixture DE440 state width differs for NAIF %d", id)
			}
			for component, want := range epoch.States[i] {
				tolerance := 2e-6
				if component >= 3 {
					tolerance = 1e-10
				}
				if math.Abs(got[component]-want) >= tolerance {
					t.Fatalf("DE440 state %d component %d at %.17g: got %.17g, want %.17g", id, component, epoch.Elapsed, got[component], want)
				}
			}
		}
	}
	initial, err := WithIdentityTransition(reference.Initial)
	if err != nil {
		t.Fatal(err)
	}
	absoluteTolerance := make([]float64, len(initial))
	for i := range absoluteTolerance {
		absoluteTolerance[i] = 1e-12
	}
	for i := 0; i < 3; i++ {
		absoluteTolerance[i] = 1e-5
	}
	for _, example := range reference.Cases {
		if len(example.Result) != len(initial) {
			t.Fatalf("independent integration result has %d values, want %d", len(example.Result), len(initial))
		}
		result, err := Integrate(ctx, IntegrationOptions{
			Initial: initial, Duration: example.Duration, Derivative: dynamics.Derivative,
			AbsoluteTolerance: absoluteTolerance, RelativeTolerance: 1e-12,
			InitialStep: 3600, MaxStep: day, MaxAttempts: 10000,
		})
		if err != nil {
			t.Fatalf("restricted DE440 integration to %.17g seconds: %v", example.Duration, err)
		}
		for i, want := range example.Result {
			if math.Abs(result.State[i]-want)/(1+math.Abs(want)) >= 3e-10 {
				t.Fatalf("integrated component %d at %.17g seconds: got %.17g, want %.17g", i, example.Duration, result.State[i], want)
			}
		}
		positionError := math.Hypot(math.Hypot(result.State[0]-example.Result[0], result.State[1]-example.Result[1]), result.State[2]-example.Result[2])
		if positionError >= 1e-4 {
			t.Fatalf("integrated position at %.17g seconds differs by %.9g km", example.Duration, positionError)
		}
	}
}

func TestAdvanceCompensatedEpochUsesActualProgress(t *testing.T) {
	ulp := math.Nextafter(1, math.Inf(1)) - 1
	cases := []struct {
		name, direction string
		elapsed         float64
		compensation    float64
		step            float64
	}{
		{name: "forward", direction: "forward", elapsed: 1, compensation: -ulp / 2, step: ulp / 4},
		{name: "backward", direction: "backward", elapsed: -1, compensation: ulp / 2, step: -ulp / 4},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if test.elapsed+test.step != test.elapsed {
				t.Fatal("fixture step unexpectedly advances without compensation")
			}
			next, correction := advanceCompensatedEpoch(test.elapsed, test.compensation, test.step, test.elapsed+2*test.step, false)
			if test.direction == "forward" && !(next > test.elapsed) {
				t.Fatalf("compensated endpoint did not advance: got %.17g from %.17g", next, test.elapsed)
			}
			if test.direction == "backward" && !(next < test.elapsed) {
				t.Fatalf("compensated endpoint did not advance backward: got %.17g from %.17g", next, test.elapsed)
			}
			if !finite(correction) {
				t.Fatal("next time correction is not finite")
			}
		})
	}
}

func TestAdvanceCompensatedEpochPinsExactEndpoint(t *testing.T) {
	next, correction := advanceCompensatedEpoch(0.75, 0.01, 0.24, 1, true)
	if next != 1 || correction != 0 {
		t.Fatalf("endpoint was not pinned exactly: next=%0.17g correction=%0.17g", next, correction)
	}
}
