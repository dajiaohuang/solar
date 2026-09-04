// Command bench produces repeatable, in-process service evidence. It is an
// engineering harness, not a claim that one machine or one workload is
// universally fastest.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

type report struct {
	Goos                   string  `json:"goos"`
	Goarch                 string  `json:"goarch"`
	Catalog                int     `json:"catalogEntries"`
	InventoryRecords       int     `json:"inventoryRecords,omitempty"`
	InventoryShards        int     `json:"inventoryShards,omitempty"`
	CatalogLoadMs          float64 `json:"catalogLoadMs"`
	Requests               int     `json:"latencyRequests"`
	Concurrency            int     `json:"concurrency"`
	FirstRequestMs         float64 `json:"firstRequestMs"`
	P50Ns                  int64   `json:"p50Ns"`
	P95Ns                  int64   `json:"p95Ns"`
	P99Ns                  int64   `json:"p99Ns"`
	MinNs                  int64   `json:"minNs"`
	MaxNs                  int64   `json:"maxNs"`
	Throughput             float64 `json:"throughputRequestsPerSecond"`
	MixedRequests          int     `json:"mixedRequests"`
	MixedP50Ns             int64   `json:"mixedP50Ns"`
	MixedP95Ns             int64   `json:"mixedP95Ns"`
	MixedP99Ns             int64   `json:"mixedP99Ns"`
	BatchBodies            int     `json:"batchBodies"`
	BatchSamples           int     `json:"batchSamples"`
	BatchMs                float64 `json:"batchMs"`
	LongSamples            int     `json:"longSamples"`
	LongMs                 float64 `json:"longTrajectoryMs"`
	LongResponseBytes      int64   `json:"longResponseBytes"`
	OverloadRequests       int     `json:"overloadRequests"`
	OverloadRejected       int64   `json:"overloadRejected"`
	PeakRSSBytes           uint64  `json:"peakRSSBytes,omitempty"`
	PeakHeapBytes          uint64  `json:"peakHeapBytes"`
	AllocDelta             uint64  `json:"allocDeltaBytes"`
	TotalAlloc             uint64  `json:"totalAllocBytes"`
	InvalidResponses       int64   `json:"invalidResponses"`
	CancelledObserved      bool    `json:"cancelledObserved"`
	OverloadStatusExpected int     `json:"overloadStatusExpected"`
}

func main() {
	n := flag.Int("requests", 500, "requests in each measured workload")
	workers := flag.Int("concurrency", 32, "parallel throughput workers")
	dataDir := flag.String("data-dir", "src/data", "directory containing the manifest and body data")
	inventoryDir := flag.String("inventory-dir", "", "optional audited source-inventory directory")
	longSamples := flag.Int("long-samples", 10000, "samples in the long-trajectory workload")
	flag.Parse()
	if *n < 1 || *workers < 1 || *longSamples < 2 {
		panic("requests, concurrency and long-samples must be positive")
	}

	loadStart := time.Now()
	c, err := catalog.Load(*dataDir)
	if err != nil {
		panic(err)
	}
	loadMs := float64(time.Since(loadStart).Microseconds()) / 1000
	var inv *inventory.Inventory
	if *inventoryDir != "" {
		inv, err = inventory.Load(*inventoryDir)
		if err != nil {
			panic(err)
		}
	}

	server := httptest.NewServer(httpapi.New(c, *workers, inv))
	defer server.Close()
	client := server.Client()
	ids := benchmarkBodyIDs(c)
	singlePayload := trajectoryPayload([]string{"earth"}, 64)
	batchPayload := trajectoryPayload(ids, 128)
	longPayload := trajectoryPayload([]string{"earth"}, *longSamples)
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

	// The mixed run exercises the sorted catalog index, optional streaming
	// inventory and batched trajectory path under the same bounded pool.
	mixed := runMixed(client, server.URL, *n, *workers, batchPayload, inv != nil, peak)

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
	out := report{
		Goos: runtime.GOOS, Goarch: runtime.GOARCH, Catalog: c.Len(),
		InventoryRecords: inventoryRecords(inv), InventoryShards: inventoryShards(inv), CatalogLoadMs: loadMs,
		Requests: *n * latencyBatch, Concurrency: *workers, FirstRequestMs: firstMs,
		P50Ns: quantile(lat, .50), P95Ns: quantile(lat, .95), P99Ns: quantile(lat, .99), MinNs: quantile(lat, 0), MaxNs: quantile(lat, 1),
		Throughput: float64(completed) / elapsed, MixedRequests: mixed.count, MixedP50Ns: mixed.p50, MixedP95Ns: mixed.p95, MixedP99Ns: mixed.p99,
		BatchBodies: len(ids), BatchSamples: 128, BatchMs: batchMs, LongSamples: *longSamples, LongMs: longMs, LongResponseBytes: longBytes,
		OverloadRequests: overloadRequests, OverloadRejected: overloadRejected, OverloadStatusExpected: http.StatusTooManyRequests,
		PeakRSSBytes: peak.rss, PeakHeapBytes: peak.heap, AllocDelta: nonNegativeDelta(after.Alloc, before.Alloc), TotalAlloc: after.TotalAlloc - before.TotalAlloc,
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
					path = "/v1/inventory?limit=10&q=asteroid"
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

func trajectoryPayload(ids []string, samples int) string {
	b, _ := json.Marshal(map[string]any{"bodyIds": ids, "startJd": 2451545.0, "endJd": 2451910.0, "samples": samples, "frame": "ECLIPJ2000"})
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
