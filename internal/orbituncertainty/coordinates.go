package orbituncertainty

import (
	"context"
	"errors"
	"math"
	"strings"
)

type AdoptedSolarGM struct {
	AU3PerDay2 float64 `json:"au3PerDay2"`
	Source     string  `json:"source"`
}

type NumericalDomain struct {
	Formulation                       string   `json:"formulation"`
	MaximumAbsoluteDimensionlessTime  *float64 `json:"maximumAbsoluteDimensionlessTime,omitempty"`
	MaximumAbsoluteMeanAnomalyRadians *float64 `json:"maximumAbsoluteMeanAnomalyRadians,omitempty"`
}

type NominalConic struct {
	Eccentricity                float64 `json:"eccentricity"`
	PeriapsisAU                 float64 `json:"periapsisAU"`
	ElapsedTDBDaysFromPeriapsis float64 `json:"elapsedTdbDaysFromPeriapsis"`
	Classification              string  `json:"classification"`
}

type Coordinates struct {
	Model           string          `json:"model"`
	NumericalDomain NumericalDomain `json:"numericalDomain"`
	NominalConic    NominalConic    `json:"nominalConic"`
	EpochTDB        float64         `json:"epochTdb"`
	Frame           string          `json:"frame"`
	Labels          []string        `json:"labels"`
	Units           []*string       `json:"units"`
	Nominal         []float64       `json:"nominal"`
	Matrix          [][]float64     `json:"matrix"`
	Jacobian        [][]float64     `json:"jacobian"`
	MarginalSigmas  []float64       `json:"marginalSigmas"`
	InputLabels     []string        `json:"inputLabels"`
	InputUnits      []*string       `json:"inputUnits"`
	AdoptedSolarGM  AdoptedSolarGM  `json:"adoptedSolarGM"`
	Limitations     []string        `json:"limitations"`
}

type Conversion struct {
	Inspection  *Inspection  `json:"inspection"`
	Coordinates *Coordinates `json:"coordinates"`
}

// Convert first audits original source bytes, then transforms the entire joint
// covariance at its solution epoch. It never accepts a caller-edited parsed
// Source in place of the original. No source-fit force model is integrated.
func Convert(ctx context.Context, original []byte, gm AdoptedSolarGM) (*Conversion, error) {
	if !finite(gm.AU3PerDay2) || gm.AU3PerDay2 <= 0 || strings.TrimSpace(gm.Source) == "" || len(gm.Source) > 4096 {
		return nil, errors.New("explicit positive solar GM in au^3/day^2 and a source of at most 4096 bytes required")
	}
	inspection, err := Inspect(ctx, original)
	if err != nil {
		return nil, err
	}
	coordinates, err := atSolutionEpoch(ctx, &inspection.Source, gm)
	if err != nil {
		return nil, err
	}
	return &Conversion{Inspection: inspection, Coordinates: coordinates}, nil
}

func square(n int) [][]float64 {
	result := make([][]float64, n)
	for i := range result {
		result[i] = make([]float64, n)
	}
	return result
}

func symmetricMean(a, b float64) float64 {
	if a > b {
		a, b = b, a
	}
	if (a < 0) == (b < 0) {
		return a + (b-a)/2
	}
	return (a + b) / 2
}

func atSolutionEpoch(ctx context.Context, source *Source, gm AdoptedSolarGM) (*Coordinates, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	n := len(source.Labels)
	var axes [6]int
	for axis, label := range []string{"e", "q", "tp", "node", "peri", "i"} {
		axes[axis] = -1
		for index := 0; index < 6; index++ {
			if source.Labels[index] == label {
				axes[axis] = index
				break
			}
		}
		if axes[axis] < 0 {
			return nil, errors.New("missing audited orbital axis")
		}
	}
	e, q, tp := source.Nominal[axes[0]], source.Nominal[axes[1]], source.Nominal[axes[2]]
	elapsed := source.SolutionEpochTDB - tp
	if !finite(elapsed) {
		return nil, errors.New("nonfinite periapsis elapsed time")
	}
	limit := 1e6
	model := "elliptic-osculating-coordinate-transform"
	domain := NumericalDomain{Formulation: "elliptic-anomaly", MaximumAbsoluteMeanAnomalyRadians: &limit}
	classification := "elliptic"
	var plane conicPlane
	var err error
	if e > .9999 {
		model = "universal-conic-osculating-coordinate-transform"
		domain = NumericalDomain{Formulation: "unwrapped-universal-periapsis", MaximumAbsoluteDimensionlessTime: &limit}
		plane, err = universalPlane(ctx, e, q, elapsed, gm.AU3PerDay2)
	} else {
		plane, err = ellipticPlane(ctx, e, q, elapsed, gm.AU3PerDay2)
	}
	if err != nil {
		return nil, err
	}
	if e == 1 {
		classification = "parabolic"
	} else if e > 1 {
		classification = "hyperbolic"
	}
	const deg = math.Pi / 180
	sO, cO := math.Sincos(source.Nominal[axes[3]] * deg)
	sw, cw := math.Sincos(source.Nominal[axes[4]] * deg)
	si, ci := math.Sincos(source.Nominal[axes[5]] * deg)
	p := [3]float64{cO*cw - sO*sw*ci, sO*cw + cO*sw*ci, sw * si}
	r := [3]float64{-cO*sw - sO*cw*ci, -sO*sw + cO*cw*ci, cw * si}
	dNodeP, dNodeR := [3]float64{-p[1], p[0], 0}, [3]float64{-r[1], r[0], 0}
	dInclinationP := [3]float64{sO * sw * si, -cO * sw * si, sw * ci}
	dInclinationR := [3]float64{sO * cw * si, -cO * cw * si, cw * ci}
	result := &Coordinates{
		Model: model, NumericalDomain: domain, NominalConic: NominalConic{e, q, elapsed, classification},
		EpochTDB: source.SolutionEpochTDB, Frame: source.Frame,
		Labels:  append([]string{"x", "y", "z", "vx", "vy", "vz"}, source.Labels[6:]...),
		Nominal: make([]float64, n), Matrix: square(n), Jacobian: square(n), MarginalSigmas: make([]float64, n),
		InputLabels: append([]string(nil), source.Labels...), InputUnits: append([]*string(nil), source.Units...), AdoptedSolarGM: gm,
		Limitations: []string{
			"First-order coordinate transformation at the covariance solution epoch, not temporal propagation.",
			"Conditional on the explicit caller-adopted solar GM; its source text is not authenticated and SBDB cov=mat supplies no GM uncertainty.",
			"Additional estimated covariance axes and cross-correlations are retained; no orbit-fit force model is integrated.",
			"Formal fit covariance does not include every physical model error or establish event probabilities.",
		},
	}
	for _, unit := range []string{"au", "au", "au", "au/d", "au/d", "au/d"} {
		value := unit
		result.Units = append(result.Units, &value)
	}
	result.Units = append(result.Units, source.Units[6:]...)
	for k := 0; k < 3; k++ {
		result.Nominal[k] = plane.x*p[k] + plane.y*r[k]
		result.Nominal[k+3] = plane.vx*p[k] + plane.vy*r[k]
	}
	copy(result.Nominal[6:], source.Nominal[6:])
	for axis := 0; axis < 6; axis++ {
		var derivative [4]float64
		if axis < 3 {
			derivative = plane.derivatives[axis]
		}
		for k := 0; k < 3; k++ {
			dp, dr := 0.0, 0.0
			switch axis {
			case 3:
				dp, dr = dNodeP[k]*deg, dNodeR[k]*deg
			case 4:
				dp, dr = r[k]*deg, -p[k]*deg
			case 5:
				dp, dr = dInclinationP[k]*deg, dInclinationR[k]*deg
			}
			result.Jacobian[k][axes[axis]] = derivative[0]*p[k] + derivative[1]*r[k] + plane.x*dp + plane.y*dr
			result.Jacobian[k+3][axes[axis]] = derivative[2]*p[k] + derivative[3]*r[k] + plane.vx*dp + plane.vy*dr
		}
	}
	for axis := 6; axis < n; axis++ {
		result.Jacobian[axis][axis] = 1
	}
	// Symmetrize only the multiplication operand, preserving original source
	// entries. Same-sign differences avoid sum overflow without halving tiny
	// identical variances to zero; opposite-sign sums cannot overflow.
	left := square(n)
	for row := 0; row < n; row++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for column := 0; column < n; column++ {
			for k := 0; k < n; k++ {
				left[row][column] += result.Jacobian[row][k] * symmetricMean(source.Matrix[k][column], source.Matrix[column][k])
			}
			if !finite(left[row][column]) {
				return nil, errors.New("nonfinite covariance intermediate")
			}
		}
	}
	for row := 0; row < n; row++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !finite(result.Nominal[row]) {
			return nil, errors.New("nonfinite Cartesian state")
		}
		for _, value := range result.Jacobian[row] {
			if !finite(value) {
				return nil, errors.New("nonfinite Cartesian Jacobian")
			}
		}
		for column := row; column < n; column++ {
			value := 0.0
			for k := 0; k < n; k++ {
				value += left[row][k] * result.Jacobian[column][k]
			}
			if !finite(value) || (row == column && value < 0) {
				return nil, errors.New("Cartesian covariance lost numerical validity")
			}
			result.Matrix[row][column], result.Matrix[column][row] = value, value
		}
		result.MarginalSigmas[row] = math.Sqrt(result.Matrix[row][row])
	}
	return result, nil
}
