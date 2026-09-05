package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/spk"
)

func TestCancelledOperationalRequestRejectsBeforeInputPreparation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	catalog := &Catalog{}
	states, found, err := catalog.OperationalStatesContext(ctx, []string{"unknown"}, 2451545)
	if states != nil || found != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled request returned %v %v %v", states, found, err)
	}
}

func TestCancellationDuringKernelOpenDiscardsUnpublishedKernelAndAllowsRetry(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	binding := &kernelBinding{id: "synthetic", path: path, bytes: int64(len(raw)), sha256: hex.EncodeToString(sum[:])}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	previous := openKernelWithCache
	defer func() { openKernelWithCache = previous }()
	var opened *spk.Kernel
	openKernelWithCache = func(path string, pageSize int, maxBytes int64) (*spk.Kernel, error) {
		kernel, err := previous(path, pageSize, maxBytes)
		opened = kernel
		cancel()
		return kernel, err
	}
	kernel, err := binding.kernelFor(ctx, spk.DefaultCacheBytes)
	if kernel != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled open published a kernel: %v %v", kernel, err)
	}
	if binding.kernel != nil || binding.verified || binding.terminalErr != nil || binding.loading || binding.ready != nil {
		t.Fatal("cancelled open poisoned binding state")
	}
	if opened == nil {
		t.Fatal("test did not reach kernel parsing")
	}
	// Path-backed kernels have no persistent file descriptor; Close does not
	// invalidate their immutable state. The binding must release its reference
	// instead of retaining this cancelled loader's cache.
	openKernelWithCache = previous
	kernel, err = binding.kernelFor(context.Background(), spk.DefaultCacheBytes)
	if err != nil || kernel == nil || !binding.verified {
		t.Fatalf("healthy request could not retry: %v", err)
	}
	defer kernel.Close()
	if _, found, err := kernel.Evaluate(-210001, 0); err != nil || !found {
		t.Fatalf("retry did not evaluate the original state: %v %v", found, err)
	}
}

func TestCancelledCenterResolutionDoesNotReturnCachedState(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	catalog := &Catalog{}
	cache := map[operationalCacheKey]operationalCacheEntry{
		{target: 399}: {state: spk.State{Frame: 17}, found: true},
	}
	for _, target := range []int{0, 399} {
		state, found, err := catalog.resolveOperationalCached(ctx, target, 0, nil, "", cache, map[int]bool{})
		if state != (spk.State{}) || found || !errors.Is(err, context.Canceled) {
			t.Fatalf("target%d returned cancelled result: %+v %v %v", target, state, found, err)
		}
	}
}
