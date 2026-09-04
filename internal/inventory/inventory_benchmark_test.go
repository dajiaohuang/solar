package inventory

import (
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func BenchmarkGetManyVsIndividualGet(b *testing.B) {
	i, ids := benchmarkInventory(b, 510)
	b.Run("individual", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for n := 0; n < b.N; n++ {
			for _, id := range ids {
				if _, found, err := i.Get(context.Background(), id); err != nil || !found {
					b.Fatal(err)
				}
			}
		}
	})
	b.Run("grouped", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for n := 0; n < b.N; n++ {
			rows, err := i.GetMany(context.Background(), ids)
			if err != nil || len(rows) != len(ids) {
				b.Fatalf("rows=%d err=%v", len(rows), err)
			}
		}
	})
}

func benchmarkInventory(b *testing.B, count int) (*Inventory, []string) {
	b.Helper()
	d := b.TempDir()
	f, err := os.Create(filepath.Join(d, "records-00000.jsonl.gz"))
	if err != nil {
		b.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	ids := make([]string, count)
	for n := 0; n < count; n++ {
		id := "sb:benchmark:" + strconv.Itoa(n)
		ids[n] = id
		_, _ = gz.Write([]byte(`{"id":"` + id + `","source":"numbered"}` + "\n"))
	}
	if err := gz.Close(); err != nil {
		b.Fatal(err)
	}
	if err := f.Close(); err != nil {
		b.Fatal(err)
	}
	manifest := `{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":` + strconv.Itoa(count) + `,"shards":[{"file":"records-00000.jsonl.gz","count":` + strconv.Itoa(count) + `,"bytes":0,"sha256":""}]}`
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(strings.TrimSpace(manifest)), 0600); err != nil {
		b.Fatal(err)
	}
	i, err := Load(d)
	if err != nil {
		b.Fatal(err)
	}
	return i, ids
}
