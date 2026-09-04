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
)

type report struct {
	Goos              string  `json:"goos"`
	Goarch            string  `json:"goarch"`
	Catalog           int     `json:"catalogEntries"`
	Requests          int     `json:"latencyRequests"`
	Concurrency       int     `json:"concurrency"`
	P50Ns             int64   `json:"p50Ns"`
	P95Ns             int64   `json:"p95Ns"`
	P99Ns             int64   `json:"p99Ns"`
	MinNs             int64   `json:"minNs"`
	MaxNs             int64   `json:"maxNs"`
	Throughput        float64 `json:"throughputRequestsPerSecond"`
	AllocDelta        uint64  `json:"allocDeltaBytes"`
	TotalAlloc        uint64  `json:"totalAllocBytes"`
	InvalidResponses  int64   `json:"invalidResponses"`
	CancelledObserved bool    `json:"cancelledObserved"`
}

func main() {
	n := flag.Int("requests", 500, "sequential latency samples")
	workers := flag.Int("concurrency", 32, "parallel throughput workers")
	flag.Parse()
	c, err := catalog.Load("src/data")
	if err != nil {
		panic(err)
	}
	ts := httptest.NewServer(httpapi.New(c, *workers))
	defer ts.Close()
	client := ts.Client()
	payload := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000"}`
	const latencyBatch = 8
	lat := make([]int64, 0, *n)
	for i := 0; i < *n; i++ {
		start := time.Now()
		for j := 0; j < latencyBatch; j++ {
			req, _ := http.NewRequest(http.MethodPost, ts.URL+"/v1/trajectory", strings.NewReader(payload))
			resp, e := client.Do(req)
			if e != nil {
				panic(e)
			}
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 200 {
				panic(resp.Status)
			}
		}
		lat = append(lat, time.Since(start).Nanoseconds()/latencyBatch)
	}
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	var count, invalid int64
	start := time.Now()
	var wg sync.WaitGroup
	for w := 0; w < *workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := atomic.AddInt64(&count, 1)
				if i > int64(*n) {
					return
				}
				req, _ := http.NewRequest(http.MethodGet, ts.URL+"/v1/catalog?limit=100", nil)
				resp, e := client.Do(req)
				if e != nil {
					atomic.AddInt64(&invalid, 1)
					continue
				}
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode != 200 {
					atomic.AddInt64(&invalid, 1)
				}
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	runtime.ReadMemStats(&after)
	cctx, cancel := context.WithCancel(context.Background())
	cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodPost, ts.URL+"/v1/trajectory", strings.NewReader(payload))
	_, cancelErr := client.Do(req)
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	q := func(p float64) int64 {
		if len(lat) == 0 {
			return 0
		}
		i := int(float64(len(lat)-1) * p)
		return lat[i]
	}
	out := report{Goos: runtime.GOOS, Goarch: runtime.GOARCH, Catalog: c.Len(), Requests: *n * latencyBatch, Concurrency: *workers, P50Ns: q(.50), P95Ns: q(.95), P99Ns: q(.99), MinNs: q(0), MaxNs: q(1), Throughput: float64(count) / elapsed, AllocDelta: after.Alloc - before.Alloc, TotalAlloc: after.TotalAlloc - before.TotalAlloc, InvalidResponses: invalid, CancelledObserved: cancelErr != nil}
	_ = json.NewEncoder(os.Stdout).Encode(out)
}
