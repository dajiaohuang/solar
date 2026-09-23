# Dynamics laboratory: numerical foundation

This workstream is incomplete. A bounded adaptive integrator and restricted
Newtonian force/variational evaluator exist; a source-backed laboratory UI,
SPK adapter, force-model selection, non-gravitational terms and complete joint
covariance propagation do not yet exist. Neither module replaces authoritative
SPK states or reproduces a source orbit-fit model.

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
masses; the source adapter still needs to enforce that selection contract.
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
a real perturbed trajectory or a full source force model. No full local suite ran.

Reproduce the immutable reference into a new file:

```sh
rtk proxy uv run --python 3.12 --with scipy==1.16.1 --with mpmath==1.3.0 python scripts/reference-dynamics.py --output .cache/dynamics-reference-new.json
```
