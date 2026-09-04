package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadManifestRetainsSourceOnlyTargets(t *testing.T) {
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(`{"id":"test-v1","files":[{"id":"k","path":"not-present.bsp","targets":[12345],"startEt":1,"endEt":2}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := c.Get("naif:12345")
	if !ok || b.Availability != Missing || b.MissingReason != "kernel-not-packaged" {
		t.Fatalf("unexpected source-only body: %+v", b)
	}
}

func TestPageIsStableAndBounded(t *testing.T) {
	c, err := Load(filepath.Join("..", "..", "src", "data"))
	if err != nil {
		t.Fatal(err)
	}
	p := c.Page("", 0, 3)
	if len(p) != 3 {
		t.Fatalf("got %d", len(p))
	}
	if p[0].ID > p[1].ID || p[1].ID > p[2].ID {
		t.Fatalf("page is not sorted: %+v", p)
	}
}

func TestOperationalStateUsesPackagedSPKAndCenterPool(t *testing.T) {
	d := t.TempDir()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "synthetic.bsp"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"spk-test","profile":"full","contract":"Original SPK types 2/3/17/21","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"]}]}`
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := c.Get("naif:-210001")
	if !ok || b.Availability != AvailableOperational {
		t.Fatalf("expected operational body: %+v", b)
	}
	state, found, err := c.OperationalState("naif:-210001", 2451545)
	if err != nil || !found {
		t.Fatalf("state found=%v err=%v", found, err)
	}
	if state.Position.X < 99999949 || state.Position.X > 99999951 {
		t.Fatalf("unexpected operational state: %+v", state)
	}
}
