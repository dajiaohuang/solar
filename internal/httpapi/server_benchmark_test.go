package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
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
			b.Fatal("earth missing")
		}
	}
}

func BenchmarkTrajectory64Samples(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	body := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000","precision":"approximate"}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(body)))
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
	bodyBytes, err := json.Marshal(map[string]any{"bodyIds": ids, "startJd": 2451545.0, "endJd": 2451910.0, "samples": 128, "frame": "ECLIPJ2000", "precision": "approximate"})
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(string(bodyBytes))))
	}
}

func BenchmarkTrajectory10000Samples(b *testing.B) {
	c, err := loadBenchmarkCatalog()
	if err != nil {
		b.Fatal(err)
	}
	s := New(c, 32)
	body := `{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":10000,"frame":"ECLIPJ2000","precision":"approximate"}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest("POST", "/v1/trajectory", strings.NewReader(body)))
	}
}

func BenchmarkStateTileWire(b *testing.B) {
	for _, count := range []int{160, 294, 510, 16384, 32768} {
		b.Run("binary/"+strconv.Itoa(count), func(b *testing.B) {
			plan := statewire.Tile{Sequence: 0, TileCount: 1, EpochJD: 2451545, FieldMask: statewire.FieldState, Metadata: make([]statewire.Metadata, count), Exact: make([]bool, count), Approximate: make([]bool, count), Missing: make([]bool, count), States: make([]float64, count*statewire.Stride)}
			for n := range plan.Metadata {
				plan.Metadata[n] = statewire.Metadata{ID: "naif:" + strconv.Itoa(n), Source: "jpl-spk", DatasetVersion: "full-1", DatasetSHA256: strings.Repeat("a", 64), KernelSHA256: strings.Repeat("b", 64), Model: "spk-original", StateEvidence: "catalog-kernel"}
				plan.Exact[n] = true
			}
			encoded, err := statewire.Encode(plan)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportMetric(float64(len(encoded)), "wire-bytes/op")
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				if _, err := statewire.Encode(plan); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func loadBenchmarkCatalog() (*catalog.Catalog, error) { return catalog.Load("../../src/data") }
