package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
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
	s.ServeHTTP(rr, httptest.NewRequest("GET", "/v1/capabilities", nil))
	if rr.Code != 200 {
		t.Fatalf("capabilities: %d", rr.Code)
	}
	if rr.Header().Get("X-Solar-API-Version") == "" {
		t.Fatal("missing api header")
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("GET", "/v1/catalog?limit=2", nil))
	var v struct {
		Items []catalog.Body `json:"items"`
		Next  string         `json:"nextPageToken"`
	}
	if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &v) != nil || len(v.Items) != 2 || v.Next == "" {
		t.Fatalf("page response %d %s", rr.Code, rr.Body.String())
	}
}
func TestTrajectoryValidationAndMissingState(t *testing.T) {
	s := testServer(t)
	body := strings.NewReader(`{"bodyIds":["naif:401"],"startJd":2461287.5,"endJd":2461288.5,"samples":2,"frame":"ECLIPJ2000"}`)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", body))
	if rr.Code != 200 {
		t.Fatalf("trajectory: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(`{"bodyIds":["sun"],"startJd":1,"endJd":2,"samples":1}`)))
	if rr.Code != 400 {
		t.Fatalf("expected validation error: %d", rr.Code)
	}
}
func TestUnknownEndpoint(t *testing.T) {
	s := testServer(t)
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/nope", nil))
	if rr.Code != 404 {
		t.Fatal(rr.Code)
	}
}
