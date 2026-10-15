package inventory

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type blockLoadResult struct {
	block *decodedBlock
	err   error
}

func awaitBlockCoalesced(t *testing.T, cache *blockCache, minimum int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cache.stats()["coalesced"] >= minimum {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("block-cache waiters did not coalesce: %+v", cache.stats())
}

func TestBlockCacheCoalescesConcurrentLoads(t *testing.T) {
	const waiters = 6
	cache := newBlockCache(1024)
	started := make(chan struct{})
	gate := make(chan struct{})
	var closeGate sync.Once
	defer closeGate.Do(func() { close(gate) })
	var calls atomic.Int32
	loader := func(ctx context.Context) (*decodedBlock, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-gate:
			return &decodedBlock{data: []byte("row\n"), starts: []uint32{0, 4}}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	results := make(chan blockLoadResult, waiters)
	for range waiters {
		go func() {
			block, err := cache.load(context.Background(), 7, loader)
			results <- blockLoadResult{block: block, err: err}
		}()
	}
	<-started
	awaitBlockCoalesced(t, cache, waiters-1)
	closeGate.Do(func() { close(gate) })

	var shared *decodedBlock
	for range waiters {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if shared == nil {
			shared = result.block
		} else if shared != result.block {
			t.Fatal("concurrent readers received separate decoded blocks")
		}
	}
	stats := cache.stats()
	if calls.Load() != 1 || stats["loads"] != 1 || stats["entries"] != 1 || stats["coalesced"] != waiters-1 {
		t.Fatalf("unexpected shared-load statistics: calls=%d stats=%+v", calls.Load(), stats)
	}
}

func TestBlockCacheCancelledLoaderYieldsToLiveWaiter(t *testing.T) {
	cache := newBlockCache(1024)
	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	defer cancelLeader()
	started := make(chan struct{})
	var calls atomic.Int32
	loader := func(ctx context.Context) (*decodedBlock, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return &decodedBlock{data: []byte("row\n"), starts: []uint32{0, 4}}, nil
	}
	type result struct {
		block *decodedBlock
		err   error
	}
	leader := make(chan result, 1)
	go func() {
		block, err := cache.load(leaderCtx, 9, loader)
		leader <- result{block: block, err: err}
	}()
	<-started
	waiter := make(chan result, 1)
	go func() {
		block, err := cache.load(context.Background(), 9, loader)
		waiter <- result{block: block, err: err}
	}()
	awaitBlockCoalesced(t, cache, 1)
	cancelLeader()

	if got := <-leader; !errors.Is(got.err, context.Canceled) {
		t.Fatalf("cancelled leader returned %v", got.err)
	}
	if got := <-waiter; got.err != nil || got.block == nil {
		t.Fatalf("live waiter did not take over cancelled load: %+v", got)
	}
	if calls.Load() != 2 || cache.stats()["loads"] != 1 {
		t.Fatalf("live waiter did not perform exactly one replacement load: calls=%d stats=%+v", calls.Load(), cache.stats())
	}
}

func TestBlockCacheCancelledWaiterDoesNotCancelSharedLoader(t *testing.T) {
	cache := newBlockCache(1024)
	started := make(chan struct{})
	gate := make(chan struct{})
	var closeGate sync.Once
	defer closeGate.Do(func() { close(gate) })
	var calls atomic.Int32
	loader := func(ctx context.Context) (*decodedBlock, error) {
		calls.Add(1)
		close(started)
		select {
		case <-gate:
			return &decodedBlock{data: []byte("row\n"), starts: []uint32{0, 4}}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	leader := make(chan blockLoadResult, 1)
	go func() {
		block, err := cache.load(context.Background(), 11, loader)
		leader <- blockLoadResult{block: block, err: err}
	}()
	<-started
	waiterCtx, cancelWaiter := context.WithCancel(context.Background())
	waiter := make(chan blockLoadResult, 1)
	go func() {
		block, err := cache.load(waiterCtx, 11, loader)
		waiter <- blockLoadResult{block: block, err: err}
	}()
	awaitBlockCoalesced(t, cache, 1)
	cancelWaiter()
	if got := <-waiter; !errors.Is(got.err, context.Canceled) {
		t.Fatalf("cancelled waiter returned %v", got.err)
	}
	closeGate.Do(func() { close(gate) })
	if got := <-leader; got.err != nil || got.block == nil {
		t.Fatalf("cancelled waiter interrupted the shared loader: %+v", got)
	}
	if calls.Load() != 1 || cache.stats()["loads"] != 1 {
		t.Fatalf("waiter cancellation duplicated the block read: calls=%d stats=%+v", calls.Load(), cache.stats())
	}
}
