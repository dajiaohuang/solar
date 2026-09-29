package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

// Derivative receives elapsed time, never an absolute Julian date. It must
// treat state as read-only and write every output component before returning.
// Buffers belong to the integrator and must not be retained by the callback.
type Derivative func(context.Context, float64, []float64, []float64) error

type IntegrationOptions struct {
	Initial           []float64
	Duration          float64
	Derivative        Derivative
	AbsoluteTolerance []float64
	RelativeTolerance float64
	InitialStep       float64
	MaxStep           float64
	MaxAttempts       int
	// Receives an owned copy at accepted endpoints only. Storage of an entire
	// trajectory must have a separate budget in the caller.
	OnAcceptedStep func(context.Context, float64, []float64) error
}

type IntegrationResult struct {
	Algorithm             string    `json:"algorithm"`
	Elapsed               float64   `json:"elapsed"`
	State                 []float64 `json:"state"`
	Accepted              int       `json:"accepted"`
	Rejected              int       `json:"rejected"`
	Evaluations           int       `json:"evaluations"`
	Attempts              int       `json:"attempts"`
	SmallestAcceptedStep  *float64  `json:"smallestAcceptedStep"`
	LargestAcceptedStep   float64   `json:"largestAcceptedStep"`
	MaxAcceptedErrorRatio float64   `json:"maxAcceptedErrorRatio"`
	RelativeTolerance     float64   `json:"relativeTolerance"`
	AbsoluteTolerance     []float64 `json:"absoluteTolerance"`
	MaxStep               float64   `json:"maxStep"`
	InitialStep           float64   `json:"initialStep"`
	MaxAttempts           int       `json:"maxAttempts"`
}

var stageTime = [7]float64{0, 1.0 / 5, 3.0 / 10, 4.0 / 5, 8.0 / 9, 1, 1}
var stageWeight = [7][7]float64{
	{}, {1.0 / 5}, {3.0 / 40, 9.0 / 40}, {44.0 / 45, -56.0 / 15, 32.0 / 9},
	{19372.0 / 6561, -25360.0 / 2187, 64448.0 / 6561, -212.0 / 729},
	{9017.0 / 3168, -355.0 / 33, 46732.0 / 5247, 49.0 / 176, -5103.0 / 18656},
	{35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84},
}
var errorWeight = [7]float64{35.0/384 - 5179.0/57600, 0, 500.0/1113 - 7571.0/16695,
	125.0/192 - 393.0/640, -2187.0/6784 + 92097.0/339200, 11.0/84 - 187.0/2100, -1.0 / 40}

// Integrate implements the bounded Dormand–Prince 5(4) component-max policy
// used by the browser experiment. Tolerances estimate local integration error,
// not physical orbit uncertainty. No dense output, collision/event detection,
// stiffness handling or long-term symplectic guarantee is implied.
func Integrate(ctx context.Context, options IntegrationOptions) (*IntegrationResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	n := len(options.Initial)
	if n < 1 || n > 512 || len(options.AbsoluteTolerance) != n || options.Derivative == nil ||
		!finite(options.Duration) || !finite(options.RelativeTolerance) || options.RelativeTolerance < 1e-14 || options.RelativeTolerance > 1 ||
		!finite(options.InitialStep) || options.InitialStep <= 0 || !finite(options.MaxStep) || options.MaxStep <= 0 ||
		options.MaxAttempts < 1 || options.MaxAttempts > 200000 {
		return nil, errors.New("invalid bounded integration settings")
	}
	state := append([]float64(nil), options.Initial...)
	absolute := append([]float64(nil), options.AbsoluteTolerance...)
	for i := range state {
		if !finite(state[i]) || !finite(absolute[i]) || absolute[i] <= 0 {
			return nil, errors.New("finite initial state and positive component tolerances required")
		}
	}
	result := &IntegrationResult{Algorithm: "dormand-prince-54-component-max-v1", State: state,
		RelativeTolerance: options.RelativeTolerance, AbsoluteTolerance: absolute,
		MaxStep: options.MaxStep, InitialStep: options.InitialStep, MaxAttempts: options.MaxAttempts}
	var stages [7][]float64
	for i := range stages {
		stages[i] = make([]float64, n)
	}
	trial, compensation, nextCompensation := make([]float64, n), make([]float64, n), make([]float64, n)
	evaluate := func(elapsed float64, input, output []float64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !finite(elapsed) {
			return &TrajectorySampleError{Message: "integration stage epoch is nonfinite"}
		}
		for i, value := range input {
			if !finite(value) {
				return &TrajectorySampleError{Message: "integration stage state is nonfinite"}
			}
			output[i] = math.NaN() // Partial writes must never reuse old slopes.
		}
		if err := options.Derivative(ctx, elapsed, input, output); err != nil {
			return err
		}
		result.Evaluations++
		if err := ctx.Err(); err != nil {
			return err
		}
		for _, value := range output {
			if !finite(value) {
				return errors.New("derivative did not write every finite component")
			}
		}
		return nil
	}
	direction := math.Copysign(1, options.Duration)
	stepSize := math.Min(options.InitialStep, math.Min(options.MaxStep, math.Abs(options.Duration)))
	timeCompensation := 0.0
	if options.Duration != 0 {
		if err := evaluate(0, state, stages[0]); err != nil {
			return nil, err
		}
	}
	for direction*(options.Duration-result.Elapsed) > 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if result.Attempts >= options.MaxAttempts {
			return nil, &TrajectorySampleError{Message: "integration exhausted attempt budget before requested epoch"}
		}
		result.Attempts++
		remaining := math.Abs((options.Duration - result.Elapsed) + timeCompensation)
		magnitude := math.Min(stepSize, math.Min(options.MaxStep, remaining))
		step := direction * magnitude
		nextTime, nextTimeCompensation := advanceCompensatedEpoch(result.Elapsed, timeCompensation, step, options.Duration, magnitude == remaining)
		if !finite(magnitude) || magnitude <= 0 || !finite(nextTime) || !(direction*(nextTime-result.Elapsed) > 0) {
			return nil, &TrajectorySampleError{Message: "integration step is below elapsed-time resolution"}
		}
		for stage := 1; stage < 7; stage++ {
			for i := 0; i < n; i++ {
				slope := 0.0
				for j := 0; j < stage; j++ {
					slope += stageWeight[stage][j] * stages[j][i]
				}
				increment := step*slope - compensation[i]
				trial[i] = state[i] + increment
				if stage == 6 {
					nextCompensation[i] = (trial[i] - state[i]) - increment
				}
			}
			epoch := result.Elapsed + (stageTime[stage]*step - timeCompensation)
			if stage >= 5 {
				epoch = nextTime
			}
			if err := evaluate(epoch, trial, stages[stage]); err != nil {
				return nil, err
			}
		}
		errorRatio := 0.0
		for i := 0; i < n; i++ {
			difference := 0.0
			for j := 0; j < 7; j++ {
				difference += errorWeight[j] * stages[j][i]
			}
			scale := absolute[i] + options.RelativeTolerance*math.Max(math.Abs(state[i]), math.Abs(trial[i]))
			ratio := math.Abs(step*difference) / scale
			if !finite(scale) || !finite(ratio) {
				return nil, &TrajectorySampleError{Message: "integration error estimate is nonfinite"}
			}
			errorRatio = math.Max(errorRatio, ratio)
		}
		factor := 5.0
		if errorRatio != 0 {
			factor = math.Min(5, math.Max(.1, .9*math.Pow(errorRatio, -1.0/5)))
		}
		if errorRatio <= 1 {
			copy(state, trial)
			copy(compensation, nextCompensation)
			result.Elapsed, timeCompensation = nextTime, nextTimeCompensation
			result.Accepted++
			copy(stages[0], stages[6]) // FSAL only after acceptance.
			if result.SmallestAcceptedStep == nil || magnitude < *result.SmallestAcceptedStep {
				value := magnitude
				result.SmallestAcceptedStep = &value
			}
			result.LargestAcceptedStep = math.Max(result.LargestAcceptedStep, magnitude)
			result.MaxAcceptedErrorRatio = math.Max(result.MaxAcceptedErrorRatio, errorRatio)
			if options.OnAcceptedStep != nil {
				if err := options.OnAcceptedStep(ctx, result.Elapsed, append([]float64(nil), state...)); err != nil {
					return nil, err
				}
			}
		} else {
			result.Rejected++
			factor = math.Min(1, factor)
		}
		stepSize = magnitude * factor
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func advanceCompensatedEpoch(elapsed, compensation, step, endpoint float64, reachesEndpoint bool) (float64, float64) {
	if reachesEndpoint {
		return endpoint, 0
	}
	increment := step - compensation
	next := elapsed + increment
	return next, (next - elapsed) - increment
}
