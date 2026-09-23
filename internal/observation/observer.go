// Package observation evaluates source-backed Earth-station directions. Its
// coordinate transforms use GoFA (derived from IAU SOFA); see THIRD_PARTY_NOTICES.md.
package observation

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/hebl/gofa"
)

const Model = "earth-station-iau2006-2000a-spk-v1"
const MaxBodies = 32
const auKM = gofa.DAU / 1000
const lightTimeToleranceSeconds = 0.00005 // One-part catalog JD resolution, not physical accuracy.

type Evaluator func(context.Context, []string, float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error)

type Station struct {
	LongitudeDeg float64 `json:"longitudeDeg"`
	LatitudeDeg  float64 `json:"latitudeDeg"`
	HeightMeters float64 `json:"heightMeters"`
}

type Atmosphere struct {
	PressureHPa           float64 `json:"pressureHPa"`
	TemperatureC          float64 `json:"temperatureC"`
	RelativeHumidity      float64 `json:"relativeHumidity"`
	WavelengthMicrometers float64 `json:"wavelengthMicrometers"`
}

type Request struct {
	UTC        string      `json:"utc"`
	Station    Station     `json:"station"`
	BodyIDs    []string    `json:"bodyIds"`
	Atmosphere *Atmosphere `json:"atmosphere,omitempty"`
}

type Direction struct {
	AzimuthDeg  float64 `json:"azimuthDeg"`
	AltitudeDeg float64 `json:"altitudeDeg"`
}

type BodyResult struct {
	BodyID                   string      `json:"bodyId"`
	Status                   string      `json:"status"`
	MissingReason            string      `json:"missingReason,omitempty"`
	Geometric                *Direction  `json:"geometric,omitempty"`
	ApparentAirless          *Direction  `json:"apparentAirless,omitempty"`
	Refracted                *Direction  `json:"refracted,omitempty"`
	RangeKM                  *float64    `json:"lightTimeRangeKm,omitempty"`
	LightTimeSeconds         *float64    `json:"lightTimeSeconds,omitempty"`
	EmissionJDTDB            *float64    `json:"emissionJdTdb,omitempty"`
	Iterations               int         `json:"lightTimeIterations,omitempty"`
	GeometricPositionKM      *[3]float64 `json:"geometricPositionKm,omitempty"`
	ReceptionPositionKM      *[3]float64 `json:"receptionPositionKm,omitempty"`
	LightTimeResidualSeconds *float64    `json:"lightTimeResidualSeconds,omitempty"`
	Warnings                 []string    `json:"warnings"`
}

// Astrometric observer state in the original SPK's J2000 axes. It is not a
// tectonic station solution or an exact relativistic terrestrial/BCRS transform.
type ObserverState struct {
	Frame               string     `json:"frame"`
	Origin              string     `json:"origin"`
	PositionKM          [3]float64 `json:"positionKm"`
	VelocityKMPerSecond [3]float64 `json:"velocityKmPerSecond"`
	EpochTDB            [2]float64 `json:"epochJdTdbParts"`
}

type Source struct {
	BodyID       string  `json:"bodyId"`
	Source       string  `json:"source"`
	KernelSHA256 string  `json:"kernelSha256"`
	StartJDTDB   float64 `json:"startJdTdb"`
	EndJDTDB     float64 `json:"endJdTdb"`
}

type Result struct {
	Model             string                  `json:"model"`
	Request           Request                 `json:"request"`
	JDTDB             float64                 `json:"jdTdb"`
	JDTT              float64                 `json:"jdTt"`
	JDUT1             float64                 `json:"jdUt1"`
	TDBMinusTTSeconds float64                 `json:"tdbMinusTtSeconds"`
	EOP               earthorientation.Sample `json:"earthOrientation"`
	Bodies            []BodyResult            `json:"bodies"`
	Sources           []Source                `json:"sources"`
	Warnings          []string                `json:"warnings"`
	Contract          map[string]any          `json:"contract"`
	ObserverState     ObserverState           `json:"observerState"`
}

type Error struct{ Code, Message string }

func (e *Error) Error() string        { return e.Message }
func fail(code, message string) error { return &Error{code, message} }
func finite(v float64) bool           { return !math.IsNaN(v) && !math.IsInf(v, 0) }

var utcPattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d{1,9})?)Z$`)

// UTC is explicit ISO-8601 Z, including a real UTC leap second. Dtf2d produces
// SOFA quasi-JD, avoiding a 86400-second JavaScript-day assumption on leap days.
func utcParts(value string) (float64, float64, int, error) {
	parts := utcPattern.FindStringSubmatch(value)
	if parts == nil {
		return 0, 0, 0, fail("invalid_utc", "utc must be YYYY-MM-DDTHH:mm:ss[.fraction]Z")
	}
	n := make([]int, 5)
	for i := range n {
		n[i], _ = strconv.Atoi(parts[i+1])
	}
	seconds, _ := strconv.ParseFloat(parts[6], 64)
	var d1, d2 float64
	status := gofa.Dtf2d("UTC", n[0], n[1], n[2], n[3], n[4], seconds, &d1, &d2)
	if status < 0 || status&2 != 0 {
		return 0, 0, status, fail("invalid_utc", "utc is not a valid UTC calendar instant")
	}
	return d1, d2, status, nil
}

func (req Request) Validate() error {
	if _, _, _, err := utcParts(req.UTC); err != nil {
		return err
	}
	s := req.Station
	if !finite(s.LongitudeDeg) || !finite(s.LatitudeDeg) || !finite(s.HeightMeters) || math.Abs(s.LongitudeDeg) > 180 || math.Abs(s.LatitudeDeg) > 90 || s.HeightMeters < -1000 || s.HeightMeters > 100000 {
		return fail("invalid_station", "WGS84 station requires longitude [-180,180], latitude [-90,90] degrees and ellipsoidal height [-1000,100000] meters")
	}
	if len(req.BodyIDs) < 1 || len(req.BodyIDs) > MaxBodies {
		return fail("invalid_bodies", "bodyIds must contain 1 to 32 distinct catalog identifiers")
	}
	seen := map[string]bool{}
	for _, id := range req.BodyIDs {
		if id == "" || len(id) > 160 || seen[id] {
			return fail("invalid_bodies", "bodyIds must contain distinct nonempty catalog identifiers")
		}
		seen[id] = true
	}
	if a := req.Atmosphere; a != nil {
		if !finite(a.PressureHPa) || a.PressureHPa < 0 || a.PressureHPa > 1100 || !finite(a.TemperatureC) || a.TemperatureC < -100 || a.TemperatureC > 100 || !finite(a.RelativeHumidity) || a.RelativeHumidity < 0 || a.RelativeHumidity > 1 || !finite(a.WavelengthMicrometers) || a.WavelengthMicrometers < 0.1 || a.WavelengthMicrometers > 1e6 {
			return fail("invalid_atmosphere", "atmosphere is outside the supported pressure, temperature, humidity or wavelength range")
		}
	}
	return nil
}

type session struct {
	ctx        context.Context
	evaluate   Evaluator
	sources    map[string]*Source
	identities map[string]string
}

func (s *session) states(ids []string, jd float64) (map[string]catalog.State, map[string]bool, error) {
	if err := s.ctx.Err(); err != nil {
		return nil, nil, err
	}
	states, found, evidence, err := s.evaluate(s.ctx, ids, jd)
	if err != nil {
		return nil, nil, err
	}
	for _, id := range ids {
		if !found[id] {
			continue
		}
		st, ok := states[id]
		e := evidence[id]
		if !ok || !validState(st) || e.Source == "" || e.KernelSHA256 == "" {
			return nil, nil, fail("invalid_state_evidence", "SPK evaluation lacks finite state or source evidence")
		}
		key := id + "\x00" + e.Source + "\x00" + e.KernelSHA256
		if previous, exists := s.identities[id]; exists && previous != key {
			return nil, nil, fail("ephemeris_source_changed", "SPK solution changed within the observation job")
		}
		s.identities[id] = key
		if old := s.sources[key]; old != nil {
			old.StartJDTDB = math.Min(old.StartJDTDB, jd)
			old.EndJDTDB = math.Max(old.EndJDTDB, jd)
		} else {
			s.sources[key] = &Source{id, e.Source, e.KernelSHA256, jd, jd}
		}
	}
	return states, found, nil
}

func validState(s catalog.State) bool {
	return finite(s.Position.X) && finite(s.Position.Y) && finite(s.Position.Z) && finite(s.Velocity.X) && finite(s.Velocity.Y) && finite(s.Velocity.Z)
}

// NAIF's ECLIPJ2000 is the fixed J2000 ecliptic, not ecliptic-of-date. The
// inverse of the catalog rotation uses its same 84381.448 arcsecond obliquity.
func equatorial(v catalog.Vec3) [3]float64 {
	eps := 84381.448 * gofa.DAS2R
	return [3]float64{v.X / auKM, (v.Y*math.Cos(eps) - v.Z*math.Sin(eps)) / auKM, (v.Y*math.Sin(eps) + v.Z*math.Cos(eps)) / auKM}
}
func sub(a, b [3]float64) [3]float64 { return [3]float64{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func unit(v [3]float64) ([3]float64, float64) {
	var n float64
	var u [3]float64
	gofa.Pn(v, &n, &u)
	return u, n
}

func direction(p [3]float64, astrom gofa.ASTROM) Direction {
	var cirs [3]float64
	gofa.Rxp(astrom.Bpn, p, &cirs)
	var ra, dec, az, zd, ha, od, ora float64
	gofa.C2s(cirs, &ra, &dec)
	gofa.Atioq(ra, dec, &astrom, &az, &zd, &ha, &od, &ora)
	return Direction{gofa.Anp(az) * gofa.DR2D, 90 - zd*gofa.DR2D}
}

func Evaluate(ctx context.Context, req Request, eop *earthorientation.Table, evaluate Evaluator) (*Result, error) {
	sess := &session{ctx: ctx, evaluate: evaluate, sources: map[string]*Source{}, identities: map[string]string{}}
	return evaluateSession(ctx, req, eop, sess)
}

// A window shares this session so even disjoint observation instants cannot
// silently switch kernels. The immutable EOP table is shared as well.
func evaluateSession(ctx context.Context, req Request, eop *earthorientation.Table, sess *session) (*Result, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if eop == nil {
		return nil, fail("earth_orientation_unavailable", "no pinned IERS Earth orientation snapshot is configured")
	}
	utc1, utc2, status, _ := utcParts(req.UTC)
	sample, err := eop.AtUTC(utc1 + utc2)
	if err != nil {
		return nil, fail("earth_orientation_outside_coverage", err.Error())
	}
	var tai1, tai2, tt1, tt2, ut11, ut12, tdb1, tdb2 float64
	if gofa.Utctai(utc1, utc2, &tai1, &tai2) < 0 || gofa.Utcut1(utc1, utc2, sample.DUT1, &ut11, &ut12) < 0 {
		return nil, fail("invalid_utc", "UTC conversion failed")
	}
	gofa.Taitt(tai1, tai2, &tt1, &tt2)
	lon, lat := req.Station.LongitudeDeg*gofa.DD2R, req.Station.LatitudeDeg*gofa.DD2R
	var stationXYZ [3]float64
	gofa.Gd2gc(gofa.WGS84, lon, lat, req.Station.HeightMeters, &stationXYZ)
	utFraction := math.Mod(math.Mod(ut11, 1)+math.Mod(ut12, 1)+0.5, 1)
	if utFraction < 0 {
		utFraction++
	}
	dtr := gofa.Dtdb(tt1, tt2, utFraction, lon, math.Hypot(stationXYZ[0], stationXYZ[1])/1000, stationXYZ[2]/1000)
	gofa.Tttdb(tt1, tt2, dtr, &tdb1, &tdb2)
	jd := tdb1 + tdb2
	ids := append([]string{"naif:399", "naif:10"}, req.BodyIDs...)
	states, found, err := sess.states(ids, jd)
	if err != nil {
		return nil, err
	}
	if !found["naif:399"] || !found["naif:10"] {
		return nil, fail("observer_ephemeris_unavailable", "Earth center and Sun require complete SPK states at reception")
	}
	earth, sun := states["naif:399"], states["naif:10"]
	ep, ev, sp := equatorial(earth.Position), equatorial(earth.Velocity), equatorial(sun.Position)
	for i := range ev {
		ev[i] *= gofa.DAYSEC
	}
	var x, y, cio float64
	gofa.Xys06a(tt1, tt2, &x, &y, &cio)
	if sample.CPOAvailable {
		x += *sample.DX * gofa.DMAS2R
		y += *sample.DY * gofa.DMAS2R
		cio = gofa.S06(tt1, tt2, x, y)
	}
	var astrom gofa.ASTROM
	gofa.Apco(tdb1, tdb2, [2][3]float64{ep, ev}, sub(ep, sp), x, y, cio, gofa.Era00(ut11, ut12), lon, lat, req.Station.HeightMeters, sample.XP*gofa.DAS2R, sample.YP*gofa.DAS2R, gofa.Sp00(tt1, tt2), 0, 0, &astrom)
	if !finite(astrom.Bm1) || astrom.Em <= 0 {
		return nil, fail("invalid_observer_state", "observer state is not physically valid")
	}
	refracted := astrom
	if req.Atmosphere != nil {
		a := req.Atmosphere
		gofa.Refco(a.PressureHPa, a.TemperatureC, a.RelativeHumidity, a.WavelengthMicrometers, &refracted.Refa, &refracted.Refb)
	}
	result := &Result{Model: Model, Request: req, JDTDB: jd, JDTT: tt1 + tt2, JDUT1: ut11 + ut12, TDBMinusTTSeconds: dtr, EOP: sample, Bodies: make([]BodyResult, 0, len(req.BodyIDs)), Sources: []Source{}, Warnings: []string{}, Contract: map[string]any{
		"stationDatum": "WGS84-ellipsoidal-height", "azimuthConvention": "north-zero-east-positive", "angleUnit": "deg", "sourceFrame": "ECLIPJ2000", "sourceOrigin": "solar-system-barycenter", "astrometryLibrary": "github.com/hebl/gofa@v1.19.1", "precessionNutation": "IAU-2006/2000A", "timeConversion": "SOFA-UTC-TAI-TT-UT1; Fairhead-Bretagnon-topocentric-TDB", "lightDeflection": "finite-distance-solar-monopole", "lightTimeToleranceSeconds": lightTimeToleranceSeconds, "physicalUncertainty": "not-propagated", "leapSecondTableLastEffectiveUTC": "2017-01-01", "excludedEffects": []string{"planetary-light-deflection", "Shapiro-light-time", "station-tectonic-motion", "solid-earth-and-ocean-tides", "terrain-horizon", "finite-target-limb"},
	}}
	result.ObserverState = ObserverState{Frame: "J2000", Origin: "solar-system-barycenter", EpochTDB: [2]float64{tdb1, tdb2}}
	for i := 0; i < 3; i++ {
		result.ObserverState.PositionKM[i] = astrom.Eb[i] * auKM
		result.ObserverState.VelocityKMPerSecond[i] = astrom.V[i] * gofa.CMPS / 1000
	}
	result.Contract["vectorFrame"] = "J2000"
	result.Contract["vectorUnit"] = "km"
	result.Contract["vectorOrigin"] = "observer-at-reception"
	result.Contract["receptionVector"] = "target-at-iterated-emission-minus-observer-at-reception; no aberration or deflection"
	result.Contract["observerStateModel"] = "SOFA-Apco; terrestrial rotation plus source Earth barycentric state"
	if status > 0 {
		result.Warnings = append(result.Warnings, "sofa-dubious-year")
	}
	if utc1+utc2 >= 2457754.5 {
		result.Warnings = append(result.Warnings, "no-leap-seconds-after-2017-assumed")
	}
	if sample.Predicted {
		result.Warnings = append(result.Warnings, "iers-predicted-earth-orientation")
	}
	if !sample.CPOAvailable {
		result.Warnings = append(result.Warnings, "celestial-pole-correction-unavailable-model-only")
	}
	for _, id := range req.BodyIDs {
		body, err := sess.body(id, jd, states, found, astrom, refracted, req.Atmosphere != nil, sp)
		if err != nil {
			return nil, err
		}
		result.Bodies = append(result.Bodies, body)
	}
	for _, source := range sess.sources {
		result.Sources = append(result.Sources, *source)
	}
	sort.Slice(result.Sources, func(i, j int) bool {
		a, b := result.Sources[i], result.Sources[j]
		return a.BodyID+"\x00"+a.Source+"\x00"+a.KernelSHA256 < b.BodyID+"\x00"+b.Source+"\x00"+b.KernelSHA256
	})
	return result, nil
}

func (s *session) body(id string, jd float64, states map[string]catalog.State, found map[string]bool, astrom, refracted gofa.ASTROM, useRefraction bool, sun [3]float64) (BodyResult, error) {
	out := BodyResult{BodyID: id, Status: "missing", Warnings: []string{}}
	missing := func(reason string) (BodyResult, error) { out.MissingReason = reason; return out, nil }
	if id == "earth" || id == "naif:399" {
		return missing("target-is-observer-central-body")
	}
	if !found[id] {
		return missing("target-reception-spk-unavailable")
	}
	geometricVector := sub(equatorial(states[id].Position), astrom.Eb)
	geometric, distance := unit(geometricVector)
	if distance <= 0 {
		return missing("zero-observer-target-distance")
	}
	g := direction(geometric, astrom)
	tau, emission := distance*gofa.AULT, jd
	var target, p [3]float64
	var residual float64
	converged := false
	for i := 0; i < 16; i++ {
		emission = jd - tau/gofa.DAYSEC
		st, ok, err := s.states([]string{id}, emission)
		if err != nil {
			return out, err
		}
		if !ok[id] {
			return missing("target-emission-spk-unavailable")
		}
		target = equatorial(st[id].Position)
		p, distance = unit(sub(target, astrom.Eb))
		next := distance * gofa.AULT
		out.Iterations = i + 1
		residual = math.Abs(next - tau)
		if residual <= lightTimeToleranceSeconds {
			converged = true
			break
		}
		tau = next
	}
	if !converged {
		return missing("light-time-not-converged")
	}
	if distance <= 0 {
		return missing("zero-observer-target-distance")
	}
	pnat := p
	if id != "sun" && id != "naif:10" {
		// Deflector at closest approach along the finite observer-target ray.
		delay := math.Max(0, math.Min(tau, gofa.Pdp(sub(sun, astrom.Eb), p)*gofa.AULT))
		if delay > 0 {
			st, ok, err := s.states([]string{"naif:10"}, jd-delay/gofa.DAYSEC)
			if err != nil {
				return out, err
			}
			if !ok["naif:10"] {
				return missing("deflector-spk-unavailable")
			}
			sun = equatorial(st["naif:10"].Position)
		}
		q, qn := unit(sub(target, sun))
		e, em := unit(sub(astrom.Eb, sun))
		if qn <= 0 || em <= 0 {
			return missing("undefined-solar-deflection")
		}
		gofa.Ld(1, p, q, e, em, 1e-6/math.Max(em*em, 1), &pnat)
		if gofa.Pdp(q, [3]float64{q[0] + e[0], q[1] + e[1], q[2] + e[2]}) < 1e-6/math.Max(em*em, 1) {
			out.Warnings = append(out.Warnings, "solar-deflection-limited-near-solar-limb")
		}
	}
	var apparent [3]float64
	gofa.Ab(pnat, astrom.V, astrom.Em, astrom.Bm1, &apparent)
	a := direction(apparent, astrom)
	out.Status = "available"
	out.Geometric = &g
	out.ApparentAirless = &a
	rangeKM := distance * auKM
	out.RangeKM = &rangeKM
	out.LightTimeSeconds = &tau
	out.EmissionJDTDB = &emission
	var geometricKM, receptionKM [3]float64
	for i := 0; i < 3; i++ {
		geometricKM[i] = geometricVector[i] * auKM
		receptionKM[i] = (target[i] - astrom.Eb[i]) * auKM
	}
	out.GeometricPositionKM = &geometricKM
	out.ReceptionPositionKM = &receptionKM
	out.LightTimeResidualSeconds = &residual
	if useRefraction {
		// SOFA's limited low-altitude model is not evidence of a refracted
		// direction below the horizon. Expose null and the model boundary.
		if a.AltitudeDeg >= 5 {
			r := direction(apparent, refracted)
			out.Refracted = &r
		} else {
			out.Warnings = append(out.Warnings, "refraction-outside-supported-altitude-at-least-5-deg")
		}
	}
	if !finite(a.AzimuthDeg) || !finite(a.AltitudeDeg) {
		return out, fmt.Errorf("non-finite observed direction for %s", id)
	}
	return out, nil
}
