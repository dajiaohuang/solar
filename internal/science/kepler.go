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
	n := e.MeanMotionDegPerDay * math.Pi / 180
	if n <= 0 {
		n = math.Sqrt(SolarGM / (e.SemiMajorAxisAU * e.SemiMajorAxisAU * e.SemiMajorAxisAU))
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
	den := 1 - e.Eccentricity*cosE
	x := e.SemiMajorAxisAU * (cosE - e.Eccentricity)
	y := e.SemiMajorAxisAU * math.Sqrt(1-e.Eccentricity*e.Eccentricity) * sinE
	// Derivatives are AU/day in the orbital plane.
	dx := -e.SemiMajorAxisAU * sinE * n / den
	dy := e.SemiMajorAxisAU * math.Sqrt(1-e.Eccentricity*e.Eccentricity) * cosE * n / den
	ci, si := math.Cos(e.InclinationDeg*math.Pi/180), math.Sin(e.InclinationDeg*math.Pi/180)
	co, so := math.Cos(e.ArgPeriapsisDeg*math.Pi/180), math.Sin(e.ArgPeriapsisDeg*math.Pi/180)
	cn, sn := math.Cos(e.AscendingNodeDeg*math.Pi/180), math.Sin(e.AscendingNodeDeg*math.Pi/180)
	rot := func(a, b float64) Vec3 {
		return Vec3{X: (cn*co-sn*so*ci)*a + (-cn*so-sn*co*ci)*b, Y: (sn*co+cn*so*ci)*a + (-sn*so+cn*co*ci)*b, Z: so*si*a + co*si*b}
	}
	p, v := rot(x, y), rot(dx, dy)
	return State{Position: Vec3{p.X * AUkm, p.Y * AUkm, p.Z * AUkm}, Velocity: Vec3{v.X * AUkm / 86400, v.Y * AUkm / 86400, v.Z * AUkm / 86400}}, nil
}

func solveKepler(M, e float64) (float64, error) {
	E := M
	if e > .8 {
		E = math.Pi
	}
	for i := 0; i < 20; i++ {
		f := E - e*math.Sin(E) - M
		d := 1 - e*math.Cos(E)
		delta := f / d
		E -= delta
		if math.Abs(delta) < 1e-13 {
			return E, nil
		}
	}
	return 0, fmt.Errorf("Kepler solver did not converge")
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
