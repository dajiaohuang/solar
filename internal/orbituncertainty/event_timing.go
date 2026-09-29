package orbituncertainty

import (
	"context"
	"errors"
	"math"
	"sort"
)

type EventTimingSelection struct {
	Index             int        `json:"index"`
	EventIndex        int        `json:"eventIndex"`
	ElapsedTDBSeconds float64    `json:"elapsedTdbSeconds"`
	BracketSeconds    [2]float64 `json:"bracketSeconds"`
}

type EventTimingExclusion struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

type EventTimingQuantile struct {
	Fraction                  float64    `json:"fraction"`
	Rank                      int        `json:"rank"`
	ElapsedTDBSeconds         float64    `json:"elapsedTdbSeconds"`
	LocalizationBoundsSeconds [2]float64 `json:"localizationBoundsSeconds"`
}

type EventTimingCounts struct {
	Total         int `json:"total"`
	Selected      int `json:"selected"`
	Failed        int `json:"failed"`
	Unresolved    int `json:"unresolved"`
	NotDetected   int `json:"notDetected"`
	AmbiguousZero int `json:"ambiguousZero"`
}

type EventTimingDirection struct {
	Direction      string                 `json:"direction"`
	EventSelection string                 `json:"eventSelection"`
	Counts         EventTimingCounts      `json:"counts"`
	Selections     []EventTimingSelection `json:"selections"`
	Exclusions     []EventTimingExclusion `json:"exclusions"`
	Status         string                 `json:"status"`
	Quantiles      []EventTimingQuantile  `json:"quantiles"`
}

type EventTimingSummary struct {
	Method      string                 `json:"method"`
	Summaries   []EventTimingDirection `json:"summaries"`
	Limitations []string               `json:"limitations"`
}

// SummarizeDetectedEventTimes describes a selected finite subset. Every supplied
// draw retains its identity; neither offsets nor failures imply probabilities.
func SummarizeDetectedEventTimes(ctx context.Context, draws []DistanceEventDraw) (*EventTimingSummary, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(draws) == 0 || len(draws) > 128 {
		return nil, errors.New("bounded event draw set required")
	}
	result := &EventTimingSummary{Method: "conditional-first-detected-nearest-rank-times-v1",
		Summaries: make([]EventTimingDirection, 0, 2), Limitations: []string{
			"Conditional descriptive order statistics of caller-supplied finite draws, not a probability sample, population confidence interval, event probability or calibrated physical uncertainty.",
			"First means earliest detected time in the chronological search window, including negative offsets, not first along integration direction.",
			"Direction describes sampled signs; no unique physical-event correspondence across draws or complete crossing detection is asserted.",
			"An unclassified sampled zero before or at the candidate excludes that draw instead of assigning a direction.",
			"Failed, unresolved, not-detected and ambiguous draws retain separate identities and receive no timing value; they are not event-free draws.",
			"Nearest ranks use ceil(fraction * selectedCount) without interpolation. Sorted bracket endpoints bound numerical order statistics only, excluding integration and physical uncertainty.",
			"At least two selected draws are required; this does not establish convergence or adequate tail sampling.",
		}}
	for _, direction := range []string{"decreasing", "increasing"} {
		summary := EventTimingDirection{Direction: direction, EventSelection: "first-detected-in-chronological-order",
			Counts: EventTimingCounts{Total: len(draws)}, Selections: make([]EventTimingSelection, 0), Exclusions: make([]EventTimingExclusion, 0), Status: "insufficient-selected-draws"}
		for index, draw := range draws {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if draw.Index != index {
				return nil, errors.New("event timing requires complete ordered draw identities")
			}
			if draw.Status != "searched" {
				if draw.Search != nil {
					return nil, errors.New("incomplete draw must not publish successful search")
				}
				switch draw.Status {
				case "failed":
					summary.Counts.Failed++
				case "unresolved":
					summary.Counts.Unresolved++
				default:
					return nil, errors.New("invalid event draw status")
				}
				summary.Exclusions = append(summary.Exclusions, EventTimingExclusion{Index: index, Reason: draw.Status})
				continue
			}
			if draw.Search == nil || len(draw.Search.Events) > 128 {
				return nil, errors.New("bounded completed search required")
			}
			tolerance := draw.Search.Settings.ToleranceSeconds
			if !finite(draw.Search.Settings.StartSeconds) || !finite(draw.Search.Settings.EndSeconds) ||
				!finite(tolerance) || tolerance <= 0 || draw.Search.Settings.StartSeconds > draw.Search.Settings.EndSeconds {
				return nil, errors.New("invalid event search window or localization tolerance")
			}
			chosen := -1
			firstZero := math.Inf(1)
			previous := math.Inf(-1)
			for eventIndex, event := range draw.Search.Events {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				scanLo, scanHi := event.ScanBracketSeconds[0], event.ScanBracketSeconds[1]
				lo, hi, t := event.LocalizationBracketSeconds[0], event.LocalizationBracketSeconds[1], event.ElapsedTDBSeconds
				if !finite(t) || !finite(scanLo) || !finite(scanHi) || !finite(lo) || !finite(hi) ||
					scanLo > scanHi || scanLo < draw.Search.Settings.StartSeconds || scanHi > draw.Search.Settings.EndSeconds ||
					lo > t || hi < t || lo > hi || lo < scanLo || hi > scanHi || hi-lo > tolerance ||
					t < draw.Search.Settings.StartSeconds || t > draw.Search.Settings.EndSeconds || t < previous {
					return nil, errors.New("invalid event timing localization")
				}
				previous = t
				switch event.Kind {
				case "sampled-zero":
					if event.Direction != "unclassified" || scanLo != t || scanHi != t || lo != t || hi != t ||
						event.LocalizationValues != [2]float64{} {
						return nil, errors.New("sampled zero must remain an exact unclassified sample")
					}
					firstZero = math.Min(firstZero, t)
				case "sign-change":
					low, high := event.LocalizationValues[0], event.LocalizationValues[1]
					if scanLo >= scanHi || !finite(low) || !finite(high) ||
						(event.Direction != "decreasing" && event.Direction != "increasing") {
						return nil, errors.New("invalid event direction or localization values")
					}
					if low == 0 && high == 0 {
						if lo != hi {
							return nil, errors.New("exact event root must have a zero-width localization bracket")
						}
					} else if low == 0 || high == 0 || (low < 0) == (high < 0) ||
						((low < 0) != (high < 0)) != (event.Direction == "increasing") {
						return nil, errors.New("event direction disagrees with localization bracket signs")
					}
					if chosen < 0 && event.Direction == direction {
						chosen = eventIndex
					}
				default:
					return nil, errors.New("invalid event kind")
				}
			}
			if finite(firstZero) && (chosen < 0 || firstZero <= draw.Search.Events[chosen].ElapsedTDBSeconds) {
				summary.Counts.AmbiguousZero++
				summary.Exclusions = append(summary.Exclusions, EventTimingExclusion{Index: index, Reason: "earlier-unclassified-zero"})
			} else if chosen < 0 {
				summary.Counts.NotDetected++
				summary.Exclusions = append(summary.Exclusions, EventTimingExclusion{Index: index, Reason: "not-detected"})
			} else {
				event := draw.Search.Events[chosen]
				summary.Selections = append(summary.Selections, EventTimingSelection{Index: index, EventIndex: chosen, ElapsedTDBSeconds: event.ElapsedTDBSeconds, BracketSeconds: event.LocalizationBracketSeconds})
			}
		}
		summary.Counts.Selected = len(summary.Selections)
		if len(summary.Selections) >= 2 {
			times, lower, upper := make([]float64, len(summary.Selections)), make([]float64, len(summary.Selections)), make([]float64, len(summary.Selections))
			for i, selection := range summary.Selections {
				times[i], lower[i], upper[i] = selection.ElapsedTDBSeconds, selection.BracketSeconds[0], selection.BracketSeconds[1]
			}
			sort.Float64s(times)
			sort.Float64s(lower)
			sort.Float64s(upper)
			summary.Status = "available"
			for _, fraction := range []float64{.05, .5, .95} {
				rank := int(math.Ceil(fraction * float64(len(times))))
				summary.Quantiles = append(summary.Quantiles, EventTimingQuantile{Fraction: fraction, Rank: rank, ElapsedTDBSeconds: times[rank-1], LocalizationBoundsSeconds: [2]float64{lower[rank-1], upper[rank-1]}})
			}
		}
		result.Summaries = append(result.Summaries, summary)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
