package httpapi

import (
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

func BenchmarkTrajectory64Samples(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	reqBody := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000"}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(reqBody))
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
	}
}

func loadBenchmarkCatalog() (*catalog.Catalog, error) { return catalog.Load("../../src/data") }
