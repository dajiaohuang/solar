package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/orbituncertainty"
)

// Reject null components instead of accepting encoding/json's null-to-zero
// conversion. Limit retained values before reading the rest of a large array.
type orbitSourceOffsets []float64

func (offsets *orbitSourceOffsets) UnmarshalJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('[') {
		return errors.New("offsets must be a flat array of explicit numbers")
	}
	values := make(orbitSourceOffsets, 0, 6)
	for decoder.More() {
		if len(values) >= 128*6 {
			return errors.New("at most 128 six-axis source draws are supported")
		}
		var value *float64
		if err := decoder.Decode(&value); err != nil {
			return err
		}
		if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) {
			return errors.New("source offsets must be explicit finite numbers")
		}
		values = append(values, *value)
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim(']') || len(values) < 6 || len(values)%6 != 0 {
		return errors.New("offsets require 1 to 128 complete six-axis draws")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("one source-offset array required")
	}
	*offsets = values
	return nil
}

func (s *Server) orbitEnsemblePropagate(w http.ResponseWriter, r *http.Request) {
	if s.orbitSource == nil {
		s.error(w, 503, "orbit_source_unavailable", "pinned DE440 dynamics source is not installed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var wire struct {
		Original        []byte                              `json:"originalSbdbBase64"`
		ReferenceEpoch  *float64                            `json:"referenceEpochTdb"`
		Duration        *float64                            `json:"durationSeconds"`
		Adopt           bool                                `json:"adoptRestrictedDE440"`
		Exclusions      orbitExclusions                     `json:"exclusionKm"`
		SolarRelativity bool                                `json:"solarRelativity"`
		Offsets         orbitSourceOffsets                  `json:"offsets"`
		Radiation       *orbituncertainty.RadiationPressure `json:"solarRadiationPressure"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, orbitCovarianceRequestBytes))
	decoder.DisallowUnknownFields()
	decodeError := func(err error) {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "orbit_ensemble_request_too_large", "orbit ensemble request exceeds 3 MiB")
		} else {
			s.error(w, 400, "invalid_orbit_ensemble_request", "expected one object with original source bytes and explicit propagation settings")
		}
	}
	if err := decoder.Decode(&wire); err != nil {
		decodeError(err)
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		decodeError(err)
		return
	}
	if wire.ReferenceEpoch == nil || wire.Duration == nil || !wire.Adopt || len(wire.Offsets) < 6 || len(wire.Offsets)%6 != 0 || len(wire.Original) == 0 || len(wire.Original) > orbituncertainty.MaxSourceBytes {
		s.error(w, 400, "invalid_orbit_ensemble_request", "explicit source epoch, duration, restricted-DE440 adoption, 1 to 128 complete six-axis offset draws and 1 byte to 2 MiB original source required")
		return
	}
	if math.IsNaN(*wire.ReferenceEpoch) || math.IsInf(*wire.ReferenceEpoch, 0) || math.IsNaN(*wire.Duration) || math.IsInf(*wire.Duration, 0) || math.Abs(*wire.Duration) > 365*86400 {
		s.error(w, 400, "invalid_orbit_ensemble_request", "finite reference epoch and duration within 365 days required")
		return
	}
	// Exact plan: source-barycenter and constituent mass duplication is forbidden.
	ids := []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9}
	if len(wire.Exclusions) != len(ids) {
		s.error(w, 400, "invalid_orbit_ensemble_request", "explicit exclusion distances required for the eleven pinned force bodies")
		return
	}
	for _, id := range ids {
		if _, ok := wire.Exclusions[id]; !ok {
			s.error(w, 400, "invalid_orbit_ensemble_request", "exclusion body selection differs from pinned mass plan")
			return
		}
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit ensemble cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, 429, "overloaded", "orbit ensemble compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	start, end := 0.0, *wire.Duration
	if end < 0 {
		start, end = end, 0
	}
	result, err := orbituncertainty.PropagateSourceOffsets(ctx, wire.Original, orbituncertainty.DE440Options{
		Source: s.orbitSource, ReferenceEpochTDB: *wire.ReferenceEpoch, ElapsedRangeSeconds: [2]float64{start, end}, ExclusionKm: wire.Exclusions,
		SolarRelativity: wire.SolarRelativity, SolarRadiationPressure: wire.Radiation}, wire.Offsets, *wire.Duration)
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit ensemble cancelled or deadline exceeded")
		} else {
			s.error(w, 422, "invalid_orbit_ensemble", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "ensemble": result}, 4<<20)
}
