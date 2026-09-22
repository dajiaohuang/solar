package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
)

func TestBuiltinTrajectoriesHonorModelsOriginsAndValidity(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), []byte(`{"id":"no-kernels","files":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	s := New(c, 1)
	request := func(body string) []trajectoryBody {
		t.Helper()
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(body)))
		var response struct {
			Bodies []trajectoryBody `json:"bodies"`
		}
		if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &response) != nil {
			t.Fatalf("response: %d %s", rr.Code, rr.Body.String())
		}
		return response.Bodies
	}
	rows := request(`{"bodyIds":["sun","mercury","earth","pluto"],"startJd":2451545,"endJd":2451546,"samples":2,"precision":"approximate"}`)
	for _, row := range rows[:3] {
		if len(row.States) != 12 || row.CenterID != "sun" || row.Availability != catalog.AvailableFallback {
			t.Fatalf("invalid approximate trajectory: %+v", row)
		}
	}
	for _, value := range rows[0].States {
		if value != 0 {
			t.Fatal("nonzero heliocentric Sun")
		}
	}
	// The old Mercury seed used the wrong anomaly and landed in another quadrant.
	if rows[1].States[0] >= 0 || rows[1].States[1] >= 0 {
		t.Fatalf("wrong Mercury J2000 phase: %v", rows[1].States[:3])
	}
	if rows[2].Model != "jpl-approx-keplerian-secular-earth-moon-partition" {
		t.Fatal(rows[2].Model)
	}
	if rows[3].Availability != catalog.Missing || len(rows[3].States) != 0 {
		t.Fatal("unsourced Pluto fallback")
	}
	rows = request(`{"bodyIds":["mercury"],"startJd":2470172.5,"endJd":2470173.5,"samples":2,"precision":"approximate"}`)
	if rows[0].MissingReason != "outside-approximate-model-validity" || len(rows[0].States) != 0 {
		t.Fatalf("extrapolated: %+v", rows[0])
	}
	rows = request(`{"bodyIds":["mercury"],"startJd":2451545,"endJd":2451546,"samples":2}`)
	if rows[0].MissingReason != "approximate-model-requires-explicit-opt-in" || len(rows[0].States) != 0 {
		t.Fatal("approximate state leaked into exact request")
	}
}
