package httpapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/capabilities", nil))
	if rr.Code != http.StatusOK || rr.Header().Get("X-Solar-API-Version") == "" {
		t.Fatalf("capabilities: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/catalog?limit=2", nil))
	var v struct {
		Items []catalog.Body `json:"items"`
		Next  string         `json:"nextPageToken"`
	}
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &v) != nil || len(v.Items) != 2 || v.Next == "" {
		t.Fatalf("page response %d %s", rr.Code, rr.Body.String())
	}
}

func TestCatalogManifestAndLegacyCurrentStatesRemoved(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/catalog/manifest", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"catalogManifestSha256"`) {
		t.Fatalf("manifest response: %d %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Content-Length") != strconv.Itoa(rr.Body.Len()) {
		t.Fatalf("manifest content length=%q body=%d", rr.Header().Get("Content-Length"), rr.Body.Len())
	}
	if rr.Header().Get("Access-Control-Expose-Headers") != "Content-Length, ETag, X-Solar-API-Version" {
		t.Fatalf("manifest CORS expose=%q", rr.Header().Get("Access-Control-Expose-Headers"))
	}
	options := httptest.NewRecorder()
	s.ServeHTTP(options, httptest.NewRequest(http.MethodOptions, "/v1/catalog/manifest", nil))
	if options.Code != http.StatusNoContent || options.Header().Get("Access-Control-Expose-Headers") == "" {
		t.Fatalf("manifest preflight status=%d expose=%q", options.Code, options.Header().Get("Access-Control-Expose-Headers"))
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/current-states", strings.NewReader(`{"ids":["earth"]}`)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("legacy current-states status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCapabilitiesAdvertiseInventoryManifestHash(t *testing.T) {
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	inv := fixtureInventory(t, `{"id":"sb:asteroid:1","source":"numbered"}`)
	s := New(c, 1, inv)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/capabilities", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("capabilities: %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), inv.ManifestHash()) {
		t.Fatalf("capabilities omitted inventory hash: %s", rr.Body.String())
	}
}

func TestTrajectoryValidationAndMissingState(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/trajectory", strings.NewReader(`{"bodyIds":["naif:401"],"startJd":2461287.5,"endJd":2461288.5,"samples":2,"frame":"ECLIPJ2000"}`)))
	if rr.Code != http.StatusOK {
		t.Fatalf("trajectory: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/trajectory", strings.NewReader(`{"bodyIds":["sun"],"startJd":1,"endJd":2,"samples":1}`)))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected validation error: %d", rr.Code)
	}
}

func TestUnknownEndpoint(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/nope", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatal(rr.Code)
	}
}

func TestOverloadFailsFastWithRetryHint(t *testing.T) {
	c, err := catalog.Load("../../src/data")
	if err != nil {
		t.Fatal(err)
	}
	s := New(c, 1)
	s.slots <- struct{}{}
	defer func() { <-s.slots }()
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/catalog?limit=1", nil))
	if rr.Code != http.StatusTooManyRequests || rr.Header().Get("Retry-After") != "1" {
		t.Fatalf("overload status=%d retry=%q body=%s", rr.Code, rr.Header().Get("Retry-After"), rr.Body.String())
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
	raw := []byte(strings.Join(rows, "\n") + "\n")
	var compressed bytes.Buffer
	gz := gzip.NewWriter(&compressed)
	if _, err := gz.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	fileBytes := compressed.Bytes()
	blockSum, fileSum := sha256.Sum256(fileBytes), sha256.Sum256(fileBytes)
	file := "records-00000.jsonl.bgz"
	if err := os.WriteFile(filepath.Join(d, file), fileBytes, 0600); err != nil {
		t.Fatal(err)
	}
	manifest, err := json.Marshal(map[string]any{"schemaVersion": 2, "purpose": "source-inventory-addressable-v2", "totalRecords": len(rows), "shards": []any{map[string]any{"file": file, "count": len(rows), "bytes": len(fileBytes), "sha256": hex.EncodeToString(fileSum[:]), "blocks": []any{map[string]any{"rowStart": 0, "count": len(rows), "offset": 0, "bytes": len(fileBytes), "uncompressedBytes": len(raw), "sha256": hex.EncodeToString(blockSum[:])}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	inv, err := inventory.Load(d)
	if err != nil {
		t.Fatal(err)
	}
	return inv
}
