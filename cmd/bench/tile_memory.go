package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

type tileProbePlan struct {
	PlanID                  string `json:"planId"`
	CatalogManifestSHA256   string `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string `json:"inventoryManifestSha256"`
	BodyCount               int    `json:"bodyCount"`
	TileSize                int    `json:"tileSize"`
	TileCount               int    `json:"tileCount"`
	ExactCount              int    `json:"exactCount"`
	ApproximateCount        int    `json:"approximateCount"`
	MissingCount            int    `json:"missingCount"`
}

type tileProbeResult struct {
	PlanID        string `json:"planId"`
	Attempts      int    `json:"attempts"`
	Rejected429   int    `json:"rejected429"`
	Bytes         int    `json:"bytes"`
	RecordCount   uint32 `json:"recordCount"`
	ExactCount    int    `json:"exactCount"`
	MissingCount  int    `json:"missingCount"`
	PayloadSHA256 string `json:"payloadSha256"`
	LatencyNs     int64  `json:"latencyIncludingRetriesNs"`
}

type tileMemoryEvidence struct {
	Scope                       string            `json:"scope"`
	RowsPerTile                 int               `json:"rowsPerTile"`
	ConcurrentClients           int               `json:"concurrentClients"`
	DistinctPlans               int               `json:"distinctPlans"`
	EncoderLimit                int               `json:"encoderLimit"`
	SampledPeakEncoderSlots     uint64            `json:"sampledPeakEncoderSlots"`
	PlanPreparationNs           int64             `json:"planPreparationNs"`
	PhaseNs                     int64             `json:"phaseNs"`
	SampleIntervalNs            int64             `json:"sampleIntervalNs"`
	Samples                     int               `json:"samples"`
	BaselineRSSBytes            uint64            `json:"baselineRSSBytes"`
	SampledPeakRSSBytes         uint64            `json:"sampledPeakRSSBytes"`
	SampledRSSIncrementBytes    uint64            `json:"sampledRSSIncrementBytes"`
	BaselineHeapBytes           uint64            `json:"baselineHeapBytes"`
	SampledPeakHeapBytes        uint64            `json:"sampledPeakHeapBytes"`
	TotalAllocationBytes        uint64            `json:"totalAllocationBytes"`
	LifetimePeakRSSBytes        uint64            `json:"lifetimePeakRSSBytes"`
	RSSIncrementUpperBoundBytes uint64            `json:"rssIncrementUpperBoundBytes"`
	RSSIncrementBoundAvailable  bool              `json:"rssIncrementBoundAvailable"`
	TileCacheBefore             map[string]uint64 `json:"tileCacheBefore"`
	TileCacheAfter              map[string]uint64 `json:"tileCacheAfter"`
	PlanCacheBefore             map[string]uint64 `json:"planCacheBefore"`
	Results                     []tileProbeResult `json:"results"`
}

// This phase intentionally includes the loopback client's wire buffer and hash
// checking, not only the Go server. An OS lifetime peak minus the phase baseline
// is a conservative upper bound: earlier startup/plan peaks can overestimate it.
// Polling RSS alone cannot establish a hard peak bound.
func runTileMemoryProbe(service *httpapi.Server, client *http.Client, base string, ids []string, epoch float64, concurrency int) (tileMemoryEvidence, error) {
	if concurrency < 1 || concurrency > 4 || len(ids) < concurrency || len(ids) > statewire.MaxRows {
		return tileMemoryEvidence{}, fmt.Errorf("tile probe needs 1..4 clients and distinct nonempty ID rotations within one tile")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	start := time.Now()
	plans := make([]tileProbePlan, concurrency)
	seen := make(map[string]bool, concurrency)
	for n := range plans {
		rotated := append(append(make([]string, 0, len(ids)), ids[n:]...), ids[:n]...)
		payload, err := json.Marshal(map[string]any{"ids": rotated, "epochJd": epoch, "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": []string{"position", "velocity"}, "tileSize": len(ids)})
		if err != nil {
			return tileMemoryEvidence{}, err
		}
		raw, _, status, err := tileProbeHTTP(ctx, client, base+"/v1/state/plan", string(payload))
		if err != nil || status != http.StatusOK {
			return tileMemoryEvidence{}, fmt.Errorf("prepare plan %d: status=%d error=%v", n, status, err)
		}
		if err := json.Unmarshal(raw, &plans[n]); err != nil {
			return tileMemoryEvidence{}, err
		}
		p := plans[n]
		if p.PlanID == "" || seen[p.PlanID] || p.BodyCount != len(ids) || p.TileCount != 1 || p.TileSize != len(ids) || p.ApproximateCount != 0 || p.ExactCount < 0 || p.MissingCount < 0 || p.ExactCount+p.MissingCount != len(ids) {
			return tileMemoryEvidence{}, fmt.Errorf("plan %d is not a distinct, single-tile exact/missing plan", n)
		}
		seen[p.PlanID] = true
	}
	evidence := tileMemoryEvidence{Scope: "warm distinct plans, cold tile cache; one tile per plan; server and loopback client/hash buffers in the same process; GC before baseline; 2ms samples can miss peaks; lifetime OS high-water gives a conservative increment upper bound including earlier phases; not a first-use kernel or renderer benchmark",
		RowsPerTile: len(ids), ConcurrentClients: concurrency, DistinctPlans: len(plans), EncoderLimit: 2, PlanPreparationNs: time.Since(start).Nanoseconds(),
		SampleIntervalNs: int64(2 * time.Millisecond), TileCacheBefore: service.TileCacheStats(), PlanCacheBefore: service.PlanCacheStats(), Results: make([]tileProbeResult, concurrency)}
	if evidence.TileCacheBefore["items"] != 0 || evidence.TileCacheBefore["activeEncodings"] != 0 {
		return evidence, fmt.Errorf("tile probe requires a cold tile cache")
	}
	if evidence.PlanCacheBefore["items"] != uint64(concurrency) {
		return evidence, fmt.Errorf("tile probe requires exactly its distinct prepared plans to be resident")
	}
	evidence.EncoderLimit = int(evidence.TileCacheBefore["encoderSlotsLimit"])
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	evidence.BaselineRSSBytes, evidence.BaselineHeapBytes = processRSSBytes(), before.HeapAlloc
	peak := newPeak()
	peak.rss, peak.heap = evidence.BaselineRSSBytes, evidence.BaselineHeapBytes
	stop, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(2 * time.Millisecond)
		defer ticker.Stop()
		sample := func() {
			peak.Sample()
			if slots := service.TileCacheStats()["encoderSlotsActive"]; slots > evidence.SampledPeakEncoderSlots {
				evidence.SampledPeakEncoderSlots = slots
			}
			evidence.Samples++
		}
		for {
			select {
			case <-ticker.C:
				sample()
			case <-stop:
				sample()
				return
			}
		}
	}()
	phaseStart := time.Now()
	gate := make(chan struct{})
	errorsCh := make(chan error, concurrency)
	var wg sync.WaitGroup
	for n, plan := range plans {
		wg.Add(1)
		go func(n int, plan tileProbePlan) {
			defer wg.Done()
			<-gate
			result, err := fetchProbeTile(ctx, client, base, plan, epoch)
			evidence.Results[n] = result
			if err != nil {
				errorsCh <- err
			}
		}(n, plan)
	}
	close(gate)
	wg.Wait()
	close(stop)
	<-stopped
	evidence.PhaseNs = time.Since(phaseStart).Nanoseconds()
	runtime.ReadMemStats(&after)
	evidence.SampledPeakRSSBytes, evidence.SampledPeakHeapBytes = peak.rss, peak.heap
	evidence.SampledRSSIncrementBytes = nonNegativeDelta(peak.rss, evidence.BaselineRSSBytes)
	evidence.TotalAllocationBytes = nonNegativeDelta(after.TotalAlloc, before.TotalAlloc)
	evidence.LifetimePeakRSSBytes, evidence.RSSIncrementBoundAvailable = startupProcessPeakRSS()
	evidence.RSSIncrementBoundAvailable = evidence.RSSIncrementBoundAvailable && evidence.BaselineRSSBytes > 0 && evidence.LifetimePeakRSSBytes >= peak.rss
	if evidence.RSSIncrementBoundAvailable {
		evidence.RSSIncrementUpperBoundBytes = nonNegativeDelta(evidence.LifetimePeakRSSBytes, evidence.BaselineRSSBytes)
	}
	evidence.TileCacheAfter = service.TileCacheStats()
	close(errorsCh)
	for err := range errorsCh {
		return evidence, err
	}
	return evidence, nil
}

func fetchProbeTile(ctx context.Context, client *http.Client, base string, plan tileProbePlan, epoch float64) (tileProbeResult, error) {
	result := tileProbeResult{PlanID: plan.PlanID}
	start := time.Now()
	for attempt := 0; attempt < 4; attempt++ {
		result.Attempts++
		raw, headers, status, err := tileProbeHTTP(ctx, client, base+"/v1/state/tiles", `{"planId":"`+plan.PlanID+`","sequence":0}`)
		if err != nil {
			return result, err
		}
		if status == http.StatusTooManyRequests {
			result.Rejected429++
			seconds, err := strconv.Atoi(headers.Get("Retry-After"))
			if err != nil || seconds < 1 || seconds > 5 {
				return result, fmt.Errorf("invalid tile retry hint")
			}
			timer := time.NewTimer(time.Duration(seconds) * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return result, ctx.Err()
			case <-timer.C:
			}
			continue
		}
		if status != http.StatusOK {
			return result, fmt.Errorf("tile returned status %d", status)
		}
		header, err := statewire.ParseHeader(raw)
		if err != nil {
			return result, err
		}
		if header.RecordCount != uint32(plan.BodyCount) || header.TileCount != 1 || header.Sequence != 0 || header.OrdinalStart != 0 || header.EpochJD != epoch || statewire.HashHex(header.PlanHash) != plan.PlanID || statewire.HashHex(header.CatalogManifestHash) != plan.CatalogManifestSHA256 || plan.InventoryManifestSHA256 != "" && statewire.HashHex(header.InventoryManifestHash) != plan.InventoryManifestSHA256 {
			return result, fmt.Errorf("tile does not match the single-tile plan")
		}
		for n := uint32(0); n < header.RecordCount; n++ {
			bit := byte(1 << (n % 8))
			exact := raw[header.ExactBitmapOffset+n/8]&bit != 0
			missing := raw[header.MissingBitmapOffset+n/8]&bit != 0
			if exact == missing || raw[header.ApproxBitmapOffset+n/8]&bit != 0 {
				return result, fmt.Errorf("tile status partition is invalid")
			}
			if exact {
				result.ExactCount++
			} else {
				result.MissingCount++
			}
		}
		if result.ExactCount != plan.ExactCount || result.MissingCount != plan.MissingCount {
			return result, fmt.Errorf("tile status counts differ from plan")
		}
		result.RecordCount, result.Bytes = header.RecordCount, len(raw)
		result.PayloadSHA256 = statewire.HashHex(header.PayloadSHA256)
		result.LatencyNs = time.Since(start).Nanoseconds()
		return result, nil
	}
	return result, fmt.Errorf("tile retries exhausted")
}

func tileProbeHTTP(ctx context.Context, client *http.Client, url, body string) ([]byte, http.Header, int, error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return nil, nil, 0, err
	}
	r.Header.Set("Content-Type", "application/json")
	response, err := client.Do(r)
	if err != nil {
		return nil, nil, 0, err
	}
	defer response.Body.Close()
	// Include the client buffer in the measurement, but never allow an invalid
	// response to allocate an unbounded buffer in the benchmark process.
	raw, err := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
	if len(raw) > 64<<20 {
		return nil, response.Header, response.StatusCode, fmt.Errorf("response exceeds tile byte budget")
	}
	return raw, response.Header, response.StatusCode, err
}
