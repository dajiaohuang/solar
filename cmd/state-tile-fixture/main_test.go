package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
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
