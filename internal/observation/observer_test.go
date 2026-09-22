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
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/hebl/gofa"
)

func sourceFixture(t *testing.T) (*catalog.Catalog, *earthorientation.Table) {
	t.Helper()
	dir := t.TempDir()
	raw, err := os.ReadFile("../../src/data/ephemeris-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ID    string            `json:"id"`
		Files []json.RawMessage `json:"files"`
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	var file struct {
		Path string `json:"path"`
	}
	if err = json.Unmarshal(manifest.Files[0], &file); err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(map[string]any{"id": manifest.ID, "files": manifest.Files[:1]})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join("../../public/data/ephemerides", file.Path))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, file.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	cat, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cat.Close() })
	raw, err = os.ReadFile("../../tests/fixtures/observer-iers-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	provenance, err := os.ReadFile("../../tests/fixtures/observer-iers-provenance.json")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		FixtureSHA256 string `json:"fixtureSha256"`
		RetrievedAt   string `json:"retrievedAt"`
	}
	if err = json.Unmarshal(provenance, &meta); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	if digest != meta.FixtureSHA256 {
		t.Fatal("IERS fixture digest mismatch")
	}
	m := earthorientation.Manifest{SchemaVersion: 1, SourceURL: earthorientation.SourceURL, RetrievedAt: meta.RetrievedAt, SHA256: digest, Bytes: len(raw), Path: "finals2000A-" + digest + ".all"}
	if err = os.WriteFile(filepath.Join(dir, m.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "iers.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	table, err := earthorientation.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return cat, table
}

func TestIndependentHorizonsAirlessDirections(t *testing.T) {
	cat, eop := sourceFixture(t)
	for _, name := range []string{"moon-singapore", "venus-greenwich", "sun-singapore"} {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile("../../tests/fixtures/observer-" + name + ".json")
			if err != nil {
				t.Fatal(err)
			}
			var fixture struct {
				Params         map[string]string `json:"params"`
				RawResponse    string            `json:"rawResponse"`
				ResponseSHA256 string            `json:"responseSha256"`
			}
			if err = json.Unmarshal(raw, &fixture); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256([]byte(fixture.RawResponse))
			if hex.EncodeToString(hash[:]) != fixture.ResponseSHA256 {
				t.Fatal("Horizons response checksum mismatch")
			}
			var response struct {
				Result string `json:"result"`
			}
			if err = json.Unmarshal([]byte(fixture.RawResponse), &response); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(response.Result, "Atmos refraction: NO (AIRLESS)") {
				t.Fatal("reference is not airless")
			}
			site := strings.Split(strings.Trim(fixture.Params["SITE_COORD"], "'"), ",")
			number := func(value string) float64 {
				v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil {
					t.Fatal(err)
				}
				return v
			}
			station := Station{number(site[0]), number(site[1]), number(site[2]) * 1000}
			rows := strings.Split(strings.TrimSpace(strings.Split(strings.Split(response.Result, "$$SOE")[1], "$$EOE")[0]), "\n")
			for _, row := range rows {
				cols := strings.Split(row, ",")
				instant, err := time.Parse("2006-Jan-02 15:04:05.000", strings.TrimSpace(cols[0]))
				if err != nil {
					t.Fatal(err)
				}
				req := Request{UTC: instant.Format(time.RFC3339), Station: station, BodyIDs: []string{"naif:" + strings.Trim(fixture.Params["COMMAND"], "'")}}
				result, err := Evaluate(context.Background(), req, eop, cat.EvalBatchContext)
				if err != nil {
					t.Fatal(err)
				}
				body := result.Bodies[0]
				if body.Status != "available" {
					t.Fatalf("%+v", body)
				}
				wantAZ, wantAlt, wantRange := number(cols[4]), number(cols[5]), number(cols[6])*auKM
				daz := math.Remainder(body.ApparentAirless.AzimuthDeg-wantAZ, 360)
				dalt := body.ApparentAirless.AltitudeDeg - wantAlt
				// Horizons uses a different EOP/precession-nutation/horizon chain.
				// Preserve the measured residual; do not calibrate our rotation
				// to it. The separate ERFA+ENU oracle checks our exact convention.
				t.Logf("%s dAz=%.6f arcsec dAlt=%.6f arcsec dRange=%.6f km", req.UTC, daz*3600, dalt*3600, *body.RangeKM-wantRange)
				separation := math.Hypot(daz*math.Cos(wantAlt*gofa.DD2R), dalt) * 3600
				if separation > 1 || math.Abs(*body.RangeKM-wantRange) > .1 {
					t.Fatal("independent observer reference mismatch")
				}
				if len(result.Sources) < 2 || !result.EOP.Predicted || result.Contract["physicalUncertainty"] != "not-propagated" {
					t.Fatal("missing source/model quality evidence")
				}
			}
		})
	}
}

func TestIndependentERFATerrestrialENUReference(t *testing.T) {
	cat, eop := sourceFixture(t)
	raw, err := os.ReadFile("../../tests/fixtures/observer-erfa-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		SPKSHA256  string `json:"spkSha256"`
		IERSSHA256 string `json:"iersFixtureSha256"`
		Cases      []struct {
			UTC      string  `json:"utc"`
			BodyID   string  `json:"bodyId"`
			Station  Station `json:"station"`
			Azimuth  float64 `json:"azimuthDeg"`
			Altitude float64 `json:"altitudeDeg"`
			Range    float64 `json:"lightTimeRangeKm"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.IERSSHA256 != eop.Manifest.SHA256 || len(fixture.Cases) != 6 {
		t.Fatal("oracle source identity or coverage changed")
	}
	for _, test := range fixture.Cases {
		result, err := Evaluate(context.Background(), Request{UTC: test.UTC, Station: test.Station, BodyIDs: []string{test.BodyID}}, eop, cat.EvalBatchContext)
		if err != nil {
			t.Fatal(err)
		}
		body := result.Bodies[0]
		if body.ApparentAirless == nil {
			t.Fatal(body)
		}
		daz := math.Remainder(body.ApparentAirless.AzimuthDeg-test.Azimuth, 360)
		dalt := body.ApparentAirless.AltitudeDeg - test.Altitude
		t.Logf("%s %s ERFA dAz=%.9f arcsec dAlt=%.9f arcsec", test.BodyID, test.UTC, daz*3600, dalt*3600)
		if math.Abs(daz) > 1e-7 || math.Abs(dalt) > 1e-7 || math.Abs(*body.RangeKM-test.Range) > .001 {
			t.Fatal("ERFA direct terrestrial ENU mismatch")
		}
		for _, source := range result.Sources {
			if source.KernelSHA256 != fixture.SPKSHA256 {
				t.Fatal("oracle SPK source mismatch")
			}
		}
	}
}

func TestUTCLeapSecondAndInvalidCalendar(t *testing.T) {
	var tai [3]float64
	for i, utc := range []string{"2016-12-31T23:59:59Z", "2016-12-31T23:59:60Z", "2017-01-01T00:00:00Z"} {
		u1, u2, _, err := utcParts(utc)
		if err != nil {
			t.Fatal(err)
		}
		var t1, t2 float64
		gofa.Utctai(u1, u2, &t1, &t2)
		tai[i] = (t1 - 2457754.5) + t2
	}
	for i := 1; i < len(tai); i++ {
		if math.Abs((tai[i]-tai[i-1])*86400-1) > 1e-9 {
			t.Fatalf("UTC leap second collapsed: %v", tai)
		}
	}
	for _, utc := range []string{"2026-09-23T12:00:60Z", "2026-02-30T00:00:00Z", "2026-09-23T24:00:00Z", "2026-09-23T12:00:00+08:00", "2026-09-23"} {
		if _, _, _, err := utcParts(utc); err == nil {
			t.Fatalf("accepted %s", utc)
		}
	}
}

func TestObservationMissingCancellationAndRefraction(t *testing.T) {
	cat, eop := sourceFixture(t)
	req := Request{UTC: "2026-09-23T04:00:00Z", Station: Station{103.851959, 1.290270, 0}, BodyIDs: []string{"sun", "naif:301", "earth", "unknown"}, Atmosphere: &Atmosphere{1010, 28, .8, .55}}
	result, err := Evaluate(context.Background(), req, eop, cat.EvalBatchContext)
	if err != nil {
		t.Fatal(err)
	}
	sun := result.Bodies[0]
	if sun.Refracted == nil || sun.Refracted.AltitudeDeg <= sun.ApparentAirless.AltitudeDeg {
		t.Fatal("refraction did not raise above-horizon Sun")
	}
	req.UTC = "2026-09-23T00:00:00Z"
	below, err := Evaluate(context.Background(), req, eop, cat.EvalBatchContext)
	if err != nil {
		t.Fatal(err)
	}
	moon := below.Bodies[1]
	if moon.ApparentAirless.AltitudeDeg >= 0 || moon.Refracted != nil || len(moon.Warnings) == 0 {
		t.Fatal("reported unsupported below-horizon refraction")
	}
	for _, body := range result.Bodies[2:] {
		if body.Status != "missing" || body.ApparentAirless != nil || body.MissingReason == "" {
			t.Fatal("fabricated missing state")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Evaluate(ctx, req, eop, cat.EvalBatchContext); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	for _, test := range []struct {
		table *earthorientation.Table
		utc   string
		code  string
	}{{nil, req.UTC, "earth_orientation_unavailable"}, {eop, "2027-01-01T00:00:00Z", "earth_orientation_outside_coverage"}} {
		req.UTC = test.utc
		_, err := Evaluate(context.Background(), req, test.table, cat.EvalBatchContext)
		var typed *Error
		if !errors.As(err, &typed) || typed.Code != test.code {
			t.Fatalf("%v", err)
		}
	}
	if _, err := Evaluate(context.Background(), Request{UTC: "2026-09-23T00:00:00Z", BodyIDs: []string{"sun"}, Station: Station{LatitudeDeg: 91}}, eop, cat.EvalBatchContext); err == nil {
		t.Fatal("accepted invalid station")
	}
}

func TestEmissionCoverageAndProvenanceAreRequired(t *testing.T) {
	cat, eop := sourceFixture(t)
	req := Request{UTC: "2026-09-23T04:00:00Z", BodyIDs: []string{"sun"}}
	count := 0
	provider := func(ctx context.Context, ids []string, jd float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		count++
		st, found, ev, err := cat.EvalBatchContext(ctx, ids, jd)
		if count > 1 {
			found["sun"] = false
		}
		return st, found, ev, err
	}
	result, err := Evaluate(context.Background(), req, eop, provider)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bodies[0].MissingReason != "target-emission-spk-unavailable" || result.Bodies[0].Geometric != nil {
		t.Fatal("partial result masquerades as full observation")
	}
	provider = func(ctx context.Context, ids []string, jd float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		st, found, _, err := cat.EvalBatchContext(ctx, ids, jd)
		return st, found, nil, err
	}
	if _, err = Evaluate(context.Background(), req, eop, provider); err == nil {
		t.Fatal("accepted state without evidence")
	}
	count = 0
	provider = func(ctx context.Context, ids []string, jd float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
		count++
		st, found, evidence, err := cat.EvalBatchContext(ctx, ids, jd)
		if count > 1 {
			changed := evidence["sun"]
			changed.KernelSHA256 = strings.Repeat("b", 64)
			evidence["sun"] = changed
		}
		return st, found, evidence, err
	}
	_, err = Evaluate(context.Background(), req, eop, provider)
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != "ephemeris_source_changed" {
		t.Fatalf("mixed light-time solutions: %v", err)
	}
}
