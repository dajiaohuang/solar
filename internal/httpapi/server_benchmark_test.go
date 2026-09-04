package httpapi

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strconv"
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

func BenchmarkCurrentStateWireShapes(b *testing.B) {
	for _, count := range []int{160, 294, 510} {
		response := benchmarkCurrentStatesResponse(count)
		b.Run(fmt.Sprintf("columnar-json/%d", count), func(b *testing.B) {
			raw, err := json.Marshal(response)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportMetric(float64(len(raw)), "wire-bytes/op")
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				if _, err := json.Marshal(response); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run(fmt.Sprintf("row-json/%d", count), func(b *testing.B) {
			rows := benchmarkRowShape(response)
			raw, err := json.Marshal(rows)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportMetric(float64(len(raw)), "wire-bytes/op")
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				if _, err := json.Marshal(rows); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run(fmt.Sprintf("fixed-binary/%d", count), func(b *testing.B) {
			raw := benchmarkBinaryShape(response)
			b.ReportMetric(float64(len(raw)), "wire-bytes/op")
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				_ = benchmarkBinaryShape(response)
			}
		})
	}
}

func TestCurrentStateWireShapeSizes(t *testing.T) {
	for _, count := range []int{160, 294, 510} {
		response := benchmarkCurrentStatesResponse(count)
		columnar, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		row, err := json.Marshal(benchmarkRowShape(response))
		if err != nil {
			t.Fatal(err)
		}
		binaryShape := benchmarkBinaryShape(response)
		t.Logf("count=%d columnarJSONBytes=%d rowJSONBytes=%d fixedBinaryBytes=%d", count, len(columnar), len(row), len(binaryShape))
	}
}

func benchmarkCurrentStatesResponse(count int) currentStatesResponse {
	r := currentStatesResponse{
		APIVersion: "solar.api/v1", CatalogVersion: "bench", CatalogManifestSHA256: strings.Repeat("a", 64), EpochJD: 2451545, TimeScale: "TDB", Frame: "ECLIPJ2000", DistanceUnit: "km", VelocityUnit: "km/s", StateLayout: "row-major-[x,y,z,vx,vy,vz]", StateStride: 6,
		IDs: make([]string, 0, count), Availability: make([]catalog.Availability, 0, count), Precision: make([]string, 0, count), Source: make([]string, 0, count), DatasetVersion: make([]string, 0, count), Model: make([]string, 0, count), CenterIDs: make([]string, 0, count), ValidityStartET: make([]float64, 0, count), ValidityEndET: make([]float64, 0, count), ValidityPresent: make([]bool, 0, count), StateEvidence: make([]string, 0, count), EvidenceWindowStartET: make([]float64, 0, count), EvidenceWindowEndET: make([]float64, 0, count), EvidenceWindowPresent: make([]bool, 0, count), MissingReason: make([]string, 0, count), IdentityStatus: make([]string, 0, count), SourceRecord: make([]bool, 0, count), StatePresent: make([]bool, 0, count), StateValues: make([]float64, 0, count*6),
	}
	for n := 0; n < count; n++ {
		r.IDs = append(r.IDs, "naif:"+strconv.Itoa(1000+n))
		r.Availability = append(r.Availability, catalog.AvailableOperational)
		r.Precision = append(r.Precision, "exact")
		r.Source = append(r.Source, "jpl-spk")
		r.DatasetVersion = append(r.DatasetVersion, "jpl-full-20260904")
		r.Model = append(r.Model, "spk-original")
		r.CenterIDs = append(r.CenterIDs, "sun")
		r.ValidityStartET = append(r.ValidityStartET, 0)
		r.ValidityEndET = append(r.ValidityEndET, 1e9)
		r.ValidityPresent = append(r.ValidityPresent, true)
		r.StateEvidence = append(r.StateEvidence, "catalog-kernel")
		r.EvidenceWindowStartET = append(r.EvidenceWindowStartET, 0)
		r.EvidenceWindowEndET = append(r.EvidenceWindowEndET, 1e9)
		r.EvidenceWindowPresent = append(r.EvidenceWindowPresent, true)
		r.MissingReason = append(r.MissingReason, "")
		r.IdentityStatus = append(r.IdentityStatus, "")
		r.SourceRecord = append(r.SourceRecord, false)
		r.StatePresent = append(r.StatePresent, true)
		r.StateValues = append(r.StateValues, float64(n), float64(n+1), float64(n+2), .1, .2, .3)
	}
	return r
}

func benchmarkRowShape(r currentStatesResponse) []map[string]any {
	rows := make([]map[string]any, len(r.IDs))
	for n, id := range r.IDs {
		rows[n] = map[string]any{"id": id, "availability": r.Availability[n], "precision": r.Precision[n], "source": r.Source[n], "datasetVersion": r.DatasetVersion[n], "model": r.Model[n], "centerId": r.CenterIDs[n], "validityStartEt": r.ValidityStartET[n], "validityEndEt": r.ValidityEndET[n], "stateEvidence": r.StateEvidence[n], "statePresent": r.StatePresent[n], "states": r.StateValues[n*6 : n*6+6]}
	}
	return rows
}

func benchmarkBinaryShape(r currentStatesResponse) []byte {
	buf := bytes.NewBuffer(make([]byte, 0, len(r.IDs)*80))
	buf.WriteString("SCS1")
	_ = binary.Write(buf, binary.LittleEndian, uint16(len(r.IDs)))
	for n, id := range r.IDs {
		writeBinaryString(buf, id)
		buf.WriteByte(1)
		buf.WriteByte(0)
		for _, value := range r.StateValues[n*6 : n*6+6] {
			_ = binary.Write(buf, binary.LittleEndian, value)
		}
	}
	return buf.Bytes()
}

func writeBinaryString(buf *bytes.Buffer, value string) {
	_ = binary.Write(buf, binary.LittleEndian, uint16(len(value)))
	_, _ = buf.WriteString(value)
}
