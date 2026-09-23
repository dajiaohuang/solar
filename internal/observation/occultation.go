package observation

import (
	"context"
	"math"
	"strconv"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
)

type OccultationRequest struct {
	UTC          string  `json:"utc"`
	Station      Station `json:"station"`
	ForegroundID int     `json:"foregroundId"`
	BackgroundID int     `json:"backgroundId"`
	Aberration   string  `json:"aberration"`
}
type SphereGeometry struct {
	Classification                 string  `json:"classification"`
	SeparationRadians              float64 `json:"separationRadians"`
	ForegroundAngularRadiusRadians float64 `json:"foregroundAngularRadiusRadians"`
	BackgroundAngularRadiusRadians float64 `json:"backgroundAngularRadiusRadians"`
	ExternalGapRadians             float64 `json:"externalGapRadians"`
	InternalGapRadians             float64 `json:"internalGapRadians"`
}
type OccultationResult struct {
	Model                            string             `json:"model"`
	Request                          OccultationRequest `json:"request"`
	Geometry                         SphereGeometry     `json:"geometry"`
	Observation                      *Result            `json:"observation"`
	Foreground                       bodyshape.Radii    `json:"foreground"`
	Background                       bodyshape.Radii    `json:"background"`
	RadiusSourceSHA256               string             `json:"radiusSourceSha256"`
	RadiusSourceURL                  string             `json:"radiusSourceUrl"`
	PhysicalTimingUncertaintySeconds *float64           `json:"physicalTimingUncertaintySeconds"`
	Limitations                      []string           `json:"limitations"`
}

// EvaluateOccultation uses the observation session's actual station and retarded
// vectors. Apparent center deflection/aberration is deliberately not applied to
// geometric sphere limbs, for which those corrections need a separate model.
func EvaluateOccultation(ctx context.Context, req OccultationRequest, shapes *bodyshape.Table, eop *earthorientation.Table, evaluate Evaluator) (*OccultationResult, error) {
	sess := &session{ctx: ctx, evaluate: evaluate, sources: map[string]*Source{}, identities: map[string]string{}}
	return evaluateOccultationSession(ctx, req, shapes, eop, sess)
}

func evaluateOccultationSession(ctx context.Context, req OccultationRequest, shapes *bodyshape.Table, eop *earthorientation.Table, sess *session) (*OccultationResult, error) {
	if req.Aberration != "CN" || req.ForegroundID <= 0 || req.BackgroundID <= 0 || req.ForegroundID == req.BackgroundID || req.ForegroundID == 399 || req.BackgroundID == 399 {
		return nil, fail("invalid_occultation", "ground occultation requires explicit CN and distinct non-Earth NAIF target IDs")
	}
	front, okFront := shapes.Get(req.ForegroundID)
	back, okBack := shapes.Get(req.BackgroundID)
	if !okFront || !okBack || front.Representation != "sphere" || back.Representation != "sphere" {
		return nil, fail("unsupported_body_shape", "both targets require sourced equal-axis PCK spheres; no mean-radius substitution")
	}
	observation, err := evaluateSession(ctx, Request{UTC: req.UTC, Station: req.Station, BodyIDs: []string{"naif:" + strconv.Itoa(req.ForegroundID), "naif:" + strconv.Itoa(req.BackgroundID)}}, eop, sess)
	if err != nil {
		return nil, err
	}
	a, b := observation.Bodies[0], observation.Bodies[1]
	if a.Status != "available" || b.Status != "available" || a.ReceptionPositionKM == nil || b.ReceptionPositionKM == nil {
		return nil, fail("occultation_ephemeris_unavailable", "both targets require complete reception vectors")
	}
	geometry, err := sphereGeometry(*a.ReceptionPositionKM, front.RadiiKM[0], *b.ReceptionPositionKM, back.RadiiKM[0])
	if err != nil {
		return nil, err
	}
	return &OccultationResult{Model: "earth-station-cn-spherical-limbs-v1", Request: req, Geometry: geometry,
		Observation: observation, Foreground: front, Background: back, RadiusSourceSHA256: bodyshape.SHA256, RadiusSourceURL: bodyshape.SourceURL,
		Limitations: []string{"Single-epoch geometry, not contact timing, event completeness or physical event probability.",
			"Sphere approximation without orientation, terrain/topography, atmosphere, rings or differential light time across limbs.",
			"CN center reception only: no stellar aberration or gravitational deflection of the limbs.",
			"Geometry can exist below the horizon; this result does not certify ground visibility.",
			"Physical source and model uncertainties are not propagated; numerical thresholds are not error bars."}}, nil
}

func sphereGeometry(a [3]float64, ra float64, b [3]float64, rb float64) (SphereGeometry, error) {
	var out SphereGeometry
	direction := func(p [3]float64, radius float64) ([3]float64, float64, float64, error) {
		d := math.Hypot(math.Hypot(p[0], p[1]), p[2])
		if !finite(d) || !finite(radius) || radius <= 0 || d <= radius {
			return p, 0, 0, fail("invalid_sphere_geometry", "observer must be outside finite positive-radius spheres")
		}
		angle := math.Asin(radius / d)
		if angle <= 0 {
			return p, 0, 0, fail("invalid_sphere_geometry", "angular radius is not representable")
		}
		return [3]float64{p[0] / d, p[1] / d, p[2] / d}, d, angle, nil
	}
	x, da, aa, err := direction(a, ra)
	if err != nil {
		return out, err
	}
	y, db, ab, err := direction(b, rb)
	if err != nil {
		return out, err
	}
	if !(da+ra < db-rb) {
		return out, fail("ambiguous_sphere_depth", "foreground sphere must be entirely nearer than background")
	}
	cross := [3]float64{x[1]*y[2] - x[2]*y[1], x[2]*y[0] - x[0]*y[2], x[0]*y[1] - x[1]*y[0]}
	out.SeparationRadians = math.Atan2(math.Hypot(math.Hypot(cross[0], cross[1]), cross[2]), x[0]*y[0]+x[1]*y[1]+x[2]*y[2])
	out.ForegroundAngularRadiusRadians, out.BackgroundAngularRadiusRadians = aa, ab
	out.ExternalGapRadians, out.InternalGapRadians = out.SeparationRadians-aa-ab, out.SeparationRadians-math.Abs(aa-ab)
	out.Classification = "none"
	if out.ExternalGapRadians < 0 {
		out.Classification = "partial"
		if out.InternalGapRadians <= 0 {
			out.Classification = "annular"
			if aa >= ab {
				out.Classification = "total"
			}
		}
	}
	return out, nil
}
