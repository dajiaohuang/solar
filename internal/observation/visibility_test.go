package observation

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
)

func TestVisibilityCrossingsIntersectionAndGaps(t *testing.T) {
	limit := 0.0
	req := VisibilityRequest{StartUTC: "2026-09-23T00:00:00Z", EndUTC: "2026-09-23T00:03:00Z", BodyID: "sun", MinAltitudeDeg: 0, MaxSunAltitudeDeg: &limit}
	w, err := req.timeWindow()
	if err != nil {
		t.Fatal(err)
	}
	// Two independent linear thresholds: target rises at 40 s; darkness
	// ends at 140 s. The conjunction must retain only their intersection.
	evaluate := func(s float64) (altitudeSample, error) { return altitudeSample{target: s - 40, sun: s - 140}, nil }
	r, err := searchAltitudeWindow(context.Background(), req, w, evaluate)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Windows) != 1 || len(r.Crossings) != 2 || math.Abs(r.Windows[0].StartSeconds-40) > .125 || math.Abs(r.Windows[0].EndSeconds-140) > .125 || r.Coverage != "sampled-complete" {
		t.Fatalf("%+v", r)
	}
	if r.Crossings[0].Kind != "rise" || r.Crossings[1].Kind != "darkness-ends" {
		t.Fatal(r.Crossings)
	}
	for _, event := range r.Crossings {
		if event.BracketSeconds > BoundaryToleranceSeconds {
			t.Fatal(event)
		}
	}
	// An unavailable midpoint must split the interval; never bridge it.
	r, err = searchAltitudeWindow(context.Background(), req, w, func(s float64) (altitudeSample, error) {
		if s >= 85 && s <= 95 {
			return altitudeSample{missing: "target-emission-spk-unavailable"}, nil
		}
		return evaluate(s)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Windows) != 2 || len(r.Missing) != 1 || r.Coverage != "partial" || r.Windows[0].EndBoundary != "coverage-gap" || r.Windows[1].StartBoundary != "coverage-gap" {
		t.Fatalf("%+v", r)
	}
	if r.Windows[0].EndSeconds > r.Missing[0].StartSeconds || r.Windows[1].StartSeconds < r.Missing[0].EndSeconds {
		t.Fatal("filled missing states")
	}
}

func TestVisibilityConstantThresholdsMissingAndUnresolved(t *testing.T) {
	req := VisibilityRequest{StartUTC: "2026-09-23T00:00:00Z", EndUTC: "2026-09-23T00:01:00Z", BodyID: "sun"}
	w, _ := req.timeWindow()
	for _, alt := range []float64{-90, 0, 90} {
		r, err := searchAltitudeWindow(context.Background(), req, w, func(float64) (altitudeSample, error) { return altitudeSample{target: alt}, nil })
		if err != nil {
			t.Fatal(err)
		}
		want := 0
		if alt >= 0 {
			want = 1
		}
		if len(r.Windows) != want || len(r.Crossings) != 0 {
			t.Fatalf("alt %v: %+v", alt, r)
		}
		if want == 1 && (r.Windows[0].StartBoundary != "search-boundary" || r.Windows[0].EndBoundary != "search-boundary") {
			t.Fatal(r.Windows)
		}
	}
	r, err := searchAltitudeWindow(context.Background(), req, w, func(float64) (altitudeSample, error) { return altitudeSample{missing: "no-eop"}, nil })
	if err != nil || r.Coverage != "unavailable" || len(r.Windows) != 0 || len(r.Missing) != 1 {
		t.Fatalf("%+v %v", r, err)
	}
	// A narrow hump exposed by the midpoint must not turn the entire
	// interval into a false visible window. Mark unresolved sampling.
	r, err = searchAltitudeWindow(context.Background(), req, w, func(s float64) (altitudeSample, error) { return altitudeSample{target: 1 - math.Pow((s-15)/3, 2)}, nil })
	if err != nil || len(r.Windows) != 0 || len(r.Missing) != 1 || r.Missing[0].Reason != "unresolved-substep-variation" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestVisibilityTAILeapWindowAndCancellation(t *testing.T) {
	req := VisibilityRequest{StartUTC: "2016-12-31T23:59:59Z", EndUTC: "2017-01-01T00:00:00Z", BodyID: "sun"}
	w, err := req.timeWindow()
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(w.duration-2) > 1e-9 || w.utc(1) != "2016-12-31T23:59:60.000000Z" {
		t.Fatalf("%+v %s", w, w.utc(1))
	}
	req.StartUTC = "2016-12-31T00:00:00Z"
	w, err = req.timeWindow()
	if err != nil || math.Abs(w.duration-86401) > 1e-8 {
		t.Fatalf("%+v %v", w, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = searchAltitudeWindow(ctx, req, w, func(float64) (altitudeSample, error) {
		t.Fatal("evaluated cancelled search")
		return altitudeSample{}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	for _, end := range []string{req.StartUTC, "2017-01-02T00:00:00Z", "2016-12-31T24:00:00Z"} {
		req.EndUTC = end
		if req.Validate() == nil {
			t.Fatalf("accepted %s", end)
		}
	}
}

func TestVisibilityRealSPKAndSourceFreeze(t *testing.T) {
	cat, eop := sourceFixture(t)
	req := VisibilityRequest{StartUTC: "2026-09-23T00:00:00Z", EndUTC: "2026-09-24T00:00:00Z", Station: Station{103.851959, 1.290270, 0}, BodyID: "naif:10"}
	r, err := SearchVisibility(context.Background(), req, eop, cat.EvalBatchContext)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("24h real SPK: %d evaluations, crossings %+v, windows %+v", r.Evaluations, r.Crossings, r.Windows)
	if len(r.Crossings) != 2 || len(r.Windows) != 2 || r.Coverage != "sampled-complete" || len(r.Sources) < 2 {
		t.Fatalf("%+v", r)
	}
	// Pinning must apply across instants, not just within one light-time loop.
	cutoff := r.Sources[0].StartJDTDB + 60/86400.0
	provider := func(ctx context.Context, ids []string, jd float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		st, ok, ev, err := cat.EvalBatchContext(ctx, ids, jd)
		if jd > cutoff {
			for id, p := range ev {
				p.Source += "-changed"
				ev[id] = p
			}
		}
		return st, ok, ev, err
	}
	_, err = SearchVisibility(context.Background(), req, eop, provider)
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != "ephemeris_source_changed" {
		t.Fatalf("mixed sources: %v", err)
	}
}

func TestVisibilityIndependentERFAWindows(t *testing.T) {
	cat, eop := sourceFixture(t)
	raw, err := os.ReadFile("../../tests/fixtures/visibility-erfa-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		SPKSHA256  string `json:"spkSha256"`
		IERSSHA256 string `json:"iersFixtureSha256"`
		Cases      []struct {
			Name      string            `json:"name"`
			Request   VisibilityRequest `json:"request"`
			Crossings []Crossing        `json:"crossings"`
			Windows   []WindowInterval  `json:"windows"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.IERSSHA256 != eop.Manifest.SHA256 || len(fixture.Cases) != 5 {
		t.Fatal("oracle source identity or cases changed")
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			r, err := SearchVisibility(context.Background(), c.Request, eop, cat.EvalBatchContext)
			if err != nil {
				t.Fatal(err)
			}
			if r.Coverage != "sampled-complete" || len(r.Crossings) != len(c.Crossings) || len(r.Windows) != len(c.Windows) {
				t.Fatalf("unexpected visibility windows %+v", r)
			}
			for i, event := range r.Crossings {
				delta := event.Seconds - c.Crossings[i].Seconds
				t.Logf("%s residual %.6f s", event.Kind, delta)
				if event.Kind != c.Crossings[i].Kind || math.Abs(delta) > event.BracketSeconds/2+.001 {
					t.Fatal("ERFA event lies outside numeric bracket")
				}
			}
			for i, w := range r.Windows {
				if math.Abs(w.StartSeconds-c.Windows[i].StartSeconds) > .126 || math.Abs(w.EndSeconds-c.Windows[i].EndSeconds) > .126 {
					t.Fatal("ERFA window mismatch")
				}
			}
			for _, source := range r.Sources {
				if source.KernelSHA256 != fixture.SPKSHA256 {
					t.Fatal("oracle SPK mismatch")
				}
			}
		})
	}
}

func TestVisibilityBudgetReturnsNoPartialSuccess(t *testing.T) {
	req := VisibilityRequest{StartUTC: "2026-09-23T00:00:00Z", EndUTC: "2026-09-24T00:00:00Z", BodyID: "sun"}
	w, _ := req.timeWindow()
	r, err := searchAltitudeWindow(context.Background(), req, w, func(s float64) (altitudeSample, error) {
		return altitudeSample{target: math.Cos(s * math.Pi / 30)}, nil
	})
	var typed *Error
	if r != nil || !errors.As(err, &typed) || typed.Code != "search_budget_exceeded" {
		t.Fatalf("%+v %v", r, err)
	}
}
