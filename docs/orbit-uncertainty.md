# Orbit uncertainty source boundary

The initial implementation ingests and audits SBDB covariance. It does not yet
propagate uncertainty, draw uncertainty ellipsoids or calculate event probabilities.

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

Remaining work includes model-aware propagation, singular/poorly conditioned
cases, source validity limits and force-model metadata in consumer contracts,
independent trajectory/covariance references, reproducible sampling, user-facing
source access and uncertainty visualization. Additional parameters must not be
silently dropped when implementing propagation. The source covariance is a
formal orbit-fit uncertainty, not a guarantee that every model error is covered.
