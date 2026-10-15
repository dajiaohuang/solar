package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

const ensembleMaxEvaluations = 250000

type EnsembleEndpoint struct {
	Index            int                `json:"index"`
	Valid            bool               `json:"valid"`
	State            []float64          `json:"state"`
	Integration      *IntegrationResult `json:"integration"`
	ForceEvaluations int                `json:"forceEvaluations"`
	FailureStage     string             `json:"failureStage,omitempty"`
	Failure          string             `json:"failure,omitempty"`
}

type SourceOffsetEnsemble struct {
	Method           string                   `json:"method"`
	Initial          *SourceOffsetCoordinates `json:"initial"`
	ForceModel       DE440Evidence            `json:"forceModel"`
	Frame            string                   `json:"frame"`
	Labels           []string                 `json:"labels"`
	Units            []*string                `json:"units"`
	FinalEpoch       RelativeEpoch            `json:"finalEpoch"`
	Endpoints        []EnsembleEndpoint       `json:"endpoints"`
	Moments          *EnsembleMoments         `json:"moments"`
	ForceEvaluations int                      `json:"forceEvaluations"`
	MaxEvaluations   int                      `json:"maxEvaluations"`
	Limitations      []string                 `json:"limitations"`
}

// PropagateSourceOffsets serially advances a bounded ensemble against one
// frozen DE440 model. The run-local force cache is never shared concurrently.
// Budget exhaustion and cancellation fail the entire request; ordinary draw
// failures remain indexed and must not be silently removed from summaries.
func PropagateSourceOffsets(ctx context.Context, original []byte, options DE440Options, offsets []float64, durationSeconds float64) (*SourceOffsetEnsemble, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !finite(durationSeconds) || math.Abs(durationSeconds) > 365*86400 ||
		len(offsets) < 6 || len(offsets) > 128*6 || len(offsets)%6 != 0 {
		return nil, errors.New("ensemble requires 1 to 128 six-axis draws and duration within 365 days")
	}
	// Own caller data before constructing the source model.
	owned := append([]float64(nil), offsets...)
	for _, value := range owned {
		if !finite(value) {
			return nil, errors.New("ensemble offsets must be finite")
		}
	}
	if durationSeconds < options.ElapsedRangeSeconds[0] || durationSeconds > options.ElapsedRangeSeconds[1] {
		return nil, errors.New("ensemble endpoint outside frozen force window")
	}
	dynamics, err := NewDE440Dynamics(ctx, options)
	if err != nil {
		return nil, err
	}
	const au, day = 149597870.7, 86400.0
	solar := dynamics.Evidence.Gravity.Masses[0]
	initial, err := ConvertSourceOffsets(ctx, original, AdoptedSolarGM{
		AU3PerDay2: solar.GMKm3PerSecond2 * day * day / (au * au * au), Source: solar.GMSource}, owned)
	if err != nil {
		return nil, err
	}
	source := &initial.Conversion.Inspection.Source
	if initial.Dimension != 6 || len(source.AdditionalParameters) != 0 {
		return nil, errors.New("ensemble requires matched forces for every additional estimated covariance parameter; no axes may be dropped")
	}
	if source.SolutionEpochTDB != options.ReferenceEpochTDB {
		return nil, errors.New("ensemble must begin at covariance solution epoch")
	}
	sun0, err := dynamics.State(ctx, 10, 0)
	if err != nil {
		return nil, err
	}
	sun1, err := dynamics.State(ctx, 10, durationSeconds)
	if err != nil {
		return nil, err
	}
	result := &SourceOffsetEnsemble{Method: "nonlinear-joint-source-offsets-restricted-dynamics-v1",
		Initial: initial, ForceModel: dynamics.Evidence, Frame: source.Frame,
		Labels:     append([]string(nil), initial.Conversion.Coordinates.Labels...),
		Units:      append([]*string(nil), initial.Conversion.Coordinates.Units...),
		FinalEpoch: RelativeEpoch{source.SolutionEpochTDB, durationSeconds},
		Endpoints:  make([]EnsembleEndpoint, len(initial.Draws)), MaxEvaluations: ensembleMaxEvaluations,
		Limitations: []string{
			"Caller-supplied finite joint offsets under fixed DE440 inputs and adopted forces, not a calibrated probability sample or the complete SBDB orbit-fit model.",
			"Six source axes only; additional estimated force axes cannot be discarded.",
			"Failed draws retain indices and offsets with null endpoints; do not silently omit them from denominators or distribution summaries.",
			"Endpoint states only; no dense output, event search, probability or continuous collision detection.",
			"Each nonzero-duration draw uses six-state DP54 integration, local tolerances 1e-5 km and 1e-12 km/s, relative tolerance 1e-12, initial/max steps 3600/86400 seconds and 20000 attempts.",
			"Zero-duration valid draws are exact coordinate identities with no integration receipt or force evaluations; this supplies no convergence evidence.",
			"Force-evaluation counts include failing derivative calls; ephemeris source setup and endpoint frame translations are outside this count. Caller context bounds all work.",
			"Integration states are J2000 SSB km and km/s; endpoint states use the recorded heliocentric frame and au, au/d units. Numerical tolerances are not physical error bounds.",
		}}
	budgetError := errors.New("ensemble exhausted shared 250000 force-evaluation budget")
	derivative := func(callContext context.Context, elapsed float64, state, output []float64) error {
		if err := callContext.Err(); err != nil {
			return err
		}
		if result.ForceEvaluations >= ensembleMaxEvaluations {
			return budgetError
		}
		result.ForceEvaluations++
		return dynamics.Derivative(callContext, elapsed, state, output)
	}
	s, c := math.Sincos(84381.448 / 3600 * math.Pi / 180)
	for index, draw := range initial.Draws {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		endpoint := EnsembleEndpoint{Index: index}
		if !draw.Valid {
			endpoint.FailureStage, endpoint.Failure = "coordinates", draw.Failure
			result.Endpoints[index] = endpoint
			continue
		}
		if durationSeconds == 0 {
			endpoint.Valid, endpoint.State = true, append([]float64(nil), draw.State...)
			result.Endpoints[index] = endpoint
			continue
		}
		barycentric := make([]float64, 6)
		for _, start := range []int{0, 3} {
			scale := au
			if start == 3 {
				scale /= day
			}
			barycentric[start] = draw.State[start]*scale + sun0[start]
			barycentric[start+1] = (c*draw.State[start+1]-s*draw.State[start+2])*scale + sun0[start+1]
			barycentric[start+2] = (s*draw.State[start+1]+c*draw.State[start+2])*scale + sun0[start+2]
		}
		before := result.ForceEvaluations
		integration, err := Integrate(ctx, IntegrationOptions{Initial: barycentric, Duration: durationSeconds,
			Derivative: derivative, AbsoluteTolerance: []float64{1e-5, 1e-5, 1e-5, 1e-12, 1e-12, 1e-12},
			RelativeTolerance: 1e-12, InitialStep: 3600, MaxStep: day, MaxAttempts: 20000})
		endpoint.ForceEvaluations = result.ForceEvaluations - before
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if errors.Is(err, budgetError) {
			return nil, err
		}
		if err != nil {
			endpoint.FailureStage, endpoint.Failure = "integration", err.Error()
			result.Endpoints[index] = endpoint
			continue
		}
		endpoint.Integration = integration
		state, relative := make([]float64, 6), make([]float64, 6)
		for k := range relative {
			relative[k] = integration.State[k] - sun1[k]
		}
		for _, start := range []int{0, 3} {
			scale := 1 / au
			if start == 3 {
				scale *= day
			}
			state[start] = relative[start] * scale
			state[start+1] = (c*relative[start+1] + s*relative[start+2]) * scale
			state[start+2] = (-s*relative[start+1] + c*relative[start+2]) * scale
		}
		endpoint.Valid = true
		for _, value := range state {
			if !finite(value) {
				endpoint.Valid = false
				endpoint.FailureStage, endpoint.Failure = "projection", "ensemble endpoint exceeds numerical range"
				break
			}
		}
		if endpoint.Valid {
			endpoint.State = state
		}
		result.Endpoints[index] = endpoint
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result.Moments, err = summarizeEnsemble(ctx, result.Endpoints)
	if err != nil {
		return nil, err
	}
	return result, nil
}
