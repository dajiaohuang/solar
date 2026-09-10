package science

import (
	"context"
	"math"
	"testing"
)

func TestKeplerHighPrecisionReferences(t *testing.T) {
	// 80-digit mpmath bisection; exact binary64 inputs. Independent of this solver.
	for _, c := range [][3]float64{
		{1e-18, .999999999999, 8.846362663028021920092815961327332594059e-7},
		{1e-12, .9999999, 9.99833417153809594025392758707356267904e-6},
		{1e-6, .999999, .01806124662152221616916928727435872440607},
		{.1, .999, .8515505079998896110696268628007606717945},
		{3, .9, 3.067037496630688558913036674269989956201},
	} {
		got, err := solveKepler(c[0], c[1])
		if err != nil || math.Abs(got/c[2]-1) > 3e-14 {
			t.Fatalf("M=%g e=%g: got %.17g want %.17g: %v", c[0], c[1], got, c[2], err)
		}
	}
}

func TestRejectsNonFiniteElementsAndOverflow(t *testing.T) {
	for index := 0; index < 7; index++ {
		for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
			e := Elements{SemiMajorAxisAU: 1, MeanMotionDegPerDay: 1}
			fields := []*float64{&e.SemiMajorAxisAU, &e.Eccentricity, &e.InclinationDeg, &e.AscendingNodeDeg, &e.ArgPeriapsisDeg, &e.MeanAnomalyDeg, &e.MeanMotionDegPerDay}
			*fields[index] = bad
			if _, err := PropagateBoundElliptic(context.Background(), e, 2451545, 2451545); err == nil {
				t.Fatalf("accepted non-finite field %d", index)
			}
		}
	}
	for _, e := range []Elements{{SemiMajorAxisAU: 1, MeanMotionDegPerDay: -1}, {SemiMajorAxisAU: math.MaxFloat64}} {
		if _, err := PropagateBoundElliptic(context.Background(), e, 2451545, 2451545); err == nil {
			t.Fatal("accepted invalid numeric range")
		}
	}
}

func TestEllipticEnergyAndAngularMomentum(t *testing.T) {
	for _, eccentricity := range []float64{0, .8, .999999} {
		for _, anomaly := range []float64{0, .01, 90, 180, 359.99} {
			s, err := PropagateBoundElliptic(context.Background(), Elements{SemiMajorAxisAU: 2, Eccentricity: eccentricity, MeanAnomalyDeg: anomaly}, 2451545, 2451545)
			if err != nil {
				t.Fatal(err)
			}
			r := math.Hypot(s.Position.X, s.Position.Y) / AUkm
			vx, vy := s.Velocity.X*86400/AUkm, s.Velocity.Y*86400/AUkm
			energy := (vx*vx+vy*vy)/2 - SolarGM/r
			if math.Abs(energy/(-SolarGM/4)-1) > 2e-8 {
				t.Fatalf("energy drift e=%g M=%g: %g", eccentricity, anomaly, energy)
			}
			h := (s.Position.X*vy - s.Position.Y*vx) / AUkm
			expected := math.Sqrt(SolarGM * 2 * (1 - eccentricity) * (1 + eccentricity))
			if math.Abs(h/expected-1) > 1e-9 {
				t.Fatalf("angular momentum drift: %g", h)
			}
		}
	}
}
