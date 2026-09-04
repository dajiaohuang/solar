package inventory

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(`{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":2,"shards":[{"file":"records-00000.jsonl.gz","count":2,"bytes":1,"sha256":""}]}`), 0600); err != nil {
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
}

func FuzzDecodeCursorNeverPanics(f *testing.F) {
	for _, seed := range []string{"", "MDox", "0:0", "../../etc/passwd", "not-base64"} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, token string) {
		_, _, _ = decodeCursor(token)
	})
}
