package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

func loadRealCoverageServer(t *testing.T) *Server {
	t.Helper()
	root := filepath.Join("..", "..", ".repostew", "cache")
	report := filepath.Join(root, "solar-109-coverage-ledger-full-20260905-g", "report.json")
	dataDir := filepath.Join(root, "solar-issue109-backend-full-20260905")
	inventoryDir := filepath.Join(root, "solar-issue109-addressable-inventory-20260905-moon-mapping")
	if _, err := os.Stat(report); os.IsNotExist(err) {
		t.Skip("real coverage evidence is not available in this checkout")
	}
	cat, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cat.Close() })
	inv, err := inventory.Load(inventoryDir)
	if err != nil {
		t.Fatal(err)
	}
	ledger, err := coverage.Load(report, cat, inv)
	if err != nil {
		t.Fatal(err)
	}
	return NewWithCoverage(cat, 2, inv, ledger)
}

func TestCoverageUnavailableWithoutLedger(t *testing.T) {
	cat, err := catalog.Load(filepath.Join("..", "..", "src", "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	recorder := httptest.NewRecorder()
	New(cat, 1).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage", nil))
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "coverage_unavailable") {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestCoverageSummaryResponseContract(t *testing.T) {
	server := loadRealCoverageServer(t)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Length") != strconv.Itoa(recorder.Body.Len()) {
		t.Fatalf("content length=%q body=%d", recorder.Header().Get("Content-Length"), recorder.Body.Len())
	}
	var response struct {
		APIVersion              string  `json:"apiVersion"`
		Purpose                 string  `json:"purpose"`
		ReportSHA256            string  `json:"reportSha256"`
		CatalogManifestSHA256   string  `json:"catalogManifestSha256"`
		InventoryManifestSHA256 string  `json:"inventoryManifestSha256"`
		AuditET                 float64 `json:"auditEt"`
		WindowCounts            struct {
			NumericallyCertifiedWholeWindowTargets *int `json:"numericallyCertifiedWholeWindowTargets"`
		} `json:"windowCounts"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.APIVersion != catalog.APIVersion || response.Purpose == "" || response.ReportSHA256 == "" || response.CatalogManifestSHA256 == "" || response.InventoryManifestSHA256 == "" || response.AuditET != 841752000 || response.WindowCounts.NumericallyCertifiedWholeWindowTargets != nil {
		t.Fatalf("unexpected summary response: %+v", response)
	}
}

func TestCoverageTargetLookupCanonicalizesAndDoesNotInferMissing(t *testing.T) {
	server := loadRealCoverageServer(t)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage/targets?ids=earth,naif:399,not-a-body", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Targets []struct {
			RequestedID string `json:"requestedId"`
			CanonicalID string `json:"canonicalId"`
			Status      string `json:"status"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Targets) != 3 || response.Targets[0].CanonicalID != "naif:399" || response.Targets[0].Status != "audited" || response.Targets[1].CanonicalID != "naif:399" || response.Targets[1].Status != "audited" || response.Targets[2].Status != "not_audited" {
		t.Fatalf("unexpected target response: %+v", response.Targets)
	}
}

func TestCoverageTargetLookupBoundsDistinctIDs(t *testing.T) {
	server := loadRealCoverageServer(t)
	ids := ""
	for n := 0; n < maxCoverageQueryIDs+1; n++ {
		if n > 0 {
			ids += ","
		}
		ids += "not-a-body-" + strconv.Itoa(n)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage/targets?ids="+ids, nil))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
