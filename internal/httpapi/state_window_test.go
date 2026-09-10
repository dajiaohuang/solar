package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func readWindowFrame(t *testing.T, r io.Reader) []byte {
	t.Helper()
	var size [4]byte
	if _, err := io.ReadFull(r, size[:]); err != nil {
		t.Fatal(err)
	}
	count := binary.LittleEndian.Uint32(size[:])
	if count > maxStateTileBytes {
		t.Fatal("unbounded frame")
	}
	raw := make([]byte, count)
	if _, err := io.ReadFull(r, raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestWindowMatchesIndependentPlansAndCompletes(t *testing.T) {
	s := testServer(t)
	r := httptest.NewRecorder()
	s.ServeHTTP(r, httptest.NewRequest("POST", "/v1/state/window", strings.NewReader(`{"ids":["earth","unknown"],"epochsJd":[2451545,2451546,2451547,2451548,2451549],"fieldMask":["position","velocity"]}`)))
	if r.Code != 200 || r.Header().Get("Content-Type") != stateWindowMediaType {
		t.Fatalf("%d: %s", r.Code, r.Body.String())
	}
	var header map[string]any
	if err := json.Unmarshal(readWindowFrame(t, r.Body), &header); err != nil {
		t.Fatal(err)
	}
	if header["kind"] != "window" || header["epochCount"] != float64(5) {
		t.Fatal(header)
	}
	for n := 0; n < 5; n++ {
		var entry struct {
			Kind       string
			EpochIndex int
			Plan       statePlanResponse
		}
		if err := json.Unmarshal(readWindowFrame(t, r.Body), &entry); err != nil {
			t.Fatal(err)
		}
		if entry.Kind != "epoch" || entry.EpochIndex != n || entry.Plan.EpochJD != 2451545+float64(n) {
			t.Fatal(entry)
		}
		raw := readWindowFrame(t, r.Body)
		tile, err := statewire.ParseHeader(raw)
		if err != nil {
			t.Fatal(err)
		}
		if tile.EpochJD != entry.Plan.EpochJD {
			t.Fatal("epoch drift")
		}
		plan, err := s.buildStatePlan(context.Background(), statePlanRequest{IDs: []string{"earth", "unknown"}, EpochJD: entry.Plan.EpochJD, TimeScale: "TDB", Frame: "ECLIPJ2000", Precision: "exact", FieldMask: []string{"position", "velocity"}, TileSize: maxWindowIDs}, []string{"earth", "unknown"})
		if err != nil {
			t.Fatal(err)
		}
		expected, err := s.encodeStateTile(context.Background(), plan, 0)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(raw, expected.raw) {
			t.Fatal("stream changed scientific tile bytes")
		}
	}
	var summary map[string]any
	if err := json.Unmarshal(readWindowFrame(t, r.Body), &summary); err != nil {
		t.Fatal(err)
	}
	if summary["kind"] != "complete" || summary["exactCount"] != float64(0) || summary["missingCount"] != float64(10) || r.Body.Len() != 0 {
		t.Fatal(summary)
	}
}

func TestWindowRejectsInvalidGridBeforeStreaming(t *testing.T) {
	for _, grid := range []string{`[]`, `[2,1]`, `[1,1]`, `[1e999]`} {
		s := testServer(t)
		r := httptest.NewRecorder()
		s.ServeHTTP(r, httptest.NewRequest("POST", "/v1/state/window", strings.NewReader(`{"ids":["earth"],"epochsJd":`+grid+`,"fieldMask":["position","velocity"]}`)))
		if r.Code != 400 || s.ComputeStats()["interactiveGrants"] != 0 {
			t.Fatalf("%s: %d", grid, r.Code)
		}
	}
}

func TestMetadataRemainsAvailableWithFullAdmission(t *testing.T) {
	s := testServer(t)
	s.scheduler = newRequestScheduler(1, 0, time.Second)
	release, err := s.scheduler.acquire(context.Background(), trajectoryWork)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	for _, path := range []string{"/v1/health/live", "/v1/health/ready", "/v1/catalog/manifest"} {
		r := httptest.NewRecorder()
		s.ServeHTTP(r, httptest.NewRequest(http.MethodGet, path, nil))
		if r.Code != 200 {
			t.Fatalf("%s: %d", path, r.Code)
		}
	}
}

func TestWindowCancellationJoinsQueuedBlocks(t *testing.T) {
	s := testServer(t)
	s.ConfigureComputeWorkers(1)
	release, err := s.compute.acquire(context.Background(), interactiveRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	server := httptest.NewServer(s)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/v1/state/window", strings.NewReader(`{"ids":["earth"],"epochsJd":[2451545,2451546,2451547,2451548,2451549],"fieldMask":["position","velocity"]}`))
	if err != nil {
		t.Fatal(err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	_ = readWindowFrame(t, response.Body) // streamed header before CPU work
	cancel()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if s.SchedulerStats()["active"] == 0 && s.ComputeStats()["queued"] == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("cancelled window retained handlers/blocks: %v %v", s.SchedulerStats(), s.ComputeStats())
}
