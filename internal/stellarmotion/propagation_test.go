package stellarmotion

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestIndependentERFAStates(t *testing.T) {
	var fixture struct {
		SourceSHA256 string `json:"sourceSha256"`
		Cases        []struct {
			Source   Source    `json:"source"`
			Year     float64   `json:"targetYearTCB"`
			Expected []float64 `json:"expected"`
			Direct   []float64 `json:"directTCB"`
		} `json:"cases"`
	}
	bytes, err := os.ReadFile("../../tests/fixtures/gaia-motion-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(bytes, &fixture); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/fixtures/gaia-six-20260923/r11-d22.json")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != fixture.SourceSHA256 {
		t.Fatal("Source hash mismatch")
	}
	if len(fixture.Cases) != 64 {
		t.Fatal("Incomplete reference cases")
	}
	for _, c := range fixture.Cases {
		result, err := Propagate(c.Source, c.Year, "spectroscopic-as-astrometric")
		if err != nil {
			t.Fatal(err)
		}
		s := result.State
		values := []float64{s.RA, s.Dec, s.Parallax, s.PMRA, s.PMDec, s.RadialVelocity}
		for i, v := range values {
			if math.Abs(v-c.Expected[i]) > 2e-10 {
				t.Fatalf("%s year %v component %d: %.17g != %.17g", c.Source.ID, c.Year, i, v, c.Expected[i])
			}
			if math.Abs(v-c.Direct[i]) > 2e-9 {
				t.Fatal("Coordinate scaling changed the physical model")
			}
		}
		if result.ScaleFactor == 1 || len(result.Limitations) == 0 {
			t.Fatal("Missing scaling or scientific limits")
		}
	}
}
func TestRefusesIncompleteOrModifiedModels(t *testing.T) {
	bytes, err := os.ReadFile("../../tests/fixtures/gaia-six-20260923/r11-d22.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Sources []Source `json:"sources"`
	}
	if err = json.Unmarshal(bytes, &data); err != nil {
		t.Fatal(err)
	}
	original := data.Sources[0]
	if _, err = Propagate(original, 2026, ""); err == nil {
		t.Fatal("Implicit radial-velocity approximation accepted")
	}
	mutations := []func(*Source){
		func(s *Source) { s.RadialVelocity = nil }, func(s *Source) { s.RA = nil }, func(s *Source) { s.Epoch = 2015 },
		func(s *Source) { v := -1.; s.Parallax = &v }, func(s *Source) { v := 1e-12; s.Parallax = &v },
		func(s *Source) { v := 90.; s.Dec = &v }, func(s *Source) { v := 1e15; s.PMRA = &v }, func(s *Source) { s.Solution = 3 },
	}
	for i, mutate := range mutations {
		s := original
		mutate(&s)
		if _, err = Propagate(s, 2026, "spectroscopic-as-astrometric"); err == nil {
			t.Fatalf("invalid case %d accepted", i)
		}
	}
	for _, year := range []float64{math.NaN(), 2116.001, 1915.9} {
		if _, err = Propagate(original, year, "spectroscopic-as-astrometric"); err == nil {
			t.Fatal("Invalid epoch accepted")
		}
	}
}
