package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestEvaluationReusesCanonicalTargetAndEvidenceWithoutReads(t *testing.T) {
	dir := t.TempDir()
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if err := os.WriteFile(filepath.Join(dir, "test.bsp"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	manifest := fmt.Sprintf(`{"id":"fixture","files":[{"id":"test","path":"test.bsp","targets":[-210001],"bytes":%d,"sha256":"%s"}]}`, len(raw), hex.EncodeToString(sum[:]))
	if err := os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	alias := c.byID["naif:-210001"]
	alias.ID = "alias"
	c.byID[alias.ID] = alias
	states, found, evidence, err := c.EvalBatchContext(context.Background(), []string{"naif:-210001"}, 2451545)
	if err != nil || !found["naif:-210001"] {
		t.Fatalf("%v %v", found, err)
	}
	before := c.ReadStats()
	next, foundNext, proof, err := c.EvalBatchContext(context.Background(), []string{"alias", "naif:-210001"}, 2451545)
	if err != nil || !foundNext["alias"] || next["alias"] != states["naif:-210001"] || proof["alias"] != evidence["naif:-210001"] {
		t.Fatalf("alias or proof drift: %v", err)
	}
	if c.ReadStats() != before || c.EvaluationCacheStats()["hits"] != 2 {
		t.Fatal("warm alias repeated SPK reads")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, _, err := c.EvalBatchContext(ctx, []string{"alias"}, 2451545); err != context.Canceled {
		t.Fatalf("cancelled cache request: %v", err)
	}
	if _, _, _, err := c.EvalBatchContext(context.Background(), []string{"alias"}, 2451545.001); err != nil {
		t.Fatal(err)
	}
	if c.EvaluationCacheStats()["items"] != 2 {
		t.Fatal("distinct epochs shared a cache entry")
	}
}

func TestEvaluationCacheBoundAndClose(t *testing.T) {
	var cache evaluationCache
	for n := 0; n < 100000; n++ {
		cache.put(n, 2451545, evaluationValue{})
	}
	if cache.bytes > evaluationCacheBytes || len(cache.entries) >= 100000 {
		t.Fatal("cache not bounded")
	}
	if _, ok := cache.get(0, 2451545); ok {
		t.Fatal("old entry not evicted")
	}
	cache.close()
	cache.put(1, 2451545, evaluationValue{})
	if _, ok := cache.get(1, 2451545); ok || cache.bytes != 0 {
		t.Fatal("closed cache retained work")
	}
}
