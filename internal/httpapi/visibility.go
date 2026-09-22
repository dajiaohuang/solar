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
)

func (s *Server) observationWindows(w http.ResponseWriter, r *http.Request) {
	var wire struct {
		StartUTC          string   `json:"startUtc"`
		EndUTC            string   `json:"endUtc"`
		BodyID            string   `json:"bodyId"`
		MinAltitudeDeg    *float64 `json:"minAltitudeDeg"`
		MaxSunAltitudeDeg *float64 `json:"maxSunAltitudeDeg"`
		Station           *struct {
			LongitudeDeg *float64 `json:"longitudeDeg"`
			LatitudeDeg  *float64 `json:"latitudeDeg"`
			HeightMeters *float64 `json:"heightMeters"`
		} `json:"station"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		s.error(w, 400, "invalid_visibility_request", "request must be a bounded visibility JSON object with known fields")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		s.error(w, 400, "invalid_visibility_request", "request must contain one JSON object")
		return
	}
	if wire.Station == nil || wire.Station.LongitudeDeg == nil || wire.Station.LatitudeDeg == nil || wire.Station.HeightMeters == nil || wire.MinAltitudeDeg == nil {
		s.error(w, 400, "invalid_visibility_request", "station longitudeDeg, latitudeDeg, heightMeters and minAltitudeDeg are required")
		return
	}
	req := observation.VisibilityRequest{StartUTC: wire.StartUTC, EndUTC: wire.EndUTC, BodyID: wire.BodyID, MinAltitudeDeg: *wire.MinAltitudeDeg, MaxSunAltitudeDeg: wire.MaxSunAltitudeDeg, Station: observation.Station{LongitudeDeg: *wire.Station.LongitudeDeg, LatitudeDeg: *wire.Station.LatitudeDeg, HeightMeters: *wire.Station.HeightMeters}}
	if err := req.Validate(); err != nil {
		var typed *observation.Error
		errors.As(err, &typed)
		s.error(w, 400, typed.Code, typed.Message)
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
	result, err := observation.SearchVisibility(ctx, req, s.earthOrientation, s.catalog.EvalBatchContext)
	if err != nil {
		s.observationError(w, ctx, err)
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "catalogManifestSha256": s.catalog.ManifestHash(), "earthOrientation": s.earthOrientation.Manifest, "result": result})
}
