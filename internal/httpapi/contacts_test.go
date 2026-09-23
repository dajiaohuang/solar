package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/observation"
)

const validContacts = `{"startUtc":"2024-04-08T17:00:00Z","endUtc":"2024-04-08T21:00:00Z","foregroundId":301,"backgroundId":10,"aberration":"CN","station":{"longitudeDeg":-96.797,"latitudeDeg":32.7767,"heightMeters":130}}`

func TestContactHTTPInputAndMissingConfiguration(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{`null`, `{}`, validContacts + ` {}`, validContacts + strings.Repeat(" ", 16384),
		strings.Replace(validContacts, `"heightMeters":130`, `"heightMeters":null`, 1), strings.Replace(validContacts, `"latitudeDeg":32.7767`, `"latitudeDeg":91`, 1),
		strings.Replace(validContacts, `"CN"`, `"NONE"`, 1), strings.Replace(validContacts, `"foregroundId":301`, `"foregroundId":10`, 1),
		strings.Replace(validContacts, `2024-04-08T21:00:00Z`, `2024-04-10T21:00:00Z`, 1)} {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/contacts", strings.NewReader(body)))
		if rr.Code != 400 {
			t.Fatalf("%d %s", rr.Code, rr.Body.String())
		}
	}
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/contacts", strings.NewReader(validContacts)))
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "body_radii_unavailable") {
		t.Fatal(rr.Code, rr.Body.String())
	}
	shapes, err := bodyshape.Load("../../src/data/pck00011.tpc")
	if err != nil {
		t.Fatal(err)
	}
	s.ConfigureBodyRadii(shapes)
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/contacts", strings.NewReader(validContacts)))
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "earth_orientation_unavailable") {
		t.Fatal(rr.Code, rr.Body.String())
	}
}

func TestContactHTTPRealSourcesAndCancellation(t *testing.T) {
	dir := t.TempDir()
	raw, err := os.ReadFile("../../src/data/ephemeris-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ID    string
		Files []json.RawMessage
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	var file struct{ Path string }
	if err = json.Unmarshal(manifest.Files[0], &file); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(map[string]any{"id": manifest.ID, "files": manifest.Files[:1]})
	if err = os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join("../../public/data/ephemerides", file.Path))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, file.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	cat, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cat.Close() })
	s := New(cat, 2)
	raw, err = os.ReadFile("../../tests/fixtures/eclipse-iers-provenance.json")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		Source        earthorientation.Manifest
		FixtureSHA256 string
		FixtureBytes  int
	}
	if err = json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	m := meta.Source
	m.SHA256 = meta.FixtureSHA256
	m.Bytes = meta.FixtureBytes
	m.Path = "finals2000A-" + m.SHA256 + ".all"
	raw, err = os.ReadFile("../../tests/fixtures/eclipse-iers-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, m.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(m)
	if err = os.WriteFile(filepath.Join(dir, "iers.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	eop, err := earthorientation.Load(filepath.Join(dir, "iers.json"))
	if err != nil {
		t.Fatal(err)
	}
	s.ConfigureEarthOrientation(eop)
	shapes, err := bodyshape.Load("../../src/data/pck00011.tpc")
	if err != nil {
		t.Fatal(err)
	}
	s.ConfigureBodyRadii(shapes)
	live := httptest.NewServer(s)
	t.Cleanup(live.Close)
	responseHTTP, err := live.Client().Post(live.URL+"/v1/observation/contacts", "application/json", strings.NewReader(validContacts))
	if err != nil {
		t.Fatal(err)
	}
	payload, err := io.ReadAll(responseHTTP.Body)
	responseHTTP.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if responseHTTP.StatusCode != 200 {
		t.Fatal(responseHTTP.StatusCode, string(payload))
	}
	// Explicit local fixture capture from the real loopback route; CI leaves
	// this unset. Never replace an existing reference silently.
	if path := os.Getenv("SOLAR_CAPTURE_CONTACT_FIXTURE"); path != "" {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		_, writeErr := f.Write(payload)
		closeErr := f.Close()
		if writeErr != nil {
			t.Fatal(writeErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
	}
	var response struct {
		APIVersion, CatalogVersion, CatalogManifestSHA256 string
		Result                                            observation.ContactResult
	}
	if err = json.Unmarshal(payload, &response); err != nil {
		t.Fatal(err)
	}
	if response.APIVersion != catalog.APIVersion || response.CatalogManifestSHA256 != cat.ManifestHash() || len(response.Result.Contacts) != 4 || !response.Result.PossibleMissedEvents || response.Result.EarthOrientation.SHA256 != m.SHA256 {
		t.Fatal("incomplete source response")
	}
	raw, err = os.ReadFile("../../tests/fixtures/ground-contacts-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var reference struct{ Contacts []observation.GroundContact }
	if err = json.Unmarshal(raw, &reference); err != nil {
		t.Fatal(err)
	}
	for i, contact := range reference.Contacts {
		if math.Abs(contact.ElapsedTAISeconds-response.Result.Contacts[i].ElapsedTAISeconds) > .03 {
			t.Fatal("reference mismatch")
		}
	}
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/observation/metadata", nil))
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"contacts":{"available":true`) {
		t.Fatal(rr.Body.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/contacts", strings.NewReader(validContacts)).WithContext(ctx))
	if rr.Code != 408 {
		t.Fatal(rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/contacts", strings.NewReader(strings.Replace(validContacts, `"foregroundId":301`, `"foregroundId":199`, 1))))
	if rr.Code != 422 || !strings.Contains(rr.Body.String(), "unsupported_body_shape") {
		t.Fatal(rr.Code, rr.Body.String())
	}
}
