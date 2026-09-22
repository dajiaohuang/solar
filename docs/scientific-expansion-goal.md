# Scientific expansion and real-time scale

Owner-authorized goal, 2026-09-22 (Asia/Singapore). Implementation tracker, not a
claim that the proposed capabilities already exist. Deployment and publication
remain paused. Changes may go directly to main after the required checks.

## Acceptance ledger

| Workstream | Required observable outcome | Status |
| --- | --- | --- |
| Shared analysis ephemeris | Events, curves and mission endpoints use a frozen source contract, expose actual per-body models, offer strict SPK coverage, and export time/frame/source evidence; shared backend integration follows | In progress |
| Ground observer | Geodetic station, SOFA-compatible celestial/terrestrial transforms, versioned IERS EOP, vacuum/apparent altitude-azimuth, rise/set and visibility windows; source expiry and uncertainty remain visible | In progress |
| Orbit uncertainty | Pinned SBDB covariance with labels, units and solution epoch; validated covariance propagation and sampling; uncertainty ellipsoids and event distributions, independent of numerical tolerance | In progress: source ingestion only |
| Occultations and eclipses | Source-backed radii/orientation and stellar astrometry; bounded contact/window search, missed-event and physical-error reporting, independent reference cases | Pending |
| Dynamics laboratory | Explicit initial conditions, force models and parameters; validated selected-target integration, non-gravitational terms where sourced, resonance/stability diagnostics and reproducible exports | Pending |
| Scientific data | Audit and extend useful SPK windows, genuine spacecraft trajectories, non-elliptic comet support, physical parameters and spatially chunked Gaia data; never fabricate missing states or mutate immutable releases | Pending |
| Catalog streaming | Replace the fixed 8k/30k-only cloud path with cancellable binary chunk loading, priority scheduling and independent byte/decode/compute/upload limits | In progress: full-inventory 2D snapshot now available; continuous/3D streaming, priority and spatial scheduling pending |
| Rendering and time | Moving spatial bounds, visibility/LOD, selected-body retention, time/error-budgeted updates, reusable buffers and Float64-relative GPU coordinates; WebGL fallback and native contracts retained | In progress |
| Capacity evidence | Real catalog runs at 30k/100k/300k/1m/full inventory, real SPK coverage and separately labeled synthetic GPU stress; P95/P99 frames, memory, first-visible time, upload and cancellation measurements | In progress |

Full completion requires implementation, user-facing access, source ingestion,
scientific references and appropriate integration evidence for each row. A model
module, design document, fixture-only test or configurable point ceiling is not
completion. Hardware that has not been exercised remains an explicit evidence
gap. Do not claim physical accuracy from numerical agreement.

## Starting evidence and corrections

- Baseline: `e2272c2a2fef96253c6d990039a20068b3751d62`.
- The audited MPC release has 1,561,171 records. Immutable display samples are
  8,000 mobile / 30,000 desktop. Higher display budgets are not delivery proof.
- Event and Lambert code already consults loaded SPK kernels. The next change
  must improve explicit source policy, consistency and evidence rather than
  duplicate that capability. Existing README model descriptions understate it.
- Source-backed states and provenance already share backend evaluation caches;
  bounded tile admission, persistent point workers and GPU point buffers exist.
- Current GPU cloud buffers are drawn by prefix and not spatially culled.
- N-body research is now an explicitly requested extension to the earlier
  no-N-body product scope; it must remain distinct from authoritative SPK queries.

## Validation and delivery

Develop coherent slices, run relevant numerical/contract/interaction tests while
iterating, and run the required broad checks once for a completed staging head.
Keep production/data release workflows paused. Record completion evidence and
remaining work here; never mark the overall goal complete with pending rows.

Avoid duplicate CI work: desktop/mobile Chromium interaction suites belong to
the required four-browser matrix, not a second run in the Web job. Web retains
lint, unit/scientific checks, production build, Lighthouse and preview coverage.
After a main push, native jobs may reuse a successful exact-SHA quality run only
when both Android and iOS jobs completed successfully within 24 hours. The
workflow/repository identity and all job pages must be verified. Missing, stale,
skipped or unreadable evidence falls back to full native validation. Staging,
pull requests and manual native runs always validate normally; branch-protection
requirements are unchanged. Reuse logs link the original evidence and artifacts.
Live acceptance: main run 35769849829 on `71f29ad` verified and linked successful
quality run 35766649508, completed its validation-scope job successfully, and
skipped duplicate Android/iOS jobs. The staging invocation ran both platforms
normally. The successful jobs retained their original completion timestamps
when the failed Android job and dependent gate were retried.

### Checkpoint 1: explicit analysis source contract (2026-09-23)

Implemented the shared Web analysis provider, strict/labeled fallback policy,
frozen whole-window kernel selection, actual per-body model evidence, mission
position/velocity reuse, bounded epoch caching, TDB elapsed flight time and
source-bearing event/transfer exports. Curves use the event's original policy.
Porkchop selections retain their original endpoints rather than whichever
endpoints the user subsequently selected.

Targeted checks: 27 numerical/cache/worker tests across seven files, TypeScript
and changed-file ESLint, production build, and six desktop/mobile Chromium
checks covering strict missing-state errors, approximate exports and the existing
Earth-to-Mars mission flow. The SPK contract test reads the checksum-pinned real
DE440 core; it checks resolver consistency, not independent physical accuracy.
No new capacity/FPS claim is made. Full Web, four browser profiles, Android,
iOS and the required gate passed on exact head `e00da30`; it was fast-forwarded
to main. Deployment and data publication remained disabled.

Still outstanding in this workstream: backend-owned analysis jobs, automatic
bounded source preflight instead of relying on the loaded browser pool, native
consumption, and independent event-oracle validation. The other ledger rows
remain pending; this checkpoint does not complete the overall goal.

### Checkpoint 2: source-backed ground directions (2026-09-23)

Implemented immutable IERS ingestion/validation, leap-aware EOP interpolation,
GoFA/SOFA coordinate transforms with real SPK states, bounded/cancellable ground
observation API, bilingual inspector form and full source-bearing JSON export.
The initial slice calculates one observation instant. Mathematical directions
below the horizon are not labeled visible. Unavailable EOP/SPK, missing celestial
pole corrections, predictions, future leap-second assumptions and excluded
physics remain explicit. GoFA is pinned with its attribution/license notices.

Recorded reference results and the unresolved Horizons model-chain difference
are documented in [ground-observation.md](ground-observation.md). No empirical
calibration or physical uncertainty claim is substituted for that investigation.
Rise/set and visibility searches, native consumption, source-refresh UI and
physical uncertainty propagation remain outstanding. All other pending ledger
rows and the remaining shared-analysis work remain part of the active goal.

Local checks: the Go suite passed once, followed by a targeted observation
rerun after adding solution-consistency rejection; changed-package `go vet`,
TypeScript, changed-file ESLint and repository checks passed. Thirty-three
client/transport tests passed. Six desktop/mobile Chromium checks passed,
including actual requests to the local Go service with the full pinned IERS
snapshot and original DE440 SPK, export, cancel/error behavior and existing
observer diagnostics. Error/cancel cases deliberately inject service responses.
No remote deployment or new capacity claim is implied. All required remote
checks, including native iOS/Android and four browser profiles, passed on
`e042628`; that exact head was fast-forwarded to main with deployment and
data-publication workflows still disabled.

### Checkpoint 3: bounded rise/set and visibility search (2026-09-23)

Added a backend search and bilingual inspector access for target-center
airless altitude plus optional Sun-altitude limits. Window jobs retain a single
SPK source identity, use leap-aware TAI elapsed time, and report missing or
unresolved intervals separately. They are cancellable, deadline/evaluation
bounded and scheduled with trajectory work. JSON exports include the original
request, crossing brackets, windows, gaps, actual kernels and IERS snapshot.
Thirty-second sampling and 0.25-second root brackets are explicit numerical
limits; sub-step/tangent events are not guaranteed and physical uncertainty is
not propagated. This is not conventional refracted upper-limb sunrise/sunset.

Validation: targeted Go observation/API suites and vet, 42 transport/client
tests, production build and four desktop/mobile Chromium window checks passed.
Existing point-observation and Moon diagnostic browser checks also passed.
Successful local UI requests used the actual Go backend with pinned full IERS
and DE440; cancellation tests deliberately delayed fixture responses. Five
independent ERFA/jplephem full-day cases passed, with all crossing residuals
within their numeric brackets (largest absolute difference 0.108 seconds).
No repeated full local suite or production deployment was used. All required
remote checks passed on `b11b6aa`, including four browser profiles, Android,
iOS and the stable gate; that exact head was fast-forwarded to main. Deployment
and dataset-publication workflows remained disabled.

Native observer consumption, source-refresh UI, physical uncertainty and the
other ledger rows remain outstanding. The overall goal is still active.

### Checkpoint 4: prepared point computation and real input tiers (2026-09-23)

The production worker prepares invariant Float64 rotation/scale coefficients
once per element set and yields in 20,000-row blocks during preparation and
propagation. Generation invalidation prevents reset/replacement from publishing
stale output. The prepared range API accepts caller-owned destination buffers;
the existing worker still transfers one newly allocated dimension-specific
output per completed job. No unsupported buffer-recycling claim is made.

All 313 binary shards of the 1,561,171-row MPC release were checksum-verified
for CPU and isolated production Chromium worker measurements at 30k, 100k,
300k, 1m and the complete count. This is real catalog input, not a claim that
the product now loads or renders the full inventory. CPU median full-count
time changed from 261.14 to 186.02 ms; retained prepared data costs 80 rather
than 64 bytes per record. Browser worker cancellation completed a fresh empty
job in 3.6 ms without stale publication. Numerical output, runtime, hashes and
measurement limitations are recorded in
[point-pipeline-performance.md](point-pipeline-performance.md).

Twenty-one targeted numerical/worker/scheduler tests, TypeScript, changed-file
ESLint, production build and four desktop/mobile Chromium sample/mode-switch
checks passed. Remote run 35764210075 passed Web, all four browser profiles and
Android on `69bbbaa`, but iOS coverage UI timed out waiting for its success label;
the captured hierarchy then contained that exact label. The failed run remains
evidence. Combined head `71f29ad` subsequently passed all required checks in run
35766649508 and was fast-forwarded to main. Its first Android attempt failed
while downloading the emulator ZIP; only failed jobs and the gate were retried,
retaining the successful Web/browser/iOS results. No assertion was weakened or
failed result treated as success. Deployment and publication remained disabled.
Production streaming, relative GPU coordinates, LOD, app frame and
memory evidence and all other uncompleted rows remain part of the active goal.

### Checkpoint 5: persistent catalog GPU resources (2026-09-23)

The two-dimensional catalog canvas retains its WebGL program and three buffers.
Epoch changes upload only positions; viewport/radius/opacity changes reuse all
attributes. Exact-sized backing stores release excess capacity after selection
shrink. RGB appearance and a shared opacity uniform reduce static attributes
from 20 to 16 bytes per point, with the original Float32 color precision.
Lost contexts show a bilingual unavailable state, and restoration reconstructs
the latest frame. Failed initialization and unmount release owned resources.
The map now states its approximate heliocentric two-body/ecliptic model and the
actual completed UTC epoch, including during the existing five-second playback
sampling. No interpolation or simultaneous-epoch accuracy is implied.

Five resource lifecycle unit checks, TypeScript, changed-file lint and the
production build passed. Actual desktop/mobile Chromium, Firefox and WebKit exercised changing
epochs, resize, WEBGL_lose_context loss/restoration, non-background point pixels,
no WebGL errors and balanced disposal. This UI test uses three synthetic records;
it establishes lifecycle correctness, not large-inventory FPS or device capacity.
All required remote checks passed on exact head `71f29ad`, which was
fast-forwarded to main with deployment and dataset publication disabled.

### Checkpoint 6: cancellable catalog scan transport (2026-09-23)

The scan worker now carries cancellation into compact-index, numeric, JSON and
gzip reads. A shared network load counts its consumers: cancelling one caller
rejects that caller promptly, while the download continues for a remaining
consumer. The last consumer aborts the request and releases the stream reader;
partial bytes never become a result or cache entry. Cancelled validation does
not invalidate an otherwise valid shared cache record. A failed numeric shard
also cancels its unfinished metadata peer. Only completed compact buffers enter
the two-entry worker cache, so a new scan cannot inherit an aborted promise.
Changing filters clears the cancelled scan's busy state and permits immediate
retry; cancelled generations cannot publish old progress or results.

Thirty-two targeted cache, bounded-stream, loader and worker tests passed,
alongside TypeScript, changed-file lint and the production build. The actual
Chromium desktop/mobile, Firefox and WebKit production worker was exercised
against a same-origin local HTTP server with a deliberately unfinished response:
filter change closed the response and a fresh scan returned the correct total.
Three existing browser hydration checks also passed. The server uses synthetic
catalog records and establishes cancellation behavior, not catalog capacity.
Playwright route interception was removed from this transport test: a separate
Firefox probe showed that intercepted Worker fetches can retain the proxy
connection even after AbortError, unlike the browser's direct same-origin path.

This slice covers scan-worker transport. General shard concurrency admission
and large-inventory point streaming still require budget work. The following
checkpoint extends cancellation into main-thread hydration. Remote validation
and main promotion of these cancellation changes remain pending.

### Checkpoint 7: shared decoded data and cancellable hydration (2026-09-23)

Name search, ID lookup, sample loading, chunk detail and both paging directions
now pass cancellation into transport. Decoded cache entries count active
consumers separately from their bounded completed-value LRU: one cancelled
caller cannot terminate another caller's shared download, pending ownership is
not evicted with completed values, and the final departing consumer aborts the
remaining reads. Reset and failure release owned requests; cancelled searches
cannot fall through to legacy buckets. Paired numeric/metadata reads
cancel each other on failure. Browser history replacement cancels old catalog
ID hydration and surfaces current hydration errors rather than unhandled
promise rejection. Mutable manifest/provenance and SBDB loading retain their
existing lifetimes; this is not a claim that every source is cancellable.

The scan remains cancellable through result hydration. Cancelled generations
cannot install or delete a newer paging queue. Page cancellation preserves its
cursor for retry, overlapping page consumption is rejected, and filter changes
discard the old queue and its active download. The UI aborts obsolete search,
browse and exact-result page requests on replacement or unmount.

Thirty-eight focused unit checks passed, including shared ownership, reset,
legacy-fallback suppression, sibling failure and stale-hydration races.
TypeScript, changed-file lint and the production build passed. Twenty-one
targeted production-browser checks passed across desktop/mobile Chromium,
Firefox and WebKit; synthetic same-origin HTTP fixtures verified actual socket
closure and successful replacement for compact scans, result hydration and
name search. Existing sample and hydration behavior remained covered. This is
transport/lifecycle evidence, not full-catalog memory or FPS evidence. Exact-head
remote validation and main promotion remain pending; the overall goal is active.

Navigation follow-up: completed result-page cursors remain available when leaving
and returning to the catalog. Only a changed filter invalidates that retained
queue; active downloads still cancel on unmount. The earlier cleanup could turn
the next page into an empty result after navigation. Four-browser navigation
checks now verify the retained first-page identity and a different next page,
each bounded to 480 rows; pages replace rather than accumulate records. Four
hydration-cancellation checks also pass after this correction. Staging head
`94fafbc` predates this correction and will not be promoted on its own, even if
its existing checks pass. The corrected combined head must pass the gate.

### Checkpoint 8: Float64 catalog snapshots before relative GPU conversion (2026-09-23)

Catalog point workers now retain Float64 results through transport. Each 2D/3D
reference pane subtracts its own Float64 origin before projecting or rounding
positions into Float32 GPU storage. This removes premature absolute-coordinate
rounding without changing the MPC model or treating its elements as precise
SPK states. The heliocentric catalog map explicitly converts its zero-origin
upload array. Worker results validate precision as well as mode, epoch and
count; mode switches still retain only one dimensional output per worker.

Thirty-eight focused numerical/geometry/worker checks passed, including small
relative displacements near 100 AU, independent comparison-pane origins and
513 scalar-evaluator comparisons. TypeScript, lint, build and eight targeted
four-browser checks passed. The checksum-verified full 1,561,171-row production
worker benchmark is recorded in [point-pipeline-performance.md](point-pipeline-performance.md).
It reports 281.6 ms median full-count computation and 2.9 ms cancellation,
not rendered FPS. Snapshot bytes double (37,468,104 bytes for a full 3D array);
GPU attribute bytes remain Float32. No total memory-capacity claim is made.
Arbitrary camera-focus recentering, budgeted full-inventory streaming, LOD and
the other pending workstreams remain open. Remote validation/main promotion
of this precision change remain pending; deployment/publication stay paused.

### Checkpoint 9: immutable SBDB covariance source ingestion (2026-09-23)

Added an explicit single-request ingestion tool and a solution-epoch matrix
parser. Original responses and acquisition receipts are content-addressed;
existing bytes are never overwritten. The parser checks API identity, solution
and epoch consistency, units, labels, dimensions, symmetry and positive
semidefiniteness using a normalized correlation matrix. It retains extra
estimated parameters and correlations, without fabricating missing covariance,
substituting standard-epoch elements or repairing eigenvalues. Limits and
remaining work are documented in [orbit-uncertainty.md](orbit-uncertainty.md).

The pinned real Eros solution 659 has covariance and standard-element epochs
separated by 7,889 days. Its matrix audit agrees with independent NumPy 2.4.2
eigenvalues within 2e-14. Thirty-six targeted parser/ingestion/existing SBDB tests,
TypeScript, changed-file lint and the repository contract passed. A real CLI
retrieval at 2026-09-22T19:14:29.441Z saved 14,735 bytes with SHA-256
`39728661c62669f2876f4048aa55d43d1058df97c12e1d9c3e87e4e971400ac4`;
its audited values matched the earlier pinned fixture. Different response byte
ordering can produce different hashes even when the audited values agree.

A second live acquisition pinned Bennu solution 118 at 2026-09-22T19:20:33.434Z
(13,850 bytes, SHA-256
`8cc7ff03d7fec9e15016d7ab0e78edc7a0e4d69227a322cde7190518a24ccb90`).
Its eight-dimensional matrix includes density and area-to-mass ratio in a
different order from the source model-parameter list. The parser preserves
matrix-axis identity and cross correlations; all eight eigenvalues agree with
independent NumPy 2.4.2 evaluation within 2e-14. The additional source regression
passes without changing the parser. Both raw fixtures retain retrieval metadata.

This is source ingestion and mathematical validation only. Propagation,
sampling, independent dynamical references, user-facing access and ellipsoids
remain unfinished, as do the other outstanding ledger rows. No event probability,
physical accuracy or production publication is claimed. The combined corrected
head still requires remote validation before main promotion.

### Checkpoint 10: bounded shared artifact acquisition (2026-09-23)

Immutable catalog delivery admits four distinct artifacts per JavaScript realm.
The lease covers source/cache loading and active consumer validation, so a burst
of paired shard requests cannot all start together or outrun slow validation.
An existing shared artifact does not require another slot. Queued cancellations
leave immediately without starting I/O; the last consumer cancels its producer,
but an unsettled producer retains its slot until it actually settles. Leases
release once on success, failure and cancellation.

Thirty-six targeted admission/cache/loader tests passed. TypeScript, changed-file
lint and the production build passed. Twenty focused browser checks passed
across desktop/mobile Chromium, Firefox and WebKit, including eight-shard search
hydration with at most four admitted responses, all matches retained, actual
same-origin cancellation and exact paging after navigation. Route-controlled
response tests establish admission behavior; they are not throughput benchmarks.

This per-realm acquisition bound is not a total memory bound: main-thread and
worker budgets are separate, completed decoded values and persistence writes
have other lifetimes, and consumer-owned buffers are outside the admission
count. Priority, byte/decode/compute/upload budgets, cross-realm coordination and
the full-inventory display path remain unfinished. Main promotion is pending.

### Checkpoint 11: independent sample and query loading state (2026-09-23)

Remote WebKit run 35772599440 on `0916add` exposed a genuine race: an initial
sample completing during a name search cleared the search's loading state.
The test reproduced this deterministically on local Chromium by delaying the
sample summary until the search was pending; its disabled-button assertion
failed before the fix. Samples now own their loading/error fields, and late
sample publication preserves search/exact-result completeness metadata.
Post-manifest selected-ID hydration likewise cannot clear a newer query's
loading state on failure. All three sample consumers display transport errors.

After the fix, 28 focused checks passed across all four browser profiles,
including the deterministically ordered sample/search race, actual cancellation,
bounded concurrent hydration, retained paging, lazy samples and invalid source
tuples. TypeScript, changed-file lint and the production build passed. The old
staging head is not promoted; the corrected head requires a fresh quality gate.
The same WebKit run also recorded a retried Saturn access-control error before
that test passed; it remains separate evidence, not a weakened assertion.

### Checkpoint 12: separately labeled synthetic renderer capacity (2026-09-23)

Added a standalone harness using the actual two-dimensional catalog renderer
with deterministic synthetic dense-disk inputs at 30k, 100k, 300k, 1m and the
full catalog's point count. It records renderer identity, source hashes,
headless animation-frame intervals, CPU submission timing, upload/allocation
counts, explicit attribute bytes and rendered-pixel/error checks. Reports are
write-once. The local browser used SwiftShader software rendering: callback
cadence was about 60 Hz through 300k, 21.4 Hz at 1m and 14.0 Hz at 1,561,171.
Full-count P95/P99 callback intervals were 83.4 ms. All tiers retained three
attribute allocations and updated only positions; no WebGL error occurred.

The report and measurement limits are linked from
[point-pipeline-performance.md](point-pipeline-performance.md). This is not a
physical GPU or display-FPS result, nor actual full-inventory application
streaming. Renderer submission time is not GPU execution time, and explicit
buffer bytes are not measured process memory. Hardware/native evidence and
combined compute/render/streaming measurements remain required. The current
8k/30k product sample ceilings remain unchanged.

Hardware follow-up: a second report used new-headless Chromium with D3D11 and
verified the unmasked NVIDIA GeForce RTX 5070 Ti against the Windows device
inventory. All five synthetic tiers completed 180 callbacks near 60 Hz. At
1,561,171 points P95/P99 callback intervals were 16.8 ms and upload submission
P95 was 1.0 ms, with the same buffer/pixel/error checks passing. This closes one
standalone desktop GPU evidence gap only; combined full-product streaming,
native hardware, other devices and total memory measurements remain open. The
software/hardware runs also used different browser modes, precluding a causal
GPU-only speedup claim.

### Checkpoint 13: full-source 2D snapshot in the application (2026-09-23)

The Catalog workspace now loads beyond immutable display samples through a
source-backed expanded snapshot. It exposes requested/actual point capacity,
source coverage, a fixed UTC epoch, refresh, stop, sample fallback and independent
view radius. Changing filters invalidates the old snapshot; capped source-order
coverage is explicitly partial. The worker checks SHA-256, source/index row
identity, flags and exact Float64 orbital fields. Four binary shards are admitted
at once; upload acknowledgements prevent a backlog of computed snapshots.
Context restoration reuses retained attributes without refetching the source.

Both actual built-application runs completed all 313 shards and 1,561,171 rows.
NVIDIA RTX 5070 Ti / D3D11 took 5.44 s with callback P95/P99 16.8 ms and no
observed main-thread long tasks. SwiftShader took 13.26 s with P95 66.7 ms,
P99 83.4 ms and 112 long tasks. Both observed four active binary responses,
three GPU allocations, 37,468,104 uploaded attribute bytes, actual rendered
pixels and no page/WebGL error. These are local HTTP static snapshots, not
continuous full-catalog simulation or display-FPS evidence. Reports, assumptions
and remaining capacity work are in [point-pipeline-performance.md](point-pipeline-performance.md).

Twenty-three focused numerical/streaming/GPU unit checks passed. The previous
four-browser GPU lifecycle checks passed, and the new source snapshot,
cancellation/refresh and corrupt-source rejection contracts are verified in all
four browser profiles. Real browser IndexedDB checks now bundle the production
dependency graph: run 35774626604 exposed a stale hand-maintained test loader
after admission was introduced. That run passed Web, Android and iOS but failed
the three cache tests in every browser. It is not eligible for main promotion.
The corrected dependency bundle passes all twelve focused cache checks.

The combined head still requires its remote gate. Continuous/3D streaming,
priority/spatial scheduling, total memory evidence and the unfinished scientific
ledger rows remain open. Deployment and publication remain paused.

Primary design references: [SOFA](https://www.iausofa.org/cookbooks),
[IERS EOP](https://data.iers.org/eop.php),
[JPL SBDB](https://ssd-api.jpl.nasa.gov/doc/sbdb.html),
[SPICE Geometry Finder](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html),
[ASSIST](https://assist.readthedocs.io/en/latest/),
[Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3).
JPL SSD ingestion must obey its
[single-request fair-use policy](https://ssd-api.jpl.nasa.gov/doc/index.php).
