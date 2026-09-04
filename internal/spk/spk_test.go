package spk

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestType17MatchesIndependentCSPICEOracle(t *testing.T) {
	oracleBytes, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk17-cspice.json"))
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		Elements []float64 `json:"elements"`
		Samples  []struct {
			ET    float64   `json:"et"`
			State []float64 `json:"state"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(oracleBytes, &oracle); err != nil {
		t.Fatal(err)
	}
	if len(oracle.Elements) != 12 || len(oracle.Samples) == 0 {
		t.Fatal("invalid CSPICE type 17 oracle fixture")
	}
	b := make([]byte, 12*8)
	for i, v := range oracle.Elements {
		binary.LittleEndian.PutUint64(b[i*8:], math.Float64bits(v))
	}
	k := &Kernel{data: b, little: true}
	seg := Segment{Type: 17, Start: 1, End: 12, type17: true}
	for _, sample := range oracle.Samples {
		if len(sample.State) != 6 {
			t.Fatal("invalid CSPICE state fixture")
		}
		got, err := k.eval17(seg, sample.ET)
		if err != nil {
			t.Fatal(err)
		}
		for i, want := range sample.State {
			if math.Abs(got[i]-want) > 1e-9*math.Max(1, math.Abs(want)) {
				t.Fatalf("et %v component %d got %.17g want %.17g", sample.ET, i, got[i], want)
			}
		}
	}
}

func TestSyntheticType21MatchesCSPICEFixture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	k, err := New(b)
	if err != nil {
		t.Fatal(err)
	}
	s, ok, err := k.Evaluate(-210001, 0)
	if err != nil || !ok {
		t.Fatalf("evaluate: ok=%v err=%v", ok, err)
	}
	want := [6]float64{99999950.079648256, 199999900.15929651, 299999850.23894477, 0.12460263522648826, 0.24920527045297652, 0.37380790567946476}
	got := [6]float64{s.Position.X, s.Position.Y, s.Position.Z, s.Velocity.X, s.Velocity.Y, s.Velocity.Z}
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-8*math.Max(1, math.Abs(want[i])) {
			t.Fatalf("component %d got %.17g want %.17g", i, got[i], want[i])
		}
	}
	if s.Center != 0 || s.Frame != 1 || len(k.Segments) == 0 || k.Segments[0].Type != 21 {
		t.Fatalf("unexpected segment: %+v", s)
	}
}

func TestRejectsMalformedSPK(t *testing.T) {
	if _, err := New(make([]byte, 3072)); err == nil {
		t.Fatal("expected malformed header rejection")
	}
}

func TestRepositorySPKFixturesParse(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "tests", "fixtures", "*.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no SPK fixtures found")
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := New(raw); err != nil {
			t.Errorf("%s: %v", filepath.Base(path), err)
		}
	}
}

func FuzzSPKParserNeverPanics(f *testing.F) {
	for _, seed := range [][]byte{nil, make([]byte, 3072), []byte("DAF/SPK")} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, data []byte) {
		_, _ = New(data)
	})
}
