package inventory

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPagedSourceInventoryPreservesRows(t *testing.T) {
	d := t.TempDir()
	shard := filepath.Join(d, "records-00000.jsonl.gz")
	f, err := os.Create(shard)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	_, _ = gz.Write([]byte(`{"id":"sb:asteroid:1","name":"Ceres","identityStatus":"source-designation"}` + "\n" + `{"id":"sb:comet:2","name":"Halley","identityStatus":"source-designation"}` + "\n"))
	_ = gz.Close()
	_ = f.Close()
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":2,"shards":[{"file":"records-00000.jsonl.gz","count":2,"bytes":0,"sha256":""}]}`), 0600); err != nil {
		t.Fatal(err)
	}
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
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":1,"shards":[{"file":"../outside.gz","count":1}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":1,"shards":[{"file":"..","count":1}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil {
		t.Fatal("expected parent-directory rejection")
	}
}

func TestIndexedSearchAndStableDetail(t *testing.T) {
	d := t.TempDir()
	path := filepath.Join(d, "records-00000.jsonl.gz")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	_, _ = gz.Write([]byte(`{"id":"sb:asteroid:1","designation":"1","name":"Ceres","category":"dwarf-planet","parentId":"naif:10","identityStatus":"source-designation"}` + "\n" + `{"id":"sb:asteroid:2","designation":"2","name":"Ceres II","aliases":["Ceres"],"category":"asteroid","parentId":"naif:10","identityStatus":"source-designation"}` + "\n" + `{"id":"sb:comet:halley","designation":"1P","name":"Halley","category":"comet","identityStatus":"source-designation"}` + "\n"))
	_ = gz.Close()
	_ = f.Close()
	manifest := `{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":3,"shards":[{"file":"records-00000.jsonl.gz","count":3,"bytes":0,"sha256":""}]}`
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
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
	for n, rows := range [][]string{{`{"id":"sb:asteroid:1","name":"Ceres"}`, `{"id":"sb:asteroid:2","name":"Pallas"}`}, {`{"id":"sb:comet:halley","name":"Halley"}`}} {
		path := filepath.Join(d, []string{"records-00000.jsonl.gz", "records-00001.jsonl.gz"}[n])
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		gz := gzip.NewWriter(f)
		for _, row := range rows {
			_, _ = gz.Write([]byte(row + "\n"))
		}
		_ = gz.Close()
		_ = f.Close()
	}
	manifest := `{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":3,"shards":[{"file":"records-00000.jsonl.gz","count":2,"bytes":0,"sha256":""},{"file":"records-00001.jsonl.gz","count":1,"bytes":0,"sha256":""}]}`
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
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
	path := filepath.Join(d, "records-00000.jsonl.gz")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	_, _ = gz.Write([]byte(`{"id":"sb:asteroid:1"}` + "\n"))
	_ = gz.Close()
	_ = f.Close()
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":1,"shards":[{"file":"records-00000.jsonl.gz","count":1,"bytes":0,"sha256":""}]}`), 0600); err != nil {
		t.Fatal(err)
	}
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

func FuzzDecodeCursorNeverPanics(f *testing.F) {
	for _, seed := range []string{"", "MDox", "0:0", "../../etc/passwd", "not-base64"} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, token string) {
		_, _, _ = decodeCursor(token)
	})
}
