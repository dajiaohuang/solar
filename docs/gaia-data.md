# Gaia DR3 cone data

Run a bounded, explicit query against the ESA TAP service:

```powershell
rtk proxy node scripts/fetch-gaia-cone.mjs --ra 56.75 --dec 24.1167 --radius 0.1 --max-mag 15 --max-rows 1024 --output .cache/gaia-cone-new
```

The output directory must be new. Angles are degrees; the magnitude limit is
Gaia G. Each query has a 45-second deadline and an 8 MiB response ceiling. Cone
radius is at most two degrees and the row budget at most 10,000. The script first
requests COUNT, rejects oversized selections, then requests rows sequentially.
The returned count must match exactly; a truncated CSV is not accepted as a
complete selection. SIGINT aborts the current request. The manifest is written
last, after the original CSV and hashed chunks; an interrupted output without
a manifest is not a completed artifact. No data is published or deployed.

The manifest retains both ADQL queries, URLs, retrieval times, byte lengths,
SHA-256 values, original CSV files and implementation identities. `source_id`
stays a decimal string to preserve its 64-bit identity. The selected columns
include positions, proper motions, parallax, their errors and correlations,
solution type, RUWE, G magnitude, BP-RP and radial velocity where supplied.
Nulls and negative parallaxes remain unchanged; no distance inference or
quality cut is silently applied.

The coordinates are barycentric ICRS at J2016.0, expressed as a Julian year in
TCB. Gaia's `pmra` and `ra_error` include the cosine of declination. See the
[DR3 source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)
and [ESA programmatic access](https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access).
This importer does not propagate stars, construct a complete six-parameter
covariance model, correct parallax zero points, or certify occultation timing.

Chunks use 5-degree RA/declination bins computed from the returned coordinates.
These are storage partitions of the selected cone, not full-sky tiles, equal-area
HEALPix cells or bounds valid at other epochs. They intentionally do not infer
current positions from source-ID bit fields. Magnitude-limited counts are not a
catalog completeness guarantee. See the [Gaia DR3 release](https://www.cosmos.esa.int/web/gaia/dr3).

The checked-in Pleiades-area example contains 19 real ESA rows in one storage
chunk. Its separate count query also returned 19. This is ingestion and byte
provenance evidence, not a capacity benchmark. Proper-motion/observer transforms, stellar occultation integration and
sustained capacity measurements remain unfinished.

## Browser/worker chunk consumer

`src/lib/gaiaChunks.ts` validates an imported manifest, conservatively selects
5-degree bins intersecting an explicit RA/declination rectangle, and streams
hash-verified chunks with Float64 ICRS unit directions. Wrapping RA, the 0/360
seam and polar directions are handled conservatively. Selection is limited to
J2016.0; requesting a later epoch is rejected until motion-aware bounds exist.

The loader defaults to two parallel requests, a 16 MiB in-flight encoded-byte
reservation, 20,000 in-flight rows and 64 MiB total selected bytes. Each request
has a 30-second deadline. One wave waits for its asynchronous consumer callbacks
before admitting more data. The consumer must resolve after accepting/uploading
a chunk and clear its own retained state on cancellation. These counters are
admission limits, not measurements of JavaScript heap or GPU allocations. The
loader does not own retained consumer storage. A failed/cancelled stream never
returns a completed summary; already emitted chunks remain individually verified
and must not be labeled a complete catalog. Remote imports use the bounded
session cache described below. Sustained capacity measurements remain pending.

## Catalog-epoch sky chart

Open the Gaia sky chart in the evidence workspace. Load the bundled 19-source
example, select the manifest and chunk JSON files together, or provide a hosted
manifest URL whose server permits browser access. A worker verifies sources and
projects onto a north-up, east-left tangent plane at J2016.0. GPU upload ACKs
provide backpressure; zoom reuses the existing buffer. Clicking a star or choosing
a row shows its original values; JSON export includes all accepted rows and
source metadata. Input changes, cancellation and errors clear the current chart.

This view requires WebGL 2. Point sizes distinguish G magnitudes visually and
are not angular diameters. It does not apply proper motion, observer parallax,
aberration, deflection or parallax zero-point corrections. Chunk hashes establish
consistency with the imported manifest, not independent ESA authentication.

Stream cancellation/deadlines do not wait for an outstanding consumer upload
acknowledgement. Late consumer failures remain observed. Consumer-owned effects
still need their own cancellation and cleanup; the sky chart terminates its
worker and clears retained display/source state.

The browser verifies all declared source columns, valid solution codes, the
cone/magnitude selection, query row budget and unique source IDs across selected
chunks in addition to hashes. Importer and browser use one column schema; future
import receipts record that schema hash. These checks establish internal
consistency, not independent authentication of an externally supplied manifest.

## Session source cache

Completed remote loads retain a worker with an LRU content-hash cache limited
to 16 MiB and 128 encoded chunks. This is additional to active decode/GPU
storage, not a bound on total process memory. Each new load fetches its manifest
again and revalidates cached bytes against the current schema and selection.
Exports report cacheHits and cacheRetainedBytes. Local files bypass the cache.
Active cancellation or failure terminates that worker; page unmount releases
both active and idle workers. No disk persistence or full-catalog caching is
performed.

## Measured multi-chunk example

The separate [4,460-row measurement](benchmarks/gaia-20260923/README.md) retains
real ESA query/source receipts and three imports plus 120 zoom steps for each
of desktop Chromium and mobile emulation on one Windows host. Four source chunks
were loaded and a 53,520-byte star buffer was reused without zoom uploads or
reallocation. The reports pin the measured implementation; they do not establish
identical timings for later revisions. This is a short local-file experiment,
not full-sky, sustained real-time, public-network, total-memory or real mobile
hardware evidence. The bundled 19-row example remains an ingestion fixture.

## Catalog position uncertainty

The selected-star inspector reconstructs the 2D positional marginal covariance
using ra_error, dec_error and ra_dec_corr at J2016.0. Coordinates are
delta-alpha*cos(delta) and delta-dec in mas; the Gaia RA standard error already
includes cos(delta). Semiaxes are the square roots of covariance eigenvalues.
The orientation is measured from east toward north, modulo 180 degrees; a
circular contour has no preferred axis. The exported derived result is separate
from original source rows. Missing or invalid errors are not replaced by zeros.

The unit-Mahalanobis contour is not a 68 percent joint confidence region and
does not include systematics, epoch propagation or occultation timing error.
This positional marginal is not the full five/six-parameter astrometric model.
Definitions follow the [ESA DR3 source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).

## Five-parameter astrometric covariance

The selected-star readout/export now includes the J2016.0 TCB five-coordinate
formal marginal in alpha*cos(delta), delta, parallax, pmra, pmdec. Coordinate
units are mas, mas, mas, mas/Julian-year, mas/Julian-year; matrix entries use
products of the corresponding row/column units. ra_error and pmra already use
the tangent-plane cos(delta) convention; no extra factor is applied.

All ten supplied correlations are required. Positive finite formal errors and
a strict positive Cholesky factorization of the correlation matrix are required,
without jitter, clipping or covariance repair. This conservatively reports
singular/non-positive-definite inputs as unavailable; it does not claim such
inputs are all physically impossible. Original source rows remain untouched.

Solution code 31 provides a five-parameter solution; code 95 yields only its
five-coordinate marginal here. Schema 1 lacks pseudocolour fields. Schema 2 can additionally supply the
full six-parameter result described below; this five-coordinate result remains
a marginal and is not conditioned on pseudocolour. Code 3 has no five-parameter
result. No epoch propagation, systematics, parallax zero-point correction,
radial-velocity covariance or occultation probability is inferred.

Definitions: [ESA DR3 gaia_source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).

## Extended source schema

Add --schema 2 to fetch-gaia-cone.mjs to retain pseudocolour, its standard error
and its five astrometric cross-correlations. The default remains schema 1;
existing original responses/chunk hashes remain unchanged. Browser imports
validate the exact column set selected by schemaVersion (1: 28, 2: 35 fields).
Schema 2 preserves nulls, including absent pseudocolour for five-parameter
solutions. Units for pseudocolour and its error are inverse micrometres.

A real schema-2 capture is retained at tests/fixtures/gaia-six-20260923: the
same Pleiades-area cone with G <= 18 returned 94 rows and a matching count,
including 15 six-parameter, 78 five-parameter and one position-only solution.
Original CSV bytes, query URLs/timestamps and all chunk hashes are retained.
The covariance inspector exports both the five-coordinate marginal and, for
complete valid code-95 records, the full six-parameter covariance. Observer/time
propagation remains pending.

## Full six-parameter covariance

For solution code 95 and complete schema-2 errors/correlations, the inspector
constructs and exports a separate 6-by-6 formal matrix with pseudocolour as the
last coordinate, in inverse micrometres. This is not radial velocity, a 6D
Cartesian phase-space covariance, or a result conditioned on a colour estimate.
The upper-left block is exactly the separately exported five-coordinate marginal.
All 15 correlations must jointly pass the same strict no-repair factorization.
Missing pseudocolour errors/correlations or a non-positive joint factorization
produce an explicit unavailable result; no zero correlations are invented.
The source rows and original five-coordinate result remain available.

Fifteen real six-parameter source records passed full matrix construction;
a controlled matrix whose five-coordinate block is valid but whose sixth
coordinate makes it indefinite is rejected. Four browser profiles verify local
schema-2 import, source preservation, selected-star status and both exports.
These checks establish source reconstruction, not physical accuracy, epoch
propagation, pseudocolour correction or occultation uncertainty.

## Epoch propagation prerequisites

The captured 94-source schema-2 cone has 91 positive parallaxes and 16 supplied
radial velocities. Only 16 rows jointly have positive parallax, both proper
motions and radial velocity. All of those happen to be code-31 solutions.
The 15 code-95 solutions do not thereby supply radial velocity: their sixth
fitted coordinate is pseudocolour. These counts describe this capture only.

The existing GoFA Starpm interface documents TDB epochs and angular rates,
whereas Gaia gives a TCB catalog epoch and proper motions. The new
src/engine/ephemeris/barycentricTime.ts implements only the IAU 2006 B3 affine
TCB/TDB coordinate-time conversion, retaining two-part dates and the defining
nonzero offset. It does not change Gaia parameter units or implement propagation.
A separate ERFA execution generated 14 forward/inverse reference cases spanning
the origin, J2000, Gaia J2016 and day boundaries; focused checks compare them
within 0.3 ns numerically. This tolerance is not a stellar-position accuracy.

Reproduce the independent time oracle into a new file:

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 python scripts/reference-barycentric-time.py --output .cache/new-barycentric-time.json

[IAU 2006 Resolution B3](https://www.iau.org/static/resolutions/IAU2006_Resol3.pdf)
defines the time relation. A complete astrometric adapter must also establish
consistent rate/length conventions, perspective and light-time treatment,
explicit treatment of spectroscopic versus astrometric radial velocity, and
independent reference states. Merely replacing dates is insufficient. No
missing radial velocity is currently filled with zero, and no new propagated
star state is exposed by this time-conversion module.

## Single-star computation core

internal/stellarmotion now implements an explicitly adopted catalog model with
gofa v1.19.1 Starpm. Source inputs require J2016.0, valid five/six-parameter
solution identity, positive measured parallax, both proper motions and a radial
velocity. The caller must explicitly choose spectroscopic-as-astrometric;
missing radial velocity is not filled. Exact coordinate poles are unsupported.
Supported target years are within 100 Julian years of J2016.0; that bound is a
software domain, not a positional-accuracy guarantee. Any nonzero SOFA status
(distance override, excessive-velocity replacement, or failed convergence)
is rejected. The output includes model assumptions and both TDB epoch parts.

For F=1-LB, the adapter uses the derived compatible-coordinate mapping
t*=F t+constant, x*=F x: angular rates divide by F; the formal AU/distance
parallax argument divides by F when using the same defined AU in metres;
velocity is unchanged. Outputs are mapped back to TCB-compatible quantities.
This is an internal computational scaling, not a correction applied to Gaia
source rows. See [Klioner 2008](https://www.aanda.org/articles/aa/pdf/2008/06/aa7786-07.pdf)
for compatible coordinate scaling and the IAU resolution above for time.

A separate pinned ERFA oracle produces 64 states from 16 actual source rows at
J1916, J2016, J2026 and J2116. It also verifies that evaluating the same uniform
model entirely in TCB agrees with joint scaled TDB evaluation. Focused Go tests
compare the output with ERFA and reject missing, invalid and SOFA-modified states.

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 python scripts/reference-gaia-motion.py --output .cache/new-gaia-motion.json
    rtk proxy go test ./internal/stellarmotion -run 'TestIndependentERFAStates|TestRefusesIncompleteOrModifiedModels' -count=1

This incorporates SOFA changing-light-time/special-relativistic treatment for
uniform single-star motion, not binary/Galactic acceleration, observed-station
corrections or uncertainty propagation. Spectroscopic RV contains astrophysical
shifts and is only adopted approximately; inverse measured parallax supplies a
nominal model distance, not a distance inference. Source-bearing CLI and HTTP
access are described below; browser/native integration remains outstanding.

## Source-bearing offline propagation

The offline entry point reads original CSV directly and exports the entire
original manifest and CSV as base64, their SHA-256 hashes, the selected source
row, build identity, explicit adopted RV policy and model result:

    rtk proxy go run ./cmd/gaia-motion --manifest tests/fixtures/gaia-six-20260923/manifest.json --rows tests/fixtures/gaia-six-20260923/rows.csv --source-id 65212004581252736 --epoch-tcb 2026 --rv-policy spectroscopic-as-astrometric --output .cache/new-gaia-motion.json

The manifest is limited to 1 MiB and CSV to 8 MiB / 10,000 rows. Exact schema
columns, frame/epoch, CSV header, ordered unique 64-bit source IDs, declared row
count and original CSV hash/size are checked. The selected source must satisfy
the complete-input propagation contract. The evidence is copied before return;
exports never overwrite an existing file. CSV agreement with the provided
manifest does not independently authenticate ESA or establish completeness.
Other files referenced in the manifest are retained as references, not claimed
to have been loaded or validated. No chunks need to be read for this entry point.

The real local CLI was executed for source 65212004581252736 at J2026 TCB.
Its exported state matches the independent ERFA fixture and both embedded
original files decode byte-for-byte. A second run to the same output path was
refused. Browser/native integration and propagated covariance remain outstanding.

## Source-bearing HTTP propagation

`POST /v1/stellar/motion` accepts one JSON object with these fields:

| Field | Meaning |
| --- | --- |
| `originalManifestBase64` | Base64 of the original manifest file bytes |
| `originalRowsCsvBase64` | Base64 of the original CSV file bytes |
| `sourceId` | Exact decimal source ID string |
| `targetEpochJulianYearTCB` | Explicit target epoch, for example 2026 |
| `radialVelocityPolicy` | Explicit `spectroscopic-as-astrometric` adoption |

The response contains `apiVersion` and the same source-bearing `experiment`
as the offline adapter. It does not imply configured SPK coverage or ESA
authentication. The JSON body is capped at 13 MiB to cover base64 expansion;
decoded source limits remain 1 MiB / 8 MiB / 10,000 rows. Unknown fields and
trailing JSON are rejected. The route uses request admission and the weighted
trajectory compute queue, with a 20-second context budget and cancellation
checks between CSV rows. The production server also limits request reads to
15 seconds. The response is bounded at 14 MiB.

Malformed input returns 400, an oversized initial JSON body 413, invalid source
evidence or unsupported model input 422, cancellation 408, and compute overload
429. A focused test uses actual loopback HTTP and verifies byte-exact original
files plus all six output components against the independent ERFA fixture.
This is local HTTP evidence, not deployed-service or native-client acceptance.

## Browser propagation workspace

The evidence workspace now includes Stellar epoch propagation. Select the two
original files, enter the exact source ID and target TCB Julian year, and
explicitly adopt the spectroscopic RV approximation before computing. A
configured VITE_SOLAR_API_BASE_URL is required; no remote service is silently
selected. The chart itself remains at J2016.0. Changing inputs clears the
previous result and cancels pending work. Exports retain the entire experiment
and frontend build identity through the existing platform export mechanism.

The client checks bounded source/response sizes, exact echoed original bytes,
SHA-256 hashes, source/epoch/model identity, finite state and declared limits.
The retained gaia-motion-experiment.json fixture is the experiment extracted
from the actual Go CLI output described above. Three focused client tests and
one UI scenario across four browser profiles passed. The browser scenario
replays that output over an intercepted transport and covers explicit adoption,
export, stale-result clearing and cancellation. It does not establish live
browser-to-Go or physical native-device acceptance; actual loopback HTTP is
covered separately by the Go test. Propagated covariance remains outstanding.

The browser also parses the retained original CSV and compares every selected
source field, including nulls and the exact decimal identity, with the returned
selectedSource. Correct hashes alone are insufficient to accept a mismatched
selected record. Parsing is bounded to 8 MiB and 10,000 data rows, supports
quoted fields, and rejects duplicate selected identities and malformed numeric
values. These checks preserve the original bytes rather than rewriting them.
The scan keeps only the header, current row and selected row, rather than an
array of every parsed row. It yields after at most roughly 32 KiB of input
characters and checks the request cancellation signal before resuming. Original
bytes and decoded text are still retained; this is not a claim of zero-copy
processing or a measured total-memory budget.

## Formal covariance core and validation

internal/stellarmotion/covariance.go constructs the five-astrometric-coordinate
marginal plus spectroscopic radial-velocity variance only with the explicit
independent-spectroscopic-rv policy. No cross-correlations are represented as
measured. Gaia pseudocolour is marginalized, never substituted for radial
velocity. All six errors and ten astrometric correlations must be present;
the normalized matrix must pass strict Cholesky without repair.

The prototype computes a local first-order J C J-transpose from two central
difference scales and Richardson extrapolation of the adopted Starpm model.
Tangent angular coordinates use mas, proper motions mas/Julian-year, and RV
km/s. The exact same-epoch map uses the identity Jacobian to avoid numerical
subtraction noise. Near-pole coordinate charts and unconverged derivatives are
refused. This follows the general covariance transformation described in
[ESA's astrometric transformation documentation](https://gea.esac.esa.int/archive/documentation/GEDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_tansforms.html),
but uses RV rather than radial proper motion as the sixth numerical coordinate.
It does not copy the documented radial-proper-motion covariance formula into
the different coordinate system.

Two focused Go tests cover 16 real same-epoch sources, malformed matrices,
missing errors, explicit assumptions, cancellation and one future-epoch
variance-growth sanity check. Those tests do not establish cross-epoch accuracy:
independent propagated covariance references and nonlinear-limit assessment
remain required before exposing this prototype through CLI/HTTP/UI.

Independent numerical evidence is now available in
`gaia-covariance-reference.json`: 64 states from 16 original sources at J1916,
J2016, J2026 and J2116. The pinned Python generator uses five-point differences
at two step scales, and evaluates ERFA entirely in TCB-compatible coordinates
instead of the Go adapter's scaled TDB coordinates. Reference step disagreement
is at most 1.38e-5 after normalization by the output standard-deviation product;
Go/reference disagreement is at most 1.193e-4 under the same normalization.
This is a numerical comparison, not a relative error bound for near-zero entries.

`gaia-covariance-ensemble.json` additionally records six nonlinear ERFA Gaussian
ensembles: three real sources at J1916 and J2116, 32,768 draws per case, PCG64
seed 20260923. No draws are filtered. The largest normalized empirical/linear
covariance difference is 0.013742, including finite-sample error. This checks
only those adopted Gaussian models and sources, not coverage for all possible
parallaxes, large fractional errors, binaries or systematic offsets. Both
generators preserve original source, generator and prerequisite SHA-256 receipts.

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.3 python scripts/reference-gaia-covariance.py --output .cache/new-gaia-covariance.json
    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.3 python scripts/reference-gaia-covariance-ensemble.py --output .cache/new-gaia-covariance-ensemble.json

Two focused Go tests validate every retained matrix and receipt.

## Optional formal covariance through CLI and HTTP

The CLI now accepts `--covariance-policy independent-spectroscopic-rv`, and
POST /v1/stellar/motion accepts the optional JSON field `covariancePolicy`
with that exact value. Omission preserves nominal-state-only behavior. Unknown
policies fail; missing covariance inputs do not silently become zero errors.
The two explicit choices remain separate: `radialVelocityPolicy` adopts the
spectroscopic velocity value, while `covariancePolicy` adopts independent RV
formal errors. Neither choice certifies physical accuracy.

The optional `experiment.formalCovariance` contains the input/output matrices,
Jacobian, difference steps and convergence diagnostic, frame/time scale, target
epoch, coordinate labels/units, policy and assumptions. Original manifest/CSV
bytes and the selected source remain in the same experiment. Cancellation,
request/compute admission and source budgets are preserved.

    rtk proxy go run ./cmd/gaia-motion --manifest tests/fixtures/gaia-six-20260923/manifest.json --rows tests/fixtures/gaia-six-20260923/rows.csv --source-id 65212004581252736 --epoch-tcb 2026 --rv-policy spectroscopic-as-astrometric --covariance-policy independent-spectroscopic-rv --output .cache/new-gaia-motion-covariance.json

The actual CLI export for this source and year was checked against original
bytes and the independent ERFA covariance (maximum normalized difference
6.047e-6). A real managed loopback HTTP test verifies the same receipt and
matrix, default omission, and invalid-policy refusal. Browser/native covariance
controls remain to integrate; no deployed-service acceptance is claimed.

## Browser formal covariance

The stellar panel now has a separate unchecked covariance option describing
the independent-RV assumption. Its selected state is sent only when explicitly
enabled. Changing it clears prior results and cancels pending requests. The
result shows all six marginal standard deviations with their own units and
explains that these are not a joint confidence region or timing guarantee.
The full matrices, Jacobian, source bytes and assumptions remain in the export.

The browser reconstructs the five-coordinate input covariance from the verified
CSV row, adds the adopted RV variance, checks symmetric positive matrices and
validates J C J-transpose. Wrong policy/epoch/units, missing or unsolicited
covariance, altered input or output matrices and altered Jacobians are refused.
Six focused client tests and the stellar UI scenario in four browser profiles
passed. A follow-up mobile-only run verified spacing of the two separate
assumption controls after screenshot review. These browser tests replay an
actual CLI covariance export and do not replace live browser-to-Go acceptance.
Physical native covariance UI and device validation remain outstanding.

## Android request contract in progress

StellarMotionRequest owns copies of the original manifest/CSV, preserves source
IDs as decimal strings within signed-64-bit bounds, validates J1916–J2116 TCB,
requires the RV approximation, and adds covariance only with its explicit policy.
Its decoded input budgets match the backend and its wire output is capped at
13 MiB. Two plain-JVM tests verify real fixture bytes, defensive copies, optional
policy omission and invalid identities/epochs/budgets. They passed with javac
--release 17 and cached JUnit. The targeted Android Gradle invocation could not
start because no SDK path is configured on this host. Network response validation,
native controls, Android build/device proof and iOS stellar access remain pending.
