package stellarmotion

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"github.com/hebl/gofa"
)

const MaxBatchRows = 30_000

const GaiaZeroRadialMotionWhenRVUnavailable = "gaia-mu-r-zero-when-rv-missing"

type BatchRow struct {
	SourceID                string `json:"sourceId"`
	Status                  string `json:"status"`
	Reason                  string `json:"reason,omitempty"`
	State                   *State `json:"state,omitempty"`
	ZeroRadialMotionAssumed bool   `json:"zeroRadialMotionAssumed,omitempty"`
}

type BatchResult struct {
	SchemaVersion        int        `json:"schemaVersion"`
	Model                string     `json:"model"`
	TargetEpochTCB       float64    `json:"targetEpochJulianYearTCB"`
	SourceTDB            [2]float64 `json:"sourceJdTdbParts"`
	TargetTDB            [2]float64 `json:"targetJdTdbParts"`
	ScaleFactor          float64    `json:"tdbCompatibleScaleFactor"`
	RadialVelocityPolicy string     `json:"radialVelocityPolicy"`
	InputRows            int        `json:"inputRows"`
	PropagatedRows       int        `json:"propagatedRows"`
	MissingRows          int        `json:"missingRows"`
	RejectedRows         int        `json:"rejectedRows"`
	ZeroRadialMotionRows int        `json:"zeroRadialMotionRows,omitempty"`
	Rows                 []BatchRow `json:"rows"`
	Limitations          []string   `json:"limitations"`
}

// PropagateBatchContext applies the same explicit SOFA single-star model to a
// bounded source batch. Incomplete catalog astrometry is reported per row.
// Missing radial velocity is retained unless the caller explicitly selects
// Gaia's documented zero-radial-proper-motion assumption.
func PropagateBatchContext(ctx context.Context, sources []Source, targetYearTCB float64, rvPolicy string) (*BatchResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(sources) < 1 || len(sources) > MaxBatchRows {
		return nil, fmt.Errorf("stellar batch must contain 1 to %d rows", MaxBatchRows)
	}
	if rvPolicy != "spectroscopic-as-astrometric" && rvPolicy != GaiaZeroRadialMotionWhenRVUnavailable {
		return nil, fmt.Errorf("unsupported radial-velocity policy")
	}
	if !finite(targetYearTCB) || math.Abs(targetYearTCB-2016) > 100 {
		return nil, fmt.Errorf("stellar batch epoch outside supported range")
	}
	const scale = 1 - gofa.ELB
	var sourceTDB1, sourceTDB2, targetTDB1, targetTDB2 float64
	gofa.Tcbtdb(gofa.DJ00, (2016-2000)*gofa.DJY, &sourceTDB1, &sourceTDB2)
	gofa.Tcbtdb(gofa.DJ00, (targetYearTCB-2000)*gofa.DJY, &targetTDB1, &targetTDB2)

	result := &BatchResult{
		SchemaVersion:        1,
		Model:                "gofa-starpm-scaled-gaia-single-star-v1",
		TargetEpochTCB:       targetYearTCB,
		SourceTDB:            [2]float64{sourceTDB1, sourceTDB2},
		TargetTDB:            [2]float64{targetTDB1, targetTDB2},
		ScaleFactor:          scale,
		RadialVelocityPolicy: rvPolicy,
		InputRows:            len(sources),
		Rows:                 make([]BatchRow, 0, len(sources)),
		Limitations: []string{
			"Uniform rectilinear single-star motion with SOFA changing-light-time and special-relativistic treatment.",
			"Available spectroscopic radial velocity is adopted as astrometric radial velocity; gravitational/convective and binary shifts are not corrected.",
			"Positive measured parallax supplies a nominal distance, not a Bayesian distance estimate.",
			"No uncertainty propagation, systematics, acceleration, Galactic potential, observer parallax, deflection or aberration.",
			"Numerical agreement is not a physical positional-accuracy certificate; incomplete inputs and SOFA warnings are not substituted.",
		},
	}
	if rvPolicy == GaiaZeroRadialMotionWhenRVUnavailable {
		result.Limitations = append(result.Limitations, "When catalog radial velocity is unavailable, zero radial proper motion (mu_r=0) is adopted at the source epoch for propagation, matching Gaia's documented default. Such rows set zeroRadialMotionAssumed=true. The target-epoch radial velocity can evolve through perspective effects; it is model-derived, not a measurement.")
	} else {
		result.Limitations = append(result.Limitations, "Rows without catalog radial velocity remain unavailable; no radial-motion value is imputed.")
	}

	for index, source := range sources {
		if index&127 == 0 {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
		}
		row := BatchRow{Status: "rejected"}
		if !sourceID.MatchString(source.ID) {
			row.Reason = "invalid-source-id"
			result.RejectedRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		if _, err := strconv.ParseInt(source.ID, 10, 64); err != nil {
			row.Reason = "source-id-outside-signed-64-bit-range"
			result.RejectedRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		row.SourceID = source.ID
		if source.Epoch != 2016 {
			row.Reason = "unsupported-reference-epoch"
			result.RejectedRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		if source.Solution != 31 && source.Solution != 95 {
			row.Status = "missing"
			row.Reason = "unsupported-astrometric-solution"
			result.MissingRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		if source.RA == nil || source.Dec == nil {
			row.Status = "missing"
			row.Reason = "position-unavailable"
			result.MissingRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		if source.PMRA == nil || source.PMDec == nil {
			row.Status = "missing"
			row.Reason = "proper-motion-unavailable"
			result.MissingRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		if source.Parallax == nil || *source.Parallax <= 0 {
			row.Status = "missing"
			row.Reason = "positive-parallax-required"
			result.MissingRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		zeroRadialMotionAssumed := false
		if source.RadialVelocity == nil {
			if rvPolicy != GaiaZeroRadialMotionWhenRVUnavailable {
				row.Status = "missing"
				row.Reason = "radial-velocity-unavailable"
				result.MissingRows++
				result.Rows = append(result.Rows, row)
				continue
			}
			zeroRadialVelocity := 0.0
			source.RadialVelocity = &zeroRadialVelocity
			zeroRadialMotionAssumed = true
		}
		if err := validatePropagationStateInputs(source); err != nil {
			row.Reason = "sofa-propagation-rejected"
			result.RejectedRows++
			result.Rows = append(result.Rows, row)
			continue
		}

		state, err := propagateStateValidatedWithEpochs(source,
			[2]float64{sourceTDB1, sourceTDB2}, [2]float64{targetTDB1, targetTDB2})
		if err != nil {
			row.Reason = "sofa-propagation-rejected"
			result.RejectedRows++
			result.Rows = append(result.Rows, row)
			continue
		}
		row.Status = "propagated"
		row.State = &state
		row.ZeroRadialMotionAssumed = zeroRadialMotionAssumed
		result.PropagatedRows++
		if zeroRadialMotionAssumed {
			result.ZeroRadialMotionRows++
		}
		result.Rows = append(result.Rows, row)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
