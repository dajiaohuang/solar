package inventory

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeAddressableInventory(t testing.TB, dir string, shardRows [][]string) {
	t.Helper()
	m := manifest{SchemaVersion: 2, Purpose: "source-inventory-addressable-v2"}
	for si, rows := range shardRows {
		var file bytes.Buffer
		s := shard{File: fmt.Sprintf("records-%05d.jsonl.bgz", si), Count: len(rows)}
		for start := 0; start < len(rows); start += 128 {
			end := start + 128
			if end > len(rows) {
				end = len(rows)
			}
			raw := []byte(strings.Join(rows[start:end], "\n") + "\n")
			var compressed bytes.Buffer
			gz := gzip.NewWriter(&compressed)
			if _, err := gz.Write(raw); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(compressed.Bytes())
			s.Blocks = append(s.Blocks, block{RowStart: start, Count: end - start, Offset: int64(file.Len()), Bytes: compressed.Len(), UncompressedBytes: len(raw), SHA256: hex.EncodeToString(digest[:])})
			_, _ = file.Write(compressed.Bytes())
		}
		s.Bytes = file.Len()
		digest := sha256.Sum256(file.Bytes())
		s.SHA256 = hex.EncodeToString(digest[:])
		if err := os.WriteFile(filepath.Join(dir, s.File), file.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
		m.Shards = append(m.Shards, s)
		m.TotalRecords += len(rows)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestPagedSourceInventoryPreservesRows(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"sb:asteroid:1","name":"Ceres","identityStatus":"source-designation"}`, `{"id":"sb:comet:2","name":"Halley","identityStatus":"source-designation"}`}})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	rows, next, err := i.Page(context.Background(), "", "", 1)
	if err != nil || len(rows) != 1 || next == "" {
		t.Fatalf("first page rows=%d next=%q err=%v", len(rows), next, err)
	}
	var v map[string]any
	if json.Unmarshal(rows[0], &v) != nil || v["id"] != "sb:asteroid:1" {
		t.Fatalf("row was not preserved: %s", rows[0])
	}
	rows, next, err = i.Page(context.Background(), next, "", 1)
	if err != nil || len(rows) != 1 || next != "" {
		t.Fatalf("second page rows=%d next=%q err=%v", len(rows), next, err)
	}
}

func TestRejectsInventoryPathTraversal(t *testing.T) {
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":2,"purpose":"source-inventory-addressable-v2","totalRecords":1,"shards":[{"file":"../outside.bgz","count":1}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":2,"purpose":"source-inventory-addressable-v2","totalRecords":1,"shards":[{"file":"..","count":1}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil {
		t.Fatal("expected parent-directory rejection")
	}
}

func TestIndexedSearchAndStableDetail(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"sb:asteroid:1","designation":"1","name":"Ceres","category":"dwarf-planet","parentId":"naif:10","identityStatus":"source-designation"}`, `{"id":"sb:asteroid:2","designation":"2","name":"Ceres II","aliases":["Ceres"],"category":"asteroid","parentId":"naif:10","identityStatus":"source-designation"}`, `{"id":"sb:comet:halley","designation":"1P","name":"Halley","category":"comet","identityStatus":"source-designation"}`}})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	rows, next, err := i.Page(context.Background(), "", "Ceres", 1)
	if err != nil || len(rows) != 1 || next == "" {
		t.Fatalf("indexed search rows=%d next=%q err=%v", len(rows), next, err)
	}
	var fields indexFields
	if err := json.Unmarshal(rows[0], &fields); err != nil || fields.Name != "Ceres" {
		t.Fatalf("unexpected indexed row: %s", rows[0])
	}
	if _, _, err := i.Page(context.Background(), next, "Halley", 1); err == nil {
		t.Fatal("expected query-bound cursor rejection")
	}
	if i.HasID("Ceres") {
		t.Fatal("a display name must not count as a source identity")
	}
	if !i.HasID("sb:asteroid:1") {
		t.Fatal("stable source identity was not indexed")
	}
	row, found, err := i.Get(context.Background(), "sb:comet:halley")
	if err != nil || !found || !strings.Contains(string(row), "Halley") {
		t.Fatalf("detail found=%v err=%v row=%s", found, err, row)
	}
}

func TestGetManyGroupsIndexedRowsAndPreservesExactIDs(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"sb:asteroid:1","name":"Ceres"}`, `{"id":"sb:asteroid:2","name":"Pallas"}`}, {`{"id":"sb:comet:halley","name":"Halley"}`}})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := i.GetMany(context.Background(), []string{"sb:asteroid:2", "sb:comet:halley", "unknown"})
	if err != nil || len(rows) != 2 {
		t.Fatalf("GetMany rows=%d err=%v", len(rows), err)
	}
	if !strings.Contains(string(rows["sb:asteroid:2"]), "Pallas") || !strings.Contains(string(rows["sb:comet:halley"]), "Halley") {
		t.Fatalf("GetMany returned wrong rows: %+v", rows)
	}
}

func TestInventoryPageHonoursCancellationDuringRead(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"sb:asteroid:1"}`}})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := i.Page(ctx, "", "", 1); err == nil {
		t.Fatal("expected cancellation error")
	}
	if _, _, err := i.Get(ctx, "sb:asteroid:1"); err == nil {
		t.Fatal("expected cancellation error for detail read")
	}
}

func TestAddressableBlocksCacheOnlyRequestedRanges(t *testing.T) {
	d := t.TempDir()
	rows := make([]string, 300)
	for n := range rows {
		rows[n] = fmt.Sprintf(`{"id":"sb:test:%d","source":"fixture"}`, n)
	}
	writeAddressableInventory(t, d, [][]string{rows})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	if stats := i.BlockCacheStats(); stats["entries"] != 0 || stats["residentBytes"] != 0 {
		t.Fatalf("startup cache was not released: %+v", stats)
	}
	if _, found, err := i.Get(context.Background(), "sb:test:140"); err != nil || !found {
		t.Fatalf("addressed row found=%v err=%v", found, err)
	}
	first := i.BlockCacheStats()
	if first["entries"] != 1 || first["residentBytes"] <= 0 || first["residentBytes"] > first["maxResidentBytes"] {
		t.Fatalf("unexpected first block cache: %+v", first)
	}
	if _, found, err := i.Get(context.Background(), "sb:test:150"); err != nil || !found {
		t.Fatalf("same-block row found=%v err=%v", found, err)
	}
	if same := i.BlockCacheStats(); same["entries"] != 1 {
		t.Fatalf("same block was decoded twice: %+v", same)
	}
	if _, found, err := i.Get(context.Background(), "sb:test:280"); err != nil || !found {
		t.Fatalf("second-block row found=%v err=%v", found, err)
	}
	if second := i.BlockCacheStats(); second["entries"] != 2 || second["residentBytes"] > second["maxResidentBytes"] {
		t.Fatalf("unexpected second block cache: %+v", second)
	}
}

func TestAddressableInventoryRejectsCorruptBlock(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"sb:test:1"}`}})
	path := filepath.Join(d, "records-00000.jsonl.bgz")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-1] ^= 1
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil || !strings.Contains(err.Error(), "hash mismatch") {
		t.Fatalf("expected corrupt block rejection, got %v", err)
	}
}

func FuzzDecodeCursorNeverPanics(f *testing.F) {
	for _, seed := range []string{"", "MDox", "0:0", "../../etc/passwd", "not-base64"} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, token string) {
		_, _, _ = decodeCursor(token)
	})
}
