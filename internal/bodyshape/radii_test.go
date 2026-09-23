package bodyshape

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestPinnedRadiiMatchIndependentCSPICE(t *testing.T) {
	raw, err := os.ReadFile("../../src/data/pck00011.tpc")
	if err != nil {
		t.Fatal(err)
	}
	table, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	reference, err := os.ReadFile("../../tests/fixtures/pck-radii-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		SourceSHA256 string
		Bodies       []Radii
	}
	if err := json.Unmarshal(reference, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.SourceSHA256 != SHA256 || table.Count() != 95 || len(fixture.Bodies) != 95 {
		t.Fatal("source/coverage mismatch")
	}
	for _, row := range fixture.Bodies {
		got, ok := table.Get(row.NAIFPCKID)
		if !ok || got.UncertaintyKM != nil {
			t.Fatal("missing shape or invented uncertainty")
		}
		for i, want := range row.RadiiKM {
			if math.Abs(got.RadiiKM[i]-want) > want*2e-15 {
				t.Fatalf("radius mismatch: %d", row.NAIFPCKID)
			}
		}
		got.RadiiKM[0] = -1
		if owned, _ := table.Get(row.NAIFPCKID); owned.RadiiKM[0] <= 0 {
			t.Fatal("caller mutated source table")
		}
	}
	if _, ok := table.Get(1000041); ok {
		t.Fatal("commented-out radii became data")
	}
	if shape, _ := table.Get(901); shape.RadiiKM[0] != 606 {
		t.Fatal("historical Charon radius replaced active source")
	}
	raw[0] ^= 1
	if _, err := Parse(raw); err == nil {
		t.Fatal("accepted changed bytes")
	}
	if _, err := Parse(raw[:10]); err == nil {
		t.Fatal("accepted truncated source")
	}
}
