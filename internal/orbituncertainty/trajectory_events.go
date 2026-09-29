package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

type TrajectoryEventSettings struct {
	ReferenceEpochTDB float64 `json:"referenceEpochTdb"`
	StartSeconds      float64 `json:"startSeconds"`
	EndSeconds        float64 `json:"endSeconds"`
	MaxStepSeconds    float64 `json:"maxStepSeconds"`
	ToleranceSeconds  float64 `json:"toleranceSeconds"`
	MaxEvaluations    int     `json:"maxEvaluations"`
	MaxEvents         int     `json:"maxEvents"`
}

type TrajectoryEvent struct {
	Kind                       string     `json:"kind"`
	Direction                  string     `json:"direction"`
	ElapsedTDBSeconds          float64    `json:"elapsedTdbSeconds"`
	ScanBracketSeconds         [2]float64 `json:"scanBracketSeconds"`
	LocalizationBracketSeconds [2]float64 `json:"localizationBracketSeconds"`
	LocalizationValues         [2]float64 `json:"localizationValues"`
}

type TrajectorySearchProgress struct {
	AttemptedEvaluations int      `json:"attemptedEvaluations"`
	CompletedEvaluations int      `json:"completedEvaluations"`
	RetainedEventCount   int      `json:"retainedEventCount"`
	LastAttemptSeconds   *float64 `json:"lastAttemptSeconds"`
}

func trajectoryScanTime(start, end, duration float64, intervals, index int) float64 {
	if index == intervals {
		return end
	}
	return start + (duration/float64(intervals))*float64(index)
}

type TrajectoryBudgetError struct {
	Resource string
	Message  string
	Progress TrajectorySearchProgress
}

func (e *TrajectoryBudgetError) Error() string { return e.Message }

type TrajectoryLocalizationError struct {
	BracketSeconds [2]float64
	BracketValues  [2]float64
	Progress       TrajectorySearchProgress
}

func (e *TrajectoryLocalizationError) Error() string {
	return "trajectory event tolerance is below the remaining bracket numerical resolution"
}

type TrajectoryEventSearch struct {
	Method                     string                  `json:"method"`
	TimeScale                  string                  `json:"timeScale"`
	Settings                   TrajectoryEventSettings `json:"settings"`
	Events                     []TrajectoryEvent       `json:"events"`
	Evaluations                int                     `json:"evaluations"`
	ScanIntervals              int                     `json:"scanIntervals"`
	MaximumScanIntervalSeconds float64                 `json:"maximumScanIntervalSeconds"`
	StartValue                 float64                 `json:"startValue"`
	EndValue                   float64                 `json:"endValue"`
	Coverage                   string                  `json:"coverage"`
	PossibleMissedEvents       bool                    `json:"possibleMissedEvents"`
	Limitations                []string                `json:"limitations"`
}

func (settings TrajectoryEventSettings) intervals() (int, error) {
	duration := settings.EndSeconds - settings.StartSeconds
	if !finite(settings.ReferenceEpochTDB) || !finite(settings.StartSeconds) || !finite(settings.EndSeconds) || !finite(duration) || duration < 0 ||
		!finite(settings.MaxStepSeconds) || settings.MaxStepSeconds <= 0 || !finite(settings.ToleranceSeconds) || settings.ToleranceSeconds <= 0 || settings.ToleranceSeconds > settings.MaxStepSeconds ||
		settings.MaxEvaluations < 1 || settings.MaxEvaluations > 200000 || settings.MaxEvents < 1 || settings.MaxEvents > 4096 {
		return 0, errors.New("invalid bounded trajectory event settings")
	}
	n := 0.0
	if duration > 0 {
		n = math.Max(1, math.Ceil(duration/settings.MaxStepSeconds))
	}
	// Compare before converting to int, including overflowed quotients.
	if !finite(n) || n+1 > float64(settings.MaxEvaluations) {
		return 0, errors.New("trajectory scan exceeds its evaluation budget")
	}
	intervals := int(n)
	for duration > 0 {
		fits := true
		previous := settings.StartSeconds
		for index := 1; index <= intervals; index++ {
			next := trajectoryScanTime(settings.StartSeconds, settings.EndSeconds, duration, intervals, index)
			if !(next > previous) {
				return 0, errors.New("trajectory scan is below elapsed-time resolution")
			}
			if next-previous > settings.MaxStepSeconds {
				nextFloat := math.Nextafter(previous, math.Inf(1))
				if nextFloat-previous > settings.MaxStepSeconds {
					return 0, errors.New("trajectory maximum step is below elapsed-time resolution")
				}
				fits = false
				break
			}
			previous = next
		}
		if fits {
			return intervals, nil
		}
		intervals++
		if intervals+1 > settings.MaxEvaluations {
			return 0, errors.New("trajectory scan exceeds its evaluation budget")
		}
	}
	return intervals, nil
}

// SearchTrajectoryEvents locates sampled zeros and sign changes only. evaluate
// must use a continuous event function and one frozen trajectory/source contract.
// Errors return no partial result; typed failures retain diagnostic counts only.
func SearchTrajectoryEvents(ctx context.Context, settings TrajectoryEventSettings, evaluate func(context.Context, float64) (float64, error)) (*TrajectoryEventSearch, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	intervals, err := settings.intervals()
	if err != nil {
		return nil, err
	}
	if evaluate == nil {
		return nil, errors.New("trajectory evaluator required")
	}
	result := &TrajectoryEventSearch{Method: "context-sampled-sign-change-bisection-v1", TimeScale: "TDB", Settings: settings,
		Events: make([]TrajectoryEvent, 0), ScanIntervals: intervals, Coverage: "sampled-sign-changes-only", PossibleMissedEvents: true,
		Limitations: []string{
			"Requires a continuous scalar event function and one frozen initial/source contract; the search does not certify either.",
			"Tangencies, zero plateaus and multiple crossings between samples can be missed. No detections do not prove absence.",
			"Directions describe sampled signs, not a unique root or certified local derivative. Sampled zeros remain unclassified.",
			"Localization brackets describe numerical refinement, not integration error, physical uncertainty or event probability.",
			"Event-function calls and underlying force calls require separate budgets. Cancellation and failures return no partial successful search.",
		}}
	completed := 0
	var last *float64
	progress := func() TrajectorySearchProgress {
		p := TrajectorySearchProgress{AttemptedEvaluations: result.Evaluations, CompletedEvaluations: completed, RetainedEventCount: len(result.Events)}
		if last != nil {
			value := *last
			p.LastAttemptSeconds = &value
		}
		return p
	}
	budget := func(resource, message string) error {
		return &TrajectoryBudgetError{Resource: resource, Message: message, Progress: progress()}
	}
	sample := func(t float64) (float64, error) {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if result.Evaluations >= settings.MaxEvaluations {
			return 0, budget("evaluations", "trajectory event refinement exceeds evaluation budget")
		}
		result.Evaluations++
		value := t
		last = &value
		v, err := evaluate(ctx, t)
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		if err != nil {
			var exhausted *TrajectoryBudgetError
			if errors.As(err, &exhausted) {
				return 0, budget(exhausted.Resource, exhausted.Message)
			}
			return 0, err
		}
		if !finite(v) {
			return 0, errors.New("trajectory evaluator returned nonfinite value")
		}
		completed++
		return v, nil
	}
	add := func(event TrajectoryEvent) error {
		if len(result.Events) >= settings.MaxEvents {
			return budget("events", "trajectory event records exceed result budget")
		}
		result.Events = append(result.Events, event)
		return nil
	}
	zero := func(t float64) error {
		return add(TrajectoryEvent{Kind: "sampled-zero", Direction: "unclassified", ElapsedTDBSeconds: t, ScanBracketSeconds: [2]float64{t, t}, LocalizationBracketSeconds: [2]float64{t, t}})
	}
	leftTime := settings.StartSeconds
	left, err := sample(leftTime)
	if err != nil {
		return nil, err
	}
	result.StartValue = left
	if left == 0 {
		if err := zero(leftTime); err != nil {
			return nil, err
		}
	}
	duration := settings.EndSeconds - settings.StartSeconds
	for i := 1; i <= intervals; i++ {
		rightTime := trajectoryScanTime(settings.StartSeconds, settings.EndSeconds, duration, intervals, i)
		if !(rightTime > leftTime) {
			return nil, errors.New("trajectory scan is below elapsed-time resolution")
		}
		scanInterval := rightTime - leftTime
		if scanInterval > settings.MaxStepSeconds {
			return nil, errors.New("trajectory scan interval exceeds configured maximum")
		}
		result.MaximumScanIntervalSeconds = math.Max(result.MaximumScanIntervalSeconds, scanInterval)
		right, err := sample(rightTime)
		if err != nil {
			return nil, err
		}
		if right == 0 {
			if err := zero(rightTime); err != nil {
				return nil, err
			}
		} else if left != 0 && (left < 0) != (right < 0) {
			lo, hi, low, high := leftTime, rightTime, left, right
			for hi-lo > settings.ToleranceSeconds {
				mid := lo + (hi-lo)/2
				if !(mid > lo && mid < hi) {
					return nil, &TrajectoryLocalizationError{BracketSeconds: [2]float64{lo, hi}, BracketValues: [2]float64{low, high}, Progress: progress()}
				}
				value, err := sample(mid)
				if err != nil {
					return nil, err
				}
				if value == 0 {
					lo, hi, low, high = mid, mid, 0, 0
					break
				}
				if (value < 0) == (low < 0) {
					lo, low = mid, value
				} else {
					hi, high = mid, value
				}
			}
			direction := "increasing"
			if left > 0 {
				direction = "decreasing"
			}
			if err := add(TrajectoryEvent{Kind: "sign-change", Direction: direction, ElapsedTDBSeconds: lo + (hi-lo)/2,
				ScanBracketSeconds: [2]float64{leftTime, rightTime}, LocalizationBracketSeconds: [2]float64{lo, hi}, LocalizationValues: [2]float64{low, high}}); err != nil {
				return nil, err
			}
		}
		leftTime, left = rightTime, right
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result.EndValue = left
	return result, nil
}
