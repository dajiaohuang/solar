# Orbit uncertainty source boundary

The implementation ingests and audits SBDB covariance, converts an osculating conic
solution's joint covariance to Cartesian coordinates at its solution epoch, and
generates reproducible Gaussian parameter offsets. The Evidence page displays
two-coordinate projections and a rotatable three-dimensional position ellipsoid.
Offline and browser experiments additionally propagate six-parameter covariance
and finite nonlinear ensembles under an explicitly adopted restricted DE440 model. Complete source-fit
propagation and event probabilities are unfinished.

## Pinned 67P covariance example

The browser panel provides a one-click load for the pinned 67P K284/1 SBDB
source response. Its ten covariance axes are `e,q,tp,node,peri,i,A1,A2,A3,DT`;
the extra axes are estimated non-gravitational force parameters and remain
correlated with the orbital elements. The solution-epoch coordinate transform
retains those axes and cross terms. Temporal propagation and nonlinear ensembles
remain unavailable for this source: the current propagators require exactly six
orbital axes and refuse to drop or hold the fitted force parameters fixed.
Completing propagation requires matching the Horizons comet outgassing law,
`DT` lag convention, force-parameter derivatives, and the source fit's DE441 /
SB441-N16 ephemerides; the restricted DE440 experiment is not a reproduction of
that fit ([SBDB covariance contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html),
[Horizons non-gravitational model](https://ssd.jpl.nasa.gov/horizons/manual.html)).
The current delivery manifests contain all 16 target-specific SB441-N16 asteroid
crops declared by the upstream source, while their 67P trajectory entries are
Horizons type-21 crops. This closes the packaged target list for that small-body
ephemeris, but not the force closure used for K284/1: the project dynamics path
does not compose these crops with a DE441 planetary kernel or integrate the
source fit's force law. The reviewed public JPL parameter references specify `DT` as a lag
or delay in days but do not document the time-shift sign/convention needed to
reconstruct this particular fit. A separate historical 67P study
[Królikowska (2003)](https://acta.astrouw.edu.pl/Vol53/n2/pap_53_2_7.pdf)
explicitly defines its asymmetric model by replacing `g(r(t))` with
`g(r(t - τ))`; its fitted positive `τ = 34.3` days agrees with a reported
brightness maximum about 35 days after perihelion. This anchors the lag sign in
that study's DE405-era fit, but does not establish that Horizons `DT` maps to
the same signed `τ` in K284/1. The K284/1 force closure and parameter
derivatives also remain unavailable, so source-fit propagation stays disabled.

Run the development ingestion explicitly:

```sh
rtk proxy node --experimental-strip-types scripts/fetch-sbdb-covariance.mjs 433
```

One bounded request produces immutable source bytes and a content-addressed
receipt under `.cache/sbdb-covariance`. The receipt records the request, retrieval
time, SHA-256, byte count, solution identity, numerical audit and its limitations.
Nothing is published or deployed. Repeated retrievals preserve earlier receipts.

[JPL documents](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) the solution-epoch
covariance separately from standard-epoch elements. The loader only pairs the
matrix with elements at its own epoch. It requests `cov=mat&full-prec=1`, preserves
axis order, correlations and extra model parameters, and checks the API signature.
Its frame is the heliocentric IAU76/80 J2000 ecliptic. Angular matrix axes use
degrees; the perihelion-time axis uses days, with its nominal value a TDB Julian
date. Square-root responses use different angular units and are not accepted.

Matrix auditing checks finite entries, strictly positive marginal variances,
dimensions, dimensionless symmetry and pairwise bounds, then the correlation
matrix spectrum. The minimum eigenvalue must be at least `-1e-12` to pass the
positive-semidefinite check within floating-point tolerance; this tolerance is
not physical uncertainty. The raw matrix is preserved and no eigenvalue is
repaired with jitter or clipping. The `positiveDefinite` result flag is a
conservative Gaussian-sampling gate: it is true only when the computed minimum
correlation eigenvalue exceeds `+1e-12`. Values from `-1e-12` through `+1e-12`
can therefore pass the tolerant spectrum check yet remain ineligible for
sampling. A false flag does not prove mathematical singularity, and a true flag
still requires positive Cholesky pivots during factorization. Zero marginal
variance and dimensions outside 6–16 are explicit unsupported cases.

The browser TypeScript parser accepts finite numbers and decimal numeric strings
(including signed scientific notation and surrounding whitespace). It rejects
JavaScript radix strings such as `0x10`, `0b10` and `0o10`. Before traversing source
lists, it checks the matrix dimension and caps the chosen solution-element list
and model-parameter list at 64 entries each. These are parser resource policies,
not assertions that larger scientific solutions are invalid; original source
bytes remain unchanged. They do not bound the initial JSON parser's allocation.

The Go covariance source parser and Android/iOS covariance receipt binders also
require decimal numeric text before runtime float conversion and cap each named
source list at 64 entries before map construction. These guards reject runtime
extensions such as hexadecimal float notation. They do not establish complete
cross-runtime equivalence for rounding, underflow or whitespace recognition;
execution checks of these changes remain pending.

For matrix axes after the six orbital elements, all four source/receipt paths
require a matching `model_pars` entry with `kind: EST`. `CON` parameters remain
preserved in original SBDB bytes but are not covariance axes. The independent
Python coordinate/Jacobian reference applies the same rule before constructing
an extended covariance case.

Correlation normalization divides each covariance entry by the smaller marginal
standard deviation first, then by the larger one. For a valid covariance the first
quotient is bounded by the larger standard deviation. This avoids an avoidable
intermediate underflow caused by dividing by the larger scale first, and uses the
same arithmetic order for both entries of a symmetric pair. It neither rescales
the retained source matrix nor recovers source values already rounded to zero.
Extreme-scale numerical verification of this change remains pending.

Browser Gaussian sampling and position-ellipsoid factorization use the same
smaller-standard-deviation-first order. Browser sampling identifies itself as
`mulberry32-box-muller-compensated-cholesky-correlation-v3`; current browser
ensemble receipt binding requires that version. It uses compensated Float64
accumulation through correlation Cholesky factorization and sample-to-axis
mapping. The random-number generator and draw order are unchanged, but arithmetic
can alter seeded offsets; v2 outputs are not claimed to replay bit-for-bit.
Android/iOS Jacobian receipt residual checks also divide by the smaller output
standard deviation first, retaining their existing zero-variance branch and
`1e-10` comparison tolerance.

The pinned Eros fixture is the original 14,735-byte response from 2026-09-22 UTC,
solution 659, with its retrieval URL and hash in the adjacent `.source.json`.
Its covariance epoch is JD 2453311.5 TDB, while its standard elements use
JD 2461200.5 TDB. Substituting the latter would mix states separated by 7,889 days.
NumPy 2.4.2 independently evaluated its normalized matrix eigenvalues; all six
agree with the TypeScript audit within `2e-14`. This validates that calculation
for this source, not the accuracy of the orbit or of future propagated events.

A second real acquisition pins Bennu solution 118 (13,850 bytes, 2026-09-22 UTC).
Its eight axes include estimated bulk density `RHO` and radiation-pressure
area-to-mass ratio `AMRAT`. The model-parameter list orders those fields differently
from the covariance labels; the importer maps by name and retains all cross
correlations. NumPy independently checked all eight eigenvalues within `2e-14`.
These source parameters cannot be replaced with invented A1/A2 defaults or
discarded to force a six-dimensional propagation model.

## Cartesian coordinates at the solution epoch

### Shared-backend source inspection (implementation pending acceptance)

`POST /v1/orbit/covariance/inspect` now has a source implementation accepting
`{"originalSbdbBase64":"<base64 of original SBDB JSON bytes>"}`. It returns
`apiVersion` and `inspection`, with the original bytes, their SHA-256 and byte
count, and the normalized `source` covariance receipt. This endpoint has not
been executed, compiled or tested. Historical TypeScript/reference results
above do not validate the new Go implementation.

The Go parser admits API 1.3, J2000, 6–16 unique matrix axes, solution-epoch
elements, and estimated (EST) model parameters for any extra covariance axes.
SBDB's covariance labels append estimated model parameters only; considered
(CON) parameters remain in the original source JSON but are not matrix axes.
It retains all cross terms and the original JSON, including source validity
fields and model details that are not promoted to normalized fields. It checks strictly positive variances,
finite normalized correlations, symmetry and the correlation spectrum without
altering the source matrix. The bounded Jacobi loop observes cancellation.

The request envelope is limited to 3 MiB, decoded source to 2 MiB, and response
to 4 MiB. Work uses the existing trajectory-class compute queue with a 20-second
context deadline. It does not fetch remote URLs or load a kernel. Caller-supplied
bytes and a SHA-256 do not authenticate JPL origin or prove that `cov=mat` and
`full-prec=1` were used. Normalized metadata cannot substitute for original
source provenance. Cartesian conversion, temporal propagation and native UI
integration are not provided by this inspection endpoint.

### Shared-backend solution-epoch conversion (implementation pending acceptance)

`POST /v1/orbit/covariance/convert` accepts the same original bytes plus
`adoptedSolarGM: {au3PerDay2: number, source: string}`. The GM must be finite,
positive and explicitly sourced; the service does not silently adopt a constant
or authenticate caller-supplied source text. It returns `apiVersion` and
`conversion: {inspection, coordinates}`. The original source receipt and the
coordinate result are inseparable within this response. The inspection-only
route rejects a supplied GM instead of silently ignoring it.

The Go conversion retains the browser's elliptic/universal branch domains,
unwrapped phase sensitivities, degree-to-radian Jacobian factors and identity
block for all additional estimated model-parameter axes. Output includes nominal position
and velocity, the full joint covariance, Jacobian, axis units, conic/model/domain
metadata and explicit limitations. The source matrix is retained verbatim in
the inspection; only the multiplication operand is symmetrized using an average
that avoids same-sign overflow and preserves identical tiny variances. The
same averaging change is applied to the browser mapper.

Both routes share the bounded request/reply sizes, compute queue and deadline.
Root iterations and matrix rows check cancellation. This source implementation
has not been compiled, run or compared with independent references. Porting
the same equations is not independent validation. Temporal propagation, full
source-fit forces and native client integration remain incomplete. The
[NAIF conics contract](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html)
was consulted for conic inputs and their distinction from perturbed motion;
this does not establish CSPICE equivalence of the new implementation.

### Android source import and conversion (implementation pending acceptance)

The native Android observation screen now includes a bilingual SBDB covariance
section. It imports one original JSON file (2 MiB maximum), asks for a positive
solar GM in au³/day² and its source, then calls the shared conversion endpoint.
The existing single-reader import queue is reused; provider cancellation,
25-second import/request deadlines and generation guards discard stale work.
Input edits, collapse, pause and detach cancel the active work and clear results.

The response reader enforces a 4 MiB cap. Before display it binds original bytes,
SHA-256, source identities/epochs, parameter aliases/units, nominal values, the
full original covariance and adopted GM. Coordinate labels, formulation/domain,
extra-parameter identity blocks and marginal variances are checked. A bounded
matrix product checks consistency of the returned covariance with its supplied
Jacobian; it does not independently establish correctness of that Jacobian or
the nominal state. The `1e-10` scaled receipt tolerance is numerical policy, not
physical uncertainty. Exact response export retains original source bytes and
all joint matrix entries. Unspecified extra-parameter units remain unspecified.

This Android path has not been compiled, run or device-tested. Temporal
propagation and independent numerical/device acceptance remain open.

### iOS source import and conversion (implementation pending acceptance)

The SwiftUI observation screen now includes the corresponding bilingual SBDB
section, with explicit GM/source inputs, original-file import and full response
export. Requests and receipt validation use the existing off-main service
actor; the response transfer uses a 4 MiB cap and 25-second timeout. Original
source reads reuse the security-scoped file-reader actor with a 2 MiB cap and
an import deadline. Input edits, collapse, scene inactivity and disappearance
cancel pending work and invalidate its publication generation. Export snapshots
retain the original response even when scene changes clear the live readout.

The iOS decoder binds source bytes/hash, solution identity/epochs, axes/units,
nominal parameters, full source matrix and adopted GM. It checks coordinate
metadata, marginal variances and extra-parameter identity blocks, plus the
same bounded Jacobian/covariance consistency relation as Android. Numeric JSON
tokens use the existing binary64 decoder rather than inferred decimal-number
representations. Missing extra-parameter units remain explicitly unspecified.
Both Swift files are listed in the Xcode target. This is source integration
only; compilation, provider/cancellation/export/device behavior and numerical
reference acceptance have not been executed.

### Shared temporal-engine foundation (not yet connected to an endpoint)

The Go package now contains a bounded Dormand–Prince 5(4) integrator matching
the browser's component-max tolerance policy. It works in elapsed time, owns
its initial state/tolerances, reuses stage buffers, rejects partial/nonfinite
derivative writes, and records accepted/rejected steps and evaluations. State
dimension is capped at 512 and attempts at 200,000. Context cancellation is
checked around each derivative call; accepted-step observers receive owned
copies and must impose their own trajectory-storage budget. Failed or cancelled
runs return an error, without a successful partial-result receipt.

A per-run prescribed point-mass derivative supports a six-state or six-state
plus row-major 6×6 transition matrix. The model requires J2000/SSB/TDB geometric
ephemerides, positive sourced GMs, explicit exclusion distances and a declared
coverage interval. Up to 32 unique masses are accepted. Caller-owned mass lists
and exported evidence are copied independently of the active derivative.
Scratch buffers are reused; one derivative instance must not be called
concurrently. Gaps and exclusion encounters fail rather than inventing states.

These modules have not been compiled or executed. They are not an exposed
propagation feature: additional force terms, full
source-fit parameter derivatives, covariance pushforward, receipt endpoints
and native propagation controls still require integration. Numerical tolerances
are not physical uncertainty; sampled exclusions are not continuous collision
detection. No independent accuracy or performance evidence is asserted.

The Go DE440 adapter now admits the same pinned 5,558,272-byte DE440S-derived
subset and GM file hashes as the browser. Receipts distinguish the subset SHA-256
from the 32,726,016-byte NAIF parent source identity and name the record-preserving
crop method. The parent SHA-256 was not captured; its recorded MD5 is the checksum
published by NAIF, not an authenticity claim. The adapter owns copies of the input bytes, requires explicit
exclusions, and preserves the non-overlapping eleven-mass plan (separate Earth
and Moon). Its per-run resolver follows J2000 center chains, caches only one
split epoch, caps chain depth/cache size and rejects gaps. Both declared window
endpoints are resolved when an adapter is constructed; no construction or
evaluation has been executed during implementation. This adapter is not yet
exposed as a propagation endpoint.

Go DE440 options now explicitly enable the same Sun-relative monopole 1PN
approximation and constant unshadowed radial SRP model as the browser. The 1PN
wrapper supplies both position and velocity Jacobians with a weak-field/
slow-motion domain guard. SRP requires positive finite SI pressure, area, mass,
reflectivity and a source declaration, with no physical defaults. Its parameters
are copied before use. Both wrappers preserve the six-state/42-state contract,
propagate cancellation and reject nonfinite derivatives. Combined-model evidence
is separate from the underlying Newtonian gravity evidence, and records which
optional terms were adopted. This is not full EIH, shadow/attitude modelling or
propagation of fitted force-parameter uncertainty. These ports have not been
compiled or evaluated; source correspondence does not validate their accuracy.

The SPK reader now has a dedicated cancellation-aware type 2/3 offset entry
point. Error-free addition retains the low time part through segment selection
and record-local evaluation. Later matching unsupported segments remain errors;
they cannot cause silent fallback. The common Chebyshev record path also checks
positive finite record radii and corrects rounded record-index boundary choices.
These source changes require subsequent independent numerical boundary checks;
they carry no demonstrated precision or speed claim yet.

### Go conditional covariance propagation (package integration only)

`PropagateCovariance` now composes original-source inspection, pinned DE440
construction, solution-epoch conversion, frame/unit mapping, 42-component
state/transition integration and square-root covariance pushforward. It requires
the force reference epoch to equal the SBDB covariance epoch and limits elapsed
time to 365 days, with 20,000 integration attempts. It uses the browser baseline
tolerances: 1e-5 km position absolute tolerance, 1e-12 for the other augmented
components and relative tolerance 1e-12. These are numerical settings, not
physical error estimates. Accepted trajectory history is not retained.

The returned receipt includes original source bytes, initial conversion, force
evidence, initial barycentric state, augmented final state and all integration
settings/counts. The final heliocentric covariance is formed from its transported
square root; the deterministic Sun translation adds no uncertainty. Final epoch
is retained as reference TDB JD plus elapsed TDB seconds. No jitter or covariance
repair is used. Positive-definite six-parameter sources are required; extra
estimated force axes remain explicit unsupported inputs until their force
derivatives are implemented. Considered model parameters are not covariance
axes under the SBDB contract. Adopted GM, ephemerides and SRP parameters are fixed.

The browser and Go implementations now identify their six-term matrix products
as `neumaier-compensated-f64-dot-v1`. Compensation is used for coordinate/root
products and the final square-root Gram matrix, reducing avoidable rounding loss
when terms cancel. The TypeScript source-bound receipt recomputes with the same
arithmetic, and Android/iOS bind the algorithm identifier. This improves only
floating-point accumulation; it does not establish force-model accuracy,
independent numerical agreement or physical uncertainty. Cross-language
execution and reference residuals remain pending.

This package integration has not been executed or compiled. Native temporal
propagation controls remain incomplete. Full fit-model propagation, ensembles,
trajectory output, independent accuracy and capacity acceptance remain open.

### Shared source installation and propagation route (not executed)

The backend accepts paired `-orbit-spk` and `-orbit-gm` startup options for the
exact pinned subset and GM file above. Bounded regular-file reads precede
byte/hash verification and parsing. Configured failures stop startup; omitting
both leaves the propagation route unavailable. `DE440Source` privately owns
immutable bytes, descriptors and parsed GMs. Runs share this source without
repeating kernel copies/hashes/parsing, while retaining separate caches,
exclusions and derivative scratch. Concurrent sharing has not been exercised.

`POST /v1/orbit/covariance/propagate` accepts `originalSbdbBase64`, explicit
`referenceEpochTdb`, `durationSeconds`, `adoptRestrictedDE440: true`, and
`exclusionKm` with exactly the keys 10, 1, 2, 399, 301, 4, 5, 6, 7, 8 and 9.
Every exclusion is a finite nonnegative distance in km. Optional
`solarRelativity` and `solarRadiationPressure` adopt the documented additional
terms. Unknown request fields are rejected. The epoch must match the original
source covariance; source parameters are not taken from edited client fields.

The response contains `apiVersion` and `propagation`. Admission uses the shared
trajectory compute queue, a 20-second context deadline, a 3 MiB request envelope,
2 MiB decoded SBDB source and 4 MiB reply bound. No kernel bytes or arbitrary
source URLs are accepted from the request. Missing installed sources yield 503,
overload 429, cancellation/deadline 408 and rejected scientific input 422.
This route/startup wiring has only been inspected as source, not compiled,
started, requested, benchmarked or independently validated.

Android now has a separate immutable propagation request and source-bound
report decoder connected to the existing cancellable HTTPS transport. This
transport contract covers Newtonian, explicitly adopted solar 1PN and optional
constant unshadowed radial SRP propagation. Unrequested SRP is rejected, and
requested SRP parameters/source must match the response exactly. Original source/initial
conversion checks are reused without reserializing the receipt. Validation
binds the duration, split epochs, pinned kernel/GM metadata, eleven-body mass
plan, exclusion distances, integration settings/counts and final coordinate
units, and checks the reported covariance against its square root. GM unit
conversion permits eight binary64 ulps for cross-runtime arithmetic order;
this is not GM uncertainty or authentication. The result still depends on the
server's force evaluation and transition integration.

The Android covariance section now switches between solution-epoch conversion
and temporal propagation. Propagation asks for the original covariance epoch,
signed TDB duration, explicit restricted-model adoption and all eleven exclusion
distances. Separate controls adopt 1PN and SRP. SRP pressure, effective area,
mass, reflectivity and source are required only when selected; no physical
defaults are supplied. Changing mode, inputs or force choices cancels work and
clears old results. The result shows reference JD and elapsed seconds separately,
final heliocentric coordinates/formal sigmas and integration counts. Export
selects the complete propagation receipt and its own filename. All new text is
provided in English and Chinese. iOS parity and device/reference acceptance
remain pending; Android UI and transfer changes have not been compiled or run.

### Browser coordinate conversion implementation

`cartesianCovarianceAtSolutionEpoch` maps the six labeled source elements to
heliocentric position (au) and velocity (au/day). An analytic Jacobian differentiates
the implicit elliptic Kepler equation, orbital scale, phase and three rotations.
The phase derivative retains complete revolutions. The covariance map is
`J C J^T`; additional estimated model-parameter axes have an identity block,
preserving their variances and transforming all state/parameter cross terms.
The source matrix and nominal values are not mutated. Standard-epoch elements
are never substituted for solution-epoch elements.

The GM must be explicitly provided with its source. SBDB's `cov=mat` response
does not supply the central GM or its uncertainty. The CLI requires
`--adopt-de440-gm`, verifies the repository's original GM file hash and labels
the result as conditional on that adopted constant. In particular, this does
not reproduce Bennu's DE424 orbit-fit force model. Coordinate conversion at one
epoch is not integration of planetary perturbations, relativistic corrections,
radiation pressure or thermal recoil. The elliptic-anomaly conversion covers `0 <= e <= 0.9999`, positive perihelion
distance and finite accumulated phase within one million radians. The new
universal-variable branch covers larger nonnegative eccentricity, including
parabolic and hyperbolic cases, within its stated dimensionless-time domain;
that extension awaits independent numerical/reference acceptance.

The independent [reference generator](../scripts/reference-orbit-covariance.py)
uses mpmath 1.3.0 at 80 decimal digits, differentiating a true-anomaly state
formulation. CSPICE N0067 via SpiceyPy 8.2.0 independently evaluates nominal
states with [conics](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html).
The [pinned reference](../tests/fixtures/orbit-covariance-reference-20260926.json) covers
Eros, Bennu, circular/equatorial/retrograde cases, high eccentricity, inbound and
outbound motion, multiple complete revolutions and a distant orbit. It records
original fixture hashes and the adopted GM source. Reference inputs deliberately
use the same rounded Float64 nominal values, isolating calculation error from
decimal-input rounding.

Across these ten cases, the observed largest position-component difference
from the high-precision reference was `1.44e-14` au and velocity-component
difference `1.35e-15` au/day. The largest covariance entry difference, normalized
by the corresponding reference marginal standard-deviation product when nonzero,
was `2.27e-13`. These are numerical agreement measurements for these cases,
**not physical prediction uncertainties or a global error bound**. No source
orbit-fit trajectory has been independently reproduced.

## Reproducible joint Gaussian offsets

`sampleSbdbCovariance` accepts an explicit unsigned 32-bit seed and 1–10,000
draws. It factors the dimensionless correlation matrix, applies the marginal
scales, and retains every source axis. Mulberry32, Box–Muller and the correlation
Cholesky algorithm are versioned in the result. A singular/non-positive-definite
factor is rejected without jitter or eigenvalue clipping. Same-runtime,
same-input exports reproduce exactly; transcendental arithmetic may differ in
the last bit across runtimes.

Samples store **offsets separately from nominal parameters**. Adding a tiny
perihelion-time offset to a large Julian date prematurely would round away
uncertainty. A later dynamics evaluator must subtract its reference epoch before
applying that offset. All Gaussian draws remain present, including any implying
invalid physical parameters; no hidden rejection or truncation changes the
distribution. Gaussian parameter sampling is only a formal approximation to an
orbit-fit distribution and does not establish event probabilities.

The development CLI reads an existing source response, exports the complete
source audit, adopted GM, implementation hashes, transformed matrix and optional
sample offsets. It refuses to overwrite an output file and makes no network or
publication request:

```sh
rtk proxy node --experimental-strip-types scripts/convert-sbdb-covariance.mjs tests/fixtures/sbdb-bennu-covariance.json .cache/bennu-joint-new.json --adopt-de440-gm --samples 1000 --seed 42
```

Forty targeted ingestion/conversion/sampling/export checks passed. Fixed-seed
10,000-draw checks recover Bennu's marginal scales and cross-correlations within
finite-sample tolerances; they do not establish statistical quality for every
seed. Real Eros/Bennu CLI exports succeeded, including an eight-axis Bennu
1,000-draw receipt. Full local test runs were not used.

## Browser inspection

The Evidence page accepts an existing SBDB JSON file up to 2 MiB. It parses and
hashes the original bytes locally, shows both source epochs, the solution identity
and every covariance axis, then requires an explicit action adopting the pinned
DE440 solar GM before converting. Importing another file or clearing the panel
invalidates previous calculations, including late asynchronous results.

The result shows marginal coordinate standard deviations in km and km/s, with
extra parameter units preserved. XY/XZ/YZ ellipses show the unit-Mahalanobis
contour of each two-coordinate marginal covariance; the axis extent in km is
shown independently for each plot. These are neither a three-dimensional
confidence region nor a propagated orbit prediction. The JSON export retains
the parsed source audit, original file hash/size/name, adopted GM hash and full
joint transformed matrix. A file hash identifies bytes, not their authenticity
or whether the original request used full precision.

Five focused projection unit checks and eight checks across Chromium desktop,
Chromium mobile, Firefox and WebKit verified import, explicit conversion,
eight-axis export, invalid replacement, clearing, oversized-file rejection and
Chinese copy. Mobile screenshots exposed an overflowing hash, which was fixed
and covered by a panel-width assertion. A numerical follow-up reproduced raw
determinant underflow turning a nonzero contour short axis into zero at variance
`1e-200`. Normalized eigenvalues and correlation now avoid raw variance products
and squared display conversions. Regression cases cover tiny/large, rotated,
highly anisotropic and singular matrices without injecting variance. All four
browser import/export checks passed again after that correction. No full local
suite was run.

Remaining work includes complete source-fit temporal propagation, singular/poorly
conditioned sampling, source validity limits and force-model metadata in consumer
contracts, additional propagated trajectory/covariance references, Web/native
source acquisition and native access. Additional parameters must not be
silently dropped when implementing propagation. The source covariance is a
formal orbit-fit uncertainty, not a guarantee that every model error is covered.

## Three-dimensional position marginal

The Evidence page now maps a unit sphere through a correlation-based Cholesky
factor of the position covariance. Unit conversion happens after factorization
to retain very small/large or anisotropic axes. No covariance jitter, clipping
of negative pivots or axis exaggeration is applied. An unrepresentable or
numerically non-PSD factor is reported unavailable while the original full
joint matrix is retained. Exact degenerate covariances render as lower-rank
shapes; they are not assigned a three-dimensional probability mass.

Keyboard-accessible azimuth/elevation sliders rotate the orthographic wireframe;
one button resets the view. The plot is centered on the nominal solution and
labels J2000 ecliptic coordinate offsets, km axis scale, true axis proportions
and Mahalanobis contour radius. Radii 1, 2 and 3 correspond to approximately
19.87%, 73.85% and 97.07% mass **only for a full-rank three-dimensional Gaussian**.
These values were checked with SciPy 1.16.1
[`chi2.cdf(radius**2, df=3)`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html).
They are not one-dimensional sigma coverage, physical accuracy or collision
probabilities. Camera angles are presentation settings, not source-frame changes.

Web and offline covariance exports include the position factor, rank, units,
source frame, supported contour levels and limitations. The complete transformed
joint matrix, additional parameter axes and original source evidence remain
available. The CLI also pins the factorization implementation hash and records
factorization errors without fabricating a repaired covariance.

Eleven targeted factor/projection/CLI checks passed, including extreme variance
scales, exact degeneracies, invalid covariances and the original Eros/Bennu
sources. Four real browser import/rotate/contour/reset/export checks passed;
the mobile screenshot retained the true geometry without panel overflow.
The actual Bennu CLI export retained all eight axes and 1,000 seeded parameter
offsets alongside its ellipsoid. These are solution-epoch results; complete
fit-model propagation, model error and event distributions remain unfinished.

## Conditional six-parameter time propagation

The offline experiment explicitly adopts the restricted eleven-source DE440
point-mass model, optionally adding the Sun-relative 1PN monopole. It starts at
the **covariance solution epoch**, converts the element Jacobian and covariance
square root from heliocentric ecliptic AU/AU-day to barycentric J2000 km/km-second,
then integrates the nominal state and variational equations together. At the
requested epoch it transforms back to heliocentric ecliptic coordinates.
The [NAIF frame contract](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/frames.html)
defines the fixed ECLIPJ2000/J2000 rotation; CSPICE `sxform` independently verifies
the application's rotation and unit conversions in the reference cases.

The covariance output is `B B^T`, where `B` is the propagated source square root;
no diagonal jitter or clipping repairs the source. This currently requires a
positive-definite six-axis source. Additional parameters, including Bennu's RHO
and AMRAT, are **rejected rather than dropped or silently held fixed**. DE440
ephemerides and adopted GMs are deterministic inputs with no added uncertainty.
This does not reproduce the complete SBDB fit model, even for a six-axis source.
First-order Gaussian uncertainty excludes model mismatch and nonlinear effects.

### Fitted model-parameter axes are not yet propagated

`model_pars` parsing and covariance-axis matching establish that an extra label
has an `EST` nominal value; they do not establish that the corresponding fitted
force is present in the propagator. JPL defines covariance labels after the six
orbital elements as estimated dynamical model parameters in the [SBDB API
contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html).

The pinned 67P source in
[`sbdb-67p-covariance.json`](../tests/fixtures/sbdb-67p-covariance.json) makes
the gap concrete: solution `K284/1` has ten covariance axes, with `A1`, `A2`,
`A3` and `DT` after the six orbital elements. Its provenance names `DE441` and
`SB441-N16`; this package instead integrates a restricted DE440s point-mass
model. JPL's [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
defines `A1`/`A2`/`A3` as radial/transverse/normal nongravitational acceleration,
documents the cometary water-ice distance law and its constants, and defines
`DT` as a cometary lag/delay. None of those source-fit force terms or their
parameter derivatives are integrated here. The current variational state is
six states plus a 6×6 transition matrix, so it has no sensitivity columns for
those four fitted dimensions. Rejecting this source is required to preserve its
cross-covariances; propagating just the first six labels would change the
source uncertainty model.

Bennu's pinned solution 118 has eight axes, with `RHO` (kg/m³) and `AMRAT`
(m²/kg) after the orbital elements; its source records `DE424` and
`SB424-N343`, also different from the DE440s propagation source. The source
describes `RHO` as bulk density and `AMRAT` as solar-radiation-pressure
area-to-mass ratio. JPL's Horizons manual defines an `AMRAT` pressure model,
including its total-absorption convention, but that alone does not establish
the precise force law or partial derivatives used for this fitted Bennu
solution. The optional project SRP force consumes separately adopted fixed SI
pressure, area, mass and reflectivity inputs; it does not bind either fitted
axis or its covariance derivative. A complete fit-model path therefore needs
source-specific parameter definitions and units, matching ephemerides/perturbers
and force equations, state sensitivities for every estimated covariance axis,
and independent trajectory/covariance comparisons against an authoritative
solution. A parameter-name match alone is not acceptance. Browser, Android and
iOS covariance-propagation readouts now place the SBDB source PE/SB identifiers
beside the adopted integration kernel; this is a visible provenance comparison,
not evidence that the source fit was reproduced.

```sh
rtk proxy node --experimental-strip-types scripts/propagate-sbdb-covariance.mjs tests/fixtures/sbdb-eros-covariance.json .cache/eros-propagated-new.json --adopt-conditional-de440-model --duration-seconds 2592000 --exclusion-km 0 --adopt-solar-1pn
```

Positive duration advances time; negative duration goes backward. The duration
is limited to 365 days and must stay inside pinned source coverage. The explicit
exclusion distance is a sampled singularity guard, not continuous collision
detection. The CLI does not overwrite files, fetch data, deploy or publish.
It exports original payload/hash, implementation hashes, adopted force sources,
integration settings, split epoch, complete covariance and its units/limitations.
Cancellation produces no result file.

The [independent generator](../scripts/reference-dynamics-covariance.py) combines
an 80-digit coordinate Jacobian, CSPICE states/frame transformations and SciPy
DOP853 **direct covariance evolution**, `dC/dt = A C + C A^T`, rather than the
application's square-root pushforward. Six pinned Eros cases cover -10, 0 and
+30 days with each force model. Its two-setting maximum covariance refinement
difference is `1.21e-15`, normalized by marginal sigma products. Application
checks require covariance agreement within `2e-9` in that normalization and
nominal agreement within `2e-12` AU / `2e-14` AU/day. These are case-specific
numerical checks, not physical uncertainty certification or global error bounds.

Thirteen focused propagation, sampling and CLI checks passed locally, including
source ownership, cancellation, source/generator hashes, extra-parameter
rejection and output preservation. A real +30-day Eros CLI experiment with solar
1PN completed in 178 accepted steps. No full local tests ran. Native
propagation, matched extra-parameter forces and event
distributions remain unfinished.

## Browser time propagation

After importing a source, expand **Propagate formal covariance in time**. Set
the signed TDB duration and explicit point-mass exclusion distance, optionally
adopt solar 1PN, then explicitly adopt the conditional DE440 model. This starts
the shared dynamics worker; the interface remains responsive and offers cancel.
The source is reparsed and hashed in the worker, and the bounded DE440 download
must pass its original size/hash checks before integration. Extra source axes
are rejected before ephemeris download; solution-epoch inspection remains usable.

Results display the split TDB endpoint, formal marginal standard deviations,
rotatable propagated position ellipsoid, selected force model and accepted-step
count. JSON export includes original source payload/hash, full covariance, model
and numerical settings, limitations and application build identity. It does not
compute event probabilities. Changing parameters, replacing the file or clearing
the panel discards the old result and terminates any active worker. A terminated
worker cannot later publish into a replacement source's view.

Four browser profiles passed actual Eros propagation/export against the independent
direct-covariance reference, plus cancellation and replacement during a held source
request. Four profiles also passed the existing nominal dynamics experiment after
worker reuse. The mobile result screenshot showed the full table, units, epoch and
ellipsoid without horizontal overflow. Only focused browser cases ran locally.

## Nonlinear finite ensembles

After source import, expand **Propagate nonlinear orbit samples**. Choose
1–128 joint draws, an unsigned 32-bit seed, signed TDB duration, exclusion
distance and optional solar 1PN. Each sample uses the original joint Gaussian
source offsets and an independent six-state nonlinear integration. Periapsis-time
offsets are applied to relative time, avoiding an extra rounding step at the
large absolute Julian date. The nominal source uses the conic coordinate-conversion domain; individual
draws may cross conic classes. The universal nominal-Jacobian extension below
is newer than the recorded historical ensemble evidence.

The whole run shares a 250,000 force-evaluation budget, with at most 20,000
adaptive attempts per draw. Cancellation and budget exhaustion produce no
completed receipt. Other failed draws retain their source offsets, zero-based
indices, reasons and validity mask. JSON endpoints for invalid draws are `null`,
not zeros, and arrays retain their original length. No rejection/resampling
changes the source distribution. Additional fitted force axes remain unsupported.

The readout lists endpoint positions and exports all six state components,
original source/hash, full source offsets, seed/algorithm, force evidence and
numerical settings. Complete batches with at least two samples also include
descriptive mean, sample covariance with divisor `n-1`, and standard deviations.
Anchored compensated sums preserve small spreads around large coordinates.
If any draw failed, summary moments are unavailable: statistics of survivors
would describe a different distribution. These finite moments are not confidence
intervals, sampling convergence evidence, event probabilities or physical errors.

The same calculation is available offline; choose a new output filename:

```sh
rtk proxy node --experimental-strip-types scripts/propagate-sbdb-ensemble.mjs tests/fixtures/sbdb-eros-covariance.json .cache/eros-ensemble-new.json --adopt-conditional-de440-model --duration-seconds 2592000 --exclusion-km 1 --count 8 --seed 42 --adopt-solar-1pn
```

The CLI records implementation hashes, caps original-source reads at 2 MiB,
supports SIGINT cancellation and never overwrites existing output. An actual
eight-draw Eros run with these settings produced eight valid endpoints using
2,024 force evaluations. This is numerical execution evidence only.

The [independent generator](../scripts/reference-nonlinear-ensemble.py) combines
80-digit classical-anomaly coordinates with CSPICE frame/states and SciPy
DOP853 integration. Twelve cases cover three hand-selected joint offsets,
-10/+30 days and both force choices. Application comparisons passed within
`2e-12` AU and `2e-14` AU/day for those cases. Deliberately large reference offsets
exercise nonlinear trajectories; they are not probability-weighted samples.
Real browser checks covered seeded export, cancellation/source replacement,
narrow-screen layout and an all-failed force-exclusion batch with preserved
indices. Complete source-fit forces, native ensemble access and event
distributions remain pending.

## Universal-variable nominal covariance extension (unexecuted)

For eccentricity above 0.9999, the coordinate transform now uses a periapsis
universal variable u, beta = 1-e, z = beta*u^2 and Stumpff functions C,S.
It solves u + e*u^3*S(z) = tau, with tau equal to elapsed time divided by
sqrt(q^3/mu). The derivative of that equation with respect to u is
1 + e*u^2*C(z), the radius divided by q. Implicit differentiation supplies
the e, q and periapsis-time columns; analytic rotation derivatives supply the
three angular columns in the original degree units. Series derivatives of C/S
are used near z=0, so eccentricity one has no 1/(1-e) singularity. Elliptic
revolutions are not removed from this branch before differentiation.

The branch limits absolute dimensionless elapsed time to 1e6 and rejects
nonfinite states/derivatives or failed bounded root convergence. This is a
numerical admission policy, not physical validity or a certified error bound.
The output model and numericalDomain distinguish it from the historical
elliptic-anomaly path. Additional fitted axes keep their identity block and
all joint cross-correlations. Restricted dynamics still refuses unmatched
additional force parameters; this extension does not reproduce a full SBDB fit.

Browser conversion, conditional covariance propagation and nonlinear nominal
validation consume the shared mapper. Offline conversion/covariance/ensemble
receipts include the new implementation hash. No calculations or tests have
run for this extension, and historical elliptic reference results do not
validate the refactor or new domain. Parabolic, near-parabolic, inbound/outbound
hyperbolic and high-precision Jacobian comparisons remain required acceptance.

### Browser coordinate-domain readout

Solution-epoch conversion, propagated covariance and nonlinear ensembles now
share a nominal-coordinate readout. It shows source eccentricity/periapsis,
elliptic/parabolic/hyperbolic classification, signed solution-epoch offset from
periapsis, the selected Jacobian formulation and its numerical admission limit.
The conversion receipt retains nominalConic alongside model/numericalDomain.
Nonlinear sampling retains those nominal model fields separately from per-draw
conic states, so a draw crossing a conic boundary is not relabeled as the nominal
class. Existing full-result JSON exports include these fields.

The UI distinguishes solution-epoch conversion limits from temporal force-model
coverage and physical validity. Additional fit-parameter propagation remains
unavailable without matched forces. Readout and exports are source-reviewed
only; browser and numerical acceptance remain unexecuted.

Main-thread dynamics publication now also binds the six-axis parsed source
labels, units, nominal values and original matrix to the submitted solution-epoch
elements. Fallback to standard-epoch elements is admitted only when both epochs
are equal. The returned nominal conic, numerical formulation/domain, coordinate
labels and sampling axes must agree with that original source. This check reads
metadata and numeric fields only; it does not rerun an eigensolver, root solver,
Jacobian or dynamics integration, and does not establish numerical accuracy.

### Native conditional propagation source integration

Android and iOS now contain conditional propagation inputs, bounded requests,
cancellable service calls, source-bound receipt checks and complete JSON export.
The iOS implementation is registered in the Xcode target. Both clients require
explicit restricted-DE440 adoption and all eleven exclusion distances; optional
solar 1PN and constant radial unshadowed SRP are bound to the request. No SRP
material values are supplied by default. The reference TDB Julian date and
elapsed TDB seconds are displayed separately. Input or lifecycle changes cancel
work and invalidate displayed results; export captures response bytes first.

Initial SBDB coordinate checks are shared with conversion. Propagation receipts
bind source hashes, force parameters, numerical settings, diagnostics and final
covariance root consistency. They do not independently integrate a trajectory
or authenticate the source provider. These native paths are source-integrated
only: compilation, device behavior and independent numerical acceptance have
not run. Backend pinned source configuration is still required; absent sources
return an unavailable response.

Propagation exclusion admission requires exactly the eleven canonical NAIF
integer keys with explicit finite nonnegative JSON numbers. Null values,
duplicate body entries and alternate spellings such as leading-zero keys are
rejected; an explicitly supplied zero remains allowed. The request duration
bound is checked before compute admission. These boundary changes have been
source-reviewed only and await execution with the rest of the implementation.

### Propagation diagnostic readout

The browser and native covariance results expose accepted-step size extrema,
maximum accepted component-normalized embedded local error ratio and relative
tolerance. Zero-duration output distinguishes absence of accepted steps from
an accuracy claim. These are integrator diagnostics, not global error bounds,
source-fit uncertainty or physical accuracy. Android now retains and displays
the original propagation, force and gravity limitation arrays; browser output
also exposes the propagation and force-model notes. Full JSON exports retain
absolute tolerances and transition layout. Source integration is unexecuted.

### Recovering original input bytes from exports

New browser and offline conversion exports include top-level originalBase64.
Covariance and ensemble exports place it in sourceFile; manual dynamics uses
initialFile. Decode this field to recover the original bytes and compare their
length and SHA-256 to the recorded evidence. Do not hash a JSON reserialization
of payload or sourceAudit: whitespace and numeric spellings may differ. Browser
worker publication binds originalBase64 to the submitted snapshot before
displaying a result. Inputs remain limited to 2 MiB; encoding is chunked.
This preserves provenance bytes but does not authenticate the source provider.
Existing native exports retain their original source fields unchanged. Older
exports without original bytes cannot recover them from hashes alone. These
new export paths have not been executed or tested.

### Offline read budgets

The four offline conversion/dynamics tools share scientific-file.mjs for
regular-file snapshots: source and implementation files are capped at 2 MiB,
GM text at 1 MiB, and the pinned SPK at its exact declared byte count. The
reader allocates the opened size plus one sentinel byte, reads in at most
64 KiB chunks and rejects observed size/timestamp changes. Hash checks remain
necessary; metadata is not source authentication. Cancellation is cooperative
between OS reads, with finally-based handle closure; a pending OS operation
is not forcibly interrupted. These changes have not been executed or tested.

### Offline receipt write boundary

Conversion, propagation, ensemble and manual-dynamics exporters write a private
sibling temporary file in chunks, request file sync, close it and create the
final path with a no-replace hard link. Existing paths are not overwritten; a
filesystem without hard-link support fails without a weaker fallback. The
writer defaults to a 32 MiB UTF-8 output budget. JSON serialization still occurs
synchronously beforehand and is not itself bounded by this writer byte check.

Cancellation before the final link prevents publication; success of that link
is the commit point. A later cancellation retains the complete output. Summary
output includes outputBytes and cleanupWarnings, so inability to remove this
invocation temporary artifacts is not confused with an absent final result.
A process crash may leave a temporary directory; directory/crash durability is
not claimed. No files were written through this new path during implementation,
and no cancellation, filesystem or integrity tests have run.

### Optional numerical refinement of propagated covariance

Browser and offline covariance propagation can opt into an extra integration
(--compare-refinement for the CLI). It uses relative tolerance 1e-13, one-tenth
the baseline component absolute tolerances, initial step 1800 s and maximum
step 43200 s, with its own 20000-attempt budget. Both browser runs share the
300-second job deadline. Default propagation performs no extra run.

The augmented 42-state integration applies numeric absolute tolerance `1e-12`
to every transition-matrix entry (`1e-13` in the refinement), while the first
three position entries use `1e-5 km` (`1e-6 km` when refined) and velocity
entries use `1e-12 km/s` (`1e-13 km/s`). Under the fixed km and km/s state
convention, the four 3x3 transition blocks have units dimensionless, seconds,
seconds^-1 and dimensionless, respectively. The same numeric tolerance therefore
has different units across those blocks; it is the recorded component policy,
not a common dimensionless STM error threshold or a physical error bound.

The separately integrated transition matrix pushes forward the same source
covariance factor. covarianceRefinement retains final frame/axes/epoch, nominal
state, full covariance and root, marginal sigmas and their absolute differences
from the baseline (in the recorded coordinate units). The browser table also
displays converted km and km/s values. experiment.refinement retains numerical
settings, transition matrix, endpoint differences, counters and local diagnostics.

This is a same-source, same-force-model numerical comparison, not independent
validation or an error bound. Equal results at zero duration do not establish
convergence. The implementation has not been executed or tested; backend/native
refinement support and independent reference comparisons remain outstanding.

### Backend refinement response

POST /v1/orbit/covariance/propagate accepts optional compareRefinement. True
runs the tighter integration under the same 20-second request context and
compute lease. propagation.refinement includes integration, finalCoordinates,
marginalSigmaAbsoluteDifference and limitation; false/absent adoption returns
null. The difference units match finalCoordinates.units (au and au/d). The
refined integration retains all 42 state/transition components and numerical
settings. Both runs use the same audited source and fixed force model.

Failure or cancellation of either run returns an error rather than a partial
comparison. The unchanged response cap remains 4 MiB. Android/iOS currently
reject non-null unrequested refinement; their opt-in support remains pending.
This backend composition has not been compiled, calculated or exercised over
HTTP and is not independent numerical validation.

Android now exposes explicit refinement adoption, binds both sets of numerical
settings and final covariance evidence, and shows refined nominal coordinates,
sigmas and absolute sigma differences. Both full results remain in the original
response export. The common backend deadline is not extended by opting in.
The native receipt check is consistency checking, not independent integration.
Android code is uncompiled/unexecuted; iOS opt-in is still outstanding.

### Native refinement adoption source status

iOS now also has explicit default-off adoption, shared baseline/refined receipt
checks, cancellation on option changes and a bilingual comparison readout in
au and au/d. Both native clients reject missing adopted refinement and
unrequested non-null refinement. Raw export retains both complete results.
These additions supersede the earlier pending-native-support notes above;
neither client has been compiled or exercised. Same-model agreement is not
independent validation, physical accuracy or a global error bound.

### Backend joint source-offset coordinates

ConvertSourceOffsets accepts original SBDB bytes, an explicit sourced solar
GM and 1 to 128 complete finite joint offset vectors in source axis order and
units. Its conversion receipt retains the audited source and nominal full
coordinate conversion. Each indexed draw holds a six-component heliocentric
state (au, au/d) and any additional parameter values; failed draws have null
values and a reason. The flat owned offsets retain all failed draw inputs.

The periapsis elapsed time is formed as (solution epoch - nominal tp) minus
the tp offset. No fitted parameters are silently discarded or used as forces.
This source-only backend building block has no HTTP route yet and performs no
force propagation, distribution sampling or event-probability estimation.
It reuses the bounded nominal conic solvers, including their requirement for
finite analytic derivatives. It has not been compiled or executed.

### Backend nonlinear endpoint ensemble source status

PropagateSourceOffsets now composes source-offset conversion and the pinned
DE440 force model for up to 128 six-parameter draws over at most 365 days.
The whole operation shares a caller context and 250000 derivative-call budget;
calls that fail are counted. Source setup and endpoint ephemeris lookups are
outside that count. Each integration retains its own 20000-attempt limit.

Endpoints preserve draw identity, failure stage/reason and null state on
failure. Successful nonzero-duration integrations retain full numerical
diagnostics and barycentric states; endpoint states have separately recorded
heliocentric axes/units and split epoch. Zero duration is an exact identity
in the initial coordinate frame and has a null integration receipt.

The implementation is serial because the force cache/scratch are run-local
and not concurrency-safe. Fixed adopted SRP/1PN forces are supported; extra
fitted source axes are not silently treated as fixed parameters. No moments,
event probabilities or continuous collision guarantees are inferred. HTTP
exposure and native client adoption remain pending. No execution, compilation
or numerical acceptance has been performed.

Backend ensemble receipts now include moments. Available summaries retain
anchor, meanOffset, mean, symmetric sample covariance, standard deviations
and the count-minus-one divisor. Coordinate units follow endpoint axes and
covariance units are their pairwise products. An anchored compensated two-pass
sum preserves small centered offsets without recovering them from a rounded
absolute mean. Nonfinite arithmetic is an error, not repaired covariance.

Any failed draw makes moments unavailable with reason failed-draws and an
explicit failedCount; one draw yields insufficient-draws. Unavailable numeric
arrays remain null. These are descriptive finite-ensemble statistics only,
not probability calibration or independent physical accuracy evidence. This
supersedes the earlier pending-moments note; HTTP/native wiring and numerical
acceptance remain pending. No computations have been executed.

### Backend ensemble HTTP contract

POST /v1/orbit/covariance/ensemble now accepts originalSbdbBase64,
referenceEpochTdb, durationSeconds, adoptRestrictedDE440, exclusionKm, optional
solarRelativity/solarRadiationPressure, and required offsets. Offsets are a
flat array of 6 to 768 explicit finite numbers, in complete six-axis draws
using the original source label order and units. Null components are rejected,
not converted to zero. Extra fitted source axes remain unsupported.

The API uses a 3 MiB body cap, 2 MiB original-source cap, one compute lease,
20-second context and 4 MiB response cap. That context covers queue admission
and scientific work; socket read/write deadlines remain server-level policy.
Missing configured DE440 source returns 503, invalid request shape 400, body
limit 413, overload 429, cancellation/deadline 408 and scientific/budget errors
422. A successful envelope contains apiVersion and ensemble. Individual draw
failures remain in that ensemble and make moments unavailable. Unknown
options, including compareRefinement, are rejected.

This supersedes the earlier pending-HTTP notes. Native adoption is still
pending; the route has not been compiled, called or numerically validated.

Native request source status: Android OrbitEnsembleRequest and iOS
NativeOrbitEnsembleRequest now encode the ensemble fields with immutable
finite offsets, 128-draw and 3 MiB limits. They preserve original source bytes
and explicit force choices and omit compareRefinement. These types have not
been compiled or exercised; native response binding, transport and UI wiring
remain incomplete. No native ensemble availability is implied by these types.

Android now has an ensemble receipt decoder and loadEnsemble transport path.
The decoder binds source/force identity, offsets, axes, split epoch, indexed
failures, zero-duration identity, completed integration diagnostics and shared
force counts. It binds moment availability to observed failures and checks
finite arrays, anchor/mean relationships, symmetry and sigma consistency.
It does not independently reproduce endpoint dynamics or recalculate moments
from all endpoint states. Raw-response exports retain complete evidence.

The service reuses its existing cancellation, 25-second deadline and 4 MiB
response cap. No request has been issued, compiled or tested. Android controls
and iOS receipt/transport wiring still need implementation.

Android ensemble controls are now wired in source: an explicit propagation
mode accepts a flat JSON offset array in original source axis order/units.
Input is capped at 32768 characters on submission without truncation. Changes
cancel prior work and discard stale output. The readout includes all indexed
endpoints/failures, split epoch and units, force counts and explicit moment
availability; raw response export retains full evidence. This supersedes the
earlier pending-Android-controls note. No native UI or numerical execution
has been performed; iOS ensemble wiring remains incomplete.

iOS now also has ensemble receipt/source binding and actor transport in source.
It applies the same force, offset, indexed-failure, zero-duration, diagnostic
and moment-availability contracts as Android and retains raw response bytes.
Its checks do not independently reproduce dynamics or all-endpoint statistics.
The existing request cancellation/deadline and 4 MiB response cap apply. iOS
controls/readout are still pending; no compilation, API call or numerical
acceptance has been performed.

iOS ensemble controls and readout are now connected in source. A multiline
JSON array preserves source axis order and units; submission rejects inputs
beyond 32768 UTF-16 units without truncating them. Mode/input changes cancel
work and invalidate prior results. Indexed endpoints/failures, split epoch,
units, force counts and unavailable-moment reasons are shown; export retains
original response bytes. Refinement controls are hidden for ensemble mode.
This supersedes the pending-iOS-controls note. Neither native flow has been
compiled, executed or accepted numerically.

Browser/CLI ensemble receipts now retain forceEvaluationsByDraw for every
source index, including calls that fail. Coordinate failures and zero-duration
identities consume zero force calls. Projection failures have their own stage
and keep completed integration counters. This array uses ordinary JSON
numbers; original offsets and indices remain unchanged. Browser descriptive
moments also carry failedCount and reject invalid arithmetic intermediates.
These source changes have not been executed or independently validated.

Browser live-worker delivery now checks indexed counts, failures, state
sentinels, zero-duration identity, completed integration diagnostics and
moment availability before displaying a receipt. Sampled offsets must match
the converted initial offsets. The endpoint table includes force counts and
failure stages. This is consistency checking, not independent integration
or reproduction of all sample moments. No execution has been performed.

Browser ensemble receipt checks now also bind sampling algorithm/distribution,
endpoint frame/units, six-state integration settings and empty additional-axis
arrays. Gaussian source sampling explicitly rejects nonfinite correlation
factors and generated offsets without repairing covariance or replacing draws.
These checks have not been executed; they do not establish numerical accuracy.

Browser SBDB import now uses an abortable FileReader path with a 25-second
read deadline and 1 byte to 2 MiB source bounds. Clear, replacement and unmount
abort pending reads; generation guards still cover subsequent digest work.
An invalidated GM digest no longer starts coordinate conversion on completion.
Existing source-hash keys already unmount old propagation panels and terminate
their workers. These lifecycle changes have not been exercised in a browser.
