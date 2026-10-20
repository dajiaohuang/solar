package orbituncertainty

import (
	"context"
	"errors"
	"fmt"
	"math"
)

const de440Hash = "8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069"
const de440GMHash = "924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140"
const de440GMSource = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc"
const de440SourceBytes = 32726016
const de440SourceMD5 = "3917ee56769db332790c751e2168843d"
const de440SourceLastModified = "Mon, 21 Dec 2020 19:39:26 GMT"
const de440Derivation = "Solar Atlas crop-spk.mjs: exact original J2000 type-2/3 records for segments overlapping the bounded TDB window; no refit. Parent SHA-256 was not captured; parent identity uses its URL, byte count, Last-Modified value and NAIF-published MD5."
const de440StartET, de440EndET = -43200.0, 1609416000.0

type DE440Options struct {
	// Source and raw bytes are mutually exclusive. A source skips repeated verification.
	Source                 *DE440Source
	SPKBytes, GMBytes      []byte
	ReferenceEpochTDB      float64
	ElapsedRangeSeconds    [2]float64
	ExclusionKm            map[int]float64
	SolarRelativity        bool
	SolarRadiationPressure *RadiationPressure
}

type DE440Evidence struct {
	Model                    string                   `json:"model"`
	SolarRelativity          *SolarRelativityEvidence `json:"solarRelativity"`
	SolarRadiationPressure   *RadiationPressure       `json:"solarRadiationPressure"`
	Limitations              []string                 `json:"limitations"`
	Gravity                  GravityEvidence          `json:"gravity"`
	KernelSHA256             string                   `json:"kernelSha256"`
	GMSHA256                 string                   `json:"gmSha256"`
	KernelID                 string                   `json:"kernelId"`
	KernelBytes              int                      `json:"kernelBytes"`
	KernelSource             string                   `json:"kernelSource"`
	KernelSourceBytes        int                      `json:"kernelSourceBytes"`
	KernelSourceMD5          string                   `json:"kernelSourceMd5"`
	KernelSourceLastModified string                   `json:"kernelSourceLastModified"`
	KernelDerivation         string                   `json:"kernelDerivation"`
	GMSource                 string                   `json:"gmSource"`
	Representation           string                   `json:"representation"`
}

// DE440Dynamics owns one immutable, hash-pinned source snapshot. Its state
// cache and force scratch belong to one run and are not concurrent-safe.
type DE440Dynamics struct {
	Derivative Derivative
	State      func(context.Context, int, float64) ([6]float64, error)
	Evidence   DE440Evidence
}

func twoSum(a, b float64) (sum, error float64) {
	sum = a + b
	bVirtual := sum - a
	error = (a - (sum - bVirtual)) + (b - bVirtual)
	return sum, error
}

func splitEpochOffset(referenceET, referenceResidual, elapsed float64) (high, low float64) {
	sum, sumError := twoSum(referenceET, elapsed)
	tail, tailError := twoSum(sumError, referenceResidual)
	high, low = twoSum(sum, tail)
	low += tailError
	return twoSum(high, low)
}

func splitEpochWithin(high, low, startET, endET float64) bool {
	return (high-startET)+low >= 0 && (high-endET)+low <= 0
}

func NewDE440Dynamics(ctx context.Context, options DE440Options) (*DE440Dynamics, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var radiation *RadiationPressure
	if options.SolarRadiationPressure != nil {
		copy := *options.SolarRadiationPressure
		if _, err := copy.amplitude(); err != nil {
			return nil, err
		}
		radiation = &copy
	}
	snapshot := options.Source
	if snapshot != nil && (len(options.SPKBytes) != 0 || len(options.GMBytes) != 0) {
		return nil, errors.New("choose immutable source or raw DE440 bytes, not both")
	}
	if snapshot == nil {
		var err error
		snapshot, err = NewDE440Source(ctx, options.SPKBytes, options.GMBytes)
		if err != nil {
			return nil, err
		}
	}
	if snapshot.kernel == nil || len(snapshot.masses) != 11 {
		return nil, errors.New("uninitialized DE440 source")
	}
	kernel := snapshot.kernel
	referenceDays, referenceDaysResidual := twoSum(options.ReferenceEpochTDB, -2451545)
	referenceET := referenceDays * 86400
	referenceResidual := math.FMA(referenceDays, 86400, -referenceET) + referenceDaysResidual*86400
	referenceET, referenceResidual = twoSum(referenceET, referenceResidual)
	start, end := options.ElapsedRangeSeconds[0], options.ElapsedRangeSeconds[1]
	startHigh, startLow := splitEpochOffset(referenceET, referenceResidual, start)
	endHigh, endLow := splitEpochOffset(referenceET, referenceResidual, end)
	if !finite(referenceET) || !finite(referenceResidual) || !finite(start) || !finite(end) || start > 0 || end < 0 || start > end ||
		!finite(startHigh) || !finite(startLow) || !finite(endHigh) || !finite(endLow) ||
		!splitEpochWithin(startHigh, startLow, de440StartET, de440EndET) || !splitEpochWithin(endHigh, endLow, de440StartET, de440EndET) {
		return nil, errors.New("dynamics interval must include initial epoch within pinned DE440 coverage")
	}
	masses := append([]PointMass(nil), snapshot.masses...)
	ids := make([]int, len(masses))
	for i := range masses {
		ids[i] = masses[i].NAIFID
		exclusion, exists := options.ExclusionKm[ids[i]]
		if !exists {
			return nil, fmt.Errorf("explicit exclusion required for NAIF %d", ids[i])
		}
		masses[i].ExclusionKm = exclusion
	}
	var cachedHigh, cachedLow float64
	cache := make(map[int][6]float64, 64)
	visiting := make(map[int]bool, 8)
	cacheEpochValid := false
	var resolveContext context.Context
	var resolveHigh, resolveLow float64
	var resolve func(int) ([6]float64, error)
	resolve = func(target int) ([6]float64, error) {
		if err := resolveContext.Err(); err != nil {
			return [6]float64{}, err
		}
		if value, ok := cache[target]; ok {
			return value, nil
		}
		if visiting[target] || len(visiting) >= 8 || len(cache) >= 64 {
			return [6]float64{}, errors.New("DE440 center-chain cycle or budget exceeded")
		}
		visiting[target] = true
		defer delete(visiting, target)
		local, found, err := kernel.EvaluateChebyshevAtOffsetContext(resolveContext, target, resolveHigh, resolveLow)
		if err != nil {
			return [6]float64{}, err
		}
		if !found {
			return [6]float64{}, fmt.Errorf("missing pinned DE440 state for NAIF %d", target)
		}
		center, err := resolve(local.Center)
		if err != nil {
			return [6]float64{}, err
		}
		value := [6]float64{local.Position.X, local.Position.Y, local.Position.Z, local.Velocity.X, local.Velocity.Y, local.Velocity.Z}
		for i := range value {
			value[i] += center[i]
			if !finite(value[i]) {
				return [6]float64{}, errors.New("nonfinite DE440 center-chain state")
			}
		}
		cache[target] = value
		return value, nil
	}
	stateAt := func(ctx context.Context, id int, elapsed float64) ([6]float64, error) {
		if err := ctx.Err(); err != nil {
			return [6]float64{}, err
		}
		if !finite(elapsed) || elapsed < start || elapsed > end {
			return [6]float64{}, errors.New("dynamics epoch outside frozen source window")
		}
		high, low := splitEpochOffset(referenceET, referenceResidual, elapsed)
		if !finite(high) || !finite(low) || !splitEpochWithin(high, low, de440StartET, de440EndET) {
			return [6]float64{}, errors.New("split dynamics epoch outside pinned coverage")
		}
		if !cacheEpochValid || high != cachedHigh || low != cachedLow {
			clear(cache)
			cache[0] = [6]float64{}
			cachedHigh, cachedLow = high, low
			cacheEpochValid = true
		}
		clear(visiting)
		resolveContext, resolveHigh, resolveLow = ctx, high, low
		return resolve(id)
	}
	ephemeris := PrescribedEphemeris{Frame: "J2000", Origin: "SSB", TimeScale: "TDB", Aberration: "NONE", ReferenceEpochTDB: options.ReferenceEpochTDB, ElapsedRangeSeconds: options.ElapsedRangeSeconds,
		Source: "de440s-2000-01-01-2051-01-01 SHA-256 " + de440Hash,
		Positions: func(ctx context.Context, elapsed float64, requested []int, out []float64) error {
			if len(requested) != len(ids) || len(out) != 3*len(ids) {
				return errors.New("DE440 force selection mismatch")
			}
			for i, id := range ids {
				if requested[i] != id {
					return errors.New("DE440 force order mismatch")
				}
				state, err := stateAt(ctx, id, elapsed)
				if err != nil {
					return err
				}
				copy(out[3*i:3*i+3], state[:3])
			}
			return nil
		}}
	derivative, evidence, err := PointMassGravity(masses, ephemeris)
	if err != nil {
		return nil, err
	}
	model := evidence.Model
	limitations := []string{"Fixed force parameters and prescribed mass trajectories; no harmonics, spin or test-particle back-reaction.", "Exclusion checks occur at force evaluations, not continuous collision detection.", "This restricted model does not establish full SBDB orbit-fit equivalence, physical uncertainty or event probabilities."}
	sunState := func(ctx context.Context, elapsed float64) ([6]float64, error) { return stateAt(ctx, 10, elapsed) }
	var relativity *SolarRelativityEvidence
	if options.SolarRelativity {
		derivative, err = WithSolarRelativity(derivative, sunState, masses[0].GMKm3PerSecond2)
		if err != nil {
			return nil, err
		}
		model = "restricted-newtonian-plus-solar-1pn"
		relativity = &SolarRelativityEvidence{Model: "solar-monopole-1pn", SpeedOfLightKmPerSecond: solarLightSpeed, MaxExpansionParameter: maxSolarExpansion, Approximation: solarApproximation, Reference: "https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_all.pdf"}
		limitations = append(limitations, solarApproximation, "No planetary or mixed relativistic terms.")
	} else {
		limitations = append(limitations, "No relativistic forces.")
	}
	if radiation != nil {
		derivative, err = WithSolarRadiationPressure(derivative, sunState, *radiation)
		if err != nil {
			return nil, err
		}
		if options.SolarRelativity {
			model = "restricted-newtonian-plus-solar-1pn-and-radial-srp"
		} else {
			model = "restricted-newtonian-plus-radial-srp"
		}
		limitations = append(limitations, radiationLimitation, "Imported force-parameter sources are declarations, not independent authentication.")
	} else {
		limitations = append(limitations, "No non-gravitational forces.")
	}
	for _, elapsed := range []float64{start, end} {
		for _, id := range ids {
			if _, err := stateAt(ctx, id, elapsed); err != nil {
				return nil, err
			}
		}
	}
	evidence.Limitations = append(evidence.Limitations, "Non-lunar satellites are represented by their system barycenters; this restricted model is not the DE440 or Horizons orbit-fit force model.")
	return &DE440Dynamics{Derivative: derivative, State: stateAt, Evidence: DE440Evidence{Model: model, SolarRelativity: relativity, SolarRadiationPressure: radiation, Limitations: limitations, Gravity: *evidence, KernelSHA256: de440Hash, GMSHA256: de440GMHash, KernelID: "de440s-2000-01-01-2051-01-01", KernelBytes: 5558272,
		KernelSource: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp", KernelSourceBytes: de440SourceBytes, KernelSourceMD5: de440SourceMD5, KernelSourceLastModified: de440SourceLastModified, KernelDerivation: de440Derivation, GMSource: de440GMSource,
		Representation: "Sun; separate Earth and Moon; other planetary systems as single barycentric point masses"}}, nil
}
