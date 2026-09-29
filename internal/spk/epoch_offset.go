package spk

import (
	"context"
	"fmt"
)

// EvaluateChebyshevAtOffsetContext retains a low-order elapsed-time offset
// through segment selection and record-local Chebyshev evaluation. Only
// geometric J2000 type 2/3 segments are admitted. A later matching unsupported
// segment is an error, never permission to fall back to an earlier segment.
func (k *Kernel) EvaluateChebyshevAtOffsetContext(ctx context.Context, target int, et, offsetSeconds float64) (State, bool, error) {
	if err := ctx.Err(); err != nil {
		return State{}, false, err
	}
	if !finite(et) || !finite(offsetSeconds) {
		return State{}, false, fmt.Errorf("invalid SPK split epoch")
	}
	// Error-free TwoSum; the low term survives when the sum rounds to et.
	high := et + offsetSeconds
	carried := high - et
	low := (et - (high - carried)) + (offsetSeconds - carried)
	if !finite(high) || !finite(low) {
		return State{}, false, fmt.Errorf("SPK split epoch overflow")
	}
	evaluation := *k
	evaluation.ctx = ctx
	for index := len(k.Segments) - 1; index >= 0; index-- {
		if err := ctx.Err(); err != nil {
			return State{}, false, err
		}
		segment := k.Segments[index]
		if segment.Target != target || (high-segment.StartET)+low < 0 || (high-segment.EndET)+low > 0 {
			continue
		}
		if segment.Frame != 1 || (segment.Type != 2 && segment.Type != 3) {
			return State{}, false, fmt.Errorf("split-epoch evaluation requires J2000 type 2/3, got frame=%d type=%d", segment.Frame, segment.Type)
		}
		values, err := evaluation.evalChebAtOffset(segment, high, low)
		if err != nil {
			return State{}, false, err
		}
		if err := ctx.Err(); err != nil {
			return State{}, false, err
		}
		return State{Position: Vec3{values[0], values[1], values[2]}, Velocity: Vec3{values[3], values[4], values[5]}, Center: segment.Center, Frame: segment.Frame}, true, nil
	}
	return State{}, false, ctx.Err()
}
