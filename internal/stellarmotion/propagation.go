// Package stellarmotion propagates explicitly adopted single-star catalog models.
package stellarmotion

import (
	"fmt"
	"math"
	"regexp"
	"strconv"

	"github.com/hebl/gofa"
)

type Source struct {
	ID             string   `json:"source_id"`
	Epoch          float64  `json:"ref_epoch"`
	RA             *float64 `json:"ra"`
	Dec            *float64 `json:"dec"`
	Parallax       *float64 `json:"parallax"`
	PMRA           *float64 `json:"pmra"`
	PMDec          *float64 `json:"pmdec"`
	RadialVelocity *float64 `json:"radial_velocity"`
	Solution       int      `json:"astrometric_params_solved"`
}
type State struct {
	RA             float64 `json:"raDeg"`
	Dec            float64 `json:"decDeg"`
	Parallax       float64 `json:"parallaxMas"`
	PMRA           float64 `json:"pmraMasPerJulianYear"`
	PMDec          float64 `json:"pmdecMasPerJulianYear"`
	RadialVelocity float64 `json:"radialVelocityKmPerSecond"`
}
type Result struct {
	Model                string     `json:"model"`
	SourceID             string     `json:"sourceId"`
	TargetEpochTCB       float64    `json:"targetEpochJulianYearTCB"`
	SourceTDB            [2]float64 `json:"sourceJdTdbParts"`
	TargetTDB            [2]float64 `json:"targetJdTdbParts"`
	State                State      `json:"stateTCBCompatible"`
	ScaleFactor          float64    `json:"tdbCompatibleScaleFactor"`
	RadialVelocityPolicy string     `json:"radialVelocityPolicy"`
	Limitations          []string   `json:"limitations"`
}

var sourceID = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// Propagate adopts the spectroscopic RV as the catalog astrometric RV only
// when the caller explicitly selects that approximation. Bounds limit supported
// use, not physical accuracy. No distance override or velocity clamp is accepted.
func Propagate(source Source, targetYearTCB float64, rvPolicy string) (*Result, error) {
	if rvPolicy != "spectroscopic-as-astrometric" {
		return nil, fmt.Errorf("explicit spectroscopic radial-velocity approximation required")
	}
	if !sourceID.MatchString(source.ID) || source.Epoch != 2016 || (source.Solution != 31 && source.Solution != 95) {
		return nil, fmt.Errorf("unsupported Gaia source identity, epoch or solution")
	}
	if _, err := strconv.ParseInt(source.ID, 10, 64); err != nil {
		return nil, fmt.Errorf("source ID exceeds signed 64-bit range")
	}
	for _, v := range []*float64{source.RA, source.Dec, source.Parallax, source.PMRA, source.PMDec, source.RadialVelocity} {
		if v == nil || !finite(*v) {
			return nil, fmt.Errorf("complete finite astrometry and radial velocity required")
		}
	}
	if *source.RA < 0 || *source.RA >= 360 || math.Abs(*source.Dec) >= 90 || *source.Parallax <= 0 || !finite(targetYearTCB) || math.Abs(targetYearTCB-source.Epoch) > 100 {
		return nil, fmt.Errorf("stellar propagation outside supported input domain")
	}
	// Coordinate scaling t*=F t + constant, x*=F x leaves velocities unchanged.
	// With the same fixed AU in metres, formal parallax and angular rates divide
	// by F. Convert back before publishing any Gaia-compatible output.
	const f = 1 - gofa.ELB
	var ep1a, ep1b, ep2a, ep2b float64
	gofa.Tcbtdb(gofa.DJ00, (source.Epoch-2000)*gofa.DJY, &ep1a, &ep1b)
	gofa.Tcbtdb(gofa.DJ00, (targetYearTCB-2000)*gofa.DJY, &ep2a, &ep2b)
	dec := *source.Dec * gofa.DD2R
	pmr := *source.PMRA * gofa.DMAS2R / math.Cos(dec) / f
	pmd := *source.PMDec * gofa.DMAS2R / f
	if !finite(pmr) || !finite(pmd) {
		return nil, fmt.Errorf("unrepresentable catalog angular rate")
	}
	var ra2, dec2, pmr2, pmd2, px2, rv2 float64
	status := gofa.Starpm(*source.RA*gofa.DD2R, dec, pmr, pmd, *source.Parallax/1000/f, *source.RadialVelocity, ep1a, ep1b, ep2a, ep2b, &ra2, &dec2, &pmr2, &pmd2, &px2, &rv2)
	if status != 0 {
		return nil, fmt.Errorf("SOFA stellar propagation refused modified or unconverged state: status %d", status)
	}
	state := State{ra2 * gofa.DR2D, dec2 * gofa.DR2D, px2 * 1000 * f, pmr2 * f * math.Cos(dec2) / gofa.DMAS2R, pmd2 * f / gofa.DMAS2R, rv2}
	for _, v := range []float64{state.RA, state.Dec, state.Parallax, state.PMRA, state.PMDec, state.RadialVelocity} {
		if !finite(v) {
			return nil, fmt.Errorf("non-finite stellar state")
		}
	}
	return &Result{Model: "gofa-starpm-scaled-gaia-single-star-v1", SourceID: source.ID, TargetEpochTCB: targetYearTCB, SourceTDB: [2]float64{ep1a, ep1b}, TargetTDB: [2]float64{ep2a, ep2b}, State: state, ScaleFactor: f, RadialVelocityPolicy: rvPolicy,
		Limitations: []string{"Uniform rectilinear single-star motion with SOFA changing-light-time and special-relativistic treatment.", "Spectroscopic radial velocity is adopted as astrometric radial velocity; gravitational/convective and binary shifts are not corrected.", "Positive measured parallax supplies a nominal distance, not a Bayesian distance estimate.", "No uncertainty propagation, systematics, acceleration, Galactic potential, observer parallax, deflection or aberration.", "Numerical agreement is not a physical positional-accuracy certificate; missing inputs and SOFA warnings are rejected."}}, nil
}
