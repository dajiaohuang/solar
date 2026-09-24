package stellarmotion

import (
	"context"
	"fmt"
	"math"

	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/observation"
	"github.com/hebl/gofa"
)

const ObserverModel = "source-gaia-starpm-pmpx-earth-station-v1"

// ObserverExperiment retains both independently sourced inputs. Direction is
// coordinate BCRS, not an observed horizontal or refracted sky position.
type ObserverExperiment struct {
	SchemaVersion int                           `json:"schemaVersion"`
	Model         string                        `json:"model"`
	Stellar       *Experiment                   `json:"stellar"`
	Observation   *observation.Result           `json:"observation"`
	Direction     [3]float64                    `json:"coordinateDirectionBcrs"`
	RADeg         float64                       `json:"raDeg"`
	DecDeg        float64                       `json:"decDeg"`
	EpochTDB      [2]float64                    `json:"epochJdTdbParts"`
	ResidualYears float64                       `json:"propagationResidualTdbJulianYears"`
	Observed      *observation.StellarDirection `json:"observed"`
	Limitations   []string                      `json:"limitations"`
}

// FromCSVAtStation derives the stellar epoch from the source-backed observer,
// never from a second independently entered epoch. The same compute admission
// lease must cover this call and the supplied catalog evaluator.
func FromCSVAtStation(ctx context.Context, manifest, rows []byte, id, rvPolicy, utc string, station observation.Station, atmosphere *observation.Atmosphere, eop *earthorientation.Table, evaluate observation.Evaluator) (*ObserverExperiment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	obs, err := observation.Evaluate(ctx, observation.Request{UTC: utc, Station: station, Atmosphere: atmosphere, BodyIDs: []string{"naif:10"}}, eop, evaluate)
	if err != nil {
		return nil, err
	}
	state := obs.ObserverState
	if state.Frame != "J2000" || state.Origin != "solar-system-barycenter" {
		return nil, fmt.Errorf("unsupported stellar observer frame or origin")
	}
	var tcb1, tcb2 float64
	gofa.Tdbtcb(state.EpochTDB[0], state.EpochTDB[1], &tcb1, &tcb2)
	year := 2000 + ((tcb1-gofa.DJ00)+tcb2)/gofa.DJY
	stellar, err := FromCSVContext(ctx, manifest, rows, id, year, rvPolicy)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// The year representation may round the epoch slightly. Preserve the
	// residual in split-date arithmetic instead of treating it as exactly zero.
	target := stellar.Result.TargetTDB
	pmt := ((state.EpochTDB[0] - target[0]) + (state.EpochTDB[1] - target[1])) / gofa.DJY
	const f = 1 - gofa.ELB
	nominal := stellar.Result.State
	dec := nominal.Dec * gofa.DD2R
	pr := nominal.PMRA * gofa.DMAS2R / math.Cos(dec) / f
	pd := nominal.PMDec * gofa.DMAS2R / f
	px := nominal.Parallax / 1000 / f
	var observerAU [3]float64
	for i, value := range state.PositionKM {
		observerAU[i] = value / (gofa.DAU / 1000)
		if !finite(observerAU[i]) {
			return nil, fmt.Errorf("non-finite stellar observer position")
		}
	}
	if !finite(pr) || !finite(pd) || !finite(px) || !finite(pmt) {
		return nil, fmt.Errorf("non-finite observer stellar parameters")
	}
	var direction [3]float64
	gofa.Pmpx(nominal.RA*gofa.DD2R, dec, pr, pd, px, nominal.RadialVelocity, pmt, observerAU, &direction)
	for _, value := range direction {
		if !finite(value) {
			return nil, fmt.Errorf("non-finite observer stellar direction")
		}
	}
	if math.Abs(math.Hypot(math.Hypot(direction[0], direction[1]), direction[2])-1) > 1e-12 {
		return nil, fmt.Errorf("invalid observer stellar unit direction")
	}
	var ra, delta float64
	gofa.C2s(direction, &ra, &delta)
	observed, err := obs.ObserveStellarCoordinate(direction)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &ObserverExperiment{SchemaVersion: 1, Model: ObserverModel, Stellar: stellar, Observation: obs,
		Direction: direction, RADeg: gofa.Anp(ra) * gofa.DR2D, DecDeg: delta * gofa.DR2D,
		EpochTDB: state.EpochTDB, ResidualYears: pmt, Observed: observed,
		Limitations: []string{
			"Coordinate BCRS direction from the source-backed Earth station; no stellar aberration, gravitational deflection, horizontal transform or atmospheric refraction is applied to this direction.",
			"GoFA Pmpx applies observer parallax and an approximate observer Roemer correction to the propagated Starpm catalog state; this is not an iterative full relativistic observer/star light-time solution.",
			"TCB-compatible catalog rates and parallax are scaled to TDB-compatible inputs; source SPK J2000 axes are treated as ICRS-aligned under the existing observer convention.",
			"All nested Gaia, spectroscopic-RV, SPK, EOP and station-model limitations remain applicable. No stellar radius, observer-direction covariance, systematics, occultation probability or contact timing is supplied.",
		}}, nil
}
