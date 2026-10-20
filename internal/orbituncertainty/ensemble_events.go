package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

type DistanceEventSettings struct {
	TargetNAIFID int                     `json:"targetNaifId"`
	DistanceKm   float64                 `json:"distanceKm"`
	Search       TrajectoryEventSettings `json:"search"`
}

type DistanceEventDraw struct {
	Index                       int                       `json:"index"`
	Status                      string                    `json:"status"`
	Stage                       string                    `json:"stage,omitempty"`
	Resource                    string                    `json:"resource,omitempty"`
	Failure                     string                    `json:"failure,omitempty"`
	InitialState                []float64                 `json:"initialStateKmKmPerSecond"`
	Search                      *TrajectoryEventSearch    `json:"search"`
	Progress                    *TrajectorySearchProgress `json:"searchProgress"`
	BracketSeconds              *[2]float64               `json:"bracketSeconds,omitempty"`
	BracketValues               *[2]float64               `json:"bracketValues,omitempty"`
	ForceEvaluations            int                       `json:"forceEvaluations"`
	Integrations                int                       `json:"integrations"`
	Accepted                    int                       `json:"accepted"`
	Rejected                    int                       `json:"rejected"`
	MaxAcceptedErrorRatio       float64                   `json:"maxAcceptedErrorRatio"`
	SmallestAcceptedStepSeconds *float64                  `json:"smallestAcceptedStepSeconds"`
	LargestAcceptedStepSeconds  float64                   `json:"largestAcceptedStepSeconds"`
}

type EventFrameTransform struct {
	Method              string     `json:"method"`
	SourceFrame         string     `json:"sourceFrame"`
	DestinationFrame    string     `json:"destinationFrame"`
	DestinationOrigin   string     `json:"destinationOrigin"`
	ReferenceEpochTDB   float64    `json:"referenceEpochTdb"`
	SunState            [6]float64 `json:"sunStateKmKmPerSecond"`
	AUKm                float64    `json:"auKm"`
	DaySeconds          float64    `json:"daySeconds"`
	ObliquityArcseconds float64    `json:"obliquityArcseconds"`
}

type DistanceEventEnsemble struct {
	Method                string                   `json:"method"`
	Initial               *SourceOffsetCoordinates `json:"initial"`
	ForceModel            DE440Evidence            `json:"forceModel"`
	Settings              DistanceEventSettings    `json:"settings"`
	InitialFrameTransform EventFrameTransform      `json:"initialFrameTransform"`
	Draws                 []DistanceEventDraw      `json:"draws"`
	Counts                map[string]int           `json:"counts"`
	TimingSummary         *EventTimingSummary      `json:"timingSummary"`
	ForceEvaluations      int                      `json:"forceEvaluations"`
	MaxForceEvaluations   int                      `json:"maxForceEvaluations"`
	IntegrationSettings   map[string]any           `json:"integrationSettings"`
	Limitations           []string                 `json:"limitations"`
}

// SearchSourceOffsetDistanceEvents owns one frozen force model and serially
// searches supplied six-axis offsets. It does not assign a sampling probability.
func SearchSourceOffsetDistanceEvents(ctx context.Context, original []byte, options DE440Options, offsets []float64, settings DistanceEventSettings) (*DistanceEventEnsemble, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	scanIntervals, err := settings.Search.intervals()
	if err != nil {
		return nil, err
	}
	if len(offsets) < 6 || len(offsets) > 128*6 || len(offsets)%6 != 0 ||
		settings.Search.MaxEvaluations > 2048 || settings.Search.MaxEvents > 128 ||
		!finite(settings.DistanceKm) || settings.DistanceKm <= 0 || settings.Search.ReferenceEpochTDB != options.ReferenceEpochTDB ||
		math.Max(math.Abs(settings.Search.StartSeconds), math.Abs(settings.Search.EndSeconds)) > 365*86400 ||
		math.Min(0, settings.Search.StartSeconds) < options.ElapsedRangeSeconds[0] || math.Max(0, settings.Search.EndSeconds) > options.ElapsedRangeSeconds[1] {
		return nil, errors.New("invalid bounded six-axis distance-event ensemble")
	}
	scanDuration := settings.Search.EndSeconds - settings.Search.StartSeconds
	scanEndpoints := make(map[float64]struct{}, scanIntervals+1)
	for index := 0; index <= scanIntervals; index++ {
		scanEndpoints[trajectoryScanTime(settings.Search.StartSeconds, settings.Search.EndSeconds, scanDuration, scanIntervals, index)] = struct{}{}
	}
	owned := append([]float64(nil), offsets...)
	for _, v := range owned {
		if !finite(v) {
			return nil, errors.New("finite event source offsets required")
		}
	}
	dynamics, err := NewDE440Dynamics(ctx, options)
	if err != nil {
		return nil, err
	}
	var solar *PointMass
	found := false
	for i := range dynamics.Evidence.Gravity.Masses {
		mass := &dynamics.Evidence.Gravity.Masses[i]
		if mass.NAIFID == 10 {
			solar = mass
		}
		if mass.NAIFID == settings.TargetNAIFID {
			found = true
		}
	}
	if !found || solar == nil {
		return nil, errors.New("event target must be a prescribed force body with adopted solar GM")
	}
	const au, day = 149597870.7, 86400.0
	initial, err := ConvertSourceOffsets(ctx, original, AdoptedSolarGM{AU3PerDay2: solar.GMKm3PerSecond2 * day * day / (au * au * au), Source: solar.GMSource}, owned)
	if err != nil {
		return nil, err
	}
	source := &initial.Conversion.Inspection.Source
	if initial.Dimension != 6 || len(source.AdditionalParameters) != 0 || source.SolutionEpochTDB != options.ReferenceEpochTDB {
		return nil, errors.New("event ensemble requires six-axis covariance at the frozen reference epoch; no force axes may be dropped")
	}
	sun, err := dynamics.State(ctx, 10, 0)
	if err != nil {
		return nil, err
	}
	for _, v := range sun {
		if !finite(v) {
			return nil, errors.New("nonfinite event reference Sun state")
		}
	}
	result := &DistanceEventEnsemble{Method: "supplied-source-offset-distance-event-ensemble-nearest-scan-checkpoint-v3", Initial: initial,
		ForceModel: dynamics.Evidence, Settings: settings, MaxForceEvaluations: ensembleMaxEvaluations, Draws: make([]DistanceEventDraw, len(initial.Draws)),
		Counts:                map[string]int{"total": len(initial.Draws), "searched": 0, "failed": 0, "unresolved": 0},
		InitialFrameTransform: EventFrameTransform{Method: "fixed-eclipj2000-to-j2000-plus-prescribed-sun-v1", SourceFrame: source.Frame, DestinationFrame: "J2000", DestinationOrigin: "SSB", ReferenceEpochTDB: source.SolutionEpochTDB, SunState: sun, AUKm: au, DaySeconds: day, ObliquityArcseconds: 84381.448},
		IntegrationSettings:   map[string]any{"algorithm": "dormand-prince-54-component-max-v1", "absoluteTolerance": []float64{1e-5, 1e-5, 1e-5, 1e-12, 1e-12, 1e-12}, "relativeTolerance": 1e-12, "initialStep": 3600, "maxStep": day, "maxAttempts": 20000},
		Limitations: []string{
			"Caller-supplied offsets, not an automatically generated probability sample. Original source axes and failed/unresolved draw identities are retained.",
			"Geometric simultaneous distance from a prescribed force-body center. The caller threshold is not a physical radius, collision or apparent occultation model.",
			"Each draw caches only requested scan-endpoint states plus the source-epoch state. Scan endpoints are evaluated chronologically; each refinement sample integrates from the nearest fixed scan/reference checkpoint, with ties resolved toward the earlier epoch. Refinement samples never enter the cache, so root-query order cannot change later trajectory states. DP54 restarts on each segment; accumulated trajectory error has no global bound. No dense output or complete event detection is claimed.",
			"Searched with zero detections is not proof of no event. Failed and unresolved draws must not be counted as event-free.",
			"All draws share 250000 force calls and caller context. Event-function evaluations have separate per-draw limits; source conversion and prescribed target evaluations are outside the force count.",
			"Incomplete searches retain diagnostics only. Integration counters include only completed integrations; force counters also include failed derivative calls.",
			"Coordinate conversion and force model are conditional; solar ephemeris/GM uncertainty and the complete SBDB fit model are not propagated. Root tolerance is not physical timing uncertainty.",
		}}
	derivative := func(ctx context.Context, t float64, state, output []float64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if result.ForceEvaluations >= ensembleMaxEvaluations {
			return &TrajectoryBudgetError{Resource: "forces", Message: "event ensemble exhausted shared force budget"}
		}
		result.ForceEvaluations++
		return dynamics.Derivative(ctx, t, state, output)
	}
	s, c := math.Sincos(84381.448 / 3600 * math.Pi / 180)
	for index, draw := range initial.Draws {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entry := DistanceEventDraw{Index: index}
		if !draw.Valid {
			entry.Status, entry.Stage, entry.Failure = "failed", "coordinates", draw.Failure
		} else if result.ForceEvaluations >= ensembleMaxEvaluations {
			entry.Status, entry.Stage, entry.Resource, entry.Failure = "unresolved", "not-started", "forces", "not searched after shared force exhaustion"
		} else {
			barycentric := make([]float64, 6)
			for _, axis := range []int{0, 3} {
				scale := au
				if axis == 3 {
					scale /= day
				}
				barycentric[axis] = draw.State[axis]*scale + sun[axis]
				barycentric[axis+1] = (c*draw.State[axis+1]-s*draw.State[axis+2])*scale + sun[axis+1]
				barycentric[axis+2] = (s*draw.State[axis+1]+c*draw.State[axis+2])*scale + sun[axis+2]
			}
			valid := true
			for _, v := range barycentric {
				if !finite(v) {
					valid = false
				}
			}
			if !valid {
				entry.Status, entry.Stage, entry.Failure = "failed", "integration", "event initial state exceeds numeric range"
			} else {
				entry.InitialState = append([]float64(nil), barycentric...)
				cachedEpochs := []float64{0}
				cachedStates := [][]float64{append([]float64(nil), barycentric...)}
				nearestCheckpoint := func(time float64) int {
					low, high := 0, len(cachedEpochs)
					for low < high {
						middle := low + (high-low)/2
						if cachedEpochs[middle] < time {
							low = middle + 1
						} else {
							high = middle
						}
					}
					if low < len(cachedEpochs) && cachedEpochs[low] == time {
						return low
					}
					if low == 0 {
						return 0
					}
					if low == len(cachedEpochs) {
						return len(cachedEpochs) - 1
					}
					before, after := low-1, low
					if time-cachedEpochs[before] <= cachedEpochs[after]-time {
						return before
					}
					return after
				}
				rememberCheckpoint := func(time float64, state []float64) {
					low, high := 0, len(cachedEpochs)
					for low < high {
						middle := low + (high-low)/2
						if cachedEpochs[middle] < time {
							low = middle + 1
						} else {
							high = middle
						}
					}
					if low < len(cachedEpochs) && cachedEpochs[low] == time {
						return
					}
					cachedEpochs = append(cachedEpochs, 0)
					copy(cachedEpochs[low+1:], cachedEpochs[low:])
					cachedEpochs[low] = time
					cachedStates = append(cachedStates, nil)
					copy(cachedStates[low+1:], cachedStates[low:])
					cachedStates[low] = append([]float64(nil), state...)
				}
				before := result.ForceEvaluations
				search, searchErr := SearchTrajectoryEvents(ctx, settings.Search, func(ctx context.Context, t float64) (float64, error) {
					target, err := dynamics.State(ctx, settings.TargetNAIFID, t)
					if err != nil {
						return 0, err
					}
					for _, v := range target {
						if !finite(v) {
							return 0, errors.New("nonfinite prescribed event target state")
						}
					}
					closest := nearestCheckpoint(t)
					state := cachedStates[closest]
					if t != cachedEpochs[closest] {
						anchor, segmentDuration := cachedEpochs[closest], t-cachedEpochs[closest]
						integration, err := Integrate(ctx, IntegrationOptions{Initial: state, Duration: segmentDuration,
							Derivative: func(segmentContext context.Context, elapsed float64, state, output []float64) error {
								absoluteElapsed := anchor + elapsed
								if elapsed == segmentDuration {
									absoluteElapsed = t
								}
								return derivative(segmentContext, absoluteElapsed, state, output)
							}, AbsoluteTolerance: []float64{1e-5, 1e-5, 1e-5, 1e-12, 1e-12, 1e-12},
							RelativeTolerance: 1e-12, InitialStep: 3600, MaxStep: day, MaxAttempts: 20000})
						if err != nil {
							return 0, err
						}
						entry.Integrations++
						entry.Accepted += integration.Accepted
						entry.Rejected += integration.Rejected
						entry.MaxAcceptedErrorRatio = math.Max(entry.MaxAcceptedErrorRatio, integration.MaxAcceptedErrorRatio)
						entry.LargestAcceptedStepSeconds = math.Max(entry.LargestAcceptedStepSeconds, integration.LargestAcceptedStep)
						if integration.SmallestAcceptedStep != nil &&
							(entry.SmallestAcceptedStepSeconds == nil || *integration.SmallestAcceptedStep < *entry.SmallestAcceptedStepSeconds) {
							value := *integration.SmallestAcceptedStep
							entry.SmallestAcceptedStepSeconds = &value
						}
						state = integration.State
						if _, scanEndpoint := scanEndpoints[t]; scanEndpoint {
							rememberCheckpoint(t, state)
						}
					}
					distance := math.Hypot(math.Hypot(state[0]-target[0], state[1]-target[1]), state[2]-target[2])
					if !finite(distance) {
						return 0, &TrajectorySampleError{Message: "event sample distance exceeds numeric range"}
					}
					return distance - settings.DistanceKm, nil
				})
				entry.ForceEvaluations = result.ForceEvaluations - before
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				var budget *TrajectoryBudgetError
				var localization *TrajectoryLocalizationError
				var sample *TrajectorySampleError
				switch {
				case searchErr == nil:
					entry.Status, entry.Search = "searched", search
				case errors.As(searchErr, &budget):
					entry.Status, entry.Stage, entry.Resource, entry.Failure = "unresolved", "search", budget.Resource, budget.Error()
					entry.Progress = &budget.Progress
				case errors.As(searchErr, &localization):
					entry.Status, entry.Stage, entry.Failure = "failed", "localization", localization.Error()
					entry.Progress = &localization.Progress
					entry.BracketSeconds = &localization.BracketSeconds
					entry.BracketValues = &localization.BracketValues
				case errors.As(searchErr, &sample):
					entry.Status, entry.Stage, entry.Failure = "failed", "integration", sample.Error()
				default:
					return nil, searchErr
				}
			}
		}
		result.Draws[index] = entry
		result.Counts[entry.Status]++
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result.TimingSummary, err = SummarizeDetectedEventTimes(ctx, result.Draws)
	if err != nil {
		return nil, err
	}
	return result, nil
}
