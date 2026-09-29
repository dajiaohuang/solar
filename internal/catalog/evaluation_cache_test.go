package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type evaluationLoadResult struct {
	value evaluationValue
	found bool
	err   error
}

func waitForEvaluationCoalesced(t *testing.T, cache *evaluationCache, count uint64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		cache.mu.Lock()
		coalesced := cache.coalesced
		cache.mu.Unlock()
		if coalesced >= count {
			return
		}
		runtime.Gosched()
	}
	t.Fatal("evaluation request did not join the active computation")
}

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
	admissionStarted, releaseAdmission := make(chan struct{}), make(chan struct{})
	var unblockOnce sync.Once
	unblock := func() { unblockOnce.Do(func() { close(releaseAdmission) }) }
	defer unblock()
	var admissionCalls, admissionReleases atomic.Int32
	admit := func(ctx context.Context) (func(), error) {
		if admissionCalls.Add(1) == 1 {
			close(admissionStarted)
		}
		select {
		case <-releaseAdmission:
			return func() { admissionReleases.Add(1) }, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	coalescedTarget := c.EvaluationCacheStats()["coalesced"] + 1
	admissionResults := make(chan error, 2)
	request := func() {
		_, _, _, err := c.EvalBatchContextWithAdmission(context.Background(), []string{"alias"}, 2451545.0001, "interactive", admit)
		admissionResults <- err
	}
	go request()
	<-admissionStarted
	go request()
	waitForEvaluationCoalesced(t, &c.evaluations, coalescedTarget)
	if admissionCalls.Load() != 1 {
		t.Fatalf("coalesced waiter acquired compute admission: %d calls", admissionCalls.Load())
	}
	unblock()
	for index := 0; index < 2; index++ {
		if err := <-admissionResults; err != nil {
			t.Fatalf("admitted catalog evaluation: %v", err)
		}
	}
	if admissionCalls.Load() != 1 || admissionReleases.Load() != 1 {
		t.Fatalf("compute admission lifecycle: calls=%d releases=%d", admissionCalls.Load(), admissionReleases.Load())
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

func TestEvaluationCacheCoalescesIdenticalInFlightWork(t *testing.T) {
	var cache evaluationCache
	value := evaluationValue{state: State{}, provenance: OperationalProvenance{Source: "fixture"}}
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	releaseWork := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseWork()
	results := make(chan evaluationLoadResult, 2)
	var calls atomic.Int32
	evaluate := func(context.Context) (evaluationValue, bool, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return value, true, nil
	}
	go func() {
		v, found, err := cache.load(context.Background(), -210001, 2451545, "interactive", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	<-started
	go func() {
		v, found, err := cache.load(context.Background(), -210001, 2451545, "interactive", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	waitForEvaluationCoalesced(t, &cache, 1)
	releaseWork()
	for index := 0; index < 2; index++ {
		result := <-results
		if result.err != nil || !result.found || result.value != value {
			t.Fatalf("coalesced result = %+v", result)
		}
	}
	if calls.Load() != 1 || cache.coalesced != 1 || len(cache.flights) != 0 {
		t.Fatalf("duplicate evaluation work: calls=%d stats=%+v", calls.Load(), cache)
	}
}

func TestEvaluationCacheKeepsPriorityScopesIndependent(t *testing.T) {
	var cache evaluationCache
	value := evaluationValue{provenance: OperationalProvenance{Source: "fixture"}}
	started, release := make(chan struct{}, 2), make(chan struct{})
	var releaseOnce sync.Once
	releaseWork := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseWork()
	results := make(chan evaluationLoadResult, 2)
	var calls atomic.Int32
	evaluate := func(context.Context) (evaluationValue, bool, error) {
		calls.Add(1)
		started <- struct{}{}
		<-release
		return value, true, nil
	}
	go func() {
		v, found, err := cache.load(context.Background(), -210001, 2451545, "bulk", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	<-started
	go func() {
		v, found, err := cache.load(context.Background(), -210001, 2451545, "interactive", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	<-started
	releaseWork()
	for index := 0; index < 2; index++ {
		result := <-results
		if result.err != nil || !result.found || result.value != value {
			t.Fatalf("priority-scoped result = %+v", result)
		}
	}
	if calls.Load() != 2 || cache.coalesced != 0 || len(cache.flights) != 0 || len(cache.entries) != 1 {
		t.Fatalf("priority scopes were not isolated: calls=%d stats=%+v", calls.Load(), cache)
	}
}

func TestEvaluationCacheRetriesWhenBuilderRequestIsCanceled(t *testing.T) {
	var cache evaluationCache
	value := evaluationValue{state: State{}, provenance: OperationalProvenance{Source: "fixture"}}
	started := make(chan struct{})
	results := make(chan evaluationLoadResult, 2)
	var calls atomic.Int32
	evaluate := func(ctx context.Context) (evaluationValue, bool, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			return evaluationValue{}, false, ctx.Err()
		}
		return value, true, nil
	}
	leaderContext, cancelLeader := context.WithCancel(context.Background())
	defer cancelLeader()
	go func() {
		v, found, err := cache.load(leaderContext, -210001, 2451545, "interactive", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	<-started
	go func() {
		v, found, err := cache.load(context.Background(), -210001, 2451545, "interactive", evaluate)
		results <- evaluationLoadResult{v, found, err}
	}()
	waitForEvaluationCoalesced(t, &cache, 1)
	cancelLeader()
	var leaderErr error
	var follower evaluationLoadResult
	for index := 0; index < 2; index++ {
		result := <-results
		if result.err == context.Canceled {
			leaderErr = result.err
		} else {
			follower = result
		}
	}
	if leaderErr != context.Canceled || follower.err != nil || !follower.found || follower.value != value || calls.Load() != 2 {
		t.Fatalf("cancel/retry result: leader=%v follower=%+v calls=%d", leaderErr, follower, calls.Load())
	}
}
