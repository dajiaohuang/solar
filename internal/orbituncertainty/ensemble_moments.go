package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

type EnsembleMoments struct {
	Status             string      `json:"status"`
	Reason             string      `json:"reason,omitempty"`
	Count              int         `json:"count"`
	FailedCount        int         `json:"failedCount"`
	Anchor             []float64   `json:"anchor"`
	MeanOffset         []float64   `json:"meanOffset"`
	Mean               []float64   `json:"mean"`
	Covariance         [][]float64 `json:"covariance"`
	StandardDeviations []float64   `json:"standardDeviations"`
	CovarianceDivisor  int         `json:"covarianceDivisor"`
	Method             string      `json:"method"`
	Limitation         string      `json:"limitation"`
}

// Keep the small centered offsets separate from the rounded absolute mean.
// No successful-only summary is produced when any indexed draw failed.
func summarizeEnsemble(ctx context.Context, endpoints []EnsembleEndpoint) (*EnsembleMoments, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	n := len(endpoints)
	if n < 1 || n > 128 {
		return nil, errors.New("ensemble moments require 1 to 128 indexed endpoints")
	}
	result := &EnsembleMoments{Status: "unavailable", Count: n,
		Method:     "anchored-compensated-two-pass-sample-moments-v1",
		Limitation: "Descriptive finite-ensemble mean and sample covariance only; no confidence level, convergence, event probability or physical-error calibration. Unavailable when any draw failed or fewer than two draws exist. Covariance uses the products of the endpoint axis units."}
	for index, endpoint := range endpoints {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if endpoint.Index != index {
			return nil, errors.New("ensemble endpoint identity mismatch")
		}
		if !endpoint.Valid {
			result.FailedCount++
			continue
		}
		if len(endpoint.State) != 6 {
			return nil, errors.New("valid ensemble endpoint must have six components")
		}
		for _, value := range endpoint.State {
			if !finite(value) {
				return nil, errors.New("valid ensemble endpoint must be finite")
			}
		}
	}
	if result.FailedCount > 0 {
		result.Reason = "failed-draws"
		return result, nil
	}
	if n < 2 {
		result.Reason = "insufficient-draws"
		return result, nil
	}
	sum := func(term func(int) float64) (float64, error) {
		total, compensation := 0.0, 0.0
		for index := range endpoints {
			if err := ctx.Err(); err != nil {
				return 0, err
			}
			value := term(index) - compensation
			next := total + value
			compensation = (next - total) - value
			if !finite(value) || !finite(next) || !finite(compensation) {
				return 0, errors.New("ensemble moments exceed numerical range")
			}
			total = next
		}
		return total, nil
	}
	result.Anchor = append([]float64(nil), endpoints[0].State...)
	result.MeanOffset, result.Mean = make([]float64, 6), make([]float64, 6)
	for axis := 0; axis < 6; axis++ {
		value, err := sum(func(index int) float64 { return endpoints[index].State[axis] - result.Anchor[axis] })
		if err != nil {
			return nil, err
		}
		result.MeanOffset[axis] = value / float64(n)
		result.Mean[axis] = result.Anchor[axis] + result.MeanOffset[axis]
		if !finite(result.Mean[axis]) {
			return nil, errors.New("ensemble mean exceeds numerical range")
		}
	}
	result.Covariance, result.StandardDeviations = square(6), make([]float64, 6)
	result.CovarianceDivisor = n - 1
	for row := 0; row < 6; row++ {
		for column := row; column < 6; column++ {
			value, err := sum(func(index int) float64 {
				a := (endpoints[index].State[row] - result.Anchor[row]) - result.MeanOffset[row]
				b := (endpoints[index].State[column] - result.Anchor[column]) - result.MeanOffset[column]
				return a * b
			})
			if err != nil {
				return nil, err
			}
			value /= float64(n - 1)
			if !finite(value) || (row == column && value < 0) {
				return nil, errors.New("ensemble covariance lost numerical validity")
			}
			result.Covariance[row][column], result.Covariance[column][row] = value, value
		}
		result.StandardDeviations[row] = math.Sqrt(result.Covariance[row][row])
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result.Status = "available"
	return result, nil
}
