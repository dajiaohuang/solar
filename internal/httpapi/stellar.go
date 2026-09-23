package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

// Includes base64 expansion of the 1 MiB manifest and 8 MiB CSV plus wire metadata.
const stellarRequestBytes = 13 << 20

func (s *Server) stellarMotion(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var wire struct {
		Manifest         []byte   `json:"originalManifestBase64"`
		Rows             []byte   `json:"originalRowsCsvBase64"`
		SourceID         string   `json:"sourceId"`
		Epoch            *float64 `json:"targetEpochJulianYearTCB"`
		Policy           string   `json:"radialVelocityPolicy"`
		CovariancePolicy string   `json:"covariancePolicy"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, stellarRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "stellar_request_too_large", "stellar request exceeds 13 MiB")
		} else {
			s.error(w, 400, "invalid_stellar_request", "expected bounded original-source bytes and known fields")
		}
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || wire.Epoch == nil {
		s.error(w, 400, "invalid_stellar_request", "exactly one object with an explicit TCB target epoch is required")
		return
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "stellar motion cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, 429, "overloaded", "stellar compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	result, err := stellarmotion.FromCSVWithCovariance(ctx, wire.Manifest, wire.Rows, wire.SourceID, *wire.Epoch, wire.Policy, wire.CovariancePolicy)
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "stellar motion cancelled or deadline exceeded")
		} else {
			s.error(w, 422, "invalid_stellar_source", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "experiment": result}, 14<<20)
}
