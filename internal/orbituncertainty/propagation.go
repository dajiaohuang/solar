package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

type RelativeEpoch struct {
	ReferenceEpochTDB float64 `json:"referenceEpochTdb"`
	ElapsedTDBSeconds float64 `json:"elapsedTdbSeconds"`
}

type PropagatedCoordinates struct {
	Frame          string        `json:"frame"`
	Labels         []string      `json:"labels"`
	Units          []*string     `json:"units"`
	Epoch          RelativeEpoch `json:"epoch"`
	Nominal        []float64     `json:"nominal"`
	Matrix         [][]float64   `json:"matrix"`
	SquareRoot     [][]float64   `json:"squareRoot"`
	MarginalSigmas []float64     `json:"marginalSigmas"`
}

type Propagation struct {
	Method                  string                `json:"method"`
	MatrixArithmetic        string                `json:"matrixArithmetic"`
	Inspection              *Inspection           `json:"inspection"`
	InitialCoordinates      *Coordinates          `json:"initialCoordinates"`
	InitialBarycentricState []float64             `json:"initialStateKmKmPerSecond"`
	ForceModel              DE440Evidence         `json:"forceModel"`
	Integration             *IntegrationResult    `json:"integration"`
	TransitionLayout        string                `json:"transitionLayout"`
	FinalCoordinates        PropagatedCoordinates `json:"finalCoordinates"`
	Refinement              *CovarianceRefinement `json:"refinement"`
	Limitations             []string              `json:"limitations"`
}

type CovarianceRefinement struct {
	Integration                     *IntegrationResult    `json:"integration"`
	FinalCoordinates                PropagatedCoordinates `json:"finalCoordinates"`
	MarginalSigmaAbsoluteDifference []float64             `json:"marginalSigmaAbsoluteDifference"`
	Limitation                      string                `json:"limitation"`
}

// PropagateCovariance owns and audits the source, constructs its own pinned
// force model and integrates the six-state and transition matrix together.
// Sources with additional estimated covariance axes remain explicitly unsupported:
// they cannot be discarded or implicitly treated as fixed parameters.
func PropagateCovariance(ctx context.Context, original []byte, options DE440Options, durationSeconds float64) (*Propagation, error) {
	return PropagateCovarianceWithRefinement(ctx, original, options, durationSeconds, false)
}

// Both integrations share the caller deadline and frozen sources. Refinement
// has its own bounded attempt budget and never substitutes for physical error.
func PropagateCovarianceWithRefinement(ctx context.Context, original []byte, options DE440Options, durationSeconds float64, compareRefinement bool) (*Propagation, error) {
	if !finite(durationSeconds) || math.Abs(durationSeconds) > 365*86400 {
		return nil, errors.New("covariance propagation duration must be within 365 days")
	}
	inspection, err := Inspect(ctx, original)
	if err != nil {
		return nil, err
	}
	source := &inspection.Source
	if len(source.Labels) != 6 || len(source.AdditionalParameters) != 0 {
		return nil, errors.New("propagation requires matched derivatives for every additional estimated covariance parameter; no axes may be dropped")
	}
	if source.SolutionEpochTDB != options.ReferenceEpochTDB {
		return nil, errors.New("dynamics must begin at covariance solution epoch")
	}
	if durationSeconds < options.ElapsedRangeSeconds[0] || durationSeconds > options.ElapsedRangeSeconds[1] {
		return nil, errors.New("propagation endpoint outside frozen force window")
	}
	root, err := covarianceRoot(ctx, source)
	if err != nil {
		return nil, err
	}
	dynamics, err := NewDE440Dynamics(ctx, options)
	if err != nil {
		return nil, err
	}
	const au, day = 149597870.7, 86400.0
	solar := dynamics.Evidence.Gravity.Masses[0] // Pinned mass plan starts with Sun.
	initial, err := atSolutionEpoch(ctx, source, AdoptedSolarGM{AU3PerDay2: solar.GMKm3PerSecond2 * day * day / (au * au * au), Source: solar.GMSource})
	if err != nil {
		return nil, err
	}
	// NAIF ECLIPJ2000 -> J2000. Each block applies the appropriate length/time
	// scale; deterministic origin translation contributes no extra covariance.
	angle := 84381.448 / 3600 * math.Pi / 180
	s, c := math.Sincos(angle)
	rotation := [3][3]float64{{1, 0, 0}, {0, c, -s}, {0, s, c}}
	transform, inverse := square(6), square(6)
	for i := 0; i < 6; i++ {
		for j := 0; j < 6; j++ {
			if i/3 != j/3 {
				continue
			}
			scale := au
			if i >= 3 {
				scale /= day
			}
			transform[i][j] = rotation[i%3][j%3] * scale
			inverse[i][j] = rotation[j%3][i%3] / scale
		}
	}
	mappedRoot, err := matrixProduct(ctx, initial.Jacobian, root)
	if err != nil {
		return nil, err
	}
	initialRoot, err := matrixProduct(ctx, transform, mappedRoot)
	if err != nil {
		return nil, err
	}
	sun, err := dynamics.State(ctx, 10, 0)
	if err != nil {
		return nil, err
	}
	state := make([]float64, 6)
	for i := range state {
		mapped, ok := compensatedDot(transform[i], initial.Nominal)
		if !ok {
			return nil, errors.New("initial coordinate transform exceeds numerical range")
		}
		state[i] = mapped
		state[i] += sun[i]
		if !finite(state[i]) {
			return nil, errors.New("initial barycentric state exceeds numerical range")
		}
	}
	augmented, err := WithIdentityTransition(state)
	if err != nil {
		return nil, err
	}
	absolute := make([]float64, 42)
	for i := range absolute {
		absolute[i] = 1e-12
		if i < 3 {
			absolute[i] = 1e-5
		}
	}
	integration, err := Integrate(ctx, IntegrationOptions{Initial: augmented, Duration: durationSeconds, Derivative: dynamics.Derivative,
		AbsoluteTolerance: absolute, RelativeTolerance: 1e-12, InitialStep: 3600, MaxStep: 86400, MaxAttempts: 20000})
	if err != nil {
		return nil, err
	}
	project := func(integration *IntegrationResult) (PropagatedCoordinates, error) {
		phi := square(6)
		for i := range phi {
			copy(phi[i], integration.State[6+i*6:6+(i+1)*6])
		}
		evolvedRoot, err := matrixProduct(ctx, phi, initialRoot)
		if err != nil {
			return PropagatedCoordinates{}, err
		}
		finalRoot, err := matrixProduct(ctx, inverse, evolvedRoot)
		if err != nil {
			return PropagatedCoordinates{}, err
		}
		finalSun, err := dynamics.State(ctx, 10, durationSeconds)
		if err != nil {
			return PropagatedCoordinates{}, err
		}
		heliocentric := make([]float64, 6)
		for i := range heliocentric {
			heliocentric[i] = integration.State[i] - finalSun[i]
			if !finite(heliocentric[i]) {
				return PropagatedCoordinates{}, errors.New("nonfinite final heliocentric state")
			}
		}
		nominal, sigmas, matrix := make([]float64, 6), make([]float64, 6), square(6)
		for i := 0; i < 6; i++ {
			if err := ctx.Err(); err != nil {
				return PropagatedCoordinates{}, err
			}
			var ok bool
			nominal[i], ok = compensatedDot(inverse[i], heliocentric)
			if !ok || !finite(nominal[i]) {
				return PropagatedCoordinates{}, errors.New("nonfinite final heliocentric state")
			}
			for j := i; j < 6; j++ {
				value, ok := compensatedDot(finalRoot[i], finalRoot[j])
				if !ok {
					return PropagatedCoordinates{}, errors.New("propagated covariance exceeds numerical range")
				}
				matrix[i][j], matrix[j][i] = value, value
			}
			sigmas[i] = math.Sqrt(matrix[i][i])
		}
		return PropagatedCoordinates{Frame: source.Frame, Labels: append([]string(nil), initial.Labels...), Units: append([]*string(nil), initial.Units...),
			Epoch: RelativeEpoch{source.SolutionEpochTDB, durationSeconds}, Nominal: nominal, Matrix: matrix, SquareRoot: finalRoot, MarginalSigmas: sigmas}, nil
	}
	final, err := project(integration)
	if err != nil {
		return nil, err
	}
	var refinement *CovarianceRefinement
	if compareRefinement {
		refinedAbsolute := append([]float64(nil), absolute...)
		for i := range refinedAbsolute {
			refinedAbsolute[i] /= 10
		}
		refined, err := Integrate(ctx, IntegrationOptions{Initial: augmented, Duration: durationSeconds, Derivative: dynamics.Derivative,
			AbsoluteTolerance: refinedAbsolute, RelativeTolerance: 1e-13, InitialStep: 1800, MaxStep: 43200, MaxAttempts: 20000})
		if err != nil {
			return nil, err
		}
		coordinates, err := project(refined)
		if err != nil {
			return nil, err
		}
		difference := make([]float64, 6)
		for i := range difference {
			difference[i] = math.Abs(coordinates.MarginalSigmas[i] - final.MarginalSigmas[i])
			if !finite(difference[i]) {
				return nil, errors.New("nonfinite covariance refinement comparison")
			}
		}
		refinement = &CovarianceRefinement{Integration: refined, FinalCoordinates: coordinates, MarginalSigmaAbsoluteDifference: difference,
			Limitation: "Same source and force model with tighter integration settings; differences are not a global error bound, independent validation or physical uncertainty. Zero-duration agreement supplies no integration-convergence evidence."}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &Propagation{Method: "first-order-variational-square-root-pushforward", MatrixArithmetic: "neumaier-compensated-f64-dot-v1", Inspection: inspection, InitialCoordinates: initial,
		InitialBarycentricState: state, ForceModel: dynamics.Evidence, Integration: integration,
		TransitionLayout: "integration.state[0:6]: J2000 SSB km, km/s; [6:42]: row-major d(final state)/d(initial state)",
		FinalCoordinates: final, Refinement: refinement,
		Limitations: []string{
			"Conditional six-parameter first-order covariance under an explicitly adopted restricted force model.",
			"Fixed DE440 masses, trajectories, solar GM and any adopted SRP parameters; their uncertainty is not propagated.",
			"Not the complete SBDB orbit-fit model: model mismatch, source ephemeris errors and additional fitted or considered dynamical effects are not covered.",
			"Gaussian linearization, not a nonlinear ensemble, event probability or physical accuracy guarantee.",
			"Final epoch retains reference JD and elapsed seconds separately; no rounded absolute JD is substituted.",
			"Endpoint result only; no dense output, continuous event search or trajectory history is supplied. Optional numerical refinement is a same-model comparison, not independent validation.",
		}}, nil
}

// Factor the dimensionless correlation first, keeping source-unit scaling
// separate. Positive-definite input is required; no jitter/clipping is applied.
func covarianceRoot(ctx context.Context, source *Source) ([][]float64, error) {
	if !source.PositiveDefinite {
		return nil, errors.New("covariance propagation currently requires positive definite source covariance without repair")
	}
	n := len(source.Labels)
	lower, root := square(n), square(n)
	for i := 0; i < n; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for j := 0; j <= i; j++ {
			dot, ok := compensatedDot(lower[i][:j], lower[j][:j])
			if !ok {
				return nil, errors.New("covariance factorization exceeds numerical range")
			}
			value := source.Correlation[i][j] - dot
			if i == j {
				if !finite(value) || value <= 0 {
					return nil, errors.New("covariance factorization is not positive definite")
				}
				lower[i][j] = math.Sqrt(value)
			} else {
				lower[i][j] = value / lower[j][j]
			}
			root[i][j] = lower[i][j] * source.MarginalSigmas[i]
			if !finite(lower[i][j]) || !finite(root[i][j]) {
				return nil, errors.New("nonfinite covariance factor")
			}
		}
	}
	return root, nil
}

// Internal square-matrix product: callers establish bounded equal dimensions.
func matrixProduct(ctx context.Context, a, b [][]float64) ([][]float64, error) {
	n := len(a)
	result := square(n)
	columns := square(n)
	for row := 0; row < n; row++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for column := 0; column < n; column++ {
			columns[column][row] = b[row][column]
		}
	}
	for i := 0; i < n; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for j := 0; j < n; j++ {
			value, ok := compensatedDot(a[i], columns[j])
			if !ok {
				return nil, errors.New("nonfinite covariance matrix product")
			}
			result[i][j] = value
		}
	}
	return result, nil
}

func compensatedDot(a, b []float64) (float64, bool) {
	if len(a) != len(b) {
		return 0, false
	}
	sum, correction := 0.0, 0.0
	for i, left := range a {
		term := left * b[i]
		if !finite(term) {
			return 0, false
		}
		next := sum + term
		if math.Abs(sum) >= math.Abs(term) {
			correction += (sum - next) + term
		} else {
			correction += (term - next) + sum
		}
		sum = next
		if !finite(sum) || !finite(correction) {
			return 0, false
		}
	}
	value := sum + correction
	return value, finite(value)
}
