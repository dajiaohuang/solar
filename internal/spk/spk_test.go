package spk

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestType17MatchesIndependentCSPICEOracle(t *testing.T) {
	elements := []float64{123456, 42164, 0.7, 0.55, 1.3, 0.16, 0.21, 2.1e-8, 7.8e-5, -1.7e-8, 0.4, 0.9}
	b := make([]byte, 12*8)
	for i, v := range elements {
		binary.LittleEndian.PutUint64(b[i*8:], math.Float64bits(v))
	}
	k := &Kernel{data: b, little: true}
	seg := Segment{Type: 17, Start: 1, End: 12, type17: true}
	samples := []struct {
		et   float64
		want [6]float64
	}{{-54321, [6]float64{30210.922955799404, -4765.4957694762707, -39194.25936618237, -2.032591204873182, 1.2362274238313566, 1.3673474213543435}}, {123456, [6]float64{20393.58276354703, -21751.677805987736, -865.16545939588286, 3.3092622456729881, -2.1757506595767611, -2.0170740704220966}}, {395430, [6]float64{57714.08204232197, -32873.018374250678, -42600.723477335065, 0.11732693493451804, 0.41104539186566968, -0.75022686216574275}}}
	for _, sample := range samples {
		got, err := k.eval17(seg, sample.et)
		if err != nil {
			t.Fatal(err)
		}
		for i, w := range sample.want {
			if math.Abs(got[i]-w) > 1e-9*math.Max(1, math.Abs(w)) {
				t.Fatalf("et %v component %d got %.17g want %.17g", sample.et, i, got[i], w)
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
