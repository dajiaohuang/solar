package httpapi

import (
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

// Pointers distinguish an explicit zero from missing or null scientific inputs.
func (s *Server) orbitEnsembleEvents(w http.ResponseWriter, r *http.Request) {
	if s.orbitSource == nil {
		s.error(w, 503, "orbit_source_unavailable", "pinned DE440 dynamics source is not installed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var wire struct {
		Original        []byte             `json:"originalSbdbBase64"`
		ReferenceEpoch  *float64           `json:"referenceEpochTdb"`
		Start           *float64           `json:"startSeconds"`
		End             *float64           `json:"endSeconds"`
		Step            *float64           `json:"maxStepSeconds"`
		Tolerance       *float64           `json:"toleranceSeconds"`
		Evaluations     *int               `json:"maxEvaluations"`
		Events          *int               `json:"maxEvents"`
		Target          *int               `json:"targetNaifId"`
		Distance        *float64           `json:"distanceKm"`
		Adopt           bool               `json:"adoptRestrictedDE440"`
		Exclusions      orbitExclusions    `json:"exclusionKm"`
		SolarRelativity bool               `json:"solarRelativity"`
		Offsets         orbitSourceOffsets `json:"offsets"`
	}
	invalid := func(message string) { s.error(w, 400, "invalid_orbit_event_request", message) }
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, orbitCovarianceRequestBytes))
	decoder.DisallowUnknownFields()
	decodeError := func(err error) {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, 413, "orbit_event_request_too_large", "orbit event request exceeds 3 MiB")
		} else {
			invalid("expected one object with original source bytes and explicit event settings")
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
	if wire.ReferenceEpoch == nil || wire.Start == nil || wire.End == nil || wire.Step == nil || wire.Tolerance == nil || wire.Evaluations == nil || wire.Events == nil || wire.Target == nil || wire.Distance == nil || !wire.Adopt || len(wire.Offsets) < 6 || len(wire.Original) == 0 || len(wire.Original) > orbituncertainty.MaxSourceBytes {
		invalid("explicit event settings, restricted-DE440 adoption, six-axis offsets and 1 byte to 2 MiB original source required")
		return
	}
	for _, value := range []float64{*wire.ReferenceEpoch, *wire.Start, *wire.End, *wire.Step, *wire.Tolerance, *wire.Distance} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			invalid("event settings must be finite")
			return
		}
	}
	if *wire.Start > *wire.End || math.Max(math.Abs(*wire.Start), math.Abs(*wire.End)) > 365*86400 || *wire.Step <= 0 || *wire.Tolerance <= 0 || *wire.Tolerance > *wire.Step || *wire.Distance <= 0 || *wire.Evaluations < 1 || *wire.Evaluations > 2048 || *wire.Events < 1 || *wire.Events > 128 {
		invalid("ordered window within 365 days, positive distance and step, tolerance no larger than step, 1..2048 evaluations and 1..128 events required")
		return
	}
	intervals := 0.0
	if *wire.End > *wire.Start {
		intervals = math.Max(1, math.Ceil((*wire.End-*wire.Start) / *wire.Step))
	}
	if intervals+1 > float64(*wire.Evaluations) {
		invalid("scan exceeds evaluation budget")
		return
	}
	ids := []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9}
	targetFound := false
	if len(wire.Exclusions) != len(ids) {
		invalid("explicit exclusions for the eleven pinned force bodies required")
		return
	}
	for _, id := range ids {
		if _, ok := wire.Exclusions[id]; !ok {
			invalid("exclusions differ from pinned mass plan")
			return
		}
		if id == *wire.Target {
			targetFound = true
		}
	}
	if !targetFound {
		invalid("event target must be a pinned force body")
		return
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit event search cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, 429, "overloaded", "orbit event compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	settings := orbituncertainty.DistanceEventSettings{TargetNAIFID: *wire.Target, DistanceKm: *wire.Distance,
		Search: orbituncertainty.TrajectoryEventSettings{ReferenceEpochTDB: *wire.ReferenceEpoch, StartSeconds: *wire.Start, EndSeconds: *wire.End, MaxStepSeconds: *wire.Step, ToleranceSeconds: *wire.Tolerance, MaxEvaluations: *wire.Evaluations, MaxEvents: *wire.Events}}
	result, err := orbituncertainty.SearchSourceOffsetDistanceEvents(ctx, wire.Original, orbituncertainty.DE440Options{
		Source: s.orbitSource, ReferenceEpochTDB: *wire.ReferenceEpoch, ElapsedRangeSeconds: [2]float64{math.Min(0, *wire.Start), math.Max(0, *wire.End)}, ExclusionKm: wire.Exclusions, SolarRelativity: wire.SolarRelativity}, wire.Offsets, settings)
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, 408, "cancelled", "orbit event search cancelled or deadline exceeded")
		} else {
			s.error(w, 422, "invalid_orbit_event_ensemble", err.Error())
		}
		return
	}
	s.jsonLimited(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "eventEnsemble": result}, 8<<20)
}
