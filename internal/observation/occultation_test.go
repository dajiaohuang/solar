package observation

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
)

func TestSphereGeometryIndependentCSPICE(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/spherical-occultation-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Foreground, Background struct {
				PositionKM [3]float64
				RadiusKM   float64
			}
			SeparationRadians float64
			OccultCode        int
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 21 {
		t.Fatal("missing reference cases")
	}
	for _, row := range fixture.Cases {
		g, err := sphereGeometry(row.Foreground.PositionKM, row.Foreground.RadiusKM, row.Background.PositionKM, row.Background.RadiusKM)
		if err != nil {
			t.Fatal(err)
		}
		want := map[int]string{0: "none", 1: "partial", 2: "annular", 3: "total"}[row.OccultCode]
		if g.Classification != want || math.Abs(g.SeparationRadians-row.SeparationRadians) > 2e-13 {
			t.Fatalf("CSPICE mismatch: %+v code %d", g, row.OccultCode)
		}
	}
	for _, p := range [][3]float64{{0, 0, 0}, {math.Inf(1), 0, 0}, {1000, 0, 0}} {
		if _, err := sphereGeometry(p, 1, [3]float64{100, 0, 0}, 1); err == nil {
			t.Fatal("accepted invalid observer/depth")
		}
	}
}

func TestGroundOccultationUsesPinnedStationVectorsAndShapes(t *testing.T) {
	cat, eop := sourceFixture(t)
	raw, err := os.ReadFile("../../src/data/pck00011.tpc")
	if err != nil {
		t.Fatal(err)
	}
	shapes, err := bodyshape.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	req := OccultationRequest{UTC: "2026-09-23T04:00:00Z", Station: Station{103.851959, 1.290270, 0}, ForegroundID: 301, BackgroundID: 10, Aberration: "CN"}
	result, err := EvaluateOccultation(context.Background(), req, shapes, eop, cat.EvalBatchContext)
	if err != nil {
		t.Fatal(err)
	}
	if result.Model != "earth-station-cn-spherical-limbs-v1" || result.RadiusSourceSHA256 != bodyshape.SHA256 || result.Geometry.Classification != "none" || result.PhysicalTimingUncertaintySeconds != nil {
		t.Fatal("incorrect contract")
	}
	if len(result.Observation.Sources) != 3 || result.Observation.Bodies[0].ReceptionPositionKM == nil {
		t.Fatal("lost station/SPK evidence")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := EvaluateOccultation(ctx, req, shapes, eop, cat.EvalBatchContext); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := EvaluateOccultation(context.Background(), req, shapes, nil, cat.EvalBatchContext); err == nil {
		t.Fatal("accepted missing IERS")
	}
	req.ForegroundID = 199
	if _, err := EvaluateOccultation(context.Background(), req, shapes, eop, cat.EvalBatchContext); err == nil {
		t.Fatal("invented spherical Mercury")
	}
	req.ForegroundID = 301
	req.Aberration = "NONE"
	if _, err := EvaluateOccultation(context.Background(), req, shapes, eop, cat.EvalBatchContext); err == nil {
		t.Fatal("undeclared correction model")
	}
}
