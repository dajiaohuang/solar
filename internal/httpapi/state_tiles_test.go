package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
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
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

func TestStatePlanAndBinaryTileRoundTrip(t *testing.T) {
	s := testServer(t)
	body := `{"ids":["earth","unknown"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`
	planRecorder := httptest.NewRecorder()
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(body)))
	if planRecorder.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", planRecorder.Code, planRecorder.Body.String())
	}
	var plan statePlanResponse
	if err := json.Unmarshal(planRecorder.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.PlanID == "" || plan.TileCount != 2 || plan.BodyCount != 2 || plan.TileSize != 1 || plan.MissingCount != 2 || plan.ExactCount != 0 || plan.ApproximateCount != 0 {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	h := sha256.New()
	for _, id := range []string{"earth", "unknown"} {
		var size [4]byte
		binary.LittleEndian.PutUint32(size[:], uint32(len([]byte(id))))
		_, _ = h.Write(size[:])
		_, _ = h.Write([]byte(id))
	}
	if plan.RequestIDsSHA256 != hex.EncodeToString(h.Sum(nil)) {
		t.Fatalf("request identity hash mismatch: %s", plan.RequestIDsSHA256)
	}
	if len(plan.Tiles) != 2 || plan.Tiles[0].Sequence != 0 || plan.Tiles[1].OrdinalStart != 1 {
		t.Fatalf("unexpected tile plan: %+v", plan.Tiles)
	}
	tileRequest := `{"planId":"` + plan.PlanID + `","sequence":1}`
	one := httptest.NewRecorder()
	s.ServeHTTP(one, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(tileRequest)))
	if one.Code != http.StatusOK || one.Header().Get("Content-Type") != "application/vnd.solar.state-tile+binary" {
		t.Fatalf("tile status=%d type=%q body=%s", one.Code, one.Header().Get("Content-Type"), one.Body.String())
	}
	if _, err := statewire.ParseHeader(one.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	firstStats := s.TileCacheStats()
	if firstStats["misses"] != 1 || firstStats["hits"] != 0 {
		t.Fatalf("unexpected tile cache after first response: %+v", firstStats)
	}
	two := httptest.NewRecorder()
	s.ServeHTTP(two, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(tileRequest)))
	if !bytes.Equal(one.Body.Bytes(), two.Body.Bytes()) || one.Header().Get("ETag") != two.Header().Get("ETag") {
		t.Fatal("repeated tile was not byte-identical")
	}
	secondStats := s.TileCacheStats()
	if secondStats["hits"] != 1 || secondStats["misses"] != 1 || secondStats["residentBytes"] == 0 || secondStats["residentBytes"] > secondStats["maxResidentBytes"] {
		t.Fatalf("unexpected tile cache after retry: %+v", secondStats)
	}
}

func TestStatePlanCountsEvaluatedKernelState(t *testing.T) {
	d := t.TempDir()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "synthetic.bsp"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(fixture)
	manifest := fmt.Sprintf(`{"id":"spk-test","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(fixture), hex.EncodeToString(sum[:]))
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := catalog.Load(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	s := New(c, 2)
	planRecorder := httptest.NewRecorder()
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["naif:-210001"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`)))
	var plan statePlanResponse
	if planRecorder.Code != http.StatusOK || json.Unmarshal(planRecorder.Body.Bytes(), &plan) != nil {
		t.Fatalf("plan status=%d body=%s", planRecorder.Code, planRecorder.Body.String())
	}
	if plan.ExactCount != 1 || plan.MissingCount != 0 {
		t.Fatalf("plan counts did not use evaluated state: %+v", plan)
	}
	tileRecorder := httptest.NewRecorder()
	s.ServeHTTP(tileRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(`{"planId":"`+plan.PlanID+`","sequence":0}`)))
	if tileRecorder.Code != http.StatusOK {
		t.Fatalf("tile status=%d body=%s", tileRecorder.Code, tileRecorder.Body.String())
	}
	h, err := statewire.ParseHeader(tileRecorder.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if tileRecorder.Body.Bytes()[h.ExactBitmapOffset]&1 == 0 {
		t.Fatal("evaluated kernel state was not marked exact")
	}
}

func TestStateTileInventoryOperationalMetadataUsesSelectedKernelProvenance(t *testing.T) {
	d := t.TempDir()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "synthetic.bsp"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(fixture)
	wantHash := hex.EncodeToString(sum[:])
	manifest := fmt.Sprintf(`{"id":"spk-test","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(fixture), wantHash)
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := catalog.Load(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	inv := fixtureInventory(t, `{"id":"sb:operational","source":"numbered","naifId":-210001}`)
	s := New(c, 2, inv)
	planRecorder := httptest.NewRecorder()
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["sb:operational"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`)))
	if planRecorder.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", planRecorder.Code, planRecorder.Body.String())
	}
	var plan statePlanResponse
	if err := json.Unmarshal(planRecorder.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.ExactCount != 1 || plan.MissingCount != 0 {
		t.Fatalf("unexpected inventory operational plan: %+v", plan)
	}
	tileRecorder := httptest.NewRecorder()
	s.ServeHTTP(tileRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(`{"planId":"`+plan.PlanID+`","sequence":0}`)))
	if tileRecorder.Code != http.StatusOK {
		t.Fatalf("tile status=%d body=%s", tileRecorder.Code, tileRecorder.Body.String())
	}
	h, err := statewire.ParseHeader(tileRecorder.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	var metadata statewire.Metadata
	if err := json.Unmarshal(bytes.TrimSpace(tileRecorder.Body.Bytes()[h.MetadataOffset:h.MetadataOffset+h.MetadataLength]), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.Model != "spk-original" || metadata.Source != "synthetic" || metadata.KernelSHA256 != wantHash || metadata.DatasetSHA256 != inv.ManifestHash() || metadata.CenterID != "naif:0" || !metadata.ValidityPresent || metadata.ValidityStartET != 0 || metadata.ValidityEndET != 1000 {
		t.Fatalf("inventory operational provenance=%+v want kernel=%s dataset=%s", metadata, wantHash, inv.ManifestHash())
	}
}

func TestStateTileInventorySnapshotMetadataUsesEvidenceKernelProvenance(t *testing.T) {
	d := t.TempDir()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "synthetic.bsp"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(fixture)
	wantHash := hex.EncodeToString(sum[:])
	manifest := fmt.Sprintf(`{"id":"spk-test","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(fixture), wantHash)
	if err := os.WriteFile(filepath.Join(d, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := catalog.Load(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	epoch := 2451545.0 + 500.0/86400
	inv := fixtureInventory(t, fmt.Sprintf(`{"id":"sb:snapshot","source":"numbered","naifId":-210002,"kernelEvidence":{"auditEt":500,"target":-210002,"segments":[{"kernelId":"synthetic","startEt":0,"endEt":1000,"center":399,"frame":1,"type":2}],"stateAtAuditEpoch":{"position":{"x":1,"y":2,"z":3},"velocity":{"x":4,"y":5,"z":6}}}}`))
	s := New(c, 2, inv)
	planRecorder := httptest.NewRecorder()
	body := fmt.Sprintf(`{"ids":["sb:snapshot"],"epochJd":%.17g,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"],"tileSize":1}`, epoch)
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(body)))
	if planRecorder.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", planRecorder.Code, planRecorder.Body.String())
	}
	var plan statePlanResponse
	if err := json.Unmarshal(planRecorder.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.ExactCount != 1 || plan.MissingCount != 0 {
		t.Fatalf("unexpected inventory snapshot plan: %+v", plan)
	}
	tileRecorder := httptest.NewRecorder()
	s.ServeHTTP(tileRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(`{"planId":"`+plan.PlanID+`","sequence":0}`)))
	if tileRecorder.Code != http.StatusOK {
		t.Fatalf("tile status=%d body=%s", tileRecorder.Code, tileRecorder.Body.String())
	}
	h, err := statewire.ParseHeader(tileRecorder.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	var metadata statewire.Metadata
	if err := json.Unmarshal(bytes.TrimSpace(tileRecorder.Body.Bytes()[h.MetadataOffset:h.MetadataOffset+h.MetadataLength]), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.Model != "source-kernel-state-at-audit-epoch" || metadata.Source != "synthetic" || metadata.KernelSHA256 != wantHash || metadata.DatasetSHA256 != inv.ManifestHash() || metadata.CenterID != "naif:399" || !metadata.EvidenceWindowPresent || metadata.EvidenceWindowStartET != 0 || metadata.EvidenceWindowEndET != 1000 {
		t.Fatalf("inventory snapshot provenance=%+v want kernel=%s dataset=%s", metadata, wantHash, inv.ManifestHash())
	}
}

func TestStatePlanValidationAndCancellation(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{
		`{"ids":["earth"],"epochJd":1,"timeScale":"UTC","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"]}`,
		`{"ids":["earth"],"epochJd":1,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"approximate","fieldMask":["position","velocity"]}`,
		`{"ids":["earth"],"epochJd":1,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position"],"tileSize":1}`,
	} {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(body)))
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid plan status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["earth"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"]}`)))
	if rr.Code != http.StatusRequestTimeout {
		t.Fatalf("cancelled plan status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestStatePlanRejectsEstimatedTileBudgetBeforeLookup(t *testing.T) {
	s := testServer(t)
	if _, _, err := estimateStateTileBudget(maxStateTileBodies, maxStateTileBodies, maxStatePlanBytes, 64<<20); err != nil {
		t.Fatalf("64 MiB production budget unexpectedly rejects maximum tile: %v", err)
	}
	s.stateTileByteBudget = 32 << 20
	ids := make([]string, maxStatePlanIDs)
	for n := range ids {
		ids[n] = "unknown-" + strconv.Itoa(n)
	}
	payload, err := json.Marshal(statePlanRequest{IDs: ids, EpochJD: 2451545, TimeScale: "TDB", Frame: "ECLIPJ2000", Precision: "exact", FieldMask: []string{"position", "velocity"}, TileSize: maxStateTileBodies})
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/state/plan", bytes.NewReader(payload)))
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("budget status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestStateTileEncodingBudgetMapsTo413(t *testing.T) {
	s := testServer(t)
	planRecorder := httptest.NewRecorder()
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["earth"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"]}`)))
	var plan statePlanResponse
	if planRecorder.Code != http.StatusOK || json.Unmarshal(planRecorder.Body.Bytes(), &plan) != nil {
		t.Fatalf("plan status=%d body=%s", planRecorder.Code, planRecorder.Body.String())
	}
	s.stateTileByteBudget = statewire.HeaderSize
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(`{"planId":"`+plan.PlanID+`","sequence":0}`)))
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("limited tile status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestStateTileBackpressure(t *testing.T) {
	s := testServer(t)
	planRecorder := httptest.NewRecorder()
	s.ServeHTTP(planRecorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["earth"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"]}`)))
	var plan statePlanResponse
	if err := json.Unmarshal(planRecorder.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	s.tileSlots <- struct{}{}
	s.tileSlots <- struct{}{}
	defer func() { <-s.tileSlots; <-s.tileSlots }()
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/state/tiles", strings.NewReader(`{"planId":"`+plan.PlanID+`","sequence":0}`)))
	if rr.Code != http.StatusTooManyRequests || rr.Header().Get("Retry-After") != "1" {
		t.Fatalf("tile overload status=%d retry=%q body=%s", rr.Code, rr.Header().Get("Retry-After"), rr.Body.String())
	}
}

func TestStatePlanCacheEvictsByResidentBytes(t *testing.T) {
	plan := func(id string) *statePlan {
		return &statePlan{rows: []statePlanRow{{metadata: statewire.Metadata{ID: id, Model: "exact-only", MissingReason: "unknown-identity"}}}}
	}
	first, second := plan("first"), plan("second")
	limit := statePlanResidentBytes(first) + statePlanResidentBytes(second) - 1
	cache := newStatePlanCache(10, limit)
	cache.put("first", first)
	cache.put("second", second)
	if _, found := cache.get("first"); found {
		t.Fatal("oldest plan survived resident-byte eviction")
	}
	if _, found := cache.get("second"); !found {
		t.Fatal("newest plan was not retained")
	}
	items, resident, maximum := cache.stats()
	if items != 1 || resident > maximum {
		t.Fatalf("unbounded plan cache: items=%d resident=%d max=%d", items, resident, maximum)
	}
}

func TestCachedStatePlanReleasesSourceObjects(t *testing.T) {
	s := testServer(t)
	recorder := httptest.NewRecorder()
	s.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/state/plan", strings.NewReader(`{"ids":["earth"],"epochJd":2451545,"timeScale":"TDB","frame":"ECLIPJ2000","precision":"exact","fieldMask":["position","velocity"]}`)))
	var response statePlanResponse
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &response) != nil {
		t.Fatalf("plan status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	plan, found := s.plans.get(response.PlanID)
	if !found || len(plan.rows) != 1 {
		t.Fatal("plan was not cached")
	}
	if plan.rows[0].catalogBody != nil || plan.rows[0].record != nil {
		t.Fatal("cached plan retained source catalog/inventory objects")
	}
}
