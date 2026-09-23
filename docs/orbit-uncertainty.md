# Orbit uncertainty source boundary

The implementation ingests and audits SBDB covariance, converts an elliptic
solution's joint covariance to Cartesian coordinates at its solution epoch, and
generates reproducible Gaussian parameter offsets. The Evidence page displays
two-coordinate projections and a rotatable three-dimensional position ellipsoid.
An offline experiment additionally propagates six-parameter covariance under an
explicitly adopted restricted DE440 model. Browser plots remain solution-epoch
only; complete source-fit propagation and event probabilities are unfinished.

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
matrix spectrum. A dimensionless `1e-12` tolerance allows floating-point roundoff;
it is not physical uncertainty. The implementation preserves the raw matrix and
does not repair negative eigenvalues with jitter or clipping. Singular matrices
with positive diagonal entries are reported as not positive definite. Zero
marginal variance and dimensions outside 6–16 are explicit unsupported cases.

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

`cartesianCovarianceAtSolutionEpoch` maps the six labeled source elements to
heliocentric position (au) and velocity (au/day). An analytic Jacobian differentiates
the implicit elliptic Kepler equation, orbital scale, phase and three rotations.
The phase derivative retains complete revolutions. The covariance map is
`J C J^T`; additional estimated/considered parameters have an identity block,
preserving their variances and transforming all state/parameter cross terms.
The source matrix and nominal values are not mutated. Standard-epoch elements
are never substituted for solution-epoch elements.

The GM must be explicitly provided with its source. SBDB's `cov=mat` response
does not supply the central GM or its uncertainty. The CLI requires
`--adopt-de440-gm`, verifies the repository's original GM file hash and labels
the result as conditional on that adopted constant. In particular, this does
not reproduce Bennu's DE424 orbit-fit force model. Coordinate conversion at one
epoch is not integration of planetary perturbations, relativistic corrections,
radiation pressure or thermal recoil. The current conversion domain is
`0 <= e <= 0.9999`, positive perihelion distance and finite accumulated phase
within one million radians. Other conics are rejected, not silently replaced.

The independent [reference generator](../scripts/reference-orbit-covariance.py)
uses mpmath 1.3.0 at 80 decimal digits, differentiating a true-anomaly state
formulation. CSPICE N0067 via SpiceyPy 8.2.0 independently evaluates nominal
states with [conics](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html).
The [pinned reference](../tests/fixtures/orbit-covariance-reference.json) covers
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
offsets alongside its ellipsoid. These are solution-epoch results; temporal
browser propagation, model error and event distributions remain unfinished.

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
1PN completed in 178 accepted steps. No full local tests ran. Browser/native
propagation, matched extra-parameter forces, nonlinear ensembles and event
distributions remain unfinished.
