package observation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestIndependentGroundStationAndReceptionVectors(t *testing.T) {
	cat, eop := sourceFixture(t)
	raw, err := os.ReadFile("../../tests/fixtures/ground-vectors-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Sources []struct{ Path, SHA256 string }
		Cases   []struct {
			UTC, BodyID                                                               string
			Station                                                                   Station
			PositionKM, VelocityKMPerSecond, GeometricPositionKM, ReceptionPositionKM [3]float64
			EpochJDTDBParts                                                           [2]float64
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 6 || len(fixture.Sources) != 5 {
		t.Fatal("reference coverage changed")
	}
	for _, source := range fixture.Sources {
		bytes, err := os.ReadFile("../../" + source.Path)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(bytes)
		if hex.EncodeToString(digest[:]) != source.SHA256 {
			t.Fatalf("source changed: %s", source.Path)
		}
	}
	for _, row := range fixture.Cases {
		r, err := Evaluate(context.Background(), Request{UTC: row.UTC, Station: row.Station, BodyIDs: []string{row.BodyID}}, eop, cat.EvalBatchContext)
		if err != nil {
			t.Fatal(err)
		}
		if r.ObserverState.Frame != "J2000" || r.ObserverState.Origin != "solar-system-barycenter" || r.Contract["vectorOrigin"] != "observer-at-reception" {
			t.Fatal("missing vector convention")
		}
		b := r.Bodies[0]
		if b.Status != "available" || b.GeometricPositionKM == nil || b.ReceptionPositionKM == nil || b.LightTimeResidualSeconds == nil {
			t.Fatal("missing vectors")
		}
		for i := 0; i < 3; i++ {
			if math.Abs(r.ObserverState.PositionKM[i]-row.PositionKM[i]) > 1e-6 || math.Abs(r.ObserverState.VelocityKMPerSecond[i]-row.VelocityKMPerSecond[i]) > 1e-10 {
				t.Fatalf("station reference mismatch %s", row.UTC)
			}
			if math.Abs(b.GeometricPositionKM[i]-row.GeometricPositionKM[i]) > 1e-6 || math.Abs(b.ReceptionPositionKM[i]-row.ReceptionPositionKM[i]) > .001 {
				t.Fatalf("target reference mismatch %s %s", row.BodyID, row.UTC)
			}
		}
		for i := 0; i < 2; i++ {
			if math.Abs(r.ObserverState.EpochTDB[i]-row.EpochJDTDBParts[i]) > 1e-12 {
				t.Fatal("split epoch mismatch")
			}
		}
		p := b.ReceptionPositionKM
		if math.Abs(math.Sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])-*b.RangeKM) > 1e-6 {
			t.Fatal("vector norm and range disagree")
		}
		if *b.LightTimeResidualSeconds > lightTimeToleranceSeconds || *b.EmissionJDTDB != r.JDTDB-*b.LightTimeSeconds/86400 {
			t.Fatal("reported light time does not belong to the evaluated emission epoch")
		}
	}
}
