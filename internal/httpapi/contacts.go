package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/observation"
)

// ConfigureBodyRadii installs a verified immutable table before serving requests.
func (s *Server) ConfigureBodyRadii(table *bodyshape.Table) { s.bodyRadii = table }

func (s *Server) contactMetadata() map[string]any {
	return map[string]any{"available": s.bodyRadii != nil && s.earthOrientation != nil, "model": "earth-station-cn-spherical-contacts-v1",
		"maxWindowSeconds": observation.MaxWindowSeconds, "stepSeconds": observation.ContactStepSeconds, "toleranceSeconds": observation.ContactToleranceSeconds,
		"maxEvaluations": observation.MaxWindowEvaluations, "maxContacts": observation.MaxGroundContacts, "radiusSourceSha256": bodyshape.SHA256,
		"radiusSourceUrl": bodyshape.SourceURL, "coverage": "sampled-sign-changes-only"}
}

func (s *Server) observationContacts(w http.ResponseWriter, r *http.Request) {
	var wire struct {
		StartUTC     string `json:"startUtc"`
		EndUTC       string `json:"endUtc"`
		ForegroundID int    `json:"foregroundId"`
		BackgroundID int    `json:"backgroundId"`
		Aberration   string `json:"aberration"`
		Station      *struct {
			LongitudeDeg *float64 `json:"longitudeDeg"`
			LatitudeDeg  *float64 `json:"latitudeDeg"`
			HeightMeters *float64 `json:"heightMeters"`
		} `json:"station"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		s.error(w, 400, "invalid_contact_request", "expected a bounded contact request with known fields")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		s.error(w, 400, "invalid_contact_request", "expected exactly one request object")
		return
	}
	if wire.Station == nil || wire.Station.LongitudeDeg == nil || wire.Station.LatitudeDeg == nil || wire.Station.HeightMeters == nil {
		s.error(w, 400, "invalid_station", "explicit longitudeDeg, latitudeDeg and heightMeters are required")
		return
	}
	req := observation.ContactRequest{StartUTC: wire.StartUTC, EndUTC: wire.EndUTC, ForegroundID: wire.ForegroundID, BackgroundID: wire.BackgroundID, Aberration: wire.Aberration,
		Station: observation.Station{LongitudeDeg: *wire.Station.LongitudeDeg, LatitudeDeg: *wire.Station.LatitudeDeg, HeightMeters: *wire.Station.HeightMeters}}
	if err := req.Validate(); err != nil {
		var typed *observation.Error
		if errors.As(err, &typed) {
			s.error(w, 400, typed.Code, typed.Message)
		} else {
			s.error(w, 400, "invalid_contact_request", err.Error())
		}
		return
	}
	if s.bodyRadii == nil {
		s.error(w, 503, "body_radii_unavailable", "no pinned PCK radii are configured")
		return
	}
	if s.earthOrientation == nil {
		s.error(w, 503, "earth_orientation_unavailable", "no pinned IERS Earth orientation snapshot is configured")
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
	result, err := observation.SearchGroundContacts(ctx, req, s.bodyRadii, s.earthOrientation, s.catalog.EvalBatchContext)
	if err != nil {
		s.observationError(w, ctx, err)
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "catalogManifestSha256": s.catalog.ManifestHash(), "result": result})
}
