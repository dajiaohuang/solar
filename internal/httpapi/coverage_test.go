package httpapi

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	report := os.Getenv("SOLAR_COVERAGE_REPORT")
	inventoryDir := os.Getenv("SOLAR_COVERAGE_INVENTORY_DIR")
	dataDir := os.Getenv("SOLAR_COVERAGE_DATA_DIR")
	if report == "" || inventoryDir == "" || dataDir == "" {
		t.Skip("set SOLAR_COVERAGE_REPORT, SOLAR_COVERAGE_INVENTORY_DIR and SOLAR_COVERAGE_DATA_DIR for external coverage evidence")
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

type hermeticCoverageFixture struct {
	Catalog   *catalog.Catalog
	Inventory *inventory.Inventory
	Report    string
}

func newHermeticCoverageFixture(t *testing.T) hermeticCoverageFixture {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	spk, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "synthetic.bsp"), spk, 0600); err != nil {
		t.Fatal(err)
	}
	spkSum := sha256.Sum256(spk)
	manifest := fmt.Sprintf(`{"id":"synthetic-coverage-v1","profile":"full","contract":"fixture","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(spk), hex.EncodeToString(spkSum[:]))
	if err := os.WriteFile(filepath.Join(dataDir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	cat, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cat.Close() })

	inventoryDir := filepath.Join(root, "inventory")
	if err := os.MkdirAll(inventoryDir, 0700); err != nil {
		t.Fatal(err)
	}
	rows := []map[string]any{
		{"id": "sb:fixture:operational", "source": "synthetic", "sourceRow": 7, "naifId": -210001, "identityStatus": "confirmed"},
		{"id": "unknown:fixture", "source": "synthetic", "sourceRow": 8, "identityStatus": "unknown"},
	}
	var uncompressed bytes.Buffer
	for _, row := range rows {
		encoded, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		uncompressed.Write(encoded)
		uncompressed.WriteByte('\n')
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(uncompressed.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	shard := "records-00000.jsonl.bgz"
	if err := os.WriteFile(filepath.Join(inventoryDir, shard), compressed.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	shardSum := sha256.Sum256(compressed.Bytes())
	inventoryManifest := map[string]any{"schemaVersion": 2, "purpose": "source-inventory-addressable-v2", "totalRecords": len(rows), "shards": []any{map[string]any{"file": shard, "count": len(rows), "bytes": len(compressed.Bytes()), "sha256": hex.EncodeToString(shardSum[:]), "blocks": []any{map[string]any{"rowStart": 0, "count": len(rows), "offset": 0, "bytes": len(compressed.Bytes()), "uncompressedBytes": len(uncompressed.Bytes()), "sha256": hex.EncodeToString(shardSum[:])}}}}}
	manifestBytes, err := json.Marshal(inventoryManifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inventoryDir, "manifest.json"), manifestBytes, 0600); err != nil {
		t.Fatal(err)
	}
	inv, err := inventory.Load(inventoryDir)
	if err != nil {
		t.Fatal(err)
	}

	chainCovered := []any{map[string]any{"target": -210001, "kernelId": "synthetic", "center": 0, "frame": 1, "type": 2, "startEt": 0, "endEt": 1000, "context": "fixture"}, map[string]any{"target": 0, "origin": "naif:0"}}
	chainGap := []any{map[string]any{"target": -210001, "context": "legacy"}}
	point := func(et float64, state string, reason string, chain []any) map[string]any {
		return map[string]any{"et": et, "state": state, "reason": reason, "chain": chain}
	}
	interval := func(start, end float64, state, reason string, chain []any) map[string]any {
		return map[string]any{"startEt": start, "endEt": end, "openness": "(start,end)", "state": state, "reason": reason, "chain": chain}
	}
	window := map[string]any{"target": -210001, "requested": map[string]any{"startEt": 0, "endEt": 1000}, "dependencyCoverage": map[string]any{"points": []any{point(0, "covered", "", chainCovered), point(500, "covered", "", chainCovered), point(1000, "gap", "fixture-gap", chainGap)}, "intervals": []any{interval(0, 500, "covered", "", chainCovered), interval(500, 1000, "gap", "fixture-gap", chainGap)}}, "gaps": []any{map[string]any{"kind": "point", "et": 1000, "reason": "fixture-gap", "chain": chainGap}, map[string]any{"kind": "interval", "startEt": 500, "endEt": 1000, "reason": "fixture-gap", "chain": chainGap}}, "meaning": "Descriptor and dependency availability only; fixture evidence."}
	reportValue := map[string]any{"schemaVersion": 1, "purpose": "source-identity-and-dependency-window-audit", "inputInventorySha256": inv.ManifestHash(), "sourceSnapshotSha256": strings.Repeat("a", 64), "sourceBytesVerified": true, "kernels": map[string]any{"manifestId": cat.Version(), "profile": "full", "manifestSha256": cat.ManifestHash(), "auditEt": 500, "identityMappingSha256": strings.Repeat("b", 64), "satelliteCatalogSha256": strings.Repeat("c", 64), "timeScale": "TDB seconds past J2000", "frame": "ECLIPJ2000", "positionUnit": "km", "velocityUnit": "km/s", "meaning": "fixture"}, "requestedWindow": map[string]any{"startEt": 0, "endEt": 1000, "timeScale": "TDB seconds past J2000"}, "identity": map[string]any{"counts": map[string]any{"sourceRecords": 2, "mappedSourceRecords": 1, "unresolvedSourceRecords": 1, "explicitNaifTargets": 1, "availableTargetsAtAuditEpoch": 1}, "sourceCounts": map[string]any{"synthetic": 2}, "unresolvedReasons": map[string]any{"no-explicit-naif-mapping": 1}, "explicitTargetGroups": []any{map[string]any{"target": -210001, "key": "naif:-210001", "stateAtAuditEpoch": "state-available-at-audit-epoch", "evaluatedState": map[string]any{"position": map[string]any{"x": 1, "y": 2, "z": 3}, "velocity": map[string]any{"x": 4, "y": 5, "z": 6}}, "sourceRecords": []any{map[string]any{"id": "sb:fixture:operational", "ordinal": 0, "source": "synthetic", "sourceRow": 7}}}}}, "windowCounts": map[string]any{"dependencyCoveredTargets": 0, "targetsWithDependencyGaps": 1, "numericallyCertifiedWholeWindowTargets": nil}, "windows": []any{window}, "limitations": []string{"fixture"}}
	reportBytes, err := json.MarshalIndent(reportValue, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	reportPath := filepath.Join(root, "report.json")
	if err := os.WriteFile(reportPath, append(reportBytes, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	return hermeticCoverageFixture{Catalog: cat, Inventory: inv, Report: reportPath}
}

func TestHermeticCoverageAPI(t *testing.T) {
	fixture := newHermeticCoverageFixture(t)
	ledger, err := coverage.Load(fixture.Report, fixture.Catalog, fixture.Inventory)
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithCoverage(fixture.Catalog, 1, fixture.Inventory, ledger)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage", nil))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Length") != strconv.Itoa(recorder.Body.Len()) {
		t.Fatalf("summary status=%d contentLength=%q body=%s", recorder.Code, recorder.Header().Get("Content-Length"), recorder.Body.String())
	}
	var summary map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &summary); err != nil || summary["purpose"] != "source-identity-and-dependency-window-audit" {
		t.Fatalf("summary=%s err=%v", recorder.Body.String(), err)
	}
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage/targets?ids=naif:-210001,unknown:fixture", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"status":"audited"`) || !strings.Contains(recorder.Body.String(), `"status":"not_audited"`) {
		t.Fatalf("target status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var targetBody struct {
		Targets []coverageTargetResponse `json:"targets"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &targetBody); err != nil {
		t.Fatal(err)
	}
	evidence := targetBody.Targets[0].Coverage.DependencyCoverage
	if len(evidence.Points) != 3 || evidence.Points[1].ET != 500 || evidence.Points[1].State != "covered" ||
		len(evidence.Intervals) != 2 || evidence.Intervals[1].StartET != 500 || evidence.Intervals[1].State != "gap" ||
		len(evidence.Gaps) != 2 || evidence.Gaps[0].ET == nil || *evidence.Gaps[0].ET != 1000 ||
		evidence.Gaps[1].StartET == nil || *evidence.Gaps[1].StartET != 500 ||
		evidence.Points[1].Chain[0].Target == nil || *evidence.Points[1].Chain[0].Target != -210001 {
		t.Fatalf("time-window evidence was corrupted: %+v", evidence)
	}
	ids := make([]string, maxCoverageQueryIDs+1)
	for n := range ids {
		ids[n] = "unknown-" + strconv.Itoa(n)
	}
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage/targets?ids="+strings.Join(ids, ","), nil))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bounds status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHermeticCoverageUnavailableWithoutLedger(t *testing.T) {
	fixture := newHermeticCoverageFixture(t)
	recorder := httptest.NewRecorder()
	New(fixture.Catalog, 1, fixture.Inventory).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/coverage", nil))
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "coverage_unavailable") {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHermeticCoverageRejectsTamperedReport(t *testing.T) {
	fixture := newHermeticCoverageFixture(t)
	raw, err := os.ReadFile(fixture.Report)
	if err != nil {
		t.Fatal(err)
	}
	mutations := map[string][]byte{
		"inventory-hash": bytes.Replace(raw, []byte(fixture.Inventory.ManifestHash()), []byte(strings.Repeat("0", 64)), 1),
		"count":          bytes.Replace(raw, []byte(`"mappedSourceRecords": 1`), []byte(`"mappedSourceRecords": 99999999`), 1),
		"window-kind":    bytes.Replace(raw, []byte(`"kind": "point"`), []byte(`"kind": "invalid"`), 1),
		"missing-audit":  bytes.Replace(raw, []byte(`"auditEt": 500`), []byte(`"auditEt": null`), 1),
		"numeric-claim":  bytes.Replace(raw, []byte(`"numericallyCertifiedWholeWindowTargets": null`), []byte(`"numericallyCertifiedWholeWindowTargets": 0`), 1),
	}
	for name, mutated := range mutations {
		if bytes.Equal(mutated, raw) {
			t.Fatalf("mutation %s did not change fixture", name)
		}
		path := filepath.Join(t.TempDir(), name+".json")
		if err := os.WriteFile(path, mutated, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := coverage.Load(path, fixture.Catalog, fixture.Inventory); err == nil {
			t.Fatalf("expected %s rejection", name)
		}
	}
}

func TestHermeticCoverageStrictFieldsAndOrdinals(t *testing.T) {
	fixture := newHermeticCoverageFixture(t)
	raw, err := os.ReadFile(fixture.Report)
	if err != nil {
		t.Fatal(err)
	}
	group := func(r map[string]any) map[string]any {
		return r["identity"].(map[string]any)["explicitTargetGroups"].([]any)[0].(map[string]any)
	}
	window := func(r map[string]any) map[string]any { return r["windows"].([]any)[0].(map[string]any) }
	counts := func(r map[string]any) map[string]any {
		return r["identity"].(map[string]any)["counts"].(map[string]any)
	}
	mutations := map[string]func(map[string]any){
		"omitted audit": func(r map[string]any) { delete(r["kernels"].(map[string]any), "auditEt") },
		"omitted state": func(r map[string]any) { delete(group(r), "evaluatedState") },
		"null state axis": func(r map[string]any) {
			group(r)["evaluatedState"].(map[string]any)["position"].(map[string]any)["x"] = nil
		},
		"omitted state axis": func(r map[string]any) {
			delete(group(r)["evaluatedState"].(map[string]any)["velocity"].(map[string]any), "z")
		},
		"unknown state label": func(r map[string]any) { group(r)["stateAtAuditEpoch"] = "invented" },
		"unavailable retains state": func(r map[string]any) {
			group(r)["stateAtAuditEpoch"] = "no-state-at-audit-epoch"
			counts(r)["availableTargetsAtAuditEpoch"] = 0
		},
		"wrong ordinal":      func(r map[string]any) { group(r)["sourceRecords"].([]any)[0].(map[string]any)["ordinal"] = 1 },
		"missing ordinal":    func(r map[string]any) { delete(group(r)["sourceRecords"].([]any)[0].(map[string]any), "ordinal") },
		"missing zero count": func(r map[string]any) { delete(r["windowCounts"].(map[string]any), "dependencyCoveredTargets") },
		"missing numeric null": func(r map[string]any) {
			delete(r["windowCounts"].(map[string]any), "numericallyCertifiedWholeWindowTargets")
		},
		"missing point epoch": func(r map[string]any) {
			delete(window(r)["dependencyCoverage"].(map[string]any)["points"].([]any)[0].(map[string]any), "et")
		},
		"missing window start": func(r map[string]any) { delete(r["requestedWindow"].(map[string]any), "startEt") },
		"unreported gaps": func(r map[string]any) {
			window(r)["gaps"] = []any{}
			r["windowCounts"].(map[string]any)["dependencyCoveredTargets"] = 1
			r["windowCounts"].(map[string]any)["targetsWithDependencyGaps"] = 0
		},
		"wrong interval partition": func(r map[string]any) {
			window(r)["dependencyCoverage"].(map[string]any)["intervals"].([]any)[0].(map[string]any)["endEt"] = 400
		},
		"oversized source count": func(r map[string]any) {
			r["identity"].(map[string]any)["sourceCounts"] = map[string]any{"a": uint64(9223372036854775807), "b": uint64(9223372036854775807), "c": 4}
		},
		"invalid reason": func(r map[string]any) {
			r["identity"].(map[string]any)["unresolvedReasons"] = map[string]any{"Invalid Reason": 1}
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			var value map[string]any
			if err := json.Unmarshal(raw, &value); err != nil {
				t.Fatal(err)
			}
			mutate(value)
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "report.json")
			if err := os.WriteFile(path, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := coverage.Load(path, fixture.Catalog, fixture.Inventory); err == nil {
				t.Fatal("invalid audit was accepted")
			}
		})
	}
}

func TestHermeticCoverageAcceptsMissingStateAndSingleEpochWindow(t *testing.T) {
	fixture := newHermeticCoverageFixture(t)
	raw, err := os.ReadFile(fixture.Report)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	identity := value["identity"].(map[string]any)
	group := identity["explicitTargetGroups"].([]any)[0].(map[string]any)
	group["stateAtAuditEpoch"] = "no-state-at-audit-epoch"
	group["evaluatedState"] = nil
	identity["counts"].(map[string]any)["availableTargetsAtAuditEpoch"] = 0
	value["requestedWindow"].(map[string]any)["startEt"] = 1000
	value["requestedWindow"].(map[string]any)["endEt"] = 1000
	window := value["windows"].([]any)[0].(map[string]any)
	window["requested"] = map[string]any{"startEt": 1000, "endEt": 1000}
	dependency := window["dependencyCoverage"].(map[string]any)
	dependency["points"] = dependency["points"].([]any)[2:]
	dependency["intervals"] = []any{}
	window["gaps"] = window["gaps"].([]any)[:1]
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	ledger, err := coverage.Load(path, fixture.Catalog, fixture.Inventory)
	if err != nil {
		t.Fatal(err)
	}
	if ledger.Summary().Counts.AvailableTargetsAtAuditET != 0 {
		t.Fatal("missing state counted as available")
	}
	target, ok := ledger.Lookup(-210001)
	if !ok || target.StateAtAuditEpoch != "no-state-at-audit-epoch" || len(target.DependencyCoverage.Points) != 1 || target.DependencyCoverage.Points[0].ET != 1000 {
		t.Fatalf("invalid point window: %+v", target)
	}
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
