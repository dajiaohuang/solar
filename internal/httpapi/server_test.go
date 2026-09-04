package httpapi

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	return New(c, 2)
}
func TestCapabilitiesAndCatalogPagination(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("GET", "/v1/capabilities", nil))
	if rr.Code != 200 {
		t.Fatalf("capabilities: %d", rr.Code)
	}
	if rr.Header().Get("X-Solar-API-Version") == "" {
		t.Fatal("missing api header")
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("GET", "/v1/catalog?limit=2", nil))
	var v struct {
		Items []catalog.Body `json:"items"`
		Next  string         `json:"nextPageToken"`
	}
	if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &v) != nil || len(v.Items) != 2 || v.Next == "" {
		t.Fatalf("page response %d %s", rr.Code, rr.Body.String())
	}
}
func TestTrajectoryValidationAndMissingState(t *testing.T) {
	s := testServer(t)
	body := strings.NewReader(`{"bodyIds":["naif:401"],"startJd":2461287.5,"endJd":2461288.5,"samples":2,"frame":"ECLIPJ2000"}`)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", body))
	if rr.Code != 200 {
		t.Fatalf("trajectory: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(`{"bodyIds":["sun"],"startJd":1,"endJd":2,"samples":1}`)))
	if rr.Code != 400 {
		t.Fatalf("expected validation error: %d", rr.Code)
	}
}
func TestUnknownEndpoint(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/nope", nil))
	if rr.Code != 404 {
		t.Fatal(rr.Code)
	}
}

func TestOverloadFailsFastWithRetryHint(t *testing.T) {
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	s := New(c, 1)
	// Hold the only worker so the request exercises the bounded-overload path
	// deterministically instead of relying on goroutine scheduling.
	s.slots <- struct{}{}
	defer func() { <-s.slots }()
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/catalog?limit=1", nil))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") != "1" {
		t.Fatalf("missing retry hint: %q", rr.Header().Get("Retry-After"))
	}
}

func TestCancelledRequestIsRejectedBeforeWork(t *testing.T) {
	s := testServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequestWithContext(ctx, http.MethodGet, "/v1/catalog?limit=1", nil))
	if rr.Code != http.StatusRequestTimeout {
		t.Fatalf("expected cancellation status, got %d: %s", rr.Code, rr.Body.String())
	}
}

func fixtureInventory(t *testing.T, rows ...string) *inventory.Inventory {
	t.Helper()
	d := t.TempDir()
	f, err := os.Create(filepath.Join(d, "records-00000.jsonl.gz"))
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	for _, row := range rows {
		if _, err := gz.Write([]byte(row + "\n")); err != nil {
			t.Fatal(err)
		}
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	manifest := `{"schemaVersion":1,"purpose":"source-inventory-not-runtime-catalog","totalRecords":` + strconv.Itoa(len(rows)) + `,"shards":[{"file":"records-00000.jsonl.gz","count":` + strconv.Itoa(len(rows)) + `,"bytes":0,"sha256":""}]}`
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	inv, err := inventory.Load(d)
	if err != nil {
		t.Fatal(err)
	}
	return inv
}

func TestIdentityEndpointsAndExactPrecisionBoundary(t *testing.T) {
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	inv := fixtureInventory(t, `{"id":"sb:asteroid:1","designation":"1","name":"Ceres","category":"asteroid","parentId":"naif:10","confirmation":"confirmed","identityStatus":"source-designation","geometryStatus":"elliptic-elements","source":"numbered","sourceRow":3,"orbit":{"timeScale":"TDB","frame":"ECLIPJ2000","center":"naif:10","epochJd":2461200.5,"semiMajorAxisAU":2.7,"meanAnomalyDeg":10,"eccentricity":0.08,"inclinationDeg":10,"argPeriapsisDeg":20,"ascendingNodeDeg":30,"meanMotionDegPerDay":0.2}}`)
	s := New(c, 2, inv)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/identities?q=Ceres&limit=1", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"id":"sb:asteroid:1"`) {
		t.Fatalf("identity search: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/identities/sb:asteroid:1", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"sourceRecords":true`) || !strings.Contains(rr.Body.String(), `"identityEvidence"`) {
		t.Fatalf("identity detail: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/inventory/sb:asteroid:1", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"sourceRecords":true`) || !strings.Contains(rr.Body.String(), `"record"`) {
		t.Fatalf("inventory detail: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/identities/sb:asteroid:1/state?epochJd=2461201", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"availability":"missing"`) || !strings.Contains(rr.Body.String(), `source-elements-not-exact`) {
		t.Fatalf("exact state boundary: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/identities/sb:asteroid:1/state?epochJd=2461201&precision=approximate", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"availability":"fallback"`) || !strings.Contains(rr.Body.String(), `"state"`) {
		t.Fatalf("approximate opt-in: %d %s", rr.Code, rr.Body.String())
	}
}

func TestIdentitySnapshotEvidenceIsExact(t *testing.T) {
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	inv := fixtureInventory(t, `{"id":"sb:asteroid:2","designation":"2","name":"Pallas","source":"numbered","kernelEvidence":{"auditEt":841752000,"target":999,"segments":[{"kernelId":"fixture","startEt":841751000,"endEt":841753000,"frame":1,"type":2}],"stateAtAuditEpoch":{"position":{"x":1,"y":2,"z":3},"velocity":{"x":4,"y":5,"z":6}}}}`)
	s := New(c, 2, inv)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/identities/sb:asteroid:2/state?epochJd=2461287.5", nil))
	var response struct {
		Availability catalog.Availability `json:"availability"`
		Model        string               `json:"model"`
		Evidence     string               `json:"stateEvidence"`
		Window       map[string]float64   `json:"evidenceWindowEt"`
		State        catalog.State        `json:"state"`
	}
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &response) != nil {
		t.Fatalf("snapshot response: %d %s", rr.Code, rr.Body.String())
	}
	if response.Availability != catalog.AvailableSnapshot || response.Model != "source-kernel-state-at-audit-epoch" || response.Evidence != "inventory-kernel-evidence" || response.Window["startEt"] != 841751000 || response.Window["endEt"] != 841753000 {
		t.Fatalf("unexpected exact snapshot metadata: %+v", response)
	}
	if response.State.Position.X != 1 || response.State.Velocity.Z != 6 {
		t.Fatalf("unexpected snapshot state: %+v", response.State)
	}
}

func TestCompactTrajectoryStateTransport(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	body := strings.NewReader(`{"bodyIds":["earth"],"startJd":2451545,"endJd":2451546,"samples":2,"frame":"ECLIPJ2000","precision":"approximate"}`)
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/trajectory", body))
	var response struct {
		Precision   string `json:"precision"`
		StateLayout string `json:"stateLayout"`
		Bodies      []struct {
			Availability catalog.Availability `json:"availability"`
			States       []float64            `json:"states"`
			StateStride  int                  `json:"stateStride"`
		} `json:"bodies"`
	}
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &response) != nil {
		t.Fatalf("compact trajectory response: %d %s", rr.Code, rr.Body.String())
	}
	if response.Precision != "approximate" || response.StateLayout != "row-major-[x,y,z,vx,vy,vz]" || len(response.Bodies) != 1 {
		t.Fatalf("unexpected compact response metadata: %s", rr.Body.String())
	}
	bodyResponse := response.Bodies[0]
	if bodyResponse.Availability != catalog.AvailableFallback || bodyResponse.StateStride != 6 || len(bodyResponse.States) != 12 {
		t.Fatalf("unexpected compact state: %+v", bodyResponse)
	}
}
