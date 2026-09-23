package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

func TestStellarMotionOriginalSourceHTTP(t *testing.T) {
	read := func(path string) []byte {
		t.Helper()
		b, err := os.ReadFile("../../tests/fixtures/" + path)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	manifest := read("gaia-six-20260923/manifest.json")
	rows := read("gaia-six-20260923/rows.csv")
	payload := map[string]any{"originalManifestBase64": manifest, "originalRowsCsvBase64": rows, "sourceId": "65212004581252736", "targetEpochJulianYearTCB": 2026, "radialVelocityPolicy": "spectroscopic-as-astrometric"}
	server := httptest.NewServer(testServer(t))
	defer server.Close()
	raw, _ := json.Marshal(payload)
	response, err := server.Client().Post(server.URL+"/v1/stellar/motion", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("HTTP %d", response.StatusCode)
	}
	var body struct {
		Experiment stellarmotion.Experiment `json:"experiment"`
	}
	if err = json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body.Experiment.OriginalRows, rows) || !bytes.Equal(body.Experiment.OriginalManifest, manifest) {
		t.Fatal("original evidence changed over HTTP")
	}
	if body.Experiment.FormalCovariance != nil {
		t.Fatal("unrequested covariance was computed")
	}
	var oracle struct {
		Cases []struct {
			Source   stellarmotion.Source `json:"source"`
			Year     float64              `json:"targetYearTCB"`
			Expected []float64            `json:"expected"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(read("gaia-motion-reference.json"), &oracle); err != nil {
		t.Fatal(err)
	}
	matched := false
	for _, c := range oracle.Cases {
		if c.Source.ID != payload["sourceId"] || c.Year != 2026 {
			continue
		}
		matched = true
		s := body.Experiment.Result.State
		for i, value := range []float64{s.RA, s.Dec, s.Parallax, s.PMRA, s.PMDec, s.RadialVelocity} {
			if math.Abs(value-c.Expected[i]) > 2e-10 {
				t.Fatalf("ERFA component %d mismatch", i)
			}
		}
	}
	if !matched {
		t.Fatal("missing independent reference")
	}
	for _, key := range []string{"radialVelocityPolicy", "originalRowsCsvBase64", "targetEpochJulianYearTCB"} {
		copy := map[string]any{}
		for k, v := range payload {
			copy[k] = v
		}
		delete(copy, key)
		raw, _ := json.Marshal(copy)
		recorder := httptest.NewRecorder()
		testServer(t).ServeHTTP(recorder, httptest.NewRequest("POST", "/v1/stellar/motion", bytes.NewReader(raw)))
		if recorder.Code != 400 && recorder.Code != 422 {
			t.Fatalf("missing %s returned %d", key, recorder.Code)
		}
	}
}

func TestStellarFormalCovarianceHTTP(t *testing.T) {
	read := func(path string) []byte {
		t.Helper()
		raw, err := os.ReadFile("../../tests/fixtures/" + path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	manifest, rows := read("gaia-six-20260923/manifest.json"), read("gaia-six-20260923/rows.csv")
	payload := map[string]any{"originalManifestBase64": manifest, "originalRowsCsvBase64": rows, "sourceId": "65212004581252736", "targetEpochJulianYearTCB": 2026, "radialVelocityPolicy": "spectroscopic-as-astrometric", "covariancePolicy": "independent-spectroscopic-rv"}
	live := httptest.NewServer(testServer(t))
	defer live.Close()
	raw, _ := json.Marshal(payload)
	response, err := live.Client().Post(live.URL+"/v1/stellar/motion", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("HTTP %d", response.StatusCode)
	}
	var wire struct {
		Experiment stellarmotion.Experiment `json:"experiment"`
	}
	if err = json.NewDecoder(response.Body).Decode(&wire); err != nil {
		t.Fatal(err)
	}
	covariance := wire.Experiment.FormalCovariance
	if covariance == nil || covariance.Policy != "independent-spectroscopic-rv" || covariance.TimeScale != "TCB" || covariance.Frame != "ICRS" || covariance.TargetEpoch != 2026 {
		t.Fatal("missing covariance contract")
	}
	if !bytes.Equal(wire.Experiment.OriginalRows, rows) || !bytes.Equal(wire.Experiment.OriginalManifest, manifest) {
		t.Fatal("lost original covariance evidence")
	}
	var reference struct {
		Cases []struct {
			Source   stellarmotion.Source  `json:"source"`
			Year     float64               `json:"targetYearTCB"`
			Expected stellarmotion.Matrix6 `json:"expected"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(read("gaia-covariance-reference.json"), &reference); err != nil {
		t.Fatal(err)
	}
	matched := false
	for _, c := range reference.Cases {
		if c.Source.ID != payload["sourceId"] || c.Year != 2026 {
			continue
		}
		matched = true
		for i := 0; i < 6; i++ {
			for j := 0; j < 6; j++ {
				scale := math.Sqrt(c.Expected[i][i] * c.Expected[j][j])
				if math.Abs(covariance.Output[i][j]-c.Expected[i][j])/scale > 5e-4 {
					t.Fatal("HTTP covariance differs from independent ERFA reference")
				}
			}
		}
	}
	if !matched {
		t.Fatal("reference absent")
	}
	payload["covariancePolicy"] = "assume-perfect-rv"
	raw, _ = json.Marshal(payload)
	recorder := httptest.NewRecorder()
	testServer(t).ServeHTTP(recorder, httptest.NewRequest("POST", "/v1/stellar/motion", bytes.NewReader(raw)))
	if recorder.Code != 422 {
		t.Fatalf("unsupported policy accepted: %d", recorder.Code)
	}
}

func TestStellarMotionWireBudgetsAndCancellation(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{`{"unknown":true}`, `{} {}`, `null`} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/stellar/motion", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("invalid wire accepted: %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/stellar/motion", strings.NewReader(`{"originalRowsCsvBase64":"`+strings.Repeat("A", stellarRequestBytes)+`"}`)))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("unbounded input: %d", w.Code)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w = httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/v1/stellar/motion", strings.NewReader(`{}`)).WithContext(ctx)
	s.ServeHTTP(w, r)
	if w.Code != 408 {
		t.Fatalf("cancelled request: %d", w.Code)
	}
	if classifyRequest(r) != trajectoryWork {
		t.Fatal("missing compute scheduling class")
	}
}
