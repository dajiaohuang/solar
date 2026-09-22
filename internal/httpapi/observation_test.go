package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
)

const validObservation = `{"utc":"2026-09-23T04:00:00Z","bodyIds":["sun"],"station":{"longitudeDeg":103.851959,"latitudeDeg":1.29027,"heightMeters":0}}`

func TestObservationValidationAndUnconfiguredSource(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{
		`null`, `{}`, validObservation + ` {}`, strings.Replace(validObservation, `"heightMeters":0`, `"heightMeters":null`, 1),
		strings.Replace(validObservation, `"latitudeDeg":1.29027`, `"latitudeDeg":91`, 1),
		strings.Replace(validObservation, `"sun"`, `"sun","sun"`, 1),
		strings.Replace(validObservation, `"utc":`, `"typo":`, 1),
		strings.TrimSuffix(validObservation, "}") + `,"atmosphere":{"pressureHPa":1010}}`,
		validObservation + strings.Repeat(" ", 16384),
	} {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation", strings.NewReader(body)))
		if rr.Code != 400 {
			t.Fatalf("invalid observation status %d: %s", rr.Code, rr.Body.String())
		}
	}
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation", strings.NewReader(validObservation)))
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "earth_orientation_unavailable") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/observation/metadata", nil))
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"available":false`) {
		t.Fatal(rr.Body.String())
	}
}

func TestObservationConfiguredCoverageAndCancellation(t *testing.T) {
	s := testServer(t)
	dir := t.TempDir()
	raw, err := os.ReadFile("../../tests/fixtures/observer-iers-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	m := earthorientation.Manifest{SchemaVersion: 1, SourceURL: earthorientation.SourceURL, RetrievedAt: "2026-09-22T16:38:44Z", SHA256: digest, Bytes: len(raw), Path: "finals2000A-" + digest + ".all"}
	if err = os.WriteFile(filepath.Join(dir, m.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "manifest.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	table, err := earthorientation.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	s.ConfigureEarthOrientation(table)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation", strings.NewReader(validObservation)))
	if rr.Code != 422 || !strings.Contains(rr.Body.String(), "observer_ephemeris_unavailable") {
		t.Fatalf("invented SPK state %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation", strings.NewReader(strings.Replace(validObservation, "2026-09-23", "2027-01-01", 1))))
	if rr.Code != 422 || !strings.Contains(rr.Body.String(), "earth_orientation_outside_coverage") {
		t.Fatal(rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/observation/metadata", nil))
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), digest) || !strings.Contains(rr.Body.String(), `"available":true`) {
		t.Fatal(rr.Body.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation", strings.NewReader(validObservation)).WithContext(ctx))
	if rr.Code != 408 {
		t.Fatal(rr.Code)
	}
}
