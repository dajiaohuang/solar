package science

import (
	"context"
	"math"
	"testing"
)

func TestCircularOrbitPeriodAndUnits(t *testing.T) {
	e := Elements{SemiMajorAxisAU: 1, Eccentricity: 0, MeanAnomalyDeg: 0, MeanMotionDegPerDay: 0}
	a, err := PropagateBoundElliptic(context.Background(), e, 2451545, 2451545)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(a.Position.X-AUkm) > 1e-6 || math.Abs(a.Position.Y) > 1e-6 {
		t.Fatalf("unexpected J2000 state: %+v", a)
	}
	b, err := PropagateBoundElliptic(context.Background(), e, 2451545, 2451545+365.2568983)
	if err != nil {
		t.Fatal(err)
	}
	if math.Hypot(b.Position.X-a.Position.X, b.Position.Y-a.Position.Y) > 0.1 {
		t.Fatalf("one period did not close: %+v %+v", a, b)
	}
	if math.Abs(a.Velocity.Y-AUkm*math.Sqrt(SolarGM)/86400) > 1e-9 {
		t.Fatalf("velocity unit conversion mismatch: %v", a.Velocity.Y)
	}
}

func TestRejectsUnboundAndCancellation(t *testing.T) {
	e := Elements{SemiMajorAxisAU: 1, Eccentricity: 1}
	if _, err := PropagateBoundElliptic(context.Background(), e, 1, 2); err == nil {
		t.Fatal("expected unbound orbit rejection")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PropagateBoundElliptic(ctx, Elements{SemiMajorAxisAU: 1}, 1, 2); err == nil {
		t.Fatal("expected cancellation")
	}
}

func BenchmarkPropagateBoundElliptic(b *testing.B) {
	e := Elements{SemiMajorAxisAU: 1.5237, Eccentricity: .0934, InclinationDeg: 1.85, AscendingNodeDeg: 49.56, ArgPeriapsisDeg: 73.62, MeanAnomalyDeg: 19.37, MeanMotionDegPerDay: .524}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = PropagateBoundElliptic(ctx, e, 2451545, 2451545+float64(i%365))
	}
}
