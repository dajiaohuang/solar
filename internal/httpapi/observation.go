package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/observation"
)

// ConfigureEarthOrientation installs a validated immutable snapshot before the
// server accepts requests. A nil snapshot leaves ground observations unavailable.
func (s *Server) ConfigureEarthOrientation(table *earthorientation.Table) { s.earthOrientation = table }

func (s *Server) observationMetadata() map[string]any {
	data := map[string]any{"available": s.earthOrientation != nil, "model": observation.Model, "bodyLimit": observation.MaxBodies, "inputTime": "ISO-8601-UTC-Z", "earthOrientationSourceUrl": earthorientation.SourceURL}
	data["visibility"] = map[string]any{"model": observation.VisibilityModel, "maxWindowSeconds": observation.MaxWindowSeconds, "stepSeconds": observation.SearchStepSeconds, "boundaryToleranceSeconds": observation.BoundaryToleranceSeconds, "maxEvaluations": observation.MaxWindowEvaluations}
	data["contacts"] = s.contactMetadata()
	if s.earthOrientation != nil {
		data["earthOrientation"] = s.earthOrientation.Manifest
		data["coverageMjdUtc"] = s.earthOrientation.CoverageMJD()
		data["recordCount"] = s.earthOrientation.Count()
	}
	return data
}

func (s *Server) observation(w http.ResponseWriter, r *http.Request) {
	// Required numeric fields use pointers on the wire: omitted latitude must
	// not silently create an equatorial station, and missing weather is vacuum.
	var wire struct {
		UTC     string   `json:"utc"`
		BodyIDs []string `json:"bodyIds"`
		Station *struct {
			LongitudeDeg *float64 `json:"longitudeDeg"`
			LatitudeDeg  *float64 `json:"latitudeDeg"`
			HeightMeters *float64 `json:"heightMeters"`
		} `json:"station"`
		Atmosphere *struct {
			PressureHPa           *float64 `json:"pressureHPa"`
			TemperatureC          *float64 `json:"temperatureC"`
			RelativeHumidity      *float64 `json:"relativeHumidity"`
			WavelengthMicrometers *float64 `json:"wavelengthMicrometers"`
		} `json:"atmosphere"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		s.error(w, 400, "invalid_observation_request", "request must be a bounded observation JSON object with known fields")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		s.error(w, 400, "invalid_observation_request", "request must contain one JSON object")
		return
	}
	if wire.Station == nil || wire.Station.LongitudeDeg == nil || wire.Station.LatitudeDeg == nil || wire.Station.HeightMeters == nil {
		s.error(w, 400, "invalid_station", "station requires longitudeDeg, latitudeDeg and heightMeters")
		return
	}
	req := observation.Request{UTC: wire.UTC, BodyIDs: wire.BodyIDs, Station: observation.Station{LongitudeDeg: *wire.Station.LongitudeDeg, LatitudeDeg: *wire.Station.LatitudeDeg, HeightMeters: *wire.Station.HeightMeters}}
	if a := wire.Atmosphere; a != nil {
		if a.PressureHPa == nil || a.TemperatureC == nil || a.RelativeHumidity == nil || a.WavelengthMicrometers == nil {
			s.error(w, 400, "invalid_atmosphere", "all four atmosphere fields are required when refraction is requested")
			return
		}
		req.Atmosphere = &observation.Atmosphere{PressureHPa: *a.PressureHPa, TemperatureC: *a.TemperatureC, RelativeHumidity: *a.RelativeHumidity, WavelengthMicrometers: *a.WavelengthMicrometers}
	}
	if err := req.Validate(); err != nil {
		var typed *observation.Error
		errors.As(err, &typed)
		s.error(w, 400, typed.Code, typed.Message)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	// Reserve one compute block for the entire small bounded observation job.
	// It must not recursively acquire another slot in its catalog callback.
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		s.observationError(w, ctx, err)
		return
	}
	defer release()
	result, err := observation.Evaluate(ctx, req, s.earthOrientation, s.catalog.EvalBatchContext)
	if err != nil {
		s.observationError(w, ctx, err)
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "catalogManifestSha256": s.catalog.ManifestHash(), "earthOrientation": s.earthOrientation.Manifest, "result": result})
}

func (s *Server) observationError(w http.ResponseWriter, ctx context.Context, err error) {
	if ctx.Err() != nil {
		s.error(w, 408, "cancelled", "observation cancelled or deadline exceeded")
		return
	}
	if errors.Is(err, errRequestQueueFull) || errors.Is(err, errRequestQueueTimeout) {
		w.Header().Set("Retry-After", "1")
		s.error(w, 429, "overloaded", "observation compute queue is full or its wait expired")
		return
	}
	var typed *observation.Error
	if errors.As(err, &typed) {
		status := http.StatusUnprocessableEntity
		if typed.Code == "earth_orientation_unavailable" {
			status = http.StatusServiceUnavailable
		}
		s.error(w, status, typed.Code, typed.Message)
		return
	}
	s.error(w, 500, "observation_failed", "source-backed observation evaluation failed")
}
