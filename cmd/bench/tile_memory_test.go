package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

func TestTileMemoryProbeDistinctSingleTilesAndColdCache(t *testing.T) {
	for _, concurrency := range []int{1, 4} {
		t.Run(fmt.Sprint(concurrency), func(t *testing.T) {
			c, err := catalog.Load("../../src/data")
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			service := httpapi.New(c, concurrency)
			server := httptest.NewServer(service)
			defer server.Close()
			rows := 64
			if concurrency == 1 {
				rows = statewire.MaxRows // guard the actual single-32K-tile contract
			}
			ids := make([]string, rows)
			for n := range ids {
				// Missing test identities, never fabricated exact states.
				ids[n] = fmt.Sprintf("probe-unknown:%d", n)
			}
			evidence, err := runTileMemoryProbe(service, server.Client(), server.URL, ids, 2461287.5, concurrency)
			if err != nil {
				t.Fatal(err)
			}
			if evidence.RowsPerTile != len(ids) || evidence.DistinctPlans != concurrency || len(evidence.Results) != concurrency || evidence.EncoderLimit != 2 || evidence.SampledPeakEncoderSlots > 2 || evidence.PlanCacheBefore["items"] != uint64(concurrency) {
				t.Fatalf("invalid dimensions: %+v", evidence)
			}
			if evidence.TileCacheBefore["items"] != 0 || evidence.TileCacheAfter["items"] != uint64(concurrency) || evidence.TileCacheAfter["activeEncodings"] != 0 || evidence.TileCacheAfter["encoderSlotsActive"] != 0 {
				t.Fatalf("cache/slot leak: %+v", evidence)
			}
			seen := make(map[string]bool)
			for _, result := range evidence.Results {
				if seen[result.PlanID] || result.RecordCount != uint32(len(ids)) || result.ExactCount != 0 || result.MissingCount != len(ids) || len(result.PayloadSHA256) != 64 || result.Bytes <= statewire.HeaderSize || result.Attempts < 1 {
					t.Fatalf("invalid tile result: %+v", result)
				}
				seen[result.PlanID] = true
			}
			if evidence.Samples == 0 || evidence.SampledPeakRSSBytes < evidence.BaselineRSSBytes || evidence.SampledPeakHeapBytes < evidence.BaselineHeapBytes || evidence.TotalAllocationBytes == 0 || evidence.SampleIntervalNs != int64(2*time.Millisecond) {
				t.Fatalf("missing phase samples: %+v", evidence)
			}
			if evidence.RSSIncrementBoundAvailable && evidence.RSSIncrementUpperBoundBytes < evidence.SampledRSSIncrementBytes {
				t.Fatal("OS upper bound is less than sampled increment")
			}
			if !evidence.RSSIncrementBoundAvailable && evidence.RSSIncrementUpperBoundBytes != 0 {
				t.Fatal("unsupported OS peak inferred from ordinary RSS")
			}
			raw, err := json.Marshal(evidence)
			if err != nil || !strings.Contains(string(raw), "server and loopback client") || !strings.Contains(string(raw), "2ms samples can miss peaks") {
				t.Fatal("measurement scope omitted")
			}
			if _, err := runTileMemoryProbe(service, server.Client(), server.URL, ids, 2461287.5, concurrency); err == nil || !strings.Contains(err.Error(), "cold tile cache") {
				t.Fatalf("warm tile cache accepted: %v", err)
			}
		})
	}
}

func TestTileMemoryProbeRejectsUnsupportedDimensionsBeforeHTTP(t *testing.T) {
	for _, concurrency := range []int{0, 5} {
		if _, err := runTileMemoryProbe(nil, nil, "", []string{"a"}, 1, concurrency); err == nil {
			t.Fatal("unsupported client count accepted")
		}
	}
	if _, err := runTileMemoryProbe(nil, nil, "", []string{"a"}, 1, 4); err == nil {
		t.Fatal("duplicate rotations accepted")
	}
}

func TestTileMemoryProbeRejectsSplitPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(tileProbePlan{PlanID: strings.Repeat("a", 64), BodyCount: 8, TileSize: 4, TileCount: 2, MissingCount: 8})
	}))
	defer server.Close()
	ids := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	if _, err := runTileMemoryProbe(nil, server.Client(), server.URL, ids, 1, 1); err == nil || !strings.Contains(err.Error(), "single-tile") {
		t.Fatalf("two half-tiles accepted as one tile: %v", err)
	}
}

func TestTileProbeChecksPayloadAndPlanCounts(t *testing.T) {
	hash, _ := statewire.ParseHash(strings.Repeat("a", 64))
	valid, err := statewire.Encode(statewire.Tile{TileCount: 1, EpochJD: 1, FieldMask: statewire.FieldState, PlanHash: hash, CatalogManifestHash: hash,
		Metadata: []statewire.Metadata{{ID: "unknown", MissingReason: "unknown-identity"}}, Exact: []bool{false}, Approximate: []bool{false}, Missing: []bool{true}, States: make([]float64, 6)})
	if err != nil {
		t.Fatal(err)
	}
	for _, corruption := range []string{"checksum", "plan-count", "plan-identity"} {
		t.Run(corruption, func(t *testing.T) {
			raw := append([]byte(nil), valid...)
			plan := tileProbePlan{PlanID: statewire.HashHex(hash), CatalogManifestSHA256: statewire.HashHex(hash), BodyCount: 1, TileCount: 1, TileSize: 1, MissingCount: 1}
			switch corruption {
			case "checksum":
				raw[len(raw)-1] ^= 1
			case "plan-count":
				plan.MissingCount, plan.ExactCount = 0, 1
			case "plan-identity":
				plan.PlanID = strings.Repeat("b", 64)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(raw) }))
			defer server.Close()
			if _, err := fetchProbeTile(context.Background(), server.Client(), server.URL, plan, 1); err == nil {
				t.Fatal("invalid tile accepted")
			}
		})
	}
}

func TestTileProbeRetryWaitHonorsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "1")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	result, err := fetchProbeTile(ctx, server.Client(), server.URL, tileProbePlan{PlanID: "probe"}, 1)
	if !errors.Is(err, context.DeadlineExceeded) || result.Rejected429 != 1 || result.Attempts != 1 {
		t.Fatalf("retry cancellation: result=%+v err=%v", result, err)
	}
}
