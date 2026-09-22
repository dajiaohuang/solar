package science

import (
	"context"
	"fmt"
	"math"
)

// JPL Table 1, https://ssd.jpl.nasa.gov/planets/approx_pos.html.
// Columns: a (AU), e, I, L, longitude of perihelion, ascending node (degrees).
// Rates are per Julian century; epochs are TDB. The Earth row is the EMB.
var planetaryTable = map[int][2][6]float64{
	199: {{.38709927, .20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593}, {.00000037, .00001906, -.00594749, 149472.67411175, .16047689, -.12534081}},
	299: {{.72333566, .00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255}, {.00000390, -.00004107, -.00078890, 58517.81538729, .00268329, -.27769418}},
	399: {{1.00000261, .01671123, -.00001531, 100.46457166, 102.93768193, 0}, {.00000562, -.00004392, -.01294668, 35999.37244981, .32327364, 0}},
	499: {{1.52371034, .09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891}, {.00001847, .00007882, -.00813131, 19140.30268499, .44441088, -.29257343}},
	599: {{5.20288700, .04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909}, {-.00011607, -.00013253, -.00183714, 3034.74612775, .21252668, .20469106}},
	699: {{9.53667594, .05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448}, {-.00125060, -.00050991, .00193609, 1222.49362201, -.41897216, -.28867794}},
	799: {{19.18916464, .04725744, .77263783, 313.23810451, 170.95427630, 74.01692503}, {-.00196176, -.00004397, -.00242939, 428.48202785, .40805281, .04240589}},
	899: {{30.06992276, .00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574}, {.00026291, .00005105, .00035372, 218.45945325, -.32241464, -.00508664}},
}

const PlanetaryStartJD = 2378496.5 // 1800-01-01
const PlanetaryEndJD = 2470172.5   // 2051-01-01, exclusive

func PlanetaryEpochElements(naif int) (Elements, bool) {
	row, ok := planetaryTable[naif]
	e := row[0]
	return Elements{e[0], e[1], e[2], e[5], e[4] - e[5], e[3] - e[4], (row[1][3] - row[1][4]) / 36525}, ok
}

// PlanetaryApproxState returns heliocentric ECLIPJ2000 km and km/s.
// Velocity differentiates all six fitted elements, including the frame rotation.
// Earth uses the same approximate lunar ellipse and DE440 GM partition as Web;
// neither the fitted planets nor the fixed mean Moon are operational ephemerides.
func PlanetaryApproxState(ctx context.Context, naif int, jd float64) (State, error) {
	if err := ctx.Err(); err != nil {
		return State{}, err
	}
	row, ok := planetaryTable[naif]
	if !ok || !finite(jd) || jd < PlanetaryStartJD || jd >= PlanetaryEndJD {
		return State{}, fmt.Errorf("unsupported planet or epoch outside JPL Table 1 (1800-2050 TDB)")
	}
	var e, d [6]float64
	for i := range e {
		e[i] = row[0][i] + row[1][i]*(jd-2451545)/36525
		d[i] = row[1][i] / 36525
		if i >= 2 {
			e[i] *= math.Pi / 180
			d[i] *= math.Pi / 180
		}
	}
	E, err := solveKepler(e[3]-e[4], e[1])
	if err != nil {
		return State{}, err
	}
	sinE, cosE := math.Sincos(E)
	beta := math.Sqrt((1 - e[1]) * (1 + e[1]))
	dE := (d[3] - d[4] + d[1]*sinE) / (1 - e[1]*cosE)
	x, y := e[0]*(cosE-e[1]), e[0]*beta*sinE
	dx := d[0]*(cosE-e[1]) - e[0]*(sinE*dE+d[1])
	dy := d[0]*beta*sinE + e[0]*(-e[1]*d[1]/beta*sinE+beta*cosE*dE)
	// Rotate the state and its derivative by argument, inclination, then node.
	w, dw := e[4]-e[5], d[4]-d[5]
	sw, cw := math.Sincos(w)
	u, v := cw*x-sw*y, sw*x+cw*y
	du, dv := cw*dx-sw*dy-dw*v, sw*dx+cw*dy+dw*u
	si, ci := math.Sincos(e[2])
	p, q, z := u, ci*v, si*v
	dp, dq, dz := du, ci*dv-d[2]*si*v, si*dv+d[2]*ci*v
	sn, cn := math.Sincos(e[5])
	px, py := cn*p-sn*q, sn*p+cn*q
	vx, vy := cn*dp-sn*dq-d[5]*py, sn*dp+cn*dq+d[5]*px
	state := State{Vec3{px * AUkm, py * AUkm, z * AUkm}, Vec3{vx * AUkm / 86400, vy * AUkm / 86400, dz * AUkm / 86400}}
	if naif == 399 {
		moon, err := PropagateBoundElliptic(ctx, Elements{384400 / AUkm, .0554, 5.16, 125.08, 318.15, 135.27, 360 / 27.322}, 2451545, jd)
		if err != nil {
			return State{}, err
		}
		const moonFraction = 4.9028001184575496e3 / (3.9860043550702266e5 + 4.9028001184575496e3)
		state.Position.X -= moonFraction * moon.Position.X
		state.Position.Y -= moonFraction * moon.Position.Y
		state.Position.Z -= moonFraction * moon.Position.Z
		state.Velocity.X -= moonFraction * moon.Velocity.X
		state.Velocity.Y -= moonFraction * moon.Velocity.Y
		state.Velocity.Z -= moonFraction * moon.Velocity.Z
	}
	return state, nil
}
