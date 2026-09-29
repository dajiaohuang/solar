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
const futureLeapSecondUncertaintyStartUTC = "2027-07-01"
const futureLeapSecondUncertaintyStartJDUTC = 2461587.5 // 2027-07-01, per the current IERS/NAIF confirmation horizon.
const MaxBodies = 32
const auKM = gofa.DAU / 1000
const lightTimeToleranceSeconds = 0.00005             // Legacy one-part-JD callback tolerance, not physical accuracy.
const splitEpochLightTimeToleranceSeconds = 0.0000005 // Half-microsecond numerical target; physical uncertainty is not included.

type Evaluator func(context.Context, []string, float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error)
type ETEvaluator func(context.Context, []string, float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error)

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
	EmissionJDTDBParts       *[2]float64 `json:"emissionJdTdbParts,omitempty"`
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
	// In-process only: preserve the same source/EOP context for stellar
	// transforms. A decoded JSON receipt cannot recreate this authority.
	astrometry          *gofa.ASTROM
	refractedAstrometry *gofa.ASTROM
	Model               string                  `json:"model"`
	Request             Request                 `json:"request"`
	JDTDB               float64                 `json:"jdTdb"`
	JDTT                float64                 `json:"jdTt"`
	JDUT1               float64                 `json:"jdUt1"`
	TDBMinusTTSeconds   float64                 `json:"tdbMinusTtSeconds"`
	EOP                 earthorientation.Sample `json:"earthOrientation"`
	Bodies              []BodyResult            `json:"bodies"`
	Sources             []Source                `json:"sources"`
	Warnings            []string                `json:"warnings"`
	Contract            map[string]any          `json:"contract"`
	ObserverState       ObserverState           `json:"observerState"`
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
	evaluateET ETEvaluator
	sources    map[string]*Source
	identities map[string]string
}

func (s *session) states(ids []string, jd float64) (map[string]catalog.State, map[string]bool, error) {
	return s.statesWith(ids, jd, func(ctx context.Context, ids []string) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		return s.evaluate(ctx, ids, jd)
	})
}

func (s *session) statesAtET(ids []string, jd, et float64) (map[string]catalog.State, map[string]bool, error) {
	if s.evaluateET == nil {
		return s.states(ids, jd)
	}
	return s.statesWith(ids, jd, func(ctx context.Context, ids []string) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		return s.evaluateET(ctx, ids, et)
	})
}

func (s *session) statesWith(ids []string, jd float64, evaluate func(context.Context, []string) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error)) (map[string]catalog.State, map[string]bool, error) {
	if err := s.ctx.Err(); err != nil {
		return nil, nil, err
	}
	states, found, evidence, err := evaluate(s.ctx, ids)
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

func tdbPartsToET(tdb1, tdb2 float64) float64 {
	// Keep the low SOFA date part through the conversion to seconds. A direct
	// tdb1+tdb2 first rounds the absolute JD in ~40-microsecond increments.
	highDays := tdb1 - 2451545.0
	sumDays := highDays + tdb2
	carried := sumDays - highDays
	lowDays := (highDays - (sumDays - carried)) + (tdb2 - carried)
	return math.FMA(sumDays, gofa.DAYSEC, lowDays*gofa.DAYSEC)
}

func tdbPartsFromET(et float64) [2]float64 {
	days := et / gofa.DAYSEC
	wholeDays := math.Floor(days)
	return [2]float64{2451545.0 + wholeDays, days - wholeDays}
}

// rotateEclipticToEquatorial changes axes only and preserves the input unit.
// NAIF's ECLIPJ2000 is the fixed J2000 ecliptic, not ecliptic-of-date; this is
// the inverse of the catalog rotation with the same 84381.448 arcsecond obliquity.
func rotateEclipticToEquatorial(v catalog.Vec3) [3]float64 {
	eps := 84381.448 * gofa.DAS2R
	return [3]float64{v.X, v.Y*math.Cos(eps) - v.Z*math.Sin(eps), v.Y*math.Sin(eps) + v.Z*math.Cos(eps)}
}

func positionKmToAU(v catalog.Vec3) [3]float64 {
	rotated := rotateEclipticToEquatorial(v)
	return [3]float64{rotated[0] / auKM, rotated[1] / auKM, rotated[2] / auKM}
}

func velocityKmPerSecondToAUPerDay(v catalog.Vec3) [3]float64 {
	rotated := rotateEclipticToEquatorial(v)
	perDay := gofa.DAYSEC / auKM
	return [3]float64{rotated[0] * perDay, rotated[1] * perDay, rotated[2] * perDay}
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

// EvaluateWithET resolves source states in seconds past J2000 TDB. It retains
// SOFA's split reception date through catalog evaluation and light-time shifts.
func EvaluateWithET(ctx context.Context, req Request, eop *earthorientation.Table, evaluate ETEvaluator) (*Result, error) {
	sess := &session{ctx: ctx, evaluateET: evaluate, sources: map[string]*Source{}, identities: map[string]string{}}
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
	sample, err := eop.AtUTCParts(utc1, utc2)
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
	et := tdbPartsToET(tdb1, tdb2)
	if !finite(et) {
		return nil, fail("invalid_tdb_epoch", "split TDB date cannot be represented as seconds past J2000")
	}
	ids := append([]string{"naif:399", "naif:10"}, req.BodyIDs...)
	states, found, err := sess.statesAtET(ids, jd, et)
	if err != nil {
		return nil, err
	}
	if !found["naif:399"] || !found["naif:10"] {
		return nil, fail("observer_ephemeris_unavailable", "Earth center and Sun require complete SPK states at reception")
	}
	earth, sun := states["naif:399"], states["naif:10"]
	ep, ev, sp := positionKmToAU(earth.Position), velocityKmPerSecondToAUPerDay(earth.Velocity), positionKmToAU(sun.Position)
	var x, y, cio float64
	gofa.Xys06a(tt1, tt2, &x, &y, &cio)
	if sample.CPOAvailable {
		// The SOFA CIO-based correction recipe adjusts CIP X/Y while retaining
		// the model CIO locator s returned by Xys06a.
		x += *sample.DX * gofa.DMAS2R
		y += *sample.DY * gofa.DMAS2R
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
		if !finite(refracted.Refa) || !finite(refracted.Refb) {
			return nil, fail("invalid_atmosphere", "atmosphere produces non-finite refraction coefficients")
		}
	}
	lightTimeTolerance := lightTimeToleranceSeconds
	epochEvaluation := "one-part-julian-date-compatibility"
	if sess.evaluateET != nil {
		lightTimeTolerance = splitEpochLightTimeToleranceSeconds
		epochEvaluation = "seconds-past-j2000-tdb"
	}
	result := &Result{Model: Model, Request: req, JDTDB: jd, JDTT: tt1 + tt2, JDUT1: ut11 + ut12, TDBMinusTTSeconds: dtr, EOP: sample, Bodies: make([]BodyResult, 0, len(req.BodyIDs)), Sources: []Source{}, Warnings: []string{}, Contract: map[string]any{
		"stationDatum": "WGS84-ellipsoidal-height", "azimuthConvention": "north-zero-east-positive", "angleUnit": "deg", "sourceFrame": "ECLIPJ2000", "sourceOrigin": "solar-system-barycenter", "astrometryLibrary": "github.com/hebl/gofa@v1.19.1", "precessionNutation": "IAU-2006/2000A", "timeConversion": "SOFA-UTC-TAI-TT-UT1; Fairhead-Bretagnon-topocentric-TDB", "epochEvaluation": epochEvaluation, "lightDeflection": "finite-distance-solar-monopole", "lightTimeToleranceSeconds": lightTimeTolerance, "physicalUncertainty": "not-propagated", "leapSecondTableLastEffectiveUTC": "2017-01-01", "futureLeapSecondUncertaintyStartUTC": futureLeapSecondUncertaintyStartUTC, "excludedEffects": []string{"planetary-light-deflection", "Shapiro-light-time", "station-tectonic-motion", "solid-earth-and-ocean-tides", "terrain-horizon", "finite-target-limb"},
	}}
	result.ObserverState = ObserverState{Frame: "J2000", Origin: "solar-system-barycenter", EpochTDB: [2]float64{tdb1, tdb2}}
	result.astrometry = &astrom
	if req.Atmosphere != nil {
		result.refractedAstrometry = &refracted
	}
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
	if (utc1-futureLeapSecondUncertaintyStartJDUTC)+utc2 >= 0 {
		result.Warnings = append(result.Warnings, "future-leap-seconds-assumed")
	}
	if sample.Predicted {
		result.Warnings = append(result.Warnings, "iers-predicted-earth-orientation")
	}
	if !sample.CPOAvailable {
		result.Warnings = append(result.Warnings, "celestial-pole-correction-unavailable-model-only")
	}
	for _, id := range req.BodyIDs {
		body, err := sess.body(id, jd, et, states, found, astrom, refracted, req.Atmosphere != nil, sp)
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

func (s *session) body(id string, jd, receptionET float64, states map[string]catalog.State, found map[string]bool, astrom, refracted gofa.ASTROM, useRefraction bool, sun [3]float64) (BodyResult, error) {
	out := BodyResult{BodyID: id, Status: "missing", Warnings: []string{}}
	missing := func(reason string) (BodyResult, error) { out.MissingReason = reason; return out, nil }
	if id == "earth" || id == "naif:399" {
		return missing("target-is-observer-central-body")
	}
	if !found[id] {
		return missing("target-reception-spk-unavailable")
	}
	geometricVector := sub(positionKmToAU(states[id].Position), astrom.Eb)
	geometric, distance := unit(geometricVector)
	if distance <= 0 {
		return missing("zero-observer-target-distance")
	}
	g := direction(geometric, astrom)
	tau, emission := distance*gofa.AULT, jd
	emissionET := receptionET
	var target, p [3]float64
	var residual float64
	converged := false
	for i := 0; i < 16; i++ {
		var st map[string]catalog.State
		var ok map[string]bool
		var err error
		if s.evaluateET != nil {
			emissionET = receptionET - tau
			parts := tdbPartsFromET(emissionET)
			emission = parts[0] + parts[1]
			st, ok, err = s.statesAtET([]string{id}, emission, emissionET)
		} else {
			emission = jd - tau/gofa.DAYSEC
			st, ok, err = s.states([]string{id}, emission)
		}
		if err != nil {
			return out, err
		}
		if !ok[id] {
			return missing("target-emission-spk-unavailable")
		}
		target = positionKmToAU(st[id].Position)
		p, distance = unit(sub(target, astrom.Eb))
		next := distance * gofa.AULT
		out.Iterations = i + 1
		if s.evaluateET != nil {
			residual = math.Max(math.Abs(next-tau), math.Abs((receptionET-emissionET)-next))
		} else {
			// Check the equation at the representable emission JD, not just
			// stagnation of successive delays on the one-part JD time grid.
			residual = math.Max(math.Abs(next-tau), math.Abs((jd-emission)*gofa.DAYSEC-next))
		}
		tau = next
		tolerance := lightTimeToleranceSeconds
		if s.evaluateET != nil {
			tolerance = splitEpochLightTimeToleranceSeconds
		}
		if residual <= tolerance {
			converged = true
			break
		}
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
			st, ok, err := s.statesAtET([]string{"naif:10"}, jd-delay/gofa.DAYSEC, receptionET-delay)
			if err != nil {
				return out, err
			}
			if !ok["naif:10"] {
				return missing("deflector-spk-unavailable")
			}
			sun = positionKmToAU(st["naif:10"].Position)
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
	if s.evaluateET != nil {
		parts := tdbPartsFromET(emissionET)
		out.EmissionJDTDBParts = &parts
	}
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
