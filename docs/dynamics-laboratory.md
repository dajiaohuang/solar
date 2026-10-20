# Dynamics laboratory: numerical foundation

This workstream is incomplete. A bounded adaptive integrator, restricted
Newtonian force/variational evaluator, optional solar 1PN correction and browser
experiment panel exist. The explicit constant radial solar radiation pressure
term has focused force/Jacobian checks, and solar 1PN has focused acceleration,
Jacobian and selected DE440 trajectory references. Other non-gravitational terms
and complete joint covariance propagation remain absent. These experiments do
not replace authoritative SPK states or reproduce a source orbit-fit model.
The pinned DE440 adapter and offline experiment command are now implemented.

The three browser dynamics panels share one worker lifecycle: manual integration,
conditional covariance and nonlinear ensembles. Each request has a 300-second
main-thread resource deadline covering worker startup, source retrieval and
computation. Cancellation, unmount, terminal result/error, decoding failure and
deadline expiry detach handlers, clear the timer and terminate the worker. The
UI explains the deadline; offline commands retain their existing signal and
evaluation-budget behavior. Parent covariance panels are keyed by source hash,
and callbacks also require the current job identity before publishing results.
The shared request contract rejects unsupported kinds, incorrectly typed adoption
flags and sampling options outside ensemble requests. Before transfer, the main
thread hashes an owned copy of the bounded input file. Results must match that
hash and byte count, requested calculation, elapsed duration, force coordinates,
model identifier, relativity/SRP adoption, eleven-mass plan and exclusion distance,
refinement adoption and ensemble count/seed. Covariance coordinate and integration
epochs must agree. Cancellation and the deadline remain active while awaiting
the digest; duplicate completion messages cannot publish another result.
This binds the result to its request; it is not an independent numerical check,
full receipt-schema validation or authentication of an imported source declaration.
Lifecycle and binding behavior have only been inspected in source under the
testing hold.

## Explicit numerical contract

### Optional solar radiation pressure (narrow numerical checks)

Manual initial-condition JSON may contain `solarRadiationPressure` with exactly
the fields below. Omitting the whole object preserves gravitational-only behavior.
Null, missing parameters and unknown nested fields are rejected. There are no
default physical parameter values and no automatic adoption of SBDB A1/A2.

| Field | Required value or units |
| --- | --- |
| `model` | `constant-radial-srp` |
| `illumination` | `unshadowed` |
| `pressureAt1AuNewtonPerSquareMeter` | Positive finite pressure in N/m² at 1 AU |
| `areaSquareMeters` | Positive finite constant effective illuminated area in m² |
| `massKg` | Positive finite constant mass in kg |
| `reflectivityCoefficient` | Positive finite constant optical coefficient |
| `source` | Nonempty provenance for all parameter choices, at most 8192 UTF-8 bytes |

The browser displays all imported parameters and requires their adoption before
running. The offline command additionally requires
`--adopt-solar-radiation-pressure`; passing parameters without this flag, or the
flag without parameters, is rejected. Solar 1PN can be adopted independently.
The export retains original input bytes' hash, model parameters, formula and
limitations. The offline implementation hashes include the new force module.

The outward radial inverse-square model follows the solar radiation pressure
form documented by [LLNL SSAPy](https://software.llnl.gov/SSAPy/api/ssapy.accel.AccelSolRad.html)
and its [force implementation](https://raw.githubusercontent.com/LLNL/SSAPy/main/ssapy/accel.py).
For Sun-relative distance `r` and outward unit vector `u`, this implementation
uses `a = (P Cr A / m) (AU/r)^2 u / 1000` in km/s², with AU = 149597870.7 km.
Its analytic position Jacobian is `(|a|/r) (I - 3 u uᵀ)`; the velocity Jacobian
is zero. The same pinned Sun ephemeris is shared with the gravitational forces.
The six-state transition matrix keeps these parameters and the Sun fixed.

This implementation deliberately models continuous illumination: it does not
include eclipse shadows, changing attitude, solar variability, thermal recoil,
outgassing or parameter uncertainty. Imported source declarations are not
authenticated. The covariance/ensemble worker does not adopt this manual force
extension. Previous Eros gravity reference comparisons do not validate SRP.
On 2026-09-25, the focused `solar-relativity`,
`solar-radiation-pressure` and `de440-radiation-pressure` unit files passed
15/15. They cover complex-step acceleration/Jacobian references, selected
CSPICE/DOP853 trajectories, SI-to-km and inverse-square SRP behavior, a separate
finite-difference position Jacobian, and force composition/evidence. They do not
validate shadowing, real spacecraft properties, long-duration physical accuracy,
native delivery or performance; no capacity or FPS claim follows from these
checks.

### Integrator

Each experiment copies its initial six-state and force-model evidence and captures
the derivative/state evaluators before its first asynchronous yield. The primary
and optional refined integrations start from the same owned state. Trajectory
sampling and final epoch metadata use the captured provider, not later caller
edits. Initial-condition parsing also copies the complete source record and
keeps its returned state array separate from the record used for provenance.
Covariance propagation captures the provider before both initial and final Sun
translations. These ownership changes have only been source-reviewed under the
validation hold; asynchronous mutation behavior has not yet been exercised.

`integrateAdaptive` uses the Dormand–Prince embedded 5(4) pair, with a maximum
component error ratio rather than an RMS error. The caller supplies every
component's positive absolute tolerance, a relative tolerance, positive initial
and maximum steps, and a finite attempt budget. Elapsed time starts at zero;
the reference Julian date stays outside the integrator. Forward/backward steps
land on the requested endpoint. State and elapsed-time accumulation use
compensated summation. The accepted endpoint derivative is reused (FSAL).

The dimension is limited to 512 and attempts to 200,000. Every 32 attempts the
routine yields to the event loop, checking cancellation before subsequent force
evaluations. Buffers are reused. Missing/nonfinite derivatives, time-resolution
failure or an exhausted budget throw instead of returning a partial solution as
complete. The return value contains the final state and numerical diagnostics;
an optional observer receives owned accepted endpoints. Dense output, event
detection and long-term symplectic behavior are not implemented.
Tolerance controls a local numerical estimate, not a global error bound or
physical orbit uncertainty. See [SciPy's method and tolerance description](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html).

## Cometary Marsden forces and the fitted time shift

The current experiment engine does not implement the SBDB/Horizons comet
non-gravitational force model. Its six-state and transition-matrix results
must not be described as a propagation of comet `A1/A2/A3/DT` covariance.
The source model has three components in the instantaneous radial, transverse
and orbit-normal directions,

`a_NG(t) = (A1 Rhat(t) + A2 That(t) + A3 Nhat(t)) g(r(t - DT))`,

where `A1/A2/A3` are accelerations in `au/d^2`, `r` is Sun-relative distance,
and the Marsden activity law is

`g(r) = ALN (r/R0)^(-NM) [1 + (r/R0)^NN]^(-NK)`.

The activity factor is normalized so `g(1 au) = 1` for the usual water-ice
constants. For the frozen Borisov solution, `ALN=1`, `R0=1 au`, `NM=2`,
`NN=0`, and `NK=0`, so the scalar law simplifies to `(1 au/r)^2` at the shifted
distance. Its fitted `DT=-65.1301 d` places the nominal activity maximum about
65 days before perihelion: the asymmetric model uses `r(t-DT)`, and its peak
occurs near `t = t_perihelion + DT`. A positive `DT`, such as the source 67P
solution's `+45.6667 d`, moves that maximum after perihelion.

This time shift changes the integration problem. Positive `DT` reads the
previous trajectory and needs a history/interpolation contract. Negative
`DT` reads the future trajectory during forward integration, so it cannot be
evaluated by the current initial-value integrator as an ordinary stage-local
force. A global boundary-value or iterated trajectory solution, including
parameter sensitivities, needs an independent reference before it can support
joint event distributions. Source matching also requires more than adding the
formula: the inspected comet fits name planetary ephemeris `DE441` and
small-body perturber ephemeris `SB441-N16`. The ephemeris manifests include a
DE441 satellite kernel and all 16 cropped `SB441-N16` asteroid targets declared
by the upstream source, but their core planetary kernel is `DE440s`; the dynamics experiment pins DE440 and its
restricted 11-mass force plan and does not compose those additional assets into
that force model. The archived Borisov Horizons SPK is a fitted trajectory, not
a callable source-force model. These differences are why the current path fails
closed for fitted extra axes. Sources: [JPL Horizons non-gravitational model
definition](https://ssd.jpl.nasa.gov/horizons/manual.html), [Królikowska
(2003), §§2–3](https://acta.astrouw.edu.pl/Vol53/n2/pap_53_2_7.pdf).

## Prescribed Newtonian masses

`createPointMassGravity` requires explicit GM values with source labels,
close-approach exclusion distances, prescribed source coverage and a geometric
J2000/SSB/TDB coordinate contract. Every requested source position must be
returned at every force epoch; no extrapolation or approximate fallback is
supplied. [SPICE distinguishes these geometric states from apparent states](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html).

The six-state derivative sums Newtonian point-mass accelerations. With an
additional row-major 6x6 matrix, it also integrates the first-order transition
equation using the analytic acceleration gradient. The source masses are
prescribed and do not react to the test particle. GM values and source orbits
are fixed. System barycenters must not be combined with their constituent
masses. The pinned DE440 adapter enforces one non-overlapping selection.
Its byte-pinned GM table parser requires exactly one assignment per force ID
and rejects exclusions for IDs outside that selection.
This base evaluator excludes relativity, harmonics and non-gravitational effects;
the separately adopted solar 1PN wrapper is described below. In particular,
this 6x6 transition matrix must not discard Bennu's RHO/AMRAT axes or be labeled
as propagation of its complete eight-axis fitted covariance.

## Independent numerical evidence

[The reference generator](../scripts/reference-dynamics.py) retains two kinds
of evidence in [the pinned fixture](../tests/fixtures/dynamics-reference.json):

- mpmath 1.3.0, 70-digit universal-variable Kepler f/g propagation differentiated
  with respect to all six Cartesian initial components, for forward and backward
  full-period eccentricity-0.9 examples.
- SciPy 1.16.1 DOP853 integration for a synthetic prescribed moving perturber;
  the eccentric DOP853 outputs are also retained for comparison.

All are synthetic mathematical examples, not observed or SPK-fitted trajectories.
Inputs use identical Float64-rounded values. The first DOP853-only comparison
exposed cancellation-sensitive transition entries: for one nominally near-zero
entry, DOP853 returned about `-5.75e-6`, while the high-precision reference was
about `-3.74e-7`. A tighter local tolerance alone is not proof of a reliable
global reference. The independent analytic reference was added before accepting
the integrator; the comparison threshold was not loosened.

Fourteen targeted tests passed, including derivative completeness, budget and
cancellation behavior, reverse time, differently scaled components, circular
energy/angular momentum, force superposition, source gaps/exclusion boundaries,
and all 42 state/transition entries against the independent references. At
relative tolerance `1e-14` and component absolute tolerance `1e-15`, the three
reference comparisons each meet `abs(delta)/(1+abs(reference)) < 3e-7`. This is
an observed numerical agreement criterion for these test coordinates, not a
unit-independent precision promise. The model has not yet been verified against
a full source force model. The real-source restricted-model comparison below
is separate evidence. No full local suite ran.

Reproduce the immutable reference into a new file:

```sh
rtk proxy uv run --python 3.12 --with scipy==1.16.1 --with mpmath==1.3.0 python scripts/reference-dynamics.py --output .cache/dynamics-reference-new.json
```

## Pinned DE440 dynamics source and offline experiment

`createDe440Dynamics` verifies the original 5,558,272-byte packaged DE440 kernel
and GM text against fixed SHA-256 values. It takes ownership of a copy before
asynchronous hashing, so later caller mutations cannot change an experiment.
The source window is frozen, must include the initial epoch and must fit the
packaged 2000–2051 coverage. Every source state uses original J2000 segments and
their complete SSB center chains; no ECLIPJ2000 rotation or UTC conversion is
introduced. Caller-provided initial vectors must use km and km/s.

The mass plan is fixed: Sun, Mercury and Venus systems, separate Earth and Moon,
and the Mars-through-Pluto system barycenters. Earth–Moon barycenter 3 is not an
additional mass; other planetary satellites are not separately added on top of
their system GM. System point masses do not resolve close planetary-satellite
encounters. Explicit exclusion distances are numerical experiment boundaries,
not assumed physical radii. They are checked at force-evaluation instants;
continuous collision detection is not implemented.

The [CSPICE/DOP853 generator](../scripts/reference-de440-dynamics.py) reads the
same checksum-pinned original DE440 and Eros SPK files. It independently evaluates
all eleven perturbing source states in J2000/SSB, initializes Eros at TDB JD
2461234.5, and integrates six coordinates plus the 36 transition coefficients
with SciPy 1.16.1 DOP853. The [reference receipt](../tests/fixtures/de440-dynamics-reference.json)
retains source hashes, CSPICE versions, force constants, all results and
independent source-orbit states. CSPICE text-kernel parsing and JavaScript decimal
conversion differ by a few last bits in some GM values; this difference is
retained and tested within a relative `2e-15`, not hidden as bitwise identity.

Seven focused source/experiment tests passed. The real-source state comparisons
against CSPICE meet `2e-6` km and `1e-10` km/s per component. For backward 10,
forward 10 and forward 30 days, application integrations agree with DOP853 within
`1e-4` km in position norm and `3e-10` in the recorded normalized state/transition
entry metric. DOP853 refinement from relative `1e-12` to `1e-13` changed that
metric by at most `2.19e-15` in these examples.

The restricted model does **not** reproduce Eros's source-fit trajectory:
position residuals against the original SPK were 22.70 m (backward 10 days),
21.79 m (forward 10 days) and 190.50 m (forward 30 days). These are model
discrepancies for this comparison, not integration tolerances or a physical
uncertainty estimate. Missing relativistic, harmonic, small-asteroid and sourced
non-gravitational terms still need model-specific treatment and independent
validation. No empirical correction is applied to hide the residuals.

The offline CLI reads an explicit initial-condition JSON with `schemaVersion: 1`,
`frame: "J2000"`, `origin: "SSB"`, `timeScale: "TDB"`, `referenceEpochTdb`, six
`initial` coordinates in km/km/s, and an `initialSource` description. Extra source
metadata remains in the receipt. This declaration identifies the caller's input;
it does not authenticate arbitrary initial states. The command requires explicit
model adoption, signed duration within 365 days and an exclusion distance:

```sh
rtk proxy node --experimental-strip-types scripts/run-dynamics.mjs initial.json new-experiment.json --adopt-de440-point-masses --duration-seconds 2592000 --exclusion-km 1
```

Outputs are exclusive-created JSON containing original input hash/bytes/payload,
force/source evidence, implementation hashes, split reference epoch plus elapsed
TDB seconds, final state, transition matrix and numerical diagnostics. SIGINT
cancels the experiment; a failed/cancelled integration does not emit a successful
partial result. An actual local Eros 30-day run completed with 122 accepted steps
and 733 force evaluations. No source was downloaded, published or deployed.

The laboratory still needs native access, richer force models,
complete joint parameter covariance propagation, long-term diagnostics and
model-validity/physical-error evidence. This CLI does not complete those goals.

## Browser experiment panel

The Evidence page now provides the same explicit model experiment through a
dedicated Worker. Users can load the pinned Eros/CSPICE initial example, inspect
its coordinates and source identity, export it as a reusable template, or import
a bounded 2 MiB initial-condition file. Signed duration and point-mass exclusion
distance remain explicit. Changing inputs invalidates previous results.

The Worker uses the same initial-condition parser and numerical experiment
function as the CLI. It fetches the pinned 5.56 MB DE440 source with a 30-second
deadline and an exact byte cap, then checks the source hashes before integration.
Cancel/unmount/input changes terminate the owned Worker; late messages cannot
replace a newer result. Source corruption never falls back to an approximate
trajectory. Output shows the final state, reference epoch/elapsed TDB seconds,
accepted steps, force evaluations and the restricted model's limitations. JSON
exports retain the full input/source receipt, force model, transition matrix,
numerical settings and application build identity. CLI exports additionally
retain individual implementation file hashes.

Sixteen focused checks across desktop/mobile Chromium, Firefox and WebKit
passed. They exercised real original kernel bytes and the actual Worker,
compared the exported Eros result with the independent reference, verified
input-template round-trip, invalid replacement, held-request cancellation,
corrupted source rejection and Chinese duration validation. Seven targeted
source/CLI unit checks also passed after sharing the experiment function. Mobile
screenshots were inspected and a panel-width assertion guards overflow. No full
local suite ran. This is Web evidence, not native-device laboratory acceptance.

## Trajectory nodes and numerical refinement

Experiments now retain actual accepted integration nodes, including both
endpoints. A bounded recorder keeps at most 2,048 nodes, doubling its stride
when necessary. It does not interpolate missing nodes or preserve every short
encounter. Each retained node exports elapsed TDB seconds, barycentric six-state,
the prescribed Sun six-state and heliocentric position/velocity. A parallel
`acceptedStepIndices` array records its original accepted-step number (zero for
the initial state). The stride is measured in accepted steps, not elapsed time.
If adding the final endpoint would exceed capacity, it replaces the last sampled
node and that node's index. Browser and offline JSON exports retain these fields.
The three browser
projections use heliocentric J2000 coordinates and equal axis scales per panel,
with AU width, Sun/start/end markers and explicit visual-only connecting lines.

The optional refinement checkbox (CLI `--compare-refinement`) runs the same
model again with tenfold tighter component/relative tolerances and half the
initial/maximum step. Each run retains its separate 20,000-attempt bound.
The export includes refined final state/transition entries, settings, work counts
and endpoint/transition differences. This is a numerical setting comparison,
not a proof of convergence to a physical orbit, a global numerical error bound,
long-term stability or complete covariance propagation.

The following results are historical evidence from before the added Sun-state,
accepted-step-index and stricter receipt-binding changes. Those changes have only
been inspected in source; no tests or runtime checks have been run for them.
Old saved artifacts remain unchanged and may lack the added evidence fields.
The current live-worker receipt gate requires the current fields; it is not an
archival JSON importer and does not silently upgrade older artifacts.

Historically, twelve targeted integrator/recorder/CLI tests passed, covering observer isolation,
forward/backward decimation, exact endpoint retention, zero duration and refined
exports. Four browser profiles passed the real-worker trajectory/refinement
case and mobile plots were visually inspected. A real local Eros 30-day export
retained all 123 nodes (stride one). Baseline/refined work was 122/192 accepted
steps and 733/1,153 force evaluations. Endpoint differences were `1.49e-8` km
and `3.97e-15` km/s; these tiny numerical differences do not reduce the about
191 m source-orbit model discrepancy documented above. No full local suite ran.
## Optional solar first post-Newtonian term

The browser checkbox and offline `--adopt-solar-1pn` flag explicitly enable a
Sun-monopole correction. Default experiments remain Newtonian. The implementation
uses the standard test-particle Schwarzschild monopole expression, documented
for one-body Earth motion in §4.5.2 of the [JPL Deep Space Network formulation](https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_all.pdf):
`a = mu/(c² r³) [(4 mu/r - v²) r + 4 (r·v) v]`.
Here position and velocity are relative to the same pinned DE440 Sun, solar GM
comes from the verified GM kernel, and `c = 299792.458 km/s`. Both analytic
position and velocity Jacobians contribute to the 6x6 variational equations.
No REBOUNDx implementation is copied or invoked.

This is an explicitly adopted Sun-relative approximation added to barycentric
Newtonian acceleration. JPL's Solar-System-barycentric operational formulation
uses n-body relativistic perturbative terms (§4.4.1); this implementation does
not reproduce that full model or the Horizons orbit-fit model. It omits
planetary/mixed relativistic terms, solar spin, harmonics and
non-gravitational accelerations. The implementation rejects force evaluations
where either `GM/(r c²)` or `v²/c²` exceeds `1e-4`. That chosen weak-field and
slow-motion guard does not establish a truncation error bound. The existing
force-sample exclusion and coverage requirements still apply.

`scripts/reference-de440-dynamics.py --solar-1pn --output <new.json>` generates
an independent CSPICE/DOP853 reference, with complex-step differentiation of
the correction instead of copying the implementation's analytic Jacobian.
The pinned `tests/fixtures/de440-solar-1pn-reference.json` contains all 42
integrated components, source hashes, refinement comparisons and original
Eros SPK states at -10, +10 and +30 days. The respective independent model
position residuals are approximately 0.071 m, 0.069 m and 0.626 m. These
particular source-fit comparisons are not physical uncertainty or a guarantee
for other objects/epochs. The Newtonian-only references remain unchanged.

The actual local 30-day CLI experiment used 122 accepted steps / 733 force
evaluations. Its position differed from independent DOP853 by `5.16e-8 km`,
from its finer-setting run by `1.49e-8 km`, and from the original SPK by
`0.0006262555 km`. These are distinct comparisons. Runtime and total-memory
benchmarks for the new correction have not been measured.

## Instantaneous orbit diagnostics

Current source also reports elliptic apoapsis and instantaneous orbital period,
plus experiment duration divided by the initial period in the browser. The period
is `2*pi*sqrt(a)*(a/sqrt(mu))` in seconds; undefined/unrepresentable or degenerate
cases use null. [NAIF OSCLTX](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscltx_c.html)
documents elliptic-only period applicability and near-parabolic limitations.
This ratio is a timescale comparison, not a measured revolution count or stability
assessment. These additions are unverified under the current execution hold;
historical evidence below does not validate them.

`diagnostics.timescaleComparison` preserves the signed elapsed TDB seconds,
initial period, absolute-duration ratio and interpretation in browser/offline
exports. The UI uses this checked result. A nonzero ratio that overflows or
underflows is null; a defined elliptic period with zero duration yields zero.
Current live receipt checks bind this record to the reconstructed initial conic,
which does not constitute an independent numerical reference.

Conditional covariance outputs additionally include `orbitalPeriodUncertainty`
under baseline/refined endpoint coordinates. For fixed solar GM, analytic
gradients of reciprocal semimajor axis and elliptic period are projected through
the complete covariance square root. The method retains correlations following
the [first-order uncertainty propagation law](https://physics.nist.gov/cuu/Uncertainty/combination.html).
It reports formal period sigma, gradient/units/GM and a linear alpha-boundary flag.
This is unverified implementation, not a nonlinear period distribution, return-time
prediction, coverage interval or validation of the conditional force model.

Each retained node now includes Sun-relative velocity and Newtonian osculating
diagnostics using the same pinned solar GM: eccentricity, signed semimajor axis
and its reciprocal, periapsis distance, inclination to the J2000 equator, and
two-body specific energy. The browser shows initial/final values plus per-quantity minima/maxima among
retained integration nodes, their elapsed TDB seconds and valid/total node counts.
Ties use the first retained node in integration order, including backward runs.
Undefined or unrepresentable values remain counted in the total but do not
participate in extrema. Decimated, nonuniform samples cannot certify continuous
extrema, intervening events, resonance or stability. CLI and Web
exports retain all sampled values with the diagnostic model and limitations.
Negative semimajor axes are supported for hyperbolic instantaneous conics.

The conic shape uses dimensionless position/velocity scaling. A near-parabolic
energy denominator within 32 machine epsilons of its component scale yields a
null semimajor axis; the reciprocal is retained. Near-radial angular momentum
with transverse fraction at most `1e-12` yields a null inclination. These
conditioning guards do not quantify physical uncertainty. Undefined diagnostics
remain null and do not overwrite integrated states.

These quantities are not conserved under the prescribed planetary perturbations
or the optional 1PN term. Their variations do not prove integration error,
resonance or instability. Instantaneous periapsis is not an actual encounter
prediction. The node cap and missing-between-node limitations still apply.

Eight independent [CSPICE OSCELT](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscelt_c.html)
comparisons cover four source-backed Eros states and circular, eccentric,
hyperbolic and retrograde synthetic conics. The source hashes, generator and
toolkit versions are retained in `tests/fixtures/conic-diagnostics-reference.json`;
`scripts/reference-conic-diagnostics.py --output <new.json>` regenerates the
reference without network acquisition. This validates coordinate diagnostics,
not real comet source coverage or long-term dynamics.

The DE440 adapter now reuses center chains only at its most recent epoch, so
the Newtonian evaluation, solar correction and accepted-node sample do not
repeat identical SPK work. Returned public states remain owned copies; failed
queries clear cycle tracking, and time changes replace the cache. The cache
does not grow with trajectory duration.


### Inspecting complete propagated states

The covariance and nonlinear-ensemble panels expose expandable six-component
state and covariance tables using existing report values. Units remain AU and
AU/day in the stated heliocentric J2000 ecliptic frame; each covariance cell has
the product of its row and column units. The ensemble table is a finite-sample
mean/covariance, while first-order propagation shows its nominal state/formal
covariance. Ensemble count and the actual covariance divisor are explicit.
Statistics remain unavailable if any draw failed or fewer than two draws exist.
Every endpoint row retains its original index, explicit valid/failed status and
all six position/velocity columns. No new propagation, covariance calculation,
confidence interval or probability claim is introduced by these views. Display
and interaction are unverified under the testing hold.

Browser dynamics receipt binding now retains the parsed original input before
worker transfer. Publication checks the returned payload as well as its input
hash/byte count, and binds the actual reference epoch to the submitted manual
epoch or SBDB covariance solution epoch. Adopted SRP parameters, including
numeric values, illumination and source text, must match the original input;
matching only the force-model name is insufficient. This remains contract
consistency, not independent recomputation or source authentication.

Dynamics receipt admission now requires the frozen elapsed window to equal the
requested integration interval, including zero and backward propagation. Kernel
identity, hashes, byte count, source locations and coverage must match the shared
DE440 pin, and the absolute interval must fit that coverage. Pin constants now
live in a lightweight module re-exported by the provider; all six affected CLI
implementation-hash manifests include it. No source pin or coverage was changed.

Scientific laboratory file imports now use cancellable FileReader operations
with a 25-second read deadline. Dynamics retains a 2 MiB cap, occultation
64 KiB and conic inputs 1 MiB. Replacement/clear/unmount abort pending reads;
generation checks suppress stale completions. No browser execution has
validated these source changes; this does not imply cancellation of already
running synchronous numerical work or dynamic module imports.
