package inventory

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRejectsDishonestRecordCountsBeforeOpeningShards(t *testing.T) {
	for _, total := range []int{0, 2} {
		d := t.TempDir()
		writeAddressableInventory(t, d, [][]string{{`{"id":"one"}`}})
		path := filepath.Join(d, "manifest.json")
		raw, _ := os.ReadFile(path)
		var m manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		m.TotalRecords = total
		raw, _ = json.Marshal(m)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(filepath.Join(d, m.Shards[0].File)); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(d); err == nil || !strings.Contains(err.Error(), "counts") {
			t.Fatalf("should fail metadata validation before IO: %v", err)
		}
	}
}

func TestRetainedIndexCapacityTracksUniqueTerms(t *testing.T) {
	d := t.TempDir()
	writeAddressableInventory(t, d, [][]string{{`{"id":"one","name":"shared"}`, `{"id":"two","name":"shared"}`}})
	i, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	if cap(i.idx.termKeys) != len(i.idx.termKeys) || cap(i.idx.termStarts) != len(i.idx.termStarts) {
		t.Fatal("index retains unused posting-sized allocation")
	}
	if len(i.search("shared")) != 2 {
		t.Fatal("shared-name postings were lost")
	}
}
