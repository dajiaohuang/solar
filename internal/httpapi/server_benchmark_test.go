package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
)

func BenchmarkCatalogPage(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	req := httptest.NewRequest("GET", "/v1/catalog?limit=100&q=naif", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
	}
}

func BenchmarkCatalogIDMapLookup(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, ok := c.Get("earth"); !ok {
			b.Fatal("earth missing from catalog")
		}
	}
}

func BenchmarkTrajectory64Samples(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	// The catalog fixture has no packaged SPK, so scientific work is measured
	// through the explicit approximate opt-in rather than an empty exact result.
	reqBody := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000","precision":"approximate"}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(reqBody))
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
	}
}

func BenchmarkTrajectory64BodyBatch(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	ids := make([]string, 0, 64)
	for _, body := range c.Page("", 0, 500) {
		ids = append(ids, body.ID)
		if len(ids) == 64 {
			break
		}
	}
	requestBody := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":128,"frame":"ECLIPJ2000","precision":"approximate"}`
	if len(ids) == 64 {
		encoded, err := json.Marshal(map[string]any{"bodyIds": ids, "startJd": 2451545.0, "endJd": 2451910.0, "samples": 128, "frame": "ECLIPJ2000", "precision": "approximate"})
		if err != nil {
			b.Fatal(err)
		}
		requestBody = string(encoded)
	}
	s := New(c, 32)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(requestBody))
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
	}
}

func BenchmarkTrajectory10000Samples(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	requestBody := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":10000,"frame":"ECLIPJ2000","precision":"approximate"}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(requestBody))
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
	}
}

func loadBenchmarkCatalog() (*catalog.Catalog, error) { return catalog.Load("../../src/data") }
