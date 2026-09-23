package stellarmotion

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
)

type Matrix6 [6][6]float64

type FormalCovariance struct {
	Input                         Matrix6    `json:"inputMatrix"`
	Output                        Matrix6    `json:"outputMatrix"`
	Jacobian                      Matrix6    `json:"jacobian"`
	Steps                         [6]float64 `json:"differenceSteps"`
	MaxScaledDerivativeDifference float64    `json:"maxScaledDerivativeDifference"`
	CoordinateLabels              [6]string  `json:"coordinateLabels"`
	CoordinateUnits               [6]string  `json:"coordinateUnits"`
	TargetEpoch                   float64    `json:"targetEpochJulianYearTCB"`
	Assumptions                   []string   `json:"assumptions"`
}

// FormalInputCovariance retains the five-coordinate marginal even for a Gaia
// six-parameter (pseudocolour) solution. RV independence is an adopted hypothesis.
func FormalInputCovariance(raw json.RawMessage, policy string) (Matrix6, error) {
	var matrix Matrix6
	if policy != "independent-spectroscopic-rv" {
		return matrix, fmt.Errorf("explicit RV covariance independence policy required")
	}
	var source Source
	if err := json.Unmarshal(raw, &source); err != nil {
		return matrix, err
	}
	if source.Epoch != 2016 || (source.Solution != 31 && source.Solution != 95) {
		return matrix, fmt.Errorf("unsupported covariance source epoch or solution")
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return matrix, err
	}
	number := func(key string) (float64, error) {
		var value *float64
		if err := json.Unmarshal(record[key], &value); err != nil || value == nil || !finite(*value) {
			return 0, fmt.Errorf("missing or invalid covariance field %s", key)
		}
		return *value, nil
	}
	fields := [6]string{"ra", "dec", "parallax", "pmra", "pmdec", "radial_velocity"}
	var sigma [6]float64
	var correlation, lower Matrix6
	for i, field := range fields {
		value, err := number(field + "_error")
		if err != nil {
			return matrix, err
		}
		if value <= 0 {
			return matrix, fmt.Errorf("nonpositive formal error")
		}
		sigma[i] = value
		correlation[i][i] = 1
	}
	for i := 0; i < 5; i++ {
		for j := i + 1; j < 5; j++ {
			value, err := number(fields[i] + "_" + fields[j] + "_corr")
			if err != nil {
				return matrix, err
			}
			if math.Abs(value) > 1 {
				return matrix, fmt.Errorf("invalid source correlation")
			}
			correlation[i][j] = value
			correlation[j][i] = value
		}
	}
	for i := 0; i < 6; i++ {
		for j := 0; j <= i; j++ {
			value := correlation[i][j]
			for k := 0; k < j; k++ {
				value -= lower[i][k] * lower[j][k]
			}
			if i == j {
				if !(value > 0) {
					return matrix, fmt.Errorf("source correlation is not strictly positive definite")
				}
				lower[i][j] = math.Sqrt(value)
			} else {
				lower[i][j] = value / lower[j][j]
			}
			entry := correlation[i][j] * sigma[i] * sigma[j]
			if !finite(entry) || (i == j && entry <= 0) {
				return matrix, fmt.Errorf("unrepresentable formal covariance")
			}
			matrix[i][j] = entry
			matrix[j][i] = entry
		}
	}
	return matrix, nil
}

// PropagateFormalCovariance is a first-order local approximation of Propagate.
// It is not exposed by user routes until independent propagated references pass.
func PropagateFormalCovariance(ctx context.Context, raw json.RawMessage, year float64, rvPolicy, covariancePolicy string) (*FormalCovariance, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	input, err := FormalInputCovariance(raw, covariancePolicy)
	if err != nil {
		return nil, err
	}
	var source Source
	if err = json.Unmarshal(raw, &source); err != nil {
		return nil, err
	}
	nominal, err := Propagate(source, year, rvPolicy)
	if err != nil {
		return nil, err
	}
	cosInput := math.Cos(*source.Dec * math.Pi / 180)
	cosOutput := math.Cos(nominal.State.Dec * math.Pi / 180)
	if math.Abs(cosInput) < 1e-6 || math.Abs(cosOutput) < 1e-6 {
		return nil, fmt.Errorf("local covariance chart too close to coordinate pole")
	}
	result := &FormalCovariance{Input: input, TargetEpoch: year, CoordinateLabels: [6]string{"delta-alpha*cos(delta)", "delta-dec", "parallax", "pmra", "pmdec", "radial-velocity"}, CoordinateUnits: [6]string{"mas", "mas", "mas", "mas/Julian-year", "mas/Julian-year", "km/s"}, Assumptions: []string{
		"First-order local covariance J C J^T of the adopted uniform single-star model; not a nonlinear probability distribution.",
		"Five-parameter astrometric marginal plus independent spectroscopic RV error; no measured astrometry/RV cross-covariance is available here.",
		"Pseudocolour is marginalized, not substituted for radial velocity or conditioned on a fixed value.",
		"No systematic errors, astrophysical RV shifts, binary acceleration, observer transformation or event timing certificate.",
	}}
	values := [6]float64{*source.RA, *source.Dec, *source.Parallax, *source.PMRA, *source.PMDec, *source.RadialVelocity}
	// At the source epoch the coordinate map is exactly the identity. Avoid
	// manufacturing off-diagonal sensitivity from subtraction roundoff.
	if year == source.Epoch {
		result.Output = input
		for i := 0; i < 6; i++ {
			result.Jacobian[i][i] = 1
		}
		return result, nil
	}
	for axis := 0; axis < 6; axis++ {
		h := 1e-3 * math.Max(math.Abs(values[axis]), math.Sqrt(input[axis][axis]))
		if axis < 2 {
			h = 10
		}
		if h == 0 {
			h = 1e-3
		}
		result.Steps[axis] = h
		var derivative [2][6]float64
		for refinement := 0; refinement < 2; refinement++ {
			step := h / math.Pow(2, float64(refinement))
			var states [2]State
			for side := 0; side < 2; side++ {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				v := values
				delta := step
				if side == 0 {
					delta = -delta
				}
				if axis == 0 {
					v[0] = math.Mod(v[0]+delta/(3600000*cosInput)+360, 360)
				} else if axis == 1 {
					v[1] += delta / 3600000
				} else {
					v[axis] += delta
				}
				perturbed := source
				perturbed.RA = &v[0]
				perturbed.Dec = &v[1]
				perturbed.Parallax = &v[2]
				perturbed.PMRA = &v[3]
				perturbed.PMDec = &v[4]
				perturbed.RadialVelocity = &v[5]
				state, err := Propagate(perturbed, year, rvPolicy)
				if err != nil {
					return nil, fmt.Errorf("covariance perturbation: %w", err)
				}
				states[side] = state.State
			}
			a, b := states[0], states[1]
			derivative[refinement] = [6]float64{math.Remainder(b.RA-a.RA, 360) * 3600000 * cosOutput / (2 * step), (b.Dec - a.Dec) * 3600000 / (2 * step), (b.Parallax - a.Parallax) / (2 * step), (b.PMRA - a.PMRA) / (2 * step), (b.PMDec - a.PMDec) / (2 * step), (b.RadialVelocity - a.RadialVelocity) / (2 * step)}
		}
		for row := 0; row < 6; row++ {
			a, b := derivative[0][row], derivative[1][row]
			difference := math.Abs(a-b) / math.Max(1, math.Abs(b))
			if !finite(difference) || difference > 1e-4 {
				return nil, fmt.Errorf("covariance derivative did not converge")
			}
			result.MaxScaledDerivativeDifference = math.Max(result.MaxScaledDerivativeDifference, difference)
			result.Jacobian[row][axis] = (4*b - a) / 3
		}
	}
	for i := 0; i < 6; i++ {
		for j := i; j < 6; j++ {
			value := 0.
			for a := 0; a < 6; a++ {
				for b := 0; b < 6; b++ {
					value += result.Jacobian[i][a] * input[a][b] * result.Jacobian[j][b]
				}
			}
			if !finite(value) || (i == j && value <= 0) {
				return nil, fmt.Errorf("unrepresentable propagated covariance")
			}
			result.Output[i][j] = value
			result.Output[j][i] = value
		}
	}
	return result, nil
}
