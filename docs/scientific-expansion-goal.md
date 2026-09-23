# Scientific expansion and real-time scale

Owner-authorized goal, 2026-09-22 (Asia/Singapore). Implementation tracker, not a
claim that the proposed capabilities already exist. Deployment and publication
remain paused. Changes may go directly to main after the required checks.

## Acceptance ledger

| Workstream | Required observable outcome | Status |
| --- | --- | --- |
| Shared analysis ephemeris | Events, curves and mission endpoints use a frozen source contract, expose actual per-body models, offer strict SPK coverage, and export time/frame/source evidence; shared backend integration follows | In progress |
| Ground observer | Geodetic station, SOFA-compatible celestial/terrestrial transforms, versioned IERS EOP, vacuum/apparent altitude-azimuth, rise/set and visibility windows; source expiry and uncertainty remain visible | In progress |
| Orbit uncertainty | Pinned SBDB covariance with labels, units and solution epoch; validated covariance propagation and sampling; uncertainty ellipsoids and event distributions, independent of numerical tolerance | In progress: source ingestion, solution-epoch Cartesian conversion, reproducible sampling, browser inspection and 3D position ellipsoids; model-aware temporal propagation and event distributions pending |
| Occultations and eclipses | Source-backed radii/orientation and stellar astrometry; bounded contact/window search, missed-event and physical-error reporting, independent reference cases | Pending |
| Dynamics laboratory | Explicit initial conditions, force models and parameters; validated selected-target integration, non-gravitational terms where sourced, resonance/stability diagnostics and reproducible exports | In progress: bounded integration, variational equations, pinned DE440 adapter and browser/offline source-bearing experiments; additional forces, full covariance, native access and long-term diagnostics pending |
| Scientific data | Audit and extend useful SPK windows, genuine spacecraft trajectories, non-elliptic comet support, physical parameters and spatially chunked Gaia data; never fabricate missing states or mutate immutable releases | Pending |
| Catalog streaming | Replace the fixed 8k/30k-only cloud path with cancellable binary chunk loading, priority scheduling and independent byte/decode/compute/upload limits | In progress: full-inventory 2D snapshot, bounded upload batching and spatial display available; continuous/3D streaming and source-priority scheduling pending |
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
The owner's latest instruction prohibits full local test runs; local verification
must remain targeted. Required remote checks still govern main promotion.
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

Combined head `5a8131e` passed all required remote checks in run 35777679758:
Web, all four browser profiles, Android, iOS and the stable gate. It was
fast-forwarded to main; main native-scope run 35779921145 verified exact-head
evidence and reused the successful native jobs. This also delivers checkpoints
6 through 12 and the browser cache-loader correction. Continuous/3D streaming,
priority/spatial scheduling, total memory evidence and the unfinished scientific
ledger rows remain open. Deployment and publication remain paused.

### Checkpoint 14: bounded transfer windows and batched uploads (2026-09-23)

The worker/main boundary now permits four computed tiles, with individual upload
credits and an explicit final drain. The main thread uploads ready tiles within
a 3 ms between-tile budget, then draws once per batch. Duplicate acknowledgements
cannot increase capacity; cancellation and failed transfers release waiters.
This retains complete source coverage and precision while reducing repeated
draws. Progress counters no longer cause repeated live-region announcements.

Twenty-one focused transfer/stream/GPU unit checks and sixteen four-browser
checks passed. The browser test uses the real worker, holds acknowledgements
until four tiles are pending, verifies that completion is still withheld, then
releases credits and verifies all eight source shards. Two new actual full-source
application benchmarks retained all 1,561,171 rows, four network requests and
four transfer credits at peak, three GPU allocations and the same total upload
bytes. D3D11 snapshot time fell from 5.44 to 1.52 s and SwiftShader from 13.26 to
3.74 s in separate local runs. Draw calls fell from 315 to 81. SwiftShader still
had P95/P99 callback intervals of 83.3/83.4 ms and 32 long tasks, so this is not a
claim of smooth continuous rendering on software. Details and immutable reports
are linked from [point-pipeline-performance.md](point-pipeline-performance.md).

Spatial/time/error budgets, continuous/3D streaming, measured total memory and
the unfinished scientific ledger rows remain required. The new optimization
must pass its remote gate; a local benchmark does not authorize main promotion.

### Checkpoint 15: spatial representatives over the complete snapshot (2026-09-23)

Expanded snapshots now offer deterministic representatives per occupied screen
cell, with a separate display limit and immediate switching to all loaded
points. Source rows still undergo the same checksum verification, Float64
propagation and complete attribute upload. Radius/detail changes only recompute
visual indices in the retained worker; they do not reload or propagate source
orbits. Obsolete requests cancel cooperatively, and changing only the loaded
prefix preserves the earlier partial image while new indices are calculated.
The UI distinguishes source coverage, loaded capacity, displayed points and
points inside the view. Representatives do not estimate density or event risk.

Three immutable built-application reports compare the same 545 by 698 canvas.
All checked and loaded all 1,561,171 source rows. With SwiftShader, drawing all
points took 3.55 s with callback P95/P99 66.7/83.4 ms and 30 long tasks; the
34,505 spatial representatives completed in 1.54 s, with P95/P99 16.8 ms and
no observed long task. D3D11 representatives completed in 1.55 s with the same
callback quantiles. Each retained the original three attribute buffers; spatial
selection used one additional 138,020-byte final index buffer. Reports and
limits are in [point-pipeline-performance.md](point-pipeline-performance.md).
These are fixed-epoch 2D snapshots and callback timings, not continuous
million-body simulation, display FPS, total memory or native-device evidence.

Twenty-seven focused units and twenty-four targeted browser checks passed before
the final context-loss follow-up. A deterministic real-worker regression then
reproduced a stale selection changing a completed snapshot to an error while
its GPU context was lost. Context loss now invalidates that pending selection;
restoration rebuilds attributes and requests fresh indices. All four browser
profiles passed that regression after the fix; changed-file lint, production
build/type checking and the repository contract also passed. The reports pin the
pre-follow-up implementation; this lifecycle-only correction does not change
their measured no-context-loss path. Required remote validation of checkpoints
14 and 15 remains pending. Adaptive/time/error budgets, continuous/3D streaming,
total memory measurements and every unfinished scientific ledger row remain
part of the active goal.

Remote follow-up: run 35810288605 on `1e21bf2` passed repository, Web, all four
browser profiles and Android. Its first iOS attempt failed the first tutorial
tap and the Earth preset tap: retained accessibility trees still showed the
original controls and default selection, and no state HTTP request was made.
The real SPK/Web/Swift numerical golden checks passed. This evidence does not
yet establish whether input delivery or application behavior caused the UI
failures. Only failed iOS/gate jobs were retried on the same head; successful
jobs and the first failed artifact remain evidence. The same-head retry passed
iOS and the stable gate without assertion changes. All applicable jobs passed;
`1e21bf2` was fast-forwarded to main. The initial UI failure cause remains
unresolved rather than being declared fixed by a passing retry.

### Checkpoint 16: joint state covariance and reproducible offsets (2026-09-23)

Added a solution-epoch elliptic element-to-Cartesian covariance conversion with
an analytic Jacobian and explicitly adopted/source-labeled solar GM. All
additional covariance axes and state/parameter cross-correlations survive the
joint transformation. The source solution epoch cannot be replaced by the
standard element epoch. Unsupported near-parabolic/non-elliptic cases fail
explicitly. This initializes a possible later dynamics calculation; it does
not integrate the source force model or propagate uncertainty through time.

A second module produces bounded, seeded joint Gaussian parameter offsets with
dimensionless Cholesky factorization and no matrix repairs. Time offsets remain
separate from large nominal Julian dates. All draws are retained without hidden
physical-parameter rejection. The CLI exports immutable source/GM/implementation
receipts, joint matrices and optional reproducible offsets from existing source
files. It does not acquire or publish data.

Forty targeted ingestion/conversion/sampling/export tests passed, plus TypeScript
and changed-file lint. Ten independent mpmath 80-digit / CSPICE reference cases
cover the two original SBDB sources and conic boundary/phase cases. Real Eros
and Bennu CLI exports succeeded; a Bennu receipt also retained all eight axes
for 1,000 seeded draws. Details, reproduction commands and numerical limits
are in [orbit-uncertainty.md](orbit-uncertainty.md). No full local tests ran.
Temporal force-model propagation, Web/native access, ellipsoids, event
distributions and all other unfinished ledger requirements remain open.

### Checkpoint 17: browser covariance inspection (2026-09-23)

The Evidence page now imports bounded local SBDB covariance JSON, displays the
source solution/standard epochs and all model axes, and explicitly adopts the
verified DE440 GM for solution-epoch coordinate conversion. It shows coordinate
standard deviations and three labeled 2D projected covariance contours; JSON
export retains the original byte hash, parsed source audit and joint matrix.
Replacement/clear invalidates old results. Mobile source hashes wrap within
the panel, and controls use the existing application styles.

Four projection unit checks and eight focused browser checks passed across all
four profiles, including eight-axis Bennu export, invalid replacement, clearing
and oversized input. Production build, type checking and changed-file lint were
used; no full local suite ran. Remote validation of checkpoints 16 and 17 is
still pending. Time propagation, source acquisition, native uncertainty access,
3D ellipsoids and the other unfinished goal rows remain open.

Post-commit numerical follow-up: direct 2D determinant multiplication could
underflow at `1e-200` variance and erase a real short axis. Normalized eigenvalues
and correlation preserve it without clipping. Five focused units now cover
tiny/large variance, extreme anisotropy and display-unit scaling, and the four
browser import/export checks passed after the change. This follow-up is held
locally while remote run 35812468105 validates `144b590`; do not replace its
head during healthy native jobs. Run 35812468105 subsequently passed all jobs
on `144b590`, which was fast-forwarded to main. The contour correction still
requires its own exact-head gate.

### Checkpoint 18: adaptive dynamics and variational foundation (2026-09-23)

Added a bounded, cancellable Dormand–Prince 5(4) integrator with per-component
tolerances, explicit maximum step/attempts, compensated state/time summation and
reused stage buffers. A separate prescribed point-mass evaluator requires
geometric J2000/SSB/TDB sources and explicit GM provenance/exclusion distances.
Its analytic gradient evolves a 6x6 state transition matrix, conditional on
fixed parameters. It does not claim complete SBDB covariance propagation.

Fourteen focused tests passed. Independent 70-digit Kepler derivatives exposed
a cancellation-sensitive deficiency in the initial DOP853-only reference; both
reference results remain recorded. The corrected comparison retained its
original threshold and now passes in both time directions and with a synthetic
moving perturber. Details and limits are in
[dynamics-laboratory.md](dynamics-laboratory.md). TypeScript and changed-file lint
passed. No full local suite ran. Real SPK perturbations, full force models,
source uncertainty, UI, diagnostics and every unfinished ledger item remain open.

Remote follow-up: run 35813379051 passed every applicable gate on `f18a321`,
including all four browser profiles and native Android/iOS. That exact head was
fast-forwarded to main, delivering the contour correction and checkpoint 18.

### Checkpoint 19: real SPK-driven restricted dynamics (2026-09-23)

Added a byte-verified, owned DE440 kernel/GM adapter with geometric J2000/SSB/TDB
states and a frozen full integration window. Its eleven-mass selection separates
Earth/Moon and never adds their barycenter twice; other planetary systems use
their explicitly labeled total-GM point-mass representation. Missing state,
corrupt source, unknown exclusion or uncovered interval fails without fallback.

Independent CSPICE/DOP853 references now include real Eros initial conditions,
eleven actual perturbing source trajectories, and all 42 state/transition entries
at backward/forward 10 and forward 30 days. Seven targeted adapter/export tests
passed, along with TypeScript and changed-file lint. The actual offline CLI
completed a 30-day Eros experiment in 122 accepted steps / 733 force evaluations
and exported immutable source/implementation/model evidence. No full local test
suite or deployment/publication was run.

The source-orbit residual remains visible: about 22 m at 10 days and 191 m at
30 days for this restricted model, distinct from its much smaller numerical
disagreement with independent integration. See [dynamics-laboratory.md](dynamics-laboratory.md).
Full source-fit dynamics, additional parameter covariance, physical uncertainty,
UI/native access and long-term diagnostics are not delivered by this foundation.

### Checkpoint 20: interactive source-backed experiments (2026-09-23)

The Evidence page now offers a bilingual experiment panel with the source-backed
Eros initial example, initial-state inspection/template export, custom JSON
import, signed duration, explicit exclusion distance, run/cancel and result
export. A dedicated Worker owns each experiment and bounded source fetch; no
calculation blocks the UI thread. Input edits/unmount/cancel invalidate prior
work. Browser and CLI share their parser and numerical experiment function.

Sixteen targeted four-profile browser checks passed using actual Worker/kernel
bytes and independent reference comparisons, including corrupt-source rejection,
template round-trip and held-request cancellation. Seven targeted source/CLI
checks passed after the shared-core refactor. Production build, TypeScript,
changed-file lint and mobile screenshot inspection were used; no full local
suite ran. The new source adapter and browser panel still need their exact-head
remote gate. Native laboratory access, richer forces, full joint covariance,
trajectory/long-term diagnostics and the other ledger requirements remain open.

### Checkpoint 21: bounded trajectories and refinement comparison (2026-09-23)

The shared experiment now retains at most 2,048 actual accepted nodes, preserving
initial/final endpoints through progressive decimation. Exports include original
SSB states and same-source heliocentric coordinates; Web shows three J2000
projections with equal axis scaling and source/visual limitations. Optional
refinement runs tighter tolerances and smaller steps, exporting both numerical
results and their differences without claiming physical uncertainty or stability.

Twelve targeted integrator/recorder/CLI checks and four real-worker browser
checks passed. The actual Eros 30-day comparison retained 123 nodes and observed
a `1.49e-8` km endpoint-setting difference; the roughly 191 m source-orbit
model discrepancy is unchanged. Production build/type checking and changed-file
lint passed. No full local suite ran.

Remote run 35814538834 on `301e379` failed an existing Chromium catalog test
after three attempts while other completed jobs passed. Its retained trace had
an aborted summary response and its page snapshot already displayed the parsed
summary. The test waited indefinitely on `Response.finished()`. It now waits
for actual summary UI consumption before asserting the independent name search
is still busy; real network disconnect and immediate re-request assertions are
retained. All twelve targeted cancellation cases across four browser profiles
passed locally. No application behavior or timeout was weakened. The failed
head has not been promoted; do not replace it while healthy native jobs run.

### Checkpoint 22: optional solar first post-Newtonian correction (2026-09-23)

Added an explicitly adopted Sun-monopole 1PN term using the pinned Sun position,
velocity and GM, with analytic position/velocity variational derivatives and
finite weak-field/slow-motion guards. The default model stays Newtonian.
Browser and CLI select and export the actual model; changing the option clears
old results. This is not full barycentric EIH or complete source-fit dynamics.

Fourteen targeted model/source/CLI checks and eight actual-worker checks across
four browser profiles passed, including independent CSPICE/DOP853 integration
and complex-step derivative comparisons. The actual Eros 30-day experiment's
original-SPK residual decreased from approximately 191 m to 0.626 m, while its
independent-integration difference was `5.16e-8 km`. No physical-uncertainty,
arbitrary-input accuracy or new rendering-performance claim follows. Production
build/type checking and changed-file lint passed; no full local suite ran.

Run 35815461132 passed every applicable gate, including four browser profiles
and native Android/iOS, on `4ccb540`. That exact head was fast-forwarded to main,
delivering checkpoints 19–21 and the catalog-test correction. Checkpoint 22
requires its separate exact-head gate. Additional
forces, joint parameter uncertainty, long-term diagnostics, native access and
every other incomplete ledger row remain open.

Remote follow-up: run 35816227292 on `dd43c07` passed Web, four browser profiles,
Android and the source/protocol golden checks. iOS failed its first-launch
tutorial navigation assertion at ObservationUITests.swift:121. The preserved
XCTest log and accessibility tree show the original Start tutorial controls
still present after the tap; they do not establish why navigation failed.
The head contains no iOS changes. Only failed iOS/gate jobs were retried on the
same head, with no assertion changes; original artifacts are preserved. Main
promotion remains blocked on that exact-head result.

### Checkpoint 23: instantaneous conic diagnostics and source reuse (2026-09-23)

Trajectory samples now retain Sun-relative velocities and instantaneous conic
diagnostics, including hyperbolic states and explicit near-parabolic/radial
degeneracy. The browser compares initial/final values with visible frame, units
and model boundaries; both export paths retain every sampled diagnostic.
These values are not treated as invariants of perturbed or 1PN dynamics, and
their periapsis is not labeled an actual encounter prediction.

Eight independent CSPICE OSCELT reference cases cover actual Eros experiment
states and separate synthetic conics. Eighteen targeted diagnostic/recorder/CLI
checks and eight four-profile real-worker checks passed. A mobile screenshot
exposed a clipped unit column; units now appear below quantity labels, and the
focused mobile rerun passed the stricter table-overflow assertion. Build/type
checking and changed-file lint passed. No full local suite ran.

A one-epoch DE440 center-chain cache also removes repeated same-epoch Sun work
while keeping public arrays isolated and failed queries recoverable. Fourteen
targeted source/1PN/CLI checks passed for this change. Its local elapsed-time
change was under one percent; no meaningful speedup or rendering claim is made.
This batch remains local during the previous healthy native gate. Long-term
stability/resonance, full force/covariance models and all unfinished ledger
requirements remain open.

### Checkpoint 24: interactive 3D solution-epoch ellipsoids (2026-09-23)

Added a scale-aware position-marginal factorization, rotatable browser wireframe
and Web/CLI geometry exports. The UI retains true axis proportions, km scale,
source-frame offsets and explicit Gaussian contour masses. Full joint matrices
and extra model parameters remain untouched. Degenerate or unavailable geometry
does not acquire fabricated three-dimensional probability claims.

Eleven targeted factor/projection/CLI checks and four browser profile checks
passed, including rotation, contour changes, reset, source-preserving export
and input replacement. The actual Bennu CLI result retained its eight axes and
1,000 seeded offsets. Source-independent distribution values were checked with
SciPy's three-degree-of-freedom chi-square CDF; build/type checking, changed-file
lint and mobile screenshot inspection were used. No full local suite ran.

Checkpoints 23 and 24 await staging after the same-head iOS retry for checkpoint
22. Model-aware time propagation, event distributions, native uncertainty access
and every other unfinished goal requirement remain open.

Primary design references: [SOFA](https://www.iausofa.org/cookbooks),
[IERS EOP](https://data.iers.org/eop.php),
[JPL SBDB](https://ssd-api.jpl.nasa.gov/doc/sbdb.html),
[SPICE Geometry Finder](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html),
[ASSIST](https://assist.readthedocs.io/en/latest/),
[Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3).
JPL SSD ingestion must obey its
[single-request fair-use policy](https://ssd-api.jpl.nasa.gov/doc/index.php).
