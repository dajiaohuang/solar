package observation

import (
	"context"
	"math"
	"sort"
	"strconv"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
)

const ContactStepSeconds = 30.0
const ContactToleranceSeconds = 0.05
const MaxGroundContacts = 512

type ContactRequest struct {
	StartUTC     string  `json:"startUtc"`
	EndUTC       string  `json:"endUtc"`
	Station      Station `json:"station"`
	ForegroundID int     `json:"foregroundId"`
	BackgroundID int     `json:"backgroundId"`
	Aberration   string  `json:"aberration"`
}

func (req ContactRequest) Validate() error {
	if err := (OccultationRequest{UTC: req.StartUTC, Station: req.Station, ForegroundID: req.ForegroundID, BackgroundID: req.BackgroundID, Aberration: req.Aberration}).Validate(); err != nil {
		return err
	}
	_, err := (VisibilityRequest{StartUTC: req.StartUTC, EndUTC: req.EndUTC, Station: req.Station, BodyID: "naif:" + strconv.Itoa(req.ForegroundID)}).timeWindow()
	return err
}

type GroundContact struct {
	Boundary          string     `json:"boundary"`
	Direction         string     `json:"direction"`
	UTC               string     `json:"utc"`
	ElapsedTAISeconds float64    `json:"elapsedTaiSeconds"`
	BracketSeconds    [2]float64 `json:"bracketSeconds"`
	BracketUTC        [2]string  `json:"bracketUtc"`
}
type GroundWindowEdge struct {
	ElapsedTAISeconds float64    `json:"elapsedTaiSeconds"`
	UTC               string     `json:"utc"`
	BracketSeconds    [2]float64 `json:"bracketSeconds"`
	BracketUTC        [2]string  `json:"bracketUtc"`
	Kind              string     `json:"kind"`
}
type GroundOverlapWindow struct {
	Boundary                       string           `json:"boundary"`
	Start                          GroundWindowEdge `json:"start"`
	End                            GroundWindowEdge `json:"end"`
	DurationSeconds                float64          `json:"durationSeconds"`
	NumericalDurationBoundsSeconds [2]float64       `json:"numericalDurationBoundsSeconds"`
}
type ContactResult struct {
	Model                 string                    `json:"model"`
	Request               ContactRequest            `json:"request"`
	DurationSeconds       float64                   `json:"durationSeconds"`
	Contacts              []GroundContact           `json:"contacts"`
	SampledOverlapWindows []GroundOverlapWindow     `json:"sampledOverlapWindows"`
	Evaluations           int                       `json:"evaluations"`
	StartGeometry         SphereGeometry            `json:"startGeometry"`
	EndGeometry           SphereGeometry            `json:"endGeometry"`
	Sources               []Source                  `json:"sources"`
	EarthOrientation      earthorientation.Manifest `json:"earthOrientation"`
	RadiusSourceSHA256    string                    `json:"radiusSourceSha256"`
	RadiusSourceURL       string                    `json:"radiusSourceUrl"`
	Warnings              []string                  `json:"warnings"`
	PossibleMissedEvents  bool                      `json:"possibleMissedEvents"`
	Contract              map[string]any            `json:"contract"`
}

// SearchGroundContacts freezes one SPK identity session across every reception,
// emission and refinement epoch. Any failure rejects the whole job.
func SearchGroundContacts(ctx context.Context, req ContactRequest, shapes *bodyshape.Table, eop *earthorientation.Table, evaluate Evaluator) (*ContactResult, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	w, err := (VisibilityRequest{StartUTC: req.StartUTC, EndUTC: req.EndUTC, Station: req.Station, BodyID: "naif:" + strconv.Itoa(req.ForegroundID)}).timeWindow()
	if err != nil {
		return nil, err
	}
	if eop == nil {
		return nil, fail("earth_orientation_unavailable", "no pinned IERS Earth orientation snapshot is configured")
	}
	sess := &session{ctx: ctx, evaluate: evaluate, sources: map[string]*Source{}, identities: map[string]string{}}
	warnings := map[string]bool{}
	result, err := searchGroundContacts(ctx, w, func(t float64) (SphereGeometry, error) {
		point, err := evaluateOccultationSession(ctx, OccultationRequest{UTC: w.utc(t), Station: req.Station, ForegroundID: req.ForegroundID, BackgroundID: req.BackgroundID, Aberration: req.Aberration}, shapes, eop, sess)
		if err != nil {
			return SphereGeometry{}, err
		}
		for _, warning := range point.Observation.Warnings {
			warnings[warning] = true
		}
		for _, body := range point.Observation.Bodies {
			for _, warning := range body.Warnings {
				warnings[warning] = true
			}
		}
		return point.Geometry, nil
	})
	if err != nil {
		return nil, err
	}
	result.Request = req
	result.EarthOrientation = eop.Manifest
	result.RadiusSourceSHA256, result.RadiusSourceURL = bodyshape.SHA256, bodyshape.SourceURL
	for _, source := range sess.sources {
		result.Sources = append(result.Sources, *source)
	}
	sort.Slice(result.Sources, func(i, j int) bool { return result.Sources[i].BodyID < result.Sources[j].BodyID })
	for warning := range warnings {
		result.Warnings = append(result.Warnings, warning)
	}
	sort.Strings(result.Warnings)
	return result, nil
}

func searchGroundContacts(ctx context.Context, window taiWindow, evaluate func(float64) (SphereGeometry, error)) (*ContactResult, error) {
	out := &ContactResult{Model: "earth-station-cn-spherical-contacts-v1", DurationSeconds: window.duration, Contacts: []GroundContact{}, SampledOverlapWindows: []GroundOverlapWindow{}, Sources: []Source{}, Warnings: []string{}, PossibleMissedEvents: true,
		Contract: map[string]any{"timeAxis": "TAI-elapsed-SI-seconds", "stepSeconds": ContactStepSeconds, "toleranceSeconds": ContactToleranceSeconds,
			"maxEvaluations": MaxWindowEvaluations, "maxContacts": MaxGroundContacts, "coverage": "sampled-sign-changes-only", "physicalTimingUncertaintySeconds": nil,
			"limitations": []string{"Grazing contacts and multiple crossings between samples may be missed; no contacts does not prove no event.",
				"Source failures, cancellation and budgets reject the whole job, not a partial success.",
				"CN spherical center reception only; no apparent limb aberration/deflection, topography, refraction or visibility certification.",
				"Bracket widths describe numerical root localization, not physical timing uncertainty.",
				"Overlap windows infer negative-gap spans from sampled signs; unsampled gaps may split them. Search-boundary edges are clipped, and zero-only spans have no inferred duration."}}}
	edge := func(lo, hi float64, kind string) GroundWindowEdge {
		at := lo + (hi-lo)/2
		if at == 0 || at == window.duration {
			kind = "search-boundary"
		}
		return GroundWindowEdge{at, window.utc(at), [2]float64{lo, hi}, [2]string{window.utc(lo), window.utc(hi)}, kind}
	}
	spans := [2][]GroundOverlapWindow{}
	overlap := func(k int, boundary string, start, end GroundWindowEdge) {
		if end.ElapsedTAISeconds <= start.ElapsedTAISeconds {
			return
		}
		n := len(spans[k])
		if n > 0 && spans[k][n-1].End.ElapsedTAISeconds == start.ElapsedTAISeconds {
			spans[k][n-1].End = end
		} else {
			spans[k] = append(spans[k], GroundOverlapWindow{Boundary: boundary, Start: start, End: end})
		}
	}
	sample := func(t float64) (SphereGeometry, error) {
		if err := ctx.Err(); err != nil {
			return SphereGeometry{}, err
		}
		if out.Evaluations >= MaxWindowEvaluations {
			return SphereGeometry{}, fail("search_budget_exceeded", "ground contact evaluation budget exhausted")
		}
		out.Evaluations++
		v, err := evaluate(t)
		if err != nil {
			return v, err
		}
		if !finite(v.ExternalGapRadians) || !finite(v.InternalGapRadians) {
			return v, fail("invalid_contact_gap", "nonfinite contact geometry")
		}
		return v, ctx.Err()
	}
	add := func(boundary, direction string, lo, hi float64) error {
		if len(out.Contacts) >= MaxGroundContacts {
			return fail("search_budget_exceeded", "ground contact result budget exhausted")
		}
		at := lo + (hi-lo)/2
		out.Contacts = append(out.Contacts, GroundContact{boundary, direction, window.utc(at), at, [2]float64{lo, hi}, [2]string{window.utc(lo), window.utc(hi)}})
		return nil
	}
	gap := func(g SphereGeometry, boundary int) float64 {
		if boundary == 0 {
			return g.ExternalGapRadians
		}
		return g.InternalGapRadians
	}
	names := [2]string{"external", "internal"}
	left, err := sample(0)
	if err != nil {
		return nil, err
	}
	out.StartGeometry = left
	for k, name := range names {
		if gap(left, k) == 0 {
			if err := add(name, "sampled-zero", 0, 0); err != nil {
				return nil, err
			}
		}
	}
	loTime := 0.0
	steps := int(math.Ceil(window.duration / ContactStepSeconds))
	for i := 1; i <= steps; i++ {
		hiTime := math.Min(float64(i)*ContactStepSeconds, window.duration)
		right, err := sample(hiTime)
		if err != nil {
			return nil, err
		}
		for k, name := range names {
			a, b := gap(left, k), gap(right, k)
			leftEdge, rightEdge := edge(loTime, loTime, "sampled-zero"), edge(hiTime, hiTime, "sampled-zero")
			if a < 0 && b <= 0 || a <= 0 && b < 0 {
				overlap(k, name, leftEdge, rightEdge)
			}
			if b == 0 {
				if err := add(name, "sampled-zero", hiTime, hiTime); err != nil {
					return nil, err
				}
				continue
			}
			if a == 0 || (a < 0) == (b < 0) {
				continue
			}
			lo, hi := loTime, hiTime
			for hi-lo > ContactToleranceSeconds {
				mid := lo + (hi-lo)/2
				value, err := sample(mid)
				if err != nil {
					return nil, err
				}
				v := gap(value, k)
				if v == 0 {
					lo, hi = mid, mid
					break
				}
				if (v < 0) == (a < 0) {
					lo = mid
				} else {
					hi = mid
				}
			}
			direction := "enter"
			if a < 0 {
				direction = "exit"
			}
			if err := add(name, direction, lo, hi); err != nil {
				return nil, err
			}
			crossing := edge(lo, hi, "bracketed-contact")
			if a < 0 {
				overlap(k, name, leftEdge, crossing)
			} else {
				overlap(k, name, crossing, rightEdge)
			}
		}
		left, loTime = right, hiTime
	}
	out.EndGeometry = left
	for _, group := range spans {
		for _, span := range group {
			span.DurationSeconds = span.End.ElapsedTAISeconds - span.Start.ElapsedTAISeconds
			span.NumericalDurationBoundsSeconds = [2]float64{math.Max(0, span.End.BracketSeconds[0]-span.Start.BracketSeconds[1]), span.End.BracketSeconds[1] - span.Start.BracketSeconds[0]}
			out.SampledOverlapWindows = append(out.SampledOverlapWindows, span)
		}
	}
	sort.SliceStable(out.SampledOverlapWindows, func(i, j int) bool {
		return out.SampledOverlapWindows[i].Start.ElapsedTAISeconds < out.SampledOverlapWindows[j].Start.ElapsedTAISeconds
	})
	sort.SliceStable(out.Contacts, func(i, j int) bool { return out.Contacts[i].ElapsedTAISeconds < out.Contacts[j].ElapsedTAISeconds })
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
