package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/observation"
	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

func (s *Server) stellarObserver(w http.ResponseWriter, r *http.Request) {
	var wire struct {
		Manifest []byte `json:"originalManifestBase64"`
		Rows     []byte `json:"originalRowsCsvBase64"`
		SourceID string `json:"sourceId"`
		Policy   string `json:"radialVelocityPolicy"`
		UTC      string `json:"utc"`
		Station  *struct {
			Longitude *float64 `json:"longitudeDeg"`
			Latitude  *float64 `json:"latitudeDeg"`
			Height    *float64 `json:"heightMeters"`
		} `json:"station"`
		Atmosphere *struct {
			Pressure    *float64 `json:"pressureHPa"`
			Temperature *float64 `json:"temperatureC"`
			Humidity    *float64 `json:"relativeHumidity"`
			Wavelength  *float64 `json:"wavelengthMicrometers"`
		} `json:"atmosphere"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, stellarRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "stellar_request_too_large", "stellar request exceeds 26 MiB")
		} else {
			s.error(w, 400, "invalid_stellar_request", "expected bounded original sources and explicit UTC/station with known fields")
		}
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || wire.Station == nil || wire.Station.Longitude == nil || wire.Station.Latitude == nil || wire.Station.Height == nil {
		s.error(w, 400, "invalid_stellar_request", "one object with explicit longitude, latitude and height is required")
		return
	}
	if len(wire.Manifest) == 0 || len(wire.Manifest) > 1<<20 || len(wire.Rows) == 0 || len(wire.Rows) > 16<<20 || wire.Policy != "spectroscopic-as-astrometric" {
		s.error(w, 400, "invalid_stellar_request", "bounded original files and explicit supported radial-velocity policy are required")
		return
	}
	station := observation.Station{LongitudeDeg: *wire.Station.Longitude, LatitudeDeg: *wire.Station.Latitude, HeightMeters: *wire.Station.Height}
	request := observation.Request{UTC: wire.UTC, Station: station, BodyIDs: []string{"naif:10"}}
	if a := wire.Atmosphere; a != nil {
		if a.Pressure == nil || a.Temperature == nil || a.Humidity == nil || a.Wavelength == nil {
			s.error(w, 400, "invalid_atmosphere", "all four atmosphere fields are required when requesting refraction")
			return
		}
		request.Atmosphere = &observation.Atmosphere{PressureHPa: *a.Pressure, TemperatureC: *a.Temperature, RelativeHumidity: *a.Humidity, WavelengthMicrometers: *a.Wavelength}
	}
	if err := request.Validate(); err != nil {
		s.error(w, 400, "invalid_stellar_observer", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		s.observationError(w, ctx, err)
		return
	}
	defer release()
	result, err := stellarmotion.FromCSVAtStation(ctx, wire.Manifest, wire.Rows, wire.SourceID, wire.Policy, wire.UTC, station, request.Atmosphere, s.earthOrientation, s.catalog.EvalBatchContext)
	if err != nil {
		var observerError *observation.Error
		if ctx.Err() != nil || errors.As(err, &observerError) {
			s.observationError(w, ctx, err)
		} else {
			s.error(w, 422, "invalid_stellar_observer", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(),
		"catalogManifestSha256": s.catalog.ManifestHash(), "earthOrientation": s.earthOrientation.Manifest, "experiment": result}, 14<<20)
}
