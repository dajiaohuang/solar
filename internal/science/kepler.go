package science

import (
	"context"
	"fmt"
	"math"
)

const (
	AUkm = 149597870.7
	// Gaussian gravitational constant, giving the Sun's standard GM in AU^3/day^2.
	SolarGM = 0.00029591220828559104
)

type Elements struct{ SemiMajorAxisAU, Eccentricity, InclinationDeg, AscendingNodeDeg, ArgPeriapsisDeg, MeanAnomalyDeg, MeanMotionDegPerDay float64 }
type Vec3 struct{ X, Y, Z float64 }
type State struct{ Position, Velocity Vec3 }

// PropagateBoundElliptic evaluates a two-body osculating ellipse. It is deliberately
// not an N-body or operational ephemeris claim; callers expose its model boundary.
func PropagateBoundElliptic(ctx context.Context, e Elements, epochJD, jd float64) (State, error) {
	if err := ctx.Err(); err != nil {
		return State{}, err
	}
	if !finite(epochJD) || !finite(jd) || !finite(e.SemiMajorAxisAU) || !finite(e.Eccentricity) || e.SemiMajorAxisAU <= 0 || e.Eccentricity < 0 || e.Eccentricity >= 1 {
		return State{}, fmt.Errorf("unsupported or invalid elliptic elements")
	}
	for _, value := range []float64{e.InclinationDeg, e.AscendingNodeDeg, e.ArgPeriapsisDeg, e.MeanAnomalyDeg, e.MeanMotionDegPerDay} {
		if !finite(value) {
			return State{}, fmt.Errorf("elliptic elements must be finite")
		}
	}
	if e.MeanMotionDegPerDay < 0 {
		return State{}, fmt.Errorf("elliptic mean motion must not be negative")
	}
	n := e.MeanMotionDegPerDay * math.Pi / 180
	if n <= 0 {
		n = math.Sqrt(SolarGM / (e.SemiMajorAxisAU * e.SemiMajorAxisAU * e.SemiMajorAxisAU))
	}
	if !finite(n) || n <= 0 {
		return State{}, fmt.Errorf("elliptic mean motion is outside the numeric range")
	}
	M := math.Mod(e.MeanAnomalyDeg*math.Pi/180+n*(jd-epochJD), 2*math.Pi)
	if M < 0 {
		M += 2 * math.Pi
	}
	E, err := solveKepler(M, e.Eccentricity)
	if err != nil {
		return State{}, err
	}
	cosE, sinE := math.Cos(E), math.Sin(E)
	oneMinusCos := 2 * math.Pow(math.Sin(E/2), 2)
	den := (1 - e.Eccentricity) + e.Eccentricity*oneMinusCos
	x := e.SemiMajorAxisAU * ((1 - e.Eccentricity) - oneMinusCos)
	beta := math.Sqrt((1 - e.Eccentricity) * (1 + e.Eccentricity))
	y := e.SemiMajorAxisAU * beta * sinE
	// Derivatives are AU/day in the orbital plane.
	dx := -e.SemiMajorAxisAU * sinE * n / den
	dy := e.SemiMajorAxisAU * beta * cosE * n / den
	ci, si := math.Cos(e.InclinationDeg*math.Pi/180), math.Sin(e.InclinationDeg*math.Pi/180)
	co, so := math.Cos(e.ArgPeriapsisDeg*math.Pi/180), math.Sin(e.ArgPeriapsisDeg*math.Pi/180)
	cn, sn := math.Cos(e.AscendingNodeDeg*math.Pi/180), math.Sin(e.AscendingNodeDeg*math.Pi/180)
	rot := func(a, b float64) Vec3 {
		return Vec3{X: (cn*co-sn*so*ci)*a + (-cn*so-sn*co*ci)*b, Y: (sn*co+cn*so*ci)*a + (-sn*so+cn*co*ci)*b, Z: so*si*a + co*si*b}
	}
	p, v := rot(x, y), rot(dx, dy)
	state := State{Position: Vec3{p.X * AUkm, p.Y * AUkm, p.Z * AUkm}, Velocity: Vec3{v.X * AUkm / 86400, v.Y * AUkm / 86400, v.Z * AUkm / 86400}}
	for _, value := range []float64{state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z} {
		if !finite(value) {
			return State{}, fmt.Errorf("elliptic propagation overflow")
		}
	}
	return state, nil
}

func solveKepler(M, e float64) (float64, error) {
	if !finite(M) || !finite(e) || e < 0 || e >= 1 {
		return 0, fmt.Errorf("invalid elliptic Kepler input")
	}
	M = math.Mod(M, 2*math.Pi)
	if M < 0 {
		M += 2 * math.Pi
	}
	reflected := M > math.Pi
	if reflected {
		M = 2*math.Pi - M
	}
	if M == 0 {
		return 0, nil
	}
	lower, upper := 0.0, math.Pi
	E := M
	if e >= .8 {
		E = math.Min(math.Pi, math.Cbrt(6*M/e))
	}
	for i := 0; i < 80; i++ {
		// Avoid subtracting nearly equal E and sin(E) near periapsis.
		difference := E - math.Sin(E)
		if E < .1 {
			x := E * E
			difference = E * x * (1.0/6 - x*(1.0/120-x*(1.0/5040-x*(1.0/362880-x/39916800))))
		}
		f := (1-e)*E + e*difference - M
		d := (1 - e) + 2*e*math.Pow(math.Sin(E/2), 2)
		delta := f / d
		if math.Abs(delta) <= 8.881784197001252e-16*math.Abs(E) {
			if reflected {
				E = 2*math.Pi - E
			}
			return E, nil
		}
		if f > 0 {
			upper = E
		} else {
			lower = E
		}
		next := E - delta
		if !finite(next) || next <= lower || next >= upper {
			next = (lower + upper) / 2
		}
		if next == E {
			if reflected {
				E = 2*math.Pi - E
			}
			return E, nil
		}
		E = next
	}
	return 0, fmt.Errorf("Kepler solver did not converge")
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
