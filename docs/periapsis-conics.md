# Periapsis conic propagation

The calculation module src/engine/ephemeris/conicPeriapsis.ts accepts periapsis
distance in km, eccentricity, central GM in km^3/s^2, orientation in radians
and elapsed TDB seconds from periapsis. It returns position and velocity in the
input inertial orientation. It has no implicit Sun GM, epoch or frame choice.
The module supports elliptic, parabolic and hyperbolic two-body trajectories;
the evidence workspace now supports a captured Borisov example and local SBDB JSON imports.

With x = chi/sqrt(q), beta = 1-e, tau = dt*sqrt(mu/q^3), it solves
x + e*x^3*S(beta*x^2) = tau using a bracketed Newton iteration. The derivative
is r/q = 1 + e*x^2*C(beta*x^2). Stumpff functions use a series near zero; no
division by 1-e is needed at e=1. Elliptic times reduce by the period and
negative elapsed times retain their sign. Output rotation uses the standard
ascending-node, inclination and periapsis angles. Nonfinite, unrepresentable
or nonconverged results fail explicitly.

The checked-in independent oracle uses [NAIF CSPICE conics](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html)
through SpiceyPy 8.2.0. It needs no kernels: all 49 input cases are explicitly
synthetic mathematical elements (eccentricities 0, 0.8, 0.999999, 1, 1.000001,
1.5 and 3; elapsed times +/-1000, +/-100, +/-0.001 and 0 days). State comparisons
use relative vector error <2e-12 and independently check Kepler energy. An
analytic Barker D=1 parabola checks the exact parabolic branch separately.
This numerical agreement is not a physical comet accuracy claim.

Regenerate a separate reference with:

~~~powershell
rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-periapsis-conics.py --output .cache/new-conics-reference.json
~~~

Run only the relevant cases with:

~~~powershell
rtk proxy npx vitest run tests/unit/periapsis-conics.test.ts
~~~

Pending: broader original comet coverage, main catalog/scene integration,
realistic perturbed comet references, non-gravitational forces and uncertainty. Two-body conics must remain distinguishable from
authoritative SPK evaluations. Tested time/eccentricity ranges are evidence,
not certification for arbitrary finite inputs or long-term physical prediction.

## Source-backed Borisov import

The bounded decoder src/data/loaders/sbdbConic.ts now accepts full-precision
JPL SBDB API 1.3 J2000 osculating conics, including e >= 1. A real 2I query
returned C/2019 Q4 (Borisov), solution 54, e=3.356475782676596 and
q=2.006520878500843 au. Original response bytes and retrieval URL/time/hash are
committed under tests/fixtures/sbdb-borisov-20260923. The importer verifies
version, source, solution identity, duplicate fields, units and finite ranges.

The [SBDB API contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) defines
heliocentric ecliptic J2000 osculating elements and TDB epoch/perihelion times.
Day integers and decimal fractions are retained separately to avoid losing
sub-day precision when subtracting two large Julian dates. Convenience scalar
JD fields are rounded binary64 values; propagation should use the split fields.
The original text remains available in the owned raw response.

Borisov's source fit includes A1/A2/A3 and other non-gravitational parameters.
They are retained without claiming they are integrated. Source validity bounds
remain in their original form, and callers must enforce them when providing a
propagation interface. The importer supplies no inferred GM: an explicit sourced
GM is required by the calculation module. The evidence-workspace experiment uses a checksum-verified DE440 solar GM.
Independent comparison to the real fitted trajectory remains pending.

## Browser experiment and adopted GM

Open the Conic orbit laboratory in the evidence workspace, load the real
Borisov source or choose a local SBDB JSON, enter a decimal TDB Julian day and
compute. Input changes invalidate earlier output. The JSON export includes
original source data, split target/periapsis times, source hashes, adopted GM,
position/velocity and all omitted source fit parameters. The adopted GM comes
from checksum-pinned gm_de440.tpc; no SPK download is required for this two-body
experiment. It is not claimed to be the GM used by the imported fit.

Five Borisov states at the source osculation epoch and +/-100/1000 days were
independently computed with CSPICE using the same adopted GM. Six focused
checks cover those states, altered GM bytes and unsupported UTC validity bounds.
Four browser profiles validate display, export against that oracle, no horizontal
overflow and stale-result clearing. Screenshot inspection includes mobile
emulation. These compare two-body calculations from real source elements, not
the full JPL fitted trajectory or observational residuals. Source validity
bounds with non-null UTC values currently cause an explicit refusal.
