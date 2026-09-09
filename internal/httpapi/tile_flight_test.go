package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type tileFlightResult struct {
	value stateTileCacheValue
	err   error
}

func awaitTileFlight(t *testing.T, result <-chan tileFlightResult) tileFlightResult {
	t.Helper()
	select {
	case value := <-result:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("tile caller did not terminate")
	}
	return tileFlightResult{}
}

func awaitTileJoiners(t *testing.T, cache *stateTileCache, count uint64) {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	ticker := time.NewTicker(time.Millisecond)
	defer timer.Stop()
	defer ticker.Stop()
	for cache.stats()["coalesced"] < count {
		select {
		case <-ticker.C:
		case <-timer.C:
			t.Fatal("tile waiters did not join the active encoding")
		}
	}
}

func TestTileFlightSharesOneImmutableEncodingEvenWhenItCannotBeCached(t *testing.T) {
	// Oversized values still share the active result; they must not bypass the
	// persistent cache budget or force every already-joined waiter to rebuild.
	cache := newStateTileCache(1)
	started, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	var calls atomic.Int64
	build := func() (stateTileCacheValue, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return stateTileCacheValue{raw: []byte("verified-payload"), etag: "hash"}, nil
	}
	result := make(chan tileFlightResult, 13)
	call := func() { v, err := cache.load(context.Background(), "same", build); result <- tileFlightResult{v, err} }
	go call()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("encoder did not start")
	}
	for i := 0; i < 12; i++ {
		go call()
	}
	awaitTileJoiners(t, cache, 12)
	// Use a separate release signal sent through a gate to keep cleanup safe
	// even if an assertion exits early.
	for i := 0; i < 13; i++ {
		if i == 0 {
			release <- struct{}{}
		}
		got := awaitTileFlight(t, result)
		if got.err != nil || string(got.value.raw) != "verified-payload" || got.value.etag != "hash" {
			t.Fatalf("shared response changed: %+v", got)
		}
	}
	if calls.Load() != 1 || cache.stats()["residentBytes"] != 0 || cache.stats()["activeEncodings"] != 0 {
		t.Fatalf("duplicate encode or retained flight/cache: calls%d stats%v", calls.Load(), cache.stats())
	}
}

func TestTileFlightWaiterCancellationDoesNotCancelOwnerOrBlockOtherKeys(t *testing.T) {
	cache := newStateTileCache(1024)
	started, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	owner := make(chan tileFlightResult, 1)
	go func() {
		v, err := cache.load(context.Background(), "a", func() (stateTileCacheValue, error) {
			close(started)
			<-release
			return stateTileCacheValue{raw: []byte("a")}, nil
		})
		owner <- tileFlightResult{v, err}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("encoder did not start")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	waiter := make(chan tileFlightResult, 1)
	go func() {
		v, err := cache.load(ctx, "a", func() (stateTileCacheValue, error) { return stateTileCacheValue{}, errors.New("waiter must not build") })
		waiter <- tileFlightResult{v, err}
	}()
	awaitTileJoiners(t, cache, 1)
	cancel()
	if got := awaitTileFlight(t, waiter); !errors.Is(got.err, context.Canceled) || got.value.raw != nil {
		t.Fatalf("cancelled waiter: %+v", got)
	}
	other, err := cache.load(context.Background(), "b", func() (stateTileCacheValue, error) { return stateTileCacheValue{raw: []byte("b")}, nil })
	if err != nil || string(other.raw) != "b" {
		t.Fatalf("independent key blocked: %v", err)
	}
	release <- struct{}{}
	if got := awaitTileFlight(t, owner); got.err != nil || string(got.value.raw) != "a" {
		t.Fatalf("healthy owner: %+v", got)
	}
	if cache.stats()["activeEncodings"] != 0 {
		t.Fatal("flight retained after completion")
	}
}

func TestTileFlightHealthyWaiterRetriesCancelledOwner(t *testing.T) {
	cache := newStateTileCache(1024)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	owner, waiter := make(chan tileFlightResult, 1), make(chan tileFlightResult, 1)
	go func() {
		v, err := cache.load(ctx, "same", func() (stateTileCacheValue, error) {
			close(started)
			<-ctx.Done()
			return stateTileCacheValue{raw: []byte("discard-me")}, nil
		})
		owner <- tileFlightResult{v, err}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("encoder did not start")
	}
	var retryCalls atomic.Int64
	go func() {
		v, err := cache.load(context.Background(), "same", func() (stateTileCacheValue, error) {
			retryCalls.Add(1)
			return stateTileCacheValue{raw: []byte("healthy")}, nil
		})
		waiter <- tileFlightResult{v, err}
	}()
	awaitTileJoiners(t, cache, 1)
	cancel()
	if got := awaitTileFlight(t, owner); !errors.Is(got.err, context.Canceled) || got.value.raw != nil {
		t.Fatalf("owner cancellation: %+v", got)
	}
	if got := awaitTileFlight(t, waiter); got.err != nil || string(got.value.raw) != "healthy" {
		t.Fatalf("retry: %+v", got)
	}
	if got, ok := cache.peek("same"); !ok || string(got.raw) != "healthy" || retryCalls.Load() != 1 {
		t.Fatal("retry did not replace cancelled result")
	}
}

func TestTileFlightErrorAndPanicReleaseOwnership(t *testing.T) {
	cache := newStateTileCache(1024)
	want := errors.New("invalid source")
	if _, err := cache.load(context.Background(), "a", func() (stateTileCacheValue, error) { return stateTileCacheValue{raw: []byte("partial")}, want }); !errors.Is(err, want) {
		t.Fatal(err)
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Error("encoder panic was swallowed")
			}
		}()
		_, _ = cache.load(context.Background(), "b", func() (stateTileCacheValue, error) { panic("encoder") })
	}()
	if cache.stats()["activeEncodings"] != 0 || cache.stats()["residentBytes"] != 0 {
		t.Fatal("failed encoding retained a cache/flight")
	}
	for _, key := range []string{"a", "b"} {
		if _, err := cache.load(context.Background(), key, func() (stateTileCacheValue, error) { return stateTileCacheValue{raw: []byte("retry")}, nil }); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTileFlightPreCancellationDoesNotReadCacheOrBuild(t *testing.T) {
	cache := newStateTileCache(1024)
	cache.put("a", stateTileCacheValue{raw: []byte("cached")})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, key := range []string{"a", "missing"} {
		value, err := cache.load(ctx, key, func() (stateTileCacheValue, error) {
			t.Error("cancelled caller encoded")
			return stateTileCacheValue{}, nil
		})
		if !errors.Is(err, context.Canceled) || value.raw != nil {
			t.Fatalf("cancelled caller returned %v %v", value, err)
		}
	}
	if cache.stats()["hits"] != 0 || cache.stats()["misses"] != 0 || cache.stats()["activeEncodings"] != 0 {
		t.Fatal("cancelled caller entered cache/admission")
	}
}

func TestHTTPDuplicateTilesJoinWithoutAnotherEncoderSlot(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["unknown"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`)))
	var response statePlanResponse
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &response) != nil {
		t.Fatalf("plan failed: %s", rr.Body.String())
	}
	plan, ok := s.plans.get(response.PlanID)
	if !ok {
		t.Fatal("plan not retained")
	}
	want, err := s.encodeStateTile(context.Background(), plan, 0)
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	owner := make(chan tileFlightResult, 1)
	go func() {
		value, err := s.tiles.load(context.Background(), response.PlanID+":0", func() (stateTileCacheValue, error) {
			close(started)
			<-release
			return want, nil
		})
		owner <- tileFlightResult{value, err}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("owner did not start")
	}
	// Both encoder slots are occupied. A joined request must not allocate or
	// attempt encoder admission; the existing flight is enough to serve it.
	s.tileSlots <- struct{}{}
	s.tileSlots <- struct{}{}
	defer func() { <-s.tileSlots; <-s.tileSlots }()
	server := httptest.NewServer(s)
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	results := make(chan tileFlightResult, 2)
	// Saturate request admission as well as both encoders. Duplicate requests
	// first wait in the bounded interactive queue, then join the existing
	// flight without consuming another encoder slot when admission is released.
	admissionA := holdScheduler(t, s.scheduler)
	admissionB := holdScheduler(t, s.scheduler)
	defer admissionA()
	defer admissionB()
	for i := 0; i < 2; i++ {
		go func() {
			res, err := client.Post(server.URL+"/v1/state/tiles", "application/json", strings.NewReader(`{"planId":"`+response.PlanID+`","sequence":0}`))
			if err != nil {
				results <- tileFlightResult{err: err}
				return
			}
			defer res.Body.Close()
			raw, err := io.ReadAll(res.Body)
			if res.StatusCode != http.StatusOK {
				err = errors.New("duplicate HTTP request did not join encoding")
			}
			results <- tileFlightResult{stateTileCacheValue{raw: raw, etag: res.Header.Get("ETag")}, err}
		}()
	}
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool { return v["interactiveQueued"] == 2 })
	admissionA()
	admissionB()
	awaitTileJoiners(t, s.tiles, 2)
	release <- struct{}{}
	if got := awaitTileFlight(t, owner); got.err != nil {
		t.Fatal(got.err)
	}
	for i := 0; i < 2; i++ {
		got := awaitTileFlight(t, results)
		if got.err != nil || !bytes.Equal(got.value.raw, want.raw) || got.value.etag != want.etag {
			t.Fatalf("HTTP tile changed: %v", got.err)
		}
	}
	if s.TileCacheStats()["activeEncodings"] != 0 {
		t.Fatal("completed HTTP flight retained")
	}
}
