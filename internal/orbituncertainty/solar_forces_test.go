package orbituncertainty

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"
)

type solarReferenceFixture struct {
	Initial []float64 `json:"initial"`
	Masses  []struct {
		GM float64 `json:"gmKm3PerSecond2"`
	} `json:"masses"`
	SourceStates []struct {
		States [][]float64 `json:"states"`
	} `json:"sourceStates"`
	SolarRelativity struct {
		Acceleration []float64   `json:"acceleration"`
		Jacobian     [][]float64 `json:"jacobian"`
	} `json:"solarRelativity"`
}

func readSolarReference(t *testing.T) solarReferenceFixture {
	t.Helper()
	data, err := os.ReadFile("../../tests/fixtures/de440-solar-1pn-reference.json")
	if err != nil {
		t.Fatalf("read 1PN reference fixture: %v", err)
	}
	var fixture solarReferenceFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode 1PN reference fixture: %v", err)
	}
	if len(fixture.Initial) != 6 || len(fixture.Masses) == 0 || len(fixture.SourceStates) == 0 || len(fixture.SourceStates[0].States) == 0 {
		t.Fatal("1PN reference fixture is incomplete")
	}
	return fixture
}

func zeroDerivative(_ context.Context, _ float64, _ []float64, output []float64) error {
	clear(output)
	return nil
}

func TestSolarRelativityMatchesIndependentAccelerationAndJacobianReference(t *testing.T) {
	fixture := readSolarReference(t)
	sunState := fixture.SourceStates[0].States[0]
	if len(sunState) != 6 || len(fixture.SolarRelativity.Acceleration) != 3 || len(fixture.SolarRelativity.Jacobian) != 3 {
		t.Fatal("1PN reference fixture has invalid force dimensions")
	}
	var sun [6]float64
	copy(sun[:], sunState)
	force, err := WithSolarRelativity(zeroDerivative, func(context.Context, float64) ([6]float64, error) { return sun, nil }, fixture.Masses[0].GM)
	if err != nil {
		t.Fatal(err)
	}
	state := make([]float64, 42)
	copy(state, fixture.Initial)
	for i := 0; i < 6; i++ {
		state[6+i*6+i] = 1
	}
	output := make([]float64, 42)
	if err := force(context.Background(), 0, state, output); err != nil {
		t.Fatal(err)
	}
	for row := 0; row < 3; row++ {
		wantAcceleration := fixture.SolarRelativity.Acceleration[row]
		if relativeError(output[row+3], wantAcceleration) > 1e-13 {
			t.Errorf("acceleration[%d] = %.17g, reference %.17g", row, output[row+3], wantAcceleration)
		}
		if len(fixture.SolarRelativity.Jacobian[row]) != 6 {
			t.Fatalf("1PN reference Jacobian row %d has invalid dimensions", row)
		}
		for column, want := range fixture.SolarRelativity.Jacobian[row] {
			got := output[6+(row+3)*6+column]
			if relativeError(got, want) > 1e-12 {
				t.Errorf("Jacobian[%d,%d] = %.17g, reference %.17g", row, column, got, want)
			}
		}
	}
}

func TestSolarRadiationPressureSIConversionAndFiniteDifferenceJacobian(t *testing.T) {
	const au = radiationAU
	parameters := RadiationPressure{
		Model: "constant-radial-srp", Illumination: "unshadowed",
		PressureAt1AuNewtonPerSquareMeter: 4.56e-6,
		AreaSquareMeters:                  20,
		MassKg:                            1000,
		ReflectivityCoefficient:           1.5,
		Source:                            "Explicit test parameters, not an observed spacecraft",
	}
	force, err := WithSolarRadiationPressure(zeroDerivative, func(context.Context, float64) ([6]float64, error) { return [6]float64{}, nil }, parameters)
	if err != nil {
		t.Fatal(err)
	}
	state := make([]float64, 42)
	state[0], state[1], state[2] = 0.7*au, -1.1*au, 0.4*au
	for i := 0; i < 6; i++ {
		state[6+i*6+i] = 1
	}
	output := make([]float64, 42)
	if err := force(context.Background(), 0, state, output); err != nil {
		t.Fatal(err)
	}
	// Independent vector expression performs the SI conversion before returning km/s^2.
	referenceAcceleration := func(position [3]float64) [3]float64 {
		radius := math.Hypot(math.Hypot(position[0], position[1]), position[2])
		magnitude := 4.56e-6 * 20 * 1.5 / 1000 * math.Pow(149597870700/(radius*1000), 2) / 1000
		return [3]float64{magnitude * position[0] / radius, magnitude * position[1] / radius, magnitude * position[2] / radius}
	}
	position := [3]float64{state[0], state[1], state[2]}
	wantAtOneAU := 1.368e-10 / math.Pow(math.Hypot(math.Hypot(position[0], position[1]), position[2])/au, 2)
	actualMagnitude := math.Hypot(math.Hypot(output[3], output[4]), output[5])
	if relativeError(actualMagnitude, wantAtOneAU) > 1e-14 {
		t.Errorf("SRP magnitude = %.17g km/s^2, want %.17g", actualMagnitude, wantAtOneAU)
	}
	const stepKm = 100.0
	var jacobian [3][3]float64
	for column := 0; column < 3; column++ {
		plus, minus := position, position
		plus[column] += stepKm
		minus[column] -= stepKm
		a, b := referenceAcceleration(plus), referenceAcceleration(minus)
		for row := 0; row < 3; row++ {
			jacobian[row][column] = (a[row] - b[row]) / (2 * stepKm)
		}
	}
	for row := 0; row < 3; row++ {
		for column := 0; column < 6; column++ {
			var want float64
			if column < 3 {
				want = jacobian[row][column]
			}
			got := output[6+(row+3)*6+column]
			if math.Abs(got-want) > 2e-27 {
				t.Errorf("SRP STM derivative[%d,%d] = %.17g, finite difference %.17g", row, column, got, want)
			}
		}
	}
}

func relativeError(got, want float64) float64 {
	if want == 0 {
		return math.Abs(got)
	}
	return math.Abs(got/want - 1)
}
