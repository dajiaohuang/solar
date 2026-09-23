# Dynamics laboratory: numerical foundation

This workstream is incomplete. A bounded adaptive integrator, restricted
Newtonian force/variational evaluator and browser experiment panel exist;
additional force-model selection, non-gravitational terms and complete joint
covariance propagation do not yet exist. Neither module replaces authoritative
SPK states or reproduces a source orbit-fit model.
The pinned DE440 adapter and offline experiment command are now implemented.

## Explicit numerical contract

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
complete. Only the final state and numerical diagnostics are returned: dense
output, event detection and long-term symplectic behavior are not implemented.
Tolerance controls a local numerical estimate, not a global error bound or
physical orbit uncertainty. See [SciPy's method and tolerance description](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html).

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
Relativity, harmonics and non-gravitational effects remain absent. In particular,
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
encounter. Each retained node exports elapsed TDB seconds, barycentric six-state
and heliocentric position using the same pinned Sun state. The three browser
projections use heliocentric J2000 coordinates and equal axis scales per panel,
with AU width, Sun/start/end markers and explicit visual-only connecting lines.

The optional refinement checkbox (CLI `--compare-refinement`) runs the same
model again with tenfold tighter component/relative tolerances and half the
initial/maximum step. Each run retains its separate 20,000-attempt bound.
The export includes refined final state/transition entries, settings, work counts
and endpoint/transition differences. This is a numerical setting comparison,
not a proof of convergence to a physical orbit, a global numerical error bound,
long-term stability or complete covariance propagation.

Twelve targeted integrator/recorder/CLI tests passed, covering observer isolation,
forward/backward decimation, exact endpoint retention, zero duration and refined
exports. Four browser profiles passed the real-worker trajectory/refinement
case and mobile plots were visually inspected. A real local Eros 30-day export
retained all 123 nodes (stride one). Baseline/refined work was 122/192 accepted
steps and 733/1,153 force evaluations. Endpoint differences were `1.49e-8` km
and `3.97e-15` km/s; these tiny numerical differences do not reduce the about
191 m source-orbit model discrepancy documented above. No full local suite ran.
