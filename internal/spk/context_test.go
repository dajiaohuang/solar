package spk

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func contextFixture(t *testing.T) (*Kernel, []byte) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	k, err := New(raw)
	if err != nil {
		t.Fatal(err)
	}
	return k, raw
}

func TestCancelledEvaluationDoesNotReadOrPublish(t *testing.T) {
	k, _ := contextFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := k.ReadStats()
	state, found, err := k.EvaluateContext(ctx, -210001, 0)
	if !errors.Is(err, context.Canceled) || found || state != (State{}) {
		t.Fatalf("cancelled evaluation published state: %+v %v %v", state, found, err)
	}
	if k.ReadStats() != before || k.ctx != nil {
		t.Fatal("cancelled evaluation changed shared kernel state")
	}
}

type cancelReader struct {
	*bytes.Reader
	cancel context.CancelFunc
	reads  int
}

func (r *cancelReader) ReadAt(dst []byte, off int64) (int, error) {
	r.reads++
	n, err := r.Reader.ReadAt(dst, off)
	r.cancel()
	return n, err
}

func TestCancellationDuringPageReadStopsFurtherIO(t *testing.T) {
	k, raw := contextFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader := &cancelReader{Reader: bytes.NewReader(raw), cancel: cancel}
	k.data = nil
	k.source = newPageSource(reader, int64(len(raw)), nil, 1024, 1024)
	state, found, err := k.EvaluateContext(ctx, -210001, 0)
	if !errors.Is(err, context.Canceled) || found || state != (State{}) {
		t.Fatalf("read cancellation returned %+v %v %v", state, found, err)
	}
	if reader.reads != 1 {
		t.Fatalf("performed %d page reads after cancellation", reader.reads)
	}
	if k.ctx != nil {
		t.Fatal("request context leaked into shared kernel")
	}
	// The cancelled caller must not poison the shared kernel/cache for reuse.
	if _, found, err := k.Evaluate(-210001, 0); !found || err != nil {
		t.Fatalf("healthy request cannot reuse kernel: %v %v", found, err)
	}
}

// A context that deterministically cancels at an observed cooperative checkpoint;
// it avoids wall-clock timing assumptions in scan/coefficient-loop tests.
type checkpointContext struct {
	context.Context
	cancel    context.CancelFunc
	remaining atomic.Int64
}

func newCheckpointContext(checks int64) *checkpointContext {
	ctx, cancel := context.WithCancel(context.Background())
	c := &checkpointContext{Context: ctx, cancel: cancel}
	c.remaining.Store(checks)
	return c
}

func (c *checkpointContext) Err() error {
	if c.remaining.Add(-1) <= 0 {
		c.cancel()
	}
	return c.Context.Err()
}

func TestCancellationInterruptsDescriptorScanAndLargeChebyshevLoop(t *testing.T) {
	ctx := newCheckpointContext(3)
	defer ctx.cancel()
	k := &Kernel{Segments: make([]Segment, 100_000)}
	if _, found, err := k.EvaluateContext(ctx, 123, 0); found || !errors.Is(err, context.Canceled) {
		t.Fatalf("descriptor scan ignored cancellation: %v %v", found, err)
	}
	coefficients := newCheckpointContext(4)
	defer coefficients.cancel()
	polynomial := &Kernel{data: make([]byte, 100_000*8), little: true, ctx: coefficients}
	if _, err := polynomial.cheb(1, 100_000, 0.25); !errors.Is(err, context.Canceled) {
		t.Fatalf("coefficient loop ignored cancellation: %v", err)
	}
}

func TestContextEvaluationPreservesFixtureStateBitsAtWindowBoundaries(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "tests", "fixtures", "*.bsp"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("missing fixtures: %v", err)
	}
	checked := 0
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		kernel, err := New(raw)
		if err != nil {
			t.Fatal(err)
		}
		for _, segment := range kernel.Segments {
			for _, et := range []float64{segment.StartET, segment.StartET/2 + segment.EndET/2, segment.EndET} {
				want, found, err := kernel.Evaluate(segment.Target, et)
				got, contextFound, contextErr := kernel.EvaluateContext(context.Background(), segment.Target, et)
				if (err != nil) != (contextErr != nil) || found != contextFound {
					t.Fatalf("%s target%d ET%g result changed", path, segment.Target, et)
				}
				if err != nil || !found {
					continue
				}
				checked++
				a := [6]float64{want.Position.X, want.Position.Y, want.Position.Z, want.Velocity.X, want.Velocity.Y, want.Velocity.Z}
				b := [6]float64{got.Position.X, got.Position.Y, got.Position.Z, got.Velocity.X, got.Velocity.Y, got.Velocity.Z}
				for i := range a {
					if math.Float64bits(a[i]) != math.Float64bits(b[i]) {
						t.Fatalf("%s target%d ET%g component%d changed", path, segment.Target, et, i)
					}
				}
				if want.Center != got.Center || want.Frame != got.Frame {
					t.Fatal("scientific center/frame changed")
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no states were compared")
	}
	t.Logf("Compared %d fixture states at descriptor start/mid/end epochs", checked)
}

func TestConcurrentCancellationDoesNotLeakAcrossEvaluations(t *testing.T) {
	k, _ := contextFixture(t)
	want, _, err := k.Evaluate(-210001, 0)
	if err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	for i := 0; i < 16; i++ {
		workers.Add(1)
		go func(cancelled bool) {
			defer workers.Done()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if cancelled {
				cancel()
			}
			for n := 0; n < 20; n++ {
				state, found, err := k.EvaluateContext(ctx, -210001, 0)
				if cancelled {
					if found || !errors.Is(err, context.Canceled) {
						t.Errorf("cancelled caller returned %v %v", found, err)
					}
				} else if err != nil || !found || state != want {
					t.Errorf("healthy caller changed: %+v %v %v", state, found, err)
				}
			}
		}(i%2 == 0)
	}
	workers.Wait()
	if k.ctx != nil {
		t.Fatal("shared kernel retained a request context")
	}
}

// Keep checkpoint overhead measurable separately from cold kernel parsing and
// filesystem IO. These small resident fixtures are not a whole-catalog benchmark.
func BenchmarkEvaluationCancellationCheckpoints(b *testing.B) {
	for _, name := range []string{"spk21-synthetic.bsp", "spk21-horizons-eris.bsp"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", name))
		if err != nil {
			b.Fatal(err)
		}
		kernel, err := New(raw)
		if err != nil {
			b.Fatal(err)
		}
		segment := kernel.Segments[0]
		et := segment.StartET/2 + segment.EndET/2
		for _, cancellable := range []bool{false, true} {
			mode := "plain"
			if cancellable {
				mode = "cancellable"
			}
			b.Run(name+"/"+mode, func(b *testing.B) {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					var found bool
					var err error
					if cancellable {
						_, found, err = kernel.EvaluateContext(ctx, segment.Target, et)
					} else {
						_, found, err = kernel.Evaluate(segment.Target, et)
					}
					if err != nil || !found {
						b.Fatalf("evaluation failed: %v %v", found, err)
					}
				}
			})
		}
	}
}
