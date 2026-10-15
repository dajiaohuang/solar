package orbituncertainty

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
)

type PointMass struct {
	NAIFID          int     `json:"naifId"`
	GMKm3PerSecond2 float64 `json:"gmKm3PerSecond2"`
	GMSource        string  `json:"gmSource"`
	ExclusionKm     float64 `json:"exclusionKm"`
}

type PrescribedEphemeris struct {
	Frame               string
	Origin              string
	TimeScale           string
	Aberration          string
	ReferenceEpochTDB   float64
	ElapsedRangeSeconds [2]float64
	Source              string
	// Must fill every XYZ triple in the given body order, or report a gap.
	// Inputs and output are borrowed and cannot be retained or mutated later.
	Positions func(context.Context, float64, []int, []float64) error
}

type GravityEvidence struct {
	Model               string      `json:"model"`
	Masses              []PointMass `json:"masses"`
	Frame               string      `json:"frame"`
	Origin              string      `json:"origin"`
	TimeScale           string      `json:"timeScale"`
	Aberration          string      `json:"aberration"`
	ReferenceEpochTDB   float64     `json:"referenceEpochTdb"`
	ElapsedRangeSeconds [2]float64  `json:"elapsedRangeSeconds"`
	EphemerisSource     string      `json:"ephemerisSource"`
	StateUnits          []string    `json:"stateUnits"`
	Limitations         []string    `json:"limitations"`
}

// PointMassGravity returns a per-run derivative with reusable scratch buffers.
// Do not call one derivative concurrently. New runs need separate instances.
// Barycentric inertial coordinates avoid dropping the indirect acceleration
// of a moving heliocentric origin. The prescribed masses do not react to the
// test particle. Additional fitted SBDB parameters are not silently frozen.
func PointMassGravity(input []PointMass, ephemeris PrescribedEphemeris) (Derivative, *GravityEvidence, error) {
	if len(input) == 0 || len(input) > 32 || ephemeris.Positions == nil ||
		ephemeris.Frame != "J2000" || ephemeris.Origin != "SSB" || ephemeris.TimeScale != "TDB" || ephemeris.Aberration != "NONE" ||
		!finite(ephemeris.ReferenceEpochTDB) || !finite(ephemeris.ElapsedRangeSeconds[0]) || !finite(ephemeris.ElapsedRangeSeconds[1]) ||
		ephemeris.ElapsedRangeSeconds[0] > ephemeris.ElapsedRangeSeconds[1] || strings.TrimSpace(ephemeris.Source) == "" {
		return nil, nil, errors.New("invalid prescribed inertial ephemeris contract")
	}
	masses := append([]PointMass(nil), input...)
	ids := make([]int, len(masses))
	seen := make(map[int]bool, len(masses))
	for i, mass := range masses {
		if seen[mass.NAIFID] || !finite(mass.GMKm3PerSecond2) || mass.GMKm3PerSecond2 <= 0 || strings.TrimSpace(mass.GMSource) == "" || !finite(mass.ExclusionKm) || mass.ExclusionKm < 0 {
			return nil, nil, errors.New("invalid or duplicate prescribed point mass")
		}
		seen[mass.NAIFID] = true
		ids[i] = mass.NAIFID
	}
	positions := make([]float64, 3*len(masses))
	var gradient [9]float64
	derivative := func(ctx context.Context, elapsed float64, state, output []float64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !finite(elapsed) || elapsed < ephemeris.ElapsedRangeSeconds[0] || elapsed > ephemeris.ElapsedRangeSeconds[1] {
			return errors.New("force epoch outside prescribed coverage")
		}
		if (len(state) != 6 && len(state) != 42) || len(output) != len(state) {
			return errors.New("expected six-state or six-state plus row-major 6x6 transition matrix")
		}
		for _, value := range state {
			if !finite(value) {
				return errors.New("nonfinite force input state")
			}
		}
		for i := range positions {
			positions[i] = math.NaN()
		}
		if err := ephemeris.Positions(ctx, elapsed, ids, positions); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		for _, value := range positions {
			if !finite(value) {
				return errors.New("prescribed ephemeris did not fill every finite mass position")
			}
		}
		for i := range output {
			output[i] = 0
		}
		gradient = [9]float64{}
		copy(output[:3], state[3:6])
		variational := len(state) == 42
		for i, mass := range masses {
			if err := ctx.Err(); err != nil {
				return err
			}
			d := [3]float64{positions[3*i] - state[0], positions[3*i+1] - state[1], positions[3*i+2] - state[2]}
			distance := math.Hypot(math.Hypot(d[0], d[1]), d[2])
			if !finite(distance) || distance == 0 || distance <= mass.ExclusionKm {
				return &TrajectorySampleError{Message: fmt.Sprintf("point-mass exclusion reached for NAIF %d", mass.NAIFID)}
			}
			unit := [3]float64{d[0] / distance, d[1] / distance, d[2] / distance}
			acceleration := mass.GMKm3PerSecond2 / distance / distance
			curvature := acceleration / distance
			for row := 0; row < 3; row++ {
				output[row+3] += acceleration * unit[row]
				if variational {
					for column := 0; column < 3; column++ {
						identity := 0.0
						if row == column {
							identity = 1
						}
						gradient[3*row+column] += curvature * (3*unit[row]*unit[column] - identity)
					}
				}
			}
		}
		if variational {
			for row := 0; row < 3; row++ {
				for column := 0; column < 6; column++ {
					output[6+row*6+column] = state[6+(row+3)*6+column]
					for k := 0; k < 3; k++ {
						output[6+(row+3)*6+column] += gradient[3*row+k] * state[6+k*6+column]
					}
				}
			}
		}
		for _, value := range output {
			if !finite(value) {
				return errors.New("force or variational derivative became nonfinite")
			}
		}
		return ctx.Err()
	}
	evidence := &GravityEvidence{Model: "restricted-newtonian-prescribed-point-masses",
		Masses: append([]PointMass(nil), masses...), Frame: ephemeris.Frame, Origin: ephemeris.Origin, TimeScale: ephemeris.TimeScale,
		Aberration: ephemeris.Aberration, ReferenceEpochTDB: ephemeris.ReferenceEpochTDB, ElapsedRangeSeconds: ephemeris.ElapsedRangeSeconds,
		EphemerisSource: ephemeris.Source, StateUnits: []string{"km", "km", "km", "km/s", "km/s", "km/s"},
		Limitations: []string{
			"Force parameters and prescribed mass trajectories are fixed.",
			"No relativistic, harmonic, non-gravitational or test-particle back-reaction forces.",
			"No physical uncertainty, event probability or full orbit-fit model equivalence is established.",
			"Exclusions are checked at force evaluations; continuous collision detection is not implemented.",
			"Caller must avoid overlapping system-barycenter and constituent mass representations.",
		}}
	return derivative, evidence, nil
}

func WithIdentityTransition(initial []float64) ([]float64, error) {
	if len(initial) != 6 {
		return nil, errors.New("finite six-component initial state required")
	}
	for _, value := range initial {
		if !finite(value) {
			return nil, errors.New("finite six-component initial state required")
		}
	}
	state := make([]float64, 42)
	copy(state, initial)
	for i := 0; i < 6; i++ {
		state[6+i*6+i] = 1
	}
	return state, nil
}
