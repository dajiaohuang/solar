# Scientific expansion and real-time scale

Owner-authorized goal, 2026-09-22 (Asia/Singapore). Implementation tracker, not a
claim that the proposed capabilities already exist. Deployment and publication
remain paused. Changes may go directly to main after the required checks.

## Acceptance ledger

| Workstream | Required observable outcome | Status |
| --- | --- | --- |
| Shared analysis ephemeris | Events, curves and mission endpoints use a frozen source contract, expose actual per-body models, offer strict SPK coverage, and export time/frame/source evidence; shared backend integration follows | In progress |
| Ground observer | Geodetic station, SOFA-compatible celestial/terrestrial transforms, versioned IERS EOP, vacuum/apparent altitude-azimuth, rise/set and visibility windows; source expiry and uncertainty remain visible | In progress |
| Orbit uncertainty | Pinned SBDB covariance with labels, units and solution epoch; validated covariance propagation and sampling; uncertainty ellipsoids and event distributions, independent of numerical tolerance | In progress: source ingestion, solution-epoch conversion/sampling/browser ellipsoids and offline/browser conditional six-parameter DE440 time propagation; complete fit-model propagation, native propagation and event distributions pending |
| Occultations and eclipses | Source-backed radii/orientation and stellar astrometry; bounded contact/window search, missed-event and physical-error reporting, independent reference cases | In progress: verified PCK radii, geocentric NONE/CN contacts and windows, SOFA/IERS ground CN contacts and sampled overlap windows with CLI/HTTP/browser access; complete detection, oriented/apparent limbs, native consumers and event distributions pending |
| Dynamics laboratory | Explicit initial conditions, force models and parameters; validated selected-target integration, non-gravitational terms where sourced, resonance/stability diagnostics and reproducible exports | In progress: bounded integration, variational equations, pinned DE440 adapter and browser/offline source-bearing experiments; additional forces, full covariance, native access and long-term diagnostics pending |
| Scientific data | Audit and extend useful SPK windows, genuine spacecraft trajectories, non-elliptic comet support, physical parameters and spatially chunked Gaia data; never fabricate missing states or mutate immutable releases | In progress: pinned PCK semiaxes for 95 source bodies with independent CSPICE extraction; remaining data categories, orientation and identity integration pending |
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

### Checkpoint 25: native projection cancellation ownership (2026-09-23)

Staging run 35816227292 failed iOS twice: the first attempt did not open the
tutorial; the second passed that interaction but lost its displayed projection
after background/foreground resume while retaining four verified source states.
Neither failure is treated as successful native acceptance.

Removed the view's deferred actor-wide cancellation callback, which could cancel
a newer worker after scene resume. Each request now cancels only its own worker;
generation checks prevent superseded requests from allocating or publishing after
an actor suspension. The view also checks its projection key before publication.
Protocol coverage now exercises already-cancelled requests, concurrent replacement
and cancellation, and a subsequent successful projection. Existing UI resume and
tutorial assertions remain unchanged. Locally, 13 focused native smoke/quality
contract tests and native packaging validation passed; no full local tests ran.
Windows has no Swift compiler here, so Swift compilation, protocol execution and
actual simulator acceptance remain required on the new remote candidate.

### Checkpoint 26: conditional six-parameter covariance propagation (2026-09-23)

Added bounded offline propagation from the actual SBDB covariance epoch under
an explicitly adopted DE440 point-mass model, with optional solar 1PN.
The source-root pushforward preserves correlations and rejects unmatched extra
parameters. Original bytes, force sources, implementation hashes, units and
limits accompany immutable CLI exports. An independent CSPICE/mpmath/DOP853
generator directly evolves the covariance equation for six Eros cases at
-10, 0 and +30 days across both force models. Thirteen focused checks, type
checking and changed-file lint passed; a real +30-day CLI run took 178 accepted
steps. No full local tests ran. Details and numeric thresholds are recorded in
[orbit-uncertainty.md](orbit-uncertainty.md).

This is conditional linearized propagation, not the complete SBDB fit model or
a physical error guarantee. Browser/native access, extra-parameter force
derivatives, nonlinear ensembles, event distributions and all other unfinished
ledger rows remain open. This batch remains local while candidate 613d8d4 is
undergoing remote native and browser validation; it must not cancel that run.

### Checkpoint 27: browser covariance time propagation (2026-09-23)

Connected the validated conditional covariance calculation to the shared
dynamics worker and Evidence page. The user explicitly selects duration,
exclusion distance and force adoption; the worker revalidates original source
bytes and pinned DE440. Results expose the epoch, covariance, rotatable 3D
ellipsoid and source-bearing export. Unsupported extra-parameter sources
remain inspectable but cannot be propagated by discarding axes. Cancellation,
parameter edits and source replacement terminate old workers and clear results.

Four browsers passed real propagation/export against the independent reference
and cancellation/replacement checks; four existing nominal dynamics checks
also passed after worker reuse. Types, changed-file lint and production build
passed. The mobile result screenshot was inspected without horizontal overflow.
No full local tests ran. Native access, matched additional force derivatives,
nonlinear ensembles, events and all remaining ledger requirements stay open.
Remote validation of this batch is pending behind candidate 613d8d4.

### Verified promotion: 613d8d4 (2026-09-23)

Run 35818809180 passed repository, Web, all four browser profiles, Android, iOS
and the final quality gate on exact head
`613d8d496de051ab3dde5f9d050b4fed348b09da`. This includes the unchanged iOS
tutorial and real-state background/resume assertions after request-owned
projection cancellation. That exact commit was fast-forwarded to main.
Covariance core/browser commits a760c3f and d5cd39f were then submitted as the
next candidate, without interrupting the completed native run. No deployment
or data publication was enabled.

### Checkpoint 28: pinned physical semiaxis source (2026-09-23)

Preserved the unmodified NAIF pck00011.tpc and a retrieval/hash receipt. A
verified-byte loader retains all 95 actual RADII triples, excludes commented
historical/example values, returns owned axes and reports uncertainty unknown.
It does not replace ellipsoids with mean spheres or invent SPK/catalog aliases.
CSPICE kernel-pool extraction independently verifies every triple. Three focused
checks, types and changed-file lint passed; no full local tests ran. Source
limits and reproduction are in [body-shape-sources.md](body-shape-sources.md).

Orientation, apparent limbs, contact searches, event references and consumer
identity integration remain unfinished. This data foundation does not complete
occultations, eclipses or the other pending scientific/data/performance rows.

### Checkpoint 29: source-checked spherical occultation geometry (2026-09-23)

Added bounded-domain single-epoch angular-cone geometry with stable small-angle
separation, exact spherical angular radii, explicit depth ordering and internal/
external gap values. Independent CSPICE occult references cover 21 real DE440/
PCK geocentric samples, with analytic total containment and invalid-domain cases
kept separate. All 24 focused checks passed with source hashes and actual SPK
center-chain evaluation; no full local tests ran. See
[occultation-geometry.md](occultation-geometry.md) for assumptions and thresholds.

This is not completed event analysis: contact/window searches, missed-event
reporting, light-time/topocentric/orientation integration, non-spherical limbs,
stellar targets, event distributions and consumers remain unfinished, along
with the other ledger rows. The batch remains local while d5cd39f validates.

### Verified promotion: d5cd39f (2026-09-23)

Run 35819970981 passed every repository, Web, four-browser, Android, iOS and
final-gate job for exact head `d5cd39f82667d80e04b1150eee1c174784f87fba`.
That commit was fast-forwarded to main, delivering the conditional covariance
core/CLI and cancellable browser propagation. Deployment/publication stay paused.

### Checkpoint 30: bounded offline contact searches (2026-09-23)

Added cancellable external/internal gap scans with bisection brackets, endpoint
states, explicit evaluation/result budgets and permanent missed-event disclosure.
An empty contact list is not a proof of no events. Independent CSPICE GF windows
verify four Venus contacts and two contacts each for two Sun-Moon cases; nine
focused search/CLI checks passed. The real CLI example used 349 geometry
evaluations and exports source/implementation hashes with numerical/physical
limits. Types and changed-file lint passed; no full local tests ran. Details are
in [occultation-geometry.md](occultation-geometry.md).

This offline sphere prototype does not complete event analysis. Certified
coverage, grazing contacts, apparent/topocentric integration, oriented limbs,
stellar events, event uncertainty and Web/native consumers remain open together
with all other unfinished ledger rows. This batch requires remote validation.

### Checkpoint 31: converged reception contact model (2026-09-23)

Added explicit CN reception to offline occultation searches. Each target uses
a fixed reception observer and its iterated emission state in relative TDB
seconds. Source padding, iteration limits, residuals and state-request counts
are bounded and exported; margin/coverage failures cannot fall back to NONE.
Independent CSPICE CN directions and all eight contact times agree within the
documented numerical thresholds. Seven focused core/export checks, types and
changed-file lint passed; no full local tests ran. The real Venus example shifted
333-382 seconds from NONE and matched CN references within about 1-4 milliseconds.

This comparison is not physical timing certification. Differential limb light
time, stellar aberration/deflection, topocentric visibility, oriented shapes,
complete/grazing detection, event distributions and Web/native consumers remain
open, alongside the broader ledger. Candidate 14836ae is still validating; this
new batch must not interrupt its native jobs. Details are in
[occultation-geometry.md](occultation-geometry.md).

### Checkpoint 32: isolated ground-observer DUT1 diagnostic (2026-09-23)

Added an opt-in independent ERFA sensitivity report using each pinned Horizons
response's printed DUT1 while retaining the local SPK and other Earth-orientation
inputs. Six cases show only 0.000269–0.000544 arcsecond changes, excluding the
published DUT1 difference as the explanation for the existing 0.36–0.51
arcsecond residual in those cases. No empirical correction was applied.
Baseline references and runtime physics remain unchanged; diagnostics cannot
overwrite fixtures. The complete frame/polar-motion/source-chain attribution
and topocentric contact implementation remain open. No full local tests ran.

### Checkpoint 33: sampled overlap windows and duration brackets (2026-09-23)

The contact engine now exports external-overlap and internal-containment spans,
with clipped search edges, sampled-zero distinctions and numerical duration
bounds. It assembles windows from the existing sampled signs and roots without
additional state evaluations. Three real SPK/PCK cases match independent CSPICE
GF durations; analytic cases cover clipping, separate events and zero-only
ambiguity. Sixteen focused search/reception/export checks, types and changed-file
lint passed. No full local tests ran. The real Venus CN export retains 349
geometry evaluations and source/implementation hashes.

These are sampled geocentric windows, not certified complete events, physical
uncertainty or topocentric visibility. Ground contacts, oriented limbs, event
consumers and all broader unfinished ledger requirements remain open.

### Verified promotion: 14836ae (2026-09-23)

Run 35821138076 passed repository, Web, all four browser profiles, Android, iOS
and the final quality gate for exact head
14836aec229cbd7e95d90b9539656d20d2318c47. That commit was fast-forwarded to
main, delivering source-backed PCK radii and geometric contact searches.
Reception correction, DUT1 diagnostics and overlap windows form the next
candidate. Deployment and publication remain paused.

### Checkpoint 34: cancellable browser occultation experiments (2026-09-23)

Extracted the existing offline experiment into one shared typed engine and
connected the Evidence workspace to a dedicated bounded worker. Browser users
can import settings, select NONE/CN, adjust scan/tolerance, inspect contacts and
overlap durations, cancel, and export effective input with source/build evidence.
Edits/replacement/unmount invalidate old results. Original PCK/SPK validation
and numerical semantics remain shared with the CLI; a real-source comparison
retains identical contacts, windows, requests and provenance.

Sixteen focused unit/CLI checks and twelve browser checks across all four profiles
passed. Types, changed-file lint and the production build passed; mobile layout
was inspected without overflow. No full local tests ran. Topocentric contacts,
oriented limbs, event distributions, native consumers and all other unfinished
ledger requirements remain open. This batch remains local while candidate
0320813 completes its existing remote run, without interrupting that run.

### Checkpoint 35: source-backed station and reception vectors (2026-09-23)

Ground observation exports now retain the actual SOFA/IERS station barycentric
position/velocity and split TDB epoch, plus simultaneous and reception target
vectors in explicit J2000/km conventions. The reported light time now belongs
to the evaluated emission epoch; the next-iterate difference is a separate
numerical residual. No empirical Horizons adjustment or new rotation model was
introduced. Six independently assembled ERFA station/vector cases, five focused
Go tests and fifteen transport/window unit checks passed; types and changed-file
lint passed. No full local tests ran.

The vector bundle is a reusable event input, not completed topocentric contact
searches or apparent-limb modeling. Those and all other unfinished ledger rows
remain open. This batch is local behind candidate 0320813 and browser 20714a1.

### Verified promotion: 0320813 (2026-09-23)

Run 35822269293 passed all repository, Web, four-browser, Android, iOS and final
gate checks on exact head 0320813ae0be5fe1c7d1a8a1d2071e6ddad431a3. That
commit was fast-forwarded to main. Browser experiments and station-vector
commits through 4001499 were then submitted without interrupting the finished
run. Deployment/publication remain paused.

### Checkpoint 36: ground spherical-geometry composition (2026-09-23)

Added a once-parsed immutable Go PCK table, independently matching all 95
CSPICE radius triples. The Go sphere geometry matches 21 CSPICE cases; the
internal ground entry point combines the existing SOFA/IERS reception vectors
with those source radii and retains full station/SPK/EOP/PCK evidence. It rejects
non-spherical targets, implicit correction models and missing inputs. Focused
shape, geometry, composition and cancellation tests passed. No full local tests
ran. This is single-epoch CN geometry, not completed ground contact searches,
visibility, oriented limbs or native/browser consumers; all those and the other
unfinished ledger rows remain open.

### Checkpoint 37: bounded ground contact timing and CLI (2026-09-23)

Added a source-frozen TAI-axis ground search with UTC leap seconds, 30-second
scans, 0.05-second brackets, evaluation/contact limits and fail-whole-job source
errors/cancellation. An offline command validates explicit station fields and
exports the original input hash, catalog/SPK/PCK/IERS identity, contacts and
numerical limits into a new file. Independent ERFA/jplephem Dallas 2024 eclipse
references use original IERS records and verify all four CN sphere contacts;
residuals are approximately 0.00046-0.00961 seconds. The real CLI used 521 geometry
evaluations. Focused reference, analytical, leap-second, changing-source,
cancellation, budget and input checks passed; no full local tests ran.

These are numerical model comparisons, not measured contact accuracy. Ground
HTTP/browser/native access, full apparent limbs, oriented shapes, grazing
completeness, event distributions and all other ledger requirements remain open.
The batch is local while remote candidate 4001499 validates.

### Candidate 4001499 Android failure: reference newline identity (2026-09-23)

Run 35823528664 failed its Android Go gate because the new vector fixture had
hashed a CRLF working-copy JSON while Linux checked out the committed LF bytes.
The source/physics assertion was retained. Python fixture writers now explicitly
produce LF; dependent provenance receipts were regenerated from canonical files.
All 95 radii, six vector results and four ground contact times remain identical.
Focused Go and TypeScript source/vector/contact checks passed after the repair.
The still-running iOS job was not interrupted; the repaired candidate must pass
new remote checks before main promotion.

### Checkpoint 38: bounded ground-contact HTTP access (2026-09-23)

Added explicit PCK startup configuration and contact metadata, and exposed
POST /v1/observation/contacts through the existing long-computation admission
class and shared compute queue. Required station fields, model, dates and IDs
are validated before work; missing PCK/IERS, unsupported shapes and source
failures remain distinct. The existing 20-second deadline and cancellation
apply. A test-managed real loopback HTTP server returned the four independent
Dallas reference contacts from original SPK/PCK/IERS inputs. Focused input,
configuration, shape, cancellation and scheduler checks passed; the backend
compiled. No full local tests ran and no deployment occurred.

Browser/native ground-contact forms and the other unfinished ledger requirements
remain pending. Candidate 4001499 is still awaiting its running iOS job before
the repaired and expanded batch can replace it.

### Checkpoint 39: browser ground contact searches (2026-09-23)

The ground-observer panel now searches source-backed spherical contacts for an
explicit pair of NAIF targets using the same station and UTC start. Editing
inputs, cancelling or changing stations invalidates pending responses. Results
retain contact/bracket UTC, start/end geometry, EOP/PCK/SPK evidence, numerical
limits and unknown physical timing uncertainty; JSON export preserves the
validated response. Unsupported sources remain errors.

Three focused transport/contract tests and twelve interaction checks across four
browser profiles passed, together with types, changed-file lint and production
build. Mobile results were inspected without overflow. Browser tests replay a
response captured from the separately verified real loopback HTTP calculation;
they are not live browser-to-service acceptance. No full local tests ran.

Run 35823528664 has finished: iOS and Web/browser checks passed, Android failed
on the previously diagnosed reference newline identity. The canonical-LF repair
and checkpoints 36-39 require a fresh successful remote candidate before main
promotion. Native ground-contact access, apparent/oriented limbs, completeness,
physical uncertainty and all remaining ledger work are still open.

### Checkpoint 40: sampled ground-overlap durations (2026-09-23)

Ground contact results now include sampled disk-overlap and disk-containment
windows, UTC/TAI edges, clipped-search and sampled-zero distinctions, and
numerical duration bounds. Windows reuse the existing sampled signs and root
brackets with no additional ephemeris evaluations. Zero-only spans do not
imply positive-duration events; missing short/grazing events remains explicit.

The independent Dallas reference verifies both durations: approximately
9559.248 seconds overlap and 236.074 seconds containment, still 521 geometry
evaluations. Focused Go tests cover clipping, sampled zeros, separated events,
leap-second duration, source changes, cancellation and budgets. Real CLI and
loopback HTTP results retain the same four contacts and source identity. The
browser displays and exports the windows, validates bounds and edge evidence,
and remains compatible with older responses that omit window information.
Three transport tests, twelve four-browser interactions, types, changed-file
lint and production build passed. Browser responses are real HTTP captures
replayed for UI verification; no live browser/service claim and no full local
test run. Candidate d5f4618 is still running and has not been interrupted.

Physical timing uncertainty, apparent/oriented limbs, native ground access and
all remaining ledger requirements are still open.

### Checkpoint 41: Android ground-contact client and form (2026-09-23)

Added an explicit station/UTC/target form to the native Android deck, with
bilingual labels and scientific limitations. HTTPS POSTs are bounded to 1 MiB,
redirects are disabled, source/model/request identities are checked, and contact
ordering/brackets, geometry, budgets and unknown physical uncertainty are
validated before display. Input changes, closing the disclosure, backgrounding
and a 25-second deadline cancel requests and discard late callbacks.

Four targeted JVM tests pass against the captured real loopback HTTP result,
source/request mutations, invalid inputs, bounded reads and cancellation. Four
smoke-harness unit tests, changed-file lint and native packaging checks pass.
The device smoke now exercises this real-response replay and missing-source
error; it is explicitly labeled as replay, not live scientific service evidence.
Local Android SDK is unavailable, so platform compilation and device execution
are pending remote validation. UI export, overlap-window display and iOS ground
access remain incomplete; the report retains original bytes for future export.
No full local tests ran.

Candidate d5f4618 passed Web and all browsers but its Android instrumentation
failed with RootViewPicker RootViewWithoutFocusException during the existing
backend editor step. The bounded input recovery now catches precisely that
previously unhandled focus exception without swallowing other runtime failures
or removing assertions. The iOS job remains running and was not interrupted.
The original canonical-LF science reference failure did not recur.

Run 35825426973 subsequently finished: iOS passed. The failed Android focus
step prevents promotion; submit the repaired native/contact-window candidate
only after this terminal result.

### Checkpoint 42: Android overlap windows and file export (2026-09-23)

Android now validates sampled overlap durations, numerical bounds, ordered
non-overlapping spans, clipped boundaries and contact-backed edges before
display. Older responses without windows remain accepted without invented
spans. The bilingual form shows disk overlap/containment durations and explains
that unsampled gaps may split windows and numerical bounds are not physical
uncertainty. A Save JSON action opens the system document picker and writes
the original response snapshot on a background thread; the live form is still
cleared when paused. This preserves the chosen snapshot across the picker.

Five focused plain-JVM tests passed, including the real captured Dallas windows,
mutated duration/edge evidence, source identity, old responses, bounded reading
and cancellation. Native packaging checks and diff checks passed. Added device
assertions for window text and export availability/clearing are pending remote
execution, as are actual document-picker export and Android compilation of this
batch. No full local tests ran. Existing candidate 4b66e29 remains running; this
batch does not interrupt it. iOS ground access and the broader goal remain open.

### Checkpoint 43: iOS ground-contact client, windows and export (2026-09-23)

Added typed Swift station requests and source/model/contact/window validation,
including explicit null physical timing uncertainty, contact-backed window
edges, TAI durations and old-response compatibility. The existing bounded
streaming HTTPS transport now supports a contact-only 25-second resource limit
and bounded structured error bodies while retaining existing defaults for other
callers. A bilingual SwiftUI section supports explicit station/time/target edits,
cancellation, stale-result invalidation and source JSON export via the system
document picker. The export retains a separate immutable snapshot across pause.

Xcode references, remote protocol compilation and device smoke were wired.
The Swift protocol cases consume the actual loopback HTTP capture and reject
mutated sources, bounds, model certainty and request identities. Device cases
exercise a clearly labeled captured-response replay, window text, export
availability, disclosure clearing and unavailable-source errors. Neither is
claimed as a live browser/native scientific service comparison.

Local native packaging checks, nine focused smoke-harness tests, changed-file
lint and diff checks passed. This Windows host has no Swift compiler: Swift
compilation, protocol execution, device interaction and actual file-picker export
remain unverified until the remote candidate runs. No full local tests ran.
Candidate 4b66e29 Android compilation and instrumentation have now passed; its
iOS job is still running and is not interrupted. Android checkpoint 42 and this
iOS batch remain local behind that candidate. The broader goal stays open.

### Checkpoint 44: bounded source-backed Gaia DR3 cone ingestion (2026-09-23)

Added an explicit ESA TAP importer with a sequential COUNT preflight, row/byte/
time limits, cancellation, count reconciliation, 64-bit string source IDs and
exclusive new output directories. Original CSV/query/time/hash evidence remains
separate from spatial storage chunks. Coordinates and metadata explicitly retain
ICRS J2016.0 / TCB, cosine-declination proper motion conventions, nullable fields
and negative parallaxes. The importer does not infer distances or silently
apply astrometric quality cuts. Current-coordinate 5-degree storage bins avoid
pretending source-ID pixels are exact present coordinates or full-sky coverage.

A real Pleiades-area ESA cone returned 19 rows and an independent count of 19;
the original capture is committed for repeatable ingestion checks. Five focused
tests cover source-byte hashes, exact IDs, truncated/duplicated/out-of-cone rows,
uncertainty bounds, null/negative values, polar/wrap bins, preflight budgeting
and cancellation. Types, changed-file lint and diff checks passed. No full local
tests ran; no deployment or publication occurred.

Parallel chunk consumption, proper-motion and observer corrections, Gaia sky
rendering, stellar occultations and capacity measurements remain unfinished.
The 19-row cone is ingestion evidence only, never a scale-performance claim.
Existing candidate 4b66e29 is still awaiting its iOS job; healthy work was not
interrupted. Android window/export and iOS contact additions remain local too.

### Verified promotion: 4b66e29 (2026-09-23)

Run 35826593299 completed successfully for exact SHA
4b66e29f496c696fcf8e34f2ced4dad1b09a9881: repository, Web, all four browser
profiles, Android, iOS and final gate passed. That exact commit was fast-forwarded
to main. Deploy application and Publish asteroid dataset workflows were checked
and remain manually disabled. Android window/export, iOS ground-contact and Gaia
ingestion commits are the next candidate; their acceptance remains separate.

### Checkpoint 45: bounded spatial Gaia chunk consumption (2026-09-23)

Added browser/worker-compatible manifest validation, catalog-epoch rectangle
selection with RA wrap/seam/polar handling, chunk hash verification and Float64
ICRS unit directions preserving original source rows and 64-bit IDs. Parallel
waves reserve encoded bytes and rows, bound total selected bytes, enforce
request deadlines and await the consumer before further admission. Cancellation
stops queued publication and new waves. Snapshot validation prevents in-flight
manifest edits from changing paths or budgets.

Five focused tests passed against the real ESA capture and explicitly synthetic
queue/budget cases, including altered bytes, outside budgets, epoch refusal,
backpressure and cancellation. Types, changed-file lint and diff checks passed.
An initial test mutated a shared Node Buffer view; it was corrected to use an
owned copy, without changing source fixtures. No full local tests ran.

Admission counters are not measured heap/GPU performance. Gaia UI/GPU/cache
integration, motion-aware bounds, stellar event integration and sustained scale
evidence remain unfinished. Candidate 5d9a2b9 is running and was not interrupted.

### Checkpoint 46: source-backed Gaia WebGL sky chart (2026-09-23)

The evidence workspace now accepts local manifest/chunk files or an explicit
HTTP(S) manifest and includes the real 19-row ESA example as a lazy import. A
dedicated worker validates sources and computes catalog-epoch gnomonic display
coordinates from Float64 directions. Transferred Float32 display batches append
to one bounded GPU buffer; upload acknowledgements backpressure the worker.
Cancellation, input changes, errors and unmount terminate work and clear retained
results. Zoom redraws the existing buffer; source selection/export preserves
original decimal-string IDs, rows and manifest evidence.

Seven focused loader/projection unit tests and 12 Gaia-only browser cases passed
across desktop Chromium/Firefox/WebKit and mobile Chromium. Cases cover original
source export, zoom/selection, corrupt-byte rejection, cancellation and layout.
Mobile screenshot inspection confirmed visible stars and no horizontal overflow;
long hash wrapping was fixed after the first focused run. Types and changed-file
lint passed. No full local tests ran. This is a small catalog-epoch chart, not
full-sky, current apparent sky, physical uncertainty or sustained capacity proof.

Candidate 5d9a2b9 finished: repository, Web, all browsers and Android passed.
iOS compiled and executed but its new window-duration text assertion failed at
ObservationUITests.swift:270; no main promotion. Investigation is in progress.

The iOS xcresult accessibility capture confirms the actual label was
9,559.248 s [9,559.219, 9,559.277], and containment was
236.074 s [236.045, 236.104]. SwiftUI correctly applied en_US digit grouping;
the test searched for an ungrouped value. Corrected the explicit en_US device
assertions to include both the formatted duration and numerical bounds, and
include the actual label in any failure. Scientific calculations are unchanged.
Remote revalidation remains required; actual system-picker export remains open.

### Checkpoint 47: cancellation independent of consumer acknowledgements (2026-09-23)

Audit found that a consumer waiting forever for an upload acknowledgement could
keep the loader's cancellation/deadline path waiting inside Promise.allSettled.
Consumer waiting now observes the stream abort signal and settles independently
while still handling late consumer rejection. Cancellation prevents queued
publication and further admission; consumer-owned effects still require their
own cancellation/cleanup (the chart terminates its worker and clears buffers).

Six focused Gaia-loader tests passed, including cancellation before a held
upload settles and an observed late upload error. Types and changed-file lint
passed. No full local tests ran. Candidate a2635ac / run 35829908376 remains
in progress and was not replaced. This fix is retained for the next candidate.

### Checkpoint 48: measured real multi-chunk Gaia rendering (2026-09-23)

An explicit ESA query at RA 55 / Dec 25, radius 1 degree, G <= 17 returned
4,460 rows and a matching independent count. Original CSV and four chunks are
retained in .cache/gaia-scale-20260923. Added an opt-in focused browser capacity
measurement and committed source receipts, implementation hashes and raw frame
samples in docs/benchmarks/gaia-20260923. Desktop and mobile-emulation cases
passed three imports and 120 zoom steps each. Import timings were 64-511 ms;
frame interval P95 was 16.7-16.8 ms on this desktop host. Star buffer allocation
was 53,520 bytes with no zoom reallocations or uploads. Screenshot inspection
confirmed actual visible star rendering.

These are local-file, short, instrumented desktop-host measurements, not live
network, actual mobile hardware, full-sky, sustained FPS or total-memory proof.
Initial in-memory Playwright attachments were not retained by the list reporter;
the harness now writes JSON artifacts explicitly and the two cases were rerun.
Changed-file lint/types passed; no full local tests ran. Candidate a2635ac is
still active remotely and has not been interrupted or replaced.

### Checkpoint 49: Gaia declared-selection integrity (2026-09-23)

Browser decoding now rejects hash-consistent chunks whose rows omit declared
fields, use unsupported astrometric solution codes, exceed the magnitude cut,
lie outside the stated cone, or duplicate a source ID across spatial chunks.
Manifest row totals must also fit the declared query budget, and its columns
must match the shared importer/browser schema. This closes a gap where a hash
only established byte consistency but was incorrectly sufficient for selection
integrity. Nullable/negative parallaxes remain intact; no scientific corrections
or quality cuts were introduced. Synthetic queue fixtures now inhabit an actual
bounded seam-crossing cone rather than unrelated far-apart bins.

Thirteen focused loader/importer tests, types and changed-file lint passed.
Future import receipts include the shared column-schema hash; existing captures
and benchmark receipts remain unchanged. No full local tests ran. Candidate
a2635ac has passed repository, Web, four browsers and Android; iOS remains
in progress. This batch does not replace the running candidate.

### Checkpoint 50: bounded session Gaia source cache (2026-09-23)

Remote imports now reuse content-addressed encoded source bytes in a dedicated
worker retained after successful completion. The LRU cache owns its bytes and
is bounded to 16 MiB / 128 entries, separately from active decode and GPU
budgets. Each reuse still checks the hash and decodes against the current
manifest/schema/cone; corrupt cache entries are evicted before refetch. The
manifest is always fetched again. Cancellation/errors terminate the active
worker; leaving the page releases active and idle workers. Local file imports
bypass cache so an altered selected file cannot be hidden by old verified bytes.

Ten focused cache/loader tests and 16 Gaia-only cases across four browser
profiles passed. The network replay case verifies two manifest requests but only
one chunk request, source preservation and cache-hit receipts. This is captured
response replay rather than an upstream availability/network performance claim.
Types and changed-file lint passed after correcting an unsupported constructor
syntax and using removable Worker event listeners. No full local tests ran.
Candidate a2635ac still awaits iOS; it was not interrupted or replaced.

### Checkpoint 51: Gaia catalog position uncertainty readout (2026-09-23)

Selected stars now expose a J2016.0 positional marginal covariance in
(delta-alpha*cos(delta), delta-dec), formal ellipse semiaxes in mas and major
axis orientation from east toward north. Gaia ra_error already includes cos(dec);
it is not multiplied again. Missing/invalid/nonrepresentable errors produce an
explicit unavailable result, circles have no arbitrary orientation, and singular
contours are retained. The derived selected-star result is exported separately
from untouched source rows. This is a unit-Mahalanobis marginal contour, not a
68 percent joint confidence region, systematics model, propagated uncertainty
or occultation timing certificate. Full astrometric covariance remains pending.

Three focused numerical cases passed (analytic correlated ellipse including
near-pole convention, missing/singular/invalid cases, and real-source variance
trace/determinant invariants). Four browser cases passed for selection and
export; types and changed-file lint passed. No full local tests ran. Definition
source: ESA DR3 gaia_source data model, as linked in docs/gaia-data.md.

### Verified promotion: a2635ac (2026-09-23)

Run 35829908376 completed successfully for exact SHA
a2635accd22893542c8bcc25dcf428b267ff14fe: repository, Web, four browser
profiles, Android, iOS and final gate passed. That exact commit was
fast-forwarded to main. Deploy application and Publish asteroid dataset remain
manually disabled. This confirms the corrected iOS duration assertion and
Gaia chart batch; subsequent cancellation, measurements, selection validation,
cache and uncertainty commits require their own candidate validation. Actual
native system-picker export and the wider scientific/capacity goal remain open.

### Checkpoint 52: signed near-periapsis Kepler accuracy (2026-09-23)

Non-elliptic catalog/Kepler paths currently reject unsupported conics rather
than fabricating elliptic states; full hyperbolic/parabolic source support
remains pending. The boundary audit found a real elliptic precision defect:
normalizing a tiny negative mean anomaly by adding a whole revolution erased
its sign/magnitude, particularly damaging near e=1. The solver now returns the
signed principal eccentric anomaly; public fitted/Kepler element paths retain
a signed remainder before solving. Trigonometric consumers remain equivalent
for ordinary angles while tiny pre-periapsis roots remain representable.

Twenty-nine focused Kepler, public ephemeris and covariance tests passed, with
negative roots checked against the existing independent 80-digit reference roots
using odd symmetry and end-to-end pre/post-periapsis position symmetry. Types
and changed-file lint passed. Catalog point propagation was checked separately.
No full local tests ran. This fixes numerical precision only, not physical model
accuracy or non-elliptic feature completion. Candidate 858e895 / run 35831624808
is active and remains undisturbed.

### Checkpoint 53: independently checked unified conic calculation (2026-09-23)

Added a Float64 periapsis universal-variable module spanning elliptic, parabolic
and hyperbolic conics without division by 1-e. Inputs carry explicit km/GM and
elapsed TDB seconds; signed time, safeguarded root finding, near-zero Stumpff
series, orientation rotation and explicit numerical failure handling are covered.
An independently executed CSPICE conics oracle generated 49 synthetic states
with source-generator hash and software identity. All 51 focused cases passed
(state/energy comparisons, exact Barker parabola, invalid/unrepresentable input).
Types and changed-file lint passed after removing one unused initial assignment.
No full local tests ran.

This is a calculation foundation, not completed non-elliptic comet support:
source ingestion, UI integration, perturbations/non-gravitational forces and
physical uncertainty remain open. See docs/periapsis-conics.md for reference
commands and evidence limits. Candidate 858e895 remains active remotely and
is not replaced by this batch.

### Checkpoint 54: original non-elliptic SBDB source import (2026-09-23)

Captured a real JPL full-precision 2I response (Borisov, solution 54) with
original bytes, URL, retrieval time and SHA-256. Added a bounded owned-response
conic decoder requiring API/source/frame/solution identity, unambiguous fields,
units and finite values. It preserves e>=1, q/tp, source fit/validity metadata
and all nine non-gravitational model entries without silently integrating them.
No central GM is guessed. TDB epochs retain separate integer-day/fraction parts
as well as raw source strings, avoiding the precision loss identified by lint
in a direct long-decimal JD test literal.

Two focused cases passed: real original-byte receipt/parameter preservation and
six corrupted-contract mutations. Types/lint passed. No full local tests ran.
This is source import, not a complete comet UI or physical trajectory validation;
GM-backed propagation, user access, fit forces and uncertainty remain open.
Candidate 858e895 has all checks except iOS complete; its active run is retained.

### Checkpoint 55: sourced Borisov conic browser experiment (2026-09-23)

Connected original SBDB conics to checksum-verified gm_de440.tpc solar GM and
split-TDB elapsed time. The result retains source/GM identity, complete raw
source, omitted fit parameters and explicit unknown physical uncertainty.
Unsupported non-null source UTC validity bounds cause refusal, never a silent
TDB reinterpretation. Added a bilingual evidence-workspace interface for the
real Borisov example/local import, target TDB epoch, computation and JSON export;
input edits/cancel/unmount prevent stale asynchronous publication.

A separate CSPICE run generated five real-element Borisov two-body reference
states using the same sourced GM. Six focused engine checks and four browser
profiles passed; browser exports match reference state vectors and preserve
evidence. Types/lint passed. Mobile screenshot inspection confirmed readable
content and wrapping. A missing JSON import attribute initially prevented test
discovery; it was corrected and the focused file passed. No full local tests ran.

This is observable non-elliptic two-body support in the experiment interface,
not main catalog/scene integration, original SPK coverage, the full source force
model, native access or physical trajectory accuracy. Those remain open.
Candidate 858e895 still awaits iOS and is not interrupted.

### Checkpoint 56: stable parabolic transverse velocity and promotion (2026-09-23)

Run 35831624808 passed repository, Web, four browser profiles, Android, iOS
and final gate for exact SHA 858e89561e4036b0c3df18e52f62630a84acc2ed.
That SHA was fast-forwarded to main. Deploy application and Publish asteroid
dataset remain manually disabled.

Boundary auditing reproduced cancellation in the universal conic transverse
velocity: subtracting x-squared C / radius from one lost the small component
at large parabolic Barker parameters. Combining the numerator algebraically
before division preserves it. Three analytic component-relative cases failed
before the fix, including positive/negative elapsed time, then passed. Both
focused conic/reference files passed all 60 cases; types and changed-file lint
passed. No full local tests ran. The extreme analytic examples are numerical
regressions, not claims of physical validity at enormous propagation times.

The subsequent signed-Kepler, conic solver, original Borisov import and browser
experiment commits still require their own exact-SHA remote gates before main
promotion. The broader goal and its previously recorded gaps remain open.

### Checkpoint 57: catalog artifact resource deadlines (2026-09-23)

The full-source snapshot pipeline bounded bytes and concurrent acquisitions but
had no download deadline: a stalled response could retain a lease indefinitely.
Each artifact now has a 30-second deadline spanning admission, headers, body
consumption and hash verification. Parent cancellation remains linked; timers
and listeners are removed and leases released on every settled path. This is
a per-artifact transport bound, not an overall compute or GPU-upload deadline.

Twenty-one focused streaming/admission/transfer cases passed, including new
stalled checksum, index and four-concurrent-shard response tests. A separate
focused no-response-headers case also passed. They verify timeout errors, body
cancellation, no partial publication, timer cleanup and successful subsequent
loads. Types and changed-file lint passed. These use controlled transport
fixtures, not measured public-network reliability. No full local tests ran.
Candidate 002b1e6 / run 35833613659 remains active and was not replaced. This
change is retained for the next candidate; continuous/3D streaming, scheduling
priorities and broader capacity/physical-model work remain incomplete.

### Checkpoint 58: real source capacity tier measurements (2026-09-23)

The built-app benchmark now accepts the same row tiers exposed in the UI and
asserts limited versus complete status, exact uploads and bounded prefetch.
Executed five sequential fresh-browser runs against one production build using
real MPC rows: 30k, 100k, 300k, 1m and the complete 1,561,171-row inventory.
Reports and source/implementation/harness receipts are retained under
docs/benchmarks/catalog-tiers-20260923. Loads were 242.3/298.5/468.5/1067.3/1553.1
ms on RTX 5070 Ti Direct3D11; final representatives were 5416/16956/21590/30466/34505.
All five verified counts, visible pixels, GPU allocations, transfer bounds and
zero page/GL errors. The full-tier screenshot was visually inspected. Build
and changed-file lint passed; no full local tests ran.

These are local-HTTP, fixed-epoch, single-run observations, not statistical
capacity limits, native device measurements or sustained continuous simulation.
The partial tiers retain source-order prefixes and admit up to three lookahead
shards. Continuous/3D propagation, adaptive error budgets and actual total
memory remain open. Candidate 002b1e6 remains active and is not replaced.

### Checkpoint 59: conservative index admission before shard download (2026-09-23)

Streaming now excludes shards with no matching exact index fields: Float64
semimajor axis, class and the same indexed magnitude/knownness already used by
source filtering. Exact name locators compose with that exclusion. Quantized
eccentricity/inclination and derived perihelion never reject a shard; original
Float64 source filtering remains authoritative for those boundaries. Retained
shards still undergo hashes, structure and index/source alignment validation.
Long index exclusion scans yield every 20k inspected rows and check cancellation.

Eighteen focused streaming cases passed, including sparse last-shard admission,
a fully excluded query with no binary fetch/publication, and source e/i/q
boundaries crossing index quantization. An existing locator test expectation
was updated because its known-magnitude shard is now correctly excluded from
an unknown-magnitude query. Types and changed-file lint passed before the final
cooperative-yield addition; focused streaming cases were rerun afterwards.
No full local tests ran. These are controlled contract tests, not a measured
network speedup. Previous capacity reports retain their earlier implementation
hashes and must not be presented as measurements of this change.

Complete status means all potential matches were handled; excluded shards are
not counted as scanned source rows or as validated source payloads. Broader
source priorities, continuous 3D/time updates and device capacity remain open.
Candidate 002b1e6 continues remotely and is not replaced.

### Checkpoint 60: browser proof of conservative shard exclusion (2026-09-23)

One focused integration case passed desktop/mobile Chromium, Firefox and WebKit.
It uses three distinct controlled source shards with a one-row default sample:
the unknown-H filter independently loads Beta from only its matching shard,
reports one scanned/drawn row, then a valid empty range completes with zero
source requests, zero drawn/displayed rows and no stuck spatial selection.
No page errors occurred. This verifies real worker/network/GPU integration
against synthetic source fixtures, not public-network speed or scientific data
coverage. Build and changed-file lint passed; no full local tests ran.

Two test assumptions were corrected during development: the default sample table
cannot contain unsampled Beta, and the empty-range minimum must not exceed the
default maximum of 80 AU. The engine correctly rejected the invalid [100,80]
range; the final empty selection uses [70,80]. Existing exact filters and source
precision contracts were retained. Candidate 002b1e6 has all completed checks
green and still awaits iOS; it remains undisturbed.

### Checkpoint 61: Gaia five-parameter formal covariance access (2026-09-23)

Added joint five-coordinate formal covariance construction using all ten source
correlations, explicit mixed units and strict correlation-factor validation.
The selected-star browser readout and source export expose availability and the
owned matrix. Code 95 is explicitly a five-coordinate marginal excluding
pseudocolour; code 3 remains unavailable. No epoch propagation, systematics,
radial-velocity covariance or physical probability claim is introduced.

Three focused numerical cases passed, covering exact analytic mixed-unit
entries, invalid joint correlations, conservative singular rejection, missing/
unrepresentable inputs and every real-source marginal (18 five-parameter and
one position-only source). Four focused browser profiles passed selection,
export and position-only unavailability. Build and lint passed after explicitly
typing the correlation matrix as number[][]; final symmetric assignment was
checked again with the focused numerical file. No full local tests ran.
Full six-parameter imports, observer/time propagation and stellar-occultation
integration remain open. Candidate 002b1e6 remains active awaiting iOS.
