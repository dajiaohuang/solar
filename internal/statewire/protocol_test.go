package statewire

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"testing"
)

func testTile(rows int) Tile {
	plan := sha256.Sum256([]byte("plan"))
	catalog := sha256.Sum256([]byte("catalog"))
	metadata := make([]Metadata, rows)
	exact := make([]bool, rows)
	missing := make([]bool, rows)
	states := make([]float64, rows*Stride)
	for n := range metadata {
		metadata[n] = Metadata{ID: "body-" + strconv.Itoa(n), Source: "kernel", DatasetVersion: "v1", DatasetSHA256: hex.EncodeToString(catalog[:]), KernelSHA256: hex.EncodeToString(plan[:]), Model: "spk-original", CenterID: "naif:0", StateEvidence: "kernel"}
		exact[n] = true
	}
	return Tile{Sequence: 0, TileCount: 1, EpochJD: 2451545, FieldMask: FieldState, PlanHash: plan, CatalogManifestHash: catalog, Metadata: metadata, Exact: exact, Approximate: make([]bool, rows), Missing: missing, States: states}
}

func TestEncodeUsesFixedLittleEndianHeaderAndChecksum(t *testing.T) {
	plan := sha256.Sum256([]byte("plan"))
	catalog := sha256.Sum256([]byte("catalog"))
	tile, err := Encode(Tile{
		Sequence: 1, TileCount: 2, OrdinalStart: 9, EpochJD: 2451545.25,
		FieldMask: FieldState, PlanHash: plan, CatalogManifestHash: catalog,
		Metadata: []Metadata{{ID: "earth", Source: "jpl", DatasetVersion: "v1", DatasetSHA256: hex.EncodeToString(catalog[:]), KernelSHA256: hex.EncodeToString(plan[:]), Model: "spk-original", StateEvidence: "kernel"}},
		Exact:    []bool{true}, Approximate: []bool{false}, Missing: []bool{false},
		States: []float64{1, 2, 3, 4, 5, 6},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantMagic := []byte{'S', 'L', 'R', 'T', 'I', 'L', 'E', 0}
	if !bytes.Equal(tile[:8], wantMagic) {
		t.Fatalf("magic=%v want=%v", tile[:8], wantMagic)
	}
	if got := tile[8]; got != 1 || tile[9] != 0 || tile[10] != 200 || tile[11] != 0 {
		t.Fatalf("unexpected version/header bytes: %v", tile[8:12])
	}
	h, err := ParseHeader(tile)
	if err != nil {
		t.Fatal(err)
	}
	metadata := tile[h.MetadataOffset : h.MetadataOffset+h.MetadataLength]
	if len(metadata) == 0 || metadata[len(metadata)-1] != '\n' || bytes.HasPrefix(metadata, []byte("[")) {
		t.Fatalf("metadata is not newline-delimited JSON: %q", metadata)
	}
	if h.Sequence != 1 || h.TileCount != 2 || h.OrdinalStart != 9 || h.RecordCount != 1 || h.Stride != 6 || h.FieldMask != 3 || h.StatesOffset%8 != 0 {
		t.Fatalf("unexpected header: %+v", h)
	}
	if math.Float64frombits(uint64(tile[32])|uint64(tile[33])<<8|uint64(tile[34])<<16|uint64(tile[35])<<24|uint64(tile[36])<<32|uint64(tile[37])<<40|uint64(tile[38])<<48|uint64(tile[39])<<56) != 2451545.25 {
		t.Fatal("epoch is not little endian")
	}
	corrupt := append([]byte(nil), tile...)
	corrupt[len(corrupt)-1] ^= 1
	if _, err := ParseHeader(corrupt); err == nil {
		t.Fatal("expected payload checksum rejection")
	}
	if _, err := ParseHeader(append(tile, 0)); err == nil {
		t.Fatal("expected trailing-byte rejection")
	}
}

func TestParseHeaderRejectsBitmapLengthNotCeilRecordCount(t *testing.T) {
	plan := sha256.Sum256([]byte("plan"))
	catalog := sha256.Sum256([]byte("catalog"))
	tile, err := Encode(Tile{
		Sequence: 0, TileCount: 1, EpochJD: 2451545, FieldMask: FieldState,
		PlanHash: plan, CatalogManifestHash: catalog,
		Metadata: []Metadata{{ID: "earth", Source: "jpl", DatasetVersion: "v1", DatasetSHA256: hex.EncodeToString(catalog[:]), KernelSHA256: hex.EncodeToString(plan[:]), Model: "spk-original", StateEvidence: "kernel"}},
		Exact:    []bool{true}, Approximate: []bool{false}, Missing: []bool{false}, States: make([]float64, 6),
	})
	if err != nil {
		t.Fatal(err)
	}
	binary.LittleEndian.PutUint32(tile[52:56], 2)
	if _, err := ParseHeader(tile); err == nil {
		t.Fatal("expected bitmap length rejection")
	}
}

func TestEncodeRejectsBitmapOverlapAndNonFiniteState(t *testing.T) {
	base := Tile{Sequence: 0, TileCount: 1, FieldMask: FieldState, EpochJD: 1, Metadata: []Metadata{{ID: "x", Source: "test", DatasetVersion: "v1", DatasetSHA256: strings.Repeat("a", 64), KernelSHA256: strings.Repeat("b", 64), Model: "spk-original", StateEvidence: "kernel"}}, Exact: []bool{true}, Approximate: []bool{false}, Missing: []bool{false}, States: make([]float64, 6)}
	base.Approximate[0] = true
	if _, err := Encode(base); err == nil {
		t.Fatal("expected overlapping bitmap rejection")
	}
	base.Approximate[0] = false
	base.States[0] = math.NaN()
	if _, err := Encode(base); err == nil {
		t.Fatal("expected nonfinite state rejection")
	}
}

func TestEncodeLimitedRejectsConservativeBudgetAndEscapedMetadata(t *testing.T) {
	tile := testTile(1)
	full, err := Encode(tile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := EncodeLimited(tile, int64(len(full)-1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected budget rejection, got %v", err)
	}
	escaped := testTile(1)
	escaped.Metadata[0].Source = strings.Repeat("\x00", 1024)
	if _, err := EncodeLimited(escaped, 4096); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected escaped metadata budget rejection, got %v", err)
	}
}

func TestEncodeLimitedPreservesWireBytes(t *testing.T) {
	tile := testTile(2)
	want, err := Encode(tile)
	if err != nil {
		t.Fatal(err)
	}
	got, err := EncodeLimited(tile, int64(len(want)+4096))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("limited encoding changed canonical wire bytes")
	}
}

func TestMetadataUpperBoundCoversJSONEscaping(t *testing.T) {
	rows := []Metadata{{ID: "<body>\x00\"", Source: "太阳\\kernel", DatasetVersion: "v1", DatasetSHA256: strings.Repeat("a", 64), KernelSHA256: strings.Repeat("b", 64), Model: "spk-original", CenterID: "naif:0", StateEvidence: "kernel", MissingReason: "", IdentityStatus: "verified"}}
	bound, err := metadataUpperBound(rows)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(rows[0])
	if err != nil {
		t.Fatal(err)
	}
	if bound < int64(len(raw)+1) {
		t.Fatalf("metadata bound=%d is below encoded row=%d", bound, len(raw)+1)
	}
}

func BenchmarkEncodeLimited32K(b *testing.B) {
	tile := testTile(MaxRows)
	b.ReportAllocs()
	b.ResetTimer()
	for n := 0; n < b.N; n++ {
		if _, err := EncodeLimited(tile, 64<<20); err != nil {
			b.Fatal(err)
		}
	}
}
