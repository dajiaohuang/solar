package observation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/hebl/gofa"
)

const VisibilityModel = "earth-station-airless-windows-v1"
const MaxWindowSeconds = 86401 // A UTC calendar day can contain a leap second.
const SearchStepSeconds = 30.0
const BoundaryToleranceSeconds = 0.25
const MaxWindowEvaluations = 8192

// Visibility uses the apparent airless CENTER, not conventional upper-limb
// sunrise/sunset. Refraction, terrain, extinction and target size are excluded.
type VisibilityRequest struct {
	StartUTC          string   `json:"startUtc"`
	EndUTC            string   `json:"endUtc"`
	Station           Station  `json:"station"`
	BodyID            string   `json:"bodyId"`
	MinAltitudeDeg    float64  `json:"minAltitudeDeg"`
	MaxSunAltitudeDeg *float64 `json:"maxSunAltitudeDeg,omitempty"`
}

type WindowInterval struct {
	StartUTC        string  `json:"startUtc"`
	EndUTC          string  `json:"endUtc"`
	StartSeconds    float64 `json:"startSeconds"`
	EndSeconds      float64 `json:"endSeconds"`
	DurationSeconds float64 `json:"durationSeconds"`
	StartBoundary   string  `json:"startBoundary"`
	EndBoundary     string  `json:"endBoundary"`
}
type MissingInterval struct {
	WindowInterval
	Reason string `json:"reason"`
}
type Crossing struct {
	Kind           string  `json:"kind"`
	UTC            string  `json:"utc"`
	Seconds        float64 `json:"seconds"`
	LowerUTC       string  `json:"lowerUtc"`
	UpperUTC       string  `json:"upperUtc"`
	BracketSeconds float64 `json:"bracketSeconds"`
}
type VisibilityResult struct {
	Model           string            `json:"model"`
	Request         VisibilityRequest `json:"request"`
	DurationSeconds float64           `json:"durationSeconds"`
	Coverage        string            `json:"coverage"`
	Windows         []WindowInterval  `json:"windows"`
	Crossings       []Crossing        `json:"crossings"`
	Missing         []MissingInterval `json:"missing"`
	Evaluations     int               `json:"evaluations"`
	Sources         []Source          `json:"sources"`
	Warnings        []string          `json:"warnings"`
	Contract        map[string]any    `json:"contract"`
}

type taiWindow struct{ day, fraction, duration float64 }

func (req VisibilityRequest) timeWindow() (taiWindow, error) {
	point := Request{UTC: req.StartUTC, Station: req.Station, BodyIDs: []string{req.BodyID}}
	if err := point.Validate(); err != nil {
		return taiWindow{}, err
	}
	if !finite(req.MinAltitudeDeg) || req.MinAltitudeDeg < -90 || req.MinAltitudeDeg > 90 || (req.MaxSunAltitudeDeg != nil && (!finite(*req.MaxSunAltitudeDeg) || math.Abs(*req.MaxSunAltitudeDeg) > 90)) {
		return taiWindow{}, fail("invalid_threshold", "altitude thresholds must be finite degrees in [-90,90]")
	}
	u1, u2, _, _ := utcParts(req.StartUTC)
	v1, v2, _, err := utcParts(req.EndUTC)
	if err != nil {
		return taiWindow{}, err
	}
	var a1, a2, b1, b2 float64
	gofa.Utctai(u1, u2, &a1, &a2)
	gofa.Utctai(v1, v2, &b1, &b2)
	duration := ((b1 - a1) + (b2 - a2)) * gofa.DAYSEC
	// Output epochs have microsecond resolution. Remove sub-microsecond
	// arithmetic noise before choosing the final grid interval.
	duration = math.Round(duration*1e6) / 1e6
	if duration < 1-1e-6 || duration > MaxWindowSeconds+1e-6 {
		return taiWindow{}, fail("invalid_window", "endUtc must follow startUtc by 1 to 86401 SI seconds")
	}
	return taiWindow{a1, a2, duration}, nil
}

func (req VisibilityRequest) Validate() error { _, err := req.timeWindow(); return err }

func (w taiWindow) utc(seconds float64) string {
	var u1, u2 float64
	gofa.Taiutc(w.day, w.fraction+seconds/gofa.DAYSEC, &u1, &u2)
	var year, month, day int
	var hms [4]int
	gofa.D2dtf("UTC", 6, u1, u2, &year, &month, &day, &hms)
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02d.%06dZ", year, month, day, hms[0], hms[1], hms[2], hms[3])
}

type altitudeSample struct {
	target, sun float64
	missing     string
}
type altitudeEvaluator func(float64) (altitudeSample, error)

func SearchVisibility(ctx context.Context, req VisibilityRequest, eop *earthorientation.Table, evaluate Evaluator) (*VisibilityResult, error) {
	window, err := req.timeWindow()
	if err != nil {
		return nil, err
	}
	if eop == nil {
		return nil, fail("earth_orientation_unavailable", "no pinned IERS Earth orientation snapshot is configured")
	}
	sess := &session{ctx: ctx, evaluate: evaluate, sources: map[string]*Source{}, identities: map[string]string{}}
	warnings := map[string]bool{}
	point := Request{Station: req.Station, BodyIDs: []string{req.BodyID}}
	if req.MaxSunAltitudeDeg != nil && req.BodyID != "sun" && req.BodyID != "naif:10" {
		point.BodyIDs = append(point.BodyIDs, "naif:10")
	}
	result, err := searchAltitudeWindow(ctx, req, window, func(seconds float64) (altitudeSample, error) {
		point.UTC = window.utc(seconds)
		r, err := evaluateSession(ctx, point, eop, sess)
		if err != nil {
			var typed *Error
			if errors.As(err, &typed) && (typed.Code == "earth_orientation_outside_coverage" || typed.Code == "observer_ephemeris_unavailable") {
				return altitudeSample{missing: typed.Code}, nil
			}
			return altitudeSample{}, err
		}
		for _, warning := range r.Warnings {
			warnings[warning] = true
		}
		for _, body := range r.Bodies {
			for _, warning := range body.Warnings {
				warnings[warning] = true
			}
			if body.Status != "available" {
				return altitudeSample{missing: body.MissingReason}, nil
			}
		}
		return altitudeSample{target: r.Bodies[0].ApparentAirless.AltitudeDeg, sun: r.Bodies[len(r.Bodies)-1].ApparentAirless.AltitudeDeg}, nil
	})
	if err != nil {
		return nil, err
	}
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

// Sampling detects sign changes, not every extremum. Even all available samples
// do not prove continuous coverage or rule out shorter/grazing events. Report
// that boundary explicitly rather than claiming a complete physical search.
func searchAltitudeWindow(ctx context.Context, req VisibilityRequest, window taiWindow, evaluate altitudeEvaluator) (*VisibilityResult, error) {
	out := &VisibilityResult{Model: VisibilityModel, Request: req, DurationSeconds: window.duration, Coverage: "sampled-complete", Windows: []WindowInterval{}, Crossings: []Crossing{}, Missing: []MissingInterval{}, Sources: []Source{}, Warnings: []string{"sub-step-events-and-tangent-contacts-may-be-missed"}, Contract: map[string]any{
		"observationModel": Model, "direction": "apparent-airless-target-center", "timeAxis": "TAI-elapsed-SI-seconds", "angleUnit": "deg", "stationDatum": "WGS84-ellipsoidal-height", "stepSeconds": SearchStepSeconds, "boundaryToleranceSeconds": BoundaryToleranceSeconds, "maxEvaluations": MaxWindowEvaluations, "physicalUncertainty": "not-propagated", "continuousCoverageProven": false, "searchCompleteness": "sign-changes-only-sub-step-and-tangent-events-not-guaranteed", "excludedEffects": []string{"refraction", "terrain-horizon", "finite-target-limb", "atmospheric-extinction"},
	}}
	cache := map[float64]altitudeSample{}
	sample := func(t float64) (altitudeSample, error) {
		if err := ctx.Err(); err != nil {
			return altitudeSample{}, err
		}
		if v, ok := cache[t]; ok {
			return v, nil
		}
		if out.Evaluations >= MaxWindowEvaluations {
			return altitudeSample{}, fail("search_budget_exceeded", "visibility evaluation budget exhausted; shorten the interval")
		}
		out.Evaluations++
		v, err := evaluate(t)
		if err == nil && v.missing == "" && (!finite(v.target) || !finite(v.sun)) {
			return altitudeSample{}, fail("invalid_direction", "non-finite search direction")
		}
		if err == nil {
			cache[t] = v
		}
		return v, err
	}
	interval := func(a, b float64) WindowInterval {
		return WindowInterval{StartUTC: window.utc(a), EndUTC: window.utc(b), StartSeconds: a, EndSeconds: b, DurationSeconds: b - a, StartBoundary: "threshold", EndBoundary: "threshold"}
	}
	margin := func(v altitudeSample, solar bool) float64 {
		if solar {
			return *req.MaxSunAltitudeDeg - v.sun
		}
		return v.target - req.MinAltitudeDeg
	}
	qualifies := func(v altitudeSample) bool {
		return margin(v, false) >= 0 && (req.MaxSunAltitudeDeg == nil || margin(v, true) >= 0)
	}
	appendWindow := func(v WindowInterval) {
		if n := len(out.Windows); n > 0 && out.Windows[n-1].EndSeconds == v.StartSeconds {
			old := &out.Windows[n-1]
			old.EndUTC, old.EndSeconds = v.EndUTC, v.EndSeconds
			old.DurationSeconds = old.EndSeconds - old.StartSeconds
		} else {
			out.Windows = append(out.Windows, v)
		}
	}
	appendMissing := func(a, b float64, reason string) {
		if n := len(out.Missing); n > 0 && out.Missing[n-1].EndSeconds == a && out.Missing[n-1].Reason == reason {
			old := &out.Missing[n-1]
			old.EndUTC, old.EndSeconds = window.utc(b), b
			old.DurationSeconds = b - old.StartSeconds
		} else {
			out.Missing = append(out.Missing, MissingInterval{interval(a, b), reason})
		}
	}
	steps := int(math.Ceil(window.duration / SearchStepSeconds))
	for i := 0; i < steps; i++ {
		a, b := float64(i)*SearchStepSeconds, math.Min(float64(i+1)*SearchStepSeconds, window.duration)
		left, err := sample(a)
		if err != nil {
			return nil, err
		}
		right, err := sample(b)
		if err != nil {
			return nil, err
		}
		missing := left.missing
		if missing == "" {
			missing = right.missing
		}
		if missing != "" {
			appendMissing(a, b, missing)
			continue
		}
		cuts, crossings := []float64{a, b}, []Crossing{}
		for _, solar := range []bool{false, true} {
			if solar && req.MaxSunAltitudeDeg == nil {
				continue
			}
			fa, fb := margin(left, solar), margin(right, solar)
			if (fa >= 0) == (fb >= 0) {
				continue
			}
			lo, hi := a, b
			for hi-lo > BoundaryToleranceSeconds {
				mid := (lo + hi) / 2
				v, err := sample(mid)
				if err != nil {
					return nil, err
				}
				if v.missing != "" {
					missing = v.missing
					break
				}
				if (margin(v, solar) >= 0) == (fa >= 0) {
					lo = mid
				} else {
					hi = mid
				}
			}
			if missing != "" {
				break
			}
			at := (lo + hi) / 2
			kind := "rise"
			if fa >= 0 {
				kind = "set"
			}
			if solar {
				kind = "darkness-begins"
				if fa >= 0 {
					kind = "darkness-ends"
				}
			}
			crossings = append(crossings, Crossing{kind, window.utc(at), at, window.utc(lo), window.utc(hi), hi - lo})
			cuts = append(cuts, at)
		}
		if missing != "" {
			appendMissing(a, b, missing)
			continue
		}
		sort.Float64s(cuts)
		pending := []WindowInterval{}
		for j := 1; j < len(cuts); j++ {
			lo, hi := cuts[j-1], cuts[j]
			if hi-lo < 1e-9 {
				continue
			}
			mid, err := sample((lo + hi) / 2)
			if err != nil {
				return nil, err
			}
			if mid.missing != "" {
				missing = mid.missing
				break
			}
			// Do not fill a whole interval when its midpoint reveals a pair
			// of crossings hidden by equal endpoint signs. Keep it unresolved.
			for _, solar := range []bool{false, true} {
				if solar && req.MaxSunAltitudeDeg == nil {
					continue
				}
				expected := margin(left, solar) >= 0
				nearBoundary := false
				for _, crossing := range crossings {
					isSolar := crossing.Kind == "darkness-begins" || crossing.Kind == "darkness-ends"
					if solar != isSolar {
						continue
					}
					if math.Abs((lo+hi)/2-crossing.Seconds) <= BoundaryToleranceSeconds {
						nearBoundary = true
					}
					if crossing.Seconds < (lo+hi)/2 {
						expected = !expected
					}
				}
				if !nearBoundary && (margin(mid, solar) >= 0) != expected {
					missing = "unresolved-substep-variation"
					break
				}
			}
			if missing != "" {
				break
			}
			if qualifies(mid) {
				pending = append(pending, interval(lo, hi))
			}
		}
		if missing != "" {
			appendMissing(a, b, missing)
			continue
		}
		out.Crossings = append(out.Crossings, crossings...)
		for _, v := range pending {
			appendWindow(v)
		}
	}
	sort.Slice(out.Crossings, func(i, j int) bool { return out.Crossings[i].Seconds < out.Crossings[j].Seconds })
	if len(out.Missing) > 0 {
		out.Coverage = "partial"
	}
	missingDuration := 0.0
	for _, gap := range out.Missing {
		missingDuration += gap.DurationSeconds
	}
	if math.Abs(missingDuration-window.duration) < 1e-6 {
		out.Coverage = "unavailable"
	}
	for i := range out.Windows {
		v := &out.Windows[i]
		if v.StartSeconds == 0 {
			v.StartBoundary = "search-boundary"
		}
		if v.EndSeconds == window.duration {
			v.EndBoundary = "search-boundary"
		}
		for _, gap := range out.Missing {
			if v.StartSeconds == gap.EndSeconds {
				v.StartBoundary = "coverage-gap"
			}
			if v.EndSeconds == gap.StartSeconds {
				v.EndBoundary = "coverage-gap"
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
