package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

// SourceOffsetDraw preserves the identity of a failed draw. Nil state and
// additionalValues serialize as null, never as a fabricated zero or NaN.
type SourceOffsetDraw struct {
	Index            int       `json:"index"`
	Valid            bool      `json:"valid"`
	State            []float64 `json:"state"`
	AdditionalValues []float64 `json:"additionalValues"`
	Failure          string    `json:"failure,omitempty"`
}

type SourceOffsetCoordinates struct {
	Method      string             `json:"method"`
	Conversion  *Conversion        `json:"conversion"`
	Offsets     []float64          `json:"offsets"`
	Dimension   int                `json:"dimension"`
	Draws       []SourceOffsetDraw `json:"draws"`
	Limitations []string           `json:"limitations"`
}

// ConvertSourceOffsets evaluates caller-supplied joint parameter offsets, not
// Cartesian Jacobian perturbations. It does not sample a probability law or
// integrate forces. All offsets are in the audited source axis order/units.
func ConvertSourceOffsets(ctx context.Context, original []byte, gm AdoptedSolarGM, offsets []float64) (*SourceOffsetCoordinates, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Bound allocation before source parsing; exact dimension follows its audit.
	if len(offsets) < 6 || len(offsets) > 128*16 {
		return nil, errors.New("source offsets require 1 to 128 complete joint draws")
	}
	owned := append([]float64(nil), offsets...)
	for _, value := range owned {
		if !finite(value) {
			return nil, errors.New("source offsets must be finite")
		}
	}
	conversion, err := Convert(ctx, original, gm)
	if err != nil {
		return nil, err
	}
	source := &conversion.Inspection.Source
	n := len(source.Labels)
	if len(owned)%n != 0 || len(owned)/n > 128 {
		return nil, errors.New("source offsets require 1 to 128 complete joint draws")
	}
	var axes [6]int
	for axis, label := range []string{"e", "q", "tp", "node", "peri", "i"} {
		axes[axis] = -1
		for j := 0; j < 6; j++ {
			if source.Labels[j] == label {
				axes[axis] = j
				break
			}
		}
		if axes[axis] < 0 {
			return nil, errors.New("missing audited source offset axis")
		}
	}
	result := &SourceOffsetCoordinates{Method: "nonlinear-source-offsets-to-periapsis-conic-state-v1",
		Conversion: conversion, Offsets: owned, Dimension: n, Draws: make([]SourceOffsetDraw, len(owned)/n),
		Limitations: []string{
			"Caller-supplied joint offsets in recorded source units; no probability law, sampling or statistical calibration is implied.",
			"Nonlinear coordinate conversion at the source solution epoch only; no force integration or event probability.",
			"Conditional on the adopted solar GM. Additional parameters are retained without applying their forces.",
			"Failed draws retain their index and original offsets with null state/additional values; no clipping, replacement or resampling.",
			"Uses the bounded conic solvers of the nominal coordinate conversion, including their derivative-finiteness domain; not independent numerical validation.",
		}}
	for index := range result.Draws {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		draw := SourceOffsetDraw{Index: index}
		state, extras, err := sourceOffsetState(ctx, source, axes, gm.AU3PerDay2, owned[index*n:(index+1)*n])
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			draw.Failure = err.Error()
		} else {
			draw.Valid, draw.State, draw.AdditionalValues = true, state, extras
		}
		result.Draws[index] = draw
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func sourceOffsetState(ctx context.Context, source *Source, axes [6]int, mu float64, offsets []float64) ([]float64, []float64, error) {
	var values [6]float64
	for axis, index := range axes {
		if axis == 2 {
			// Preserve small tp offsets without adding them to a large Julian date.
			values[axis] = (source.SolutionEpochTDB - source.Nominal[index]) - offsets[index]
		} else {
			values[axis] = source.Nominal[index] + offsets[index]
		}
		if !finite(values[axis]) {
			return nil, nil, errors.New("source draw exceeds numerical range")
		}
	}
	e, q, elapsed := values[0], values[1], values[2]
	if e < 0 || q <= 0 || values[5] < 0 || values[5] > 180 {
		return nil, nil, errors.New("source draw requires e >= 0, q > 0 and inclination within 0 to 180 degrees")
	}
	var plane conicPlane
	var err error
	if e > .9999 {
		plane, err = universalPlane(ctx, e, q, elapsed, mu)
	} else {
		plane, err = ellipticPlane(ctx, e, q, elapsed, mu)
	}
	if err != nil {
		return nil, nil, err
	}
	const deg = math.Pi / 180
	sO, cO := math.Sincos(values[3] * deg)
	sw, cw := math.Sincos(values[4] * deg)
	si, ci := math.Sincos(values[5] * deg)
	p := [3]float64{cO*cw - sO*sw*ci, sO*cw + cO*sw*ci, sw * si}
	r := [3]float64{-cO*sw - sO*cw*ci, -sO*sw + cO*cw*ci, cw * si}
	state, extras := make([]float64, 6), make([]float64, len(source.Labels)-6)
	for k := 0; k < 3; k++ {
		state[k] = plane.x*p[k] + plane.y*r[k]
		state[k+3] = plane.vx*p[k] + plane.vy*r[k]
	}
	for k := range extras {
		extras[k] = source.Nominal[6+k] + offsets[6+k]
		if !finite(extras[k]) {
			return nil, nil, errors.New("additional source parameter exceeds numerical range")
		}
	}
	for _, value := range state {
		if !finite(value) {
			return nil, nil, errors.New("source draw Cartesian state exceeds numerical range")
		}
	}
	return state, extras, nil
}
