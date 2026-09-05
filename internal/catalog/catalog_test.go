package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestLoadRejectsPackagedKernelWithManifestIdentityMismatch(t *testing.T) {
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "bad.bsp"), []byte("not-a-kernel"), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"test-v1","files":[{"id":"bad","path":"bad.bsp","targets":[12345],"bytes":12,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}`
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := c.Get("naif:12345")
	if !ok || b.Availability != Missing || b.MissingReason != "kernel-invalid" {
		t.Fatalf("unexpected invalid packaged body: %+v", b)
	}
}

func TestLoadRejectsPackagedKernelWithoutManifestIdentity(t *testing.T) {
	d := t.TempDir()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "synthetic.bsp"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(`{"id":"test-v1","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001]}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := c.Get("naif:-210001")
	if !ok || b.Availability != Missing || b.MissingReason != "kernel-unverified" {
		t.Fatalf("unexpected unverified packaged body: %+v", b)
	}
}

func TestLoadNeverReadsKernelOutsideDataDirectory(t *testing.T) {
	d := t.TempDir()
	outsideDir := t.TempDir()
	outside := filepath.Join(outsideDir, "outside-kernel.bsp")
	if err := os.WriteFile(outside, []byte("not-a-kernel"), 0600); err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(d, outside)
	if err != nil || !strings.HasPrefix(relative, "..") {
		t.Fatalf("fixture is not outside data directory: %q %v", relative, err)
	}
	manifest := fmt.Sprintf(`{"id":"test-v1","files":[{"id":"escape","path":%q,"targets":[12345],"bytes":12,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}`, filepath.ToSlash(relative))
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := c.Get("naif:12345")
	if !ok || b.Availability != Missing || b.MissingReason != "kernel-not-packaged" {
		t.Fatalf("escaped kernel became available: %+v", b)
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
	sum := sha256.Sum256(fixture)
	wantHash := hex.EncodeToString(sum[:])
	manifest := fmt.Sprintf(`{"id":"spk-test","profile":"full","contract":"Original SPK types 2/3/17/21","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(fixture), hex.EncodeToString(sum[:]))
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
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
	batch, foundBatch, err := c.OperationalStates([]string{"naif:-210001"}, 2451545)
	if err != nil || !foundBatch["naif:-210001"] {
		t.Fatalf("batch state found=%v err=%v", foundBatch, err)
	}
	if batch["naif:-210001"] != state {
		t.Fatalf("single/batch mismatch: single=%+v batch=%+v", state, batch["naif:-210001"])
	}
	provenance, provenanceFound, err := c.OperationalProvenance("naif:-210001", 2451545)
	if err != nil || !provenanceFound {
		t.Fatalf("operational provenance found=%v err=%v", provenanceFound, err)
	}
	if provenance.Source != "synthetic" || provenance.KernelSHA256 != wantHash || provenance.CenterID != "naif:0" || !provenance.ValidityPresent || provenance.ValidityStartET != 0 || provenance.ValidityEndET != 1000 {
		t.Fatalf("unexpected operational provenance: %+v", provenance)
	}
}
