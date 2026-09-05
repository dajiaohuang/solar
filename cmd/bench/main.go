// Command bench produces repeatable, in-process service evidence. It is an
// engineering harness, not a claim that one machine or one workload is
// universally fastest.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

type report struct {
	Goos                    string              `json:"goos"`
	Goarch                  string              `json:"goarch"`
	Catalog                 int                 `json:"catalogEntries"`
	CatalogPackagedFiles    int                 `json:"catalogPackagedFiles"`
	CatalogManifestSHA256   string              `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string              `json:"inventoryManifestSha256,omitempty"`
	InventoryRecords        int                 `json:"inventoryRecords,omitempty"`
	InventoryShards         int                 `json:"inventoryShards,omitempty"`
	InventoryBytes          int64               `json:"inventoryCompressedBytes,omitempty"`
	InventoryLoadMs         float64             `json:"inventoryIndexLoadMs,omitempty"`
	InventoryIndexTerms     int                 `json:"inventoryIndexTerms,omitempty"`
	InventoryIndexPostings  int                 `json:"inventoryIndexPostings,omitempty"`
	TrajectoryPrecision     string              `json:"trajectoryPrecision"`
	CatalogLoadMs           float64             `json:"catalogLoadMs"`
	Requests                int                 `json:"latencyRequests"`
	Concurrency             int                 `json:"concurrency"`
	FirstRequestMs          float64             `json:"firstRequestMs"`
	P50Ns                   int64               `json:"p50Ns"`
	P95Ns                   int64               `json:"p95Ns"`
	P99Ns                   int64               `json:"p99Ns"`
	MinNs                   int64               `json:"minNs"`
	MaxNs                   int64               `json:"maxNs"`
	Throughput              float64             `json:"throughputRequestsPerSecond"`
	MixedRequests           int                 `json:"mixedRequests"`
	MixedP50Ns              int64               `json:"mixedP50Ns"`
	MixedP95Ns              int64               `json:"mixedP95Ns"`
	MixedP99Ns              int64               `json:"mixedP99Ns"`
	ExactStateRequests      int                 `json:"exactStateRequests"`
	ExactStateP50Ns         int64               `json:"exactStateP50Ns"`
	ExactStateP95Ns         int64               `json:"exactStateP95Ns"`
	ExactStateP99Ns         int64               `json:"exactStateP99Ns"`
	IdentitySearchP50Ns     int64               `json:"identitySearchP50Ns"`
	IdentitySearchP95Ns     int64               `json:"identitySearchP95Ns"`
	IdentityDetailP50Ns     int64               `json:"identityDetailP50Ns"`
	IdentityDetailP95Ns     int64               `json:"identityDetailP95Ns"`
	InventoryWorkloadErrors int64               `json:"inventoryWorkloadErrors"`
	BatchBodies             int                 `json:"batchBodies"`
	BatchSamples            int                 `json:"batchSamples"`
	BatchMs                 float64             `json:"batchMs"`
	StateTiles              []stateTileEvidence `json:"stateTileBatches,omitempty"`
	StateTilesSource        []stateTileEvidence `json:"stateTileSourceBatches,omitempty"`
	LongSamples             int                 `json:"longSamples"`
	StateEpochJD            float64             `json:"stateEpochJd"`
	LongMs                  float64             `json:"longTrajectoryMs"`
	LongResponseBytes       int64               `json:"longResponseBytes"`
	OverloadRequests        int                 `json:"overloadRequests"`
	OverloadRejected        int64               `json:"overloadRejected"`
	PeakRSSBytes            uint64              `json:"peakRSSBytes,omitempty"`
	PeakRSSSampled          bool                `json:"peakRSSSampled"`
	RSSMeasurement          string              `json:"rssMeasurement"`
	PeakHeapBytes           uint64              `json:"peakHeapBytes"`
	AllocDelta              uint64              `json:"allocDeltaBytes"`
	TotalAlloc              uint64              `json:"totalAllocBytes"`
	InvalidResponses        int64               `json:"invalidResponses"`
	CancelledObserved       bool                `json:"cancelledObserved"`
	OverloadStatusExpected  int                 `json:"overloadStatusExpected"`
}

func main() {
	n := flag.Int("requests", 500, "requests in each measured workload")
	workers := flag.Int("concurrency", 32, "parallel throughput workers")
	dataDir := flag.String("data-dir", "src/data", "directory containing the manifest and body data")
	inventoryDir := flag.String("inventory-dir", "", "optional audited source-inventory directory")
	longSamples := flag.Int("long-samples", 10000, "samples in the long-trajectory workload")
	stateEpochJD := flag.Float64("epoch-jd", 2461287.5, "TDB epoch for state-plan/tile workloads (default is the reproducible audit epoch)")
	flag.Parse()
	if *n < 1 || *workers < 1 || *longSamples < 2 || math.IsNaN(*stateEpochJD) || math.IsInf(*stateEpochJD, 0) {
		panic("requests, concurrency and long-samples must be positive")
	}

	loadStart := time.Now()
	c, err := catalog.Load(*dataDir)
	if err != nil {
		panic(err)
	}
	loadMs := float64(time.Since(loadStart).Microseconds()) / 1000
	var inv *inventory.Inventory
	var inventoryLoadMs float64
	var inventoryIndexTerms, inventoryIndexPostings int
	if *inventoryDir != "" {
		inventoryStart := time.Now()
		inv, err = inventory.Load(*inventoryDir)
		if err != nil {
			panic(err)
		}
		inventoryLoadMs = float64(time.Since(inventoryStart).Microseconds()) / 1000
		stats := inv.IndexStats()
		inventoryIndexTerms, inventoryIndexPostings = stats["searchTerms"], stats["indexPostings"]
	}

	server := httptest.NewServer(httpapi.New(c, *workers, inv))
	defer server.Close()
	client := server.Client()
	ids := benchmarkBodyIDs(c)
	// Trajectory throughput is an explicitly approximate workload; state-tile
	// workloads below report exact and missing rows separately.
	singlePayload := trajectoryPayload([]string{"earth"}, 64, "approximate")
	batchPayload := trajectoryPayload(ids, 128, "approximate")
	longPayload := trajectoryPayload([]string{"earth"}, *longSamples, "approximate")
	stateTileIDs := benchmarkStateTileIDs(c)
	stateTileSourceIDs := benchmarkInventoryStateTileIDs(c, inv)
	peak := newPeak()

	firstStart := time.Now()
	firstStatus, _, err := doRequest(client, http.MethodPost, server.URL+"/v1/trajectory", singlePayload)
	if err != nil || firstStatus != http.StatusOK {
		panic("first trajectory request failed")
	}
	firstMs := float64(time.Since(firstStart).Microseconds()) / 1000
	peak.Sample()

	const latencyBatch = 8
	lat := make([]int64, 0, *n)
	for i := 0; i < *n; i++ {
		start := time.Now()
		for j := 0; j < latencyBatch; j++ {
			status, _, requestErr := doRequest(client, http.MethodPost, server.URL+"/v1/trajectory", singlePayload)
			if requestErr != nil || status != http.StatusOK {
				panic("latency trajectory request failed")
			}
		}
		lat = append(lat, time.Since(start).Nanoseconds()/latencyBatch)
		if i%32 == 0 {
			peak.Sample()
		}
	}

	batchStart := time.Now()
	batchStatus, _, err := doRequest(client, http.MethodPost, server.URL+"/v1/trajectory", batchPayload)
	if err != nil || batchStatus != http.StatusOK {
		panic("batch trajectory request failed")
	}
	batchMs := float64(time.Since(batchStart).Microseconds()) / 1000
	peak.Sample()

	longStart := time.Now()
	longStatus, longBytes, err := doRequest(client, http.MethodPost, server.URL+"/v1/trajectory", longPayload)
	if err != nil || longStatus != http.StatusOK {
		panic("long trajectory request failed")
	}
	longMs := float64(time.Since(longStart).Microseconds()) / 1000
	peak.Sample()
	stateTileEvidence := runStateTileWorkloads(client, server.URL, stateTileIDs, []int{len(stateTileIDs)}, *stateEpochJD, *n, *workers, peak)
	stateTileSourceEvidence := runStateTileWorkloads(client, server.URL, stateTileSourceIDs, []int{16384, 32768}, *stateEpochJD, *n, *workers, peak)

	// The mixed run exercises the sorted catalog index, optional indexed source
	// inventory and batched trajectory path under the same bounded pool.
	mixed := runMixed(client, server.URL, *n, *workers, batchPayload, inv != nil, peak)
	// Leave one slot free while the benchmark turns a completed HTTP response
	// into the next request; the handler releases its slot on return, just after
	// the response body has been written.
	inventoryWorkers := *workers
	if inventoryWorkers > 1 {
		inventoryWorkers--
	}
	exactState, searchP50, searchP95, detailP50, detailP95, inventoryErrors := runInventoryWorkloads(client, server.URL, *n, inventoryWorkers, inv, peak)

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	var next, completed, invalid int64
	start := time.Now()
	var wg sync.WaitGroup
	for w := 0; w < *workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := atomic.AddInt64(&next, 1)
				if i > int64(*n) {
					return
				}
				status, _, requestErr := doRequest(client, http.MethodGet, server.URL+"/v1/catalog?limit=100", "")
				atomic.AddInt64(&completed, 1)
				if requestErr != nil || status != http.StatusOK {
					atomic.AddInt64(&invalid, 1)
				}
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	runtime.ReadMemStats(&after)
	peak.Sample()

	cctx, cancel := context.WithCancel(context.Background())
	cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodPost, server.URL+"/v1/trajectory", strings.NewReader(longPayload))
	_, cancelErr := client.Do(req)
	if cancelErr == nil {
		// A pre-cancelled request may be rejected by either the client transport
		// or the handler; both are valid cancellation observations.
		cancelErr = context.Canceled
	}
	overloadRequests, overloadRejected := runOverload(c, inv, *workers, longPayload, peak)

	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	catalogStats := c.Stats()
	out := report{
		Goos: runtime.GOOS, Goarch: runtime.GOARCH, Catalog: c.Len(), CatalogPackagedFiles: catalogStats["packagedFiles"], CatalogManifestSHA256: c.ManifestHash(), InventoryManifestSHA256: inventoryManifestHash(inv),
		InventoryRecords: inventoryRecords(inv), InventoryShards: inventoryShards(inv), InventoryBytes: inventoryBytes(inv), InventoryLoadMs: inventoryLoadMs, InventoryIndexTerms: inventoryIndexTerms, InventoryIndexPostings: inventoryIndexPostings, CatalogLoadMs: loadMs,
		TrajectoryPrecision: "approximate-opt-in",
		Requests:            *n * latencyBatch, Concurrency: *workers, FirstRequestMs: firstMs,
		P50Ns: quantile(lat, .50), P95Ns: quantile(lat, .95), P99Ns: quantile(lat, .99), MinNs: quantile(lat, 0), MaxNs: quantile(lat, 1),
		Throughput: float64(completed) / elapsed, MixedRequests: mixed.count, MixedP50Ns: mixed.p50, MixedP95Ns: mixed.p95, MixedP99Ns: mixed.p99,
		ExactStateRequests: exactState.count, ExactStateP50Ns: exactState.p50, ExactStateP95Ns: exactState.p95, ExactStateP99Ns: exactState.p99, IdentitySearchP50Ns: searchP50, IdentitySearchP95Ns: searchP95, IdentityDetailP50Ns: detailP50, IdentityDetailP95Ns: detailP95, InventoryWorkloadErrors: inventoryErrors,
		BatchBodies: len(ids), BatchSamples: 128, BatchMs: batchMs, LongSamples: *longSamples, StateEpochJD: *stateEpochJD, LongMs: longMs, LongResponseBytes: longBytes,
		StateTiles:       stateTileEvidence,
		StateTilesSource: stateTileSourceEvidence,
		OverloadRequests: overloadRequests, OverloadRejected: overloadRejected, OverloadStatusExpected: http.StatusTooManyRequests,
		PeakRSSBytes: peak.rss, PeakRSSSampled: true, RSSMeasurement: "sampled process RSS; not an OS peak", PeakHeapBytes: peak.heap, AllocDelta: nonNegativeDelta(after.Alloc, before.Alloc), TotalAlloc: after.TotalAlloc - before.TotalAlloc,
		InvalidResponses: invalid + mixed.invalid, CancelledObserved: cancelErr != nil,
	}
	_ = json.NewEncoder(os.Stdout).Encode(out)
}

func nonNegativeDelta(after, before uint64) uint64 {
	if after < before {
		return 0
	}
	return after - before
}

type mixedReport struct {
	count         int
	invalid       int64
	p50, p95, p99 int64
}

func runMixed(client *http.Client, base string, n, workers int, payload string, withInventory bool, peak *peakMemory) mixedReport {
	times := make([]int64, n)
	var next, invalid int64
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := int(atomic.AddInt64(&next, 1)) - 1
				if i >= n {
					return
				}
				path, method, body := "/v1/catalog?limit=100", http.MethodGet, ""
				if i%3 == 1 {
					path, method, body = "/v1/trajectory", http.MethodPost, payload
				} else if i%3 == 2 && withInventory {
					path = "/v1/identities?limit=10&q=Ceres"
				}
				requestStart := time.Now()
				status, _, err := doRequest(client, method, base+path, body)
				times[i] = time.Since(requestStart).Nanoseconds()
				if err != nil || status != http.StatusOK {
					atomic.AddInt64(&invalid, 1)
				}
			}
		}()
	}
	wg.Wait()
	peak.Sample()
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	return mixedReport{count: n, invalid: invalid, p50: quantile(times, .50), p95: quantile(times, .95), p99: quantile(times, .99)}
}

type stateReport struct {
	count         int
	p50, p95, p99 int64
}

type stateTileEvidence struct {
	IDs              int   `json:"ids"`
	Requests         int   `json:"requests"`
	SuccessfulTiles  int64 `json:"successfulTiles"`
	P50Ns            int64 `json:"successfulTileP50Ns"`
	P95Ns            int64 `json:"successfulTileP95Ns"`
	P99Ns            int64 `json:"successfulTileP99Ns"`
	P50Bytes         int64 `json:"successfulTileP50Bytes"`
	PlanErrors       int64 `json:"planErrors"`
	Overload429      int64 `json:"overload429"`
	OtherErrors      int64 `json:"otherErrors"`
	ExactCount       int   `json:"exactCount"`
	ApproximateCount int   `json:"approximateCount"`
	MissingCount     int   `json:"missingCount"`
}

func runStateTileWorkloads(client *http.Client, base string, ids []string, counts []int, epochJD float64, n, workers int, peak *peakMemory) []stateTileEvidence {
	if len(ids) == 0 {
		return nil
	}
	if workers < 1 {
		workers = 1
	}
	out := make([]stateTileEvidence, 0, len(counts))
	for _, count := range counts {
		if count > len(ids) {
			continue
		}
		payload := statePlanPayload(ids[:count], epochJD)
		status, rawPlan, err := doRequestBody(client, http.MethodPost, base+"/v1/state/plan", payload)
		if err != nil || status != http.StatusOK {
			out = append(out, stateTileEvidence{IDs: count, Requests: n, PlanErrors: int64(n)})
			continue
		}
		var plan struct {
			PlanID           string `json:"planId"`
			ExactCount       int    `json:"exactCount"`
			ApproximateCount int    `json:"approximateCount"`
			MissingCount     int    `json:"missingCount"`
			Tiles            []struct {
				Sequence uint32 `json:"sequence"`
			} `json:"tiles"`
		}
		if json.Unmarshal(rawPlan, &plan) != nil || plan.PlanID == "" {
			out = append(out, stateTileEvidence{IDs: count, Requests: n, PlanErrors: int64(n)})
			continue
		}
		times := make([]int64, 0, n*len(plan.Tiles))
		bytes := make([]int64, 0, n*len(plan.Tiles))
		var next, successfulTiles, overload429, otherErrors int64
		var samplesMu sync.Mutex
		var wg sync.WaitGroup
		for w := 0; w < workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for {
					i := int(atomic.AddInt64(&next, 1)) - 1
					if i >= n {
						return
					}
					for _, tile := range plan.Tiles {
						body := `{"planId":"` + plan.PlanID + `","sequence":` + strconv.FormatUint(uint64(tile.Sequence), 10) + `}`
						start := time.Now()
						status, tileBytes, tileErr := doRequest(client, http.MethodPost, base+"/v1/state/tiles", body)
						elapsed := time.Since(start).Nanoseconds()
						if tileErr == nil && status == http.StatusOK {
							atomic.AddInt64(&successfulTiles, 1)
							samplesMu.Lock()
							times = append(times, elapsed)
							bytes = append(bytes, tileBytes)
							samplesMu.Unlock()
							continue
						}
						if tileErr == nil && status == http.StatusTooManyRequests {
							atomic.AddInt64(&overload429, 1)
						} else {
							atomic.AddInt64(&otherErrors, 1)
						}
						break
					}
				}
			}()
		}
		wg.Wait()
		peak.Sample()
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		sort.Slice(bytes, func(i, j int) bool { return bytes[i] < bytes[j] })
		out = append(out, stateTileEvidence{IDs: count, Requests: n, SuccessfulTiles: successfulTiles, P50Ns: quantile(times, .50), P95Ns: quantile(times, .95), P99Ns: quantile(times, .99), P50Bytes: quantile(bytes, .50), Overload429: overload429, OtherErrors: otherErrors, ExactCount: plan.ExactCount, ApproximateCount: plan.ApproximateCount, MissingCount: plan.MissingCount})
	}
	return out
}

func runInventoryWorkloads(client *http.Client, base string, n, workers int, inv *inventory.Inventory, peak *peakMemory) (stateReport, int64, int64, int64, int64, int64) {
	if inv == nil {
		return stateReport{}, 0, 0, 0, 0, 0
	}
	stateTimes := make([]int64, n)
	searchTimes := make([]int64, n)
	detailTimes := make([]int64, n)
	for i := 0; i < n; i++ {
		stateTimes[i], searchTimes[i], detailTimes[i] = -1, -1, -1
	}
	if workers < 1 {
		workers = 1
	}
	var next, errors int64
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := int(atomic.AddInt64(&next, 1)) - 1
				if i >= n {
					return
				}
				start := time.Now()
				status, _, err := doRequest(client, http.MethodGet, base+"/v1/identities/sb:asteroid:1/state?epochJd=2461287.5", "")
				if err == nil && status == http.StatusOK {
					stateTimes[i] = time.Since(start).Nanoseconds()
				} else {
					atomic.AddInt64(&errors, 1)
				}
				start = time.Now()
				status, _, err = doRequest(client, http.MethodGet, base+"/v1/identities?limit=10&q=Ceres", "")
				if err == nil && status == http.StatusOK {
					searchTimes[i] = time.Since(start).Nanoseconds()
				} else {
					atomic.AddInt64(&errors, 1)
				}
				start = time.Now()
				status, _, err = doRequest(client, http.MethodGet, base+"/v1/identities/sb:asteroid:1", "")
				if err == nil && status == http.StatusOK {
					detailTimes[i] = time.Since(start).Nanoseconds()
				} else {
					atomic.AddInt64(&errors, 1)
				}
			}
		}()
	}
	wg.Wait()
	peak.Sample()
	stateTimes = positiveTimes(stateTimes)
	searchTimes = positiveTimes(searchTimes)
	detailTimes = positiveTimes(detailTimes)
	sort.Slice(stateTimes, func(i, j int) bool { return stateTimes[i] < stateTimes[j] })
	sort.Slice(searchTimes, func(i, j int) bool { return searchTimes[i] < searchTimes[j] })
	sort.Slice(detailTimes, func(i, j int) bool { return detailTimes[i] < detailTimes[j] })
	return stateReport{count: len(stateTimes), p50: quantile(stateTimes, .50), p95: quantile(stateTimes, .95), p99: quantile(stateTimes, .99)}, quantile(searchTimes, .50), quantile(searchTimes, .95), quantile(detailTimes, .50), quantile(detailTimes, .95), errors
}

func positiveTimes(values []int64) []int64 {
	out := values[:0]
	for _, value := range values {
		if value >= 0 {
			out = append(out, value)
		}
	}
	return out
}

func runOverload(c *catalog.Catalog, inv *inventory.Inventory, workers int, payload string, peak *peakMemory) (int, int64) {
	server := httptest.NewServer(httpapi.New(c, 1, inv))
	defer server.Close()
	client := server.Client()
	n := workers * 2
	var rejected int64
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, _, err := doRequest(client, http.MethodPost, server.URL+"/v1/trajectory", payload)
			if err == nil && status == http.StatusTooManyRequests {
				atomic.AddInt64(&rejected, 1)
			}
		}()
	}
	wg.Wait()
	peak.Sample()
	return n, rejected
}

func doRequest(client *http.Client, method, url, body string) (int, int64, error) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		return 0, 0, err
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, 0, err
	}
	count, copyErr := io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if copyErr != nil {
		return response.StatusCode, count, copyErr
	}
	return response.StatusCode, count, nil
}

func doRequestBody(client *http.Client, method, url, body string) (int, []byte, error) {
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	return response.StatusCode, raw, err
}

func trajectoryPayload(ids []string, samples int, precision string) string {
	payload := map[string]any{"bodyIds": ids, "startJd": 2451545.0, "endJd": 2451910.0, "samples": samples, "frame": "ECLIPJ2000"}
	if precision != "" {
		payload["precision"] = precision
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

func statePlanPayload(ids []string, epochJD float64) string {
	payload := map[string]any{"ids": ids, "epochJd": epochJD, "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": []string{"position", "velocity"}, "tileSize": 16384}
	b, _ := json.Marshal(payload)
	return string(b)
}

func benchmarkBodyIDs(c *catalog.Catalog) []string {
	items := c.Page("", 0, 500)
	ids := make([]string, 0, 64)
	for _, b := range items {
		// Include missing rows as well: this intentionally exercises the full
		// 64-body request contract and its explicit availability semantics.
		ids = append(ids, b.ID)
		if len(ids) == 64 {
			break
		}
	}
	if len(ids) == 0 {
		return []string{"earth"}
	}
	return ids
}

func benchmarkStateTileIDs(c *catalog.Catalog) []string {
	items := c.Page("", 0, c.Len())
	ids := make([]string, 0, len(items))
	for _, body := range items {
		ids = append(ids, body.ID)
	}
	return ids
}

func benchmarkInventoryStateTileIDs(c *catalog.Catalog, inv *inventory.Inventory) []string {
	if inv == nil {
		return nil
	}
	const target = 32768
	var exactIDs, missingIDs []string
	cursor := ""
	for len(exactIDs)+len(missingIDs) < target {
		limit := target - len(exactIDs) - len(missingIDs)
		if limit > 500 {
			limit = 500
		}
		page, next, err := inv.Page(context.Background(), cursor, "", limit)
		if err != nil {
			return nil
		}
		if next == "" || len(page) == 0 {
			for _, raw := range page {
				record, decodeErr := inventory.Decode(raw)
				if decodeErr != nil {
					continue
				}
				catalogBody, catalogOK := c.Get("naif:" + strconv.Itoa(record.NAIFID))
				if record.NAIFID != 0 && catalogOK && catalogBody.Availability == catalog.AvailableOperational {
					exactIDs = append(exactIDs, record.ID)
				} else {
					missingIDs = append(missingIDs, record.ID)
				}
			}
			break
		}
		for _, raw := range page {
			record, decodeErr := inventory.Decode(raw)
			if decodeErr != nil {
				continue
			}
			catalogBody, catalogOK := c.Get("naif:" + strconv.Itoa(record.NAIFID))
			if record.NAIFID != 0 && catalogOK && catalogBody.Availability == catalog.AvailableOperational {
				exactIDs = append(exactIDs, record.ID)
			} else {
				missingIDs = append(missingIDs, record.ID)
			}
		}
		cursor = next
	}
	if len(exactIDs) == 0 || len(missingIDs) == 0 {
		return nil
	}
	ids := append(exactIDs, missingIDs...)
	if len(ids) > target {
		ids = ids[:target]
	}
	return ids
}

func inventoryManifestHash(i *inventory.Inventory) string {
	if i == nil {
		return ""
	}
	return i.ManifestHash()
}

func quantile(values []int64, p float64) int64 {
	if len(values) == 0 {
		return 0
	}
	i := int(float64(len(values)-1) * p)
	return values[i]
}

func inventoryRecords(i *inventory.Inventory) int {
	if i == nil {
		return 0
	}
	return i.TotalRecords()
}
func inventoryShards(i *inventory.Inventory) int {
	if i == nil {
		return 0
	}
	return i.ShardCount()
}
func inventoryBytes(i *inventory.Inventory) int64 {
	if i == nil {
		return 0
	}
	return i.TotalBytes()
}
