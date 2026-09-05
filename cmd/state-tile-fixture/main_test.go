package main

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

func TestPrepareOutputRejectsNonEmptyDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "existing"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := prepareOutput(dir); err == nil {
		t.Fatal("expected non-empty output directory rejection")
	}
}

func TestWriteNewDoesNotOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fixture.bin")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeNew(path, []byte("replacement")); err == nil {
		t.Fatal("expected O_EXCL write rejection")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, []byte("original")) {
		t.Fatalf("existing output changed: %q", raw)
	}
}

func TestSyntheticRealHandlerProducesExactMissingMultiTileGolden(t *testing.T) {
	dataDir, cleanup, err := makeSyntheticData(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	c, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	server := httpapi.New(c, 2)
	planRaw, planResponse := serveWithResponse(server, http.MethodPost, "/v1/state/plan", []byte(`{"ids":["naif:-210001","unknown:fixture"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`))
	if planResponse.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", planResponse.Code, planResponse.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(planRaw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.ExactCount != 1 || plan.MissingCount != 1 || plan.TileCount != 2 || len(plan.Tiles) != 2 {
		t.Fatalf("unexpected synthetic plan: %+v", plan)
	}
	for n, wantID := range []string{"naif:-210001", "unknown:fixture"} {
		body, response := serveWithResponse(server, http.MethodPost, "/v1/state/tiles", []byte(`{"planId":"`+plan.PlanID+`","sequence":`+strconv.Itoa(n)+`}`))
		if response.Code != http.StatusOK {
			t.Fatalf("tile %d status=%d body=%s", n, response.Code, response.Body.String())
		}
		described, err := describeTile(body)
		if err != nil {
			t.Fatal(err)
		}
		if described.RecordCount != 1 || len(described.ExpectedRows) != 1 || described.ExpectedRows[0].ID != wantID {
			t.Fatalf("tile %d row=%+v", n, described.ExpectedRows)
		}
		if n == 0 {
			if described.ExpectedRows[0].Status != "exact" {
				t.Fatalf("exact tile status=%q", described.ExpectedRows[0].Status)
			}
			wantBits := []string{"4197d78338518f50", "41b20ccf60051389", "41a753f5037dc4ac", "3fbfe5f5534b0e26", "3fd8263bdfbb3b6c", "3fcf35f2df91e2ea"}
			if !bytes.Equal([]byte(strings.Join(described.ExpectedRows[0].StateIEEE754BitsLE, ",")), []byte(strings.Join(wantBits, ","))) {
				t.Fatalf("synthetic exact bit pattern=%v want=%v", described.ExpectedRows[0].StateIEEE754BitsLE, wantBits)
			}
		} else if described.ExpectedRows[0].Status != "missing" {
			t.Fatalf("missing tile status=%q", described.ExpectedRows[0].Status)
		}
	}
}

func TestSyntheticDefaultsCoverCatalogOperationalSnapshotAndMissing(t *testing.T) {
	dataDir, dataCleanup, err := makeSyntheticData(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataCleanup()
	inventoryDir, inventoryCleanup, err := makeSyntheticInventory()
	if err != nil {
		t.Fatal(err)
	}
	defer inventoryCleanup()
	c, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	body, ok := c.Get("naif:-210001")
	if !ok {
		t.Fatal("synthetic catalog target is missing")
	}
	if body.ValidityStartET != 0 || body.ValidityEndET != 0 {
		t.Fatalf("expected deliberately broad-free catalog summary, got [%v,%v]", body.ValidityStartET, body.ValidityEndET)
	}
	inv, err := inventory.Load(inventoryDir)
	if err != nil {
		t.Fatal(err)
	}
	server := httpapi.New(c, 2, inv)
	ids := defaultSyntheticIDs()
	planRaw, response := serveWithResponse(server, http.MethodPost, "/v1/state/plan", mustJSON(map[string]any{"ids": ids, "epochJd": syntheticAuditEpochJD(), "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": []string{"position", "velocity"}, "tileSize": 1}))
	if response.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", response.Code, response.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(planRaw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.BodyCount != 4 || plan.ExactCount != 3 || plan.ApproximateCount != 0 || plan.MissingCount != 1 || plan.TileCount != 4 {
		t.Fatalf("unexpected default synthetic plan: %+v", plan)
	}
	wantStatuses := map[string]string{
		"naif:-210001":             "exact",
		"sb:synthetic:operational": "exact",
		"sb:synthetic:snapshot":    "exact",
		"unknown:fixture":          "missing",
	}
	seen := make(map[string]statewire.Metadata)
	for n := range plan.Tiles {
		tile, tileResponse := serveWithResponse(server, http.MethodPost, "/v1/state/tiles", mustJSON(map[string]any{"planId": plan.PlanID, "sequence": n}))
		if tileResponse.Code != http.StatusOK {
			t.Fatalf("tile %d status=%d body=%s", n, tileResponse.Code, tileResponse.Body.String())
		}
		described, err := describeTile(tile)
		if err != nil {
			t.Fatalf("describe tile %d: %v", n, err)
		}
		if len(described.ExpectedRows) != 1 {
			t.Fatalf("tile %d rows=%+v", n, described.ExpectedRows)
		}
		row := described.ExpectedRows[0]
		if row.Status != wantStatuses[row.ID] {
			t.Fatalf("row %q status=%q want=%q", row.ID, row.Status, wantStatuses[row.ID])
		}
		metadata, err := tileMetadata(tile)
		if err != nil {
			t.Fatal(err)
		}
		seen[row.ID] = metadata[0]
	}
	if len(seen) != len(wantStatuses) {
		t.Fatalf("seen rows=%v", seen)
	}
	if got := seen["naif:-210001"]; !got.ValidityPresent || got.ValidityStartET != 0 || got.ValidityEndET != 1000 {
		t.Fatalf("catalog operational validity=%+v", got)
	}
	if got := seen["sb:synthetic:operational"]; got.Model != "spk-original" || !got.ValidityPresent || got.ValidityStartET != 0 || got.ValidityEndET != 1000 {
		t.Fatalf("inventory operational metadata=%+v", got)
	}
	if got := seen["sb:synthetic:snapshot"]; got.Model != "source-kernel-state-at-audit-epoch" || !got.ValidityPresent || got.ValidityStartET != syntheticAuditET || got.ValidityEndET != syntheticAuditET || !got.EvidenceWindowPresent || got.EvidenceWindowStartET != 0 || got.EvidenceWindowEndET != 1000 {
		t.Fatalf("snapshot metadata=%+v", got)
	}
}

func TestSyntheticSnapshotRequiresItsAuditEpoch(t *testing.T) {
	dataDir, dataCleanup, err := makeSyntheticData(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataCleanup()
	inventoryDir, inventoryCleanup, err := makeSyntheticInventory()
	if err != nil {
		t.Fatal(err)
	}
	defer inventoryCleanup()
	c, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	server := httpapi.New(c, 2, mustInventory(t, inventoryDir))
	planRaw, response := serveWithResponse(server, http.MethodPost, "/v1/state/plan", mustJSON(map[string]any{"ids": []string{"sb:synthetic:snapshot"}, "epochJd": syntheticAuditEpochJD() + 1e-8, "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": []string{"position", "velocity"}, "tileSize": 1}))
	if response.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", response.Code, response.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(planRaw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.ExactCount != 0 || plan.MissingCount != 1 {
		t.Fatalf("snapshot outside audit epoch unexpectedly resolved: %+v", plan)
	}
}

func TestDescribeTileRejectsInconsistentStatusBitmap(t *testing.T) {
	dataDir, cleanup, err := makeSyntheticData(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	c, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	server := httpapi.New(c, 2)
	planRaw, response := serveWithResponse(server, http.MethodPost, "/v1/state/plan", []byte(`{"ids":["naif:-210001"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`))
	if response.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", response.Code, response.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(planRaw, &plan); err != nil {
		t.Fatal(err)
	}
	tile, response := serveWithResponse(server, http.MethodPost, "/v1/state/tiles", []byte(`{"planId":"`+plan.PlanID+`","sequence":0}`))
	if response.Code != http.StatusOK {
		t.Fatalf("tile status=%d body=%s", response.Code, response.Body.String())
	}
	header, err := statewire.ParseHeader(tile)
	if err != nil {
		t.Fatal(err)
	}
	tile[header.ApproxBitmapOffset] |= 1
	if _, err := describeTile(tile); err == nil {
		t.Fatal("expected inconsistent status bitmap rejection")
	}
}

func TestValidateTileRowRejectsInvalidExactOnlyRows(t *testing.T) {
	metadata := statewire.Metadata{ID: "fixture", ValidityStartET: 10, ValidityEndET: 20, ValidityPresent: true}
	for name, test := range map[string]struct {
		status  string
		epochET float64
		values  []float64
	}{
		"approximate":      {status: "approximate", epochET: 15, values: []float64{1, 2, 3, 4, 5, 6}},
		"outside validity": {status: "exact", epochET: 20.0002, values: []float64{1, 2, 3, 4, 5, 6}},
		"nonfinite":        {status: "exact", epochET: 15, values: []float64{1, 2, math.NaN(), 4, 5, 6}},
		"missing nonzero":  {status: "missing", values: []float64{0, 0, 0, 0, 0, 1}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateTileRow(metadata, test.status, test.epochET, test.values); err == nil {
				t.Fatal("expected invalid tile row rejection")
			}
		})
	}
	if err := validateTileRow(metadata, "exact", 20.00009, []float64{1, 2, 3, 4, 5, 6}); err != nil {
		t.Fatalf("epoch tolerance rejected a valid row: %v", err)
	}
}

func mustJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return raw
}

func mustInventory(t *testing.T, dir string) *inventory.Inventory {
	t.Helper()
	inv, err := inventory.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	return inv
}

func tileMetadata(raw []byte) ([]statewire.Metadata, error) {
	header, err := statewire.ParseHeader(raw)
	if err != nil {
		return nil, err
	}
	metadataBytes := raw[header.MetadataOffset : header.MetadataOffset+header.MetadataLength]
	lines := bytes.Split(bytes.TrimSuffix(metadataBytes, []byte{'\n'}), []byte{'\n'})
	metadata := make([]statewire.Metadata, len(lines))
	for n := range lines {
		if err := json.Unmarshal(lines[n], &metadata[n]); err != nil {
			return nil, err
		}
	}
	return metadata, nil
}

func TestDescribeTileRejectsTruncatedAndMetadataCountMismatch(t *testing.T) {
	dataDir, cleanup, err := makeSyntheticData(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	c, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	server := httpapi.New(c, 2)
	body, response := serveWithResponse(server, http.MethodPost, "/v1/state/plan", []byte(`{"ids":["naif:-210001"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`))
	if response.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", response.Code, response.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(body, &plan); err != nil {
		t.Fatal(err)
	}
	tile, response := serveWithResponse(server, http.MethodPost, "/v1/state/tiles", []byte(`{"planId":"`+plan.PlanID+`","sequence":0}`))
	if response.Code != http.StatusOK {
		t.Fatalf("tile status=%d body=%s", response.Code, response.Body.String())
	}
	if _, err := describeTile(tile[:len(tile)-1]); err == nil {
		t.Fatal("expected truncated tile rejection")
	}
	mutated := append([]byte(nil), tile...)
	header, err := statewire.ParseHeader(mutated)
	if err != nil {
		t.Fatal(err)
	}
	mutated[24] = byte(header.RecordCount + 1)
	if _, err := describeTile(mutated); err == nil {
		t.Fatal("expected metadata/record count mismatch rejection")
	}
}
