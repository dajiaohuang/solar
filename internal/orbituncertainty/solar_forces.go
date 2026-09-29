package orbituncertainty

import (
	"context"
	"errors"
	"math"
	"strings"
)

type SunState func(context.Context, float64) ([6]float64, error)

type SolarRelativityEvidence struct {
	Model                   string  `json:"model"`
	SpeedOfLightKmPerSecond float64 `json:"speedOfLightKmPerSecond"`
	MaxExpansionParameter   float64 `json:"maxExpansionParameter"`
	Approximation           string  `json:"approximation"`
	Reference               string  `json:"reference"`
}

type RadiationPressure struct {
	Model                             string  `json:"model"`
	Illumination                      string  `json:"illumination"`
	PressureAt1AuNewtonPerSquareMeter float64 `json:"pressureAt1AuNewtonPerSquareMeter"`
	AreaSquareMeters                  float64 `json:"areaSquareMeters"`
	MassKg                            float64 `json:"massKg"`
	ReflectivityCoefficient           float64 `json:"reflectivityCoefficient"`
	Source                            string  `json:"source"`
}

const solarLightSpeed = 299792.458
const maxSolarExpansion = 1e-4
const radiationAU = 149597870.7
const solarApproximation = "Sun-relative position and velocity added to prescribed barycentric Newtonian acceleration; not full barycentric EIH dynamics."
const radiationLimitation = "Constant effective area, mass, optical coefficient and pressure; unshadowed radial force only. No eclipses, attitude, varying flux, thermal recoil, outgassing or parameter uncertainty."

func forceInput(state, output []float64) error {
	if (len(state) != 6 && len(state) != 42) || len(output) != len(state) {
		return errors.New("solar force requires finite six-state or 42-state")
	}
	for _, value := range state {
		if !finite(value) {
			return errors.New("nonfinite solar force state")
		}
	}
	return nil
}

// WithSolarRelativity adds the Sun-relative Schwarzschild monopole term and
// both position and velocity Jacobians. Prescribed Sun/GM remain fixed.
func WithSolarRelativity(base Derivative, sunState SunState, gm float64) (Derivative, error) {
	if base == nil || sunState == nil || !finite(gm) || gm <= 0 {
		return nil, errors.New("solar 1PN requires prescribed Sun, base derivative and positive GM")
	}
	return func(ctx context.Context, elapsed float64, state, output []float64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := forceInput(state, output); err != nil {
			return err
		}
		if err := base(ctx, elapsed, state, output); err != nil {
			return err
		}
		sun, err := sunState(ctx, elapsed)
		if err != nil {
			return err
		}
		for _, value := range sun {
			if !finite(value) {
				return errors.New("nonfinite prescribed Sun")
			}
		}
		var r, v, force [3]float64
		var dr, dv [9]float64
		for i := 0; i < 3; i++ {
			r[i], v[i] = state[i]-sun[i], state[i+3]-sun[i+3]
		}
		radius := math.Hypot(math.Hypot(r[0], r[1]), r[2])
		speed2 := v[0]*v[0] + v[1]*v[1] + v[2]*v[2]
		const c2 = solarLightSpeed * solarLightSpeed
		if !finite(radius) || radius <= 0 || !finite(speed2) || gm/radius/c2 > maxSolarExpansion || speed2/c2 > maxSolarExpansion {
			return errors.New("solar 1PN weak-field/slow-motion domain exceeded")
		}
		k, a, b := gm/c2/radius/radius/radius, 4*gm/radius-speed2, r[0]*v[0]+r[1]*v[1]+r[2]*v[2]
		for i := 0; i < 3; i++ {
			force[i] = a*r[i] + 4*b*v[i]
			output[i+3] += k * force[i]
			if len(state) == 42 {
				for j := 0; j < 3; j++ {
					identity := 0.0
					if i == j {
						identity = 1
					}
					dr[3*i+j] = k * (a*identity - 4*gm/radius*(r[i]/radius)*(r[j]/radius) + 4*v[i]*v[j] - 3*(r[j]/radius)*(force[i]/radius))
					dv[3*i+j] = k * (-2*v[j]*r[i] + 4*r[j]*v[i] + 4*b*identity)
				}
			}
		}
		if len(state) == 42 {
			for i := 0; i < 3; i++ {
				for j := 0; j < 6; j++ {
					for q := 0; q < 3; q++ {
						output[6+(i+3)*6+j] += dr[3*i+q]*state[6+q*6+j] + dv[3*i+q]*state[6+(q+3)*6+j]
					}
				}
			}
		}
		for _, value := range output {
			if !finite(value) {
				return errors.New("solar 1PN derivative became nonfinite")
			}
		}
		return ctx.Err()
	}, nil
}

func (p RadiationPressure) amplitude() (float64, error) {
	if p.Model != "constant-radial-srp" || p.Illumination != "unshadowed" || strings.TrimSpace(p.Source) == "" || len(p.Source) > 8192 {
		return 0, errors.New("explicit unshadowed radial SRP model and bounded source required")
	}
	for _, value := range []float64{p.PressureAt1AuNewtonPerSquareMeter, p.AreaSquareMeters, p.MassKg, p.ReflectivityCoefficient} {
		if !finite(value) || value <= 0 {
			return 0, errors.New("positive finite SI radiation-pressure parameters required")
		}
	}
	amplitude := p.PressureAt1AuNewtonPerSquareMeter * p.ReflectivityCoefficient * (p.AreaSquareMeters / p.MassKg) / 1000
	if !finite(amplitude) || amplitude <= 0 {
		return 0, errors.New("radiation-pressure amplitude is not representable")
	}
	return amplitude, nil
}

// WithSolarRadiationPressure snapshots all parameters by value. This is a
// fixed-parameter state Jacobian, not fitted SRP-parameter uncertainty.
func WithSolarRadiationPressure(base Derivative, sunState SunState, p RadiationPressure) (Derivative, error) {
	if base == nil || sunState == nil {
		return nil, errors.New("radiation pressure requires base derivative and prescribed Sun")
	}
	amplitude, err := p.amplitude()
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, elapsed float64, state, output []float64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := forceInput(state, output); err != nil {
			return err
		}
		if err := base(ctx, elapsed, state, output); err != nil {
			return err
		}
		sun, err := sunState(ctx, elapsed)
		if err != nil {
			return err
		}
		for _, value := range sun {
			if !finite(value) {
				return errors.New("nonfinite prescribed Sun")
			}
		}
		unit := [3]float64{state[0] - sun[0], state[1] - sun[1], state[2] - sun[2]}
		radius := math.Hypot(math.Hypot(unit[0], unit[1]), unit[2])
		if !finite(radius) || radius <= 0 {
			return errors.New("invalid radiation-pressure distance")
		}
		ratio := radiationAU / radius
		acceleration := amplitude * ratio * ratio
		gradient := acceleration / radius
		if !finite(acceleration) || acceleration <= 0 || !finite(gradient) || (len(state) == 42 && gradient == 0) {
			return errors.New("radiation-pressure derivative is not representable")
		}
		for i := range unit {
			unit[i] /= radius
		}
		for row := 0; row < 3; row++ {
			output[row+3] += acceleration * unit[row]
			if len(state) == 42 {
				for column := 0; column < 6; column++ {
					for k := 0; k < 3; k++ {
						identity := 0.0
						if row == k {
							identity = 1
						}
						output[6+(row+3)*6+column] += gradient * (identity - 3*unit[row]*unit[k]) * state[6+k*6+column]
					}
				}
			}
		}
		for _, value := range output {
			if !finite(value) {
				return errors.New("radiation-pressure derivative became nonfinite")
			}
		}
		return ctx.Err()
	}, nil
}
