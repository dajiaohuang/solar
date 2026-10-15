package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/orbituncertainty"
)

// Decode distances without JSON's null-to-zero or numeric-key coercions.
// Duplicate entries are rejected rather than silently replacing a force boundary.
type orbitExclusions map[int]float64

func (distances *orbitExclusions) UnmarshalJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return errors.New("exclusionKm must be an object of explicit distances")
	}
	result := make(orbitExclusions, 11)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := token.(string)
		if !ok {
			return errors.New("invalid exclusion body key")
		}
		id, err := strconv.Atoi(key)
		if err != nil || strconv.Itoa(id) != key {
			return errors.New("exclusion bodies require canonical NAIF integer keys")
		}
		if _, duplicate := result[id]; duplicate {
			return errors.New("duplicate exclusion body")
		}
		if len(result) >= 11 {
			return errors.New("at most eleven exclusion bodies are supported")
		}
		var value *float64
		if err := decoder.Decode(&value); err != nil {
			return err
		}
		if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 {
			return errors.New("exclusion distance must be an explicit finite nonnegative number")
		}
		result[id] = *value
	}
	if _, err := decoder.Token(); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("one exclusion object required")
	}
	*distances = result
	return nil
}

// ConfigureOrbitSource installs a verified immutable snapshot before serving.
// Nil disables temporal propagation. Do not call concurrently with requests.
func (s *Server) ConfigureOrbitSource(source *orbituncertainty.DE440Source) {
	s.orbitSource = source
}

func (s *Server) orbitCovariancePropagate(w http.ResponseWriter, r *http.Request) {
	if s.orbitSource == nil {
		s.error(w, 503, "orbit_source_unavailable", "pinned DE440 dynamics source is not installed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var wire struct {
		Original          []byte                              `json:"originalSbdbBase64"`
		ReferenceEpoch    *float64                            `json:"referenceEpochTdb"`
		Duration          *float64                            `json:"durationSeconds"`
		Adopt             bool                                `json:"adoptRestrictedDE440"`
		Exclusions        orbitExclusions                     `json:"exclusionKm"`
		SolarRelativity   bool                                `json:"solarRelativity"`
		CompareRefinement bool                                `json:"compareRefinement"`
		Radiation         *orbituncertainty.RadiationPressure `json:"solarRadiationPressure"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, orbitCovarianceRequestBytes))
	decoder.DisallowUnknownFields()
	decodeError := func(err error) {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "orbit_covariance_request_too_large", "orbit covariance request exceeds 3 MiB")
		} else {
			s.error(w, 400, "invalid_orbit_propagation_request", "expected one object with original source bytes and explicit propagation settings")
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
	if wire.ReferenceEpoch == nil || wire.Duration == nil || !wire.Adopt || len(wire.Original) == 0 || len(wire.Original) > orbituncertainty.MaxSourceBytes {
		s.error(w, 400, "invalid_orbit_propagation_request", "explicit source epoch, duration, restricted-DE440 adoption and 1 byte to 2 MiB original source required")
		return
	}
	if math.IsNaN(*wire.ReferenceEpoch) || math.IsInf(*wire.ReferenceEpoch, 0) || math.IsNaN(*wire.Duration) || math.IsInf(*wire.Duration, 0) || math.Abs(*wire.Duration) > 365*86400 {
		s.error(w, 400, "invalid_orbit_propagation_request", "finite reference epoch and duration within 365 days required")
		return
	}
	// Exact plan: source-barycenter and constituent mass duplication is forbidden.
	ids := []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9}
	if len(wire.Exclusions) != len(ids) {
		s.error(w, 400, "invalid_orbit_propagation_request", "explicit exclusion distances required for the eleven pinned force bodies")
		return
	}
	for _, id := range ids {
		if _, ok := wire.Exclusions[id]; !ok {
			s.error(w, 400, "invalid_orbit_propagation_request", "exclusion body selection differs from pinned mass plan")
			return
		}
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit propagation cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, 429, "overloaded", "orbit propagation compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	start, end := 0.0, *wire.Duration
	if end < 0 {
		start, end = end, 0
	}
	result, err := orbituncertainty.PropagateCovarianceWithRefinement(ctx, wire.Original, orbituncertainty.DE440Options{
		Source: s.orbitSource, ReferenceEpochTDB: *wire.ReferenceEpoch, ElapsedRangeSeconds: [2]float64{start, end}, ExclusionKm: wire.Exclusions,
		SolarRelativity: wire.SolarRelativity, SolarRadiationPressure: wire.Radiation}, *wire.Duration, wire.CompareRefinement)
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit propagation cancelled or deadline exceeded")
		} else {
			s.error(w, 422, "invalid_orbit_propagation", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "propagation": result}, 4<<20)
}
