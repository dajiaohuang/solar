package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/orbituncertainty"
)

// Allows the 2 MiB source limit after base64 expansion, plus the JSON envelope.
const orbitCovarianceRequestBytes = 3 << 20

func (s *Server) orbitCovarianceInspect(w http.ResponseWriter, r *http.Request) {
	s.orbitCovariance(w, r, false)
}

func (s *Server) orbitCovarianceConvert(w http.ResponseWriter, r *http.Request) {
	s.orbitCovariance(w, r, true)
}

func (s *Server) orbitCovariance(w http.ResponseWriter, r *http.Request, convert bool) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var wire struct {
		Original []byte                           `json:"originalSbdbBase64"`
		GM       *orbituncertainty.AdoptedSolarGM `json:"adoptedSolarGM"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, orbitCovarianceRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "orbit_covariance_request_too_large", "orbit covariance request exceeds 3 MiB")
		} else {
			s.error(w, 400, "invalid_orbit_covariance_request", "expected originalSbdbBase64 with original SBDB JSON bytes")
		}
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "orbit_covariance_request_too_large", "orbit covariance request exceeds 3 MiB")
		} else {
			s.error(w, 400, "invalid_orbit_covariance_request", "exactly one request object is required")
		}
		return
	}
	if len(wire.Original) == 0 || len(wire.Original) > orbituncertainty.MaxSourceBytes {
		s.error(w, 422, "invalid_orbit_covariance_source", "original SBDB JSON must contain 1 byte to 2 MiB")
		return
	}
	if convert != (wire.GM != nil) {
		s.error(w, 400, "invalid_orbit_covariance_request", "conversion requires adoptedSolarGM; inspection does not accept an adopted GM")
		return
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit covariance work cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, 429, "overloaded", "orbit covariance compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	var result any
	key := "inspection"
	if convert {
		key = "conversion"
		result, err = orbituncertainty.Convert(ctx, wire.Original, *wire.GM)
	} else {
		result, err = orbituncertainty.Inspect(ctx, wire.Original)
	}
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit covariance work cancelled or deadline exceeded")
		} else {
			s.error(w, 422, "invalid_orbit_covariance_source", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, key: result}, 4<<20)
}
