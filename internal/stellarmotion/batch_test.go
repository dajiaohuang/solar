package stellarmotion

import (
	"context"
	"testing"
)

func TestBatchGaiaZeroRadialMotionPolicyIsExplicitAndPerRow(t *testing.T) {
	ra, dec, parallax, pmra, pmdec := 120.0, 20.0, 25.0, 3.0, -4.0
	source := Source{
		ID: "65212004581252736", Epoch: 2016, RA: &ra, Dec: &dec,
		Parallax: &parallax, PMRA: &pmra, PMDec: &pmdec, Solution: 31,
	}

	strict, err := PropagateBatchContext(context.Background(), []Source{source}, 2026, "spectroscopic-as-astrometric")
	if err != nil {
		t.Fatal(err)
	}
	if strict.MissingRows != 1 || strict.Rows[0].Reason != "radial-velocity-unavailable" {
		t.Fatalf("strict policy substituted a missing radial velocity: %+v", strict.Rows[0])
	}

	assumed, err := PropagateBatchContext(context.Background(), []Source{source}, 2026, GaiaZeroRadialMotionWhenRVUnavailable)
	if err != nil {
		t.Fatal(err)
	}
	if assumed.PropagatedRows != 1 || assumed.ZeroRadialMotionRows != 1 ||
		!assumed.Rows[0].ZeroRadialMotionAssumed || assumed.Rows[0].State == nil {
		t.Fatalf("missing-RV assumption was not marked in the result: %+v", assumed)
	}
	// Starpm returns target-epoch radial velocity, not the source value. Compare
	// with an explicitly supplied zero at J2016, without constraining the result
	// to stay zero after perspective evolution.
	zero := 0.0
	explicit := source
	explicit.RadialVelocity = &zero
	want, err := Propagate(explicit, 2026, "spectroscopic-as-astrometric")
	if err != nil || *assumed.Rows[0].State != want.State || source.RadialVelocity != nil {
		t.Fatalf("assumed source differs from explicit source-epoch zero: %v", err)
	}

	rv := -22.5
	source.RadialVelocity = &rv
	measured, err := PropagateBatchContext(context.Background(), []Source{source}, 2026, GaiaZeroRadialMotionWhenRVUnavailable)
	if err != nil {
		t.Fatal(err)
	}
	want, err = Propagate(source, 2026, "spectroscopic-as-astrometric")
	if err != nil || measured.ZeroRadialMotionRows != 0 || measured.Rows[0].ZeroRadialMotionAssumed ||
		measured.Rows[0].State == nil || *measured.Rows[0].State != want.State {
		t.Fatalf("catalog radial velocity was replaced by the zero-motion assumption: %+v", measured.Rows[0])
	}
}
