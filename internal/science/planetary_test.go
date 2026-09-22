package science

import (
	"context"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestPlanetaryApproximationMatchesWebCoefficientsAndIndependentPositions(t *testing.T) {
	// Read the independently maintained Web source table, then evaluate the JPL
	// equations using Newton iteration and a Cartesian rotation. This is model
	// parity evidence, not a comparison with a high-precision ephemeris.
	raw, err := os.ReadFile("../../src/data/majorBodies.ts")
	if err != nil {
		t.Fatal(err)
	}
	ids := map[int]string{199: "mercury", 299: "venus", 399: "earth", 499: "mars", 599: "jupiter", 699: "saturn", 799: "uranus", 899: "neptune"}
	for naif, id := range ids {
		pattern := regexp.MustCompile(`(?s)id: '` + id + `'.*?base: elements\(([^)]+)\),\s*rates: elements\(([^)]+)\)`)
		match := pattern.FindStringSubmatch(string(raw))
		if len(match) != 3 {
			t.Fatalf("missing Web coefficients: %s", id)
		}
		var row [2][6]float64
		for j := range row {
			for i, value := range strings.Split(match[j+1], ",") {
				row[j][i], err = strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if row != planetaryTable[naif] {
			t.Fatalf("Web and Go coefficients diverge: %s", id)
		}
		for _, jd := range []float64{PlanetaryStartJD, 2451545, 2466154.5, PlanetaryEndJD - 1} {
			got, err := PlanetaryApproxState(context.Background(), naif, jd)
			if err != nil {
				t.Fatal(err)
			}
			want := referencePlanetPosition(row, jd)
			if naif == 399 {
				moon, err := PropagateBoundElliptic(context.Background(), Elements{384400 / AUkm, .0554, 5.16, 125.08, 318.15, 135.27, 360 / 27.322}, 2451545, jd)
				if err != nil {
					t.Fatal(err)
				}
				fraction := 4.9028001184575496e3 / (3.9860043550702266e5 + 4.9028001184575496e3)
				want.X -= moon.Position.X * fraction
				want.Y -= moon.Position.Y * fraction
				want.Z -= moon.Position.Z * fraction
			}
			if distance(got.Position, want) > .001 {
				t.Fatalf("%s JD %.1f position differs > 1 m: %+v vs %+v", id, jd, got.Position, want)
			}
			if jd == PlanetaryStartJD {
				continue
			}
			const dt = .001
			before, _ := PlanetaryApproxState(context.Background(), naif, jd-dt)
			after, _ := PlanetaryApproxState(context.Background(), naif, jd+dt)
			seconds := ((jd + dt) - (jd - dt)) * 86400
			fd := Vec3{(after.Position.X - before.Position.X) / seconds, (after.Position.Y - before.Position.Y) / seconds, (after.Position.Z - before.Position.Z) / seconds}
			if distance(got.Velocity, fd) > 2e-6 {
				t.Fatalf("%s secular velocity does not differentiate position: %+v vs %+v", id, got.Velocity, fd)
			}
		}
	}
}

func referencePlanetPosition(row [2][6]float64, jd float64) Vec3 {
	var e [6]float64
	for i := range e {
		e[i] = row[0][i] + row[1][i]*(jd-2451545)/36525
	}
	M := math.Mod((e[3]-e[4])*math.Pi/180, 2*math.Pi)
	E := M
	for i := 0; i < 20; i++ {
		E -= (E - e[1]*math.Sin(E) - M) / (1 - e[1]*math.Cos(E))
	}
	x, y := e[0]*(math.Cos(E)-e[1]), e[0]*math.Sqrt(1-e[1]*e[1])*math.Sin(E)
	w, n, inc := (e[4]-e[5])*math.Pi/180, e[5]*math.Pi/180, e[2]*math.Pi/180
	u, v := x*math.Cos(w)-y*math.Sin(w), x*math.Sin(w)+y*math.Cos(w)
	return Vec3{AUkm * (u*math.Cos(n) - v*math.Cos(inc)*math.Sin(n)), AUkm * (u*math.Sin(n) + v*math.Cos(inc)*math.Cos(n)), AUkm * v * math.Sin(inc)}
}

func distance(a, b Vec3) float64 {
	return math.Sqrt(math.Pow(a.X-b.X, 2) + math.Pow(a.Y-b.Y, 2) + math.Pow(a.Z-b.Z, 2))
}

func TestPlanetaryApproximationRejectsUnsupportedEpochsAndBodies(t *testing.T) {
	for _, jd := range []float64{PlanetaryStartJD - 1, PlanetaryEndJD, math.NaN(), math.Inf(1)} {
		if _, err := PlanetaryApproxState(context.Background(), 199, jd); err == nil {
			t.Fatalf("accepted epoch %v", jd)
		}
	}
	if _, err := PlanetaryApproxState(context.Background(), 999, 2451545); err == nil {
		t.Fatal("invented Pluto Table 1 row")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PlanetaryApproxState(ctx, 199, 2451545); err != context.Canceled {
		t.Fatalf("cancellation: %v", err)
	}
}
