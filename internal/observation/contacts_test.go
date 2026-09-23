package observation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
)

func TestGroundContactsIndependentDallasReference(t *testing.T) {
	cat, _ := sourceFixture(t)
	raw, err := os.ReadFile("../../tests/fixtures/ground-contacts-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Request  ContactRequest
		Contacts []GroundContact
		Sources  []struct{ Path, SHA256 string }
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, source := range fixture.Sources {
		data, err := os.ReadFile("../../" + source.Path)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != source.SHA256 {
			t.Fatalf("changed source %s", source.Path)
		}
	}
	meta, err := os.ReadFile("../../tests/fixtures/eclipse-iers-provenance.json")
	if err != nil {
		t.Fatal(err)
	}
	var provenance struct {
		Source        earthorientation.Manifest
		FixtureSHA256 string
		FixtureBytes  int
	}
	if err := json.Unmarshal(meta, &provenance); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile("../../tests/fixtures/eclipse-iers-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	m := provenance.Source
	m.SHA256 = provenance.FixtureSHA256
	m.Bytes = provenance.FixtureBytes
	m.Path = "finals2000A-" + m.SHA256 + ".all"
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, m.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(dir, "iers.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	eop, err := earthorientation.Load(filepath.Join(dir, "iers.json"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile("../../src/data/pck00011.tpc")
	if err != nil {
		t.Fatal(err)
	}
	shapes, err := bodyshape.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	r, err := SearchGroundContacts(context.Background(), fixture.Request, shapes, eop, cat.EvalBatchContext)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Contacts) != 4 || len(fixture.Contacts) != 4 || len(r.Sources) != 3 || !r.PossibleMissedEvents {
		t.Fatalf("incomplete result %+v", r)
	}
	for i, want := range fixture.Contacts {
		got := r.Contacts[i]
		if got.Boundary != want.Boundary || got.Direction != want.Direction || math.Abs(got.ElapsedTAISeconds-want.ElapsedTAISeconds) > .03 || got.BracketSeconds[1]-got.BracketSeconds[0] > ContactToleranceSeconds {
			t.Fatalf("contact mismatch: %+v vs %+v", got, want)
		}
		t.Logf("%s %s %s residual %.6f s", got.Boundary, got.Direction, got.UTC, got.ElapsedTAISeconds-want.ElapsedTAISeconds)
	}
	if len(r.SampledOverlapWindows) != 2 || r.Evaluations != 521 {
		t.Fatalf("lost windows or added evaluations: %+v", r)
	}
	for i, pair := range [][2]int{{0, 3}, {1, 2}} {
		span := r.SampledOverlapWindows[i]
		want := fixture.Contacts[pair[1]].ElapsedTAISeconds - fixture.Contacts[pair[0]].ElapsedTAISeconds
		if math.Abs(span.DurationSeconds-want) > .03 || span.Start.Kind != "bracketed-contact" || span.End.Kind != "bracketed-contact" || span.NumericalDurationBoundsSeconds[0] > want || span.NumericalDurationBoundsSeconds[1] < want {
			t.Fatalf("reference duration outside numerical window: %+v want %.9f", span, want)
		}
	}
	if r.EarthOrientation.SHA256 != m.SHA256 || r.RadiusSourceSHA256 != bodyshape.SHA256 {
		t.Fatal("lost source evidence")
	}
	first := 0.0
	changed := func(ctx context.Context, ids []string, jd float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		st, found, evidence, err := cat.EvalBatchContext(ctx, ids, jd)
		if first == 0 {
			first = jd
		}
		if jd > first+10.0/86400 {
			for id, value := range evidence {
				value.KernelSHA256 = strings.Repeat("b", 64)
				evidence[id] = value
			}
		}
		return st, found, evidence, err
	}
	_, err = SearchGroundContacts(context.Background(), fixture.Request, shapes, eop, changed)
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != "ephemeris_source_changed" {
		t.Fatalf("accepted changing source: %v", err)
	}
}

func TestGroundContactBracketsMissedEventsAndCancellation(t *testing.T) {
	w := taiWindow{day: 2457753.5, fraction: 36.0 / 86400, duration: 120}
	evaluate := func(t float64) (SphereGeometry, error) {
		return SphereGeometry{ExternalGapRadians: (t - 41) * (t - 83), InternalGapRadians: 1}, nil
	}
	r, err := searchGroundContacts(context.Background(), w, evaluate)
	if err != nil || len(r.Contacts) != 2 {
		t.Fatalf("%+v %v", r, err)
	}
	for i, want := range []float64{41, 83} {
		b := r.Contacts[i].BracketSeconds
		if b[0] > want || b[1] < want || b[1]-b[0] > ContactToleranceSeconds {
			t.Fatal(b)
		}
	}
	missed, err := searchGroundContacts(context.Background(), w, func(t float64) (SphereGeometry, error) {
		return SphereGeometry{ExternalGapRadians: (t-15)*(t-15) - 1, InternalGapRadians: 1}, nil
	})
	if err != nil || len(missed.Contacts) != 0 || !missed.PossibleMissedEvents {
		t.Fatal("false completeness")
	}
	ctx, cancel := context.WithCancel(context.Background())
	_, err = searchGroundContacts(ctx, w, func(t float64) (SphereGeometry, error) { cancel(); return evaluate(t) })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := searchGroundContacts(context.Background(), w, func(float64) (SphereGeometry, error) { return SphereGeometry{ExternalGapRadians: math.NaN()}, nil }); err == nil {
		t.Fatal("accepted nonfinite source")
	}
	w.duration = 86401
	_, err = searchGroundContacts(context.Background(), w, func(float64) (SphereGeometry, error) { return SphereGeometry{}, nil })
	if err == nil || !strings.Contains(err.Error(), "budget") {
		t.Fatal("unbounded sampled-zero result")
	}
}

func TestGroundContactLeapSecond(t *testing.T) {
	w, err := (VisibilityRequest{StartUTC: "2016-12-31T00:00:00Z", EndUTC: "2017-01-01T00:00:00Z", BodyID: "sun"}).timeWindow()
	if err != nil || w.duration != 86401 {
		t.Fatal(err, w)
	}
	r, err := searchGroundContacts(context.Background(), w, func(t float64) (SphereGeometry, error) {
		return SphereGeometry{ExternalGapRadians: t - 86400, InternalGapRadians: 1}, nil
	})
	if err != nil || len(r.Contacts) != 1 || r.Contacts[0].UTC != "2016-12-31T23:59:60.000000Z" || r.Contacts[0].Direction != "sampled-zero" {
		t.Fatalf("%+v %v", r, err)
	}
	if len(r.SampledOverlapWindows) != 1 || r.SampledOverlapWindows[0].DurationSeconds != 86400 || r.SampledOverlapWindows[0].End.UTC != "2016-12-31T23:59:60.000000Z" {
		t.Fatal("lost TAI duration or leap-second window edge", r.SampledOverlapWindows)
	}
}

func TestGroundOverlapSampledSignsClippingAndZeros(t *testing.T) {
	w := taiWindow{day: 2457753.5, fraction: 36.0 / 86400, duration: 120}
	for _, tc := range []struct {
		name      string
		gap       func(float64) float64
		durations []float64
		edges     [][2]string
	}{
		{"clipped", func(float64) float64 { return -1 }, []float64{120}, [][2]string{{"search-boundary", "search-boundary"}}},
		{"zero-only", func(float64) float64 { return 0 }, nil, nil},
		{"touch-outside", func(t float64) float64 { return (t - 60) * (t - 60) }, nil, nil},
		{"touch-inside", func(t float64) float64 { return -(t - 60) * (t - 60) }, []float64{120}, [][2]string{{"search-boundary", "search-boundary"}}},
		{"sampled-entry", func(t float64) float64 { return 60 - t }, []float64{60}, [][2]string{{"sampled-zero", "search-boundary"}}},
		{"separate", func(t float64) float64 { return -(t - 21) * (t - 99) }, []float64{21, 21}, [][2]string{{"search-boundary", "bracketed-contact"}, {"bracketed-contact", "search-boundary"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := searchGroundContacts(context.Background(), w, func(at float64) (SphereGeometry, error) {
				return SphereGeometry{ExternalGapRadians: tc.gap(at), InternalGapRadians: 1}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(r.SampledOverlapWindows) != len(tc.durations) {
				t.Fatal(r.SampledOverlapWindows)
			}
			for i, want := range tc.durations {
				span := r.SampledOverlapWindows[i]
				if math.Abs(span.DurationSeconds-want) > ContactToleranceSeconds || span.NumericalDurationBoundsSeconds[0] > want || span.NumericalDurationBoundsSeconds[1] < want || span.Start.Kind != tc.edges[i][0] || span.End.Kind != tc.edges[i][1] {
					t.Fatal(span)
				}
			}
		})
	}
}
