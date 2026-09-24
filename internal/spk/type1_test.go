package spk

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestType1IndependentCSPICEStatesAndBoundedFileReader(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "fixtures", "spk1-synthetic.bsp")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	oracleBytes, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk1-synthetic.json"))
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		KernelSha256 string `json:"kernelSha256"`
		Samples      []struct {
			Target int        `json:"target"`
			ET     float64    `json:"et"`
			State  [6]float64 `json:"state"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(oracleBytes, &oracle); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != oracle.KernelSha256 || len(oracle.Samples) != 408 {
		t.Fatal("unbound or incomplete oracle")
	}
	memory, err := New(raw)
	if err != nil {
		t.Fatal(err)
	}
	lazy, err := OpenWithCache(path, 4096, 16384)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()
	for _, sample := range oracle.Samples {
		var baseline State
		for index, kernel := range []*Kernel{memory, lazy} {
			state, found, err := kernel.EvaluateContext(context.Background(), sample.Target, sample.ET)
			if err != nil || !found {
				t.Fatalf("state %d %g: %v %v", sample.Target, sample.ET, found, err)
			}
			values := [6]float64{state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z}
			for component, actual := range values {
				tolerance := 1e-7
				if component >= 3 {
					tolerance = 1e-14
				}
				if math.Abs(actual-sample.State[component]) > tolerance {
					t.Fatalf("component %d: %.17g != %.17g", component, actual, sample.State[component])
				}
			}
			if index == 0 {
				baseline = state
			} else if state != baseline {
				t.Fatal("paged reader differs from resident reader")
			}
		}
	}
	stats := lazy.ReadStats()
	if stats.CachedBytes > 16384 || lazy.data != nil {
		t.Fatalf("unbounded file reader: %+v", stats)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := lazy.ReadStats()
	state, found, err := lazy.EvaluateContext(ctx, oracle.Samples[0].Target, oracle.Samples[0].ET)
	if !errors.Is(err, context.Canceled) || found || state != (State{}) || lazy.ReadStats() != before {
		t.Fatal("cancelled Type 1 evaluation read or published data")
	}
}

func TestType1RejectsExtendedOrderAndInvalidDirectory(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk1-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := New(raw)
	if err != nil {
		t.Fatal(err)
	}
	segment := kernel.Segments[1]
	for _, change := range []struct {
		address      int
		value        float64
		parseFailure bool
	}{
		{segment.Start + 67, 16, false},
		{segment.Start + 68, 15, false},
		{segment.type21.Epochs + 1, math.Inf(-1), true},
		{segment.type21.Epochs + 101, -1, true},
		{segment.End, 100, true},
	} {
		bad := append([]byte(nil), raw...)
		binary.LittleEndian.PutUint64(bad[(change.address-1)*8:], math.Float64bits(change.value))
		parsed, err := New(bad)
		if change.parseFailure {
			if err == nil {
				t.Fatalf("accepted invalid metadata at %d", change.address)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		state, found, err := parsed.Evaluate(segment.Target, segment.StartET)
		if err == nil || found || state != (State{}) {
			t.Fatalf("accepted invalid order at %d", change.address)
		}
	}
}
