# Scientific expansion and real-time scale

Owner-authorized goal, 2026-09-22 (Asia/Singapore). Implementation tracker, not a
claim that the proposed capabilities already exist. Deployment and publication
remain paused. Changes may go directly to main after the required checks.

## Acceptance ledger

| Workstream | Required observable outcome | Status |
| --- | --- | --- |
| Shared analysis ephemeris | Events, curves and mission endpoints use a frozen source contract, expose actual per-body models, offer strict SPK coverage, and export time/frame/source evidence; shared backend integration follows | In progress |
| Ground observer | Geodetic station, SOFA-compatible celestial/terrestrial transforms, versioned IERS EOP with split UTC lookup and split-epoch source evaluation in instant/window/contact/Gaia-station HTTP paths, vacuum/apparent altitude-azimuth, rise/set and visibility windows; source expiry and uncertainty remain visible | In progress |
| Orbit uncertainty | Pinned SBDB covariance with labels, units and solution epoch; validated covariance propagation and sampling; uncertainty ellipsoids and event distributions, independent of numerical tolerance | In progress: source ingestion, solution-epoch conversion/sampling/browser ellipsoids, conditional six-parameter DE440 propagation and finite ensembles; browser/offline and backend/native distance-event searches with conditional timing summaries now implemented in source, not runtime-validated. Complete fit-model propagation, calibrated event distributions and independent numerical acceptance remain pending |
| Occultations and eclipses | Source-backed radii/orientation and stellar astrometry; bounded contact/window search, missed-event and physical-error reporting, independent reference cases | In progress: verified PCK radii, geocentric NONE/CN sphere contacts and windows, SOFA/IERS ground CN sphere contacts, plus a new browser-worker search for a fixed J2000 point-source ray through an exact-ID oriented PCK ellipsoid. The ray path has source/input receipt checks but awaits runtime and independent reference verification; finite background/body ellipse contacts, catalog stellar astrometry, complete detection, topocentric oriented contacts, native consumers and event distributions remain pending |
| Dynamics laboratory | Explicit initial conditions, force models and parameters; validated selected-target integration, non-gravitational terms where sourced, resonance/stability diagnostics and reproducible exports | In progress: bounded integration, variational equations, pinned DE440 adapter and browser/offline source-bearing experiments; additional forces, full covariance, native access and long-term diagnostics pending |
| Scientific data | Audit and extend useful SPK windows, genuine spacecraft trajectories, non-elliptic comet support, physical parameters and spatially chunked Gaia data; never fabricate missing states or mutate immutable releases | In progress: pinned PCK semiaxes for 95 bodies and 75 source orientation models with independent CSPICE comparisons and Web/offline orientation access; eleven packaged Gaia region manifests reconcile to 83,739 input rows and 73,160 unique source IDs, including 4,460 repeated Pleiades rows and 6,119 repeated rows across three nested opposite-field cones. The opposite-field captures are 0.20° (1,155 rows), 0.40° (4,964 rows; 3,809 additional IDs) and 0.60° (11,157 rows; 6,193 additional IDs over 0.40°); their TOP+1 bounds did not overflow, but no independent COUNT(*) scans or completeness claim exist. The 0.35° ICRS cone at RA 266.4°, Dec -29°, G≤18 is packaged with 9,686 rows; the 0.15° G≤17 inner-bulge cone contributes 654 rows and two eastern G≤18 cones contribute 22,252 disjoint rows. Broader 0.8° inner-bulge, 2° Pleiades, 1.75° Pleiades and 1° opposite-field attempts were aborted by ESA at its 7,200-second execution limit; two over-budget eastern cones were rejected at the 20,001-row sentinel. None of the rejected attempts contributes rows. An isolated synthetic WebGL workload reached 1,561,171 points near 60 Hz on an NVIDIA RTX 5070 Ti, but this is not full-product evidence. Gaia chart admission remains 200,000 rows/128 MiB; simultaneous real-catalog computation/rendering, full-product memory, and native/mobile device capacity remain unmeasured; full-sky coverage is absent. Five source-backed spacecraft (Voyager 1/2, New Horizons, Juno and Cassini) and two source-backed comets (67P and hyperbolic 2I/Borisov) are now selectable from original SPKs with explicit source-window boundaries. Cassini’s 2017 Grand Finale NAV trajectory is in both profiles and has 94,839-epoch CSPICE source/crop and reader parity; its formal RTN covariance remains withheld because the accessible PDS guide and table do not specify matrix units and the table ends about 14 hours before the trajectory. Juno source crop pins DE440S for center/origin resolution and now has 635,061-epoch CSPICE crop/reader parity (not navigation-fit accuracy or an uncertainty bound); 2I includes JPL-mapped sampled uncertainty and pinned ten-axis SBDB covariance at its fit epoch, but these are not continuous physical-accuracy bounds and full covariance propagation remains pending. Additional physical-parameter and spacecraft coverage, remaining limb/orientation, and identity integration are pending |
| Catalog streaming | Replace the fixed 8k/30k-only cloud path with cancellable binary chunk loading, priority scheduling and independent byte/decode/compute/upload limits | In progress: retained epochs, bounded uploads/restoration, source/NEO/PHA priority and cross-shard reservation are implemented but unverified. Opt-in manual incremental admission now reserves up to 256 selected bodies within total capacity, with upload ACKs, source mapping, deadlines and bounded index/single-shard cache reuse. Legacy automatic following still reloads; append mode is manual. End-to-end cancellation, memory and capacity evidence remain pending |
| Rendering and time | Moving spatial bounds, visibility/LOD, selected-body retention, time/error-budgeted updates, reusable buffers and Float64-relative GPU coordinates; WebGL fallback and native contracts retained | In progress: relative reference-pane coordinates predate hold; spatial selection, mapped-selection retention, temporal reuse receipts, cooperative restoration and live-prefix GPU updates are implemented but unverified. Count-only catalog display changes no longer rewrite coordinates. Main-scene point layers disable frustum culling; trajectory lines refresh their bounds. Native integration and runtime evidence remain pending |
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

Current validation gaps are consolidated in
[the pending-validation inventory](scientific-expansion-pending-validation.md).
It supplements all workstreams above and is not completion evidence.

The owner authorizes focused tests periodically and regular commits with
collected direct-to-main pushes; the full local test suite remains prohibited.
Use scoped checks and tests for reviewable changes, and retain the final broader
verification for the completed implementation. Production deployment and
releases remain paused. Historical test evidence below applies only to the
recorded changes, not subsequent implementation.
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

### Checkpoint 62: evidence documentation reconciliation (2026-09-23)

Confirmed candidate 002b1e6 remains live at the iOS real-SPK-over-HTTPS UI step
(job 107092054174); repository, Web, four browsers and Android have passed.
The candidate was not restarted or replaced. Deployment and asteroid dataset
publication remain manually disabled. Corrected the stale Gaia documentation
claim that cache integration was pending and linked the recorded 4,460-source
multi-chunk measurements, retaining their implementation and hardware limits.
No tests were run for this documentation-only correction. No full local tests
ran. The full goal remains active; current-state scientific and capacity gaps
are not waived by the passing bounded checks.

### Checkpoint 63: original Gaia six-parameter source fields (2026-09-23)

Added opt-in source schema 2 with pseudocolour, its error and all five associated
correlations, keeping schema 1 and its original assets unchanged. Importer and
browser enforce version-specific column sets; the CLI records the exact schema
hash and pseudocolour units. A real ESA query returned 94 matching-count rows:
15 six-parameter, 78 five-parameter and one position-only source. Original CSV,
query/time/hash receipts and the full chunk are checked in under
tests/fixtures/gaia-six-20260923. No negative parallaxes/nulls were replaced.

Thirteen existing focused importer/loader cases passed. Two additional real
schema-2 cases passed after adding the required Content-Length header to the
controlled response fixture; they verify every receipt hash, source fields,
exact reconstructed chunk and browser decoder schema isolation. Project-reference
type build and changed-file lint passed. No full local tests ran. The current
inspector still exposes only the five-coordinate marginal; full six-coordinate
construction, propagation and stellar occultation remain open. Candidate
002b1e6 remains active; it was not replaced.

### Checkpoint 64: full sourced Gaia six-parameter covariance (2026-09-23)

Connected schema-2 pseudocolour errors and five cross-correlations to a full
six-parameter formal covariance, with explicit inverse-micrometre sixth-axis
units and strict joint validation. The inspector/export keeps this separate
from its five-coordinate marginal. Missing inputs, non-code-95 solutions and
indefinite joint matrices produce explicit unavailability without inventing
correlations. No radial velocity, epoch propagation or colour conditioning is
implied. Four focused numerical cases and four browser-profile cases passed,
including all 15 real six-parameter sources, preserved marginal blocks, an
invalid sixth-coordinate joint matrix, original-row exports and selected IDs.
Project-reference types, production build and changed-file lint passed. No full
local tests ran. Observer/time propagation and stellar occultation remain open.

Run 35833613659 passed all gates for exact SHA
002b1e617dad8d6caf4836d66270969acbb83d40; that SHA was fast-forwarded to main.
Deployment and asteroid dataset publication remain manually disabled. Later
streaming, capacity and Gaia covariance work still requires its own candidate
validation and is not represented as already accepted on main.

### Checkpoint 65: explicit barycentric time conversion prerequisite (2026-09-23)

Verified the Gaia TCB / GoFA Starpm documented TDB convention difference and
audited the real 94-source capture: only 16 rows jointly supply positive
parallax, both proper motions and radial velocity. Added canonical two-part
TCB/TDB conversion using IAU 2006 B3 constants, preserving the nonzero origin
offset and date-boundary precision. A separately executed pinned PyERFA oracle
produced 14 reference conversions with generator/software evidence. Fifteen
focused comparisons/roundtrips/invalid-input cases, project-reference types and
lint passed. No full local tests ran.

This is a necessary time-coordinate building block, not completed stellar
propagation. Parameter rate/length conventions, perspective/light time, the
spectroscopic radial-velocity approximation, independent propagated-state
references and user access remain to implement. Missing inputs are not silently
filled. Candidate 8968a78 / run 35835715872 remains active and is not replaced.

### Checkpoint 66: independently checked Gaia single-star motion core (2026-09-23)

Implemented a GoFA Starpm adapter with explicit TCB/TDB compatible time/length
scaling and restored TCB-compatible output parameters. It requires complete
inputs and an explicit spectroscopic-as-astrometric RV policy, and rejects every
nonzero SOFA status rather than publishing overridden distances or velocities.
Source identity, epoch, proper-motion convention, finite values and supported
epoch/pole boundaries are checked. Returned model limitations distinguish
nominal propagation from uncertainty, acceleration and observer corrections.

A separately executed PyERFA oracle generated 64 states for 16 real sources
and four epochs, with source/generator hashes and software versions. An
additional all-TCB evaluation checks coordinate-scaling invariance. Two focused
Go tests passed all reference and invalid/model-warning cases; no full local
tests ran. CLI/HTTP/browser integration, source-bearing export, propagated
covariance and stellar-occultation access remain outstanding. Candidate
8968a78 remains active and was not replaced.

### Checkpoint 67: original-source stellar propagation CLI (2026-09-23)

Added a bounded original-CSV experiment adapter and cmd/gaia-motion. It verifies
version-specific columns, source frame/epoch, original CSV hash/size, ordered
unique IDs and row counts before selecting a complete-input star. Exports own
the original manifest and CSV bytes plus selected source, hashes, build identity,
explicit RV approximation and model limitations. Output creation is exclusive.
Supplied-manifest consistency is explicitly not independent ESA authentication
or a claim to validate unconsumed source files.

Two focused evidence-contract tests passed for both source versions and invalid
receipt/frame/column/row-count/missing-RV cases. Actual CLI execution for the
real first source at J2026 produced an export checked against independent ERFA
and byte-exact originals. An attempted same-path output was correctly refused.
No full local tests ran. HTTP/browser/native entry points, covariance propagation
and stellar-occultation integration remain open. Candidate 8968a78 remains live
awaiting iOS; the running candidate was not replaced.

### Checkpoint 68: bounded source-bearing stellar HTTP access (2026-09-23)

Added POST /v1/stellar/motion with strict fields, explicit target TCB epoch and
RV policy, a 13 MiB wire limit, existing decoded source budgets and a 14 MiB
response limit. It participates in admission and weighted trajectory compute
scheduling. The shared CSV adapter now supports context cancellation before
parsing and between rows; the offline entry point retains its existing API.

Five focused HTTP/source tests passed, including a real managed loopback HTTP
request whose original files are byte-exact and whose six output components
match the independently generated ERFA fixture. Invalid/oversized wire data,
missing required inputs and pre-cancelled requests are refused. No full local
tests ran. Browser/native entry points, propagated covariance and occultation
integration remain open. Candidate 8968a78 is still awaiting iOS and has not
been replaced; deployment and publication remain paused.

### Checkpoint 69: browser stellar propagation workspace (2026-09-23)

Added source-file import, exact source identity and TCB epoch controls, required
RV approximation adoption, cancellation and source-bearing export. Input edits
cancel pending requests and clear prior results. The client validates bounded
responses, original bytes and hashes, model/epoch/source identity and finite
states. Missing backend configuration remains explicit. The Gaia chart is not
silently relabelled as a propagated or observed sky.

Three focused client tests and four browser-profile runs passed, as did the
production browser build, project-reference types and targeted lint. The UI
tests replay an actual prior Go CLI output; they are transport-contract evidence,
not live browser/backend or physical device acceptance. Mobile-layout output
was visually inspected. No full local tests ran.

Candidate 8968a78 completed every CI job successfully in run 35835715872,
including iOS and the final gate, and was normally fast-forwarded to main.
The subsequent time conversion, stellar core, CLI, HTTP and browser commits
will use a new candidate gate. Native stellar access, propagated covariance,
observer transformations and occultation integration remain outstanding.

### Checkpoint 70: bind selected stellar parameters to original CSV (2026-09-23)

Audit found that the browser checked original-file hashes and the source ID but
did not compare every returned selected parameter against those original bytes.
Added a bounded CSV reader and exact field/null comparisons. Proper-motion or
RV substitutions with otherwise valid receipts now fail. Quoting, absent and
duplicate identities, malformed numeric fields and altered parameter cases are
covered by four focused client tests; project-reference types and targeted lint
also passed. No full local tests ran.

Candidate 335b083 / run 35838148647 is still active and was not replaced. This
fix is staged as a subsequent local commit. Browser-to-Go live acceptance is
still unproven; prior browser replay and independent Go HTTP evidence remain
separate. The broader scientific and performance goal remains incomplete.

### Checkpoint 71: cancellable browser source scan (2026-09-23)

Replaced the synchronous all-rows CSV materialization with a cooperative scan
that retains only header/current/selected rows. It yields by character count,
including inside long quoted fields, and checks the active request signal.
The response validator passes through the same cancellation/deadline signal.
Original bytes and decoded text remain retained; total heap usage is not claimed.

Five focused tests passed, including a long-field scan that must yield and then
reject cancellation without publishing a selected source. Project-reference
types and targeted lint passed after fixing TypeScript callback narrowing. No
full local tests ran. Candidate 335b083 remains live; this subsequent local
change does not replace it. Browser-to-Go live acceptance remains outstanding.

### Checkpoint 72: experimental source-backed formal covariance core (2026-09-23)

Verified ESA's covariance-coordinate conventions and implemented a Go prototype
with the original five-coordinate marginal and explicit independent spectroscopic
RV variance. Missing errors/correlations and nonpositive joint matrices are
rejected. The sixth motion coordinate is RV, not Gaia pseudocolour. A local
numerical Jacobian uses two step scales and Richardson extrapolation, preserving
the existing Starpm coordinate/time conventions and cancellation.

Two targeted tests passed, covering 16 real same-epoch sources plus missing and
invalid data, policy enforcement, cancellation and a future-epoch sanity check.
The first attempt exposed subtraction noise at the identity epoch; that known
analytic case now uses an exact identity matrix. No full local tests ran.
The prototype is deliberately not exposed to users yet: independent cross-epoch
covariance references and nonlinear-limit assessment are still absent. This
checkpoint does not count propagated uncertainty as complete.

### Checkpoint 73: independent covariance and nonlinear sampling references (2026-09-23)

Executed pinned PyERFA/NumPy generators against original source bytes. The
five-point, two-step-size oracle uses all-TCB coordinates independently of the
Go scaled-TDB implementation and records 64 covariance cases. Maximum Go/oracle
standard-deviation-product-normalized difference is 0.000119289142; reference
step disagreement is at most 0.000013764132. Generator/source hashes are checked.

A second independently executed seeded ERFA ensemble generator produced six
cases with 32,768 draws each (196,608 total), three real sources at J1916/J2116.
No draws were discarded. The maximum empirical/Go normalized difference is
0.013741869, including sampling error. Two focused Go tests passed all matrices
and provenance receipts. No full local tests ran. These are finite numerical
and adopted-distribution checks, not a physical uncertainty or general nonlinear
coverage guarantee. Public CLI/HTTP/UI covariance access remains outstanding.

### Checkpoint 74: explicit CLI and HTTP formal-covariance access (2026-09-23)

Added optional covariance-policy selection to the original-source experiment,
CLI and HTTP route. The exact independent-spectroscopic-rv hypothesis is required;
omission computes only the nominal state and unsupported policies are refused.
The source-bearing export includes both matrices, Jacobian, step/convergence
diagnostics, coordinate/time conventions and explicit model assumptions.

Four focused Go tests passed across HTTP and independent covariance/ensemble
references. Managed real loopback HTTP retains byte-exact originals and matches
the independent ERFA matrix. Actual CLI execution produced an export whose
original files and matrix were independently rechecked (normalized difference
6.047e-6 for the chosen source/year). No full local tests ran. Browser/native
covariance controls and live browser-to-Go acceptance remain outstanding.
Candidate 335b083 still awaits iOS; the active candidate was not replaced.

### Checkpoint 75: browser covariance assumptions, validation and readout (2026-09-23)

Added separate opt-in formal covariance controls, six marginal standard
deviations with units, explicit limits and full source-bearing export. The
client reconstructs input covariance from the verified original row, checks
matrix symmetry/positivity, model/policy/time/units and J C J-transpose. It
refuses unsolicited or missing covariance and altered matrices or Jacobians.

Six focused client tests, type checking, targeted lint and four browser-profile
UI runs passed. The replay fixture is extracted from the actual Go CLI output.
Screenshot review found cramped inline assumptions; separate aligned rows were
implemented and verified with a mobile-only rerun and screenshot inspection.
No full local tests ran. This remains replay UI plus separately verified HTTP
evidence, not live browser/backend acceptance or physical native-device proof.

### Checkpoint 76: bounded Android stellar request contract (2026-09-23)

Added an original-byte-owning Java request model with signed-64-bit decimal
source identity, explicit TCB epoch and RV approximation, optional independently
selected covariance policy, decoded input budgets and a bounded JSON/base64 wire
representation. The real Gaia source files survive encoding and caller mutation.

The single-class Gradle test attempt stopped before tests because the local
Android SDK path is absent. Independent javac --release 17 compilation and the
two focused JUnit tests passed using already cached dependencies. This verifies
the plain Java request contract only, not Android packaging or UI. No full local
tests ran. Response validation, native network/UI integration and iOS stellar
access remain outstanding. Existing candidate iOS job 107106826761 is still
executing its real-SPK HTTPS UI step; it was not cancelled or replaced.

### Checkpoint 77: Android response evidence and compatible source encoding (2026-09-23)

Added bounded original-response validation with exact source bytes/hashes,
selected CSV fields, state/model/epoch identity and covariance matrix semantics.
Exports preserve received bytes; public readout arrays and originals are copied.
Thread interruption is checked before and during source scanning. Corrected a
request-encoder compatibility issue: java.util.Base64 needs API 26 but this app
supports API 24, so the new portable encoder is checked against JDK base64.

Plain javac --release 17 compilation and six focused JUnit tests passed,
including 1,025 encoder lengths, real Go output receipts, altered contracts,
bounds, defensive copies and cancellation. No full local tests ran. Android
network/UI integration, packaging/device validation and iOS stellar access remain
pending; the local SDK limitation remains explicit.

Candidate 335b083 / run 35838148647 has now passed every gate, including iOS and
the final gate, and was fast-forwarded normally to main. Subsequent source
validation, covariance and Android work is queued for a fresh exact-SHA gate.

### Checkpoint 78: bounded Android stellar transport (2026-09-23)

Implemented one-active-request HTTPS transport for original-source stellar
analysis, with credential/redirect refusal, byte/content contracts, scientific
response validation, backend error propagation and cancellation/deadline
disconnect. Per-request deadline resources are released on completion, and
cancelled/expired instances do not publish or start subsequent work.

Four targeted JUnit transport tests passed after javac --release 17 compilation.
They replay actual Go outputs through controlled connections and verify exact
payloads, malformed body contracts, errors, pre/mid-read cancellation and a
stalled-header deadline with an asserted reached wait state. No full local
tests ran. Live TLS, Android UI/file import and lifecycle/device validation remain
unproven; the missing local Android SDK is unchanged. Candidate c3b87f7 /
run 35840897494 remains active and was not replaced.

### Checkpoint 79: Android stellar panel and pending live native scenario (2026-09-23)

Wired original-file pickers, bounded background import with provider cancellation
and a UI deadline, explicit RV/covariance controls, real service calls, readouts
and snapshot-preserving document export. Generation guards and lifecycle/input
clear paths prevent stale results. Added bilingual strings and scientific limits.

Extended the existing owned-emulator HTTPS harness to stage the original Gaia
files, invoke import-result callbacks, require the live Go stellar request and
assert state/covariance values and input invalidation. This scenario is authored
but unexecuted; the local Android SDK is absent. Eight focused harness/reuse
tests, JS syntax/lint and both XML resources passed. No full local tests ran.
Native UI compilation/execution, actual picker interaction and export destination
write acceptance remain explicitly unproven. Candidate c3b87f7 has passed Android,
Web and all four browsers and is still awaiting iOS; it was not replaced.

### Checkpoint 80: enforce Android source-import cancellation boundaries (2026-09-23)

Extracted the provider stream reader and fixed cancellation checks before reads
and after EOF. The reader closes owned streams, enforces actual rather than
provider-declared bytes, rejects empty sources and avoids spinning on a zero-byte
read. The UI retains its generation/provider cancellation and timeout controls.

Three focused plain-JVM tests passed after javac compilation, covering exact
1 MiB/8 MiB budgets, one-byte overflow, pre-read/EOF cancellation, stream ownership
and zero-progress reads. No full local tests ran. This does not establish Android
provider interruption or system-picker behavior; those remain pending native
execution. Candidate c3b87f7 / run 35840897494 remains live awaiting iOS.

### Checkpoint 81: progress-safe Android stellar response reads (2026-09-23)

The bounded HTTP reader now checks cancellation before each read and after EOF,
and falls back to a single-byte read when a bulk read reports zero progress.
Declared-length overflow/truncation still fails and owned streams are closed.
This prevents a misbehaving stream from causing a tight bulk-read loop.

Five focused transport JUnit tests passed after successful javac --release 17
compilation, including zero-progress exact/truncated/oversized bodies and EOF
cancellation. An initial compile command included a nonexistent source filename;
the subsequent run of old compiled classes was excluded from validation, then
the corrected compile and five-test run succeeded. No full local tests ran.
These controlled JVM tests do not prove native TLS or device behavior. Candidate
c3b87f7 / run 35840897494 remains active awaiting iOS and was not replaced.

### Checkpoint 82: iOS original-source request contract and gated integration (2026-09-23)

Added a Foundation request value with original Data bytes, exact signed-64-bit
Gaia identity, bounded TCB epoch, required RV approximation and optional explicit
independent-RV covariance policy. Base64 encoding avoids slash escaping so even
slash-heavy maximum-size inputs remain within the 13 MiB wire budget. Encoding
checks task cancellation before and after serialization.

Registered the source in Xcode, both Swift compiler invocation paths and the
native source verifier. Authored source-byte, mutation, ID/policy/size/epoch,
slash-heavy maximum-input and cancellation checks with a stellar-only switch.
Swift is unavailable locally, so these checks have not executed. The source
verifier, script syntax/lint and 13 focused harness/reuse tests passed; no full
local tests ran. iOS response validation, transport, UI and live scientific
acceptance remain outstanding.

Run 35840897494 completed successfully across all jobs, including iOS and the
final quality gate, on exact SHA c3b87f736f47a2a182752b2c02bdc2a199b4f961.
After rechecking the remote branch and ancestry, that SHA was normally
fast-forwarded to main from 335b083. Subsequent Android UI/transport and this iOS
request work require a fresh candidate gate. Deployment/publication stay paused.

### Checkpoint 83: iOS stellar response validation authored (2026-09-23)

Added bounded Foundation response validation that retains raw export bytes,
compares byte-exact original files and SHA-256 receipts, scans the original CSV
for every selected field, and checks model/epoch/finite-state contracts. Optional
formal covariance requires the requested policy, coordinates, positive symmetric
matrices, original errors/correlations and agreement with J C J-transpose.
Boolean JSON values cannot masquerade as numbers. Source scanning and validation
check cancellation, retain only header/current/selected CSV rows and cap rows.

Authored real CLI-output replay checks for nominal and covariance responses,
19 altered contracts and cancellation. Fixture numeric expectations were checked
against the retained bytes. Source registration and diff checks passed, but
Swift compilation/tests remain unexecuted locally because the compiler is absent.
No full local tests ran. Existing candidate 7257372 / run 35843121444 is live;
this subsequent response work does not replace it. iOS transport/UI and live
scientific acceptance, plus the broader goal gaps, remain incomplete.

### Checkpoint 84: iOS stellar transport and file workflow authored (2026-09-23)

Connected an actor-isolated stellar service to the existing bounded URLSession
transfer, with a 14 MiB response cap, 25-second network resource timeout, HTTPS
authority/redirect rules, cancellation and backend error propagation. Encoding
and scientific validation run away from MainActor. One service rejects overlapping
requests instead of silently adding concurrent analysis work.

Added a bilingual SwiftUI section with original-file import, exact source ID and
TCB epoch, explicit RV/covariance assumptions, state/error readout and a retained
raw-response document export. Source reads share a serial actor and enforce real
byte limits plus cooperative cancellation; a UI timeout invalidates late results.
An OS/provider read already blocked may still finish later. Input/lifecycle
changes cancel tasks and invalidate results while preserving imported source bytes.

Source/Xcode registration, targeted script lint and diff checks passed. Local
Swift compilation and actual picker/export behavior remain unverified. No full
local tests ran. Candidate 7257372 has passed its Android build and its iOS Swift
request checks and simulator build; both native HTTPS UI jobs remain active.
This later response/service/UI work is not included in that running candidate.

### Checkpoint 85: diagnose and repair Android fixture permission failure (2026-09-23)

Candidate 7257372 Android UI job 107123036073 failed before stellar computation.
Downloaded its retained evidence and inspected instrumentation.log: the original
manifest import reported `open failed: EACCES (Permission denied)`, and the test
timed out waiting for the manifest byte count. Backend traffic confirms no stellar
request was issued. This is not a successful live stellar validation.

Removed adb-created app-external source staging. The original Gaia directory is
now an androidTest-only asset input, and instrumentation verifies source SHA-256
against host-provided hashes before copying to an app-owned private cache file.
The same picker-result callback, production import reader and live HTTPS request
remain under test. No production storage permission or source validation was
relaxed. The Gradle source wiring is included in future evidence hashes.

Eight focused harness/reuse tests, script syntax/lint and diff checks passed.
Native re-execution is pending; the local Android SDK is absent. No full local
tests ran. All four browser jobs and Web passed, but iOS remains live in run
35843121444, so that candidate was not replaced or promoted to main.

### Checkpoint 86: separately testable iOS bounded source reader (2026-09-23)

Moved the shared serial source reader into the Foundation scientific module so
the Swift protocol harness can exercise the exact production reader without
SwiftUI. Added an explicit supported-budget guard and authored original-file
identity, exact 1/8 MiB limits, empty/overflow rejection, pre-cancellation and
subsequent-reader recovery checks. A stellar-source-only switch permits focused
execution on a Swift host.

Source registration passed and a trailing blank line found by raw diff checking
was removed. Local Swift execution remains unavailable, so no test pass is
claimed for this new code. No full local tests ran. Run 35843121444 still has a
live iOS job; Android's diagnosed EACCES failure remains pending re-execution
with the already committed app-owned fixture fix. Main remains c3b87f7.

### Checkpoint 87: actual iOS document-picker/live-service scenario authored (2026-09-23)

Enabled the app Documents directory in Files and in-place document access for
the original-source workflow. The owned-simulator harness installs the built app,
checks its returned container belongs to the created device, writes only new
original manifest/CSV files, verifies staged bytes and records SHA-256 receipts.

Authored an XCTest path through the real document picker, explicit RV/covariance
controls, live Go HTTPS computation, expected state/sigma readout and collapse
invalidation. The harness requires successful stellar HTTP traffic before
reporting this scenario passed. This is not a picker-result callback bypass.

Thirteen focused script/reuse tests, script syntax/lint and diff checks passed.
The new native scenario has not executed and may need adjustment from actual
picker evidence; export destination writes and physical-device behavior remain
unverified. No full local tests ran. The existing run 35843121444 is still live
in iOS, with the separately diagnosed Android failure, and was not replaced.

### Checkpoint 88: bounded Android import concurrency (2026-09-23)

Replaced per-import reader threads with one shared worker and a queue capacity
of one. Cancelled queued requests are purged before admission; excess concurrent
requests fail with a bilingual retry message. This limits reader threads even
when an OS/provider read ignores interruption. Existing source/generation and
byte-limit checks remain in the import path.

Four focused plain-JVM tests passed after javac --release 17 compilation. The
new latch-controlled case deliberately ignores interruption, performs 100
cancel/retry cycles, asserts queue rejection and prevents cancelled work from
executing, then verifies recovery after releasing the read. This does not prove
actual provider interruption or UI responsiveness on a device. No full local
tests ran.

Prior run 35843121444 is terminal: iOS passed and Android failed with the
documented EACCES issue. Candidate 023248d was then pushed normally; new run
35844926364 is live and includes the app-owned fixture fix and iOS workflow.
The import concurrency change is subsequent local work, not that candidate.

### Checkpoint 89: correct the iOS scientific JSON conversion path (2026-09-23)

Run 35844926364 iOS job 107129069821 compiled the Foundation sources, then its
protocol executable failed with `Selected source value differs from CSV.` before
simulator build/UI. Cross-checking the retained Go experiment and original CSV
in JavaScript found all 35 selected fields consistent. The precise failing field
was absent from the old error, so the Foundation numeric conversion/fixture
round-trip diagnosis remains an inference pending the next Swift execution.

Changed response parsing to decode numeric tokens explicitly as Double, retaining
boolean/null/string types and a nesting budget. Normal response acceptance tests
now wrap the untouched Go experiment bytes instead of reserializing them through
Foundation's inferred numeric types. Mutations start from the same typed decoder.
Exact source equality remains required, with field names and binary64 bits in
failure diagnostics; no tolerance or source-validation requirement was relaxed.

Source registration and diff checks passed. Swift re-execution is pending and no
success is claimed for this correction. No full local tests ran. Android and
several Web/browser jobs remain live in the same run, so it was not replaced.

### Checkpoint 90: Android original-source live HTTPS acceptance (2026-09-23)

Run 35844926364 Android job 107129069868 passed on exact candidate 023248d.
Downloaded solar-atlas-android-native-smoke and inspected report.json,
instrumentation.log and stellar-live-go-covariance.png. Instrumentation completed
one full native scenario successfully; the request ledger records a real
POST /v1/stellar/motion with HTTP 200 and 56,910 response bytes.

The screenshot shows the original 5,305-byte manifest and 32,918-byte CSV,
explicit RV/covariance selections, J2026 state and six propagated formal standard
deviations. Native assertions also verified the chosen state/sigma and input
invalidation. The earlier external-file EACCES failure is resolved by the
test-asset/app-owned file path. Source bytes still enter the production importer.

This proves the callback-import → real Go HTTPS → Android simulator readout
scenario, not system-picker interaction, export destination writes or physical
device performance. The subsequent bounded-import-worker change is not in this
candidate. iOS failed its numeric source check and its fix remains queued for
the next gate; main was not advanced. No full local tests ran.

### Checkpoint 91: Android export write/HTTP-byte verification authored (2026-09-23)

Extended the native stellar scenario to click the production export button,
intercept only ACTION_CREATE_DOCUMENT's destination result, and allow the real
ContentResolver write to finish. The resulting file is validated against the
original source request and retained with the runtime artifacts. The HTTPS proxy
hashes response chunks; the harness requires the exported bytes and SHA-256 to
match exactly one successful live stellar response before reporting success.

Five focused harness tests passed, including altered, missing, duplicate and
empty export receipts. Targeted lint and diff checks passed. Native execution
of this added write scenario is pending; destination-picker interaction and
pause/resume during that picker are not covered by its intercepted result.
No full local tests ran. Candidate f771612 / run 35845967095 is live and was
not replaced with this subsequent test change.

### Checkpoint 92: nonlinear source-offset coordinates at the solution epoch (2026-09-23)

Added a bounded asynchronous conversion of 1–10,000 joint source-offset draws
through the existing universal periapsis conic solver. Inputs are validated
before offset allocation, copied before yielding, and checked for cancellation
between 32-draw batches. Periapsis-time offsets are subtracted from relative time
instead of added to large Julian dates. Invalid conics retain original offsets,
indices, failure reasons and explicit validity masks; no clipping or resampling
changes the source distribution. Additional fitted parameter values are retained.

Twelve focused tests passed, including eight independently generated 80-digit
mpmath classical-anomaly references for Eros/Bennu nominal, tiny-time, joint and
hyperbolic-offset cases. The tiny-time case verifies a 1e-10 day displacement
that would vanish when added directly to the source Julian date. Other tests
cover ownership across yields, permuted axes, failed draws and cancellation.
TypeScript build passed. The reference generator records its upstream fixture
hash and adopted GM, imports no application code, and follows conventional
conic state definitions documented by NAIF:
https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html

This is a library coordinate-conversion primitive, not nonlinear time
propagation, full fitted-force reproduction, event probabilities or native UI.
The nominal source retains the existing audited elliptic validation domain;
individual sampled conics may be hyperbolic. No full local tests ran. Candidate
f771612 remains live in iOS; its Swift protocol, simulator build, Android and
Web/browser jobs passed, but system-picker/live-service acceptance is pending.

### Checkpoint 93: skip unused state-only force Jacobians (2026-09-23)

Point-mass gravity and the solar 1PN correction no longer evaluate unused
position/velocity Jacobian entries for six-component state-only integrations.
The 42-component variational path retains its existing formulas and resets.
This removes work from the force evaluation path needed by nonlinear ensembles;
no wall-clock speedup or device frame-rate improvement is claimed.

Sixteen focused point-mass/solar-relativity tests passed, including independent
reference integrations and new alternating 6/42-state checks to detect stale
shared derivative buffers. TypeScript build, targeted ESLint and diff checks
passed. No full local tests ran. Candidate f771612 remains active in its iOS
native UI job and was neither replaced nor promoted.

### Checkpoint 94: repair iOS stellar scenario's off-screen row wait (2026-09-23)

Run 35845967095 is terminal with iOS failure; all other platform jobs passed.
Downloaded its native artifact and inspected xcode-test.log: the only failed
case stopped at ObservationUITests.swift:79 waiting for stellar.disclosure
before scrolling. No stellar HTTP request was issued. The other six native
tests passed, as did Swift scientific protocol validation and simulator build.

The stellar section is below the initial viewport in the native List. Changed
the startup wait to the visible observation.mode control, then retained the
existing bounded reveal helper to scroll to stellar.disclosure. This fixes the
test's ordering without bypassing the real document picker or source importer.
Native re-execution remains required; no picker/live stellar pass is claimed.
No full local tests ran.

### Checkpoint 95: bounded nonlinear propagation and Web workflow (2026-09-23)

Connected joint source-offset coordinate samples to six-state restricted DE440
integration, optionally including the solar 1PN term. Each run accepts at most
128 samples and 365 days, checks the frozen source interval, and shares a hard
250,000 force-evaluation budget. Budget exhaustion or cancellation rejects the
whole run. Coordinate/integration failures keep original indices, offsets,
validity masks and explicit failure reasons; survivors are never relabeled as
the original distribution. Additional fitted force parameters remain refused.

Added bilingual source-import → sample count/seed → worker calculation → readout
and JSON export in Orbit uncertainty. Input edits, source replacement, unmount
and cancellation terminate the worker. Exports retain all draws, source payload
and hash, seed/algorithm, adopted force evidence, numerical settings and build
identity. Typed arrays serialize as ordinary arrays; invalid values serialize
as null with masks/reasons and an explicit packed-array convention.

Nine focused engine tests passed. Twelve independent 80-digit-coordinate plus
CSPICE/DOP853 cases cover three hand-selected joint offsets, -10/+30 days and
both force choices; observed endpoint differences satisfy 2e-12 AU and 2e-14
AU/day thresholds. Independent tolerance refinement differed by at most
6.67e-16 in the output components. These are numerical comparison bounds for
these cases, not physical orbit uncertainties. A synthetic budget test executes
exactly 250,000 evaluations with virtual timers to avoid OS timer delays.

Two focused desktop Chromium tests passed through the real worker, original
SBDB file, pinned SPK, export, cancellation and source replacement. The positive
workflow also passed in mobile Chromium; inspected the retained narrow-screen
readout, with the wide numerical table contained in its horizontal scroller. TypeScript
build and targeted ESLint passed. No full local tests ran. This still omits
event searches/probabilities, full source-fit forces, native UI and long-term
uncertainty calibration; the broader goal remains incomplete.

### Checkpoint 96: repair reference-byte identity and Android test imports (2026-09-23)

Candidate e1e39f9 / run 35848124469 Web failed eight reference tests before the
numeric assertions: the older Windows working copy of the upstream reference
contained CRLF despite its current LF Git attribute. Its LF hash exactly matches
the CI-reported repository hash. Refreshed only that working-copy line ending,
regenerated the new reference receipt and verified every numerical case unchanged.
The generator now refuses CRLF input and writes explicit LF output across hosts.

The same candidate Android failed Java instrumentation compilation because two
new assertions lacked static JUnit imports. Added assertNotNull/assertArrayEquals
imports; local Android compilation remains unavailable without the SDK. Native
re-execution is still required. The iOS job remains live and was not replaced.

### Checkpoint 97: finite-ensemble moments and failed-export acceptance (2026-09-23)

Added anchored, compensated two-pass means and sample covariance for complete
finite endpoint batches. Computing deviations around a retained anchor avoids
subtracting a rounded large absolute mean from tiny offsets. The output keeps
anchor and mean offset separately, the n-1 divisor, all six component standard
deviations and an explicit descriptive-only limitation. A failed draw or fewer
than two draws makes the summary unavailable; no survivor-only distribution
silently replaces the original one. Degenerate zero-spread samples remain valid.

Twelve focused moment/integration tests passed, including an analytic tiny-spread
case around 2^40, translation invariance and zero spread. Extended the browser
readout and export with these descriptive moments. A real-worker browser case
with a deliberately large force exclusion confirms all four failed draws retain
their original offsets/indices, null endpoints, explicit reasons and unavailable
moments in the exported JSON. This does not assert physical confidence levels,
sampling convergence or event probabilities. No full local tests ran.

### Checkpoint 98: reproducible offline ensemble CLI (2026-09-23)

Added scripts/propagate-sbdb-ensemble.mjs with explicit restricted-model adoption,
duration, exclusion distance, count, seed and optional solar 1PN. Source reads
are capped at 2 MiB using actual bounded reads, including one-byte overflow
detection; cancellation is checked before/after reads and integration. Output
is exclusive-create and contains source bytes' hash/payload, implementation
hashes, all draw identities, force/numerical settings and descriptive moments.

Executed the actual Node CLI on original Eros data: seed 42, eight draws,
30 days and solar 1PN yielded eight valid endpoints and 2,024 force evaluations.
A focused test passed for source/implementation receipts, existing-output
preservation, pre-cancellation, oversized inputs and unmatched parameters.
No full local tests ran. The exported experiment is conditional numerical
evidence, not a complete source-fit or physical-accuracy result.

### Checkpoint 99: target actual iOS Files cells and confirm dismissal (2026-09-23)

Run 35848124469 reached a terminal iOS failure after successfully revealing and
opening the stellar import control. Downloaded the xcresult and decoded its
Zstandard attachments locally. The retained accessibility tree shows icon-mode
file cells labeled `manifest.json, json, <time>, 5 KB` and `rows, csv, <time>,
33 KB`. The old exact-label query missed those cells and tapped their filename
StaticText fallback; the picker remained open and no source import occurred.

Changed the query to exact filename tokens plus the observed metadata delimiter,
targeting the cell's image when available. The test now explicitly waits for the
Files collection view to disappear, then scrolls to the off-screen import status.
Native re-execution is required. The prior Web hash and Android import failures
are fixed in subsequent commits; main remains unadvanced until all gates pass.

### Checkpoint 100: exact identity for zero-duration ensembles (2026-09-23)

A targeted regression reproduced zero-duration endpoints differing from their
initial coordinates by Float64 roundoff after an unnecessary frame/origin round
trip. Zero-duration valid draws now copy the initial output-frame state exactly,
retaining invalid masks and zero evaluation/step receipts. Nine focused ensemble
tests passed, including the identity assertion and independent nonzero-duration
references. No full local tests ran. Candidate 690f6ea / run 35850104881 remains
live; this subsequent identity correction has not yet entered that candidate.

### Checkpoint 101: full-source 3D orthographic snapshots (2026-09-23)

Extended bounded source streaming to Float64 XYZ propagation, retained Float32
XYZ display, matching worker spatial projection and GPU orthographic uniforms.
Rotation updates view selection without downloading or recomputing source states
or uploading attribute buffers. The explicit point budget rises from 72 to 84
bytes. Bilingual controls identify the fixed-epoch two-body approximation.

Thirty-three focused unit tests, TypeScript build and targeted ESLint passed.
One named browser case passed on desktop and mobile Chromium: changed pixels,
8,000 retained points and zero rotation source/attribute uploads. A real-source
RTX 5070 Ti run loaded all 1,561,171 rows / 313 shards in 1563.7 ms, with
43,712,788 GPU attribute bytes, 33,119 displayed representatives and no page/GL
errors. Twelve rotations added no requests or attribute uploads. Original
receipt and limitations are in docs/benchmarks/catalog-3d-20260923/. This is a
static epoch, not continuous-time streaming or native hardware evidence.
No full local tests ran. Candidate 690f6ea remains live in iOS; these changes
are queued locally until its run is terminal.

### Checkpoint 102: Android live-response export verified (2026-09-23)

Downloaded the successful Android artifact for run 35850104881, candidate
690f6ea, and inspected its report and exported file. The real stellar HTTPS
response and ContentResolver-written export both contain 56,910 bytes with
SHA-256 b39baaf5d8e3b70aa112347530b2c6717f96873e5310cedb46c7ddb92e21fcf1.
This closes the authored export-write acceptance gap from checkpoint 91.
The destination result remains stubbed; actual system-picker interaction and
physical-device performance remain unverified. iOS is still running.

### Checkpoint 103: source-flag shard priorities and four-browser 3D acceptance (2026-09-23)

Added optional NEO-first/PHA-first shard admission using original compact-index
flags. Matching candidate shards with a preferred flag precede the others,
with stable original order inside both groups and each shard visited once.
Original Float64 filtering, four admitted transfers, cancellation and capacity
bounds remain enforced. A shard may contain ordinary rows, and preliminary
index matching does not promise every tagged row passes exact source filters.
Bilingual controls explain these limits and invalidate the prior snapshot when
priority changes. Truncated results depend on order and are not risk estimates.

Twenty-two focused streaming tests passed, including late-tag priority, ordinary
row retention, no duplicates, partial capacity and invalid priority refusal.
A named desktop browser case confirms actual worker request order and snapshot
invalidation. TypeScript build, targeted ESLint and diff checks passed. The
previous 3D rotation case also passed in Firefox and WebKit, completing its
four-browser targeted coverage. No full local tests ran. This is explicit
source-tag scheduling, not camera/selected-body priority or continuous time.
Candidate 690f6ea remains live in iOS and was not replaced.

### Checkpoint 104: real-source priority capacity and excluded-tag boundary (2026-09-23)

The benchmark now records explicit source priority. A single real-source
NEO-first 30,000-point 3D run took 283 ms, first nonempty draw 225.9 ms, and
840,000 attribute bytes on the same verified desktop D3D11 renderer. Four-way
admission fetched nine shards (six used, three prefetched). Twelve rotations
added no requests, allocations or attribute uploads. There were no page/GL
errors or recorded long tasks. The receipt is under
docs/benchmarks/catalog-neo-3d-20260923/. This is an order-dependent partial
shard sample, not 30,000 NEOs, complete coverage or native hardware evidence.

One additional focused regression passed: a flagged row excluded by exact name
locators or index-precision filters cannot elevate its otherwise eligible shard.
No full local tests ran. Run 35850104881 remains live in its iOS UI step.

### Checkpoint 105: stop picker-geometry guesses and capture native lifecycle (2026-09-23)

Run 35850104881 is terminal: all other platform jobs passed, iOS failed at
ObservationUITests.swift:106 because the Files collection did not disappear.
The exact manifest cell was found; its image was not hittable, so the existing
cell fallback was tapped. The retained screenshot still shows the two normal
files and no calculation occurred. This supersedes the earlier assumption that
filename matching alone explains the failure. Repeated locator fixes have not
resolved the chain; no further click-position workaround was applied.

Added privacy-limited OSLog phases for import request, presentation binding,
completion callback, bounded read, section disappearance and scene deactivation.
The owned-simulator harness now retains that subsystem log before shutdown even
on failure. No source bytes, URLs or user filenames enter these log messages.
This is diagnostic instrumentation, not a claimed picker fix. Apple documents
the presentation binding and completion callback separately:
https://developer.apple.com/documentation/swiftui/view/fileimporter(ispresented:allowedcontenttypes:oncompletion:)
The next native execution must distinguish missing selection/callback from
lifecycle cancellation before changing importer behavior.

Nine targeted iOS harness tests and targeted lint/diff checks passed; Swift
execution remains unavailable locally. No full local tests ran. Main remains
unadvanced; the next candidate also contains checkpoints 100 through 104.

### Checkpoint 106: source-derived temporal reuse for sample coordinates (2026-09-23)

Added an opt-in sample-map displacement budget using each elliptic source
mean motion and periapsis speed. Reuse preserves the actual Float64 snapshot
and its computed epoch; it cannot relabel old states as newly propagated.
Known UTC leap changes enter through TT elapsed time. Invalid/overflowing or
pre-1972 bounds disable reuse. Dataset changes and errors invalidate the cache;
tightening the budget computes the latest requested epoch. Default zero
retains existing playback cadence and only deduplicates identical epochs.

Nineteen focused temporal/scheduler tests passed: analytic circular/e=0.6 speed,
high-eccentricity periapsis displacement, both time directions, the 2017 leap
boundary, invalid inputs, budget tightening and dataset replacement. Named
desktop/mobile Chromium tests passed through the real worker, proving clock
advance without extra compute requests or changed epoch labels while within
budget, then renewed computation when disabled. TypeScript and targeted lint
passed. The model derivation and limits are in point-pipeline-performance.md.
No full local tests ran. This is sample scheduling, not a physical error
certificate or full-source continuous-time delivery. Candidate ff6d190 /
run 35852896925 remains active and was not replaced.

### Checkpoint 107: original PCK orientation models and user access (2026-09-23)

Added all 75 orientation models from the fixed original PCK, retaining exact
IDs and reference epochs. The loader shares original byte/hash verification
with radii and excludes comment examples. It evaluates source polynomial
degrees, periodic terms, Mars quadratic phases and Tempel 1 reference time.
Outputs state the J2000-to-body-fixed matrix convention, TDB time and unknown
physical uncertainty. The ±100 Julian-year numerical evaluation policy is
explicitly not a physical-accuracy interval or binary-PCK equivalence.

Seven focused orientation/radius tests passed, including 300 independent
CSPICE matrices spanning every source model; maximum observed component
difference was 7.863124040774494e-11. A separate CLI test passed for source
receipts and exclusive output creation, and the actual Phobos CLI completed.
Bilingual Web readout/export and desktop/mobile named browser cases passed.
The browser checks caught and verified the fix for reversed export arguments;
actual exported JSON now contains the matrix and source receipt. Narrow-screen
output was inspected. TypeScript build and targeted lint passed. No full local
tests ran. See docs/pck-orientation.md for primary references and reproduction.

This adds real orientation access, not ellipsoidal contact search, limb
topography, apparent-limb corrections, native integration or physical accuracy
certification. Candidate ff6d190 remains live in iOS; these changes stay local
until that run is terminal.

### Checkpoint 108: finite-distance source ellipsoid limbs (2026-09-23)

Added a bounded finite-distance triaxial limb evaluator with explicit
body-center/J2000 conventions and conjugate ellipse generators. Original PCK
axes and orientation are available together through evaluate-pck-limb.mjs;
missing exact IDs are rejected, original and implementation hashes retained,
and existing outputs protected. Actual Phobos CLI execution succeeded.

Four named unit cases passed: 42 independently generated CSPICE edlimb
comparisons, surface/tangency equations, analytic spheres, rotation and
conditioning rejection, and actual export behavior. Geometry-only normalized
comparisons pass 1e-12; composed orientation/geometry comparisons pass 2e-10.
The initial 1e-12 composed test exposed previously measured orientation
roundoff; fixtures now preserve the independent rotation to distinguish the
two error contributions. TypeScript and targeted lint passed. No full local
tests ran. See docs/ellipsoid-limb.md. Apparent corrections, contact searches,
native/Web limb access and physical error certification remain unfinished.

Diagnostic candidate ff6d190 / run 35852896925 is now terminal: Web, four
browsers and Android passed; iOS failed. Downloaded lifecycle evidence shows
manifest request and importer presentation, but no completion callback, read
start or section disappearance during the failed import. This does not support
a source-reader failure, nor prove a root cause inside the system picker.
The same run additionally failed a fully-visible-frame assertion for source
row 50 at y=755, height=129.7 in an 874-point screen. No further blind picker
tap workaround was applied. Main remains c3b87f7; delivery is not complete.

### Checkpoint 109: evidence-guided native visibility and provider diagnostics (2026-09-23)

Decoded and visually inspected both actual iOS failure screenshots from
run 35852896925. The Files picker remains visible with the original files;
the source-directory row is only partially visible at the bottom. Replaced
the directory reveal helper's full-screen up/down sweeps with bounded drags
guided by the element's current frame, keeping the full-visibility assertion.
This is a test navigation repair; simulator execution must still verify it.

Importer lifecycle markers alone did not identify a root cause. The managed
fixture-only simulator now retains default/error/fault logs from the app and
document/file-provider processes before shutdown, with a 20-minute window and
30-second collection deadline. Actual import behavior and picker tapping are
unchanged pending that evidence. Nine named native-harness unit cases, targeted
lint and the native source/packaging contract passed. No local full suite or
local Swift execution was performed. The next candidate also includes the
temporal budget, PCK orientation and ellipsoid limb commits; main delivery
remains gated on exact-candidate checks.

### Checkpoint 110: Web access to finite-distance source limbs (2026-09-23)

The bilingual PCK panel now optionally accepts a body-center-relative J2000
observer vector, validates original axes for the exact orientation body ID,
and evaluates the finite-distance limb. The readout preserves source semi-axes,
center and conjugate generators; JSON export retains the observer and geometric
limitations. Illustrative defaults are labeled. Interior/surface observers
are rejected, input changes clear stale results, and disabling limb evaluation
restores orientation-only behavior.

Four named desktop/mobile Chromium browser cases passed, including actual
download parsing and independent CSPICE center comparison, invalid observer
handling, stale-result clearing and narrow-screen overflow checks. TypeScript
and targeted lint passed. No full local tests ran. Native limb access,
ephemeris-fed observer geometry, contour drawing and apparent/contact analysis
remain unfinished. Candidate 5936fca / run 35856001727 is active; these later Web
changes remain local until it is terminal.

### Checkpoint 111: source-SPK observer geometry and emission-time limbs (2026-09-23)

Added runSpkLimbExperiment and an actual offline JSON-input command, using
verified frozen DE440 states, original PCK axes and exact-ID orientation. NONE
uses simultaneous geometry; CN holds the observer at reception, converges the
target-center light time and evaluates orientation at emission. Explicit
source margins and unsupported body/barycenter identities fail closed. The
receipt retains original input/hash, both epochs, iteration evidence, source
hashes and implementation hashes. No trajectory integration is performed.

Four named tests passed, including 12 independent CSPICE composed references
for Moon/Earth/Venus, frozen source/input bytes, invalid coverage/margins,
corruption, cancellation and real exclusive CLI writes. Observer components
pass 2e-6 km, normalized geometry and orientation pass 2e-10. The original
Moon example CLI ran successfully with emission 1.2373275155 seconds before
reception. TypeScript and targeted lint passed; no full local tests ran.
Differential limb light time, stellar aberration, deflection, ground observer
transforms, contact/event completeness and Web/native SPK-limb access remain
unfinished. Candidate 5936fca remains running; subsequent changes stay local.

### Checkpoint 112: unique identities for source-replaced science panels (2026-09-23)

Candidate 5936fca's completed Firefox and mobile Chromium jobs revealed a
duplicate covariance propagation summary after switching Eros to Bennu.
Inspection found sibling CovarianceTimePropagation and NonlinearOrbitEnsemble
instances using the same source hash as their React key. Added distinct
covariance/ensemble prefixes while retaining source-change remounting. The
regression waits for the new source identity and requires exactly one summary;
it does not choose the first duplicate or relax conditional-model guards.

The two covariance browser cases passed under desktop Firefox and mobile
Chromium (four executions), covering actual worker propagation/export and
pending-source cancellation. Targeted lint and diff checks passed. No full
local tests ran. The current candidate's iOS job remains live and will not be
replaced before its diagnostics are retained. This fix is local pending the
next exact-candidate verification.

### Checkpoint 113: cancellable Web source-SPK limb workflow (2026-09-23)

Added bilingual editable exact IDs, TDB reference/elapsed time, NONE/CN mode
and explicit source margin in the evidence workspace. A calculation
discriminator reuses the existing bounded DE440 worker transport, retaining
byte cap, hash verification, timeout and termination-based cancellation.
Outputs include observer position, limb center/generators and both epochs;
actual JSON exports carry the source/input evidence. Input changes clear and
terminate pending calculations. Missing coverage is never approximated.

Desktop/mobile Chromium passed actual worker/source export against CSPICE,
NONE switching, exact-ID rejection, cancellation and HTTP 503 failure (four
executions). A separate existing contact-worker browser case passed after
the shared transport change. Initial checks exposed an accessible select-name
problem and a test interception assumption about a single source request; both
were corrected, without weakening numeric checks or cancellation behavior.
TypeScript and targeted lint passed; no full local tests ran. Native access,
apparent corrections, contour visualization and ellipsoid contact searches
remain unfinished. Candidate 5936fca is still running in iOS; these changes
remain local pending a terminal result and the next candidate run.

### Checkpoint 114: native picker succeeds; switch activation is the remaining step (2026-09-23)

Run 35856001727 is terminal. The new bounded scroll helper passed source
directory selection/inventory-change testing. Gaia lifecycle logs now prove
both actual system-picker callbacks and bounded file reads: 5305 manifest
bytes and 32918 CSV bytes. Failure moved beyond import: screenshot and actual
accessibility state show both switches still off and Calculate disabled,
with no stellar HTTP request. XCTest tapped the outer row-sized Switch's
label area, not its nested actual switch. Added child-control selection and
an explicit value=1 assertion for both switches, then an enabled-button
assertion before calculation. The system picker and application import logic
remain unchanged. Swift execution awaits the next candidate.

Provider diagnostics also included 55.8 MB of XCTest hierarchy queries;
excluded only that subsystem from the provider log while retaining app,
provider, default/error/fault and the separate import lifecycle evidence.
No scientific/native acceptance is claimed beyond the observed stages.
Firefox/mobile covariance duplicate-panel failures have already been fixed
and verified locally; all subsequent changes will enter the next candidate.

### Checkpoint 115: remove per-body view allocations in source streaming (2026-09-23)

Replaced eight-value subarray/set copies with direct Float64 copies inside
the catalog filter loop. Full source loading avoids 1,561,171 temporary typed
array views. No source order, filters, capacity, positions, transfer or culling
semantics changed. A reproducible 313-shard microbenchmark retains exact-byte
hash parity under full, half and one-percent synthetic retention masks.
Ten alternating warmed full-retention samples measured 39.8034 ms median
before and 12.1543 ms after; sparse copies show little difference.

Actual full-source browser runs before/after completed with identical row,
representative and attribute-byte counts, four-way loading, zero observed
long tasks and no attribute/network work during twelve rotations. Single-run
load times were 1616.8/1585.3 ms: not a statistically established whole-pipeline
speedup. Reports, source/harness hashes and explicit scope limits are retained
in docs/benchmarks/catalog-row-copy-20260923. Twenty-three named streaming
tests, targeted lint and production build passed. No full local tests ran.
Candidate 4d9e9e6 / run 35857808370 remains live and is not replaced.

### Checkpoint 116: bounded stream ownership without per-chunk retention (2026-09-23)

The bounded artifact reader formerly retained every upstream Uint8Array view
until final concatenation. Tiny views could pin large backing buffers, and
a sequential producer reusing its buffer could alter previously consumed
bytes. Replaced retained chunks with an immediately owned byte buffer that
grows geometrically up to the declared byte limit and returns the exact length.
Default 64 MiB limits do not cause eager 64 MiB allocations for small JSON.
Overflow is checked before copying; cancellation and lock release remain.

Twenty-nine named bounded-delivery/streaming cases passed, including a reused
1 MiB backing buffer with small views, 65,539 single-byte chunks crossing growth
boundaries, zero-byte responses, cancellation, gzip limits and exact catalog
source behavior. TypeScript and targeted lint passed. No full local tests ran.
This removes retained per-chunk views; transient growth copies, the upstream
stream's own allocations and browser/process RSS are separate from the byte
limit. Candidate 4d9e9e6 remains active; changes are local until it is terminal.

### Checkpoint 117: verification hold and recovered calculation status (2026-09-23)

The user now prohibits running or waiting for any tests and requires all
implementation work to finish before testing and submission. This supersedes
the earlier targeted-test and candidate-delivery cadence: do not start tests,
poll or wait for CI, commit, or push during the implementation phase. Existing
runs were already started; no later outcome is asserted here. Read-only code,
source, contract and diff inspection remains authorized.

Source inspection of the catalog scheduler and hook found that a recoverable
propagation error clears the result but leaves the worker initialized for a
later epoch. A subsequent successful result updated positions and progress
without clearing the old error banner. The success callback now clears that
error alongside the accepted result. Existing dataset/mode identity and
retired-worker guards remain in place. This change has not been tested; no
runtime recovery claim is made. The broader scientific and rendering scope
remains unfinished, and all new work stays uncommitted until that scope is
complete and the requested final verification stage is reached.

### Checkpoint 118: streamed snapshot terminal-state isolation (2026-09-23)

Source inspection found that a worker completion queued before cancellation
could overwrite the cancelled state, and a failed draw inside tile flushing
could still acknowledge uploads and replace the error with loading status.
The canvas now ignores late load-terminal messages after cancellation, failure
or completion, stops flushing after a draw failure, and invalidates pending
selection responses on failure. A new source/epoch resets loading counts
without carrying the previous snapshot's completion or error banner forward.
The deferred reset is guarded against intervening cancellation or failure.

Spatial selection remains available for retained completed/cancelled snapshots.
Its errors now use a separate response with view request ID and row count,
so stale camera errors cannot fail a newer view and current selection errors
are not hidden by the load-terminal guard. Worker selection errors are handled
per request, allowing a newer queued view to be processed. The response union
and its production sender/consumer were inspected together. No tests, builds,
CI polling, commits or pushes were performed. Browser event-order behavior
and regression coverage remain explicitly unverified until the final stage.

### Checkpoint 119: observer-perspective source-limb visualization (2026-09-23)

Inspected stream admission, transfer-credit cancellation, bounded reader
ownership and renderer disposal. No additional resource change was justified
by that inspection. Implemented the previously missing Web source-SPK contour:
256 samples of the original J2000 generators are projected from the actual
body-relative observer onto an equal-scale tangent plane. The origin is the
body direction; axes are dimensionless perspective coordinates, with explicit
J2000 north/east orientation and a labeled polar fallback. Whole-contour
positive depth is checked analytically before sampling. Display failure does
not discard the scientific receipt.

Web export now retains the sampled display coordinates, basis, segment count,
extent and limitations separately from original limb/source data. The SVG
has a title, description, axis convention and scale caption. It does not show
illumination, angular area, physical uncertainty or event probability, and
sampling has no certified interpolation bound. Only source/types-at-call-site
and diff inspection were performed; no compiler, build, test, browser run, CI
poll, commit or push. Numeric projection parity, visual rendering and export
regressions remain unverified until the user-authorized final testing stage.

### Checkpoint 120: oriented-ellipsoid sightline integration (2026-09-23)

Added optional single-ray geometry to the shared SPK-limb engine, offline
input/export and bilingual Web panel. The normalized outward J2000 direction
uses the same original PCK axes and frozen orientation as the displayed limb.
Semi-axis scaling reduces the calculation to a forward ray/unit-sphere
intersection; cross-product impact distance avoids subtracting large squared
norms, and a product-of-roots expression stabilizes the near intercept.
Source conventions were checked against NAIF surfpt documentation. Original
inputs/hashes and CLI implementation hashes include this new calculation.

Outputs distinguish miss, intercept and near-limb-indeterminate, retaining
first distance, body-fixed/J2000 points and numerical diagnostics. The
128-epsilon screening policy is explicitly not a certified bound. The Web
default is an illustrative direction, not Gaia data; a ray is not a finite
background body or stellar disk. No contact search, correction transform,
event probability or physical uncertainty is claimed. This implementation
has source/diff inspection only: no numerical executions, tests, builds,
browser checks, CI waiting, commits or pushes. CSPICE parity, near-surface and
near-tangent behavior, input rejection and actual Web exports still require
the final verification stage. The complete scientific goal remains active.

### Checkpoint 121: cross-platform stellar epoch receipt checks (2026-09-23)

Audited the Gaia propagation/SPK sightline boundary. The stellar result is a
TCB-compatible barycentric ICRS catalog state and explicitly lacks observer
parallax/deflection/aberration; passing its RA/Dec directly to the new ray
intersector would not establish a common observer/correction convention.
That automatic bridge remains unfinished.

Found a concrete three-client receipt gap: finite two-part TDB dates were
accepted without verifying the requested TCB source/target epochs. Web now
checks them through the existing barycentric-time conversion; Android and
iOS apply the same affine relation. Each compares split dates with a stated
two-microsecond representation tolerance and rejects out-of-domain/mismatched
epochs. ERFA's primary tcbtdb implementation and constants were inspected;
the IAU PDF link currently returned 404, so the additional reference is retained
in gaia-data.md. No source rows, propagated states or backend model were changed.

All three edits remain uncompiled and untested. Diff/source inspection only;
no tests, CI polling, commits or pushes. Native execution, equivalent date
splits, stale dates and omitted-scale rejection need final-stage verification.

### Checkpoint 122: source-backed observer/stellar coordinate-direction core (2026-09-23)

Implemented FromCSVAtStation and POST /v1/stellar/observer. The original Gaia
manifest/CSV and explicit RV policy are combined with UTC/WGS84 station input.
Existing observation evaluation supplies the SPK/IERS observer; its two-part
TDB date determines the TCB stellar propagation epoch. A split-date residual
is preserved after Julian-year rounding. GoFA Pmpx applies observer parallax
and its approximate Rømer term using the propagated catalog state with
TDB-compatible rates/parallax. The actual installed GoFA signatures and primary
ERFA Pmpx contract were read before wiring the call.

The response retains both scientific receipts and catalog/EOP identity, with
an explicitly coordinate-BCRS direction and exclusions. The route has strict
fields, explicit station components, bounded original sources/wire response,
one shared compute admission lease, batch scheduling, deadline and cancellation.
No direct Gaia RA/Dec-to-ray shortcut was introduced. Stellar aberration,
deflection, horizontal display, observer covariance, Web/native controls and
ellipsoid/event integration remain required subsequent work.

Only code/import/dependency inspection, gofmt and diff inspection were done.
No compiler, calculation, test, endpoint call, CI polling, commit or push.
The composition's numerical behavior, reference parity, resource behavior and
API delivery are unverified. The existing narrower propagation evidence does
not verify this new observer model or close the overall goal.

### Checkpoint 123: Web station-direction entry and composed receipt validation (2026-09-23)

Added the stellar observer client and station mode to the existing Gaia panel.
UTC and WGS84 station fields are blank/required; original files and explicit
RV assumptions are reused. Edits, mode switching and cancellation invalidate
the request. Station directions and propagated barycentric catalog values are
displayed separately, with full source-bearing JSON export. No covariance
option is silently applied to the new observer direction.

The client retains byte/deadline/cancellation bounds and composes existing
original-source and ground-observation validators. Added matching observer
epochs, derived TCB year, split-date residual, model identity, Earth/Sun source
coverage, unit direction and RA/Dec consistency guards. These guards do not
independently prove numerical observer corrections. No compiler/build/test,
browser/endpoint execution, CI polling, commit or push was performed. Native
controls, apparent corrections and event integration remain incomplete; all
new behavior awaits the final-stage validation requested by the user.

### Checkpoint 124: same-context stellar apparent/airless transforms (2026-09-23)

The observation result now retains its Apco context privately in process.
ObserveStellarCoordinate accepts a finite unit coordinate direction, applies
solar distant-source deflection and observer aberration, then the same
precession/nutation and horizontal transformation. No second parallax/proper
motion or diurnal aberration is applied. The source-star observer receipt
exports a separate observed record; the uncorrected coordinate direction
remains independently labeled. Context-free deserialized receipts cannot
invoke this transform.

Added GCRS/CIRS and airless horizontal outputs, pre-correction solar elongation,
solar-deflection limiter diagnostics, corresponding Web validation/readouts
and explicit visibility/refraction exclusions. Installed GoFA signatures,
Apco Diurab handling and primary ERFA Atciqz/Ldsun documentation were inspected.
Only source inspection, formatting and diff checks were done: no compiler,
numeric calculation, tests, browser, CI polling, commit or push. Physical
accuracy, independent reference parity and actual UI/API behavior remain
unverified. Atmospheric handling, native controls, event integration and the
rest of the full goal remain unfinished.

### Checkpoint 125: explicit stellar refraction with retained airless result (2026-09-23)

Extended the station stellar request with optional four-field atmosphere,
requiring each field on the wire and reusing existing ground-input ranges.
The observation context retains separate airless and refracted astrometry;
non-finite Refco coefficients are rejected. Stellar observed output now uses
model sofa-ldsun-ab-cirs-atioq-v1 and explicit refractionStatus. Below airless
altitude 5 degrees it emits a domain warning and no refracted direction;
otherwise it uses the same proper direction with the retained Refco context.
Coordinate/GCRS/CIRS and airless outputs are not replaced by refraction.

Web weather fields start blank and are required only when selected. Request
and response validation checks input ranges, echoed atmosphere, status,
altitude boundary, warning and output presence. Both directions and all
inputs remain in the export. Primary ERFA Refco documentation was read; the
5-degree rule is explicitly a software boundary, not physical accuracy.
Source inspection, gofmt and diff checks only: no tests, builds, numerical
execution, browser, CI waiting, commits or pushes. Real endpoints, parity,
boundary/cancellation behavior and native consumers remain unverified.

### Checkpoint 126: native station request types without fabricated epochs (2026-09-23)

Implemented Android/iOS observer request types carrying original manifest/CSV,
exact decimal source ID, explicit RV assumption, UTC, WGS84 station and optional
complete atmosphere. Shared the existing source-only validation between old
and new requests; station requests do not need an invented catalog target year.
Android owns cloned byte arrays; Swift uses immutable Data values. Both enforce
source/wire byte budgets and check cancellation during encoding. ASCII UTC
syntax is checked locally while real calendar/leap seconds remain in SOFA.

The Swift type is in the already registered native source file; Android's new
source uses only the existing Java/API-24-compatible facilities. Code and diff
inspection only: no Java/Swift compiler, tests, app execution, CI polling,
commit or push. This is construction groundwork, not native functionality:
observer report validation, bounded transport, UI and actual acceptance still
need completion. The earlier catalog-propagation native path remains separate.

### Checkpoint 127: Android observer receipt and bounded transport (2026-09-23)

Added StellarObserverReport with original-source reconstruction, station and
weather echoes, SPK/IERS hashes, Earth/Sun reception coverage, model and split
epoch checks, derived TCB-year/residual agreement, coordinate unit-vector and
RA/Dec consistency, apparent output ranges and refraction-state invariants.
Extracted the existing nested stellar validator so this path does not have to
serialize/reparse a nested envelope or retain another complete response copy.
The original outer response is retained and exposed only by defensive copies.

StellarMotionService now exposes loadObserver and shares its existing HTTPS,
single-active-call, redirect refusal, bounded exact-length JSON transport and
deadline/cancellation handling with catalog propagation. The old load entry
point remains distinct. These are source-reviewed implementations only; no
Java compiler, tests, HTTP execution, emulator, CI polling, commit or push.
Android UI, iOS observer report/service and final native numerical/live checks
remain required. The whole goal remains active and unverified.

### Checkpoint 128: Android station-mode controls and source export (2026-09-23)

Wired StellarObserverRequest/Report/loadObserver into the original-file panel.
Added Chinese/English station and optional weather controls with blank explicit
inputs. Catalog epoch/covariance are hidden in station mode. Existing request
generation, cancellation, lifecycle close, source import and export mechanisms
are shared; every new input invalidates old calculations. The result separates
coordinate BCRS, CIRS, airless and refracted values and displays source and
model warnings. The document-provider export name distinguishes station and
catalog outputs; receipt bytes are preserved.

Only source/resource/call-site and diff inspection was performed. No compiler,
tests, emulator/device/browser, live endpoint, CI polling, commit or push.
Actual controls, layout, cancellation, source callbacks, numeric output and
destination writes are unverified. iOS observer decoding, transport and view
remain unfinished, alongside the broader scientific/performance objective.

### Checkpoint 129: iOS observer receipt validation and transfer entry point (2026-09-23)

Added NativeStellarObserverReport with source reconstruction, station/weather
echoes, SPK/IERS coverage and identities, split-date/TCB-year consistency,
coordinate-vector/angle agreement and apparent/refraction invariants. It
reuses the direct-binary64 scientific JSON decoder and extracted nested Gaia
validator, preserving original outer response bytes without nested re-encoding.
Typed immutable fields and warnings are ready for the view.

NativeStellarMotionService now provides loadObserver alongside catalog load;
both share the HTTPS transfer and actor single-active-call guard. Size,
deadline and cancellation handling are retained. New types stay in existing
registered sources. Source and diff inspection only: no Swift compilation,
tests, simulator/device, live endpoint, CI polling, commit or push. iOS UI,
independent scientific parity and actual native acceptance remain unverified.

### Checkpoint 130: iOS station-mode controls and original receipt export (2026-09-23)

Connected the station request/report/service to the existing original-file
SwiftUI panel. UTC, WGS84 longitude/latitude/ellipsoid height and optional
weather start blank. Station mode does not read the hidden catalog year or
apply its covariance setting. Every input/mode edit invalidates the current
generation and cancels its task; existing bounded import and lifecycle handling
remain shared. Results separate coordinate BCRS, CIRS, airless and refracted
directions, surface solar-limiter/refraction-domain warnings and source hashes,
and retain the backend model limitations.

Export snapshots both the original response bytes and the mode-specific name
before presenting the destination picker, so lifecycle result clearing does
not change that snapshot. Source inspection confirmed azimuth/altitude ordering
against the decoder and matched request/service signatures. Diff whitespace
inspection passed. No compilation, tests, numerical execution, app/browser,
endpoint calls, CI polling/waiting, commits or pushes were performed. Runtime
layout, import/export/cancellation and scientific reference parity remain
unverified. The broader goal, including event integration and full-catalog
time/camera streaming, remains incomplete.

### Checkpoint 131: source-backed station stellar/ellipsoid composition (2026-09-23)

Added a distinct station limb experiment that validates the original stellar
observer receipt against its request and checks its Earth/Sun kernel identities
against the pinned limb SPK. It takes station position, split TDB reception time
and coordinate BCRS direction from that receipt; no body-center observer or
apparent/refracted direction is substituted. Shape/orientation and target state
retain exact IDs, with bounded NONE/CN behavior and preserved limitations.
The input cannot override station, epoch or sightline. Source byte budgets,
owned snapshots, cancellation checks and original receipt text/hash are retained.

Added a bounded-file offline entry point with exclusive output creation and
implementation hashes. Observer request validation is shared by online and
offline paths; runtime imports in that dependency chain now carry explicit
TypeScript suffixes for the existing Node stripping convention. Source/diff
inspection only: no script execution, compile, test, numerical calculation,
browser/native run, endpoint call, CI polling/waiting, commit or push. Runtime
and scientific parity, Web/worker/native composition, contact searches and
the full scientific/performance goal remain unfinished.

### Checkpoint 132: station stellar-limb worker and Web delivery (2026-09-23)

Added typed worker request/response discriminators for contact, body-center
limb and station stellar-limb calculations. The station path checks input and
receipt budgets before source download, preserves source validation in the
experiment, and uses transferred input buffers. Existing contact/limb views
now reject a mismatched calculation response. The source stream reader lock
is released on success or error.

The Web observer client can retain validated original response JSON as well
as parsed results; it snapshots request fields before asynchronous transport.
Gaia station results embed a dedicated stellar-limb panel, with target and
NONE/CN controls, result/contour/source export, manual cancellation and a
main-thread 30-second worker termination timer. Replacing or editing the parent
observation unmounts its generation-keyed panel. Station exports preserve the
original response text and separately export the request for offline use.

Only source, message/call-site and diff inspection was performed. No compile,
test, calculation, browser/native app, endpoint request, CI polling/waiting,
commit or push. Runtime layout, lifecycle/timeout behavior and scientific
reference parity remain unverified. Native limb integration, contact searches,
full-catalog temporal streaming and the rest of the goal remain incomplete.

### Checkpoint 133: shared-basis stellar sightline display (2026-09-23)

Added a validated coordinate-ray projection using the existing limb display
basis and extent. It distinguishes inside/outside plot, opposite hemisphere
and near-projection-horizon directions. Only an inside point receives a fixed
cross marker; outside rays are not clamped or forced into the contour. Basis
and unit-direction checks, explicit numerical screening policy and exportable
display diagnostics preserve the separation from the 3D intersection result.

Both the station stellar panel and manual SPK sightline panel now display and
export the marker. Captions/accessibility text distinguish the body-center dot,
ray cross, missing projection and stellar-diameter limitations. Source/call-site
and diff inspection only; no test, numerical execution, compile, rendered UI,
CI polling/waiting, commit or push. Physical accuracy, display/runtime behavior,
native delivery, event searches and full-catalog temporal scaling remain open.

### Checkpoint 134: budgeted retained full-catalog source preparation (2026-09-23)

Source inspection located full-stream epoch reloads in the canvas effect and
per-shard prepared coefficients discarded after the first snapshot. Added
explicit optional epoch retention to budget planning and source streaming,
charging ten Float64 coefficients (80 bytes) per admitted row. The worker now
copies contiguous prepared blocks into one retained store and seals it only
after initial upload ACKs drain; completion reports retention availability.
Cancellation and errors drop this retained source reference.

Factored propagation so a selected retained range can write into a bounded
Float64 tile without allocating a full catalog position frame. The store uses
one compute lease, default 1,024-row output tiles, cooperative 256-row slices,
abort/supersession checks and explicit output-buffer ownership return. The
existing whole-frame indexing and two-body/TT model remain shared.

Source/diff inspection only: no tests, compile, benchmark, calculation,
browser/native execution, CI polling/waiting, commit or push. These interfaces
are not yet continuous rendering: epoch worker messages, position-only GPU
replacement, coherent publication and UI controls remain unfinished. Current
static-source benchmarks do not prove temporal throughput or retained-memory
behavior. The full goal remains active.

### Checkpoint 135: recycled epoch protocol and coherent GPU update contract (2026-09-23)

Added worker epoch/start/tile/ACK/done/error messages. Epoch requests require
sealed retained sources and increasing IDs; only the latest pending epoch is
kept. One transferred Float64 tile awaits ownership return before computation
continues, with a 30-second ACK deadline. Cancellation settles the pending
transfer. Incomplete culling coordinates cannot produce spatial selections.

The fixed-capacity renderer adds contiguous position-only replacement with
unchanged appearance buffers. Begin/invalidate clear the canvas, and drawing
stays blank until all rows are uploaded and the GL error state is checked.
New updates can restart an incomplete frame without allocating a second full
GPU frame. The static canvas ignores temporal messages until its consumer
integration is implemented.

Source/message/call-site and diff inspection only: no compile, tests, benchmark,
numeric execution, rendered UI, CI polling/waiting, commit or push. Canvas
orchestration, coherent CPU context restoration, UI controls and measured
temporal throughput remain unfinished, along with the broader active goal.

### Checkpoint 136: retained-epoch canvas orchestration and controls (2026-09-23)

Connected retained epochs to the Web canvas using a changing target time
separate from the source-load epoch. Position tiles update the GPU and existing
CPU restoration arrays before ownership-return ACKs. Partial epochs remain
hidden, including after context recreation, and have no computed-date label.
Completed epochs validate row/epoch identity, refresh spatial selections and
receive a presentation opportunity before following the latest queued time.
Cancellation/error cleanup retains this coherent-frame boundary.

Added opt-in time following and explicit 64–512 MiB budgets in the workspace;
admitted capacity accounts for coefficient retention and 2 MiB temporal scratch.
Playback uses the existing five-second target sampling. Worker output tiles
are 16,384 rows, avoiding an unnecessary 1,024-row-per-frame ACK ceiling while
retaining 256-row cooperative compute slices and one outstanding transfer.

Source/state-transition/call-site and diff inspection only. No tests, compiler,
calculation, benchmark, browser/native run, CI polling/waiting, commit or push.
This is unverified discrete-epoch integration, not proof of live performance or
continuous animation. Hierarchical temporal refinement, native integration and
the broader scientific/performance goal remain unfinished.

### Checkpoint 137: source-bounded full-stream epoch reuse (2026-09-23)

Reused the existing two-body periapsis speed cap over exact selected Float64
source rows during initial streaming. The completion receipt carries the
aggregate maximum only for retained epochs; empty/unsupported/overflowing
values disable reuse. No reconstruction from quantized render coordinates or
additional raw-source retention is used.

Added a separate optional full-stream displacement budget, default zero. The
canvas evaluates TT elapsed time against its actual completed epoch and skips
recomputation only for a known within-budget cap. Original computed-date labels
remain unchanged and a separate model-displacement readout explains exclusions.
Budget changes reconsider the latest target without source reload.

Source/call-site and diff inspection only: no tests, compile, scientific
execution, benchmark, browser/native run, CI polling/waiting, commit or push.
This whole-snapshot reuse reduces redundant work in principle but has no new
measured performance or correctness evidence. Per-block time tiers, interpolation,
native delivery and the full objective remain unfinished.

### Checkpoint 138: bounded source-block temporal planning metadata (2026-09-23)

The retained store now preserves one nonempty source-shard block's contiguous
row range, original-source speed cap and actual completed epoch. Independent
block caps are supplied during existing source filtering, even when another
block disables the global bound. Added a read-only-by-ownership typed-array
plan for per-block reuse/recompute decisions and aggregate row counts. Its
resident/planning allocations are explicitly reserved at 64 bytes per source
shard, without adding raw source rows or full position frames.

Whole-frame computation now invalidates all block epoch metadata before any
partial upload and restores it only after every ACK. Interrupted position
prefixes cannot masquerade as a uniformly old reusable snapshot. Planning
during active computation is rejected.

Source/call-site/budget and diff inspection only. No tests, compilation,
calculation, benchmark, app/browser run, CI polling/waiting, commit or push.
Sparse block transfer and per-block commit/UI provenance are not connected
yet; current rendering still recomputes whole epochs. Adaptive temporal tiers
and the broader goal remain incomplete.

### Checkpoint 139: sparse source-block reuse and actual-epoch receipts (2026-09-23)

Connected positive temporal budgets to per-source-block computation. Reused
blocks carry their actual computation date and displacement cap and await a
separate bounded ACK without transmitting positions. Changed blocks invalidate
their epoch before output and commit it only after every upload ACK; superseded
ownership returns cannot mark a block as installed. Zero-budget updates retain
the existing full-frame path.

GPU and CPU restoration cursors now cover contiguous reused and replaced
ranges. The canvas checks aggregate row counts, displacement and actual epoch
range before publication, keeps mixed-date approximations distinct from a
single computed-date label and refines at the same target when its budget is
tightened. Original source order and appearance attributes remain unchanged.

Only source/protocol/state-transition and diff inspection was performed. No
tests, compiler, numerical execution, benchmark, UI/device run, CI polling or
waiting, commit or push. Source-shard cadence, in-place blanking and unverified
performance remain limitations; finer hierarchy, interpolation and the full
scientific/performance objective remain unfinished.

### Checkpoint 140: cached spatial source-block rejection (2026-09-23)

Inspected the compact source index and found no position/phase evidence that
could justify discarding camera-invisible shards before computation. Added a
separate visual AABB cache for already computed Float32 coordinates instead.
It uses 1,024-row blocks, Float64 bounds, explicit array budget, matching-array
identity and dirty/end-row tracking. Orthographic camera queries can reject
outward-padded offscreen blocks while keeping the original representative and
point-selection path for all remaining rows.

Initial uploads and recomputed epoch ranges invalidate affected bounds; reused
coordinates keep their cache. Selection receipts and the UI expose checked and
skipped row counts with total/visibility consistency guards. These counters do
not include cold bound-building work and do not assert measured acceleration.

Source/call-site and diff inspection only. No tests, compilation, numerical
execution, browser/device run, benchmark, CI polling/waiting, commit or push.
Selection equivalence, edge padding and actual performance remain unverified.
Camera-aware source scheduling, finer temporal hierarchy, native integration
and the full scientific/performance goal remain incomplete.

### Checkpoint 141: bounded initial ACK waits and decode-failure cleanup (2026-09-23)

Source inspection found that the initial four-credit transfer window could
wait indefinitely for a lost upload ACK even though temporal ACKs had deadlines.
Added a 30-second per-credit deadline with sticky failure, timer cleanup and
resolved credit wakeups followed by checked failure propagation. Initial load
now rechecks abort after draining ACKs before sealing retained epoch metadata.

Added decoding-failure cleanup on both worker boundaries and retained-idle
error handling in the canvas. Active post-load errors no longer disappear in
initial-load terminal guards; late general errors preserve explicit cancelled
state. Message cancellation still invalidates queued temporal/spatial work.

Only source/lifecycle and diff inspection was performed. No tests, compiler,
runtime calculation, browser/device, benchmark, CI polling/waiting, commit or
push. Deadline behavior, cancellation races and the broader scientific and
performance acceptance remain unverified; the full goal remains incomplete.

### Checkpoint 142: explicit radial solar radiation pressure (2026-09-23)

Added a constant unshadowed radial SRP force and analytic position Jacobian,
with fixed source-declared SI parameters and no physical defaults. The DE440
adapter freezes parameters before awaits, shares its prescribed Sun cache and
records the adopted force, formula, source and exclusions. Manual JSON import,
browser parameter review/adoption and explicit offline adoption are connected;
original input hashes and offline implementation hashes include the new model.
The covariance worker does not silently adopt manual SRP. Historical Eros
gravity comparisons are suppressed for SRP-enabled results.

Corrected the validation policy above to the latest all-testing and submission
hold. Source, units, analytic formula, call sites and diffs only were inspected;
no tests, compiler, numerical execution, benchmark, app/device run, CI polling
or waiting, commit or push. SRP numerical correctness, independent references,
shadow/attitude models, native consumers and complete parameter covariance are
not established. The broader scientific and performance goal remains active.

### Checkpoint 143: immutable experiment inputs across asynchronous integration (2026-09-23)

Source review found that optional refinement reused the caller-owned initial
array after the primary integration had yielded, while final evidence and some
state evaluators were also read from mutable caller objects. Experiments now
capture initial state, force evidence and evaluator functions before yielding;
both integrations and sampled diagnostics use that snapshot. Duration coverage,
refinement adoption and cancellation are checked explicitly. Initial-condition
parsing owns its source record and separates the returned numerical state from
that provenance. Covariance propagation captures the same provider for its
initial and final Sun translations. Existing ensemble conversion already owns
its source and offsets before yielding, so that path was left unchanged.

Only source/call-site and diff inspection performed. No tests, compiler,
scientific execution, benchmark, UI/device run, CI polling/waiting, commit or
push. Mutation/cancellation behavior and all new SRP numerics remain unverified.
The overall scientific/performance goal remains incomplete and active.

### Checkpoint 144: bounded browser dynamics worker lifecycle (2026-09-23)

Connected manual dynamics, covariance and nonlinear ensemble panels to one
owned worker lifecycle. A visible 300-second main-thread deadline covers startup,
source loading and integration; all terminal outcomes clear it, detach handlers
and terminate the worker. Response decode errors and malformed envelopes now
produce terminal UI errors. Existing current-job identity checks prevent stale
publication; source hash keys remount covariance panels when the source changes.
Worker request decoding now reports failure, and failed source reads abort and
release the stream lock without waiting indefinitely for cancellation cleanup.
Offline numerical limits remain unchanged.

Source/lifecycle/call-site and diff inspection only. No tests, builds, compilers,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commits or
pushes. Deadline and callback races remain unverified; this is implementation
progress, not runtime acceptance or completion of the overall goal.

### Checkpoint 145: browser dynamics request-to-receipt binding (2026-09-23)

Added a shared bounded request contract and calculation labels for the browser
job owner and worker. Before source transfer, the main thread hashes an owned
copy; completed receipts must match the original byte count/hash, request kind,
duration, coordinate contract, model identifier, adopted forces, mass plan,
exclusion distance, refinement and ensemble settings. Covariance output epochs
are cross-checked against integration metadata. Cancellation and the deadline
remain effective during asynchronous digest completion, and duplicate completed
messages cannot publish multiple results. This is request binding, not full
receipt validation, source authentication or independent numerical evidence.

Only source/control-flow/call-site and diff inspection performed. No tests,
compilation, numerical execution, browser/device runs, benchmark, CI polling or
waiting, commit or push. Binding behavior, SRP numerics and all broader pending
acceptance remain unverified; the full goal remains active and incomplete.

### Checkpoint 146: cooperative spatial representative ordering (2026-09-23)

Source review found an uncancellable final sort of up to 500,000 selected
indices and 20,000-row slices misaligned with 1,024-row AABB blocks. Replaced
the sort with bounded winner-to-bitmap collection and source-order set-bit
enumeration; both yield and check cancellation. The planner explicitly reserves
ceil(totalCount/32)*4 bytes for membership scratch. Screening slices now align
to sixteen spatial blocks, and normalization/cell parameters are captured before
yielding. Representative hashing and cell competition are retained.

Source/budget/call-site and diff inspection only. No tests, compilation,
scientific execution, benchmarks, browser/device runs, CI polling/waiting,
commit or push. Selection equivalence, cancellation latency and actual speed
remain unverified; camera-aware source scheduling and broader acceptance are
still unfinished. The full goal remains active.

### Checkpoint 147: bind temporal presentation to current camera and context (2026-09-23)

Source review found that the two-frame pause before advancing to a queued epoch
could survive camera changes or context loss. Presentation callbacks now capture
view and epoch identity and check renderer availability, coherence and idle
computation on both frames. Changed views/context loss cancel the callback but
preserve the need to present a replacement view. A completed selection whose
draw discovers a newer camera can no longer overwrite that new pending state or
start temporal follow-up.

Source/state-transition and diff inspection only; no tests, compiler, browser,
scientific execution, benchmarks, CI polling/waiting, commit or push. Race
behavior and realtime rendering performance remain unverified. The broader
scientific and scaling objective remains incomplete and active.

### Checkpoint 148: bounded context-restoration uploads (2026-09-23)

Replaced synchronous replay of every retained catalog shard with animation-frame
batches of at most 4,096 rows per append and a 3 ms between-append budget.
Restoration uses existing CPU attribute subarrays, exposes progress/cancellation,
and suspends drawing, spatial installation and new epoch requests until all rows
are restored. Generation/renderer ownership guards and scheduled-frame cleanup
cover cancellation, repeated context loss, failure and unmount. Incoherent
CPU snapshots remain hidden. Initial empty-context setup remains immediate.

Source/lifecycle/budget and diff inspection only. No tests, builds, compiler,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Shader setup/GPU allocation and single driver calls remain synchronous;
no hard frame deadline or measured performance is claimed. Full scientific
and scaling acceptance remains incomplete and active.

### Checkpoint 149: bounded initial conversion and upload slices (2026-09-23)

Initial streaming now converts appearance/coordinates and appends at most 4,096
rows per slice with a 3 ms between-slice budget, including within the first source
shard. The active shard remains inside the existing four-credit queue until
fully uploaded; ACK follows GPU checks and drawing. Contiguous row validation
accounts for the partial shard offset. Cancellation/failure/teardown discard the
unuploaded suffix and clear that offset; uploaded CPU attributes remain aligned
with the GPU prefix. Temporal restoration cursors already span attribute slices.

Source/ACK/cursor/budget and diff inspection only. No tests, compiler, builds,
numerical execution, UI/device runs, benchmark, CI polling/waiting, commit or
push. Single driver calls may exceed the scheduling budget; actual latency,
throughput and cancellation equivalence remain unverified. The overall goal
remains active and incomplete.

### Checkpoint 150: bounded temporal GPU and CPU replacement slices (2026-09-23)

Temporal position uploads now share the initial/restoration 4,096-row slice and
3 ms between-slice scheduling constants. The original Float64 tile stays owned
until every GPU/CPU replacement slice is complete; only then is its buffer
returned to the worker. Contiguous cursors account for partial tiles, cancellation
clears the slice state and incomplete epochs remain hidden. Scientific compute
tiles and the existing single-tile temporal transfer limit are unchanged.

Source/ownership/cursor and diff inspection only. No tests, compiler, builds,
scientific execution, app/device runs, benchmarks, CI polling/waiting, commit
or push. Runtime correctness, cancellation latency and frame behavior remain
unverified; the full objective remains active and incomplete.

### Checkpoint 151: explicit TT interval arithmetic for temporal reuse (2026-09-23)

Added elapsed TT evaluation from UTC differences plus frozen leap-table offsets,
without first adding offsets to absolute Julian dates. Temporal displacement
takes the larger of this interval and the rounded TT interval actually used by
propagation, with an outward arithmetic allowance. Unsupported equal dates and
underflowed/overflowed positive displacement no longer authorize reuse. The UI
now exposes the frozen future-leap and numeric UTC label limitations.

Source/formula/domain and diff inspection only. No tests, compiler, calculations,
benchmarks, browser/device runs, CI polling/waiting, commit or push. Boundary
correctness and all new performance behavior remain unverified; the overall
scientific/scaling objective remains active and incomplete.

### Checkpoint 152: export actual per-block temporal evidence (2026-09-23)

Completed epoch receipts now transfer a compact Float64 table of contiguous
uploaded row ranges, actual computation dates and displacement to the evaluated
target. The canvas cross-checks it against upload totals, date extrema and drift
before publication. Added JSON export with original manifest/filter/priority
context, capacity/budget, actual block epochs and separate current view/target
settings. Source-block metadata reservation increases from 64 to 128 bytes;
no full position array is added. Export explicitly excludes object identity,
physical error and assurance that the current target/view has completed.

Source/receipt/budget and diff inspection only. No tests, compilation, numerical
execution, UI/device runs, benchmarks, CI polling/waiting, commit or push.
Serialization, protocol handling and scientific accuracy remain unverified;
the overall scientific/performance goal remains active and incomplete.

### Checkpoint 153: source shard and selected-row mapping in temporal exports (2026-09-23)

Retained streaming now records the checked compact-index/shard hashes and a
compact LSB-first source-row mask per nonempty uploaded shard, preserving actual
priority order and capacity truncation. The canvas validates unique shards, mask
size/padding and row counts, then ties each temporal block to the corresponding
selected count. Export includes these locators without hydrating object names.
The retention budget explicitly reserves masks on both sides of handoff and
additional bounded checksum metadata. Hash consistency is not source identity
authentication, and this is not an exported scientific position catalog.

Source/mapping/contract/budget and diff inspection only. No tests, compiler,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Selection identity, serialization and performance remain unverified; the
full scientific/scaling objective remains active and incomplete.

### Checkpoint 154: stable stream and epoch inputs across awaits (2026-09-23)

Source review found that streaming retained caller-owned manifest/filter objects
and repeatedly read mutable options after fetch/upload waits, while retained
epoch computation also read mutable date/budget/callback fields after yielding.
Streaming now owns manifest/filter copies and captures option values/callbacks;
epoch computation captures its option record before admission. Search locators
are already consumed into a private bitset before the first await, so no extra
large locator copy was introduced. Captured cancellation channels remain live.

Source/await/ownership and diff inspection only. No tests, compiler, builds,
scientific execution, browser/device runs, benchmarks, CI polling/waiting,
commit or push. Mutation behavior and all pending scientific/performance
acceptance remain unverified; the full goal remains active and incomplete.

### Checkpoint 155: cooperative initial source validation and orbit compute (2026-09-23)

Extended the existing binary validator with bounded row ranges and connected
initial streaming to cooperative validation (4,096 rows), filtering (2,048 rows)
and preparation/speed/propagation (256 rows). The worker reuses its MessageChannel
yield mechanism; cancellation is checked around each yield. Complete shards,
not partial preparation or position buffers, enter retention/upload callbacks.
Existing Float64 kernels, source ordering and per-shard allocation remain in use.

Source/range/ownership and diff inspection only. No tests, compiler, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit
or push. Numerical equivalence, scheduling overhead and cancellation latency
remain unverified; the full goal remains active and incomplete.

### Checkpoint 156: overlap bounded prefetch with cooperative compute (2026-09-23)

Moved prefetch replenishment to the handoff from completed download to the single
compute slot, keeping up to four subsequent shards admitted during cooperative
validation/propagation. Near the capacity ceiling, replenishment remains deferred
until exact filtering proves more input is needed. Added duplicate/queue-capacity
guards and explicit pipeline allocation accounting while retaining the existing
larger scratch reservation. Upload backpressure and cancellation cleanup remain
separate and unchanged; no additional orbit-compute worker is introduced.

Source/queue/budget and diff inspection only. No tests, compilation, builds,
scientific execution, browser/device runs, benchmarks, CI polling/waiting,
commit or push. Throughput, memory and cancellation behavior remain unverified;
the full scientific/scaling goal remains active and incomplete.

### Checkpoint 157: source-locator and focused-row selection foundation (2026-09-23)

Binary source-shard decoding now supplies actual chunk/row locators and rejects
metadata that contradicts its loaded shard position. Precomputed mixed-source
samples retain their original locators and are never relabeled by sample offset.
Spatial selection accepts one explicit uploaded focused row, validates its range
and retains it as its visible cell representative without increasing draw budget
or changing offscreen rejection. Other cell hashing remains unchanged.

This is foundation only: browser focus-to-upload mapping, source admission of
not-yet-loaded focus and broader multi-selection retention are not connected or
complete. Source/call-site and diff inspection only; no tests, compiler, builds,
scientific execution, UI/device runs, benchmark, CI polling/waiting, commit or
push. The full scientific/scaling goal remains active and incomplete.

### Checkpoint 158: connect current-source focus to streamed representatives (2026-09-23)

Connected current catalog record focus, explicit source locators and checked
row masks to uploaded spatial selection. A focused visible row wins its cell
without increasing draw count; changing focus requests fresh spatial selection
without source reload. Static streams now also preserve/budget source masks so
focus mapping does not require temporal coefficient retention. The UI reports
unavailable mappings explicitly, and exports include focus source/row context.

Only source/mapping/call-site/budget and diff inspection performed. No tests,
compiler, builds, scientific execution, UI/device runs, benchmarks, CI polling
or waiting, commit or push. No name guessing, offscreen relocation or filter
bypass was introduced. Multi-selection retention and priority loading of absent
focus remain unfinished; runtime correctness and the overall goal are unverified
and incomplete. The goal remains active.

### Checkpoint 159: bounded multi-selection retention and grouped row mapping (2026-09-23)

Added grouped source-mask lookup and connected up to 256 current-record source
selections to spatial rendering. Visible focus receives first budget priority,
then visible mapped selections in selection order; ordinary hashed cell
representatives use remaining slots. Multiple selected bodies in one projected
cell can coexist. Source-order output, offscreen policy and total draw ceiling
remain intact. UI/export metadata explains located/loaded counts and limits.

Source/mapping/budget/call-site and diff inspection only. No tests, compiler,
builds, scientific execution, UI/device runs, benchmarks, CI polling/waiting,
commit or push. Runtime behavior remains unverified. Full-source selection
scopes, absent-body priority loading and selections lacking current locators
remain unfinished; the overall goal stays active and incomplete.

### Checkpoint 160: explicit current-selection shard loading priority (2026-09-23)

Added an opt-in load/refresh control that snapshots up to 256 current-source
locators, focus first. The immutable worker request validates and promotes only
already-admitted shards while preserving the configured order for the rest.
Filters, within-shard row order, capacity and pipeline limits remain in force;
focus changes do not restart the stream. Export records the adopted priority
list and UI copy distinguishes shard priority from guaranteed body admission.

Source/request/order and diff inspection only. No tests, compilation, builds,
scientific execution, UI/device runs, benchmark, CI polling/waiting, commit or
push. Missing/filtered/truncated objects and automatic incremental admission
remain limitations, with full source-scope retention unfinished. Runtime
behavior and the full scientific/scaling objective remain unverified/incomplete;
the goal remains active.

### Checkpoint 161: reserve matching priority rows within the current shard (2026-09-23)

Source inspection identified that promoting a focused source shard did not protect
a matching focus near the end of that shard from ordinary rows exhausting the
remaining capacity. Current-shard admission now reserves slots for matching
priority locators in fixed list order, deduplicates source rows, and keeps the
existing exact filters/candidate mask and total capacity. Selected output remains
in ascending source order, preserving bitmap lookup and temporal block mapping.
Skipped ordinary matches explicitly leave coverage incomplete. UI/docs retain
the limitation that earlier shards can exhaust capacity before later selections.

Only source, invariant and diff inspection performed. No tests, compilation,
builds, scientific execution, browser/device runs, benchmarks, CI polling or
waiting, commit or push. Runtime and numerical validation remain deferred; the
full goal is active and incomplete.

### Checkpoint 163: explicit snapshot-renderer recovery (2026-09-23)

Ordinary snapshot upload failures previously disposed the renderer with no
recovery entry point unless the browser later emitted context-restored. Added a
localized manual retry that recreates resources from the latest frame, using the
same path as context restoration. Success is reported after the draw call returns;
failed initialization disposes partially owned resources. An unavailable canvas
is hidden visually and from accessibility while preserving recovery dimensions.
Retry callbacks and queued reports are bounded by component lifetime. No source
reload, automatic retry loop or new per-frame resource check was introduced.

Source/lifecycle/caller and diff inspection only. No tests, compiler, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Actual GPU failure/recovery and accessibility behavior remain unverified;
the complete scientific/scaling objective remains active and incomplete.

### Checkpoint 164: contain synchronous streaming-worker startup failures (2026-09-23)

Reviewed refresh/cancel ownership: refresh remounts the streaming canvas; teardown
invalidates its active flag, terminates its worker and releases rendering/listener
resources. Found that a synchronous Worker constructor or start-message cloning
exception could escape before React received that teardown callback. Startup now
runs inside a guarded helper and routes failures through the existing terminal
handler while still registering cleanup. Cancellation also finishes local state
when posting its abort message throws, terminating the unusable worker channel.
Normal cancellation continues to retain the already-uploaded visual snapshot.

Source/control-flow and diff inspection only. No tests, compiler, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Actual startup failures, refresh isolation and cancellation remain
unverified; the full objective remains active and incomplete.

### Checkpoint 165: shared bounded occultation worker lifetime (2026-09-23)

Audited dynamics and occultation startup/cancellation ownership. Dynamics already
uses an owned job with a main-thread deadline; the contact and ordinary SPK limb
panels lacked main-thread expiry and response-decode handling. Added a shared
occultation job helper and connected contact, SPK limb and station stellar-limb
panels. It terminates and detaches on completion/error/cancel, includes a 30-second
main-thread timer, cleans up synchronous post failures and checks the requested
response discriminator/schema envelope. Each panel retains current-job identity
guards and exposes the resource limit. Browser timer throttling can delay expiry;
full receipt/source/numerical verification is outside the envelope check.

Source/ownership/protocol and diff inspection only. No tests, compilation, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Runtime behavior and the complete scientific/scaling goal remain unverified
and incomplete; the goal remains active.

### Checkpoint 166: bind occultation reports to submitted originals (2026-09-23)

Extended the shared occultation job with pre-transfer owned input snapshots and
main-thread SHA-256 calculation. Report publication now requires matching input
bytes, hash and parsed payload. Station stellar-limb reports additionally match
the exact observer JSON/hash/size and submitted source ID, UTC and station.
Receipt checking runs before the terminal success callback; cancellation and
the deadline remain live through digest completion, and duplicate completions
are ignored. This is provenance consistency, not full geometry validation or
independent source authentication. Original input/observer size caps still apply.

Only source/ownership/receipt and diff inspection performed. No tests, compiler,
builds, scientific execution, UI/device runs, benchmarks, CI polling/waiting,
commit or push. Hash/error/cancel behavior is unexecuted; the full scientific
and scaling goal remains active and incomplete.

### Checkpoint 167: close contact-source snapshot gap across awaits (2026-09-23)

Contact search previously waited for PCK loading before handing caller-owned
SPK bytes to the copying DE440 loader. Both loaders now start before the first
await and own their existing source snapshots synchronously; Promise.all also
observes both failure paths. Added an immediate post-load cancellation check.
SPK and station stellar-limb routines capture their original AbortSignal rather
than rereading a replaceable options.signal after asynchronous work. Reviewed
nonlinear ensembles and contact search option capture; no additional edit was
needed there. No force, geometric or numerical model was changed.

Source/await/ownership and diff inspection only. No tests, compiler, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Mutation/cancellation behavior is unexecuted; the overall scientific and
scaling objective remains active and incomplete.

### Checkpoint 168: expose retained-node orbit diagnostic ranges (2026-09-23)

The dynamics engine already returned instantaneous osculating diagnostics for
retained trajectory nodes, but the browser only displayed initial/final values.
Connected the existing bounded sample array to the diagnostics panel and added
per-quantity sampled minima/maxima, elapsed TDB times and valid/total node counts.
Undefined and unrepresentable display values are not silently reported as zero;
ties retain first-in-integration-order identity. Existing endpoints remain shown.
No new orbit integration or interpolation was added. The UI explicitly separates
nonuniform decimated-node summaries from continuous extrema, error bounds and
resonance/stability conclusions; those broader goal requirements remain pending.

Source/data-flow and diff inspection only. No tests, compilation, builds,
scientific execution, browser/device runs, benchmarks, CI polling/waiting, commit
or push. Runtime/visual correctness and the full objective remain unverified
and incomplete; the goal remains active.

### Checkpoint 169: inspect complete covariance and ensemble results in the UI (2026-09-23)

Verified in source that failed ensemble draws retain their indices and prevent
mean/covariance summaries. Added shared expandable tables for existing six-state
values and full covariance matrices in the two propagation panels. Units and
row/column product semantics are explicit; ensemble mean and conditional nominal
state remain separately labeled. Ensemble count/divisor and per-row success or
failure are visible, and endpoint tables now expose velocities as well as
positions. Existing JSON exports retain detailed offsets, forces and provenance.

Source/report/UI and diff inspection only. No tests, compilation, builds,
scientific execution, browser/device runs, benchmarks, CI polling/waiting, commit
or push. Runtime display and the overall scientific/scaling objective remain
unverified and incomplete; the goal remains active.

### Checkpoint 170: bind dynamics payload, epoch and adopted SRP parameters (2026-09-23)

Reviewed UI source replacement: covariance/ensemble children are keyed by source
hash and removed during import; station limb children use the parent report
generation. No extra reset mechanism was needed. Strengthened the shared dynamics
receipt boundary: capture parsed input before transfer, compare the returned
payload, bind reference time to the original manual/SBDB covariance epoch and
compare every explicitly adopted SRP parameter/source field. Previously the
epoch was only internally consistent and SRP checked only its model identifier.

Source/lifecycle/binding and diff inspection only. No tests, compilation, builds,
scientific execution, UI/device runs, benchmarks, CI polling/waiting, commit or
push. Runtime binding behavior and the complete scientific/scaling objective
remain unverified and incomplete; the goal remains active.

### Checkpoint 171: explicit frozen source windows and shared DE440 pin (2026-09-23)

Dynamics receipt checking now binds the full frozen window to the requested
forward/backward/zero duration, matches kernel metadata against the unchanged
DE440 pin and checks absolute coverage. Moved pin constants into a lightweight
shared module while preserving provider re-exports; six CLI implementation-hash
manifests now include that module. Contact, SPK limb and station stellar-limb
receipts expose their actual frozen elapsed source windows, including any center
light-time margin. No source coverage or numerical model was expanded.

Only source/interval/import/hash-manifest and diff inspection performed. No tests,
compiler, builds, scientific execution, UI/device runs, benchmarks, CI polling
or waiting, commit or push. Receipt behavior and the entire scientific/scaling
objective remain unverified and incomplete; the goal remains active.


### Checkpoint 172: expose request times separately from source windows (2026-09-23)

Connected contact and both limb panels to a shared expandable source-window
view using the actual receipt fields. It distinguishes search bounds from single
reception/emission instants, retains relative TDB seconds and shows the reference
epoch separately. Nonfinite/reversed/out-of-window values are not displayed as
a valid window. Copy explicitly distinguishes admitted source evaluation from
whole-kernel coverage and event completeness. No source or time conversion
model changed.

Source/call-site/display-contract and diff inspection only. No tests, compiler,
builds, scientific execution, UI/device runs, benchmarks, CI polling/waiting,
commit or push. Visual/runtime behavior and the full scientific/scaling goal
remain unverified and incomplete; the goal remains active.

### Checkpoint 173: source-bound single-target coverage inspection (2026-09-23)

Connected the existing backend coverage/targets endpoint to the coverage panel.
One explicit catalog/NAIF identity is checked against the currently loaded
report hash, catalog/inventory hashes, audit epoch and requested window. The
view distinguishes not-audited identities from available/missing audit states
and displays backend-reported gap counts plus dependency JSON/export. Browser
identity checks do not independently recompute chains or certify accuracy.

Added cancellation/stale-request guards, a 30-second deadline and a 512 KiB
actual stream-read ceiling. The shared JSON reader accepts a bounded optional
ceiling; coverage summaries now apply their 64 KiB cap during body consumption
as well as header admission. Preview requests remain prohibited. No source
coverage counts were invented and no new backend/data coverage is claimed.

Source/API-contract/read-budget/UI and diff inspection only. No tests, compiler,
builds, scientific execution, network/API execution, UI/device runs, benchmarks,
CI polling/waiting, commit or push. Target inspection runtime and full scientific
coverage remain unverified; the overall goal is active and incomplete.

### Checkpoint 174: reconcile and inspect individual dependency gaps (2026-09-23)

Added bounded client validation of the backend dependency partition: boundary
points include requested endpoints, adjacent open intervals form the window,
and gap records correspond exactly to declared gap atoms. Chain fields retain
target/origin/center/kernel/frame/type/coverage context with the backend limits
of 256 atoms and 64 chain steps. This checks report consistency, not independent
kernel availability. The target inspector now displays point versus open-interval
gaps, reason codes and expandable dependency steps in pages of 20, preserving
full JSON inspection/export. No source datasets or coverage counts were invented.

Only backend-contract/client-source/UI and diff inspection performed. No tests,
compiler, builds, scientific execution, network/API runs, UI/device checks,
benchmarks, CI polling/waiting, commit or push. Actual report compatibility and
rendering remain unverified; the full scientific/scaling goal remains active
and incomplete.

### Checkpoint 175: original Type 1 spacecraft kernel plumbing (2026-09-23)

Reviewed official Voyager source notes and read only HTTP byte-range headers and
summary descriptors for the two x2100 kernels. Both spacecraft trajectories use
Type 1, which the existing readers rejected. Added fixed-dimension Type 1 layout
admission to the browser and Go readers, reusing the dimension-aware MDA evaluator.
The cropper preserves original Type 1 records and its one-word count tail. Source
survey, coverage partition and backend evidence gates now recognize the type.
Go MDA metadata inspection also checks ordered finite final epochs and directory
consistency, with cancellation, before binary record selection.

Source notes and observed descriptor metadata are recorded in
`docs/spacecraft-ephemerides.md`, including the 1992 tracking-fit cutoff and the
unverified nature of the 2100 extension. No full source archive, production
manifest, negative-identity integration or scientific scene path is claimed.
Existing schematic spacecraft coordinates remain labeled and unchanged.

Only official documentation, source header metadata, code and diff inspection
performed. No tests, compilation, scientific evaluation, builds, benchmarks,
browser/device acceptance, CI polling/waiting, commit or push. Numerical parity,
source admission and the complete scientific/scaling goal remain incomplete.

### Checkpoint 176: explicit spacecraft identity plumbing (2026-09-23)

Confirmed Voyager 1/-31, Voyager 2/-32 and New Horizons/-98 against the official
NAIF identity table. Added a shared browser/tooling identity registry, inventory
source rows with cited mapping evidence, and mapping/generator hash coverage.
Inventory reconciliation admits only the reviewed spacecraft identities with
matching source fields; arbitrary negative IDs are not promoted. The API already
accepted canonical negative IDs; its built-in rows now name these spacecraft and
their scene aliases as exact-only/missing until compatible kernels are admitted.
The browser mapping helper excludes schematic sources before identity lookup.

Only official source and source-code/diff checks performed. No generated inventory,
state calculation, test, compilation, build, UI/device run, benchmark, CI wait,
commit or push. Runtime consistency and scientific scene/data admission remain
pending; the complete goal remains active and incomplete.

### Checkpoint 177: separate scientific spacecraft scene selections (2026-09-23)

Added canonical spacecraft scene entries with explicit SPK labels and no orbit
or fallback coordinates. Connected them to the existing registry and demand
loader, which feed the existing backend state/trail render paths. Canonical IDs
are distinct from named schematic overlay IDs; source-inventory records take
precedence when the same canonical identity is pinned, with deduplicated list
and loader rows. Inspector model text now selects schematic semantics by source,
not by spacecraft kind, and scientific entries link their identity provenance.
The preview availability gate and existing missing-state/trajectory reporting
remain in force. No production spacecraft kernels have been admitted.

Source/call-chain and diff inspection only; no tests, compilation, builds,
scientific evaluation, UI/device runs, benchmark, CI polling/waiting, commit or
push. State rendering and cross-path consistency are unverified; real source
admission and the complete scientific/scaling goal remain incomplete.

### Checkpoint 178: bounded spacecraft pack preparation command (2026-09-23)

Added an explicit, unexecuted Voyager preparation command. It archives original
SPKs and source notes under an exclusively created cache directory, caps source
reads and retains whole-response hashes. Both crops use the same owned bytes.
Spacecraft roots and embedded planetary dependencies are separate, with explicit
same-source pools and identities incorporating the requested window. Descriptor
and center-chain gaps prevent a completed preparation marker; original records
are preserved and no state vector is evaluated by this workflow. Output status
requires source review and later numerical acceptance; no release integration
or operational coverage is inferred from a prepared manifest.

Only source and diff checks performed. The preparation command was not executed;
no tests, compilation, builds, scientific evaluation, benchmark, UI/device run,
CI polling/waiting, commit or push. Real source acquisition, acceptance and the
full scientific/scaling objective remain pending and the goal remains active.

### Checkpoint 179: align backend explicit SPK source pools (2026-09-23)

Found a concrete source-selection mismatch: Go filtered global manifest order by
an allowed-ID set, while the browser uses declared dependency order followed by
the root. Replaced the Go set with an ordered pool, preserved explicit-empty
versus undeclared pools, required all declared files, and rejected repeated/self
dependencies. Legacy center resolution excludes explicitly bound roots. Explicit
pool load errors no longer silently choose another file. Cache context identity
uses an unambiguous JSON encoding of the ordered IDs.

Dependency-only files remain available to center resolution but no longer create
or promote public root metadata or overwrite its source hash/validity interval.
These fixes apply to existing explicit satellite pools as well as spacecraft.

Only source/call-site and diff checks performed; no test, compiler, build,
scientific execution, benchmark, UI/device run, CI poll/wait, commit or push.
Cross-language numerical and failure-path behavior remain unverified. The full
scientific/scaling objective is active and incomplete.

### Checkpoint 180: disconnect sampled source changes in historical trails (2026-09-23)

Confirmed the global numerical cache belongs to an immutable Catalog and retains
successful state/evidence pairs. Found that historical trails already preserved
per-sample metadata but rendered unconditional connecting edges across source
changes. Added bounded transition evidence and optional per-vertex break flags:
root source/hash, dataset, model, center or evidence-kind changes disconnect the
adjacent display edge; reference changes affect every relative trail. Samples
on both sides remain retained. This detects sampled metadata transitions, not
hidden sub-sample source changes or continuous numerical disagreement.

Packed worker transfer, 2D geometry, indexed 3D line segments and JSON/CSV exports
carry the same break semantics. 3D reuses its index buffer; only schematic trails
are excluded from trajectory fitting. CSV now has matching named AU columns,
includes z and break flags, and quotes names/IDs. The audit UI reports transitions.

Source/data-flow/diff checks only; no tests, compiler, builds, scientific runs,
rendering/device checks, benchmarks, CI polling/waiting, commit or push. Runtime
behavior and the complete scientific/scaling objective remain unverified and
incomplete; the goal remains active.

### Checkpoint 181: carry actual selected center-chain identity (2026-09-23)

Added an operational source-chain SHA-256, recursively constructed from the
selected root/center kernel identities, frame and segment bounds, with a fixed
SSB seed. Epoch-local and shared successful-state caches retain it with the
same evaluated state. State tiles, bounded metadata accounting and browser
interned columns preserve the optional digest. Trajectory transition detection
now includes it, exposing center-dependency changes with an unchanged root.
Older receipts may omit it; no inferred chain certificate is created for them.
Documented hashing semantics and the distinction from authentication, numerical
accuracy and continuous coverage. No new data coverage is claimed.

Source/data-flow and diff checks only. No tests, compilation, builds, scientific
execution, UI/device acceptance, benchmarks, CI polling/waiting, commit or push.
Runtime chain identity and the complete objective remain unverified/incomplete;
the scientific/scaling goal remains active.

### Checkpoint 182: preserve center-chain digests in native state views (2026-09-23)

Android and iOS metadata decoders now retain optional sourceChainSha256 values.
An omitted or empty digest remains compatible with older tiles; explicit null,
non-string values and nonempty values other than lowercase 64-character hex are
rejected. iOS uses a keyed decoder once per row, preserving the existing required
fields without a second JSON parse. Native frame memory estimates include the
retained digest. Existing evidence views display the digest or "not provided";
neither label establishes independent chain recomputation or numerical accuracy.
No native frame export was added or claimed.

Source/call-site and whitespace checks only. No tests, compilation, builds,
scientific execution, device/browser acceptance, benchmarks, CI polling/waiting,
commit or push. Native decoding/display behavior and the full scientific/scaling
objective remain unverified and incomplete; the goal remains active.

### Checkpoint 183: New Horizons OD164 preparation and center-only crops (2026-09-23)

Read official archive listings, current meta-kernel, label and binary
header/summary/comment ranges. Found the archive overview lags OD164, and the
label's total time range includes planets. Recorded the two spacecraft segments,
OD164 tracking cutoff and the older OD157A shared-endpoint precedence. Range
reads had no ETag and are not immutable full-file acceptance evidence.

Preparation source now supports explicit newhorizons/all selections while both
continues to mean Voyagers. OD164 requests exclude the older segment and its
shared endpoint. Receipts archive per-source notes/labels and record the reviewed
cutoff. Dependency crops follow reachable centers in the requested window,
omitting unrelated planetary and small-body records from runtime packs while
retaining originals. No production files or source indices were generated.

Source/document and diff checks only; no tests, compilation, build, scientific
execution, benchmark, UI/device acceptance, CI poll/wait, commit or push.
Preparation itself remains unexecuted. Full goal remains active and incomplete.

### Checkpoint 184: offline spacecraft manifest integration entry point (2026-09-23)

Added an unexecuted integrator for explicit Pages/full profiles and pinned
prepared/baseline manifest hashes. It binds original kernels, notes, labels and
crops; checks descriptor windows, spacecraft identities and same-source center
pools; refuses collisions; and caps retained crop bytes. Existing manifest rows
and ordering are retained. Kernel writes precede the final manifest replacement,
with an integrator lock and baseline rechecks. External writers must be stopped
during replacement. Failed attempts may retain unreferenced immutable kernels.

The entry point preserves source receipts and appends the Type 1 contract, but
does not claim numerical acceptance or generate derived inventories. Preparation,
integration, tests, builds, scientific evaluations, CI polling/waiting and commit
or push remain unexecuted. Source and diff checks only; the full goal is active
and incomplete.

### Checkpoint 185: profile-bound inventory regeneration and bounded kernel reads (2026-09-23)

Found that buildInventory always selected Pages even after Full-only source
integration. Added explicit pages/full selection through the API and CLI, with
Pages preserved as the default. Inventory kernel loading now rejects mismatched
manifest profiles, duplicate identities/paths and invalid integrity metadata.
Generator receipts include the resolver, SPK readers and profile/identity modules.

The existing four-reader pipeline now checks opened file sizes before allocating
exactly the admitted byte count and hashing contents. Each kernel is capped at
128 MiB; current Pages/full manifest metadata fits that limit. No actual kernel
reads or evaluations were performed to establish this source change. Documented
the later Full inventory regeneration command and retained independent remapping
for coverage reports. No tests, compilation, builds, generators, numerical runs,
CI polling/waiting, commits or pushes. Source/diff checks only; goal remains
active and incomplete.

### Checkpoint 186: bind inspector evidence and distances to backend frames (2026-09-23)

Found Full inspector model/source labels used the local preview kernel store,
while rendered positions came from backend state tiles. The inspector now receives
the selected comparison/reference backend frame and obtains distances, epoch,
precision, missing reasons and source hashes from that same snapshot. Missing
rows remain distinct from unavailable states. Source-chain digest is retained
in the shared audit type. Local preview source links and local numerical
diagnostics are no longer mixed into backend-derived inspector claims.

Backend orbital-elements, phase and apparent-state diagnostics remain an explicit
integration gap; the independent ground-observation tool remains available.
Scientific spacecraft can be selected as reference bodies; schematic sources
remain excluded. Spacecraft without a declared parent no longer imply a fixed
heliocentric parent in the context readout. Preview behavior stays separate.

Source/data-flow and diff checks only. No tests, compilation, builds, browser
checks, scientific execution, CI polling/waiting, commit or push. Runtime/UI
acceptance and the complete objective remain outstanding; goal stays active.

### Checkpoint 187: backend snapshot relative-motion and open-conic diagnostics (2026-09-23)

Exposed the retained Float64 state accessor on backend evidence and added a
single-pair inspector diagnostic using the same target/reference snapshot.
Reports geometric distance, relative speed, signed range rate and instantaneous
conic quantities, including hyperbolic cases. The adopted DE440 GM source/hash
is explicit; missing target GM is a declared approximation and missing reference
GM suppresses conics. JSON exports retain both absolute states, relative state,
epoch, source receipts and source-chain hashes. Independent SPK rows are not
claimed to share a dynamical fit. No extra backend request or kernel load.

Consulted NAIF OSCELT documentation for input/frame and degeneracy boundaries.
Light-time requires separate emission states and remains outstanding; no local
preview replacement is used. Source/diff checks only, with no tests, numerical
execution, compiler/build, browser/device run, CI poll/wait, commit or push.
The full goal remains active and incomplete.

### Checkpoint 188: light-time convergence at representable emission epochs (2026-09-23)

Found one-part-JD apparent iteration checked rounded timestamp differences with
a nanosecond default. Replaced this with delay-step and actual-emission-equation
residuals; default numerical tolerance is 50 microseconds for that path. Strict
explicit tolerances remain strict. Final delay now corresponds to the returned
vector and emission evaluation. Propagated residual/tolerance to observation
receipts and preview readout. Go ground observer and relative-second reception
helper also check actual-epoch residual and retain the final range-derived delay.

Consulted NAIF reception-correction requirements. No numerical evaluation, tests,
compiler/build, UI/device acceptance, CI poll/wait, commit or push. Source/diff
checks only. General backend observer-to-target apparent-state integration and
reference acceptance remain incomplete; full goal stays active.

### Checkpoint 189: retain split ET through DE440 event state reads (2026-09-23)

Found relative event offsets were recombined into one large ET before DE440
evaluation. Added explicit Type 2/3 split-time evaluation with selected-segment
precedence and record-boundary handling, plus a compensated DE440 epoch pair
and a two-part cache key. Contact and both limb pipelines now iterate around
each reception epoch at zero and pass emission offsets separately. Receipts
retain the local origin/offset. Non-Chebyshev split evaluation is unsupported
rather than silently rounded or replaced. Initial reference-JD precision and
rounded orientation ET remain documented limits, not an end-to-end precision
claim. Source/diff checks only; no tests, calculations, builds, CI poll/wait,
commit or push. Numerical acceptance and the complete goal remain outstanding.

### Checkpoint 190: shared split emission time for text-PCK orientation (2026-09-24)

Text-PCK evaluation now accepts a time offset and retains its translated
polynomial contribution through angle reduction, including periodic phases.
The DE440 source exposes its bounded epoch pair; SPK and stellar limb pipelines
use that same pair for orientation. Receipts include both ET parts and a rounded
compatibility scalar. Nonfinite translated polynomials fail explicitly.

This improves time representation without claiming binary-PCK/ITRF equivalence
or end-to-end angular accuracy. Input-JD precision, Float64 arithmetic and
source-model errors remain. Source/diff checks only; no tests, numerical runs,
compilation/build, UI/device acceptance, CI poll/wait, commit or push. Numerical
acceptance and the full objective remain outstanding; goal stays active.

### Checkpoint 191: bind occultation worker source and split-time receipts (2026-09-24)

Extended the main-thread input binding to retain the requested calculation kind
and reject mismatched pinned DE440/GM and PCK identities, frame/time conventions,
target shape IDs and request windows. Station epochs are derived from the captured
original observer response; source/UTC/station bindings remain in place. Contact
receipts retain the requested search settings and explicit incomplete coverage.
Limb emission offsets must stay inside the submitted margin, and orientation ET
parts must match the same compensated epoch bookkeeping used by DE440.

These checks bind metadata and epoch representation, not geometry correctness,
source authenticity, contact completeness or physical accuracy. No tests,
numerical execution, compilation/build, browser/device acceptance, CI polling or
waiting, commit or push. Source inspection and diff whitespace checks only.
Full scientific/rendering expansion and eventual acceptance remain incomplete;
the goal stays active.

### Checkpoint 192: station coordinate-ray binding and horizon context (2026-09-24)

Inspected the station-to-Pmpx-to-limb chain against the GoFA astrometry source.
The model uses the station BCRS coordinate direction before apparent-place
corrections; no extra parallax correction is applied by the limb pipeline.
Added explicit coordinate-ray provenance with station barycentric position and
split reception epoch. Main-thread receipt checks now bind the normalized
intersection direction to that original coordinate vector, alongside frame and
parallax conventions.

Retained original airless sky coordinates and solar elongation separately as
station context. The panel now displays the airless altitude/azimuth and calls
out negative altitude without claiming visibility or changing the intersection.
Exports preserve both coordinate geometry and sky context. No tests, numerical
runs, compilation, builds, UI/device acceptance, CI polling/waiting, commits or
pushes. Source/diff checks only; the complete goal remains active and incomplete.

### Checkpoint 193: bounded detail hydration and cache-hit cancellation (2026-09-24)

Found that catalog artifact admission limited active reads while ID lookup and
search-page Promise.all still queued every shard and retained complete decoded
results until the aggregate finished. Replaced those aggregates with four owned
consumers extracting only requested records. Lookup buckets and locator detail
hydration now share that queue; requested result order is retained separately.
The first failure cancels siblings, cancellation stops subsequent admission,
and a task yield between items prevents cache-only microtask chains from
starving input/cancellation events. Large filtered lookup spreads were removed.

This is source-level resource ownership work, not measured performance or a
global process memory bound. Existing LRUs and network admission remain. No
tests, numerical runs, compiler/build, benchmarks, browser/device checks, CI
polling/waiting, commits or pushes. Diff whitespace checks only; runtime and
capacity acceptance and the complete scientific goal remain outstanding.

### Checkpoint 194: release failed GPU generations and explicit reload (2026-09-24)

Found stream failure terminated the worker but could retain a renderer with
partly uploaded attributes and its restoration copies. Failure now disposes the
renderer, clears retained attributes/scratch and epoch/source-selection receipts,
and exposes an unavailable display. Failed generations cannot auto-restore; an
explicit reload starts a fresh owned generation under the existing budget.
Normal cancellation preserves its established snapshot behavior. Renderer
disposal also releases its selection-array reference and marks state incoherent.

Source/diff checks only. No tests, compiler/build, runtime/context-loss or GPU
failure exercises, benchmarks, CI polling/waiting, commits or pushes. Full
scientific and performance acceptance remains outstanding; goal stays active.

### Checkpoint 195: initial tile ownership return and single-buffer reuse (2026-09-24)

Initial catalog loading discarded transferred Float64 positions after upload,
while the temporal path already returned ownership. Added source-tile ACK buffer
return after successful complete upload. The worker binds the returned buffer
to its pending tile identity/size and keeps only one reusable allocation; the
producer validates whole-buffer shape and overwrites all coordinates. Unknown
ACKs do not populate the pool, and matching malformed returns fail the stream.
Bare ACKs retain compatibility without reuse. Capacity accounting includes the
additional single-buffer reserve; terminal paths clear retained return state.

Source/diff checks only. No tests, calculations, compilation/build, benchmarks,
browser/device execution, CI polling/waiting, commit or push. Allocation savings
and runtime correctness are unmeasured; full goal remains active and incomplete.

### Checkpoint 196: consistent Float32 viewport-edge screening (2026-09-24)

Found CPU spatial rejection used double-precision edge padding despite Float32
shader display operations. Added a shared outward display margin based on
projected term magnitudes for pinned/ordinary points and block rejection.
Admitted near-edge points are assigned bounded edge cells without changing
their GPU positions. Scalar scratch avoids per-point result objects. The
visible count includes this numerical screening allowance; it is explicitly
not a scientific uncertainty or certified GPU precision bound.

Source and diff whitespace checks only; no tests, calculations, compiler/build,
boundary/GPU/device execution, benchmarks, CI polling/waiting, commits or pushes.
Device acceptance and the complete objective remain outstanding; goal is active.

### Checkpoint 197: distinguish viewport candidates and submitted points (2026-09-24)

Updated selection output and worker protocol with an explicit edge-candidate
count. Main-thread counter checks now reject nonintegers and inconsistent
subsets. Reworded bilingual display labels to distinguish viewport candidates
(including the margin) from submitted points, and clarified focus/selection
priority. Exported counts include selection-pending state and the display
screening policy; pending selections do not claim current completed counters.

No tests, numerical runs, compiler/build, UI/export or device execution, CI
polling/waiting, commits or pushes. Source/diff checks only. Complete scientific
coverage, scale measurements and runtime acceptance remain outstanding; the
goal is active and incomplete.

### Checkpoint 198: keep interior cell representatives ahead of edge allowance (2026-09-24)

Source inspection confirmed allowance-only candidates could replace interior
cell winners solely through their lower hash. Added viewport-interior priority
within each unpinned cell, retaining deterministic hash ties and explicit pin
priority. One bounded byte per cell avoids repeated projection of previous
winners; the admitted-row byte budget and exported policy now include it.

Source/diff checks only, with no tests, numerical runs, compiler/build, GPU or
browser execution, CI polling/waiting, commit or push. The broader ledger still
requires scientific functionality, data ingestion, native integration and
capacity/reference acceptance; the full goal stays active.

### Checkpoint 199: universal-conic nominal covariance Jacobian (2026-09-24)

Extended nominal SBDB covariance conversion beyond the prior e<=0.9999 cutoff
with a bounded unwrapped universal-variable periapsis state and analytic
implicit derivatives. Near-parabolic, parabolic and hyperbolic states now have
a source path into the shared coordinate mapper. The former elliptic formulas
remain a separate branch; rotation/unit mapping and extra-parameter identity
blocks retain the full joint covariance. Model/domain receipts and all three
offline implementation-hash lists distinguish the new module.

Consulted NAIF conics for the conic-state contract. This is implementation only:
no numerical evaluation, independent reference comparison, tests, compiler/build,
UI/device execution, CI polling/waiting, commit or push. Full-fit forces and
new-domain acceptance remain pending; the complete goal stays active.

### Checkpoint 200: expose nominal conic and coordinate-domain evidence (2026-09-24)

Added a shared browser readout for source eccentricity, periapsis, conic class,
signed periapsis-to-solution elapsed time, analytic formulation and numerical
domain. Solution conversion and propagated covariance use the original mapper
receipt; nonlinear sampling now retains a compact nominal model receipt while
preserving per-draw conic conversion. Existing exports carry these additions.
The readout distinguishes coordinate-domain limits from temporal fit-model and
physical validity, keeping additional-parameter force restrictions explicit.

Source/diff checks only. No tests, calculations, compilation/build, browser or
export execution, CI polling/waiting, commit or push. Numerical and UI acceptance
and the rest of the full objective remain incomplete; goal stays active.

### Checkpoint 201: bind covariance coordinate models to original SBDB axes (2026-09-24)

Added main-thread source/coordinate binding for covariance and ensemble receipts.
It resolves exact solution-epoch parameter aliases/units, preserves source axis
order, binds nominal values and the raw matrix, and checks source identity,
coordinate labels, conic classification and formulation/domain fields. Sampling
metadata must use the same source axes and epoch. Standard-epoch elements are
only eligible when the source epochs coincide. No eigensolver or coordinate
calculation is repeated in this publication check.

Source/diff checks only; no tests, calculations, compiler/build, browser/device
execution, CI polling/waiting, commits or pushes. Numerical/source authenticity
and complete-goal acceptance remain unproven; the goal stays active.

### Checkpoint 202: native/Web stellar covariance scaling checks (2026-09-24)

Inspected native uncertainty entry points: Gaia formal covariance has existing
service/readout support, while SBDB propagation has no shared Go endpoint.
Found variance-product normalization in Android/Web can overflow or underflow
before square-root scaling. All three clients now divide by separate standard
deviations and reject nonfinite correlation/factor/scaled residual values.
Source and Jacobian consistency tolerance remains unchanged, with no covariance
repair. This finishes the discovered existing-chain defect in source only.

No tests, numerical execution, compiler/build, browser/device checks, CI
polling/waiting, commit or push. Native SBDB service/UI and numerical/device
acceptance remain outstanding; full goal stays active and incomplete.

### Checkpoint 203: shared SBDB source-inspection backend (2026-09-24)

Added a bounded Go source parser and POST /v1/orbit/covariance/inspect route.
The receipt owns the original UTF-8 bytes, SHA-256 and source byte count; the
normalized source retains ordered 6–16 axes, nominal values, extra EST/CON
parameters and the full cross covariance. Solution/standard epoch fallback,
aliases, units, identity consistency and matrix spectrum are checked without
repairing the original matrix. The endpoint uses the shared trajectory-class
compute queue, source/envelope/reply bounds and a cancellation-aware eigensolver.
The receipt explicitly distinguishes byte integrity from authenticated JPL
origin, full-precision query provenance and physical force-model validity.

Only source review, formatting and diff whitespace checks were performed. No
tests, numerical execution, compilation/build, endpoint or device execution,
CI polling/waiting, commit or push. This is the source-inspection foundation;
Go Cartesian conversion/propagation, native integration and numerical acceptance
remain outstanding, along with the broader ledger. Full goal remains active.

### Checkpoint 204: shared solution-epoch covariance conversion (2026-09-24)

Added Go elliptic and universal-conic perifocal state/Jacobian implementations
and the full joint coordinate transformation, reached through a bounded POST
/v1/orbit/covariance/convert endpoint. Conversion re-audits original bytes and
requires an explicit positive adopted GM with source text. It preserves extra
parameter identity blocks and state cross terms, source axis order, numerical
domain/conic metadata, original provenance and cancellation checks. Shared
request/compute handling keeps conversion in the existing trajectory queue.
Source review also replaced overflow-prone covariance symmetrization in the
Web mapper and new Go mapper, with ordered operands preserving tiny identical
variances and exact symmetry of the averaged operand.

Consulted the NAIF conics contract. Only source review, formatting and diff
whitespace checks were performed: no numerical execution, tests, compilation,
build, HTTP/browser/device acceptance, CI polling/waiting, commit or push.
The port is not independent verification. Temporal propagation, native clients,
reference accuracy/capacity acceptance and broader objective work remain;
the full goal stays active and incomplete.

### Checkpoint 205: Android SBDB covariance import-to-export path (2026-09-24)

Added immutable original-source request and source-bound conversion report
classes, reused the cancellable HTTPS transport with a 4 MiB response budget,
and integrated a bilingual Android import/GM/conversion/readout/export panel.
The shared bounded provider-reader queue now admits the 2 MiB SBDB source cap.
Activity file selection/export and pause/destroy cleanup own source snapshots
and discard stale results. Receipt checks bind bytes/hash, solution epoch,
full matrix, axes/units, nominal parameters and requested GM; they also check
model/domain metadata, extra-parameter identity blocks, marginal variances and
the supplied Jacobian/covariance relation. Exports preserve complete responses.

Only source and diff whitespace checks were performed. No tests, calculation,
compilation/build, HTTP/device execution, CI polling/waiting, commit or push.
The new receipt checker is not independent scientific validation. iOS parity,
temporal propagation, numerical/device acceptance and the full goal remain
incomplete; the goal stays active.

### Checkpoint 206: iOS SBDB covariance import-to-export path (2026-09-24)

Added the Swift original-source request and source/receipt-bound conversion
report, including full matrix, axis/unit, epoch/identity, adopted GM and
Jacobian consistency checks. Integrated a bilingual SwiftUI import/conversion/
readout/export section into the native observation screen and Xcode target.
The existing off-main HTTP actor now serves bounded covariance responses;
the security-scoped source-reader actor admits the 2 MiB SBDB cap. Import and
network deadlines, task cancellation and generation checks gate publication;
exports retain the complete original response and source bytes.

Only source review and diff whitespace checks were performed. No tests,
numerical execution, compilation/build, provider/HTTP/UI/device acceptance,
CI polling/waiting, commit or push. Receipt consistency is not independent
physical/numerical validation. Shared temporal propagation, reference/device
acceptance and the broader scientific/performance objective remain incomplete;
the full goal stays active.

### Checkpoint 207: bounded Go integrator and variational gravity foundation (2026-09-24)

Added the shared-backend Dormand–Prince 5(4) component-max integrator with
bounded dimension/attempts, owned input arrays, reusable stage buffers,
compensated updates, FSAL reuse after acceptance, cancellation checks and
step/evaluation diagnostics. Added prescribed barycentric point-mass gravity
and six-state/6x6 transition-matrix derivatives, with explicit source/frame/
coverage contracts, copied mass metadata, finite writes and exclusion handling.
The gravity instance owns per-run scratch and exposes independently copied
model evidence. These are foundations for the missing shared propagation path.

Only source review, formatting and diff whitespace checks were performed.
No numerical execution, tests, compilation/build, benchmarks, endpoint/device
acceptance, CI polling/waiting, commit or push. SPK/GM source adapters, further
force terms, complete parameter derivatives, covariance/ensemble integration
and public/native propagation remain pending; full goal stays active.

### Checkpoint 208: split-epoch SPK and pinned Go DE440 adapter (2026-09-24)

Source inspection found the Go SPK reader collapsed elapsed offsets into a
single epoch. Added a cancellation-aware J2000 type 2/3 offset evaluator using
TwoSum and record-local offsets; retained later-segment priority and explicit
unsupported errors. Chebyshev record selection now accounts for rounded
boundary indices and validates its midpoint/radius. Added a per-run DE440/GM
adapter with exact browser-matched byte hashes, owned source bytes, explicit
exclusions, the non-overlapping eleven-mass plan and bounded one-epoch center
chain caching. Adapter construction resolves both window endpoints in its
runtime path, and exports source/model evidence separately from scratch state.

Only source review, formatting and diff whitespace checks were performed.
No kernel construction/evaluation, numerical calculations, tests, compilation,
build, benchmark, CI polling/waiting, commit or push. The adapter has not been
executed and supports Newtonian forces only. Additional forces, covariance/
ensemble propagation endpoints and independent/device acceptance remain open;
the full goal stays active and incomplete.

### Checkpoint 209: optional Go solar 1PN and radial SRP forces (2026-09-24)

Ported the existing Sun-relative monopole 1PN acceleration and analytic
position/velocity Jacobians, plus the explicit constant unshadowed radial
radiation-pressure acceleration and state Jacobian. Go DE440 options now
compose these terms only when explicitly adopted, snapshot SRP inputs and
export combined-model identity, assumptions and limitations independently of
the Newtonian base evidence. Added finite/domain checks, cancellation checks
and explicit rejection of missing/nonpositive force parameters. Fitted force
parameter uncertainty remains outside this fixed-parameter derivative contract.

Only source review, formatting and diff whitespace checks were performed.
No numerical execution, tests, compilation/build, benchmarks, endpoint/device
acceptance, CI polling/waiting, commit or push. The ports are unverified and
shared temporal covariance/ensemble endpoints still require integration;
the full scientific/performance goal stays active and incomplete.

### Checkpoint 210: Go covariance time-propagation composition (2026-09-24)

Connected original SBDB inspection, pinned DE440 construction, solution-epoch
coordinate conversion, J2000/SSB unit/frame mapping, simultaneous state/STM
integration and square-root covariance pushforward in one package entry point.
The result receipt preserves original bytes, force/source evidence, all
integrator settings/counts, the augmented state layout and a split final epoch.
Only positive-definite six-parameter sources are admitted; additional fit axes
are explicitly rejected pending matched force-parameter derivatives. Runs are
bounded to 365 days and 20,000 attempts, with cancellation and finite checks.

Only source review, formatting and diff whitespace checks were performed. No
numerical execution, tests, compilation/build, endpoint/device acceptance, CI
polling/waiting, commit or push. The package path is not yet an HTTP/native
propagation feature. Server source installation, endpoint/client wiring, full
fit-parameter propagation, ensembles and numerical acceptance remain open;
the full objective remains active and incomplete.

### Checkpoint 211: shared DE440 snapshot and propagation HTTP wiring (2026-09-24)

Separated immutable verified DE440 source bytes/descriptors/GMs from per-run
state caches and force scratch. Dynamics can reuse a private source snapshot
without repeating full kernel copies, hashes and parsing. Added paired backend
startup options with bounded regular-file reads and fail-fast source validation.
Added the covariance propagation route with explicit restricted-model adoption,
exact exclusion-body selection, shared compute admission, request/source/reply
bounds and a context deadline. No source installation is performed by requests.

Only source review, formatting and diff whitespace checks were performed. No
source loading, numerical execution, tests, compilation/build, server startup,
HTTP/device acceptance, benchmarks, CI polling/waiting, commit or push. Runtime
and concurrent-sharing behavior remain unverified; native propagation controls,
full fit-model derivatives, ensembles and the broader objective remain open.
The full goal stays active and incomplete.

### Checkpoint 212: Android propagation transport and receipt binding (2026-09-24)

Added immutable bounded propagation requests with explicit model adoption,
source epoch/duration and exact eleven-body exclusions. Added a source-bound
report decoder and cancellable transport entry point, reusing the initial
coordinate validator without JSON reserialization. Receipt checks bind force
selection, pinned metadata, initial source/GM, split final epoch, integrator
settings/counters and covariance square-root consistency. Cross-runtime GM
unit conversion uses an explicit eight-ulp receipt tolerance.

Only source and diff whitespace checks were performed. No tests, numerical
execution, compilation/build, HTTP/device calls, CI polling/waiting, commit or
push. This transport currently covers Newtonian and optional 1PN only; SRP
input, native controls, iOS parity and independent acceptance remain open.
The full scientific/performance goal stays active and incomplete.

### Checkpoint 213: Android propagation controls and explicit SRP (2026-09-24)

Added immutable, finite SI radiation-pressure inputs with bounded UTF-8 source
text, safe JSON encoding and exact response binding. Android propagation now
accepts all four implemented Newtonian/1PN/SRP combinations. Integrated the
propagation mode, explicit model adoption, source epoch/duration, eleven body
exclusions and optional force inputs into the bilingual covariance panel. Mode
and input edits cancel work and invalidate stale results. Final reference JD
and elapsed seconds remain separate in the readout; complete propagation
receipts use a dedicated export filename and retain all numerical evidence.

Only source and diff whitespace checks were performed. No tests, numerical
execution, compilation/build, UI/device/HTTP calls, CI polling/waiting, commit
or push. Android behavior remains unverified; iOS parity, full fit-model
propagation, ensembles and independent acceptance remain open. The full goal
stays active and incomplete.

### Checkpoint 214: iOS conditional propagation request, receipt and controls (2026-09-24)

Added immutable bounded propagation and explicit SRP requests, the cancellable
service entry point and source-bound propagation receipt decoder. Reused the
initial coordinate validator without JSON reserialization. Checks bind pinned
source metadata, eleven exclusions, optional 1PN/SRP settings, initial source
and GM, integration settings/counters, split final epoch and covariance-root
consistency. Registered the new source in the Xcode target.

Integrated bilingual propagation controls into the covariance view with no
physical parameter defaults, explicit restricted-model adoption, edit/lifecycle
cancellation, separate reference JD and elapsed seconds, and a snapshot export
with its own propagation filename. Conditional uncertainty limitations remain
visible and the exported response retains original source evidence.

Only source and diff whitespace checks were performed. No tests, calculations,
compilation/build, UI/device/HTTP calls, CI polling/waiting, commit or push.
iOS and Android behavior and numerical accuracy remain unverified; full fit-model
propagation, ensembles, data admission, scale acceptance and other goal items
remain open. The full goal stays active and incomplete.

### Checkpoint 215: explicit propagation exclusion boundaries (2026-09-24)

Source review found that decoding exclusionKm directly into map[int]float64
coerced JSON null to zero and accepted alternate integer spellings. Replaced
that boundary with a bounded decoder requiring canonical NAIF keys, explicit
finite nonnegative numbers, at most eleven entries and no duplicate bodies.
The handler still requires the exact pinned eleven-body plan. Finite epoch and
the 365-day duration bound are checked before acquiring the compute lease.
Explicit zero remains valid and distinct from an absent or null value.

Reviewed the native request serialization, shared cancellable transports and
backend route/scheduler wiring as source only. No tests, numerical execution,
build, UI/device/HTTP calls, CI polling/waiting, commit or push. Ran gofmt and
diff whitespace checks only. Native behavior and scientific/scale acceptance
remain unverified; the full goal is active and incomplete.

### Checkpoint 216: propagation diagnostics and limitation visibility (2026-09-24)

Android validated but discarded propagation/force/gravity limitation arrays
before display; it now retains owned copies and shows those original notes.
Android and iOS expose validated smallest/largest accepted steps, maximum
accepted local error ratio and relative tolerance. The browser covariance
result now includes the corresponding diagnostics and original propagation
and force-model limitations in an expandable readout. Existing full-response
exports retain absolute tolerances and transition layout without rewriting
source-bearing receipts.

Bilingual copy distinguishes the component-normalized embedded local estimate
from global error bounds, source-fit uncertainty and physical accuracy. Zero
duration explicitly has no accepted steps; zero diagnostics do not establish
accuracy. Only source and diff whitespace checks were performed, with no tests,
calculations, builds, browser/device runs, CI waiting, commits or pushes. Runtime
and numerical acceptance remain outstanding; the full goal remains incomplete.

### Checkpoint 217: exact input bytes in scientific exports (2026-09-24)

Browser dynamics and offline receipts previously retained parsed JSON and the
original hash but could not reconstruct the original file bytes. Added bounded
canonical Base64 preservation for browser coordinate conversion, covariance
propagation, nonlinear ensembles and manual dynamics. Worker publication now
binds the returned original bytes to a pre-transfer input snapshot, in addition
to the existing hash/length/parsed-payload checks. Browser encoding uses bounded
chunks aligned to three bytes, with a 2 MiB input ceiling.

The four offline conversion/propagation/ensemble/dynamics exporters now include
originalBase64 alongside their existing hashes and parsed source evidence.
This preserves whitespace and numeric spellings without pretending that a
reserialized payload reproduces the original hash. Historical exports lacking
the field cannot recover missing originals from a hash alone.

Only source and diff whitespace checks were performed. No calculations, tests,
builds, browser/device runs, CI waiting, commits or pushes. Runtime/export
acceptance and the broader scientific/performance goal remain incomplete.

### Checkpoint 218: bounded offline scientific file snapshots (2026-09-24)

Replaced stat-then-readFile source ingestion with a shared regular-file reader
used by coordinate conversion, covariance propagation, nonlinear ensembles
and manual dynamics. Allocation is capped by the opened file size plus one
sentinel byte; reads are at most 64 KiB. Empty, oversized, nonregular, changed
or truncated inputs are rejected. Cancellation is checked between OS reads
and the handle closes in finally. An already pending OS read is not preempted.

Source/implementation files use a 2 MiB ceiling, GM uses 1 MiB and the pinned
SPK requires its declared exact byte count before reading. Existing source
hash validation remains authoritative. The helper itself is included in the
implementation hash records. Conversion now accepts an optional AbortSignal
and its CLI installs/removes SIGINT handling like the propagation tools.

Only source and diff whitespace checks were performed. No helper or scientific
script execution, tests, calculations, builds, CI waiting, commits or pushes.
Bounded-read/cancellation behavior remains unverified by execution. The full
scientific and scale goal remains active and incomplete.

### Checkpoint 219: complete no-replace offline receipt publication (2026-09-24)

The four offline scientific exporters previously wrote directly to a new target,
which could leave truncated JSON after a write failure. They now share a writer
that bounds the UTF-8 byte buffer (32 MiB default), writes at most 64 KiB per OS
call in a private sibling temporary directory, syncs/closes the completed file
and creates the destination with a no-replace hard link. Existing destinations
remain untouched. Unsupported hard-link filesystems fail without a rename or
overwrite fallback. Only this invocation temporary file and empty directory
are removed; cleanup warnings are returned separately from publication success.

Cancellation is observed before creation and between writes. Successful link
creation is the commit point; cancellation after it does not remove a complete
result or report it as cancelled. File sync does not assert directory/crash
durability. JSON serialization remains synchronous and precedes the writer;
the byte cap bounds the writer allocation, not arbitrary serialization memory.

Only source and diff whitespace checks were performed. No writer execution,
tests, calculations, builds, CI waiting, commits or pushes. Filesystem and
cancellation behavior remain unverified; the full goal is active/incomplete.

### Checkpoint 220: elapsed-time cooperative spatial selection (2026-09-24)

Source review found fixed 16,384-row cooperative batches encompassing index
rebuilds, projection and representative selection. Added a 4 ms scheduling
policy checked every 1024 rows/cells (32 membership words during source-order
assembly), while retaining the original maximum batch yields. Every added
yield rechecks cancellation before touching the shared snapshot again.
Projection, interior-before-edge priority, deterministic winner hashes, focus
pins and source-order output are unchanged. No new catalog-sized buffers were
introduced. This bounds additional work between clock checks by row counts;
it does not guarantee a 4 ms latency or an FPS/throughput improvement.

Only source and diff whitespace checks were performed. No tests, benchmarks,
browser/device execution, calculations, builds, CI waiting, commit or push.
Measured responsiveness and representative equivalence remain unverified.
The full scientific and scale goal remains active and incomplete.

### Checkpoint 221: bounded optional catalog persistence (2026-09-24)

Source review found a detached writeCache call for every validated network
artifact. Acquisition admission did not cover those background writes, so slow
IndexedDB/quota work could retain an unbounded sequence of completed buffers.
Replaced that path with one active cache write, at most four waiting writes and
a combined 64 MiB retained-buffer ceiling per realm. Active/waiting requests
for the same URL coalesce. Reservations remain held through storage checks,
pruning and transaction completion and are released on success or failure.

When optional persistence is saturated, the artifact is delivered normally and
its cache write is skipped. No scientific rows or foreground results are
dropped. The ceiling covers scheduler-held buffers, not IndexedDB internal
clones, decoded consumers, browser RSS or other realms. Existing cache quota
and source validation rules are unchanged.

Only source and diff whitespace checks were performed. No tests, benchmarks,
browser/IndexedDB execution, builds, CI waiting, commits or pushes. Runtime
memory behavior and cache acceptance remain unverified. The full scientific
and scale goal stays active and incomplete.

### Checkpoint 222: bounded catalog acquisition waiters (2026-09-24)

Catalog admission limited active acquisitions but retained an unbounded FIFO
of waiters without a deadline. Added defaults of 32 queued acquisitions and
a 15-second queue wait per realm, preserving the four-active limit and FIFO
ordering. Saturated queues reject before adding listeners/timers. Queued
cancellation and timeout remove their entry and clean up associated resources.
Admission rechecks the monotonic deadline before granting a lease, so delayed
timer delivery cannot admit an already expired waiter. Lease release remains
idempotent and active work retains its existing cancellation/lifetime rules.

The queue deadline is not a completion or real-time response guarantee; event
loop suspension can delay rejection notification. Constructor bounds are
explicit; queue size zero permits immediate slots but no waiting requests.
Only source and diff whitespace checks were performed. No tests, benchmarks,
browser execution, builds, CI waiting, commits or pushes. Runtime acceptance
and the full scientific/performance goal remain incomplete.

### Checkpoint 223: optional covariance numerical refinement comparison (2026-09-24)

Extended conditional covariance propagation to optionally reuse the existing
second integration with tenfold tighter tolerances and half initial/maximum
steps. The refined transition matrix propagates the same initial covariance
factor separately; endpoint-state agreement is not substituted for covariance
agreement. Receipts retain refined heliocentric nominal state, full covariance,
root, sigmas and component absolute sigma differences, plus both integrations
settings/transition evidence. Added missing refined counters and step diagnostics.

Browser controls opt in, invalidate stale results on change, show the sigma
comparison and refined full matrix, and preserve both results on export. The
worker protocol and publication checks bind refinement adoption, settings,
coordinate epoch/axes and reported sigma differences. The offline covariance
CLI supports --compare-refinement. Default work remains a single integration;
the browser deadline covers both runs and each keeps its attempt budget.

Same-model differences are not independent validation, a global error bound
or physical uncertainty; zero-duration agreement supplies no convergence
evidence. Only source and diff whitespace checks were performed. No tests,
calculations, builds, browser/device runs, CI waiting, commits or pushes. Native
refinement parity and independent numerical acceptance remain open; the full
goal stays active and incomplete.

### Checkpoint 224: backend covariance refinement composition (2026-09-24)

Added an opt-in PropagateCovarianceWithRefinement entry point while preserving
the existing single-run function. Both integrations use the same owned source,
frozen force evidence and initial covariance factor. Refined tolerances are
tenfold tighter and initial/maximum steps are halved. A shared projection path
retains the refined full coordinates, covariance root, sigmas and component
absolute sigma differences, with the complete 42-state integration diagnostics.

The HTTP endpoint accepts compareRefinement; both runs share the existing
20-second context, single compute lease and 4 MiB response budget. An adopted
comparison failure is an error, never a silently downgraded baseline response.
Absent/false adoption emits null refinement and preserves baseline behavior.
Until native opt-in controls/decoders are added, both native clients explicitly
reject unrequested non-null refinement rather than displaying it as baseline.

Only source review, gofmt and diff whitespace checks were performed. No tests,
calculations, compilation/build, HTTP/device calls, CI waiting, commits or
pushes. Native refinement adoption and independent acceptance remain open.
The full scientific and scale goal remains active and incomplete.

### Checkpoint 225: Android covariance refinement controls and binding (2026-09-24)

Added immutable compareRefinement request adoption with default-false legacy
constructors and an explicit bilingual checkbox. Input changes cancel work and
invalidate previous output. The decoder now reuses integration and coordinate
validators for both runs: algorithm, tighter tolerances/step budgets, counters,
split epoch, axes/units, finite states and covariance-root consistency. Refined
sigma differences must match the two returned sigma vectors. Missing adopted
refinement and unrequested non-null refinement fail closed. Counter summation
uses a long intermediate to avoid integer wraparound in malformed receipts.

The panel displays refined nominal coordinates, formal sigmas and absolute
sigma differences with units, plus refined counters/error ratio and limitation
text. Raw export preserves both complete results without reserialization. The
existing request deadline/cancellation/byte budgets remain unchanged.

Only source and diff whitespace checks were performed. No tests, calculations,
compilation/build, HTTP/device/UI calls, CI waiting, commits or pushes. Android
behavior and numerical comparisons remain unverified; iOS refinement adoption
and the broader scientific/performance acceptance remain open. Goal incomplete.

### Checkpoint 226: iOS covariance refinement adoption (2026-09-24)

Added default-false compareRefinement request encoding and an explicit bilingual
control. Toggling it uses the existing cancellation/result invalidation path.
The receipt decoder reuses integration and coordinate checks for baseline and
refined results, binds the tighter settings, validates split epoch/axes/units,
checks covariance-root consistency and binds each absolute sigma difference.
Missing requested comparison and unrequested non-null comparison are rejected.

The readout includes refined nominal coordinates, sigmas, absolute sigma
differences, step counters and local error diagnostics with units and limits.
Original-response export preserves both full matrices and diagnostics. Both
runs retain the existing shared backend deadline and response byte budget.

Only source reading/editing and diff whitespace checking were performed. No
tests, calculations, compilation/build, device/UI/API runs, CI waiting, commits
or pushes. Native behavior and independent numerical acceptance remain
unverified; broader scientific/data/scale work remains open. Goal incomplete.

### Checkpoint 227: backend nonlinear source-offset conversion (2026-09-24)

Added ConvertSourceOffsets as the initial backend ensemble building block. It
audits original SBDB bytes through Convert, owns finite source-unit offsets,
and bounds input to 128 complete joint draws. Each draw evaluates a nonlinear
conic state at the source epoch, keeping periapsis time offsets separate from
the large Julian date. Source axis order, extra parameters and offsets remain
in the receipt; invalid draws retain indices and reasons with null states,
without clipping or resampling. Cancellation aborts the entire operation.

This reuses the bounded nominal conic solvers and their derivative-finiteness
domain. It is neither a distribution sampler nor force propagation and is
not yet exposed by HTTP/native clients. Backend ensemble integration, shared
force-evaluation budgets, summaries and client parity remain outstanding.

Only source inspection/editing, gofmt and diff whitespace checking were
performed. No tests, calculations, builds, CI waiting, commits or pushes.
Numerical correctness and runtime behavior remain unverified. Goal incomplete.

### Checkpoint 228: bounded backend nonlinear ensemble integration (2026-09-24)

Added PropagateSourceOffsets, connecting audited nonlinear source-offset states
to the existing pinned DE440 six-state integrator. At most 128 draws run
serially with one run-local force cache and a shared 250000 derivative-call
budget. Failed derivative calls consume budget; cancellation and exhaustion
abort the whole operation. Coordinate, integration and projection failures
retain indexed records and null endpoints without dropping original offsets.

Successful integrations retain settings and diagnostics in J2000 SSB km/km/s;
endpoints use heliocentric ecliptic au/au/d with a split final epoch. Zero
duration copies initial coordinates exactly, with no integration receipt or
force evaluations. Additional fitted/considered axes are rejected rather than
discarded. Fixed adopted solar relativity/SRP use the existing force wrappers.

Only source/interface review, gofmt and diff whitespace checks were performed.
No tests, calculations, builds, CI waiting, commits or pushes. HTTP/native
adoption, descriptive moments and independent numerical acceptance remain
open, alongside the broader scientific/data/scale scope. Goal incomplete.

### Checkpoint 229: backend ensemble descriptive moments (2026-09-24)

Connected endpoint summaries to backend nonlinear propagation. Summaries use
the browser anchored compensated two-pass formulation, retain anchor and
meanOffset separately from the rounded absolute mean, and record the n-1
covariance divisor. Symmetric covariance and marginal standard deviations
retain endpoint units; overflow/nonfinite intermediates fail explicitly.

All endpoint identities and successful states are checked. Any failed draw
makes moments unavailable with failedCount and reason; fewer than two draws
also produce an explicit unavailable result. No success-only distribution
is substituted. Cancellation is checked during validation and every sum.

Only source inspection/editing, gofmt and diff whitespace checks were
performed. No tests, calculations, builds, CI waiting, commits or pushes.
HTTP/native adoption and independent numerical acceptance remain open, as
does the broader scientific/data/scale scope. Goal incomplete.

### Checkpoint 230: backend ensemble HTTP admission (2026-09-24)

Registered POST /v1/orbit/covariance/ensemble and connected it to bounded
source-offset propagation and descriptive moments. The handler retains the
3 MiB request/2 MiB original-source bounds, exact eleven-body exclusions,
explicit restricted-model adoption, single compute lease, 20-second context
and 4 MiB response limit. No installed pinned source returns 503.

A dedicated offset decoder rejects null components, nested/non-numeric values,
nonfinite numbers, incomplete six-axis draws and more than 128 draws. Missing
offsets fail admission before queue acquisition. The response preserves
original source evidence, indexed failures, numerical settings and moments.
Refinement is not an accepted ensemble request option.

Only source/interface reading, editing, gofmt and diff whitespace checks were
performed. No HTTP requests, tests, calculations, builds, CI waiting, commits
or pushes. Native controls/receipt binding and independent acceptance remain
open alongside the wider scientific/data/scale requirements. Goal incomplete.

### Checkpoint 231: native ensemble request contracts (2026-09-24)

Added Android OrbitEnsembleRequest and iOS NativeOrbitEnsembleRequest. Both
retain immutable source-offset data, require 1 to 128 finite six-axis draws,
reuse explicitly adopted propagation parameters, cap encoding at 3 MiB and
omit the unsupported compareRefinement field. Android uses cloned input/output
arrays; Swift uses immutable value types. Encoding checks cancellation.

Android propagation encoding now shares the original source/force fields
between covariance and ensemble requests without altering baseline JSON
options. The existing Android force-evidence validator was extracted for
reuse by the upcoming ensemble decoder, retaining pinned source, mass plan,
exclusion, frame, epoch, optional-force and limitation checks.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, compilation/build, native/HTTP calls, CI waiting, commits
or pushes. Native ensemble response decoders, transport and controls are
still pending; request types alone are not delivered native functionality.
Independent acceptance and wider scientific/data/scale work remain open.

### Checkpoint 232: Android ensemble receipt and transport binding (2026-09-24)

Confirmed checkpoint 231 documentation survived the interrupted tool call.
Added an Android ensemble decoder binding original source bytes, GM/force
evidence, exact offsets, split epoch and output units. Indexed coordinate and
endpoint failures are retained, zero-duration outputs bind to initial states,
and complete six-state integrations reuse the existing numerical settings
validator. Per-draw force counts sum to the shared maximum-bounded total.

Moment availability binds to the actual failure count/sample count; available
arrays require finite values, first-endpoint anchor, mean-offset consistency,
symmetry and sigma/variance consistency. This does not independently reproduce
the conic states, force integration or moments from all endpoints. Raw export
retains every original response field. Added loadEnsemble to the existing
cancellable, deadline/byte-bounded Android transport. UI and iOS decoder remain
pending; this is not verified native feature delivery.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, HTTP/device calls, CI waiting, commits or pushes.
Numerical and native acceptance remain unverified. Full goal incomplete.

### Checkpoint 233: Android ensemble controls and indexed readout (2026-09-24)

Added explicit ensemble mode, source-unit JSON offset input and transport
selection to the existing covariance panel. Refinement controls are hidden
for ensemble requests. Input/mode changes invalidate output and cancel work
through the existing generation/lifecycle guard. The input rejects more than
32768 characters or invalid/incomplete draws without truncating pasted data.

The bilingual readout retains every indexed success/failure, displays split
epoch, units, shared force counts and either descriptive mean/sigma or an
explicit unavailable reason. Export uses exact raw ensemble response bytes
and its own filename. No successful-only statistics or probability claims.

Only source/interface reads, edits and diff whitespace checks were performed.
No tests, calculations, builds, UI/device/HTTP calls, CI waiting, commits or
pushes. Android behavior is unverified. iOS receipt/transport/UI adoption and
independent numerical/scale acceptance remain outstanding. Goal incomplete.

### Checkpoint 234: iOS ensemble receipt and transport binding (2026-09-24)

Added the iOS ensemble receipt decoder in the existing registered propagation
source file. Shared force checks preserve pinned evidence and adopted force
parameters; the integration validator now supports six-state ensemble and
42-state covariance receipts. Source bytes, GM, offsets, axes, split epoch,
indexed failures, zero-duration identity and shared force counts are bound.
Moment availability follows failures/count; available arrays bind anchor,
mean-offset relation, symmetry and sigma consistency. No endpoint integration
or all-endpoint moment recomputation is claimed by these checks.

Added loadEnsemble on the existing actor transport with one active operation,
cancellation, the existing transfer deadline and 4 MiB response bound. Exact
response bytes remain available for export. iOS controls/readout remain open.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, UI/device/API calls, CI waiting, commits or pushes.
Native behavior and numerical accuracy remain unverified. Full goal incomplete.

### Checkpoint 235: iOS ensemble controls and indexed readout (2026-09-24)

Connected the iOS covariance panel to ensemble requests and actor transport.
An explicit mode exposes multiline JSON source offsets and hides refinement
controls. Submission rejects input beyond 32768 UTF-16 units without
truncation, requires 1 to 128 finite complete six-axis draws, and preserves
source-order/unit semantics. Input/mode changes use the existing generation
and cancellation path, clearing all previous result variants.

The bilingual readout includes split epoch, units, every indexed endpoint or
failure, shared force counts and descriptive moments or unavailable reasons.
Raw response export uses an ensemble filename and retains complete evidence.
No probability sampling or physical-accuracy claims are introduced.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, compilation/build, UI/device/API calls, CI waiting,
commits or pushes. Both native ensemble flows remain unverified; wider
scientific/data/scale implementation and independent acceptance are still
outstanding. Full goal remains active and incomplete.

### Checkpoint 236: browser ensemble failure accounting parity (2026-09-24)

Source comparison found browser receipts lacked indexed derivative counts for
failed draws and classified projection errors as integration failures. Added
a bounded ordinary-number array forceEvaluationsByDraw, including failing
calls, and a separate projection stage. Completed integration counters remain
when projection fails. The ordinary array survives existing browser/CLI JSON
export without adding a typed-array serialization special case.

Browser moments now explicitly retain failedCount, reject nonfinite compensated
sum intermediates and invalid variances, and accept the caller cancellation
signal. The anchored n-1 formulation and unavailable-on-any-failure policy
remain. Source semantics still differ intentionally: browser sampling is
seeded while native/backend requests supply explicit offsets. Wire parity
is not numerical equivalence or calibration evidence.

Only source reading/editing and diff whitespace checks were performed. No
tests, computations, builds, UI/API runs, CI waiting, commits or pushes.
Independent acceptance and broader scientific/data/scale work remain open.

### Checkpoint 237: browser indexed ensemble receipt checks (2026-09-24)

Added a live-worker receipt validator before result delivery. It binds sampled
and converted offsets, typed state shapes/sentinels, indexed initial/final
failures, zero-duration identity, per-draw and total force budgets, completed
integration counters and projection/integration failure stages. Moment
availability follows actual failures/count; available arrays bind anchor,
mean relation, covariance symmetry and sigma consistency. This checks receipt
consistency, not independent dynamics or statistical calibration.

The browser endpoint table now shows per-draw force evaluations and failure
reasons include their recorded stage. Existing full JSON export retains the
ordinary-number count array without special serialization.

Only source reads/edits and diff whitespace checks were performed. No tests,
calculations, builds, UI/API calls, CI waiting, commits or pushes. These checks
and UI behavior remain unexecuted. Full scientific/scale goal incomplete.

### Checkpoint 238: ensemble numerical metadata and finite sampling (2026-09-24)

Bound browser ensemble receipt method, sampling algorithm/distribution, final
frame/units, component integration tolerances, step/attempt settings, limitation
text and empty extra-axis arrays. These checks complement indexed accounting
without claiming to recompute dynamics or prove scientific accuracy.

Source inspection also found missing explicit finite checks during Gaussian
correlation factorization and offset generation. Added rejection for nonfinite
correlations, intermediate/final factors and generated offsets. Overflow is
an error rather than a repaired covariance or replacement draw; the original
versioned sampling arithmetic is otherwise unchanged.

Only source reads/edits and diff whitespace checks were performed. No tests,
calculations, builds, UI/API calls, CI waiting, commits or pushes. Independent
numerical acceptance and the full scientific/data/scale scope remain open.

### Checkpoint 239: cancellable bounded SBDB browser import (2026-09-24)

Source inspection confirmed covariance/ensemble panels are keyed by source
hash and their workers terminate on unmount; no new source-switch defect was
asserted there. Found the parent source import still used uncancellable
File.arrayBuffer with no read deadline. Added a FileReader helper with 1 byte
to 2 MiB admission, 25-second read timeout, actual-size checks and complete
listener/timer cleanup. Abort stops the reader; source changes/clear/unmount
abort through an owned controller while generation guards reject stale work.

Added a generation check immediately after the asynchronous GM digest so an
invalidated conversion does not proceed to synchronous scientific calculation.
Hash operations already in flight are not claimed to be abortable.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, browser/file API runs, CI waiting, commits or
pushes. Import behavior and wider scientific/scale acceptance remain unverified.
Full goal remains active and incomplete.

### Checkpoint 240: cancellable scientific laboratory file imports (2026-09-24)

Reused the abortable reader in dynamics, occultation and conic laboratories,
retaining their respective 2 MiB, 64 KiB and 1 MiB limits. The helper accepts
only bounded caller limits up to 2 MiB. Replacement, input invalidation and
unmount abort owned readers; all reads have a 25-second deadline. Dynamics
and occultation now expose read status and cancel controls separately from
calculation state. Conic loading checks generation before decoding and before
starting an experiment after lazy GM import.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, browser/file API calls, CI waiting, commits or
pushes. File API behavior and numerical/native/scale acceptance remain
unverified. Full scientific/data/performance goal remains incomplete.

### Checkpoint 241: exact source bytes in occultation/conic exports (2026-09-24)

Found contact, SPK-limb and stellar-limb receipts retained hashes and parsed
input but not the original JSON bytes. Added originalBase64 from owned input
buffers to each experiment, and bound it against the main-thread copy before
worker transfer. Shared browser/offline experiment results now carry exact
submitted bytes in addition to payload and hash. SBDB conic decoding also
retains its owned original bytes in the source receipt.

This does not restore original imported files after UI parameter overrides:
the distinction between imported source and submitted experiment still needs
explicit provenance handling in the contact panel. No historical hash-only
export is claimed to be recoverable.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, UI/API calls, CI waiting, commits or pushes.
Runtime/export acceptance and full scientific/data/scale completion remain open.

### Checkpoint 242: imported contact source versus submitted settings (2026-09-24)

The contact panel now retains the exact imported bytes as Base64, byte length,
file name and source kind separately from the worker-bound submitted input.
Each result captures original and submitted values of the three editable
settings plus changedFields. Bundled examples are explicitly labeled as
serialized example bytes, not byte-identical repository files. This is local
preparation metadata, not source authentication; the submitted input keeps its
existing worker receipt hash and byte binding.

Export rejection handlers in contact, conic, dynamics and source covariance
panels now check the captured generation before setting an error, including
after panel unmount. Other scientific export panels still require lifecycle
review. No download cancellation or successful filesystem save is claimed.

Only source reading/editing and diff whitespace checks were performed. No
tests, scientific calculations, builds, UI/API acceptance, CI waiting, commits
or pushes. Independent accuracy, runtime/native/scale acceptance and the full
scientific expansion goal remain incomplete.

### Checkpoint 243: remaining export lifetimes and Gaia upload backpressure (2026-09-24)

Added generation-bound export rejection handlers to nonlinear ensembles,
covariance time propagation, SPK limbs, station stellar limbs, PCK orientation,
Gaia catalog/station calculations, Gaia sky and target coverage inspection.
Panels without a generation counter now invalidate it on reset and unmount.
Existing worker identity checks remain in place. Source inspection confirmed
that parent source replacements already remount covariance and stellar-limb
children; no duplicate source-change mechanism was added.

The Gaia worker previously waited indefinitely for each display acknowledgement.
It now aborts and rejects after 30 seconds, clearing the timer on acknowledgement
or postMessage failure. Gaia plot identity and upload/error/selection callbacks
are tied to the loading generation. Upload/draw exceptions, lost context and
reported WebGL errors now fail the chart instead of acknowledging that chunk.
A successful acknowledgement still does not prove physical screen presentation
or performance: no fence/timing/device acceptance was performed.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, browser/device/API runs, CI waiting, commits or
pushes. The full scientific and scale goal remains incomplete.

### Checkpoint 244: cancellable Gaia local reads and waiter cleanup (2026-09-24)

Gaia local manifest/chunk imports now use the bounded FileReader helper rather
than uninterruptible file.arrayBuffer calls. The helper permits explicit limits
up to 8 MiB for Gaia while retaining the existing 2 MiB default and lower
caller-specific limits. Each chunk must match the manifest byte count before
reading; the read uses the scheduler signal and exact descriptor byte budget.
The existing 25-second read timeout aborts FileReader itself.

Worker upload acknowledgement waits now remove their timer and abort listener
on success, failure and task finalization. The generic consumer cancellation
wrapper removes its listener immediately when cancelled, while observing any
later consumer rejection. The session LRU was inspected: encoded bytes are
copied on get/put and bounded separately from active decoded/GPU storage. No
cache total is claimed to bound overall resident memory.

Only source reading/editing and diff whitespace checks were performed. No
tests, scientific calculations, builds, browser/device/API acceptance, CI
waiting, commits or pushes. Worker FileReader behavior and resource/performance
acceptance remain unverified; the full goal remains incomplete.

### Checkpoint 245: bounded Gaia drawing surface and selected-source reuse (2026-09-24)

Inspected the decode/transfer/display chain. Float64 ICRS directions remain
in the worker; tangent-plane Float32 display arrays are transferred. Source
records are cloned to the main thread for selection and export. Retained
display batches support picking; neither these nor source objects are covered
by the encoded-cache budget. No total-memory measurement is claimed.

GaiaPlot now rejects capacities outside the existing 0..10000 manifest row
range before creating a graphics context. The square drawing surface is capped
at 2048 pixels and the device viewport/renderbuffer limits, and does not
request depth, stencil or antialias buffers. Point-buffer/shader/program
allocation failures are explicit. Point density follows the actual drawing
scale when capped, preserving its CSS size convention. Selected-source
covariance/position summaries use memoized results until the source changes
instead of recomputing on every streamed chunk or zoom render.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, browser/device runs, benchmarks, CI waiting,
commits or pushes. Device behavior, visual acceptance, driver memory and
throughput remain unverified. The full goal remains incomplete.

### Checkpoint 246: rolling Gaia admission within retained reservations (2026-09-24)

Replaced wave-wide Promise.all barriers with a rolling active set. The next
manifest descriptor is admitted when concurrency, encoded-byte and row budgets
permit, without waiting for unrelated jobs from an earlier wave. Admission
remains in manifest order; consumption remains serial in decode-ready order.
Each reservation spans fetching, decoding and awaited consumer acknowledgement.
Failure stops new admission, aborts active jobs, observes their settlement and
then propagates failure. No prefetch queue bypasses the budget.

The summary now includes configured loading budgets and peak active chunk count
alongside peak reserved source bytes/rows. These counters describe scheduler
reservations, not total resident memory or measured throughput. Spatial
selection remains the existing conservative catalog-epoch rectangle filter.

Only source reading/editing and diff whitespace checks were performed. A source
editing command failed to parse before writing and was replaced with a patch;
no project code was executed. No tests, calculations, builds, browser/device
runs, benchmarks, CI waiting, commits or pushes. Scheduler acceptance and the
full scientific/performance goal remain incomplete.

### Checkpoint 247: spatial-selection evidence and callback metadata ownership (2026-09-24)

Inspected closed-bin overlap, RA wrap/seam and polar inclusion paths, plus
existing test source without running it. Selection retains whole intersecting
bins at J2016.0; it does not filter rows to the requested rectangle. Added a
selection receipt with a copied region, ICRS/TCB convention, selected paths,
omitted-manifest chunk count, all-manifest status and explicit limitations.
The chart distinguishes complete manifest loading from sky/catalog completeness.
No new numerical evidence is claimed for boundary cases.

Found that callback chunk.descriptor shared the scheduler descriptor object.
Consumer mutation could change reservation release and verified-row counts.
Each decoded chunk now exposes a descriptor copy with copied angular ranges,
leaving admission/release metadata in the owned manifest snapshot.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds, browser/device runs, CI waiting, commits or
pushes. Runtime boundary/budget acceptance and the full goal remain incomplete.

### Checkpoint 248: catalog locator integrity and cache budget validation (2026-09-24)

Catalog search locator packing previously checked safe integers but allowed
negative values, oversized Uint32 values, out-of-manifest rows/chunks and
chunk identity mismatches. Added validation before packing, with manifest
dimensions copied before the asynchronous read. Present malformed fields fail
even when another record lacks legacy locator fields; genuinely missing
locators retain the existing legacy fallback. This prevents conversion into
a different source row by integer wrapping. Last-shard record availability
still requires the subsequent source-record resolution.

SharedCatalogCache now rejects negative/non-integer/non-finite capacities. A
negative capacity could keep its eviction loop running after the map emptied.
Zero remains valid for sharing in-flight work without retaining decoded values.
Existing call-site budgets are unchanged. Decoded cache values still have
shared ownership; immutable record handling remains an audit item.

Only source reading/editing and diff whitespace checks were performed. No
tests, scientific calculations, builds, browser/device/API runs, CI waiting,
commits or pushes. Runtime acceptance and the full goal remain incomplete.

### Checkpoint 249: immutable decoded catalog cache publication (2026-09-24)

Inspected loader consumers, sample-store handoff and sampling/sorting paths.
Decoded cache hits previously exposed mutable shared arrays and records. Added
a one-time prepare hook before shared publication; catalog search, lookup,
chunk and sample caches freeze their arrays and scalar-field records. Summary
caches freeze category counts, numeric range pairs, range maps and the root.
Consumers needing edits must copy; cache hits do not clone complete shards.
Cancellation is checked both before and after preparation.

This protects the declared record fields at runtime, not arbitrary nested
unknown JSON extensions. Existing mutable TypeScript array signatures remain
for compatibility; runtime objects are shared read-only. No source validation,
numerical accuracy or memory/throughput claim follows from freezing.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/API runs, CI waiting,
commits or pushes. Runtime consumer compatibility and full scientific/scale
acceptance remain open; the full goal remains incomplete.

### Checkpoint 250: explicit manifest binding through provider hydration (2026-09-24)

Provider startup previously took a manifest result but subsequently requested
provenance and selected bodies through the global active-manifest default.
It now stops stale generations before provenance work, passes the returned
manifest explicitly to both operations, and propagates the hydration abort
signal into provenance reads. Each operation copies its manifest snapshot;
explicit manifests without releasePath use the legacy data root rather than
whichever release became globally active.

A fetched provenance report must declare the requested manifest version; a
mismatch throws rather than silently becoming manifest-derived fallback.
Cancellation also throws instead of producing fallback. Existing unavailable
provenance fallback remains derived from the captured manifest. Explicit
version requests reject a manifest declaring another version via the existing
unavailable-manifest result. This is identity binding, not hash authentication.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/API runs, CI waiting,
commits or pushes. Runtime race/legacy acceptance and the full goal remain
incomplete.

### Checkpoint 251: owned loader manifests and decoded cache identities (2026-09-24)

Removed the mutable global release-root fallback from catalogLoader. Explicit
manifests use their releasePath or the legacy data root. Search, chunk, sample,
summary, locator and both paging directions snapshot their manifest before
asynchronous work. Paging cursors are copied. Manifest promise-cache values,
returned manifests and the global active manifest no longer share an object,
so caller edits cannot rewrite another request or the pending-result cache.

Decoded cache identities now include root, version, content/source hash, format
and capabilities plus artifact identifiers in an unambiguous serialized tuple.
This partitions decoded/pending caches; URL-addressed transport caches and
actual source hash verification are distinct mechanisms. Reusing a URL for
changed bytes is not made scientifically trustworthy by this cache-key change.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/API runs, CI waiting,
commits or pushes. Legacy/runtime compatibility and the full goal remain
incomplete.

### Checkpoint 252: transport validator ownership and persisted release identity (2026-09-24)

Transport validators previously received the shared in-flight ArrayBuffer.
They now receive the caller-owned copy that is returned on success; siblings
and deferred cache writes retain separate original bytes. Detached/resized
validation buffers are rejected. This moves the existing copy before validation
rather than adding a second success-path copy. Validators remain responsible
for their own format/hash contract; callback isolation is not authentication.

IndexedDB reads now require record datasetVersion to match the URL-derived
identity and enforce the existing artifact byte limit before returning a hit.
Unversioned raw ArrayBuffer records are invalidated instead of relabelled as
a release. Missing/malformed/mismatched entries fall through to network loading.
URL-derived legacy identities still cannot distinguish changing bytes at a
mutable URL; immutable release hosting and source checksums remain separate.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, IndexedDB/browser/network acceptance,
CI waiting, commits or pushes. Runtime cache/validator acceptance and the full
goal remain incomplete.

### Checkpoint 253: bounded optional persistence phases (2026-09-24)

Storage quota estimation and IndexedDB prune/write, read and invalidation
transactions previously had no deadline beyond database opening. Each optional
phase now has a 1500 ms timer. Transaction settlement clears its timer, attempts
abort for unfinished work, closes the database and ignores late cursor/read
callbacks. Reads observe the acquisition signal; cancellation aborts their
transaction and returns control to the caller cancellation check.

Acquisition no longer waits for a shared cache-preparation promise after its
signal aborts. Shared preparation continues independently under phase limits;
it is not cancelled for other callers. Quota estimate late rejections remain
observed. Existing optional-cache fallback and bounded write queue remain.
These are event-loop deadlines and JavaScript reservation policies, not hard
wall-clock/browser-storage memory guarantees; throttled/suspended contexts
and browser-internal abort completion have not been measured.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, IndexedDB/browser/device/API runs,
CI waiting, commits or pushes. Runtime cancellation/storage acceptance and
the full scientific/performance goal remain incomplete.

### Checkpoint 254: acquisition and validation deadlines (2026-09-24)

Added a 60-second acquisition deadline starting after FIFO admission; it
aborts the shared fetch/read signal and clears when acquisition settles.
The lease still remains until acquisition actually settles and all consumers
release it, so abort does not falsely release a live transport reservation.
HTTP error bodies and responses arriving after abort are cancelled.

Each consumer validation now has a separate 30-second deadline and owned
AbortController. Gzip expansion receives that signal; public validators keep
the existing single-buffer argument (some accept optional numeric arguments).
A monotonic check also rejects validation that completes after its deadline
before a delayed timer callback runs. Cancel/timeout does not invalidate a
shared cached artifact. Late validation rejection stays observed.

Arbitrary custom validators cannot be forcibly stopped, and synchronous
parsing cannot be preempted. Deadlines are event-loop policies, not measured
wall-clock/CPU limits or universal resource-release guarantees.
Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, network/browser/device runs, CI waiting,
commits or pushes. Runtime timeout/lease acceptance and the full goal remain
incomplete.

### Checkpoint 255: explicit missing-artifact fallback and bounded pointer reads (2026-09-24)

Introduced CatalogHttpError to retain transport status separately from parse,
validation, abort and timeout errors. Legacy manifest/search bucket fallbacks,
manifest-derived provenance and missing-summary behavior now require an
explicit HTTP 404. Network errors, 5xx/authorization failures, malformed JSON
and validation/timeout failures no longer trigger those substitutes or extra
legacy downloads. Existing top-level manifest unavailable handling remains.

The mutable dataset-version pointer bypasses immutable caching and previously
used unbounded response.json. Its separate no-store path now reads at most
1 MiB with a 30-second AbortController deadline, bounded stream consumption
and fatal UTF-8 decoding. Error/oversize responses cancel their bodies.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, network/browser/device runs, CI waiting,
commits or pushes. Runtime legacy/error/timeout acceptance and the full goal
remain incomplete.

### Checkpoint 256: dataset pointer path and declared identity binding (2026-09-24)

Compared the loader with preprocess-asteroids pointer publication source.
Pointers now require supported schema/mode and a nonempty bounded single
release identity. Their path must correspond to that exact release; requests
use its encoded canonical segment. Dot segments, separators, URL query/fragment
characters and control characters are rejected in release identities.

The fetched manifest must match pointer version, dataset mode and any supplied
source/content hashes. Explicit version requests use the same identity/path
guard. A successful JSON null pointer is invalid; only HTTP 404 permits the
legacy root-manifest route. Hash agreement here checks declared metadata, not
manifest-byte hashing or authenticity. Legacy path-only pointer fixtures may
need revision at the deferred verification stage; none were executed.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, network/browser/device runs, CI waiting,
commits or pushes. Runtime/legacy compatibility and the full goal remain
incomplete.

### Checkpoint 257: provenance metadata binding and visible fallback origin (2026-09-24)

Compared provenance generation with manifest fields. Fetched reports now bind
version, source, total count, mode and generation time; require explicit
parser/model/precision and valid hash declarations; and match manifest-provided
hashes, parser identity, model, precision, source timestamps and selection
policy. Mismatch fails rather than producing a replacement report.

The loader assigns recordOrigin locally, overriding any fetched claim. The
HTTP-404 manifest-derived fallback is explicitly labeled in the dataset card;
a fetched matching report is described as declaration agreement, not proof
that all source bytes were revalidated. This classification is optional in
the shared type for existing objects, so unknown origin is not fabricated.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Legacy/report compatibility, runtime acceptance and the
full scientific/performance goal remain incomplete.

### Checkpoint 258: catalog summary consistency before cache publication (2026-09-24)

Added summary binding against the captured manifest: supported schema, total
count, mode and declared source hash; exact category keys/counts and their
total; known/unknown magnitude partition (required for schema 2); finite
ordered numeric ranges and the current elliptic source-domain constraints.
Nonempty summaries require semimajor axis, eccentricity, inclination and epoch
ranges. Empty summaries cannot invent measured ranges. Validation happens
before decoded-cache publication/freezing; cache identity also includes the
expected count, mode and categories. Only missing HTTP-404 summaries remain
optional; inconsistent data fail.

The dataset card labels these as manifest/structural consistency checks, not
a full source-row rescan. No new statistics were calculated from data.
Only source reading/editing and diff whitespace checks were performed. No
tests, scientific calculations, builds/typechecks, browser/device/network runs,
CI waiting, commits or pushes. Summary/legacy runtime acceptance and the full
goal remain incomplete.

### Checkpoint 259: catalog record/domain validation across loader and scan (2026-09-24)

Compared ingestion element constraints with binary and JSON consumers. Binary
validation now includes inclination 0..180 degrees, matching the producer.
JSON shard records now require all eight finite orbital values, positive
semimajor axis/mean motion, bound elliptic eccentricity and inclination range
before decoded-cache publication or scan consumption.

Shared metadata validation checks required text/boolean fields, optional
magnitude/permanent number, canonical chunk identity, supplied chunk/row
locators and duplicate identities within a shard/sample. Loader binary/sample
decoding and scan-worker binary/JSON paths now use it. Mixed-shard samples
retain their source locators rather than equating sample offset with source
row. These checks do not authenticate metadata or establish cross-shard
identity uniqueness/whole-dataset physical accuracy.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Legacy/current format acceptance and the full goal remain
incomplete.

### Checkpoint 260: source-refined compact-index scan counts (2026-09-24)

Found scanCompactIndex used quantized eccentricity/inclination/magnitude and
derived perihelion for exact filter decisions. It now uses only Float64
semimajor axis and class for coarse shard admission, then loads admitted
source shards and evaluates all filters against source Float64 values and
metadata. Sampling uses source identity and values. This can load more shards;
no throughput improvement is claimed.

Added manifest dimensions/class-table checks, packed locator checks and
duplicate search candidate rejection. Examined source rows bind index
semimajor axis, quantized e/i/H, class and flags back to the source representation.
Shard row counts are checked, and completed index caches include declared
manifest identity. Rejected/unloaded shards are not independently revalidated;
index integrity still depends on source delivery/provenance. Progress is split
between coarse selection and source refinement.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Boundary-count and performance acceptance, cache/hash
coverage and the full goal remain incomplete.

### Checkpoint 261: checksum-map binding and compact scan source hashes (2026-09-24)

Added a shared checksum-map binder matching the existing producer/validator
content-descriptor selection and ordering. Stream rendering now binds that map
to manifest.contentSha256 before using artifact hashes. Compact scanning now
loads/binds the map, verifies index bytes (including completed-cache hits) and
verifies every loaded binary source shard against its declared SHA-256.
Source refinement yields to worker messages every 1024 rows for cancellation.

The manifest is still the trust anchor; this is no digital signature or
independent source authentication. Metadata JSON byte hashes and the legacy
non-compact scan path are not yet covered by this new scan integration. The
checksum-map read uses the bounded transport ceiling and rejects above 2 MiB
before parsing. No hashes or scientific results were computed in this turn.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Hash/cancellation/runtime acceptance and the full goal remain
incomplete.

### Checkpoint 262: source-byte metadata hashes during compact scanning (2026-09-24)

Immutable JSON helpers now accept an optional expected SHA-256. Plain JSON
verifies original bytes; gzip verifies bounded decompressed JSON bytes before
fatal UTF-8 decoding and parsing. This matches the producer hash over the
serialized source artifact, without hashing a reserialized object or the gzip
wrapper. Hashing shares the existing validation timeout and abort lifecycle.

Compact scan shard loading resolves both metadata and binary hash entries
before launching either request, then passes the metadata hash through either
delivery variant. The map remains bound to the supplied manifest, not an
independent signature. Callers omitting the optional hash retain structural
validation only; noncompact scanning and other loader paths still require a
separate coverage pass.

Only source reading/editing and diff whitespace checks were performed. No
hashes, tests, calculations, builds/typechecks, browser/device/network runs,
CI waiting, commits or pushes. Runtime integrity/cancellation acceptance and
the full scientific/performance goal remain incomplete.

### Checkpoint 263: noncompact binary scan integrity and cooperative cancellation (2026-09-24)

Noncompact binary scans now bind the checksum map when the manifest declares
contentSha256 and verify both metadata source JSON and binary bytes through
the same loaders as compact scans. Map loading is shared as a helper. A
declared but invalid identity fails instead of silently dropping verification.
Legacy manifests without content identity retain structural validation only.

The checksum resolver now returns only entries inside the content descriptor
actually bound to the manifest. Previously extra map entries could be returned
without their hashes participating in that binding. Legacy chunks/ JSON is
outside the existing producer descriptor and is not claimed hash-verified.
No immutable releases or descriptor schema were rewritten.

All scan paths now validate safe manifest dimensions before iterating.
Noncompact binary/JSON shards check their expected row counts and yield every
1024 source rows so cancellation messages can be handled within a shard.
This is source-level scheduling, not measured cancellation latency.

Only source editing/reading and diff whitespace checks were performed. A text
edit helper initially stopped before writing because its LF-only anchor did
not match the source CRLF; the edit was applied with a contextual patch. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waits,
commits or pushes. Loader-wide integrity coverage, runtime acceptance and the
full scientific/performance goal remain incomplete.

### Checkpoint 264: main-loader shard, sample and summary byte integrity (2026-09-24)

The main loader now shares a two-entry, cancellation-aware checksum-resolver
cache keyed by release/content identity. Reset clears it with the other caches.
Binary shard metadata/elements, precomputed sample metadata/elements and
summary JSON resolve content-bound hashes before loading. JSON/gzip uses source
JSON bytes; binaries verify bytes before element validation. Successful decoded
cache publication therefore follows these checks when contentSha256 is declared.
Legacy manifests without that declaration remain structurally validated only.
A missing summary declared by a content-identified manifest now fails instead
of being treated as an optional legacy absence.

Search/lookup integration remains pending: the producer emits only occupied
buckets, so absent buckets must be distinguished from missing declared files
and legacy fallback without inventing integrity evidence. Manifest/provenance
are outside the producer content descriptor and retain their separate binding
contracts. This does not establish independent authenticity or source accuracy.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Runtime/cache acceptance and the full goal remain incomplete.

### Checkpoint 265: sparse search and identity-bucket integrity (2026-09-24)

The bound checksum resolver now exposes a read-only membership query without
exposing its mutable descriptor. Main-loader search and identity lookup use it
to distinguish unlisted sparse buckets from declared files. The producer writes
only occupied buckets: an unlisted bucket returns no records, while a listed
file must load and match its source-byte hash. Declared-file HTTP errors are
not converted into legacy fallback results. Search counts must also agree
with the manifest; lookup entries must belong to their deterministic ID bucket.

Metadata validation precedes decoded-cache publication for these paths and
for legacy search fallback. Legacy manifests retain the existing HTTP-404-only
search fallback and do not acquire a false hash-verification claim. Search
cache keys include the relevant expected bucket count, not the entire counts
map. These checks do not independently prove source catalog completeness or
that every index entry resolves to an identical source record; that join still
needs a separate review.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Runtime acceptance and the full goal remain incomplete.

### Checkpoint 266: index-to-source joins fail on missing or mismatched records (2026-09-24)

Search pages previously filtered unresolved records out of their result; ID
lookup gathered wanted IDs from any loaded shard, allowing an incidental
same-ID record to substitute for the declared source. Both now resolve grouped
index entries against their own declared shard through one bounded loader.
A temporary ID-to-row map lives only for each active shard callback. Returned
records preserve index order and are bound to actual source row, supplied
locators and all shared identity/display/classification/magnitude fields. A
missing declared record or mismatch fails instead of silently shortening the
page or accepting another shard.

An ID absent from its validated lookup bucket still means no result; the code
does not fabricate catalog membership. This checks requested joins only, not
a complete cross-shard uniqueness audit or all scan-candidate joins. It keeps
the existing bounded shard concurrency; no performance measurements are claimed.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Runtime and legacy compatibility acceptance and the full
scientific/performance goal remain incomplete.

### Checkpoint 267: bind candidate identity before packing scan locators (2026-09-24)

Search locator production now joins each matched index entry to its declared
source metadata row before discarding identity into a Uint32 locator array.
Binary datasets fetch metadata only through the content-bound JSON path;
legacy JSON uses the existing shard loader. Bounded shard concurrency is
retained. Shared metadata binding checks identity and fields, duplicate row
references fail, and total dimensions/final shard length are checked. Both
scan and stream workers already consume this common producer. Missing legacy
locators still select the existing fallback rather than inventing positions.

The scan coordinator also snapshots manifest and filters before the first
await so checked candidates and the later worker request use the same input
contract. Arbitrary direct low-level worker/stream callers do not gain identity
proof from bare numeric locators. Metadata joins add reads and work; throughput
and memory effects have not been measured.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Runtime/cancellation/capacity acceptance and the full goal
remain incomplete.

### Checkpoint 268: source-precision magnitude filtering in streaming (2026-09-24)

Streaming previously used Int16 hundredth-magnitude values for both shard
admission and final matching. The producer rounds a parsed numeric source
field and does not enforce two-decimal inputs. Coarse admission now relaxes
magnitude filters along with e/i/perihelion; final and selected-body matching
use Float64 source metadata magnitudes. Each compute shard reads its plain
JSON metadata (8 MiB hard transport ceiling), verifies its bound hash/count/
record structure and extracts only magnitude/class/flag typed columns.
Examined index rows bind back to these columns before output. Selection
receipts include the metadata hash alongside the binary hash.

The planner explicitly reserves 64 MiB of metadata read/decode/parse headroom
plus ten bytes per shard row. JSON object overhead remains an estimate, not
a hard engine-heap bound. Metadata is consumed one shard at a time; the four
binary prefetch slots remain. Plain JSON source artifacts are required by this
path (transparent HTTP content encoding is acceptable). This adds network and
parsing work and lowers admitted capacity; no speed or capacity gain is claimed.
Unique nonempty class codes are now required.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Budget/compatibility/performance acceptance and the full
scientific expansion goal remain incomplete.

### Checkpoint 269: scale metadata admission with the selected stream budget (2026-09-24)

Static inspection found low-memory devices default to a 64 MiB stream budget,
which checkpoint 268 exhausted with its fixed metadata reservation alone.
The planner now derives the per-shard metadata byte ceiling from budget/32,
capped at 8 MiB, and reserves eight times that ceiling plus extracted columns.
The actual metadata reader consumes the same plan value. Oversized shards fail
rather than using unreserved bytes; smaller budgets can still have zero overall
capacity when index/pipeline costs dominate. No automatic budget increase or
claim of sufficient real-device capacity was introduced.

The UI shows the chosen per-shard ceiling and explains increasing budget for
oversized shards. Exported evidence includes that ceiling and metadata reserve,
explicitly identifying heap headroom as an estimate. Zero-capacity errors now
name index, metadata and pipeline reserves rather than blaming only the index.
This supersedes checkpoint 268 fixed 64 MiB metadata headroom.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. No plan was executed to measure capacities. Runtime memory
and throughput acceptance and the full goal remain incomplete.

### Checkpoint 270: metadata deadline and cooperative row validation (2026-09-24)

Stream metadata now has one 30-second lifecycle deadline spanning admission,
read/hash, JSON decode and typed-column extraction. Explicit elapsed-time
checks follow synchronous parsing and precede result publication; timers and
linked abort listeners are removed in finally. JSON parsing cannot be
interrupted mid-call, so this rejects late results without claiming a hard
CPU preemption bound. Existing bounded source-byte admission remains.

Extracted the existing row validator for shared use, preserving duplicate-ID
tracking across a complete shard. Streaming validates and extracts in one pass
and yields every 1024 rows (including before the first row), allowing worker
cancel messages to run. Class indices use one map instead of repeated array
searches. Failed/aborted HTTP responses now cancel their unread response body
before the artifact admission lease is released.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Deadline/cancellation timing and runtime acceptance remain
unverified; the full scientific/performance goal remains incomplete.

### Checkpoint 271: require metadata identity in stream completion and exports (2026-09-24)

The worker result already forwarded metadata hashes, but the receiving canvas
only required binary/index hashes. Source selection now requires contentSha256
and per-shard metadataSha256. Completion checks content identity against the
current manifest and requires well-formed metadata hashes before accepting
selection evidence. Existing bitmap coverage, duplicate-shard and padding
checks remain. Accepted state is assembled from explicit known fields.

Temporal-reuse exports now use schemaVersion 2, include content identity and
explicit metadata hashes, document binary/JSON path conventions and JSON byte
semantics, and describe verification as the worker binding loaded bytes to the
manifest descriptor. The calculation identifier is unchanged because the
temporal-reuse computation is unchanged. No independent signature, physical
accuracy or all-catalog coverage is inferred from these receipts.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Worker/export compatibility acceptance and the full goal
remain incomplete.

### Checkpoint 272: bind export availability to the accepted load generation (2026-09-24)

Catalog export now requires its accepted source evidence to belong to the
current load contract. A memoized owner changes with source/filter/initial
epoch/budget/mode/priority/retention/retry inputs, preventing the render before
effect cleanup from combining old evidence with new input props. Matching
source evidence assigns that owner only after completion checks pass.

Export error reporting uses a generation invalidated by replacement loads,
cancel/failure, cleanup/unmount and later exports. Both synchronous receipt/
serialization errors and rejected save promises use that guard. The current
platform download starts synchronously; this does not promise to retract an
already-triggered download. A cancelled coherent historical snapshot retains
its explicit cancelled phase and existing requested-versus-evaluated limits.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Render-transition/export runtime acceptance and the full
goal remain incomplete.

### Checkpoint 273: discard mixed-epoch restoration state on cancellation (2026-09-24)

Epoch uploads update CPU restoration attributes incrementally. Cancelling
before a coherent completed epoch previously left those mixed attributes
resident, along with source selection, even though drawing stayed invalidated.
Cancellation now discards the renderer and CPU attributes for an incoherent
epoch, clears source/epoch/selection evidence and loaded-row count, terminates
the unusable worker, and exposes the reload path. Context restoration cannot
revive that discarded load generation. Scanned-row progress remains historical.

Cancellation of a coherent completed or partial initial snapshot retains the
existing visual behavior. The change does not allocate a second complete
snapshot or claim rollback to the previous epoch. No timing or GPU-restoration
acceptance was performed.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Cancellation/restoration runtime acceptance and the full
scientific/performance goal remain incomplete.

### Checkpoint 274: detach terminated workers and guard callback ownership (2026-09-24)

The canvas now centralizes worker termination: clear the active reference,
detach message/error/decode listeners, then terminate that owned instance.
Every callback also checks that its captured worker is still the active one
and the load has not failed or discarded its snapshot. This covers failure,
incoherent cancellation, failed cancel-message delivery and effect cleanup.

The existing stopped/coherent worker remains eligible for fresh spatial view
responses; blanket rejection of all stopped-worker messages would break camera
updates on retained snapshots. Terminal loading and epoch messages still use
their existing acceptance/request guards. No assumption about platform delivery
of already-queued events is needed for callbacks to reject a detached owner.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Event-order/runtime acceptance and the full scientific and
performance goal remain incomplete.

### Checkpoint 275: surface spatial-worker failure on retained cancelled views (2026-09-24)

Previously native worker/decode errors were ignored after deliberate cancel,
although that worker still served camera selections for the retained snapshot.
Such failures now detach the worker, invalidate pending selection requests,
settle display waiting and report a separate spatial-selection failure with a
reload action. Accepted CPU/GPU source data and epoch evidence remain available;
the all-points view can still draw that coherent snapshot. Active-load failures
retain the existing full failure path. Failed cancel-message delivery uses the
same handling.

View requests are no longer posted without a worker. Export receipts include
the spatial-worker error and omit viewport counters while spatial selection
is unavailable, avoiding a false claim of zero viewport candidates. Generic
late loading error messages after deliberate cancellation remain ignored as
before; current selection errors and native worker faults are actionable.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Worker-fault/UI runtime acceptance and the full scientific/
performance goal remain incomplete.

### Checkpoint 276: distinguish unavailable display and cancelled snapshot states (2026-09-24)

The streaming view no longer labels every cancellation as a partial snapshot:
it distinguishes a retained historical snapshot from a discarded incomplete
epoch and does not certify the requested target epoch. Unavailable graphics,
restoration or a failed spatial worker show unavailable display counts rather
than zero viewport candidates, including the canvas accessible label. Viewport
explanation/work counters are hidden while unavailable. Export display evidence
now records availability and omits counters in these states.

The streaming-specific recovery message offers reload without promising that
graphics recovery will automatically revive a discarded generation. Shared
sample-renderer translations remain unchanged.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. UI/accessibility/runtime acceptance and the full goal
remain incomplete.

### Checkpoint 277: remove unbudgeted search-bucket preparation from streaming (2026-09-24)

The stream worker previously loaded decoded search buckets, grouped matching
entries and checked source metadata before entering the bounded stream path.
That staging retained object-heavy search data outside the stream plan. It
now passes the query directly into streaming; each already byte-bounded source
metadata shard extracts one query-match byte per row using the same normalized
substring semantics as catalog filtering. Both priority reservations and final
selection require that source-row match. Metadata column reservations rise
from ten to eleven bytes per row.

Optional low-level candidate locators remain an additional restriction, never
a replacement for source-query checking. The separate scan path retains its
identity-bound search locator producer. Stream loading can read more shards
without search-index acceleration; this removes the pre-stream bucket/object
staging but does not claim faster searches or a bound on total JS/browser RSS.
Avoiding unnecessary binary reads for query-empty source shards remains a
performance follow-up.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Query/capacity/throughput acceptance and the full goal remain
incomplete.

### Checkpoint 278: metadata-first binary admission for name searches (2026-09-24)

Name-query streaming now checks each bounded source metadata shard before
admitting its binary read. A shard with no matching source name/candidate
intersection skips orbital download, decode and propagation. It emits a
zero-point progress tile through the existing credit window, then yields for
cancellation. Ordinary no-query loads retain four-shard binary prefetch.
Query-matching shards currently read binaries sequentially; no throughput or
latency improvement is asserted without measurement.

Checked the source paths accepting zero-point progress: spatial invalidation
allows zero rows and the canvas acknowledges zero-row tiles without appending
GPU attributes. Source-row documentation/export limitations now distinguish
metadata-only rejections from downloaded/validated orbital rows. No independent
whole-catalog validation is implied by scan progress.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Progress/ACK/search performance acceptance and the full
scientific/performance goal remain incomplete.

### Checkpoint 279: explicit stream completion and screening evidence (2026-09-24)

Stream completion now carries admitted/completely-screened shard counts,
metadata-only rejected rows and an exhausted-versus-capacity reason. The canvas
checks integer/range consistency, requires all admitted shards to be screened
for complete results, and requires the admitted row capacity for a capacity
stop. Accepted evidence is retained with source selection and exported.

Zero-result searches can exhaust admitted shards without orbital reads; zero
admitted shards are also a valid exhausted result. Reaching capacity before
remaining shards are inspected remains conservative: it does not assert that
additional matches exist or that none remain. UI wording now states that
uncertainty and distinguishes metadata-only screening from orbital validation.
No extra scan beyond the row ceiling was added just to establish completeness.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Empty-result/capacity/protocol acceptance and the full goal
remain incomplete.

### Checkpoint 280: export source screening independently of epoch updates (2026-09-24)

Completed source screening now exposes a source/selection export even without
a temporal-reuse receipt, including zero-match results and static snapshots.
Such exports use catalog-source-screening-evidence-v1, a screening filename,
explicit examined/loaded row counts and epoch:null. Temporal receipts retain
their existing calculation identifier and filename. No block epochs are
fabricated to enable export. Owner binding still prevents old source evidence
from being combined with a replacement load.

The canvas skips epoch requests for zero loaded rows and hides the computed-
position date for an empty result. An exhausted current-load result with zero
rows explains that the catalog/filter combination has no matches and that
screening evidence is available. This is not a claim about bodies outside the
catalog or an independently checked absence in the physical sky.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Empty/static export and lifecycle acceptance and the full
scientific/performance goal remain incomplete.

### Checkpoint 281: retain rejected-shard screening provenance (2026-09-24)

Screening evidence now records every examined source shard, including zero-
output shards: metadata SHA-256, optional binary SHA-256, examined/selected row
counts and metadata-rejected versus source-screened outcome. Metadata-only
rejections explicitly carry binarySha256:null. Previously selection masks
recorded only shards contributing uploaded rows, leaving empty-result source
checks without per-shard provenance. Index-only coarse rejections remain
represented by the bound compact index and filters, not fabricated source reads.

The receiving canvas checks unique/ranged shard identities, outcomes, hash
forms and per-shard counts; sums must agree with completion counters. Every
selected bitmap must agree with its screening record counts and hashes. The
existing export includes these screening receipts. Per-shard receipt headroom
in the stream plan increases to account for the added worker/main evidence
objects; this remains an allocation estimate, not a browser-RSS bound.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Receipt/replay/runtime acceptance and the full scientific
and performance goal remain incomplete.

### Checkpoint 282: bind screening and selection order to consumed upload tiles (2026-09-24)

Stream tiles now identify their source chunk, including metadata-only zero-
point progress tiles. The receiving canvas rejects invalid/repeated chunk
identities and oversized final-shard tiles, and records each fully consumed
tile in order with selected/cumulative source and uploaded row counts. Final
screening evidence must match that observed sequence and every cumulative
count. Selected masks must follow the positive-output screening subsequence.

Previously final hashes/counts were cross-checked by chunk identity but an
equivalent-total permutation could still change locator-to-GPU-row mapping.
This adds ordering evidence at the actual tile consumer and releases temporary
upload-order bookkeeping after acceptance. It does not independently recompute
positions or certify numerical accuracy.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Protocol/upload-order/runtime acceptance and the full goal
remain incomplete.

### Checkpoint 283: compare final source masks with consumed upload masks (2026-09-24)

Each stream tile now carries its source-row bitmap, whose ascending set-bit
order defines the position-row mapping. Before upload, the canvas checks mask
length, final padding and population against the position count. On completion
it compares every selected final mask byte-for-byte with the consumed tile
mask, closing the equal-population/different-rows gap in final evidence checks.
Zero-output progress carries an all-zero source-sized mask.

Worker messages clone masks instead of transferring/detaching the producer
copy retained for final evidence. The plan reserves three simultaneous mask
copies; temporary main-thread masks are released on acceptance/cancel/failure.
This verifies consistency of source-row declarations across transport, not an
independent proof that numerical coordinates equal the declared source orbit.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Bitmap/protocol/memory acceptance and the full scientific
and performance goal remain incomplete.

### Checkpoint 284: bounded-scratch binary encoding for evidence exports (2026-09-24)

Export previously expanded every mask byte and block-epoch value into ordinary
number arrays before JSON serialization. Added catalog evidence encoders that
use 24 KiB blocks, avoid that expansion and reject individual arrays over
8 MiB. Epoch encoding writes explicit little-endian Float64 bytes and rejects
nonfinite/incomplete four-field layouts. Mask encoding preserves source bits.
The final JSON now uses schemaVersion 3 with encoding/type/length/byteLength
metadata; temporal encoding also records byte order. Calculation IDs remain
unchanged. Format migration is documented.

This reduces a specific allocation pattern by construction, not a measured
peak-memory claim. Complete Base64/JSON strings, object graphs and the download
Blob still allocate; render budgets are not total export/browser heap bounds.
Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Round-trip/consumer/memory acceptance and the full scientific
and performance goal remain incomplete.

### Checkpoint 285: audit schema consumers and correct current format documentation (2026-09-24)

Repository text searches for both calculation IDs, export filenames and array
fields found the exporter and internal typed-array paths, but no JSON importer
for these receipts. No unnecessary reader was invented. Documentation now
separates internal worker typed arrays from schema-3 JSON, explains dispatch by
schemaVersion rather than calculation ID, and states decoded length/type/order
requirements without claiming external-reader compatibility.

Corrected stale stream documentation: source metadata is read transiently for
exact name/magnitude matching; the epoch store does not retain object metadata.
Bitmap/evidence reservations match the current three-copy and per-shard policy.
The onPrepared description now matches its actual position after initial
propagation and before tile publication.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes. External format and runtime acceptance and the
full scientific/performance goal remain incomplete.

### Checkpoint 286: enforce upload-credit deadlines at acknowledgement (2026-09-24)

Upload credits previously relied only on timer callbacks, so a delayed event
loop could accept an expired ACK and cancel its not-yet-run timeout. Credits
now carry monotonic deadlines checked on ACK, publish and drain boundaries.
Expiry terminally fails the window and resolves all pending credit waits; the
producer reports the failure without unobserved rejected per-credit promises.
The timer remains as the independent wake-up path for idle waits.

A synchronous send failure now also marks the window terminal and releases
all outstanding credits rather than allowing later reuse of a broken window.
The four-credit default and network admission limits are unchanged. This is
a source-level scheduling fix, not measured deadline/throughput evidence.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Race/timer/ACK runtime acceptance and the full scientific
and performance goal remain incomplete.

### Checkpoint 287: enforce temporal acknowledgement deadlines and ownership (2026-09-24)

Epoch tile uploads and reused-block acknowledgements now check monotonic
30-second deadlines when accepting ACKs, in addition to their idle timeout
callbacks. Settlement is guarded so repeated failure/abort/ACK callbacks cannot
clear a later wait. Cancellation and synchronous send failures release the
active timer and abort listener through the same cleanup path.

Returned epoch buffers must own an exact-size ArrayBuffer, with no offset or
shared backing, at both the worker boundary and retained-store callback
boundary. Epoch-start publication is inside the epoch error handler, and
spatial coherence is enabled only after epoch-done publication succeeds.

Only source reading/editing and diff whitespace checks were performed. No
tests, calculations, builds/typechecks, browser/device/network runs, CI waiting,
commits or pushes. Deadline, cancellation and buffer-ownership runtime
acceptance and the full scientific/performance goal remain incomplete.

### Checkpoint 288: reserve selected-body capacity across source shards (2026-09-24)

Replaced per-shard-only selected-row reservation with global reservation for the
existing immutable list of up to 256 located objects. Priority shards are read
sequentially before prefetch begins; checksum-bound metadata, original Float64
elements, index/source identity and exact filters determine eligibility. Only
eligible row identities survive preflight. The first eligible entries in list
order reserve the available capacity, deduplicating repeated locators.

Ordinary rows cannot consume capacity reserved for a later shard. Upload order,
ascending bitmap membership and retained temporal block identity are preserved.
The main scan and priority preflight share one source-row binding/filter helper.
Capacity omission is now remembered across all shards, preventing a final exact
fit from incorrectly labeling earlier skipped matches as complete coverage.
Terminal checks reject unfulfilled reservations rather than export success.

The opt-in UI explains the extra priority-shard reads and potential first-visible
delay. Preflight is sequential and precedes the existing bounded prefetch window;
its reads are not counted as uploaded/screened coverage. This is a correctness
tradeoff, not a measured loading-speed improvement. Automatic admission of new
selections and runtime capacity evidence remain outstanding.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes. Priority ordering, cancellation, coverage receipts
and runtime resource acceptance remain unverified; the overall goal stays open.

### Checkpoint 289: bound priority preflight work and artifact deadline acceptance (2026-09-24)

Priority preflight now stops once a fully resolved prefix of the fixed selection
list supplies enough distinct eligible rows to fill capacity. Grouped shard
reads cannot promote later matches over unresolved earlier locators. Metadata
rejections resolve their shard without fetching its binary; duplicates do not
consume extra slots. Remaining source loading retains the normal reservation
and coverage rules. This reduces unnecessary preflight reads for small-capacity
requests by construction, without a measured latency or throughput claim.

Source inspection confirmed cancellation propagates through preflight reads and
artifact admission, with acquired leases released in finally. Artifact loading
now also checks its monotonic deadline after admission, headers, body reading
and hashing. A delayed timer cannot let an expired artifact become accepted;
late/non-success response bodies are cancelled. WebCrypto hashing itself is not
preemptible, and a busy event loop cannot provide a hard wall-clock termination
guarantee. The existing timer remains the idle-wait wake-up path.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes. Ordering, cancellation, timeout and performance
acceptance remain unverified; the full scientific/scalability goal remains open.

### Checkpoint 290: bind spatial grid scratch to admitted row capacity (2026-09-24)

Source inspection found that the spatial representative grid allocated from the
requested display ceiling even when a snapshot contained very few rows. Its
Uint32 winners and Uint8 inside-viewport flags could therefore exceed the
planner's per-admitted-row allowance. Grid capacity now uses the smaller of the
display limit and loaded row count, less the distinct visible pinned rows.
Empty snapshots allocate no winner cells. Existing focus/selection priority,
source-order output and cooperative cancellation remain in the same path.

This changes grid resolution when the requested display limit exceeds available
rows; representative coverage remains a visual approximation, not guaranteed
display of every loaded body or a density estimate. Source positions and
scientific propagation are unchanged. Typed-array bounds follow from source
allocation sizes; no measured browser heap, driver memory or frame-rate claim
is made.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes. Runtime selection, resource and scientific
acceptance remain unverified; the full objective remains incomplete.

### Checkpoint 291: reconcile capacity measurement with source screening (2026-09-24)

Source inspection found no additional cancellation-resource defect requiring a
change in the inspected canvas/transfer paths. The static application capacity
script, however, still rejected all metadata requests even though exact source
screening now requires them. It now requires one distinct metadata shard per
required source shard and still rejects sample/search/lookup hydration in this
unfiltered, no-selection benchmark. Examined rows are bounded between uploaded
rows and the admitted shard extent, allowing capacity-boundary screening.

Report schema 4 fingerprints dist/index.html and the built asset tree separately
from source files. It explicitly leaves source/build equivalence unestablished;
a source hash alone must not identify the JavaScript actually served. The
script's existing local/headless/static-snapshot limitations remain. It still
does not establish total process memory, cancellation latency, continuous epoch
performance, real network throughput or native/device capacity.

Only source/document reading/editing and diff whitespace checks were performed.
The benchmark was not run. No tests, calculations, builds/typechecks,
browser/device/network runs, CI waiting, commits or pushes were performed.
Measurement execution and the full scientific/scalability objective remain
incomplete.

### Checkpoint 292: label runtime heap observations and missing cancellation evidence (2026-09-24)

The static application capacity script now aggregates Chromium's reported
performance.memory values at start/end and animation callbacks at least 250 ms
apart. Reports include sample count/times, first/last used heap, observed maxima
for used/total heap and the reported heap limit. Unsupported observations keep
null values and unavailable status rather than implying zero memory usage.
Aggregation is constant-size and does not retain an additional sample history.

The metric is explicitly a possibly shared/incomplete JavaScript heap estimate,
not process RSS, full Worker memory, GPU/driver memory or a hard peak bound.
No garbage collection is forced; sampling can miss peaks and instrumentation
contributes overhead. Start/end samples exclude the later screenshot/readPixels
artifact capture. The report now explicitly marks cancellation unmeasured;
completion of this static run must not be interpreted as cancellation evidence.

Only source/document reading/editing and diff whitespace checks were performed.
No benchmark, tests, calculations, builds/typechecks, browser/device/network
runs, CI waiting, commits or pushes were performed. Runtime memory and
cancellation acceptance and the full scientific/scalability goal remain open.

### Checkpoint 293: separate cancellation observations in the capacity harness (2026-09-24)

Added an opt-in --cancel-probe path to the existing static application benchmark.
After its completed snapshot and screenshot, it refreshes the same workspace
and clicks the real cancel control on the first received source tile, before
that tile's scheduled GPU upload. The UI control has a stable test identifier.
The probe separately records request-to-UI and request-to-worker-cancelled
latencies using the browser clock; it does not conflate Node/browser clocks.

Browser request finished/failed events and server response closures track
observed artifact activity. After the worker terminal receipt, a bounded
one-second quiet interval must have zero observed browser/server requests and
no new requests. The reported transport interval starts at Node refresh
dispatch, not at the browser cancel timestamp. Uploaded rows and attribute
bytes must remain unchanged; queued post-request tiles are recorded separately.
The completed-run server counters are snapshotted before this second workload.

This is one warm-page local-HTTP initial-load scenario. A cancelled source task
can leave its worker alive for spatial browsing; neither worker termination nor
memory reclamation is inferred. Epoch updates, source-search cancellation,
remote transport and device behavior still need distinct evidence.

Only source/document reading/editing and diff whitespace checks were performed.
The probe was not executed. No tests, benchmarks, calculations, builds/typechecks,
browser/device/network runs, CI waiting, commits or pushes were performed.
Cancellation acceptance and the full scientific/scalability objective remain
incomplete.

### Checkpoint 294: preserve application error semantics during measurement (2026-09-24)

Source inspection confirmed that cancellation during an incoherent epoch
discards the partial CPU/GPU snapshot and terminates its worker; it cannot
produce the same cooperative source-load cancelled receipt as the initial-load
probe. No unnecessary production acknowledgement was added. The probe now
observes Worker execution/decode errors and terminate calls explicitly. Its
initial-load scenario rejects forced termination both before the receipt and
during the bounded quiet observation instead of silently timing out or claiming
cooperative completion.

The harness previously called WebGL getError after every instrumented operation,
consuming errors before the renderer's own checks. It now observes application
getError calls and returns their original value unchanged. Allocation/upload
failures therefore remain visible to application cleanup. The report states
that errors never read by the application are outside this observation scope.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, benchmarks, calculations, builds/typechecks, browser/device/network
runs, CI waiting, commits or pushes were performed. Epoch-cancellation runtime
evidence, measurement acceptance and the full objective remain incomplete.

### Checkpoint 295: retain failed capacity-run diagnostics without rerunning work (2026-09-24)

The capacity harness now writes a separate exclusive-create failure JSON for
runtime exceptions after server startup. It records the failing stage, bounded
error/stack text, recent page errors and artifact requests, pending browser
requests, server activity, selected scenario and built-asset fingerprints.
These are already-observed Node-side values; failure handling performs no new
browser query or screenshot that could stall on an unresponsive renderer.
The original error is rethrown, keeping failure distinct from an observed result.

Output/report/screenshot collisions are rejected before runtime work, and the
screenshot is written with exclusive creation rather than overwrite semantics.
Server cleanup is attempted even if browser close rejects. Diagnostic-write
errors do not replace the original runtime error. Input/source/build-file errors
before runtime setup remain ordinary CLI failures outside this diagnostic path.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, benchmarks, calculations, builds/typechecks, browser/device/network
runs, CI waiting, commits or pushes were performed. Failure-path execution,
capacity/scientific acceptance and the complete objective remain unverified.

### Checkpoint 296: expose nonlinear endpoint shape without Gaussian reinterpretation (2026-09-24)

The nonlinear ensemble result now includes XY/XZ/YZ endpoint scatter projections
alongside its existing original-state table and source-bearing export. Offsets
subtract the first valid endpoint in Float64 AU before converting to kilometres;
all planes share one symmetric physical scale. Original draw indices survive
failed rows and appear in point titles. The reference is explicitly neither the
nominal trajectory nor the sample mean. At most 128 existing endpoint records
are inspected; no new propagation, sampling or covariance fit is introduced.

Failed draws are counted and excluded without imputation/resampling. Overlap,
the all-coincident display-scale convention and the absence of probability or
confidence interpretation are visible. Malformed/nonfinite display geometry
shows unavailable rather than emitting invalid SVG coordinates. Existing export
still contains the full endpoints, validity flags and failures underlying the
display; event distributions remain an independent unfinished capability.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Rendered accessibility/visual and
scientific acceptance and the full objective remain unverified.

### Checkpoint 297: retain native ensemble covariance and per-draw work evidence (2026-09-24)

Android and iOS ensemble decoders already validated the full six-dimensional
sample covariance and each draw's force-evaluation count, but discarded these
fields from their presentation models. Both now retain and display all 36
covariance entries with row/column units and the validated n-1 divisor, plus
individual evaluation counts for successful and failed draws. Android exposes
the matrix through a deep-copy accessor; iOS retains value-semantic arrays.

The no-moments rule for failed or insufficient draws remains: missing covariance
is not replaced by zeros or successful-only statistics. Bilingual readouts label
finite-batch descriptive statistics rather than confidence/physical error
bounds. Source hashes, original draw indices and original-response exports stay
available. Native scatter visualization and event distributions remain separate
unfinished capabilities; this change does not imply browser/native numerical
equivalence or device acceptance.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native runtime and scientific
acceptance and the full objective remain unverified.

### Checkpoint 298: expose native adopted-force provenance (2026-09-24)

Android and iOS covariance/ensemble results now retain and display a summary
from the already-validated force receipt: model identifier, kernel/GM source
URLs and hashes, integration frame/origin/time scale, and all eleven force-body
GM values and exclusion distances. SBDB input hashes are labeled separately.
Original-response exports retain the complete force parameters unchanged.

Bilingual explanations distinguish receipt consistency from independent source
authentication and integration coordinates from heliocentric endpoints.
Exclusion distances are not labeled continuous collision detection. Optional
force choices appear in the validated model identifier; this presentation
change does not create new source data, numerical results or accuracy evidence.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native display/source acceptance and
the full scientific/scalability objective remain unverified.

### Checkpoint 299: expose native optional-force parameters and limitations (2026-09-24)

The shared Android/iOS adopted-force summary now includes each enabled optional
force's validated receipt values. Radial SRP shows illumination policy, pressure
at one AU in N/m², effective area in m², mass in kg, dimensionless reflectivity
coefficient and explicit parameter source. Solar 1PN shows its model identifier,
speed of light in km/s, maximum expansion parameter and approximation statement.
Disabled optional forces are explicitly marked absent. Force-receipt limitations
are retained in the readout instead of being accessible only through JSON export.

These fields are copied from the request-bound validated receipt, with no
default parameters inferred and no re-evaluation of the force law. They apply
to both covariance and supplied-offset ensemble results through the existing
shared presentation path. Source/build/device acceptance remains distinct from
receipt consistency; no physical-accuracy claim is introduced.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native optional-force display and
scientific acceptance and the complete objective remain unverified.

### Checkpoint 300: share adopted-force evidence across Web experiment results (2026-09-24)

Added a shared read-only force-model details view to the Web dynamics laboratory,
covariance propagation and nonlinear ensemble results. It renders the completed
receipt's model, integration frame/origin/time scale, relative source window,
kernel/GM identities, all force-body parameters, optional solar 1PN/SRP values,
references and limitations. The component uses type-only engine imports and
does not fetch sources, evaluate forces or read editable request controls.

Bilingual labels separate physical units, optional-force absence and declared
parameter sources. The view distinguishes integration/output frames and states
that exclusion cutoffs and weak-field expansion guards are not accuracy bounds.
It complements the complete source-bearing export; it does not establish new
coverage, physical accuracy or full-fit-model propagation.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Web rendering, type compatibility,
scientific acceptance and the full objective remain unverified.

### Checkpoint 301: preserve split TDB endpoint semantics in Web readouts (2026-09-24)

Dynamics, covariance propagation and nonlinear ensemble endpoint views now use
one split-time readout: reference Julian date in TDB and signed elapsed TDB
seconds are separately labeled. No large-Julian-date addition, UTC conversion
or calendar inference is performed. Negative offsets explicitly precede the
reference epoch, and nonfinite values render unavailable rather than a date.
The report/export values remain unchanged.

Source inspection confirmed the dynamics state table is J2000/SSB in km and
km/s, its trajectory projection is Sun-relative J2000, and covariance/ensemble
tables are heliocentric J2000 ecliptic in AU and AU/day. The shared force panel
continues to identify integration coordinates separately. This is a display
contract audit, not numerical verification of the frame/time transformations.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Rendered semantics, scientific
acceptance and the full objective remain unverified.

### Checkpoint 302: bind displayed Web force evidence before accepting a result (2026-09-24)

The Web dynamics receipt boundary now checks force-state units and the pinned
ephemeris identity, nonempty limitation strings, every solar 1PN constant and
reference, and the SRP formulation/reference constants. Adopted SRP parameters
continue to be compared against the submitted source payload. Every mass must
carry a positive finite GM and the expected pinned GM-source identity, in
addition to its existing NAIF/order/exclusion checks.

These checks occur before the receipt reaches any of the three result panels
or exports, closing gaps exposed by the new force-evidence presentation. The
original bytes/Base64/payload binding, request epoch and force-choice checks
remain. This is consistency validation, not independent recomputation of GM
values from source bytes or proof of numerical/physical accuracy.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Receipt-boundary execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 303: enforce scientific-job deadlines through receipt acceptance (2026-09-24)

Dynamics and occultation job wrappers now establish monotonic deadlines on
entry, including initial parsing, source encoding and worker startup. Remaining
time determines the wake-up timer. Result arrival, completed source hashing and
completed synchronous receipt binding each recheck expiry before publishing a
successful result. Pre-dispatch expiry throws and releases an already-created
worker; dynamics termination is now explicitly idempotent.

This closes delayed-timer acceptance races without claiming hard preemption of
main-thread JSON work or WebCrypto. Existing explicit cancellation suppresses
late callbacks. Bounds remain 300 seconds for dynamics and 30 for occultations;
these are resource/acceptance policies, not scientific accuracy guarantees.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Timer/cancellation execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 304: reject late scientific file-read completion (2026-09-24)

The shared bounded FileReader wrapper now checks a monotonic 25-second deadline
both before starting the read and at onload acceptance. Its timer uses the
remaining interval, so a delayed load callback cannot erase an expired read
deadline. Existing settle-once cleanup still removes listeners, cancels active
reads and clears the timer for success, failure and cancellation.

The helper is used by covariance, dynamics, conic and occultation imports.
Inspected covariance-import generation guards clear the old input/result before
replacement and suppress stale post-hash publication. No additional change was
needed there. The read timeout does not cover subsequent parsing, hashing or
scientific conversion and is not a hard preemption guarantee.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. FileReader scheduling/cancellation
acceptance and the full scientific/scalability objective remain unverified.

### Checkpoint 305: reject malformed additional covariance-axis units (2026-09-24)

The Web and Go SBDB parsers now require non-null additional parameter units to
be nonempty strings. Previously their optional descriptive-text helpers silently
converted numeric, structured or blank units into null, which downstream
covariance readouts could present as dimensionless. Missing/null units retain
the existing convention; valid strings retain the existing trimming behavior.
Canonical orbital-element unit requirements and matrix values are unchanged.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Parser execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 306: bind native covariance units strictly to original input (2026-09-24)

Android and iOS covariance receipt validation now reject non-string or blank
additional-parameter units in the original SBDB input. Missing/null units still
map to null, and valid strings retain trimming, matching the Web/Go parser
contract. Previously the native validators also used permissive descriptive
metadata helpers, allowing malformed original units to match a null receipt.
Existing exact comparisons bind source and Cartesian output units to these
validated input axes before presentation or raw-response export.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 307: distinguish missing units from dimensionless source axes (2026-09-24)

Web coordinate standard-deviation readouts now label missing extra-parameter
units as unspecified, matching Android/iOS instead of displaying an inferred
dimensionless unit. An expandable source-axis table exposes nominal values,
formal marginal standard deviations and their separate units in the original
covariance order. The canonical eccentricity is explicitly dimensionless;
periapsis epoch nominal values use JD TDB while their deviations use days.
Additional axes with null units remain unspecified. Display formatting does not
alter source or export values and is explicitly not a physical accuracy claim.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Rendering and the full scientific/
scalability objective remain unverified.

### Checkpoint 308: reject late native covariance imports (2026-09-24)

Android/iOS covariance imports now establish monotonic 25-second deadlines and
recheck them on the UI thread before accepting file bytes. Delayed timeout
callbacks can no longer allow expired imports to become the active source.
Timeout rejection uses the existing cancellation/generation cleanup; previous
sources remain cleared. Timers still wake idle imports. This bounds acceptance,
not hard preemption of provider reads or subsequent scientific computation.

Source inspection also confirmed that Web/Go propagation rejects additional
source axes rather than dropping them, and native receipt validation checks the
six-axis restriction. Matched propagation of additional force parameters remains
unfinished; these guards are not evidence of that feature's completion.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native scheduling and the full
scientific/scalability objective remain unverified.

### Checkpoint 309: preflight native propagation source axes and epoch (2026-09-24)

Android/iOS request encoding now parses the bounded original SBDB input before
upload, rejects anything other than six unique canonical orbital covariance
axes, and checks the requested epoch against the source covariance epoch.
Both covariance and ensemble request paths share the preflight. Axis ordering
is preserved and no source parameters are removed. Cancellation is checked
around parsing; source bytes and subsequent backend/receipt validation remain
unchanged. This is an early admission check, not a full covariance audit or a
matched-force implementation for additional parameters.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native request execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 310: enforce native scientific request acceptance deadlines (2026-09-24)

Android's shared stellar/orbit service now checks a monotonic deadline at its
existing cancellation checkpoints, including before/after encoding, transport
and receipt decoding. Delayed scheduled timeout callbacks cannot by themselves
permit late success. The scheduled disconnect remains in place for blocked IO;
per-request deadline state is cleared during existing cleanup.

iOS stellar motion, observer, covariance, propagation and ensemble calls now
start a shared 25-second acceptance interval before encoding, check it after
transport and after receipt validation, and give the transport only the remaining
interval. Actor admission still prevents overlapping requests from replacing
the active deadline. Deferred cleanup clears it on success and failure.
Neither platform claims to forcibly interrupt synchronous JSON/receipt work.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native deadline execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 311: cover native ground-contact request acceptance (2026-09-24)

Android ground-contact requests now establish a monotonic 25-second deadline
before encoding and enforce it at existing IO checkpoints and around receipt
decoding. A single-instance admission guard prevents overlapping calls from
replacing the active connection/deadline. Encoding/open failures now share the
same cleanup, including nullable connection release and deadline reset. The
existing UI timer still interrupts/closes requests; these checks do not forcibly
preempt synchronous parsing or blocked provider IO.

iOS ground-contact requests use a per-invocation monotonic deadline spanning
input validation, encoding, transfer and receipt decoding. Transport receives
only the remaining interval, and expired results are rejected before return.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native contact execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 312: bind ground-contact bracket representations (2026-09-24)

Web overlap-window validation now matches both UTC bracket endpoints to the
referenced contact, as Android/iOS already do. All three clients also require
the reported contact/edge elapsed time to equal the backend model's bracket
midpoint, sampled-zero contacts to have zero-width numeric brackets, and UTC
labels at coincident numeric endpoints to match. These are source-checked
receipt consistency rules from contacts.go, not independent UTC/TAI conversion
or evidence that numerical brackets bound physical timing uncertainty.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Cross-platform receipt execution
and the full scientific/scalability objective remain unverified.

### Checkpoint 313: align native contact station-height admission (2026-09-24)

Android/iOS ground-contact requests now reject station heights outside the
backend's supported WGS84 ellipsoidal range of -1000 to 100000 metres before
upload. Both native field labels expose that range. Values are never clamped or
converted to an assumed sea-level height.

Source review of taiWindow confirmed SOFA UTC/TAI conversion, microsecond output
formatting and rounded elapsed duration. Raw request/response UTC string equality
would incorrectly reject supported sub-microsecond inputs; no such comparison
was added. Independent leap-aware epoch verification remains unimplemented.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Native input execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 314: enforce Web observation/stellar acceptance deadlines (2026-09-24)

Source inspection found matching station/weather admission ranges across Web,
Android, iOS and the backend. Web ground-payload, stellar-motion and stellar-
observer loaders now additionally enforce monotonic 25-second deadlines after
encoding, response headers, body parsing and result validation. Timers use the
remaining interval and still abort pending fetches. Late successful validation
can no longer bypass expiry merely because its timer callback was delayed.

Stellar-motion requests are copied before encoding and asynchronous validation,
so caller mutation cannot replace the source/epoch used to bind a returned
receipt. Its request fields are scalar strings/numbers; observer requests already
copy their nested station/weather fields. These changes do not preempt
synchronous work or establish scientific accuracy.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Web request execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 315: snapshot ground requests and bound overlap validation work (2026-09-24)

Ground observation, visibility and contact loader entrypoints now copy request
fields before asynchronous work. Copies include station fields, observation
body identifiers and optional atmosphere. Both wire serialization and response
validation close over that same snapshot, avoiding caller mutation of the
expected station, body order or search window while a request is pending.

Visibility response validation now scans sorted missing intervals once while
checking sorted visible intervals. The prior nested comparison could visit
every window/gap pair. Existing independent order/disjointness validation makes
the advancing-index check linear in the two list lengths; touching endpoints
remain allowed and positive overlaps remain rejected. No measured throughput
or frame-time improvement is claimed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Request snapshot behavior, interval
validation execution and the full scientific/scalability objective remain unverified.

### Checkpoint 316: bind visibility coverage to source identities and intervals (2026-09-24)

Web visibility validation now rejects duplicate/unrelated source body IDs and
requires Earth, Sun and the requested target identities for sampled-complete
results. Requested aliases are preserved, matching backend session evidence;
partial/unavailable results may retain a subset. Source counts alone no longer
stand in for the required identities.

UTC interval ordering and crossing bracket containment are checked without
ordinary-calendar conversion, retaining leap-second labels and equal rounded
microsecond endpoints. Zero-width crossing brackets require identical UTC
labels. The unavailable status must match the backend's summed missing-duration
criterion. These checks establish receipt consistency, not continuous coverage
or independent UTC/TAI correctness.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Visibility validation execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 317: scan backend visibility gap boundaries linearly (2026-09-24)

The visibility backend now annotates window edges with two advancing cursors
over the ordered missing intervals instead of scanning every gap for every
window. Separate start/end cursors preserve exact endpoint matching, adjacent
gaps with differing reasons, and existing coverage-gap precedence over search
boundary labels. Sampling already appends ordered disjoint intervals; no new
sorting, approximate comparisons or maps were introduced.

Missing-duration aggregation and each window annotation now check cancellation.
The traversal is linear in window plus gap counts with constant cursor storage;
runtime improvement and cancellation latency have not been measured.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Backend interval execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 318: reuse contact geometry within each sampling interval (2026-09-24)

Ground-contact internal/external boundary refinement now shares a cache keyed
by exact elapsed sample time within the current grid interval. Successful finite
geometry is cached only after the post-evaluation cancellation check. Cache
hits still check cancellation and do not spend a second evaluation credit.
The cache is cleared at each new grid interval; carried endpoint geometry and
the source-identity session retain their existing semantics. Cache storage does
not accumulate with search duration, and no interpolated states are introduced.

The existing 8192 budget continues to count actual evaluator calls. Searches
previously exhausting it through duplicate refinement calls may now progress
further under the same limit. Sampling cadence, root tolerance and contact
count bounds are unchanged. No timing or memory benchmark was run.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Cache/budget execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 319: retain only the active visibility sample interval (2026-09-24)

Visibility sampling now clears earlier refinement samples when advancing to a
new grid interval, retaining only the shared endpoint if cached. Missing-data
endpoint records are carried exactly like available records, preserving reuse
and gap evidence across every early-continue path. Within-interval target/Sun
refinement and midpoint checks continue sharing exact sample-time entries.
The cache no longer accumulates all samples over the search duration.

Successful evaluator returns also recheck context cancellation before caching
or exposing the sample. Actual evaluator-call counting, cadence, numerical
tolerances and unresolved-substep behavior are unchanged. No memory or runtime
measurement was performed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Visibility cache execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 320: account for retained state-tile cache storage (2026-09-24)

State-tile cache admission/eviction now charges retained byte-slice capacity,
cache-key and ETag lengths, plus a conservative fixed 256-byte entry/list/map
allowance. Previously only payload length and ETag length were charged, omitting
keys, retained spare capacity and bookkeeping. Existing replacement/eviction
paths use this weight; a single over-budget entry remains uncached.

Source review confirmed the separate catalog evaluation cache namespaces final
states by exact Float64 epoch and immutable catalog identity. Its API comment
now distinguishes shared immutable final values from epoch-local resolver
scratch. Cache byte counters remain accounting estimates, not measured heap/RSS
limits; no memory or throughput result is claimed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Cache accounting execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 321: charge retained state-plan response storage (2026-09-24)

State-plan cache weights now include row/tile/field-mask backing capacities,
response header and field-mask text, and cache-key/entry overhead. Visible row
metadata strings and separately allocated final states retain their existing
charges without double-counting the fixed row allowance. Source inspection
confirmed cached plans already clear catalog/inventory object pointers after
resolution; that release path is unchanged.

Weights remain conservative estimates, including possible shared-string
overcounting; they do not measure heap/RSS. Plans exceeding the configured
weight remain uncached under the existing admission behavior. No allocation
profile or cache performance measurement was performed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Plan-cache execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 322: reject state plans that cannot enter the cache (2026-09-24)

State-plan cache insertion now reports admission success. Plan creation rejects
nil/over-budget admission with HTTP 413 plan_too_large instead of returning a
successful plan ID whose tiles immediately fail plan_not_found. The error asks
for fewer bodies because the resident plan contains all rows regardless of tile
size. Existing pre-computation response-budget checks remain in place, and
cancellation is rechecked before final cache admission.

Ordinary TTL expiry and later LRU eviction still require replanning; this change
does not guarantee a lease or pin plans across subsequent requests. Oversized
entries do not evict existing cache contents.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Admission/error-path execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 323: retain state-window plan failure diagnostics (2026-09-24)

State-window plan failures now carry an error code, status and epoch index in
their terminal error frame. Build-budget errors retain their plan_too_large/413
identity, queue errors report overload, and cancellation retains its category.
These are frame fields after streaming headers, not a changed HTTP status.
No completion certificate follows an error.

The Web reader recognizes error metadata and reports bounded diagnostics instead
of replacing the server cause with an epoch-sequence error. Older message-only
frames remain failures with a fallback category. Request options and the body/
epoch arrays are snapshotted before awaits so incremental verification retains
the original wire identity. Binary-tile encoding failures still truncate the
stream, which remains incomplete without its terminal certificate.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Streaming error execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 324: bound active state-window frame reads (2026-09-24)

The Web state-window reader now gives each active frame a monotonic 30-second
deadline spanning its length prefix and payload. Empty chunks and incremental
payload delivery cannot restart the allowance. Timer rejection wakes a stalled
read, and monotonic checks reject late delivery even if the timer was delayed.
The terminal EOF check has its own bounded read. Consumer pauses at yielded
epochs are outside these per-frame intervals; this is not a total-history limit.

Existing cancellation cleanup closes the reader before returning admission.
A nested finally now releases the admission permit even if lock-release cleanup
throws. This does not claim hard preemption of arbitrary custom stream cancel
implementations, nor add a deadline to the preceding manifest/header fetch.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Stream deadlines/resource cleanup
and the full scientific/scalability objective remain unverified.

### Checkpoint 325: bound state-window manifest and header setup (2026-09-24)

The Web state-window generator now owns a cancellation controller linked to its
caller for the full generator lifetime. Manifest fetch/JSON validation and stream
header acquisition each have a 30-second monotonic acceptance deadline plus an
abort timer. Late headers retain response ownership for cleanup before rejection.
Final generator cleanup aborts the owned transport and removes the caller link.

These setup intervals are separate from per-frame reads and do not time out
consumer pauses between epochs or the admission queue. Standard fetch/body
operations observe the abort signal; arbitrary custom fetch implementations that
ignore abort are not forcibly preempted. No networking or timing experiment was
performed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Setup deadline execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 326: preserve admission cleanup on message-send failures (2026-09-24)

Worker admission cancellation now rejects its local waiter even when sending
the cancellation message throws. Disposal continues through all queued waiters
despite individual send failures and still clears/closes the endpoint. The main
endpoint catches rejection-send failures after the request has left the pool,
avoiding an unhandled asynchronous rejection.

Worker responses must now have a positive safe ID, a recognized granted/rejected
type and a string rejection reason before altering waiting state. Exhausted IDs
fail locally instead of sending an unsafe identifier the host would ignore.
These changes do not prove remote permit release on a failed channel: existing
owner teardown must still terminate the worker and detach its host endpoint.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Admission lifecycle execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 327: retire workers on transport/dispatch failure (2026-09-24)

Historical trajectory compute dispatch now catches postMessage failures,
terminates the worker before detaching admission, clears its owner references
and publishes a scoped failure instead of leaving computing state active.
One owner stop closure is shared by failure and effect cleanup; deferred failure
publication does not overwrite a newly installed worker's state.

Both current-state and historical trajectory clients now handle messageerror
as a terminal worker failure. Current-state pending work is rejected; historical
results are cleared. Existing normal teardown order already terminated workers
before returning host permits and remains unchanged.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Worker lifecycle execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 328: bind trajectory worker scope and response sequence (2026-09-24)

Historical worker lifetime now includes both expected catalog/inventory hashes
in its scope identity, independently of caller-provided sourceKey. A changed
expected source snapshot therefore retires the old worker and admission before
new work. Responses require positive safe request IDs no newer than the latest
dispatch, recognized message types, finite progress in [0,1], and string errors.
Already-settled request messages cannot republish a result or revive progress.

The intentional one-running/one-latest queue remains: a completed intermediate
epoch can still be displayed while a newer epoch is pending, avoiding starvation
under clock ticks. Deferred dispatch-failure updates additionally check request
identity before publication. No interactive behavior was exercised.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Response sequencing execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 329: preserve trajectory grid endpoints and total deadline (2026-09-24)

Trajectory sampling now uses the audited start/end UTC Julian dates directly
for the first/last TDB conversion instead of reconstructing the final UTC date
by subtracting and re-adding the history span. Intermediate samples retain the
existing grid rule and state-window verification binds every returned epoch.
This removes an avoidable endpoint-rounding discrepancy, not the inherent
precision limits of a single Float64 Julian date.

The existing 120-second trajectory policy now uses a monotonic entry deadline,
checks grid construction and final packing before accepting success, and retains
per-epoch checks. Timers/listeners are registered after synchronous allocations
and immediately before their cleanup scope, avoiding leaks on allocation failure.
Synchronous scientific work is still not forcibly preempted.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Grid/deadline execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 330: charge retained trajectory audit identities and gaps (2026-09-24)

Trajectory audit text accounting now includes its reference/body/backend ID
lists, manifest identities and each retained first-gap record, including the
missing reason. Gap records and plan hashes are charged before insertion.
Sources, tile receipts and source transitions retain their existing charges.
A shared TextEncoder replaces repeated encoder construction during accounting.

The 8 MiB policy remains a retained audit-text budget, not an exact whole-export
size or JavaScript heap limit. Typed buffers are separately constrained by
body/sample ceilings; temporary serialization and runtime object overhead are
not certified by this counter. No allocation or throughput measurement was run.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Audit-budget execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 331: freeze packed trajectory identity and enforce numeric layout (2026-09-24)

Trajectory accumulators now snapshot body IDs on construction and use them for
all retained dimensions and final identity lists. Caller mutation of the body
array cannot rename/reorder completed coordinate rows. Finalization skips
self-copy operations for rows already at their destination, while preserving
existing compaction of incomplete rows and aligned discontinuity flags.

Display-view construction explicitly requires Uint32 offsets, Float64 coordinates
and the existing 320-body/600-sample limits, including each row's end bound.
It still returns subarray views rather than unpacking/copying point objects.
These layout checks do not independently validate physical coordinates.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Packing/view execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 332: validate trajectory discontinuity and unavailable identities (2026-09-24)

Packed trajectory views now reject nonbinary break flags and a break before a
row's first sample. The unavailable-body list must contain distinct known
identities disjoint from available rows, with the combined count inside the
existing 320-body limit. Metadata maps may include bodies outside the requested
subset, so map-wide completeness is deliberately not inferred.

Source review confirmed both 2D and 3D rendering paths consume breakBefore when
connecting samples. These changes validate representation consistency; they do
not independently verify source transitions or prove continuous ephemerides.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Discontinuity/layout execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 333: handle local trajectory worker failures coherently (2026-09-24)

The local trajectory hook now catches Worker construction, compute dispatch and
packed-result validation failures, handles messageerror, and clears failed
trajectory/unavailable/progress state. Request-local active/settled guards prevent
late progress or duplicate terminal messages from reviving completed work, and
the queued computing-state update cannot overwrite a synchronous dispatch failure.

Failed cancellation sends terminate the owned worker. Runtime/decoding failures
also discard a worker that had already delivered a valid result, so a subsequent
request cannot reuse the failed instance. Valid idle workers still retain kernel
buffers for later clock updates. No browser lifecycle was exercised.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Local worker failure execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 334: make local trajectory yields sensitive to elapsed work (2026-09-24)

The local trajectory worker now yields after an epoch when its work slice has
used at least 8 ms, in addition to the existing twelve-epoch cadence. This is a
cooperative scheduling threshold, not a bound on one synchronous epoch or actual
cancellation latency. A final yield always processes queued cancellation before
packing and sending success.

Finite window/dimension admission happens before kernel loading, and request
ownership is rechecked immediately after it. Sample buffers are allocated only
after that check, so obsolete requests waiting for shared kernel loading do not
retain full trajectory arrays. Shared kernel loads themselves remain reusable,
not forcibly aborted. The final epoch uses the requested endpoint directly and
progress counts completed samples.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Cooperative scheduling execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 335: close shared kernel loading resource paths (2026-09-24)

Kernel loading now validates the manifest size before requesting bytes. A scoped
abort timer and monotonic 60-second deadline cover response reading, hashing and
SPK parsing; parsed kernels are registered only after the final deadline check.
This rejects expired results but does not interrupt synchronous parsing or the
crypto implementation. Existing four-slot loading and per-file deduplication
remain in place; installed kernels still have no aggregate eviction budget.

Response ownership and stream allocation now sit inside the cleanup scope.
Incomplete responses are aborted/canceled, cancellation failures preserve the
original error, reader locks are released and the timer is cleared. This has not
been exercised against real or synthetic streams.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, calculations, builds/typechecks, browser/device/network runs, CI
waiting, commits or pushes were performed. Resource cleanup execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 336: bound retained and in-flight kernel buffers (2026-09-24)

The kernel store now admits at most 512 MiB of raw installed buffers plus active
load reservations per JavaScript realm. Each load reserves its full manifest
size before fetching; success transfers that reservation into retained bytes
without an asynchronous gap, and failure releases it after stream cleanup.
Queued loads recheck whether another caller already installed the same identity.
Direct installation is also budgeted and rejects replacement identities because
existing resolvers can retain the previous buffer; replacing a map entry would
not prove the old allocation was reclaimed.

This is a fail-closed raw-buffer admission policy, not automatic eviction or a
whole-application heap limit. SPK metadata, hashing/transport scratch, caller-owned
buffers and other worker realms require separate accounting. Existing consumers
hold kernel references, so safe lease-based reclamation and coordinated realm
budgets remain unfinished. No capacity or performance improvement is claimed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. Budget execution, selected-profile capacity and the full
scientific/scalability objective remain unverified.

### Checkpoint 337: close event-worker failure ownership paths (2026-09-24)

The event analysis hook now handles cache-key validation, parameter snapshot,
Worker construction, dispatch, runtime and message-decoding failures. Active
failures terminate the owned worker, clear progress and publish an error state;
request/worker ownership guards reject callbacks from terminated runs. Progress
requires a finite value in [0,1], terminal results require an events array and
unknown responses fail explicitly. This is envelope checking, not scientific
validation of every returned event. Requests use the stored parameter snapshot.

Source inspection confirms event workers terminate on normal terminal responses,
cancel and unmount. Cross-realm kernel admission remains unfinished; this change
does not claim a shared memory budget or measured reclamation.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. Worker lifecycle behavior and the full objective remain unverified.

### Checkpoint 338: make mission-grid execution cancellable from its UI (2026-09-24)

The running mission-grid button now offers Cancel analysis using the existing
bilingual label. Cancellation invalidates request ownership, terminates the
worker and returns the control to idle. Unmount also invalidates ownership and
clears the worker reference. Worker construction, dispatch, runtime and message
decoding failures now terminate the active instance and publish an error state.

Incoming results require bounded integer grid dimensions, the corresponding
point count, finite epochs and nonnegative finite feasible velocity totals before
selection/rendering. This is structural result admission, not independent Lambert
accuracy verification. No grid computation, browser or cancellation was executed.
Cross-realm kernel budget coordination remains unfinished.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, CI waiting, commits or pushes were performed. Actual
worker cleanup and the full scientific/scalability objective remain unverified.

### Checkpoint 339: coordinate SPK raw-buffer admission across workers (2026-09-24)

A shared window-side byte ledger now accounts for main-thread kernel loads and
the union of kernels requested by each managed trajectory, event and mission-grid
worker under the same 512 MiB raw-buffer cap. Each worker copy is charged
separately. Dispatch reserves new identities before postMessage and rolls back
that reservation if dispatch throws. Repeated requests reuse their worker's
identity charges; all charges remain until termination, since completed or
failed computations can retain kernels in their realm. Termination releases the
worker's reservations idempotently. Source searches found these three production
workers as the consumers of ensureKernelFiles.

KernelStore uses the same reservation primitive for local buffers and keeps its
charge after installation. Worker-local ledgers independently retain their own
limit; the window ledger reserves the declared whole file set before execution.
This is a per-document admission bound on declared raw buffers, not measured
process memory: parser metadata, crypto/transport scratch, garbage-collection
latency, other scientific source pipelines and other tabs remain outside it.
Reservations are conservative after partial failures; no automatic eviction,
lease reclamation or performance gain is claimed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. Integration, capacity and the full objective remain unverified.

### Checkpoint 340: bound automatic kernel retries and release idle worker pools (2026-09-24)

Automatic ephemeris loading now retries a failed file-set request at most three
times, after 1, 2 and 4 seconds, instead of allowing every simulation/store update
to resubmit it. Generation guards isolate older failures and timers from newer
selections, and cleanup cancels pending retry timers. A changed file set resets
the retry allowance; the existing manual load action remains available afterward.
Selection lookup now visits selected identities directly rather than rebuilding
a map from the entire retained catalog on every store update.

When the main thread enters ephemeris loading, the trajectory hook terminates
its previous worker and releases that worker's budget reservations. It resumes
with a fresh worker after loading finishes, while normal clock-only requests
still reuse their worker. The loading-state microtask is also scoped to the live
effect. This does not reclaim main-thread kernels or guarantee enough memory for
every requested pool, and no timing/memory behavior has been measured.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. Retry/recovery behavior and the full objective remain unverified.

### Checkpoint 341: avoid redundant frozen-epoch resolver work (2026-09-24)

Analysis epochs now construct their fallback position resolver only if an
approximate position is actually requested. Fully covered SPK epochs therefore
do not eagerly allocate a second pool/context cache. Fallback still receives the
same frozen kernel set because an approximate child may depend on a precisely
covered parent; no model or source precedence was changed intentionally.

Each kernel resolver now memoizes target-to-source-context selection and
observer coverage within that context for its fixed epoch. Repeated requests
reuse those selections, including missing dependency contexts and legacy
selection, instead of rescanning every candidate segment. These caches live
with the resolver and do not share choices between epochs or pools.

Source tracing found UI-memoized position closures retaining kernel references.
Removing store entries alone cannot safely release their byte charges. Explicit
consumer ownership/reclamation remains unfinished; this checkpoint adds no
eviction and claims no measured memory or speed improvement.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Numerical equivalence, performance and the
full scientific/scalability objective remain unverified.

### Checkpoint 342: invalidate local displays when the kernel pool changes (2026-09-24)

Source tracing found paused-time caches that did not depend on the external
kernel revision. Explorer's local position resolver, spacecraft frame and orbit
curves, inspector moon phase and mission phase now subscribe/depend on that
revision. The trajectory hook now subscribes to loading changes rather than
reading an unsubscribed snapshot, and its local current-position memo includes
the revision. This connects loading completion to the existing worker restart
and budget-release paths without requiring a clock or selection update.

Completed event/mission scientific results retain their frozen evidence; this
change targets live displays. It does not add explicit resolver disposal or
prove that JavaScript has reclaimed older closures. Safe main-store eviction
and measured paused-display behavior remain unfinished.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Display refresh and the full objective remain
unverified.

### Checkpoint 343: narrow scientific-display subscriptions to needed state (2026-09-24)

Added primitive external-store selectors for kernel revision and loading-busy
state. Explorer position/spacecraft/orbit views, inspector diagnostics/moon phase
and mission phase subscribe to revision only. The trajectory hook subscribes to
revision plus the loading boolean instead of the full status object. Changes to
error text or a nonzero loading count no longer change those selector snapshots;
revision and idle/busy transitions still reach their consumers.

The status panel retains the complete snapshot. This narrows subscription-driven
updates only: parent renders can still propagate and no render count or frame
time has been measured. Existing main-store lifetime limitations remain.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. React behavior and the full objective remain unverified.

### Checkpoint 344: group SPK coverage segments once per file (2026-09-24)

Interval coverage filtering now groups segments by target in one pass, then
sorts each private group and scans its interval union. It no longer filters the
whole segment array once for every distinct target. Original SPK segment order
is untouched, so evaluation precedence remains separate from coverage sorting.
Every target must still cover the requested closed interval, empty files fail,
adjacent segments join and an uncovered gap excludes the entire file.

Kernel-window and mission-grid file selection now use Set membership while
filtering the original pool, preserving source order. No persistent segment
index is retained and no actual throughput or scientific equivalence has been
measured. Source-level control-flow review is not numerical verification.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Coverage equivalence, scalability and the full
objective remain unverified.

### Checkpoint 345: admit bounded event jobs before kernel loading (2026-09-24)

Event analysis now shares admission checks between the calling hook and worker:
1–48 distinct target identities, a finite positive representable time window,
nonnegative finite distance threshold, distinct supported event kinds and the
existing bounded sampling policy. The worker performs this before loading any
kernel and rechecks cancellation immediately after shared loading completes.

Per-job budgets now stop after 50,000 attempted extrema refinements or before
appending more than 10,000 events. Every append path uses the same check, and the
hook rejects oversized result arrays. Exceeding a limit fails the job instead
of publishing a truncated success. These are explicit resource-policy values,
not measured capacity or accuracy limits. Resolution-body payload size and
retained result-cache bytes still require separate scrutiny.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Job admission execution and the full objective
remain unverified.

### Checkpoint 346: bound retained event-cache weight (2026-09-24)

Event cache entries no longer retain request parameter arrays, including the
entire resolution-body list. Cache hits use the current equivalent request for
last-run metadata. The key also includes body names, since results embed target
and central-body labels and should not reuse stale names after a label change.

The eight-entry LRU now also enforces a 16 MiB estimated object/string weight.
An incremental, depth-bounded object walk counts shared identities once per
entry and stops once over budget, avoiding full-result JSON serialization.
Oversized results remain visible but are not cached; evictions update both entry
and weight ledgers. This is a retention policy estimate, not measured heap size.
Current UI state, request serialization, structured-clone payloads and temporary
cache-key construction remain outside this cache-only budget.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Cache accounting execution and the full
objective remain unverified.

### Checkpoint 347: send only event body dependencies and snapshot inputs (2026-09-24)

Event requests now select resolution descriptions for targets, angular-event
reference bodies, apsidal centers, transitive parents and the Sun. Earth/Moon
EMB partitioning explicitly retains both descriptions when required. Missing
descriptions remain absent and duplicate source identities retain the previous
Map last-entry behavior. SPK center dependencies and kernel precedence remain
in the unchanged separately declared kernel file set.

The selected request is structured-cloned once before cache-key construction,
Worker creation or last-run publication. Cache identity, dispatched computation
and retained input metadata therefore refer to the same snapshot rather than
mutable source body/orbit objects. Unrelated catalog descriptions are excluded
from that snapshot and cache key. Input indexing still scans the provided
directory; selected body objects are not field-trimmed and this adds no complete
request-byte budget or measured transfer reduction.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Dependency completeness, numerical equivalence
and the full scientific/scalability objective remain unverified.

### Checkpoint 348: bound event inputs before structured cloning (2026-09-24)

Selected event requests now pass an incremental 8 MiB input-weight admission
check before structuredClone, with another check on the complete outgoing
message including ephemeris identities. The worker repeats the check before
kernel loading. Plain-data traversal limits nesting to 64, rejects cycles and
enumerable accessors, charges sparse-array length, and counts repeated references
repeatedly rather than allowing alias expansion to bypass the budget. Strings
and keys use a conservative six-byte-per-code-unit charge plus overhead.

The weight bounds admitted data under this policy; it is not a measured browser
heap or structured-clone transport size. Initial dependency indexing, caller's
already-resident input directory and internal engine enumeration overhead are
outside it. Scientific field validation remains separate from resource admission.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Admission behavior and the full objective
remain unverified.

### Checkpoint 349: honor exact requested apsidal event categories (2026-09-24)

The event worker previously treated either near-apsis checkbox as permission to
emit both heliocentric and satellite categories, and classified explicit
parentId=Sun bodies as generic periapsis/apoapsis. Category selection now uses
the actual central-body identity: Sun maps to perihelion/aphelion; other centers
map to periapsis/apoapsis. Sampling of central tracks and extrema refinement
respect the corresponding requested category. Target position sampling for
other event kinds remains available.

The receiving hook rejects any result containing an event kind outside the
frozen request before publishing or caching it. This enforces request/category
binding only; it is not complete validation of numerical values or provenance.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Selective-event behavior and the full objective
remain unverified.

### Checkpoint 350: bind event receipts to frozen requests and source identities (2026-09-24)

The event receiver now checks the returned window, policy, units/frame/origin,
manifest identity, requested kernel identities/hashes and declared body models
before publishing or caching success. Each event must have ordered finite time
inside the window, requested targets/category, matching center or distinct pair,
appropriate units, finite nonnegative values/refinement widths, bounded iteration
counts and the declared sampling interval. Per-event kernel order and body-model
evidence must agree with the whole-result evidence; required body evidence cannot
be omitted or duplicated. Strict-SPK results cannot declare approximate fallback.

The dispatched request is retained for receipt matching. The worker's final
sample uses the declared window endpoint directly rather than an algebraically
equivalent floating-point expression. These checks bind receipt consistency,
not independent extrema accuracy, actual source-byte execution or prediction
uncertainty; those scientific acceptance requirements remain open.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Receipt compatibility and the full objective
remain unverified.

### Checkpoint 351: bind mission-grid receipts to endpoint and source requests (2026-09-24)

Mission-grid results now pass a dedicated receipt check before display/selection:
the worker's fixed 26 by 22 dimensions, requested endpoint identities, exact
row/column dates, declared evidence window/policy/frame/units, requested manifest
kernel hashes/order and endpoint model/source identities must agree. Feasible
points need nonnegative finite component velocities, their matching sum and
both endpoint evidence records; failed points need a known failure code and the
existing NaN sentinel velocities. Strict-SPK evidence cannot declare fallback.

The last flight-time row now uses maxFlightDays directly to match the declared
endpoint instead of relying on min+(max-min) rounding. Receipt checking does not
independently validate Lambert trajectories, source evaluation or physical
prediction accuracy; no such acceptance is claimed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Mission receipt compatibility and the full
scientific/scalability objective remain unverified.

### Checkpoint 352: validate mission requests before worker creation and loading (2026-09-24)

Mission requests now share preflight checks for request identity, known policy,
distinct body/file identities, present distinct endpoints and finite ordered
date/flight windows. Positive flight times must advance the floating-point date
at both ends of the departure interval; requests that collapse to identical
epochs fail before scientific work. The worker repeats admission before fetching
SPK files, while the UI validates and structured-clones its request before Worker
creation. Receipt checks and dispatch use that same independent snapshot.

This covers structural/date admission, not Lambert feasibility, external source
validation or a complete request-byte limit. The existing curated body directory
is still included. No scientific calculation or network load was executed.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, browser/device runs, CI waiting, commits or pushes
were performed. Mission preflight behavior and the full objective remain unverified.

### Checkpoint 353: distinguish missing states from unexpected mission failures (2026-09-24)

Lambert failure classification now recognizes the base MissingBodyStateError,
including strict-SPK's subclass, as missing-ephemeris. Missing fallback/source
states therefore retain an explicit coverage-gap reason instead of unknown.
The grid continues to record known Lambert/coverage failures per point, but
rethrows unrecognized exceptions rather than publishing a completed grid full
of unknown failures. The receiver likewise rejects unknown point-failure codes.

Unexpected source/invariant/programming errors now reach the existing job-level
error/worker cleanup path. Strict-SPK whole-window preflight behavior remains
unchanged. This classification change does not establish coverage or validate
the scientific feasibility of any grid point.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Error-path behavior and the full objective
remain unverified.

### Checkpoint 354: unify bounded DE440 transport cleanup (2026-09-24)

Dynamics and occultation workers now share a pinned-size DE440 byte reader with
a monotonic 30-second download deadline, external cancellation forwarding and
checks after headers and each stream read. Allocation sits inside the owned
cleanup scope; failed HTTP responses and incomplete reads are aborted/canceled,
reader locks are released, timers/listeners are removed and cancellation errors
do not replace the original failure. Oversized/truncated bodies are rejected.

The occultation worker retains its separate whole-operation cancellation timer.
Scientific consumers retain their existing pinned-hash checks: the helper is
transport admission, not source verification. This does not merge these workers
into the earlier shared kernel-store memory ledger or establish a total heap cap.

Only source/document reading/editing and diff whitespace checks were performed.
Two text-edit command quoting errors were corrected before source integration;
no project code, tests, builds/typechecks, scientific calculations, browser/device
runs, CI waiting, commits or pushes were executed. Transport behavior and the full
objective remain unverified.

### Checkpoint 355: charge experiment SPK copies to the shared window budget (2026-09-24)

Dynamics and occultation job owners now reserve their explicitly allocated SPK
buffers from the same 512 MiB window ledger used by main-thread ephemerides and
managed trajectory/event/mission workers. Dynamics, contacts and planetary-limb
paths charge two pinned DE440 buffers (download plus immutable dynamics copy);
stellar-limb charges three because it also snapshots the downloaded source.

Admission precedes Worker creation. Constructor failure returns the reservation;
the existing idempotent termination path returns it after success, error,
timeout, cancellation or dispatch failure. Reservations remain for the complete
job lifetime rather than assuming early reclamation of input copies.

This accounts only for explicit raw SPK buffers in these source paths. Parser
objects, GM/PCK, observer/input receipts, integration state, hashing internals,
transport allocations and delayed garbage collection remain outside the bound.
No peak process-memory claim or concurrency capacity measurement is made.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Reservation lifecycle execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 356: make adaptive integration yields sensitive to work duration (2026-09-24)

Source review confirmed that integrateAdaptive bounds state dimension to 512
before allocating its stage arrays, bounds attempts, and that the trajectory
recorder caps retained visualization nodes. No additional capacity restriction
was added to those already bounded structures.

The integrator now yields between attempts once a work slice has used at least
8 ms, in addition to its existing 32-attempt cadence. Cancellation is checked
after each yield and the slice clock resets on resumption. Numerical stages,
acceptance decisions and output sampling are unchanged intentionally. One
synchronous derivative/attempt remains non-preemptible; this is a cooperative
threshold, not a measured latency or numerical-equivalence guarantee.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Scheduling behavior, numerical equivalence
and the full scientific/scalability objective remain unverified.

### Checkpoint 357: bind ensemble moments to returned endpoint samples (2026-09-24)

Source review confirmed that failed draws retain their original index, validity
flag, failure record and NaN endpoint, and any failed draw makes moments
unavailable rather than reducing the denominator. Those rules remain unchanged.

The receipt checker now reconstructs the declared anchored/compensated moments
from the validated returned endpoints and compares mean offsets, means,
standard deviations and every covariance entry. Previously, algebraically
self-consistent but unrelated summary values could pass. Reconstruction is
bounded by the existing 128 six-component endpoint limit and runs only for
available summaries; it does not re-integrate, independently validate the
statistical method or establish physical uncertainty calibration.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Receipt reconstruction execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 358: bind ensemble offsets to submitted covariance and seed (2026-09-24)

Source inspection confirmed existing bindings for original bytes, solution
identity/epoch, source-axis order/units, nominal elements, covariance matrix and
requested seed/count. The two returned offset arrays were checked against each
other but not against the requested deterministic stream.

The dynamics receipt checker now parses the submitted covariance and rebuilds
the declared bounded sampling stream, comparing every returned Float64 offset.
It uses the original submitted payload rather than a claimed source object in
the worker receipt. The preceding receipt count checks cap reconstruction at
128 draws. This checks same-runtime seeded-stream consistency, not independent
sampling-method correctness, cross-runtime bit identity or propagated accuracy;
force integration is not repeated by this check.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Seed-binding execution and the full objective
remain unverified.

### Checkpoint 359: separate conic sample failures from unexpected exceptions (2026-09-24)

Known periapsis-conic domain, numerical-range and convergence failures now use
ConicEvaluationError, a RangeError subclass retaining the existing messages.
Coordinate sample projection uses the same type for known nonfinite outputs.
The coordinate ensemble catches only that explicit type as an indexed invalid
draw; cancellation and unexpected exceptions propagate to the job-level error
path rather than becoming apparently ordinary failed samples.

Known invalid draws still retain source offsets, indices and NaN outputs; no
draw is clipped or resampled. Equations, convergence limits and physical-domain
checks were not changed. Integration-stage error classification is separate and
has not been claimed complete by this change.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Failure classification execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 360: distinguish trajectory failures from job errors (2026-09-24)

The nonlinear ensemble now records only explicit DynamicsSampleError failures
as indexed invalid draws. Known integration range/convergence failures and
point-mass, solar 1PN and radiation-pressure trajectory-domain failures use
that RangeError subtype. Unexpected errors, invalid derivative contracts,
prescribed-source failures, cancellation and the shared force-evaluation budget
still abort the job. Force wrappers check the base derivative before adding
their own terms; endpoint Sun states are checked before sample processing.

Failed draw indices, NaN endpoints and per-draw evaluation accounting remain
intact. Numerical formulas, tolerances and domain thresholds are unchanged.
This classification does not establish physical accuracy or calibrated errors.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Runtime behavior and the full scientific
and scalability objective remain unverified.

### Checkpoint 361: transfer ensemble buffers on terminal worker delivery (2026-09-24)

Source inspection confirms unexpected dynamics errors enter the worker error
response and the job receiver terminates the worker and releases its reservation.
All experiment branches now close the worker message loop after terminal delivery;
main-thread termination and budget ownership remain with the job receiver.

The ensemble terminal response transfers the seven owned numeric buffers for
sampling offsets, initial offsets/states/additional values/validity and final
states/validity instead of structured-cloning their storage. A Set deduplicates
buffer identities. Both offset records remain separate receipt fields; scientific
values, invalid draw indices and receipt binding are unchanged. Nothing accesses
the transferred arrays afterward. This removes the requested transport copy of
these buffers; it is not a measured memory or throughput improvement and does
not remove structured cloning of the remaining receipt objects.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Transfer execution, resource release timing
and the full scientific/scalability objective remain unverified.

### Checkpoint 362: terminate Gaia jobs on response decoding failure (2026-09-24)

Source inspection found the nonlinear ensemble display retains the accepted
receipt directly, memoizes its projection and converts typed arrays for JSON
only on explicit export. No whole-receipt copy was removed from that path.

The Gaia receiver now handles messageerror through its existing failure path,
terminating the active worker and clearing partial data/loading state rather
than leaving an undecodable response pending. Null and unrecognized message
envelopes take the same path. The handler checks worker ownership, and successful
completion removes the decode-error listener along with the existing message
and runtime-error listeners before caching the idle worker for reuse. This is
envelope/lifecycle handling, not complete validation of every Gaia message field.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Message-error execution and the full objective
remain unverified.

### Checkpoint 363: bind Gaia stream counts to received chunks (2026-09-24)

The Gaia worker now includes each chunk's manifest path in its delivery and
resets delivery sequence at the start of each reused-worker job. The receiver
admits one manifest with bounded, unique chunk counts summing to the declared
row capacity. Before retaining source rows or scheduling GPU upload it requires
the next sequence, a known not-yet-received path, the matching source row count,
remaining manifest capacity and a finite Float32 display triple for every row.

Completion requires every manifest chunk and row to have arrived, and checks
the summary counts and unique selected paths against received identities. This
matches the current whole-manifest sky loader; a future partial-region UI must
bind against its explicit selection instead. The checks establish transport
consistency, not independent source authentication, scientific accuracy or GPU
performance. Detailed source validation and hash checks remain in the worker.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Gaia stream execution and the full scientific
and scalability objective remain unverified.

### Checkpoint 364: bind Gaia completion to upload acknowledgements (2026-09-24)

The Gaia receiver tracks the single pending upload and last acknowledged
sequence for the current load generation. A chunk cannot be admitted while
another awaits upload, and completion requires no pending upload plus agreement
between the last received and acknowledged sequence. Clearing or cancelling a
job resets the bookkeeping along with its partial source/display data.

The chart callback acknowledges only the pending sequence. Re-upload callbacks
for already acknowledged retained batches are ignored, accommodating effect
replay without releasing a different chunk's reservation. Stale-generation
callbacks remain ignored and acknowledgement dispatch failure terminates the job.
This acknowledgement means the existing WebGL upload/draw calls reported no
error; it is not a GPU completion fence, rendering latency measurement or proof
of physical display accuracy. Empty manifests require no acknowledgements.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Upload lifecycle behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 365: avoid duplicate hashing of Gaia cache hits (2026-09-24)

Source inspection confirms the Gaia encoded-source cache defaults to a 16 MiB,
128-entry LRU, returns owned copies and remains separate from decode/GPU budgets.
The UI reuses one idle worker and terminates it on component unmount. No cache
lifetime or eviction policy was changed by this checkpoint.

Previously, a valid cache hit was hashed during lookup validation and hashed
again immediately by the chunk decoder. Hash admission now happens once for
each candidate byte buffer before the private decodeVerifiedChunk parser.
Invalid cached bytes still evict and fall back to a fetched candidate, which
must independently match the descriptor size/hash. The parser retains its size,
schema, source identity, coordinates and selection checks; cache insertion still
follows successful decode and duplicate-source checks. Cancellation is checked
before network-candidate hashing and at parser entry after asynchronous hashing.
This removes one redundant digest per valid cache hit without accepting unhashed
sources; no measured latency or allocation claim is made.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Cache-path execution and the full scientific
and scalability objective remain unverified.

### Checkpoint 366: bound response assembly and cancel rejected streams (2026-09-24)

The shared readBounded reader now owns error cleanup from header admission
through allocation and stream reading. Invalid byte limits, content types or
declared sizes cancel the response body before propagating the original error;
read failures cancel the acquired reader and release its lock. Exact declared
length and overflow checks remain in place.

For streamed bodies the reader allocates the admitted declared size once and
copies each incoming fragment directly into that output. It no longer retains
an array of arbitrary transport fragments and then allocates a second whole
concatenation buffer. Transport/reader buffers remain outside this accounting,
and an admitted allocation may still fail under actual memory pressure.

Gaia manifest and chunk callers now use the owned returned Uint8Array directly
instead of copying it into another Uint8Array. Their non-success HTTP responses
also cancel the response body explicitly before throwing. Existing deadlines,
source hashes and parser checks remain unchanged. This shared-reader change
also affects state tiles and observation responses; those paths need later
verification rather than a Gaia-only runtime claim.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Stream cleanup/allocation behavior and the
full scientific/scalability objective remain unverified.

### Checkpoint 367: propagate cancellation into bounded body reads (2026-09-24)

readBounded now accepts an optional AbortSignal, checks it before admission and
after asynchronous reads, and cancels its reader on abort. A cancelled read must
not be accepted as ordinary EOF. The abort path observes but does not await the
underlying cancellation cleanup promise before releasing its lock; normal error
cleanup still awaits cancellation. The signal listener is removed on exit.

Gaia manifest/chunk loading, binary state tiles, ground observation, stellar
motion and stellar observer callers pass their existing operation signals into
the reader. This gives those reads explicit cancellation independently of the
fetch implementation's signal behavior. It does not interrupt synchronous parse
or hash computation, nor prove immediate underlying network memory reclamation.
The separate readStateTileJson helper and its callers still need signal wiring;
this checkpoint does not claim all response paths are covered.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Abort execution and the full scientific and
scalability objective remain unverified.

### Checkpoint 368: wire cancellation through JSON response consumers (2026-09-24)

readStateTileJson accepts an optional signal, checks it before admission and
after body reads, and forwards it to readBounded for streamed responses. The
already-aborted error path requests cleanup without waiting for the underlying
cancel promise. Existing status/type/size admission remains in its owned error
scope. Synchronous JSON parsing is still not interruptible.

All nine production call sites now pass their operation signals: catalog
manifests, state plans, current-state/window setup, coverage summary/target and
source identity pagination. The identity page passes its existing 256 KiB cap
to the reader instead of relying only on the preceding header check. State plan
delivery checks cancellation again after its asynchronous request-ID digest.
The call-site inventory was inspected as source, not executed; custom fetchers
and underlying transport cleanup remain outside an immediate-cancellation claim.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. JSON cancellation behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 369: own state request bindings across asynchronous work (2026-09-24)

fetchStateTilePlan now snapshots caller parameters, target IDs and optional
manifest before its first await. Wire payload, request-ID digest and response
validation consequently use the same epoch/source/selection even if caller data
changes during fetch. The signal and injected fetch/admission functions retain
their original identities.

loadCurrentStateObservation likewise owns selected/reference arrays, the
requested-ID map and source pin before requesting its manifest. Serial plans,
snapshot bindings, reference projections and returned epochs now share that
single input snapshot. fetchStateTiles owns its plan, request-ID list and tile
descriptors before concurrent admission/download, so later caller edits cannot
switch descriptor URLs, source hashes or final assembly expectations. The state
window implementation already copies its IDs/grid before asynchronous setup.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Mutation isolation behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 370: snapshot source pagination and inspection bindings (2026-09-24)

Source pagination captures request settings plus the previous query, validated
cursor and manifest before fetching the current manifest. Inventory checks,
the continuation URL and the non-advancing-cursor check all use that snapshot.
A missing continuation cursor now fails before a network request. Only the
continuation fields are copied, not the preceding page's full record array.

Page inspection captures its target IDs and expected manifest before awaiting
manifest retrieval. Together with the captured epoch/base/signal/fetcher and
the state-plan snapshots from checkpoint 369, this prevents caller edits from
switching the inspected page's identity mid-request. Source IDs remain original;
no alias-to-NAIF substitution or completeness inference was introduced.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Pagination mutation isolation and the full
scientific/scalability objective remain unverified.

### Checkpoint 371: enforce source continuation page consistency (2026-09-24)

Inspection of inventory.pageRefs and IdentityPage confirms unfiltered pages use
manifest record positions and searched pages use query-index positions; neither
contract requires lexical source-ID order. No lexical ordering rule was added.
Both paths fill the requested limit whenever a continuation token is returned.
The browser now rejects a continuation-bearing page with fewer than 50 rows.

The continuation snapshot also retains the prior inventory total and a bounded
set of previous-page source IDs. A subsequent page must preserve the pinned
inventory total, contain rows and not repeat an ID from the immediately previous
page. This checks source record identity, not physical-body deduplication.
totalRecords remains the entire inventory count rather than a query match count;
these checks do not prove whole-inventory coverage or detect every multi-page
cycle without a retained history. Only the adjacent page is compared.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Continuation execution and the full scientific
and scalability objective remain unverified.

### Checkpoint 372: reject source-browser results past the acceptance deadline (2026-09-24)

SourceIdentityBrowser already preserves the current verified page after failed
continuation or state inspection, clears it on query changes, and gates result
publication by controller ownership. Those behaviors were retained.

The browser now records a monotonic 30-second deadline and checks it before work
and immediately after each awaited page/inspection result, before publication.
An overdue result aborts and enters the existing error path even when main-thread
work delayed the timeout callback. Explicitly cancelled operations also fail
this acceptance check and cannot overwrite state. Failed continuation/inspection
continues to leave the prior directory page available. No claim is made that
timers interrupt synchronous parsing or guarantee a hard UI response latency.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Browser deadline behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 373: reject late coverage report results (2026-09-24)

SourceCoverageReport and CoverageTargetInspector now compare a monotonic
30-second deadline immediately after their awaited loading/validation operation
and check cancellation before publishing a ready report. Controller ownership
guards remain in place. A delayed timeout callback can no longer be cleared by
a late successful response without the acceptance deadline being checked.

Inspection found readScientificSourceFile already checks its monotonic deadline
and cancellation inside the FileReader load callback before accepting bytes;
that path was not changed. These are acceptance deadlines, not preemption of
synchronous parsing or guarantees of exact wall-clock UI responsiveness.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Coverage deadline execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 374: reconcile gap dependency chains with window atoms (2026-09-24)

Report refresh removes the old target inspector while loading and keys the new
inspector by report hash; target requests already bind report/catalog/inventory,
epoch and window before display/export. No extra refresh state was introduced.

Inspection of the window audit generator showed gap entries retain the exact
dependency chain from their point/interval atom. Backend report admission and
frontend target-response validation previously reconciled location/reason but
validated the two chains independently. Both now require matching ordered chain
steps as well. The browser comparison ignores object property insertion order;
the backend compares struct values including pointed-to values. Empty chains
remain equivalent whether encoded as null or an empty array. Duplicate or
missing gaps still fail. This is internal report consistency, not independent
kernel evaluation or a numerical accuracy certificate.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Gap-chain validation execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 375: retain supported frame and missing-pool root evidence (2026-09-24)

The window generator and Go SPK evaluator both admit frames 1 and 17, but coverage
chain admission accepted only frame 1. Backend and browser chain checks now
admit frame 17 as well, preserving its numeric identifier without relabeling or
changing scientific coordinates.

The generator's explicit-solution-pool-missing terminal step contains target and
root. ChainStep previously omitted root, losing that diagnostic during backend
JSON decoding and making the step fail its context/origin requirement. Root is
now retained in the backend structure and accepted by both chain validators as
the distinct missing-pool form, requiring a target and disallowing simultaneous
kernel/context/origin fields. Existing cloning and step-value comparisons carry
the added string field. This preserves source evidence without inventing a
replacement solution pool.

Further chain validation remains open: the generator also emits unsupported
selected segments as gap evidence, and target/center continuity and atom-time
containment need reason-aware checks. This change does not claim those finished.
Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Chain admission execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 376: distinguish unsupported-segment evidence from coverage (2026-09-24)

Backend and browser chain admission now take the atom/gap reason. A structurally
valid selected segment with unsupported frame or type is retained only as the
last step of an unsupported-selected-segment gap. Such a reason must actually
have that unsupported terminal segment; it cannot label an empty or entirely
supported chain. Unsupported intermediate steps and unsupported segments claimed
as covered remain rejected. Kernel steps now also require the center identifier
that the audit generator always emits.

The supported frame/type sets are unchanged. This fixes rejection of diagnostic
gap evidence without enabling evaluation of unsupported ephemerides or claiming
coverage. Corresponding atom and gap chains still reconcile under checkpoint
374. Full target/center continuity and per-atom interval containment checks remain
separate unfinished work.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Reason-aware admission execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 377: reconcile chain targets and atom intervals (2026-09-24)

Backend window admission and browser target-response validation now bind the
first dependency target to the audited target, require subsequent targets to
match preceding kernel centers, and require each segment interval to contain
its point or interval atom. The generator selects interval segments across both
boundaries, so endpoint containment follows its existing evidence semantics.

Non-kernel terminal records must occur last. Covered atoms must terminate at the
explicit target-zero naif:0 origin marker; gaps cannot claim that successful
terminal. Kernel steps cannot carry an origin marker to bypass this distinction.
Missing-pool roots must match the explicit-solution-pool-missing reason, and that
reason requires terminal root evidence. Gap chains ending before SSB remain
allowed, preserving cycle/depth diagnostics. These consistency checks do not
independently resolve kernels or establish numerical or physical accuracy.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Chain continuity execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 378: validate cycle/depth diagnostics against stopping rules (2026-09-24)

Source inspection confirms the window generator checks SSB first, then rejects
seen.length > 32 or a previously visited target without appending a new step.
Cycle takes precedence over depth when both apply. Backend and browser atom
checks now reject chains that continue after a repeated target or beyond that
depth boundary, while permitting the SSB terminal after 33 kernel steps.

A center-chain-cycle reason requires the last kernel center to close onto a
previously visited nonzero target. A center-chain-depth-exceeded reason requires
33 kernel steps followed by a nonzero, not-yet-visited center. These checks
preserve the generator's actual off-by-one and precedence semantics rather than
inventing a different depth policy. They verify reported structure only, not
the underlying descriptor-selection result or physical orbital behavior.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Stopping-rule validation execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 379: enforce one solution context per dependency chain (2026-09-24)

The generator chooses a context once and passes it unchanged down the center
chain. Backend and browser atom checks now require each declared context to be
legacy or a nonempty root identifier, and reject a context change within one
chain. This does not claim that a kernel actually belongs to the named pool;
membership still requires descriptor/source evaluation.

Missing-target gaps must end in the unresolved target/context record, while a
context-only terminal cannot claim a different reason. Missing explicit pools
must be represented by the single root-bearing step emitted before recursion.
These rules preserve the distinction between a missing root solution pool and
a target missing within an already selected pool; neither is silently replaced.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Pool consistency execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 380: align dependency partition admission with the generator (2026-09-24)

The generator admits up to 4096 boundary points, while backend/browser consumers
previously capped both points and gaps at 256. Both now admit the generator's
4096 points and the resulting at-most-8191 point-plus-interval gaps. The browser
also bounds gaps against the actual number of points. Existing byte and chain
budgets remain enforced; increasing atom limits is not an unbounded allocation.

Backend validation already binds interval n directly to boundary points n and
n+1. Its additional linear search over all points for every interval endpoint
was redundant and has been removed, avoiding that quadratic validation pass.
The gap UI already renders 20 entries per page. No runtime performance is claimed.

Remaining transport work is explicit: the 512 KiB single-target response reader
can still reject a valid larger partition; the backend report budget is 8 MiB.
This checkpoint aligns structural limits only, not all report delivery capacity.
Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Large-partition execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 381: align bounded target-report transport budgets (2026-09-24)

The target coverage endpoint now uses the existing limited JSON writer with an
explicit 16 MiB response cap; the single-target browser reader uses the same cap
instead of 512 KiB. The JSON reader's opt-in ceiling expands to 16 MiB while its
default remains 4 MiB and other callers retain their supplied smaller budgets.
The limited writer now reserves its final newline within the advertised limit.
Encoding remains bounded only after marshaling, not by a streaming encoder;
oversized batch responses still fail rather than being truncated as successful.

The target inspector formats/render the full raw JSON only when its disclosure
is open; ordinary gap browsing retains the existing 20-row pagination. The raw
result remains available for explicit export. Neither the byte cap nor lazy
display proves that every possible admitted report fits, nor establishes peak
heap or serialization latency. Backend report-file admission remains 8 MiB.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Large-response delivery and the full
scientific/scalability objective remain unverified.

### Checkpoint 382: bound retained encoded rows and reuse target copies (2026-09-24)

Coverage-target requests now memoize positive and negative ledger lookups by
NAIF target. Multiple requested aliases reuse one owned dependency-graph copy;
the canonical-ID existence probe no longer performs a discarded deep copy then
a second copy for the same row. Ledger immutability is preserved, and each
requested identity still receives its own response row.

Rows are encoded individually and admitted under a cumulative byte budget before
retention. An excessive batch returns an explicit error without publishing a
partial successful response or first serializing every repeated graph as one
unbounded batch. The existing final-envelope cap remains authoritative. Request
cancellation is checked between rows and before final encoding. Per-row encoding,
retained raw rows and final-envelope encoding still require temporary storage;
this is not a streaming serializer or a measured total heap bound.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Batch allocation behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 383: admit report bytes before publishing a completion marker (2026-09-24)

The coverage generator serializes once and checks the exact UTF-8 size including
its newline against the backend's 8 MiB report-file limit before creating its
output directory. An oversized report fails without publishing a purportedly
complete report, truncating records or changing the requested scientific window.
This byte admission does not replace the backend's semantic/source checks.

report.json now uses the existing writeScientificReceipt helper: a completed,
synced temporary file is linked without replacing an existing destination, and
cleanup warnings remain visible. The helper's source hash joins generator
provenance. README still precedes the completion marker; a filesystem failure
can leave that incomplete directory, but no partially written report.json is
intentionally published. Hard-link support is required and crash/directory
durability is not asserted. Serialization allocation precedes the byte check.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Report publication behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 384: enforce report structure budgets during accumulation (2026-09-24)

The coverage identity accumulator now mirrors existing backend admission limits:
2048 target groups, 4096 retained references per target, 8192 references overall
and 256 source/status/model buckets. It fails when a new entry would exceed the
budget, before building further windows or publishing an incompatible artifact.
No record is silently truncated or relabeled unresolved to meet a budget. These
are existing service limits, not a claim that larger scientific coverage has
been implemented; expanding the service needs coordinated capacity work.

Source/reason counters use prototype-free dictionaries so source names such as
constructor or __proto__ remain ordinary count keys. JSON export semantics are
unchanged. Byte admission and backend semantic validation remain separate gates.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Accumulator boundary behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 385: preserve generator hash evidence through the coverage API (2026-09-24)

Inspection of the generator's direct/transitive runtime imports found the current
file list includes the examined project modules. The backend report decoder,
however, discarded the generator list before constructing its summary. It now
retains a bounded list of unique relative source paths and SHA-256 declarations,
copies that list when returning summaries, and includes it in summary byte
admission. The browser validates the list and exposes it in a disclosure.

Legacy reports with no list remain explicitly missing that evidence; hashes are
not fabricated. The UI states these are report-recorded declarations, not files
independently authenticated by the browser or proof of numerical reproduction.
No complete runtime/environment provenance or loaded-module identity is claimed.

Only source/document reading/editing, Go formatting and diff whitespace checks
were performed. No tests, builds/typechecks, calculations, browser/device runs,
CI waiting, commits or pushes were performed. Provenance transport execution
and the full scientific/scalability objective remain unverified.

### Checkpoint 386: detect generator file changes across report calculation (2026-09-24)

Coverage generation now records implementation-file hashes before kernel/input
processing and rereads each listed file after calculation. A differing hash
fails before output directory creation rather than reporting only the later
disk contents as if they described the whole calculation. Reads use the existing
regular-file snapshot helper with a 4 MiB per-file limit and metadata stability
checks instead of unbounded readFile calls.

The report explicitly limits this evidence to disk snapshots. It does not prove
that Node's previously loaded/cached modules match those files, detect a change
that was restored between observations, attest the runtime environment, or
prevent edits after the final check. Those stronger provenance properties are
not claimed by the two endpoint observations.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Generator mutation detection and the full
scientific/scalability objective remain unverified.

### Checkpoint 387: bound inventory metadata reads and reuse directory hashes (2026-09-24)

inventoryKernels now reads the manifest, generated body metadata and satellite
catalog through the regular-file snapshot helper with a 16 MiB per-file limit.
Manifest file count is capped at the window analyzer's existing 4096-kernel
limit before coefficient readers are launched. The fixed-size kernel reader
also compares nanosecond modification/change timestamps before and after reading,
in addition to size. The manifest SHA-256 check on the exact loaded kernel bytes
remains authoritative; metadata stability alone is not source authentication.

The satellite-catalog hash is computed once from the owned source bytes and
reused for mapping evidence and the final receipt, avoiding repeated hashing
while attaching records. Manifest/body/catalog schema rules and identity joins
are otherwise unchanged; this is not an atomic snapshot of the whole directory.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. File stability execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 388: stop and drain sibling inventory readers on failure (2026-09-24)

The four-lane inventory kernel loader now uses one internal abort controller.
The first observed reader/hash/parser failure aborts sibling work and remains
the reported reason. Each lane catches its error, stops requesting files and
finishes its owned file cleanup before the loader propagates the failure; it
no longer rejects early while other lanes keep processing the remaining pool.

Kernel reads check cancellation before/after opening and metadata calls and
between OS reads capped at 1 MiB each, including before large-buffer allocation
and before parsing. Manifest-index storage still fixes pool precedence. This
does not interrupt a pending OS operation or synchronous hash/SPK evaluation,
and does not claim bounded cleanup latency under a stalled filesystem.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Failure drain behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 389: validate inventory selection metadata before kernel reads (2026-09-24)

The inventory entry point now rejects nonfinite epochs before reading files.
Its manifest preflight requires dependencyOnly to be an actual boolean when
present, preventing truthy strings such as "false" from silently excluding root
kernels. Explicit solution pools must be arrays of nonempty string identities,
without duplicates or self-reference and within the existing 4096-kernel limit.
These checks run before any coefficient-reader lane starts, including for roots
not selected at the requested epoch.

Absent named dependency files remain a coverage gap rather than a schema error;
the resolver's fixed manifest precedence and missing-pool behavior are preserved.
This is an input-contract correction, not evidence of numerical accuracy or a
measured loading speedup.

Only source/document reading/editing and diff whitespace checks were performed.
No tests, builds/typechecks, calculations, browser/device runs, CI waiting,
commits or pushes were performed. Runtime validation and the full scientific/
scalability objective remain outstanding.

### Checkpoint 390: reject contradictory satellite identity joins (2026-09-24)

Inventory mapping now rejects a discovery identity assigned to two different
targets or parents instead of allowing the later catalog row to overwrite it.
Repeated identical joins remain acceptable. Generated moon rows whose target
already exists in the satellite catalog must also agree with that catalog's
parent; previously those rows skipped the parent check entirely. Catalog alias
authority is preserved, without importing extra aliases from duplicate generated
rows. Numeric naif record identities must convert to safe integers before they
can enter the resolver.

Source inspection also found differing existing asteroid SPK identity mappings
between static targets and generated records (including Pallas and Vesta).
Their existing precedence is unchanged here; this checkpoint does not establish
that those distinct identifiers are interchangeable or resolve that separate
provenance question.

Only source/document inspection, static JSON field extraction, edits and diff
whitespace checks were performed. No tests, builds/typechecks, scientific
calculations, browser/device runs, CI waiting, commits or pushes were performed.
Identity-conflict execution and the full scientific/scalability objective remain
unverified.

### Checkpoint 391: reconcile asteroid mapping precedence and record identity (2026-09-24)

Static source/data inspection found Pallas and Vesta's explicit generated targets
20000002 and 20000004 in the batch-18 acquisition declarations, generated body
rows and both profile manifests. majorBodies carries those explicit naifId
values, which bodyNaifId prioritizes; the inventory also prioritizes generated
targets over its legacy defaults. No runtime-versus-inventory mismatch was found
on that source path. Full-profile kernel IDs retain the larger date interval,
so equality with the generated page-profile sourceKernelId is not a valid
cross-profile admission rule. This inspection does not certify binary content
or claim numerical equivalence with the legacy IDs.

The inventory now refuses conflicting target assignments within the generated
asteroid rows and rejects unsafe numeric targets there. It also requires a
designation-based asteroid/dwarf-planet record ID to equal sb:asteroid: followed
by that designation before mapping it, preventing contradictory ID/designation
pairs from silently resolving to the designation's body. The explicit Pluto and
canonical NAIF branches retain their separate identity semantics.

Only source/data inspection, static JSON field extraction, edits and diff
whitespace checks were performed. No tests, builds/typechecks, scientific
calculations, browser/device runs, CI waiting, commits or pushes were performed.
Runtime behavior and the full scientific/scalability objective remain unverified.

### Checkpoint 392: preserve resolved primary versus system-center identity (2026-09-24)

The inventory loader now validates each satellite-catalog primary's explicit
identity before adding it to parent/designation maps: a nonempty ID/designation,
the matching sb:asteroid inventory ID, safe integer primary/system targets and
distinct primary versus system numbers are required. Conflicting parent keys or
repeated designations with different primary/system targets are rejected rather
than silently replacing the earlier mapping. A generated numbered asteroid also
cannot overwrite a catalog-declared resolved primary with a different target.

These checks preserve the catalog's explicit component distinction. They do not
infer target IDs from number ranges, independently prove the source's center
semantics, inspect coefficient binaries, or add any missing primary offset.
Legacy/default asteroid precedence outside resolved catalog primaries is unchanged.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Runtime behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 393: share preview and runtime dependency selection (2026-09-24)

Preview generation and kernelFilesForBodies now use one selectEphemerisFiles
implementation. Both reject malformed selection flags/target lists, duplicate
file identities, repeated or self-referencing pool entries and missing/cyclic
dependencies reachable from selected roots. Previously preview allowed root
self-reference despite the resolver rejecting it, while runtime file selection
did not reject dependency cycles or duplicate manifest identities.

The selector preserves original manifest ordering and returns the original file
objects; it does not rewrite source pools or coefficient metadata. Dependency
closure uses an explicit DFS stack, with at most 4096 admitted files and 4096
entries per declared pool, rather than recursive JavaScript calls. Structural
metadata is checked across all files, but missing/cyclic closure checks apply
to selected roots only. The resolver's treatment of unavailable loaded pools
as missing coverage is unchanged. No frame-time or memory improvement is claimed.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Selector execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 394: validate exact worker kernel pools before loading (2026-09-24)

ensureKernelFiles now uses exactEphemerisFiles, sharing manifest indexing and
iterative dependency closure with preview/runtime body selection. Explicit ID
requests are bounded to 4096 entries and checked for unknown files, malformed
selection metadata, dependency cycles and omitted dependencies before fetches
start. Repeated requested IDs are still deduplicated. Returned files retain
manifest order rather than relying on request ordering.

This exact-request path does not silently append dependencies: a worker's pinned
file set must already contain its complete declared closure, even if another
request previously installed a missing dependency. Trajectory, conjunction and
mission worker call sites all pass through this loader. Source inspection of the
automatic and manual scene loaders confirmed they pass the body selector's full
closure rather than only the not-yet-installed subset. Empty pools remain valid
for callers explicitly using approximate models. Direct installation and numerical
resolvers remain separate contracts, not claimed covered by this loader gate.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Worker loading behavior and the
full scientific/scalability objective remain unverified.

### Checkpoint 395: verify and own directly installed kernel bytes (2026-09-24)

Direct installKernel is now asynchronous and requires a known manifest identity,
the admitted manifest size and a matching SHA-256 before parsing/registration.
It reserves its retained-buffer budget before copying caller bytes and hashes
that private copy, preventing subsequent caller mutation/detachment from changing
the installed source. Concurrent installations recheck the identity after hashing;
failed/redundant copies release their reservation. A successfully installed buffer
keeps its charge even if notification code subsequently throws.

Registration takes the source descriptor used for verification, rather than
looking up a potentially changed descriptor after an await; direct and network
loaders snapshot metadata and dependency arrays, and registration copies the pool
array. The direct caller's original buffer and crypto scratch remain outside the
retained-buffer budget; this does not claim a total-process memory cap.

Source searches found direct installation call sites only in test setup code.
Those callers were edited to await the new API; a stale replacement expectation
was aligned with the already-established no-replacement ownership rule. None of
these tests or setup hooks was executed. Only source/document inspection, edits
and diff whitespace checks were performed: no tests, builds/typechecks,
scientific calculations, browser/device runs, CI waiting, commits or pushes.
Integrity execution and the full scientific/scalability objective remain unverified.

### Checkpoint 396: isolate cached states and freeze shared selection descriptors (2026-09-24)

createKernelResolver now snapshots the supplied file order, identity/selection
flags and dependency arrays so later caller metadata changes cannot alter lazy
contexts while earlier states remain cached. Its public barycentric method returns
independent position/velocity objects, including for SSB, rather than exposing the
internal center-chain cache. Relative calculations keep internal cache access and
already produce fresh difference vectors; the shared zero vector is frozen.

Registered LoadedKernel wrappers and their dependency arrays are frozen. SPK
segment arrays, each descriptor and its type-1/17/21 scalar control metadata are
frozen after parsing; the segments property cannot be reassigned at runtime.
The public segment array type is readonly. This retains coefficient sharing and
does not make extra coefficient-buffer copies during resolver construction.
Direct SpkKernel construction still borrows its input buffer; this checkpoint is
not a claim of universal ownership isolation or a security boundary against
reflection/prototype modification.

Only source/document inspection, edits and diff whitespace checks were performed.
A source search found no segment-array mutator call sites in src/scripts/tests.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Cache isolation execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 397: own analysis-window inputs and public vectors (2026-09-24)

createAnalysisEphemeris now takes a structured copy of the body Map, including
nested orbital/identity data, and captures needsVelocity and the manifest ID at
construction. Changing the original Map, body elements or options afterwards
cannot change lazily evaluated epochs or turn velocity access on without the
window margin established at construction. Eligible kernel wrappers, dependency
arrays and the exposed pool list are owned/frozen while retaining shared SPK
coefficients.

Each epoch's public position/velocity query returns a fresh vector instead of
exposing cached state, and the cached query facade is frozen. Internal velocity
calculation still reads its private position cache directly. Evidence retains the
construction-time manifest ID rather than reading it anew on export. These
changes do not independently authenticate externally supplied kernel instances
or measure the copying/allocation overhead.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Analysis-window isolation and the
full scientific/scalability objective remain unverified.

### Checkpoint 398: bind analysis hashes to verified kernel instances (2026-09-24)

The kernel store now keeps a private WeakMap receipt for successfully verified
SPK objects, recording their installed identity and measured SHA-256. Both direct
and network registration receive the actual digest after matching it against the
source descriptor. Analysis evidence queries that object-and-ID binding rather
than looking up a manifest hash solely by name. An externally supplied same-name
kernel or renamed wrapper now produces a null hash; a copied wrapper retaining
the actual verified object and identity retains the receipt.

This records verification at installation, not independent numerical validation,
complete runtime attestation or an assertion about subsequently altered evaluator
methods. Existing event/mission result binding still requires the expected hashes
for normal worker delivery; the analysis API's nullable field truthfully represents
external instances without loader receipts. A direct-construction fixture's source
expectation was updated to null without executing it.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Receipt binding execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 399: bind result time assumptions and response budgets (2026-09-24)

Event and mission result receivers now compare the declared dynamical time scale
and time-quality receipt to the existing analysis-window contract. Modern windows
require TDB and the current helper's status, leap-second value, ordered assumptions
and source list; historical windows require legacy-numeric-jd and null quality.
This checks consistency with the implementation, not external accuracy of the
time model or future leap-second predictions.

Event binding now requires a result envelope with the matching request ID and
an actual events array capped at the producer's existing 10000-event budget;
an absent array is no longer accepted as an empty success. Both receivers bound
pool evidence by the requested file count and body evidence by its applicable
request population (two mission endpoints). Null event body-evidence entries
fail through the binding error before Map construction. Existing hash comparison
already rejects unverified/null source hashes and remains in place.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Receiver execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 400: isolate time sources and reject holes in receipt arrays (2026-09-24)

utcTimeScaleQuality now returns an independent source-list array, matching the
already-independent assumptions array. Editing a returned receipt cannot change
the module's source references or the expected evidence produced for later calls.
No leap table, conversion formula, confirmation window or assumption text changed.

Time-evidence comparison now traverses the dense expected list and requires an
own entry at every index. A received sparse array of the correct length can no
longer pass because Array.every skips its missing entries. Per-event file-list
comparison likewise traverses the validated pool list rather than the received
array, rejecting omitted indexed entries while retaining order checks. This
addresses structured in-process/worker data; ordinary JSON nulls remain invalid.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Mutation/sparse-array behavior and
the full scientific/scalability objective remain unverified.

### Checkpoint 401: require model evidence for empty event results (2026-09-24)

Event result binding now derives the producer's explicitly sampled body set:
all selected bodies, the reference body for angular events, and the applicable
central bodies for requested apsides. The receipt must include exactly those
model identities even when no event survives filtering. The producer's sampling
loop was inspected to establish this requirement; incidental internal fallback
parent evaluations are not incorrectly required as separately reported models.

Both event and mission binding reject a jpl-spk model paired with an empty kernel
pool. Mission evidence is not required for an endpoint whose evaluation failed
before it could be recorded. Event values also have to satisfy the existing
producer filters (conjunction at most 2 degrees, opposition at least 178 degrees),
and null per-event model entries fail explicitly. These are receipt consistency
checks, not a proof of event completeness or orbital accuracy.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, scientific calculations, browser/device runs,
CI waiting, commits or pushes were performed. Model-evidence execution and the
full scientific/scalability objective remain unverified.

### Checkpoint 402: stop extremum refinement at representational limits (2026-09-24)

Golden-section refinement now requires two strictly ordered interior candidates
before another contraction. When floating-point rounding collapses their order,
it stops and reports the actual completed contraction count (possibly zero),
rather than repeatedly evaluating indistinguishable candidates and reporting the
requested count. Event receipt admission accepts zero iterations accordingly.
Unknown extrema modes and nonfinite bracket widths are rejected explicitly.

The final time uses left plus half the remaining width instead of adding the two
absolute dates, and its reported numerical radius is the larger distance to the
remaining endpoints, accounting for an asymmetrically rounded midpoint. Comments
now state the unimodality assumption and distinguish the numerical search interval
from certified extremum localization or physical prediction uncertainty. No new
convergence, event-completeness or sub-floating-point precision claim is made.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Refinement execution and the full
scientific/scalability objective remain unverified.

### Checkpoint 403: preserve full plateau brackets during event refinement (2026-09-24)

SampledExtremum now carries the indices immediately outside its detected plateau.
The event worker passes those endpoints into refinement for close approaches,
conjunctions, oppositions and both apsis directions. Previously it reconstructed
the bracket from the plateau midpoint plus/minus one sample, which excluded part
of any longer plateau and could even choose two equal interior samples rather
than its surrounding neighbors.

Single-point extrema keep the same adjacent-sample bracket. Existing endpoint/
nonfinite-neighbor exclusions and the linear plateau scan remain intact. This
preserves the detected coarse interval; it does not establish uniqueness of a
physical extremum on a flat objective, remove the unimodality assumption, or prove
that unsampled events are absent.

Only source/document inspection, edits and diff whitespace checks were performed.
All five production refinement call sites were checked for the new candidate
argument. No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Plateau refinement execution and
the full scientific/scalability objective remain unverified.

### Checkpoint 404: preserve uncertainty when refinement values tie (2026-09-24)

Golden-section refinement now stops before contraction when its two interior
objective values are exactly equal. Previously the <= branch always contracted
toward the left, repeatedly shrinking even a constant objective and reporting a
narrow numerical interval without directional evidence. The current interval,
its midpoint value and the actual contraction count are retained on a tie.

Equality is not labeled a proven plateau or convergence: it may also result from
rounding or a symmetric extremum. Symmetric cases can consequently retain wider
intervals than before, deliberately exposing unresolved localization rather than
imposing a direction. No epsilon threshold or assumed measurement precision was
introduced. The existing numerical interval display/export carries the retained
width; physical prediction uncertainty remains unestimated.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Equal-value refinement execution
and the full scientific/scalability objective remain unverified.

### Checkpoint 405: retain small interval displays and empty-result evidence (2026-09-24)

The event timeline now formats numerical interval half-widths with four
significant digits, allowing scientific notation instead of rounding a positive
value to fixed-decimal zero. Exact zero remains zero and invalid display inputs
use a missing-value mark. Numeric values in JSON/CSV exports are not reformatted.

JSON export is available for any completed analysis with its request and receipt,
including zero events. Its top-level manifest ID and file list now come from the
analysis receipt rather than the current manifest and first event, so an empty
event list does not erase the eligible source pool. Idle/running/error/cancelled
states do not enable this receipt export. Source inspection confirmed complete
worker and cache paths set the corresponding request/evidence state.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Rendered formatting/export behavior
and the full scientific/scalability objective remain unverified.

### Checkpoint 406: isolate and revalidate event cache receipts (2026-09-24)

Event cache insertion now clones the complete admitted result/evidence graph,
instead of retaining nested objects also exposed as React state. Cache hits pass
the current request/manifest receipt binding before another full copy is exposed
to the consumer. Invalid/uncloneable cached entries are removed with accounting
updated and follow the normal worker path; an insertion clone failure skips the
optional cache instead of rejecting the scientific result.

The binding request is constructed and budget-checked before cache lookup and is
independent of the lastRun object exposed to the UI. Later consumer edits cannot
change the request against which an arriving result is checked. The existing
eight-entry/16 MiB retained-cache accounting remains an admission estimate; the
temporary copy and separately held UI result are not claimed inside that budget.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Cache isolation/revalidation behavior
and the full scientific/scalability objective remain unverified.

### Checkpoint 407: retain mission-grid inputs for opportunity application (2026-09-24)

Source inspection found no analogous mission result cache; its worker request
already uses structuredClone. The mission UI now retains that validated request
alongside the accepted grid and uses its body definitions when applying a chosen
opportunity, rather than reading potentially changed registry bodies. Starting a
new grid or failing one clears the associated request snapshot.

Applying an opportunity computes replacement Hohmann/Lambert outputs before
publishing them and clears both on failure, preventing an old Lambert result from
remaining beside an error for newly applied dates. The direct transfer action
uses the same all-success publication rule and clears stale outputs on failure.
This does not claim persisted cross-session reproducibility or independently
revalidate numerical equivalence between a grid cell and its detail solution.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Mission interaction behavior and
the full scientific/scalability objective remain unverified.

### Checkpoint 408: prevent stale transfers from driving new mission inputs (2026-09-24)

Mission transfer results now retain a key for the departure/arrival identities,
date fields and ephemeris policy. The displayed Hohmann/Lambert values are derived
only when that key matches current controls. This immediately removes old values
from the phase target, next-grid Hohmann duration hint and export UI when the
controls change, without an effect that could erase a newly applied solution.
Returning to the same controls can show the retained result again.

Applying a grid opportunity restores the grid's ephemeris policy and records the
corresponding input key on success. The pinned grid remains selectable separately
from the current controls. This key binds UI fields, not a fresh source/model
revalidation; a selected opportunity's full Julian-day precision remains in the
solution evidence even though the current form uses date-only controls.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Stale-result UI behavior and the
full scientific/scalability objective remain unverified.

### Checkpoint 409: retain mission opportunity epochs through state and sharing (2026-09-24)

Mission state now retains optional departure/arrival numeric UTC Julian days.
Applying an opportunity stores both original values, and subsequent transfer,
phase and grid-window calculations use them rather than reconstructing noon from
date strings. Transfer input keys include these values. The controls show the
precise UTC ISO readout and numeric JD when present; calculations retain the JD
instead of round-tripping through the millisecond Date representation.

Date-only edits clear the corresponding precise value, even when selecting the
same calendar date. A shared matchingMissionEpoch helper admits finite,
Date-representable values only when their UTC calendar date agrees with the
visible date. Share serialization preserves Number string precision in optional
departJd/arriveJd fields, parsing validates those bindings, and provider restoration
passes them into the mission store. Older date-only URLs retain the noon default.
These fields preserve epochs, not the full model/kernel provenance of a past run.

Only source/document inspection, edits and diff whitespace checks were performed.
No tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed. Epoch round-trip and interaction
behavior and the full scientific/scalability objective remain unverified.

### Checkpoint 410: preserve mission ephemeris policy in shared state (2026-09-24)

Mission ephemeris policy now lives in the mission store alongside endpoints and
epochs. The selector updates that state, and applying a grid opportunity restores
its policy with the other grid inputs. The store rejects explicitly supplied
unsupported policy values before publishing a patch.

Mission sharing writes the optional missionEphemeris URL parameter and provider
restoration carries recognized prefer-spk/require-spk values into the store.
Thus the source path now preserves a valid require-spk selection across sharing
and page remounts. Older URLs and unrecognized values retain the existing default;
this is not a provenance-pinned replay or an invalid-link rejection mechanism.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Link round-trip and interaction behavior remain
unverified, and the full scientific/scalability objective is still open.

### Checkpoint 411: retain numeric Lambert inputs in transfer exports (2026-09-24)

Lambert results now retain copied departure/arrival position vectors, the actual
gravitational parameter, iteration limit, computed residual tolerance with its
AU^(3/2) unit, and the zero-revolution branch declaration. Existing result fields
already retain flight duration and prograde selection. Body-to-body results also
retain copied endpoint body velocity vectors and the actual AU/day to km/s
conversion factor used for v-infinity and C3.

The transfer JSON envelope now includes schemaVersion and kind. Its existing
solution payload includes these numeric inputs together with endpoint epochs and
ephemeris evidence. This enables downstream consumers to inspect the numeric
problem without resampling a changed body registry; it does not embed SPK files,
provide an importer, or establish replay accuracy. The solver mathematics and
convergence criteria were not changed.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Export/replay behavior and the full scientific and
scalability objective remain unverified.

### Checkpoint 412: retain and export mission grid scan inputs (2026-09-24)

Porkchop results now carry the departure start/span and flight-axis bounds,
explicit UTC epoch/UTC-JD-difference axis labels, row-major ordering, prograde
selection and zero-revolution branch. Receiver binding checks these fields
against the accepted worker request before publishing the grid. The scan's UTC
JD difference is distinguished from the ephemeris-derived dynamical duration
used inside Lambert; sampling arithmetic has not changed.

The mission evidence panel now offers a grid JSON export containing the accepted
request snapshot (including body records and requested kernel IDs), result,
selected index, build information and schema/kind. Infeasible point metrics are
explicitly encoded as null with a declared encoding, preserving failure codes
rather than implying zero speed or relying on implicit NaN JSON conversion.
The export follows the retained grid rather than edited form inputs. It does not
embed kernel bytes or establish independent replay/accuracy acceptance.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Export interaction and replay remain unverified; the
full scientific/scalability objective remains open.

### Checkpoint 413: bound mission grid raster and reuse palette (2026-09-24)

The mission grid previously reset canvas width/height on every selection and
rebuilt filtered metric arrays and color strings. Palette extrema/colors now
depend only on the point array, and raster dimensions change only when needed.
Drawing resets the transform explicitly, avoiding accumulated scaling when the
backing buffer is reused. Raster size is capped at 4,194,304 pixels and 4096 per
edge, with DPR capped at two; browser backing/compositor overhead is separate.

A ResizeObserver and window resize listener schedule coalesced animation-frame
draws, with observer/listener/frame cleanup when dependencies change or unmount.
CSS controls the displayed dimensions independently of canvas backing dimensions.
Zero-size click geometry is ignored and selected highlights require a valid
index. Selection still redraws all cells; this is not an offscreen heatmap cache.

Only source/CSS inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Resize/interaction behavior and performance gains are
unmeasured; the full scientific/scalability objective remains open.

### Checkpoint 414: drain failed state-tile download lanes before returning (2026-09-24)

fetchStateTiles previously used fail-fast Promise.all: its rejection cleared
retained results and returned while peer lanes could still be cancelling bodies
or releasing admission. Each lane now catches its terminal rejection, records
the first observed failure and aborts peers. The aggregate waits for all lanes
to settle before clearing retained tiles and propagating failure. The caller's
abort listener remains installed through this cleanup, and the caller controller
is never aborted by the loader.

A separate failure flag and per-tile completion flag avoid treating a rejection
whose value is undefined as success. Existing two-attempt retry behavior and
protocol validation remain unchanged. This drain relies on fetch/acquire/body
cancellation eventually settling; it does not preempt synchronous decode or make
arbitrary custom transports cancellable.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Concurrent failure/cancellation behavior remains
unverified; the full scientific/scalability objective remains open.

### Checkpoint 415: join the original state-window cancellation (2026-09-24)

The state-window stream now retains one cancellation promise shared by the abort
listener and generator cleanup. Previously the listener discarded reader.cancel's
promise and cleanup called cancel again; an already-closed stream's second call
could settle before the first underlying source cancellation. Admission is now
released after joining the original operation, then releasing the reader lock.
Before response headers exist, cancellation does not cache a no-op, so late
response cleanup can still cancel its body.

This change is specific to the state-window path. readBounded separately chooses
prompt abort return without awaiting underlying cancellation, so the ordinary
tile path's admission/transport completion boundary still needs reconciliation;
draining lane promises alone is not evidence of completed transport cleanup.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Cancellation ordering remains unverified and the full
scientific/scalability objective remains open.

### Checkpoint 416: retain reader admission through cancellation cleanup (2026-09-24)

readBounded now joins its retained cancellation promise on abort as well as
protocol errors. The JSON wrapper also awaits body cancellation on rejection.
This replaces the earlier prompt-abort-return policy so tile/Gaia owners cannot
release reservations while the original source cancellation is still pending.
Successful EOF reads keep their existing path.

The catalog bounded stream reader now also shares one cancellation promise
between its abort listener and finally block and awaits it before unlocking.
Catalog streaming and immutable acquisition await body cancellation for rejected
HTTP status, oversized headers and cancellation detected after headers. Existing
caller cleanup can therefore retain admission through these paths.

This intentionally depends on the underlying source's cancellation settling;
custom transports that never settle can still prevent cleanup completion. No
timeout is used to pretend that occupied capacity has been released. This is
source-level lifecycle work, not measured transport or memory acceptance.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Cancellation behavior and the full scientific and
scalability objective remain unverified.

### Checkpoint 417: retain shared acquisition leases through late validators (2026-09-24)

Shared acquisition already retained its lease until source loading settled after
the last consumer cancelled. Validation used a separate abort race, however, so
the consumer's finally block could release its lease while an asynchronous custom
validator still retained its owned buffer. Validation work is now tracked
separately: the caller can receive cancellation/timeout promptly, while consumer
release is deferred until the original validation promise settles either way.
The release closure is idempotent. Validation checks cancellation again before
invoking the callback on its scheduled turn.

Late completion cannot resume the cancelled export/cache-publication path.
Uncooperative validators may continue occupying capacity indefinitely; no false
release is used to claim that their work ended. Admission still counts shared
acquisitions, not all copies held by consumers of one URL or process-wide memory.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Shared-consumer and late-validator behavior remain
unverified; the full scientific/scalability objective remains open.

### Checkpoint 418: admit consumer-owned catalog validation copies (2026-09-24)

Immutable catalog consumers now acquire a separate per-realm validation permit
before copying the shared transport buffer. Two active validators permit at most
two admitted source copies (each limited by the existing 64 MiB artifact limit).
The existing FIFO admission implementation supplies the bounded queue, abort
handling and queue deadline. Same-URL consumers continue sharing acquisition,
but no longer bypass this copy-stage concurrency limit.

Validation admission is independent of acquisition admission, so it does not
require a second permit from the pool already held by the download. Both leases
are released after late validation settles on timeout/cancellation. Allocation
failure and cancellation before validation starts release acquired permits in
finally. Production binary validators and JSON/gzip callbacks were source-read
for nested acquisition; the inspected paths do not fetch inside validation.

This bounds admitted input copies, not arbitrary allocations inside validators,
parsed JSON, decompression, returned caller-owned buffers, or process-wide RSS.
No measured throughput or memory reduction is claimed. Only source inspection
and diff whitespace checks were performed: no tests, builds/typechecks,
numerical experiments, browser/device runs, CI waiting, commits or pushes.
Queue/concurrency behavior and the full scientific/scalability objective remain
unverified.

### Checkpoint 419: validate JSON decode budgets before selecting a format (2026-09-24)

parseMaybeGzipJson now requires its byte limit to be a safe integer between zero
and the existing 64 MiB artifact ceiling before inspecting the format. Previously
the plain-JSON path accepted NaN/Infinity budgets because its size comparison
could not reject them, while the gzip reader independently validated its limit.
Both paths now reject malformed or above-ceiling budgets consistently.

Malformed expected hashes are rejected before allocating a decompression stream.
The shared JSON decoder also enforces the artifact byte ceiling before hashing
or text decoding. These are byte-budget checks, not an exact bound on the engine's
parsed-object heap; JSON.parse is still synchronous and object expansion is not
measured. Existing gzip output limits and strict UTF-8 decoding are retained.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Decode behavior and the full scientific/scalability
objective remain unverified.

### Checkpoint 420: bound retained decoded catalog rows by estimated weight (2026-09-24)

SharedCatalogCache supports an optional validated weight budget in addition to
its entry limit. Admission evicts least-recently-used values until both limits
fit; an individually oversized value is delivered to current consumers without
retention. Cache hits preserve recency, clear resets weights with values, and the
constructor snapshots budget configuration. Existing caches without a weight
budget retain their entry-only behavior.

Search, record-chunk, lookup and sample caches each use a 32 MiB estimated-weight
budget while retaining their existing entry limits. The scalar-row estimator
counts string code units plus row/property allowances without serializing whole
shards into another JSON string. Types were checked to confirm these record
fields are scalar. Four independent weight budgets are not a measured heap cap;
active consumers, parsing, summaries/checksums and other realms remain outside.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Eviction behavior and memory/performance effects remain
unverified; the full scientific/scalability objective remains open.

### Checkpoint 421: bound summary and checksum cache retention (2026-09-24)

Checksum resolvers now expose a frozen deterministic retainedWeight estimate for
their bound path/hash map. The checksum cache applies an 8 MiB estimate budget
alongside its existing two-entry limit. Summary retention similarly uses a 1 MiB
estimate budget plus two entries, based on category/range keys and fixed field
allowances. Oversized entries remain available to the requesting consumer but
are not retained by the LRU.

bindCatalogSummary returns an owned projection of validated schema fields,
copying categories and range tuples instead of retaining arbitrary extra fields
from the original parsed object. The existing cache preparation freezes that
projection. Scientific counts, ranges and source identity checks are unchanged.
Source call sites consume the returned projection. These accounting estimates
exclude runtime overhead, active consumers and other realms; no heap cap or
measured performance benefit is claimed.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Cache behavior and the full scientific/scalability
objective remain unverified.

### Checkpoint 422: bound and cancel manifest cache ownership (2026-09-24)

Manifest promises previously remained in an unbounded map after success, while
reset only removed references without aborting source reads. Manifest loading
now uses the shared cancellable LRU with four retained values, propagates its
signal through pointer and immutable manifest reads, and clears/aborts ownership
on reset. Failed reads retain the public null result without caching that failure.
Existing generation protection and cloned caller/active manifests are preserved.

Cache identity now distinguishes an unpinned pointer from a requested release
literally named current. Manifest reads no longer inherit unrelated active
manifest metadata as their fetch configuration. Reset requests cancellation; it
does not synchronously prove that underlying cleanup has finished. This remains
an entry cap rather than a measured bound on manifest object heaps.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Version switching, cancellation and LRU behavior remain
unverified; the full scientific/scalability objective remains open.

### Checkpoint 423: snapshot and bound catalog search pagination (2026-09-24)

Source inspection confirmed search hydration snapshots the manifest and binds
index fields against records from the declared shard. Search now also captures
query, signal and pagination controls before the first await. Cursor must be a
nonnegative safe integer; page size and distinct shard budgets must be integers
within 1–1200 and 1–30 respectively, matching existing default UI budgets. Invalid
controls fail before loading instead of allowing NaN/Infinity or later caller
mutations to change a page. Existing callers use defaults or smaller bounds.

Catalog metadata admission now validates the required orbitClassName string and
optional nonempty packedDesignation string. These fields were already compared
during index-to-record binding but previously lacked their own type checks.
No new source dataset or scientific coverage is claimed by these changes.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Search and metadata behavior remain unverified; the
full scientific/scalability objective remains open.

### Checkpoint 424: bind UI search pagination to its manifest and query (2026-09-24)

Search loading accepts an explicit manifest snapshot, retaining the existing
global-manifest default for callers that omit it. CatalogWorkspace passes its
own manifest for the first page and retains that identity and query with the
cursor. Subsequent pages use the retained manifest. A changed manifest reference
or trimmed query hides stale totals/load-more controls and blocks cursor reuse.

Before publishing successful first/subsequent pages, the UI checks current store
manifest/query identity in addition to cancellation. This prevents a late result
from merging into another search during the interval before effect cleanup runs.
The guard uses in-memory manifest identity; it is not a portable cursor token or
an assertion of immutable files on a remote server.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Pagination/version-switch behavior and the full
scientific/scalability objective remain unverified.

### Checkpoint 425: bind browse failures and successes to the active load (2026-09-24)

CatalogWorkspace uses one memoized ownership guard for ordinary section loading,
section pagination, first search pages and search pagination. Before publishing
success or failure it checks cancellation, exact active controller, current
manifest identity, trimmed query and orbit-class filter. This extends the prior
search success guard to failure callbacks and section browsing, closing the
interval before effect cleanup has aborted an obsolete request.

Finally blocks still clear controller references only when they own them. The
guard dependencies are included in the loading effects. This checkpoint does
not cover the separate exact-scan controller/progress path, whose ownership
checks require their own inspection.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Callback race behavior and the full scientific and
scalability objective remain unverified.

### Checkpoint 426: bind exact-scan callbacks and hydration manifests (2026-09-24)

Exact-scan progress, success, failure and pagination callbacks now check the
active controller, cancellation, current manifest reference and a scan key
recomputed from live store filters. Manifest replacement also triggers the active
scan cleanup effect even when the version-based scan key stays unchanged.

Hydration queues retain the serialized scan manifest identity. Later pages clone
the supplied manifest and reject a different serialized snapshot, instead of
accepting any manifest with the same version name. This is deliberately strict
serialization equality, not a canonical cryptographic identity; property-order
changes may reject an otherwise equivalent caller-created manifest. Normal page
callers reuse/clone the same manifest. Full scan-key/source identity across
retained UI results still requires separate inspection.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Exact-scan callback and hydration behavior remain
unverified; the full scientific/scalability objective remains open.

### Checkpoint 427: include manifest snapshots in retained scan keys (2026-09-24)

Production scan-key callers now pass the full manifest, including its source,
content identity and release configuration, rather than version name alone.
The key function retains its legacy string-call form but all source call sites
use the manifest form. Catalog and element-space displays therefore stop matching
retained exact results when same-name manifest contents change. UI render keys
are memoized by manifest/filter identity to avoid serializing on clock-only renders.

Element-space delayed scan launch, progress, result and failure publication now
check cancellation, live manifest reference and the source-bound scan key.
Manifest encoding retains the strict JSON ordering behavior documented for
hydration; this is internal identity, not an independently authenticated hash.
Remote files still depend on their existing integrity checks.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Retained-result and cross-view behavior remain
unverified; the full scientific/scalability objective remains open.

### Checkpoint 428: bind catalog selection scope to its source snapshot (2026-09-24)

Select-all-filtered scope now retains serialized manifest identity alongside its
version, filter snapshot and count. The action accepts the manifest object and
checks live manifest/filter ownership, an available exact result and matching
nonnegative integer count before publishing. It reports whether selection was
accepted, so stale UI actions do not emit a success toast.

CatalogWorkspace only uses a selection scope for table highlighting, selected
counts and its clear-selection control when manifest identity and filters match
the current view. This closes the previous version-only/presence-only display
path. Scope is still a declarative filter selection rather than enumerated IDs;
trajectory export uses its existing trajectory-frame evidence and does not
consume this scope. No new bulk export is claimed.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Selection behavior and the full scientific/scalability
objective remain unverified.

### Checkpoint 429: bind streaming launch identity to the complete manifest (2026-09-24)

CatalogWorkspace's streaming launch key now contains the complete manifest
instead of only version and release path. Same-name manifest content/configuration
changes invalidate the retained launch request, making streaming false and
unmounting the old stream through the existing render branch. A new launch must
be made against the current source. Key computation is memoized so unrelated
clock/display renders do not repeatedly serialize the source snapshot.

Source inspection found CatalogStreamCanvas already binds its load owner to
manifest/filters, terminates its worker and disposes renderer buffers on effect
cleanup, and gates evidence export on matching source ownership. This checkpoint
changes the parent launch identity; it does not claim runtime teardown timing,
GPU deallocation measurements or source coverage expansion.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Stream invalidation behavior and the full scientific
and scalability objective remain unverified.

### Checkpoint 430: validate stream terminal fields before evidence publication (2026-09-24)

Source inspection confirmed terminal source/drawn counts are compared to uploaded
tiles, screened shard order and totals, and final row masks. The receiver now
rejects null or unknown response types explicitly rather than dereferencing them
or letting an unknown type enter the completion branch. The permitted types match
the worker protocol.

Completion now requires retainedEpochs to equal the admitted mode in both
directions. Temporal speed bounds are validated before publishing source-selection
and screening state, rather than after those setters. The current worker emits
the retention boolean explicitly. These checks establish protocol consistency,
not independent source completeness or scientific accuracy.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Terminal-message behavior and the full scientific and
scalability objective remain unverified.

### Checkpoint 431: bind epoch evidence to each uploaded source block (2026-09-24)

The renderer now records epoch/drift pairs while each upload slice or reuse
receipt advances through the admitted source-block counts. A block cannot mix
different epoch/drift receipts, and completion requires every block to be covered.
Final blockEpochs entries must match those observed pairs, in addition to the
existing contiguous ranges, totals, maximum drift and epoch-range checks.

Previously aggregate equality could not distinguish block epochs exchanged
between equal-size blocks. The new scratch array uses two Float64 values per
source block, reset for each epoch update, rather than per-star evidence. It
binds message receipts to upload order; it does not independently recompute
positions or establish physical prediction accuracy.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Mixed/reused-epoch behavior and the full scientific
and scalability objective remain unverified.

### Checkpoint 432: enforce epoch start/data/completion ordering (2026-09-24)

The stream receiver now distinguishes a requested epoch from one whose start
receipt has been accepted. It rejects a duplicate start and tile/reuse/completion
messages before that start, rather than resetting counters mid-upload or relying
on later aggregate failures. The state resets on new requests, cancellation,
failure and successful completion. Epoch errors may still arrive before start.

Epoch tiles require Float64Array coordinates before scheduling upload. New epoch
requests also stop at safe-integer identifier exhaustion. Existing stale-request
handling continues returning transferred buffers/acknowledgements without
publishing their positions. No message-order or buffer-recycling tests were run.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Epoch lifecycle behavior and the full scientific and
scalability objective remain unverified.

### Checkpoint 433: fail mismatched current reuse acknowledgements promptly (2026-09-24)

Worker reused-block waiters now retain a reject callback as well as resolution.
An ACK matching the current request/start row but declaring a different count
fails that waiter immediately instead of being ignored until its 30-second
deadline. Unmatched late ACKs continue to be ignored. Existing source ACK
deduplication and returned-buffer shape checks were inspected and retained.

Null/unknown request types take the same channel-failure cleanup path as message
decode errors; unknown messages can no longer enter the initial start branch.
Transfer-window tile identifiers also stop before safe-integer exhaustion,
settling credits with a terminal failure rather than reusing imprecise IDs.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. ACK failure/recycling behavior and the full scientific
and scalability objective remain unverified.

### Checkpoint 434: discard failed worker snapshots and reject later work (2026-09-24)

The catalog worker now has a terminal-failure state that clears retained spatial
coordinates, index, available-row count, epoch store/pending epoch and pending
views, and invalidates active spatial selections. Channel decode/unknown-request
failure, invalid returned source buffers, current epoch computation failure and
non-cancellation initial-load failure enter this path. Later messages cannot
restart or query a failed worker snapshot.

Deliberate cancellation retains the existing stopped-snapshot behavior. Active
async functions may still hold local references until their cancellation or
generation checks run; clearing globals is not proof of immediate GC. Parent
renderer failure also clears the new per-block epoch observation scratch array.
The owner still terminates failed workers through its existing error path.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Failure cleanup and memory effects remain unverified;
the full scientific/scalability objective remains open.

### Checkpoint 435: release epoch receipt scratch on cancellation (2026-09-24)

Cancelling an incomplete epoch upload now clears the per-source-block epoch
receipt scratch and its cursors alongside the discarded CPU/GPU snapshot. The
component can remain mounted after cancellation, so effect cleanup alone did not
release that array. Initial-load cancellation still retains the uploaded prefix
at its original epoch; it does not make that prefix an exportable complete scan.

Source inspection traced cancellation through worker ownership and view request
guards: discarded snapshots terminate their worker and reject queued callbacks,
while coherent stopped snapshots request selections restricted to uploaded rows.
No additional selection behavior was changed.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. Cancellation and memory effects remain unverified;
the full scientific/scalability objective remains open.

### Checkpoint 436: reuse GPU selection allocation across views (2026-09-24)

Source inspection matched the spatial selection arrays to the stream planner's
per-row reserve: worker coordinates, cell winners, new output indices, the prior
CPU selection and the GPU index buffer can coexist. Membership bits and spatial
block bounds have separate fixed reserves. This is allocation accounting, not a
measured browser/GPU memory bound.

The renderer now tracks GPU index allocation independently of the current
selection. Smaller selections overwrite the existing buffer; cleared views and
epoch invalidation keep that capacity available. Only growth reallocates it,
and disposal clears the tracking value. The first empty selection still creates
a zero-length data store. Draw count remains the current selection length, so
unused old indices are not drawn. Existing strictly increasing, in-range index
validation bounds the allocation to four bytes per admitted row.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, browser/device runs, CI waiting, commits or pushes
were performed. Allocation reuse and rendering behavior require later runtime
verification; the full scientific/scalability objective remains open.

### Checkpoint 437: bound main-thread spatial view requests (2026-09-24)

Worker-side latest-request replacement cannot retract selection buffers already
posted to a busy main thread. The stream canvas now admits one outstanding view
request. Camera, selection and loaded-row changes continue updating current refs
and view identity, without posting more requests while its receipt is outstanding.
On a stale matching receipt, the canvas discards the old result and draws/requests
the latest state. Nonmatching receipts cannot release another request's slot.

Explicit cancellation and epoch changes clear the slot because they invalidate
worker selections without requiring a result receipt; worker termination clears
it as well. Context restoration retains the outstanding receipt until it arrives,
and its existing finish path redraws the current view. This limits ordinary
camera-update traffic to one outstanding result instead of a growing message
queue. It does not promise immediate cancellation of a now-obsolete spatial pass:
the latest view waits for that bounded pass to return. Lifecycle-invalidated
messages can still arrive and are discarded by their request identity.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, browser/device runs, CI waiting, commits or pushes
were performed. Queue behavior and responsiveness remain unverified at runtime;
the full scientific/scalability objective remains open.

### Checkpoint 438: time-aware point-worker cancellation checkpoints (2026-09-24)

The spatial-selection source already bounds row, cell and membership traversal
with cooperative checkpoints; no further changes were made to those loops.
The separate shared catalog-point worker still prepared and propagated up to
20,000 rows before yielding, independent of elapsed work time.

Preparation and propagation now process at most 1,024 rows between elapsed-time
checks and yield when the four-millisecond scheduling target is reached. The
existing 20,000-row outer boundary still yields even if the clock target has not
been reached. Every yield checks generation before continuing. Progress messages
remain at the previous outer boundaries rather than increasing with the number
of cancellation checkpoints. Source order, Float64 output, source preparation
and the orbital solver are unchanged.

The target is not a latency guarantee: allocations and a single row solve are
not preemptible, and scheduling depends on the runtime. Only source inspection
and diff whitespace checks were performed. No tests, builds/typechecks,
benchmarks, browser/device runs, CI waiting, commits or pushes were performed.
Runtime responsiveness and the full scientific/scalability goal remain unverified.

### Checkpoint 439: serialize point-worker job replacement (2026-09-24)

The point worker previously started each asynchronous message handler immediately.
An initialize/compute replacement delivered during a cooperative yield could
allocate another prepared/output array before the previous job observed its
generation change. A single drain now awaits active job exit before starting the
latest pending request. Further delivered replacements replace that pending
slot, and reset invalidates the active generation and clears pending input.
Errors from superseded jobs remain suppressed; current failures retain their
request identity.

The current React owner already terminates its worker on dataset/mode changes,
and its scheduler coalesces clock requests. This change strengthens the worker
protocol's replacement path; it is not evidence that the normal UI previously
accumulated these allocations. Transferred input may still coexist with the
active job, browser message queues are outside this pending-slot bound, and
function exit makes old buffers eligible for GC rather than forcing collection.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, browser/device runs, CI waiting, commits or pushes
were performed. Job replacement and memory effects remain unverified at runtime;
the full scientific/scalability objective remains open.

### Checkpoint 440: terminate failed point-worker owners (2026-09-24)

The point-worker hook now routes scheduler errors, worker errors, response decode
errors and exceptions while handling a response through one terminal cleanup.
Cleanup resets scheduler state without sending to the failed channel, clears its
published ref, detaches all worker handlers and terminates the worker. Display
coordinates and progress are cleared, with the original failure message retained.
Subsequent clock/budget effects no longer target that instance. Dataset/mode
changes continue to create a fresh owner through the existing effect lifecycle.

Element-buffer construction and scheduler setup calls after worker creation are
also covered by this cleanup. A failed setup does not continue queuing an epoch,
and the initial state-reset microtask cannot erase the new failure. Normal effect
cleanup uses the same release function. This does not guarantee immediate browser
memory collection or verify constructor-failure behavior.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, browser/device runs, CI waiting, commits or pushes
were performed. Failure cleanup remains unverified at runtime; the full
scientific/scalability objective remains open.

### Checkpoint 441: surface point-worker creation failure and explicit retry (2026-09-24)

Worker-constructor exceptions now produce a guarded hook error rather than
escaping the React effect. The failure clears positions/progress, suppresses
the queued successful-initialization reset, and does not allocate source elements
or publish a scheduler. Its queued state update is ignored after owner cleanup.

Both catalog and explorer error banners now offer the existing localized Retry
action. The hook restarts its owner effect, releasing the previous instance and
using current records, mode, epoch and temporal budget. There is no automatic
retry loop. The catalog placeholder reports unavailable instead of loading when
point computation has failed, and its error banner is exposed as an alert.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, browser/device runs, CI waiting, commits or pushes
were performed. Constructor failure, retry interaction and accessibility remain
unverified at runtime; the full scientific/scalability objective remains open.

### Checkpoint 442: audit result ownership and locate event-distribution gap (2026-09-24)

Source inspection of the point scheduler, hook and explorer found existing
request/generation, mode, epoch and row-count binding; explorer draw counts are
zero for a mismatched computed epoch. Retry creates a new owner and cleanup
invalidates the old owner's callbacks. No further ownership changes were made.

The uncertainty workstream was then traced through covariancePropagation.ts,
nonlinearEnsemble.ts, ensembleReceipt.ts, sbdbReceiptBinding.ts and
adaptiveIntegrator.ts. The nonlinear ensemble integrates each valid source draw
to one final endpoint and retains invalid draw identities. Its receipt checks
endpoint moments and seeded source offsets. Those are endpoint distributions,
not event-time distributions. The integrator exposes accepted endpoint copies
but explicitly has no dense output or event detector; the ensemble does not
collect even that accepted-step trajectory.

Consequently, adding event histograms to the current endpoint result would not
fulfill the goal. The next scientific implementation needs a bounded trajectory
event evaluation path with an explicit event function and time/frame contract,
bracketing/refinement evidence, retained failed/unresolved draw identities and
missed-event limitations before connecting an ensemble event distribution to the
UI/export. Existing endpoint results must retain their non-probability labeling.
This audit identifies the implementation gap; it does not implement or validate
event distributions or claim complete event detection.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting, commits
or pushes were performed. All unfinished acceptance-ledger rows remain open.

### Checkpoint 443: asynchronous trajectory events and dynamics distance adapter (2026-09-24)

Added trajectoryEvents.ts for asynchronous scalar sign-change searches with
bounded scan/evaluation/result counts, cancellation and cooperative scheduling.
Receipts retain original scan brackets, final bisection brackets and values,
sampled-zero classification, elapsed TDB/reference epoch and missed-event limits.
Failures and exhausted budgets reject the search instead of publishing partial
success. Continuity and frozen-source semantics remain evaluator requirements;
bracket widths are not physical uncertainty or a completeness certificate.

Added distanceEvents.ts to connect that search to restricted DE440 dynamics.
Each scalar query independently integrates the same frozen barycentric J2000
initial six-state and compares simultaneous geometric distance to a prescribed
force-model body. The entire scan/refinement shares 250,000 derivative calls,
at most 2,048 event evaluations, the existing integrator settings and the frozen
force window. It retains initial state, force evidence, integration settings and
counters. User thresholds are explicitly not physical radii or collision claims.
Reintegration avoids inventing dense output but has a substantial cost and no
measured responsiveness claim.

These are unverified engine foundations. Worker/UI/export integration, binding
initial states to source covariance draws, preserving failed/unresolved draw
identities in event distributions, native access and independent event cases
remain required. No event-distribution or user-facing delivery claim is made.
Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting,
commits or pushes were performed; the full objective remains open.

### Checkpoint 444: bind distance-event searches to seeded covariance draws (2026-09-24)

Added ensembleDistanceEvents.ts. It freezes the six-parameter solution-epoch
source, generates bounded seeded joint offsets, reuses the nonlinear conic state
conversion, and converts each valid heliocentric ecliptic state to barycentric
J2000 using the prescribed reference Sun state. Each draw runs the distance-event
search from that fixed initial state. All draws share 250,000 force evaluations;
per-draw event calls and results are bounded as well.

The result preserves every original draw index, offsets and coordinate validity.
Searched draws retain their full search evidence; known trajectory failures retain
their stage; typed search-budget exhaustion produces unresolved draws and an
unsearched tail after global force exhaustion. Source/model contract failures and
cancellation reject the ensemble. Validation occurs before draw conversion, so an
all-invalid ensemble cannot conceal an invalid search specification.

Counts distinguish searched, failed and unresolved without reclassifying missing
results as no event. A searched draw with no detected crossing is still only a
sampled negative result. No probability or cross-draw event correspondence is
inferred, and differing event multiplicities are preserved rather than collapsed
into a timing histogram. Full event-distribution interpretation, Worker/UI/export
and native integration, source-byte receipts and independent reference cases
remain pending; these engine functions are not yet user-facing delivery.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device runs, CI waiting,
commits or pushes were performed. Scientific correctness, performance and the
full objective remain unverified.

### Checkpoint 445: event-ensemble worker and source receipt contract (2026-09-24)

Added the ensemble-events dynamics request kind with bounded distance threshold,
target, scan step, localization tolerance, evaluation/event limits and the existing
seed/sample settings. Its search spans the requested elapsed interval, including
negative durations, under the same frozen DE440 force window. Refinement and
manual extra-force adoption are rejected for this kind. The job owner copies the
nested search settings before asynchronous source hashing and receipt checking.

The dynamics Worker parses the submitted covariance, executes seeded event
searches and transfers owned sample/coordinate arrays with original source bytes,
SHA-256, calculation identity and reference/elapsed epoch. Existing worker timeout,
termination and kernel-buffer admission remain in force.

The receiver applies the existing file, force-model, coverage and SBDB metadata
binding, then checks event-specific request settings, regenerated seeded offsets,
draw identities/validity/failure stages, search counts and budget totals. Searched
draws require the adopted geometric definition, integration settings, chronological
scan/localization brackets and consistent sign directions or sampled-zero labels.
Failed and unresolved draws cannot carry successful search receipts. These are
contract checks, not recomputation of trajectories or scientific validation.

Browser controls/results/export, native consumption, offline entry points and
independent numerical/reference evidence remain pending. Only source inspection
and diff whitespace checks were performed. No tests, builds/typechecks, numerical
experiments, browser/device runs, CI waiting, commits or pushes were performed;
the full objective remains open.

### Checkpoint 446: browser controls and export for distance-event draws (2026-09-24)

The covariance panel now includes a bilingual distance-event ensemble section.
It exposes the prescribed target center, caller-defined threshold, elapsed TDB
interval, seed/sample count, scan/localization settings and resource limits.
Unsupported additional source axes remain unavailable. The shared request
validator rejects targets outside the force-body set before starting a worker.

Run/cancel and source/setting changes own the job through generation checks;
source replacement terminates it and clears stale state. Results show all draw
statuses and force counts, while one selected draw exposes at most its bounded
event list. Sampled zeros remain unclassified and sign changes are labeled as
distance entry/exit. Zero detections, failed draws and unresolved budgets are
explicitly distinguished. Reference epochs retain the existing two-part TDB
display. Model limitations and the fact that thresholds are not physical radii
or event probabilities remain visible.

JSON export includes all draw receipts, original source bytes/hash, seed/offsets,
settings, brackets, model evidence and build identity; typed arrays are serialized
with an explicit invalid-coordinate/null convention. Browser rendering, cancellation
and export have not been exercised. Native/offline access, event correspondence
and distribution interpretation, independent reference cases and full scientific
acceptance remain open. Only source inspection and diff whitespace checks were
performed; no tests, builds/typechecks, numerical experiments, browser/device runs,
CI waiting, commits or pushes were performed.

### Checkpoint 447: local-file event-ensemble entry point (2026-09-24)

Added scripts/search-sbdb-events.mjs with explicit model adoption, bounded local
source/settings reads, pinned local kernel/GM ingestion, cooperative Ctrl+C and
new-file-only receipt writing. It uses the same request validator, event engine
and typed source/result checks as the browser before serializing arrays. Offline
receipts retain both original input files and hashes, plus named implementation
module hashes. No network retrieval or deployment/release action is introduced.

The newly shared runtime import paths now include .ts extensions for Node's
existing strip-types invocation, and the event budget error uses an erasable
field declaration instead of a constructor parameter property. These are source
compatibility changes, not an executed CLI/typecheck result. Added usage and
interpretation documentation in distance-event-ensembles.md, explicitly marking
the sample settings and command as unexecuted and distinguishing the browser
deadline from offline computational limits.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device/CLI executions, CI waiting,
commits or pushes were performed. Native consumption, event correspondence and
distribution interpretation, independent references and runtime acceptance remain
open, along with the rest of the original objective.

### Checkpoint 448: explicit conditional first-detected timing summaries (2026-09-24)

Added eventTimingSummary.ts and connected it to engine receipts, browser display,
JSON export and offline implementation hashes. Each direction independently
selects the first chronologically detected sign-change event in a searched draw.
An earlier unclassified sampled zero excludes the draw from that direction's
summary. Selected event/draw indices and failed, unresolved, not-detected and
ambiguous exclusions are all retained, with counts covering the complete input.

For at least two selected draws, 5th/50th/95th conditional empirical quantiles use
nearest ranks without interpolation. Separately sorted lower/upper localization
endpoints enclose those order statistics under the reported numeric brackets;
they do not include integration, finite-sampling or physical uncertainty. The
receiver reconstructs the summary from already-checked draw events before
acceptance. The UI shows ranks, subset counts, exclusions and the limitations
beside the numbers. No cross-draw physical-event correspondence, population
quantiles or physical probability is claimed.

This implements a defined descriptive event-time statistic, not full probabilistic
event prediction or complete event detection. Independent statistical/numerical
references, browser/native acceptance and the other original requirements remain
open. Only source inspection and diff whitespace checks were performed; no tests,
builds/typechecks, numerical experiments, browser/device/CLI runs, CI waiting,
commits or pushes were performed.

### Checkpoint 449: bind event integration states to reported sample coordinates (2026-09-24)

Source inspection found that event receipt checks required finite integration
initial states without verifying their relationship to the selected draw's
heliocentric coordinates. The engine now reports initialFrameTransform with fixed
rotation/unit constants, reference epoch, prescribed Sun six-state and ephemeris
identity. The receiver binds adopted solar GM to the force evidence and checks
every searched draw's six integration components against the reported sample,
rotation, scaling and translation. UI details and exports retain this evidence.

This checks internal sample/state association, not independent source-coordinate
or SPK evaluation. The reported Sun state still requires independent scientific
reference evidence; its uncertainty and GM uncertainty are not propagated.
Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device/CLI runs, CI waiting,
commits or pushes were performed. The full objective remains open.

### Checkpoint 450: distinguish interrupted and unstarted event draws (2026-09-24)

Unresolved event draws now carry a structured stage: search for budget exhaustion
inside a started search, or not-started for the valid tail after global force
exhaustion. The selected-draw UI and exports expose this distinction instead of
depending on free-text reasons. Coordinate failures retain their independent
status even after the budget is exhausted.

Receipt checks now accumulate force counts in original draw order. An unstarted
draw requires the prior total to equal the shared 250,000-call limit and zero
new calls; a started force-budget failure must reach that limit. Searched and
integration-failed draws cannot start after exhaustion. Per-draw event/evaluation
budget failures remain distinct from global force exhaustion. These are internal
receipt checks and do not independently measure executed work.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device/CLI runs, CI waiting,
commits or pushes were performed. Runtime behavior, independent scientific
evidence and the full original objective remain open.

### Checkpoint 451: retain search-budget interruption counters (2026-09-24)

Trajectory budget errors now carry an owned progress snapshot: attempted and
completed scalar evaluations, retained localized-event count and last attempted
elapsed TDB time. A force-budget error from the asynchronous trajectory provider
is enriched at the scalar-search boundary. Started unresolved ensemble draws
require this evidence; unstarted tails retain null progress.

Receipt checks bind the counts to request limits. Evaluation exhaustion must
reach the requested evaluation cap, event exhaustion must reach the retained
record cap, and force exhaustion must have one incomplete scalar evaluation in
addition to reaching the shared derivative limit. UI and export expose these
diagnostics without returning incomplete event lists as successful results.
The last attempted time is explicitly not a coverage frontier, since refinement
can query earlier times. Unresolved draws remain excluded from timing summaries.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device/CLI runs, CI waiting,
commits or pushes were performed. Independent scientific/runtime evidence and
all other unfinished original requirements remain open.

### Checkpoint 452: preserve per-draw localization resolution failures (2026-09-24)

The shared trajectory scan interval calculation now distinguishes exactly zero
duration from a positive quotient that underflows to zero. Search, ensemble
admission, request validation and receipt checks use the same rule: a nonempty
window requires at least one interval and both endpoint evaluations.

An otherwise valid sign-change bracket that cannot reach the requested tolerance
because its midpoint is no longer representable now raises a typed localization
failure with retained bracket, endpoint values and progress counts. The ensemble
retains it as a failed localization draw and continues other draws; it does not
publish a successful event or use that draw in timing statistics. The receiver
checks the opposite signs, excess width, absent interior midpoint, window bounds
and completed evaluation counts. UI and export expose the remaining bracket.
Invalid settings and scan-grid failures remain whole-job errors.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, numerical experiments, browser/device/CLI runs, CI waiting,
commits or pushes were performed. Independent scientific evidence, native
consumption and all other unfinished original requirements remain open.

### Checkpoint 453: native-route audit and backend trajectory search core (2026-09-24)

Current Android OrbitCovariancePanel and iOS NativeOrbitCovarianceView already
contain conditional covariance and supplied-offset endpoint ensemble flows through
the Go backend. They are not consumers of the new browser event receipt, and no
distance-event endpoint was found in that route. Native endpoint propagation must
not be confused with native event-search delivery.

Added internal/orbituncertainty/trajectory_events.go as the backend prerequisite:
bounded chronological scalar scans, sampled-zero/sign-change distinction,
bisection brackets, cancellation at evaluation boundaries, typed budget progress
and typed numerical-localization failure. A nonempty interval requires both
endpoints even when its quotient underflows. Every error returns no partial
successful result. The receipt explicitly preserves missed-event and physical
uncertainty limitations. The backend method identifier is distinct from the
asynchronous browser implementation; cross-language numerical agreement is not
claimed.

Dynamics/sample adaptation, HTTP contract, native request/report models and UI,
and independent cross-language evidence remain pending. Only source inspection,
gofmt formatting of the new Go file and diff whitespace checks were performed.
No tests, compilation/typechecks, numerical experiments, browser/device/CLI runs,
CI waiting, commits or pushes were performed. The full objective remains open.

### Checkpoint 454: bounded backend distance-event ensembles and HTTP route (2026-09-24)

Added the Go supplied-offset adapter for DE440 distance-event searches. It retains
all draw identities, coordinate failures, known integration/numerical failures,
localization brackets and budget-interrupted or unstarted draws. All draws share
250000 derivative calls; each scalar query integrates from the same initial state.
The receipt records the adopted ecliptic-to-J2000 rotation, prescribed reference
Sun translation, force evidence, explicit search settings and integration settings.
Known sample failures are typed separately from unexpected source/provider errors.
Finite state components whose relative distance overflows are sample failures.

Added POST /v1/orbit/covariance/ensemble/events using the existing bounded compute
queue and a 20-second context. Explicit numeric fields reject missing/null inputs;
the original-source request is bounded to 3 MiB, supplied offsets to 128 six-axis
draws, per-draw scalar calls to 2048 and event records to 128. Admission checks the
scan budget and exact eleven-body exclusion plan before queuing. Responses use
the eventEnsemble envelope and an 8 MiB serialized-response limit. Deadline or
unexpected failures return no successful partial receipt. This is supplied-offset
analysis, not a seeded probability sample or an occultation/collision prediction.

Android/iOS event request/report/UI integration, backend timing summaries and
independent cross-runtime numerical acceptance remain pending. Source inspection,
Go formatting and diff whitespace checks only; no tests, compilation, numerical
experiments, application runs, CI waiting, commits or pushes. The complete goal
is not achieved and all earlier unresolved requirements remain open.

### Checkpoint 455: Android event request, receipt and cancellable transport (2026-09-24)

Added an immutable explicit-window OrbitEventRequest using the backend's supplied
offset contract. Admission checks finite settings, target membership, chronological
window, scan-call budget and complete six-axis draws before encoding. The existing
source/model adoption object is reused without treating events as endpoint states.
The force receipt checker now accepts an explicit window while its existing
endpoint callers retain their original zero-to-duration behavior.

OrbitEventReport binds the original SBDB conversion, offsets and indexed source
validity, adopted solar GM and pinned force evidence, frame-transform constants and
reported initial states, scalar-search settings, localized events and typed budget
or numerical failure diagnostics. It checks per-draw and aggregate counts and
shared-budget lifecycle, retains immutable event records and original export bytes,
and does not publish incomplete event lists as successful searches. Transformation
checks permit cross-runtime floating-point rounding; they are not independent
ephemeris or coordinate validation.

StellarMotionService.loadEvents uses the existing HTTPS, cancellation, deadline,
content-type and bounded-body transport with the new 8 MiB response ceiling.
Android event UI, iOS request/report/UI integration, backend timing summaries and
independent runtime/scientific acceptance remain pending. Only source inspection
and diff whitespace checks were performed; no tests, compilation/typechecks,
numerical experiments, application runs, CI waiting, commits or pushes. The full
objective remains active and unverified.

### Checkpoint 456: Android event controls and bounded per-draw display (2026-09-24)

OrbitCovariancePanel now exposes the supplied-offset distance-event request under
ensemble mode. It takes an explicit chronological TDB-offset window, target body,
geometric threshold, scan step, localization tolerance and scalar/record budgets.
Integer fields reject fractions before narrowing. Endpoint duration and SRP are
disabled for this mode; covariance refinement remains hidden for all ensembles.
Existing adoption and explicit eleven-body exclusions still apply.

The request follows the existing cancel/deadline/generation lifecycle and source
import binding. Any input or mode change clears the displayed receipt and export;
late callbacks cannot replace the current generation. Summary counts retain
searched, failed and unresolved distinctions. Previous/next controls expand only
one source draw at a time, including diagnostics or at most 128 detected events.
Full export retains all draws rather than the currently visible page. English
and Chinese resources explain sampled sign changes, ambiguous zeros, numerical
brackets and geometric-distance limitations without asserting physical events.

Only source inspection and diff whitespace checks were performed. No tests,
compilation/typechecks, device/browser execution, CI waiting, commits or pushes.
Android interaction remains runtime-unverified. iOS event integration, backend
timing summaries, independent scientific acceptance and earlier open requirements
remain unfinished; the full objective is still active.

### Checkpoint 457: iOS event models, source binding and network transport (2026-09-24)

Added NativeOrbitEvents.swift to the Xcode sources with an immutable explicit
supplied-offset request, scalar-event and progress models, and full event-ensemble
receipt binding. Request admission bounds finite chronological windows, scan
budgets, target membership and six-axis offsets before narrowing or encoding.
The force checker accepts an explicit window without changing endpoint callers.

The decoder checks source bytes/identity, adopted GM, force evidence, transform
constants and reported initial states, successful brackets, failure classifications,
interrupted progress, unstarted tails and aggregate shared-force accounting. It
retains all indexed draws, diagnostics and original export data. These checks are
internal consistency evidence only, not independent scientific validation.

The existing scientific service now exposes loadEvents with cancellation, a
25-second client deadline and the backend event route's 8 MiB response cap.
Source review found the nested coordinate decoder still imposed 4 MiB on the
whole event response; its internal initializer now accepts an explicit response
limit, with existing callers retaining the 4 MiB default and event decoding
passing 8 MiB. Android's nested validator has no conflicting whole-response cap.

iOS event UI, backend timing summaries and independent scientific/runtime
acceptance remain pending, along with prior unresolved goal requirements. Source
inspection and diff whitespace checks only; no tests, compilation/typechecks,
application execution, CI waiting, commits or pushes. The goal is not complete.

### Checkpoint 458: iOS event controls, draw navigation and full export (2026-09-24)

NativeOrbitCovarianceView now exposes distance-event mode inside supplied-offset
ensembles. Explicit TDB-offset window, target, geometric threshold, scan step,
localization tolerance and integer budgets construct NativeOrbitEventRequest.
The event branch returns before endpoint duration, SRP or refinement admission;
those inapplicable controls are hidden. No probability sampling is implied.

The async result retains its submitted request for reference-epoch, search-window
and threshold display. Input/mode/lifecycle changes cancel the task, replace the
generation and clear the event receipt/request pair; stale callbacks cannot
publish a result. The view reports searched/failed/unresolved counts and force
evidence, with previous/next navigation expanding one indexed draw at a time.
Draw diagnostics preserve interrupted progress and numerical-localization failure
brackets. Full original-response export includes every draw. English/Chinese
labels distinguish sampled zeros and sign-change candidates from physical events.

Only source inspection and diff whitespace checks were performed. No tests,
compilation/typechecks, application runs, CI waiting, commits or pushes. Native
interaction and numerical behavior remain unverified. Backend event-time summaries,
independent scientific acceptance and earlier unresolved objective requirements
remain pending; the overall goal is active, not achieved.

### Checkpoint 459: backend conditional first-detected timing summaries (2026-09-24)

Added a context-aware, bounded Go timing summary over the full ordered event draw
set and included it in the backend event receipt. Decreasing and increasing
directions independently select the earliest detected sign-change record in the
chronological window, including negative offsets. Any earlier or coincident
unclassified sampled zero excludes the draw for that direction. Failed,
unresolved, not-detected and ambiguous-zero exclusions retain original indices.

For at least two selected draws, the summary reports nearest-rank 5th, 50th and
95th percentiles without interpolation or addition to large Julian dates.
Separately sorted lower/upper localization bounds retain numerical order-statistic
enclosures even when interval overlap changes rank. With fewer selected draws,
quantiles remain null. Caller-supplied offsets are not assigned a probability
law; these summaries do not identify a common physical event across samples or
establish physical uncertainty, sampling adequacy or convergence.

Only source comparison with the browser selection rule, Go formatting and diff
whitespace checks were performed. No tests, compilation, numerical experiments,
application runs, CI waiting, commits or pushes. Native summary reconstruction
and display remain pending; existing native decoders do not yet validate this new
summary field. Independent numerical acceptance and all earlier unresolved goal
requirements remain open. The full objective has not been achieved.

### Checkpoint 460: Android timing reconstruction and descriptive readout (2026-09-24)

OrbitEventTiming reconstructs both timing directions from already checked indexed
event records and draw statuses. It checks every selected draw/event identity and
bracket, every excluded draw/reason, exhaustive partition counts and the precise
first-detected rule including preceding unclassified zeros. Nearest-rank values
and independently sorted lower/upper bounds are recomputed; fewer than two
selected draws require unavailable status and null quantiles. No backend summary
numbers are accepted solely because they are finite or structurally plausible.

OrbitEventReport now requires this binding before publication. Android shows
selected/total, failed, unresolved, not-detected and ambiguous-zero counts for each
direction, plus ranks, TDB offsets and numerical bounds. English/Chinese text
states that these describe selected supplied draws rather than event probability,
confidence intervals or physical error bounds. All partition identities remain
in original-response export, with immutable public summary/quantile access.

Only source inspection and diff whitespace checks were performed. No tests,
compilation, application runs, CI waiting, commits or pushes. iOS timing summary
reconstruction/display and independent numerical/runtime validation remain open,
as do prior unfinished objective requirements. The full goal remains active.

### Checkpoint 461: iOS timing reconstruction and descriptive readout (2026-09-24)

NativeOrbitEventTiming reconstructs the two timing partitions from checked draw
records, validating complete ordered selection/exclusion identities and reasons,
counts, first-detected candidate indices, times and localization brackets. It
recomputes nearest-rank quantiles and separately sorted endpoint bounds, requires
null quantiles for fewer than two selected draws and checks cancellation while
processing the bounded draw set. NativeOrbitEventReport requires this binding
before exposing the receipt.

iOS now displays each direction's selected and excluded counts, ranks, TDB offsets
and numerical bounds, with English/Chinese statements of descriptive-only scope
and sampling/physical limitations. Original response export retains all partition
identities. Both native clients now reject event receipts lacking timingSummary;
this requires the new backend contract and is not a fallback to unchecked data.

Only source inspection and diff whitespace checks were performed. No tests,
compilation/typechecks, numerical experiments, application runs, CI waiting,
commits or pushes. Cross-language behavior, native interaction and independent
scientific accuracy remain unverified. The broad original objective and its
previously unresolved coverage/performance requirements remain active.

### Checkpoint 462: cancellation boundaries during native scientific JSON decoding (2026-09-24)

Source audit of the new 8 MiB event response path found that Android network
cancellation did not interrupt the shared JSON parser while it scanned a long
base64 source string or other large token. The parser now checks thread interruption
at value boundaries and at 4096-character checkpoints inside strings, digit runs
and whitespace. The next checkpoint uses a threshold so escaped-character jumps
cannot skip cancellation indefinitely. Start/end checks also reject cancellation
around short documents. Exceptions return no partially parsed scientific receipt.

iOS ScientificJSON now checks task cancellation before and after each recursive
decoded value. Foundation's individual scalar decoding and Android's UTF-8
conversion remain library operations without mid-operation interruption; no
wall-clock cancellation latency is claimed. Existing response byte/depth limits
remain in place. The top uncertainty ledger now distinguishes newly implemented
native/event source paths from still-missing independent acceptance and calibrated
physical event distributions.

Only source inspection and diff whitespace checks were performed. No tests,
compilation/typechecks, application runs, numerical experiments, CI waiting,
commits or pushes. Runtime cancellation latency and all scientific/capacity
evidence gaps remain unverified; the full goal remains active.

### Checkpoint 463: native tile metadata admission before copying long lines (2026-09-24)

Native loading source review found Android already reads HTTP tile payloads into
an exact declared-length buffer, so no replacement buffering path was added.
The iOS decoder, however, copied a complete metadata line before JSON decoding
without Android's existing 1 MiB per-line bound. It now rejects a line exceeding
that bound during byte scanning, before subdata/string/JSON allocations. Android
also enforces the same bound during scanning rather than after finding a newline.
A line exactly at the cap remains admissible; longer or unterminated rows fail.

Android tile decoding now checks thread interruption at entry, each state row,
metadata boundaries and 4096-byte scan checkpoints. SHA-256 updates use 256 KiB
slices of the existing input array with checks between updates, preserving the
same payload digest without an extra payload-sized copy. iOS already uses
chunked checksum updates and per-row cancellation. Individual library decoding
or digest operations are still synchronous; no measured latency/RSS claim follows.

Only source inspection and diff whitespace checks were performed. No tests,
compilation, application runs, benchmarks, CI waiting, commits or pushes.
Native resource behavior and full-inventory capacity remain runtime-unverified.
All earlier outstanding scientific and performance requirements remain active.

### Checkpoint 464: cache cancellation and opened-file allocation bounds (2026-09-24)

Review of native cache and accumulator paths found a cancellation/corruption
classification gap after adding interruptible Android decoding. The cached-tile
decode recovery handler now rechecks request/thread cancellation before evicting
the cache entry or attempting authoritative refetch. A cancelled decode no longer
serves as evidence that an otherwise valid cached tile is corrupt.

iOS cache reading now obtains length from the opened FileHandle, validates the
header/64 MiB bounds before allocation and reads exactly that length in bounded
chunks. Truncation and a trailing byte reject a changed-size file. It no longer
uses a second pathname metadata lookup to size the already opened file or grows
until EOF up to the global maximum. Generic cache failure handling also rechecks
the caller cancellation callback before removing an entry, retaining entries
when cancellation uses a custom error rather than CancellationError.

The aggregate 1536 MiB native-state estimates remain allocation estimates, not
process RSS guarantees; transient decode/cache buffers and hardware capacity
still require further review and later measurements. Only source inspection and
diff whitespace checks were performed. No tests, builds/typechecks, application
runs, benchmarks, CI waiting, commits or pushes. All original unresolved goal
requirements remain active and unverified.

### Checkpoint 465: reserve and charge iOS final-state arrays before tile loading (2026-09-24)

iOS StateTileService previously appended metadata, states and exact flags across
tiles while its retained-byte estimate counted only populated rows. It now admits
the entire final array base storage against the native-state budget before
reservation, reserves each final array once for the known request count and then
accounts actual array capacities. This removes the deliberate geometric-growth
path for these arrays and charges unused reserved slots before tile loading.

Per-tile admission now adds only retained string-byte estimates to the precharged
arrays, without double-counting fixed row/state storage. It checks cancellation
during row accounting and publishes no frame if the cumulative budget fails.
The request/plan ordering bounds still limit total appended rows to the admitted
capacity. Android already allocates the final primitive arrays once and charges
their full capacity, so that code was not duplicated.

This is retained-storage admission, not a total-process RSS guarantee. Library
allocation overhead, input identities, transient tile/JSON storage and other
concurrent application state remain outside a hard unified heap cap. Source and
diff whitespace checks only; no tests, compilation, benchmarks, application runs,
CI waiting, commits or pushes. Capacity/latency evidence and all earlier original
goal gaps remain open; no full-goal completion is claimed.

### Checkpoint 466: pre-read native tile working-space admission (2026-09-24)

Android StateAccumulator and iOS StateTileService now check a transient tile
working-space allowance against remaining retained-state budget before cache
lookup or network acquisition. The policy allowance is four times the maximum
tile bytes, 1024 bytes per declared row and 8 MiB scratch. Sequential tiles reuse
this allowance rather than charging it permanently for each decoded tile. The
existing post-decode retained-string/metadata admission still applies.

This explicitly leaves room for permitted raw/decode/row storage rather than
waiting until after allocation to discover that retained state consumed the
whole budget. The factors are a conservative policy estimate, not measured peak
memory or a proven runtime allocation bound; small actual tiles can be rejected
near the retained limit because the descriptor has no trusted exact byte size.
Input identity storage, renderer memory and concurrent work remain outside a
process-wide hard cap. Documentation records these limits without capacity claims.

Only source inspection and diff whitespace checks were performed. No tests,
builds/typechecks, benchmarks, application runs, CI waiting, commits or pushes.
Independent scientific and full-inventory capacity evidence remain open, as do
all earlier unresolved original requirements. The goal remains active.

### Checkpoint 467: serialize replacement native state loads through cancellation drain (2026-09-24)

Observation lifecycle source review found that clearing a cancelled load handle
allowed the replacement to allocate while its predecessor was still unwinding.
Android now uses a single-thread state-load executor with at most one pending
latest replacement. Cancellation interrupts the current future and removes queued
work, but the executor cannot start a replacement action until the previous action
returns through its cleanup. Activity destruction closes this queue.

iOS retains the cancelled task as a drain barrier. A replacement task awaits the
previous task's completion, then checks cancellation and request generation before
constructing a service or loading data. Retaining the barrier across a separate
cancel/reload prevents a cleared UI handle from being mistaken for released
allocation ownership. UI generation checks still prevent stale publication.

This serializes state-load actions, not all application allocations. Renderer
projection ownership, queued UI closures and multiple screen instances require
separate accounting; source review also identified that Android projection cancel
clears its worker barrier and that path remains to be corrected. Only source
inspection and diff whitespace checks were performed. No tests, compilation,
application runs, benchmarks, CI waiting, commits or pushes. Runtime behavior and
all earlier scientific/performance acceptance requirements remain unverified.

### Checkpoint 468: preserve Android projection allocation ownership during cancellation (2026-09-24)

NativeProjectionPrefetch now keeps allocation ownership separately from the
latest requested thread. Previously cancel cleared the only worker reference,
so a later start could enter projection while the cancelled predecessor was
still unwinding. A chain of interrupted replacement waiters could also lose
the original join barrier. The active action now releases ownership only in its
own finally block, and successors wait on that ownership under the monitor.

Replacement interrupts both the active action and any superseded pending thread.
Only the latest noncancelled request can acquire ownership; cancelling a waiter
cannot release another action's ownership. Existing Thread-returning call sites
remain compatible. Superseded thread objects still require scheduling to finish,
so this is one active allocation-heavy action and one eligible pending request,
not a claim of a hard bound on all short-lived runtime thread allocations.

Only source inspection of implementation/callers/existing test source and diff
whitespace checks were performed; no tests were executed or awaited. No builds,
application runs, benchmarks, CI waiting, commits or pushes. Cooperative exit,
publication/renderer lifetimes and total memory remain runtime-unverified. The
original scientific and capacity objective remains active and incomplete.

### Checkpoint 469: coalesce pending Android GL projection publication (2026-09-24)

NativeObservationDeck previously queued a closure capturing every prepared
projection. A paused or delayed GL thread could therefore retain superseded
direct buffers even though the owner had already selected a newer result. It now
owns one latest pending projection slot and queues a notification containing only
a generation token. Replacements overwrite that slot before GL consumption.

Clear and release discard the pending projection immediately and invalidate old
notifications. Clear notification ordering and replacement-slot publication share
a lock, so an old notification cannot consume a post-clear replacement before
the clear runs. Stale notifications also cannot reset the queued state for a newer
generation. Release rejects subsequent prepared publications. Existing clear
callbacks still run after GL has cleared its active reference.

Active renderer buffers, one frame-metric callback and other UI/task references
remain distinct owners; this does not claim immediate driver/direct-memory
reclamation or a process-wide heap bound. Only source inspection and diff
whitespace checks were performed. No tests, compilation, renderer/device runs,
benchmarks, CI waiting, commits or pushes. Runtime publication ordering and all
earlier scientific/capacity evidence remain unverified; the goal remains active.

### Checkpoint 470: release pending Android UI results on cancellation (2026-09-24)

MainActivity previously posted state/projection success closures directly to the
main Looper, retaining their full arrays until the callback ran even after input
changes invalidated publication. Separate NativeUiResultSlot owners now hold at
most one pending state result and one pending projection result. The queued
notification captures only the slot, not a result payload. Reset clears the owned
payload immediately; generation tokens reject late offers from superseded work.

State and projection success/failure publication use these slots. Their resets
are wired to new work and cancellation; activity destruction closes both slots
and removes pending notifications. Existing UI generation/frame-identity checks
remain in the delivered actions. Slot reset/close are UI-thread operations, so
they are serialized with delivery rather than racing a result already executing.

This bounds pending result ownership at these two publication boundaries, not
all callbacks or allocations: GL-clear callbacks, metric callbacks and active
renderer/worker references remain separate. Only source inspection and diff
whitespace checks were performed. No tests, compilation, application runs,
benchmarks, CI waiting, commits or pushes. Runtime ownership and all earlier
scientific/capacity evidence remain unverified; the full goal remains active.

### Checkpoint 471: invalidate pending GL-clear completions (2026-09-24)

NativeObservationDeck now owns one pending clear completion under preparedLock.
GL and UI notifications carry a generation token rather than a closure retaining
the loaded state frame. Clearing, replacement clears and release drop the owned
completion immediately; stale notifications cannot consume or discard a newer
completion. Failed UI posting drops only the matching generation's completion.
Completion delivery and owner changes remain UI-thread serialized.

Mode changes, state publication and adaptive display-budget replacement now
cancel projection work before requesting the GL clear. This invalidates queued
projection results during the clear-to-reprepare interval, including an old
projection failure that could otherwise supersede the new clear completion.
The renderer-clear comment now describes releasing client-side point references
without promising immediate native-memory or driver reclamation.

Only source inspection and diff whitespace checks were performed. No tests,
compilation, application runs, benchmarks, CI waiting, commits or pushes.
Active workers, renderer references and frame-metric callbacks remain separate
owners. Runtime ordering, capacity measurements and independent scientific
validation remain outstanding; this checkpoint does not complete the goal.

### Checkpoint 472: detach frame metrics from projection buffers (2026-09-24)

The Android frame-window callback previously captured PreparedPoints, retaining
its direct FloatBuffer while the UI notification waited even after renderer
clear or projection cancellation. Each prepared projection now owns a small
identity object with no back-reference. The queued metric callback captures only
that identity and the metric window. MainActivity resolves against its current
projection and rejects a different identity before consuming counts or metrics.
The existing single-outstanding-notification guard remains in place, and the
callback snapshots the volatile listener once before invoking it.

Source inspection found one listener implementation and its one registration;
both use the updated contract. Diff whitespace checks passed. No tests,
compilation, application runs, benchmarks, CI waiting, commits or pushes were
performed. This removes the metric payload's direct ownership of an obsolete
projection; active renderer/worker/UI ownership and runtime memory behavior still
need later validation. The full scientific and capacity goal remains active.

### Checkpoint 473: synchronize and bound iOS frame notifications (2026-09-24)

NativePointScene's SceneKit delegate formerly sampled on the render callback
thread while teardown reset the same sampler on main without synchronization.
Its queued notifications also consulted the latest callback without binding the
window to the projection that was current when it was sampled. Coordinator now
guards sampler, projection identity, callback and notification state with one
lock. Configuration resets samples on identity change; teardown clears identity
and callback under that lock. Delivery rejects a changed identity and invokes
the callback outside the lock on main.

Only one metric notification may be outstanding. Its payload contains a UUID
and scalar metric window with a weak coordinator reference, not point arrays.
Viewport pressure sampling additionally requires the projected key to match the
current key and an active scene. These are callback ownership/admission fixes,
not proof of exact GPU timing or atomic SceneKit geometry transition attribution.

Only source inspection and diff whitespace checking were performed. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Runtime concurrency, rendering behavior, capacity and scientific validation
remain outstanding; the full goal remains active.

### Checkpoint 474: reduce iOS point-geometry staging allocations (2026-09-24)

The native SceneKit path no longer maps the full SIMD projection into a second
SCNVector3 array before constructing its geometry source. It copies the existing
SIMD bytes into owned Data and explicitly supplies three Float components with
MemoryLayout<SIMD3<Float>>.stride, preserving SIMD padding rather than assuming
12-byte packed vertices. Index Data is filled directly without a separate full
UInt32 array. Both geometry entry points share point sizing and material setup.

The scene node drops its previous geometry reference before replacement buffers
are constructed. This reduces application-owned staging overlap; it does not
promise immediate SceneKit/driver deallocation or zero-copy GPU transfer. The
existing SCNVector3 entry point remains for existing callers. Its prior pixel
test source does not establish correctness of the new SIMD source layout.

Only source inspection and diff whitespace checking were performed. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
SIMD layout rendering, replacement behavior and actual memory savings require
later validation; the overall scientific and capacity goal remains active.

### Checkpoint 475: bound and cancel iOS projection allocation paths (2026-09-24)

NativeProjection.make and limited previously accepted any positive display
limit. Both now reject values above the existing 500,000-point planar policy
ceiling before allocating output. The shared storage routine is mode agnostic;
the caller still applies the tighter 250,000-point spatial policy. This is a
point-count admission bound, not a process-memory or measured-capacity guarantee.

Reference lookup now shares a cancellation-aware pass with exact-row counting,
preserving first matching reference semantics. The full source still determines
the coordinate scale, and the reference remains the first displayed point.
Projection entry, preallocation and completion check cancellation. Prefix
reduction copies into independently owned storage with periodic cancellation
checks instead of one uninterrupted Array-prefix copy.

Only source inspection and diff whitespace checking were performed. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Runtime cancellation latency, allocation behavior and prior scientific/capacity
acceptance remain unverified; the full goal remains active.

### Checkpoint 476: prepare iOS geometry bytes off the main thread (2026-09-24)

The production SceneKit update still copied vertex bytes and filled every index
on main after checkpoint 474. NativePointPayload now prepares owned vertex/index
Data within the existing serialized detached projection task for 3D only. It
rejects more than 500,000 points before allocation, checks cancellation between
256 KiB vertex chunks and every 4,096 indices, and checks again before returning.
2D projections do not allocate this payload. Float64 source states are unchanged.

The main-thread scene update consumes the prepared payload to create SceneKit
objects; it no longer performs the application-level vertex copy/index loop.
Framework-internal copies or upload work are not proven absent. Budget revision
changes already invalidate the displayed key and restart preparation, so the
main-thread prefix-reduction handler was removed. Publication rejects results
above the current limit rather than rebuilding an old payload on main. The
standalone limited helper preserves payload consistency when used elsewhere.

The payload is Foundation-only; SceneKit/UIKit code is conditionally compiled.
The standalone Swift protocol script's source list now includes its file, while
the Xcode app and geometry test target already list that source. The script was
not executed. Existing pixel test source still exercises the SCNVector3 entry
point and does not prove the new prepared-payload path.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Main-thread latency, actual buffer residency, cancellation timing and all prior
scientific/capacity acceptance remain unverified; the full goal remains active.

### Checkpoint 477: release drained iOS projection results on early cancellation (2026-09-24)

NativeProjectionPrefetch installed its generation-guarded worker cleanup only
after starting a replacement worker. If the newest request was cancelled while
awaiting its predecessor, it could throw before that defer existed and leave
the actor retaining the predecessor's completed Task and projection payload.
Cleanup is now installed immediately after claiming the request generation.
It still executes only after the predecessor wait returns, preserving the
single-active-allocation barrier, and never clears a newer generation's worker.

The mode-aware actor entrance now rejects limits above 250,000 for 3D and
500,000 for 2D before launching a detached worker; the mode-agnostic projection
and geometry payload bounds remain additional checks. Detached work checks
cancellation once more immediately before returning its completed payload.

Source ordering and diff whitespace checks only. No tests, compilation,
application/device runs, benchmarks, CI waiting, commits or pushes. Suspended
callers and framework references are separate owners; this does not establish
immediate total-memory reclamation or runtime cancellation latency. All prior
scientific/capacity validation remains outstanding; the full goal remains active.

### Checkpoint 478: separate iOS state-task ownership from publication validity (2026-09-24)

ObservationModel cleared its state request handle only when the publication gate
remained current. Cancellation invalidates that gate, so cancellation exits and
stale-result returns could bypass cleanup and leave a completed task handle in
the model. Each installed state task now has a UUID owner independent of the
publication token. A defer clears the handle on every exit if that task still
owns it; an older task cannot clear its replacement's handle.

Cancellation still retains the running task as a drain barrier. Cleanup occurs
after predecessor waiting and the service call unwind, not when cancellation is
requested. Invalid new inputs do not remove that barrier prematurely. Loading
state cleanup retains its existing publication check; cancelled UI state is
already updated synchronously by cancel(). Android's single-thread executor
continues to own active state work until the action exits.

Source/call-site inspection and diff whitespace checks only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Runtime lifecycle and memory behavior remain unverified, as do the broader
scientific and capacity acceptance requirements. The full goal remains active.

### Checkpoint 479: reuse decoded exact counts in native UI publication (2026-09-24)

Both native loading paths already count exact decoded states while verifying
tile/plan precision counts. Their frames now carry that aggregate to the UI.
Android's accumulator records each appended tile's count and its private frame
constructor receives the total. MainActivity's count accessor is constant-time,
including repeated mode switches and adaptive replacements. iOS accumulates
only after each chunk count matches its plan, sets an optional verified count
before returning the completed frame, and requires it before UI publication.
An absent verified count is not silently interpreted as zero.

This removes redundant main-thread scans for status counts without changing the
scientific exact flags, missing-row semantics or tile/plan checks. Projection
algorithms still inspect source rows as needed. It relies on published frame
arrays remaining unchanged, as the existing loading/rendering contract requires.

Source/call-site inspection and diff whitespace checks only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Actual responsiveness and the broader scientific/capacity acceptance evidence
remain unverified; the full goal remains active.

### Checkpoint 480: bound native evidence-page work (2026-09-24)

iOS state evidence previously passed the complete metadata index collection to
ForEach. NativeStateEvidence now exposes at most 100 rows per page with previous,
next and page controls. The frame identity resets page state when a new frame
arrives. Source hashes, source-chain disclosure and missing reasons remain
available across all pages; pagination does not truncate the underlying frame.

Android evidence pages already held at most 100 rows, but every page render
scanned the entire frame to find the reference. The state worker now resolves
reference availability once, with cancellation checkpoints, and publishes that
boolean alongside the matching frame through the existing generation gate.
Pages reuse the boolean; clearing evidence resets it. No full identity map or
additional per-body index is allocated for this one lookup.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
UI navigation/accessibility and actual scaling remain unverified. Broader
scientific and capacity acceptance remains outstanding; the full goal is active.

### Checkpoint 481: serialize cancelled native source-directory requests (2026-09-24)

Source-directory responses already have byte and row bounds with manifest and
cursor checks. Rapid cancellation/restart could nevertheless overlap old request
cleanup with new network/decode work. Android's directory now owns a separate
instance of the existing cooperative single-active work coordinator, retaining
the active-action barrier until finally cleanup completes. Its success/error
publication uses a resettable UI result slot, so clearing drops a queued page
payload and late offers are rejected. The directory's existing 30-second UI
deadline includes time spent waiting for its predecessor.

iOS directory cancellation now retains the task as a drain barrier. A replacement
awaits it, checks cancellation and generation, then creates its service. Separate
task ownership clears the finished handle even after publication invalidation,
without clearing a successor. Input changes and panel closure still invalidate
displayed pages immediately. No automatic inventory traversal was introduced.

Source/call-site inspection and diff whitespace checks only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
The bound concerns active work within each directory instance, not total process
threads or all network traffic. Runtime cancellation and broader scientific and
capacity acceptance remain unverified; the full goal remains active.

### Checkpoint 482: bound Android orbit-panel result publication (2026-09-24)

OrbitCovariancePanel's covariance conversion, propagation, ensemble and event
branches previously posted payload-capturing closures directly to main and
started each replacement on a new independent worker. All four now share one
cooperative work coordinator per panel: replacement execution waits for the old
action's finally cleanup. Success/error publication uses a resettable result
slot instead of one payload per queued Looper callback. Source-import success
and error use the same slot, while retaining the existing bounded import executor,
cancellation signal and import deadline.

Clear invalidates both publication generations, drops the pending result,
interrupts coordinated calculations and closes the active service. Existing
request-bound report validation, source ownership and displayed/exported report
selection remain unchanged. The main Handler is still used for the lightweight
import timeout, not for queued scientific result payloads.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Import work and computation remain separate owners, as do request construction
and backend jobs. This is not a global concurrency or memory bound. Runtime
behavior and broader scientific/capacity acceptance remain unverified; the full
goal remains active.

### Checkpoint 483: serialize iOS orbit-panel task replacement (2026-09-24)

NativeOrbitCovarianceView now routes source import, covariance conversion,
propagation, ensemble propagation and event search through a shared task-start
helper. Clear still cancels work and invalidates displayed reports immediately,
but retains the task as a drain barrier. Replacement awaits the predecessor,
checks cancellation and publication generation, then invokes the operation.
An independent owner UUID clears the handle on every exit without disturbing
a successor. Publication checks in each scientific branch remain unchanged.

Button busy state is separate from the retained task handle, allowing cancellation
to restore controls while predecessor cleanup continues. Import timeout still
starts at user initiation and therefore includes predecessor waiting. Request
construction remains synchronous and pending closures may retain bounded inputs;
this does not claim a global allocation bound or remote backend cancellation.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Runtime actor isolation, lifecycle, cancellation and scientific/capacity
acceptance remain unverified; the complete goal remains active.

### Checkpoint 484: serialize native ground-contact search replacement (2026-09-24)

Android GroundContactsPanel now uses a per-panel cooperative work coordinator
and resettable UI result slot. A replacement action waits for prior finally
cleanup; cancelling clears pending reports/errors and closes the service.
The existing 25-second UI deadline includes predecessor waiting. Lightweight
timeout notification remains on Handler, while report payloads use the slot.

iOS NativeGroundContactView retains cancelled work as a drain barrier and awaits
it before creating the next service. Independent task identity protects cleanup
from overwriting a successor. Busy state is separate from the retained handle,
so clear restores controls and drops report/export data immediately. Existing
generation checks still gate publication. Contact computation, request binding
and provenance validation were not altered.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Stellar panels still need the equivalent ownership audit/fix. No global backend
job cancellation or measured memory/latency guarantee is claimed. Runtime and
broader scientific/capacity acceptance remain unverified; the full goal is active.

### Checkpoint 485: bound native stellar-panel task replacement (2026-09-24)

Android StellarMotionPanel now coordinates stellar propagation and observer
direction requests through one per-panel cooperative work owner. Replacement
execution waits for predecessor finally cleanup. Import and calculation success
or failure publish through a resettable UI result slot, dropping pending source
bytes/report payloads on clear and rejecting late offers. Imports retain their
separate bounded executor, cancellation signal and existing timeout.

iOS imports and both scientific branches now share a task-start helper. Clear
cancels but retains the old task as a drain barrier; replacement awaits it before
starting its operation. Independent task identity protects cleanup, while a
separate busy flag restores controls immediately on clear. Generation checks
still bind publication to current inputs. RV assumptions, covariance policy,
station/refraction inputs and scientific response validation were not changed.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Pending inputs, import executors and backend jobs remain separate resource
owners. Runtime cancellation, memory and scientific/capacity acceptance remain
unverified; the full goal remains active.

### Checkpoint 486: enforce contact transport deadline independently of UI (2026-09-24)

Android GroundContactsService previously checked a monotonic deadline only
between blocking operations and relied on the panel's Handler deadline to
disconnect the connection. It now schedules its own daemon deadline action for
the remaining service budget, marks expiry and closes the registered connection.
The timer/future are cleaned in finally, including setup failure paths. Existing
synchronized connection registration rechecks cancellation before registration.

Response reading now checks cancellation/deadline before and after each read.
A zero-length bulk read falls back to a single-byte read rather than repeatedly
spinning; both paths enforce declared size and final exact length. Scientific
decoding and its existing pre/post cancellation checks remain unchanged.
Source inspection of iOS NativeHTTPTransfer found an existing locked terminal
state, body clearing and session invalidation on cancellation; no change was
made there. URLSession/HttpURLConnection teardown timing remains platform-owned.

Source inspection and diff whitespace checking only. No tests, compilation,
application/device runs, benchmarks, CI waiting, commits or pushes. Blocking-I/O
interruption timing, timer races and scientific/capacity acceptance require later
verification; the full goal remains active.

### Checkpoint 487: reject non-JSON numeric and whitespace forms on Android (2026-09-24)

The shared Android scientific JSON parser already checks cancellation at value
boundaries and within long tokens. Inspection found its numeric and whitespace
grammar was too permissive: integer digits accepted leading zeros, whitespace
used Character.isWhitespace, and Unicode escapes used Character.digit, allowing
non-ASCII hexadecimal characters. Number parsing now separates the single-zero
integer case, requires ASCII digits for fractions/exponents, and rejects leading
zeros. Whitespace is restricted to space, tab, CR and LF. Unicode-escape digits
are restricted to ASCII 0-9/a-f/A-F. Finite binary64 conversion and cancellation
checkpoints remain in place.

Grammar reference: RFC 8259 sections 2, 6 and 7,
https://www.rfc-editor.org/rfc/rfc8259 . This corrects input acceptance; it does
not add an object-count allocation budget or prove numerical model accuracy.
Event response inspection found existing per-draw/per-event cancellation checks.

Source inspection and diff whitespace checks only. No tests, compilation,
application/device runs, benchmarks, CI waiting, commits or pushes. Parser
regressions and broader scientific/capacity acceptance remain unverified; the
full goal remains active.

### Checkpoint 488: avoid full response-buffer duplication before decoding (2026-09-24)

Android StellarMotionService and GroundContactsService now read validated
Content-Length bodies directly into one exact-sized byte array, in at most
16 KiB read requests. The former ByteArrayOutputStream backing array and final
toByteArray copy are removed. This affects covariance, propagation, ensemble,
event, stellar and ground-contact response transport, including bounded error
bodies, without changing decoder/report ownership.

Cancellation/deadline checks remain before allocation and around reads. A zero
bulk read falls back to one byte; early EOF rejects a truncated body. After the
declared length is filled, a one-byte EOF probe rejects excess content and checks
cancellation before publication. Streams close on every exit. Header limits
remain the admission bound; no additional arbitrary parser-node limit was added.

Source inspection and diff whitespace checks only. No tests, compilation,
application/device runs, benchmarks, CI waiting, commits or pushes. This removes
one application-level full-body copy, not all decoder/report copies or a measured
process-memory peak. Runtime I/O and all broader scientific/capacity acceptance
remain unverified; the full goal remains active.

### Checkpoint 489: remove redundant report/export response copies (2026-09-24)

Android orbit and stellar panels already call exportBytes(), which returns a
fresh defensive response copy. Their private Activity export callbacks now take
ownership of that snapshot instead of cloning it again. Picker cancellation,
launch failure and activity destruction still clear pending snapshots; approved
file writes still use the snapshot selected before the picker opened.

Embedded covariance validation in propagation, ensemble and event reports now
retains only its validated summary, without cloning the complete outer response.
The public standalone covariance decoder still retains a defensive response copy,
and enclosing reports still retain/export their full original response. An
attempt to export the internal embedded summary throws explicitly rather than
returning incomplete bytes. All existing source/numeric binding checks execute
on both paths; inspected embedded callers use summary fields only.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
These remove specific application-level duplicate arrays, not all retained
reports or measured memory peaks. Export/runtime and scientific/capacity
acceptance remain unverified; the full goal remains active.

### Checkpoint 490: bound Android report export concurrency (2026-09-24)

The three native report exports formerly created independent threads retaining
full snapshots and their Activity. They now share NativeReportExport's process-
wide single writer with two queue slots and an 8 MiB per-snapshot admission cap.
Rejected submissions report failure without opening/truncating their destination.
Accepted snapshots retain their selected bytes and are not silently superseded.
Writing uses 64 KiB chunks, flushes and closes before success is reported; stream
close failures still report failure. The idle writer thread times out.

MainActivity supplies an application ContentResolver and a completion holding
only a weak Activity reference. Notifications carry status rather than snapshots,
and skip destroyed/finishing activities. Pending picker snapshots retain their
existing cancellation/destruction cleanup. Already authorized writes deliberately
continue independently of Activity lifetime instead of being interrupted midway.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, file-provider writes, application/device runs, benchmarks, CI waiting,
commits or pushes. A blocked provider can occupy the single writer indefinitely;
the queue bounds retained jobs but does not prove write latency or atomic provider
replacement. Scientific/capacity acceptance remains outstanding; the goal is active.

### Checkpoint 491: isolate export feedback from scientific analysis status (2026-09-24)

An earlier report export could finish after a new analysis started and overwrite
that panel's current status. Android export completion now produces independent
localized Toast feedback identifying an orbit, stellar or ground-contact report
snapshot. It does not mutate analysis status or select a newly displayed report.
Picker-launch failure uses the same independent path. Admission rejection has a
distinct message explaining that the snapshot was not queued and suggesting a
retry after existing exports finish.

Write failures disclose possible partial files, since generic document providers
do not guarantee atomic replacement. Scientific success, write success and queue
admission remain separate outcomes. Completion still weakly references Activity
and ignores destroyed/finishing owners. New English and Chinese resource files
use matching formatted placeholders.

Source/resource inspection and diff whitespace checks only. No tests,
compilation, application/device runs, actual exports, benchmarks, CI waiting,
commits or pushes. Toast accessibility/timing, file-provider behavior and broader
scientific/capacity acceptance remain unverified; the full goal remains active.

### Checkpoint 492: separate iOS export feedback and release completed snapshots (2026-09-24)

iOS orbit, stellar and ground-contact exporters no longer assign their completion
messages to scientific calculation status. Each has a distinct export-status
readout with an accessibility identifier; orbit/stellar messages identify the
chosen report filename and ground contacts identify the selected snapshot.
Opening an export clears the previous export message. A success/failure callback
also clears the owned FileDocument bytes after reporting the outcome.

The snapshot remains separate from live report state while export is in flight.
This does not assume that picker dismissal always invokes completion, nor prove
provider/framework reference reclamation or cancellation behavior. No document
bytes are cleared just because the exporter begins dismissing.

Source/resource inspection and diff whitespace checking only. No tests,
compilation, application/device runs, actual exports, benchmarks, CI waiting,
commits or pushes. Export lifecycle/accessibility and broader scientific/capacity
acceptance remain unverified; the full goal remains active.

### Checkpoint 493: interrupt original-source Base64 encoding (2026-09-24)

Request-path inspection confirmed full SBDB preflight parsing occurs in request
encoding invoked by the background service action, not the panel's constructor.
The common Android Base64 implementation, however, had no cancellation checks
inside its potentially multi-megabyte source loop. It now checks before output
allocation, every 12,288 source bytes, before String construction and before
return. Cancellation throws without clearing the interrupt flag; panel worker
cleanup and stale-result gates remain in effect.

The same helper is used for request encoding and original-source response
binding. Its alphabet, padding and byte mapping are unchanged. This does not
make array cloning/String construction preemptible or remove synchronous bounded
request construction on the UI thread; those remain separate costs.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Encoding output regressions, cancellation latency and broader scientific/capacity
acceptance remain unverified; the full goal remains active.

### Checkpoint 494: construct stellar source snapshots after worker admission (2026-09-24)

Android StellarMotionPanel previously constructed immutable stellar/observer
requests on the UI thread, defensively copying up to 1 MiB manifest plus 8 MiB
CSV before worker admission. It now reads scalar/text controls on main and
captures its private imported-array references in request factories. The chosen
factory runs only inside the existing serial calculation worker after predecessor
cleanup, with a cancellation check before construction. Requests still perform
all validation and defensive copies; no mutable UI controls are read by workers.

The imported arrays are assigned/replaced and not mutated in this panel, as
confirmed by source inspection. Invalid request errors publish through the same
generation-bound result slot. Pending closures can retain input references, but
they no longer eagerly create an additional full source copy while waiting.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Array cloning itself remains synchronous within the worker. UI latency, memory,
cancellation and scientific/capacity acceptance remain unverified; the full goal
remains active.

### Checkpoint 495: defer Android orbit request copies until worker admission (2026-09-24)

OrbitCovariancePanel now captures scalar/text controls, bounded source offsets
and its private original-source reference on main, then constructs the immutable
request inside its serialized calculation action. This covers covariance
conversion, propagation, ensembles and event searches. Source copies therefore
occur after predecessor cleanup, not eagerly while replacement work waits.
Original imported arrays are replaced rather than mutated in this panel.

Each background branch returns a UI publication action bound to its own checked
report/request. That action is delivered only through the resettable result slot
and current generation gate. No worker reads EditText/CheckBox values. Event
requests still omit irrelevant duration/SRP fields; ensemble/refinement and all
source/force/epoch validation remain in the original request classes.

Source/call-site inspection and diff whitespace checking only. No tests,
compilation, application/device runs, benchmarks, CI waiting, commits or pushes.
Scalar and bounded offset parsing remains on main. Actual responsiveness, request
binding regressions and scientific/capacity acceptance remain unverified; the
full goal remains active.

### Checkpoint 496: avoid redundant iOS orbit wire escaping (2026-09-24)

Covariance, propagation, ensemble and event request encoders now use
withoutEscapingSlashes, matching the stellar request encoders. Escaping forward
slashes in Base64 adds JSON wire bytes without changing the decoded source;
slash-heavy sources can therefore consume the 3 MiB request allowance earlier
than their unescaped representation. All four paths retain their existing source
and wire limits and use the same Encodable fields and Base64 data strategy.
Covariance conversion also checks task cancellation immediately after encoding.

Source inspection confirmed encoding occurs inside NativeStellarMotionService,
not in the main-actor view actions. No dispatch changes were needed. Foundation
encoding remains synchronous and is not interruptible mid-call by these checks.
Source inspection and diff whitespace checks only: no tests, builds, numerical
runs, benchmarks, CI waiting, commits or pushes. Runtime wire equivalence and
capacity acceptance remain unverified; the full goal remains active.

### Checkpoint 497: propagate iOS scientific JSON child failures (2026-09-24)

ScientificJSON now selects an unkeyed container before decoding array elements,
then decodes each child directly into the final Any collection. Previously a
try? around the entire child array swallowed cancellation and depth-budget
failures before trying the object branch. Child errors now propagate unchanged.
Objects likewise decode directly into the final dictionary through dynamic
CodingKeys rather than constructing a ScientificJSON dictionary and mapping it.
Both collection loops check cancellation and retain the existing recursive
depth checks, scalar types and finite binary64 decoding.

This removes intermediate wrapper collections from the source-level path; it
does not establish a measured peak-memory or latency improvement. Foundation's
initial JSON processing and allKeys allocation remain outside the cooperative
checks. Source inspection and diff whitespace checks only; no tests, compilation,
runtime runs, benchmarks, CI waiting, commits or pushes. Scientific and capacity
acceptance remain outstanding; the full goal remains active.

### Checkpoint 498: borrow iOS CSV source bytes during validation (2026-09-24)

The stellar selected-row scanner now uses Data.withUnsafeBytes for a synchronous
scan instead of constructing Array(data). The borrowed pointer never escapes the
closure. Strict UTF-8 validation now occurs when each parsed field is decoded,
removing the previous whole-file String allocation used only as a validity check.
No replacement-character decoding is used. ASCII CSV delimiters and quoting
remain handled by the existing scanner, including CRLF and escaped quotes.

The scanner still visits every row, checks header uniqueness and row shape,
enforces its 10,000-row bound, and rejects duplicate selected sources. It adds
cancellation checks before borrowing, at field decoding, and during selected
numeric-field conversion, retaining the periodic byte-scan checks. Field strings
and cell storage still allocate; a single large field conversion is synchronous.

Source inspection and diff whitespace checks only. No tests, compilation,
runtime or numerical runs, benchmarks, CI waiting, commits or pushes. Memory
improvement and CSV behavior require later execution evidence; the full scientific
and capacity goal remains active.

### Checkpoint 499: bound iOS source-binding Base64 temporaries (2026-09-24)

Stellar manifest/CSV and SBDB receipt binding now share a canonical Base64
comparator. It borrows the original Data buffer and encodes at most 12 KiB of
source at a time, comparing each expected UTF-8 byte against the response string
iterator. The chunk size is divisible by three, so only the final chunk can
contain padding. It rejects mismatches, missing bytes and trailing bytes without
materializing another full expected Base64 string. Existing SHA-256 and all
scientific provenance checks remain in place.

Cancellation is checked on entry, between chunks and before accepting the final
length. Foundation still owns the response string and its UTF-8 representation;
this change does not prove total decoder memory is bounded by the chunk size.
The source pointer remains inside its synchronous borrow. Empty sources do not
dereference a nil buffer address, although request admission already rejects them.

Source and call-site inspection plus diff whitespace checks only. No tests,
compilation, runtime runs, benchmarks, CI waiting, commits or pushes. Canonical
encoding equivalence, cancellation latency and peak memory still need execution
evidence when permitted. The full scientific and capacity goal remains active.

### Checkpoint 500: cooperative iOS scientific source hashing (2026-09-24)

Stellar manifest/CSV and SBDB source receipt validators now use a throwing
SHA-256 helper that checks task cancellation before work, between 256 KiB
updates, and before/after finalization. Updates borrow slices of the original
buffer synchronously; no full source copy or per-chunk Data copy is introduced.
The digest still uses CryptoKit SHA-256 and lowercase two-digit hexadecimal
formatting. The small cache-key helper and existing state-tile hashing remain
unchanged; state-tile hashing already checks its cancellation hook per chunk.

Source/call-site inspection and diff whitespace checking only. No tests, builds,
runtime or numerical runs, benchmarks, CI waiting, commits or pushes. One hash
update is still synchronous; neither cancellation latency nor digest equivalence
has been execution-verified in this phase. Scientific/capacity acceptance remains
outstanding, and the full goal remains active.

### Checkpoint 501: iOS panel deadlines cancel scientific validation (2026-09-24)

Stellar and orbit panels now arm a 25-second deadline when a scientific operation
is queued. The deadline is guarded by input generation and work ownership, and
cancels through the existing clear path. It covers predecessor waiting, request
encoding, transfer and report validation; previously only imports had a panel
timer, while the service checked its deadline before/after synchronous validation.
Imports retain their existing timer and specific file-provider feedback.

The renamed workDeadline is cancelled on completion, input/lifecycle clearing and
replacement. Timeout clears publication eligibility and busy state but retains
the predecessor task as a cleanup barrier, preventing replacement heavy work from
overlapping a still-draining cancelled task. Existing parser, CSV, Base64 and hash
cancellation checks can observe the panel cancellation. Foundation calls remain
synchronous and are not forcibly interrupted; main-actor scheduling also prevents
this from being a hard real-time deadline guarantee.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
device/runtime runs, benchmarks, CI waiting, commits or pushes. Actual deadline
latency and lifecycle behavior remain unverified; the full goal remains active.

### Checkpoint 502: Android scientific panel cancellation deadlines (2026-09-24)

Stellar and orbit calculation panels now start a 25-second timer before worker
admission. Expiry invokes their existing clear path, interrupting active and
waiting calculation work, closing the owned transport and invalidating queued
results. The serial predecessor cleanup barrier remains intact. Previously the
service timer closed transport but did not interrupt a decoding worker.

Workers check the monotonic deadline before constructing requests. Both success
and error publications check that deadline again on main, so a delayed handler
cannot publish an expired result even if the timer callback has not run. Imports
retain their original feedback, and calculations use a separate bilingual timeout
message. Completion, clearing and detachment remove the shared work timer.

Source/call-site/resource inspection and diff whitespace checks only. No tests,
compilation, runtime/device runs, benchmarks, CI waiting, commits or pushes. Main
handler scheduling and non-cooperative library calls remain latency limitations;
actual interruption and lifecycle behavior remain unverified. The full scientific
and capacity goal remains active.

### Checkpoint 503: gate iOS publications against the queued deadline (2026-09-24)

Both stellar and orbit panels now capture a monotonic deadline in startWork and
pass it to each operation. Admission after predecessor cleanup, successful
publication and error publication all check that same deadline in addition to
generation and cancellation. Expired work clears its publication eligibility and
shows timeout feedback even if the independent timer task has not been scheduled.
This applies to all six scientific branches and both panels' file imports.

Import messages remain distinct from calculation messages. The existing timer
still requests cancellation while operations are running, and the predecessor
barrier remains retained until task cleanup. The check does not interrupt a
synchronous library call or prove a hard real-time scheduling bound.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/device runs, benchmarks, CI waiting, commits or pushes. Scheduling races,
latency and full scientific/capacity acceptance remain unverified; the full goal
remains active.

### Checkpoint 504: ground-contact and directory publication deadlines (2026-09-24)

Android ground-contact and source-directory panels now record monotonic deadlines
before queueing work, reject expired worker admission, and recheck both success
and error publications on main. Existing 25-second/30-second timers still cancel
through clear; delayed timer callbacks cannot permit an expired result to appear.

iOS ground-contact and source-directory work now has corresponding panel/model
timers, owner/generation guards, and monotonic admission/publication checks. Clear
cancels timers and work while retaining the predecessor cleanup barrier. Only the
matching owner's completion removes its timer, so old cleanup cannot remove a
replacement's deadline. Directory failure feedback remains generic; contact search
uses localized timeout feedback. No automatic traversal or new requests are added.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/device runs, benchmarks, CI waiting, commits or pushes. Timers are
cooperative and scheduling-dependent, not hard real-time guarantees. Execution
evidence for lifecycle, latency and scientific/capacity acceptance remains missing;
the full goal remains active.

### Checkpoint 505: enforce directory row admission during iOS decoding (2026-09-24)

iOS source pages now decode their items through an unkeyed container that rejects
a 51st entry before constructing that Row. Cancellation is checked between rows,
through row validation, and around manifest decoding. Existing field types,
optional cursor semantics, manifest binding and 50-row publication checks remain.
Foundation may still parse the bounded input internally before Decodable runs;
this is not a streaming transport/parser memory guarantee.

Android directory decode now independently enforces the same 256 KiB page and
8 MiB manifest byte limits already used by transport. Row validation checks
thread interruption between entries and before returning, complementing the
existing cancellable JSON parser. Manifest rebinding also checks its input budget.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/device runs, benchmarks, CI waiting, commits or pushes. Decode behavior,
latency and full scientific/capacity acceptance remain unverified; the goal remains
active.

### Checkpoint 506: reject adjacent directory-page repetition (2026-09-24)

Android and iOS directory services already bind next-page requests to the same
backend, query and freshly checked catalog/inventory manifest, and reject an
unchanged nonempty cursor. They now also reject a changed totalRecords value or
any stable source ID repeated from the immediately preceding page. The comparison
uses at most 50 previous IDs, checks cancellation while inspecting incoming rows,
and does not merge different source records that refer to one physical body.

The backend IdentityPage delegates to the inventory cursor page implementation;
the additional client checks enforce consistency rather than interpreting its
opaque cursor. Only the adjacent page is retained: this does not prove full
inventory coverage or detect every longer cursor cycle, and no automatic crawl
has been introduced.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/device runs, benchmarks, CI waiting, commits or pushes. Pagination runtime
behavior and full scientific/capacity acceptance remain unverified; the goal
remains active.

### Checkpoint 507: bind backend page cursors to the inventory snapshot (2026-09-24)

Inventory.pageRefs now wraps both shard/row and search-offset cursors in a
versioned envelope containing the inventory manifest SHA-256 and normalized query
SHA-256. Nonempty inputs must match that envelope before their position is decoded.
This prevents a previous snapshot's positional cursor being silently applied to a
different inventory, including through clients without native manifest checks.
The envelope also binds the complete query digest rather than relying solely on
the search index's 64-bit query hash. Incoming tokens are bounded to 256 bytes.

An empty token still begins browsing. Legacy unbound tokens deliberately fail and
require restarting; documentation records this compatibility boundary. The envelope
is not signed and does not confer authorization. Existing position bounds, limits
and terminal empty-cursor behavior remain; no server-side session history is added.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime runs, benchmarks, CI waiting, commits or pushes. Cursor compatibility and
round trips remain execution-unverified; the full scientific/capacity goal remains
active.

### Checkpoint 508: retain the web directory page's backend identity (2026-09-24)

Client source inspection found web and native directory consumers pass page
tokens opaquely through URL query encoders. The synthetic native fixture owns its
own opaque token and does not decode production cursors. No production consumer
needed to parse or reconstruct the new inventory envelope.

Web SourceIdentityPage now retains the normalized backend used to fetch it.
Continuation and state inspection reject a different backend before issuing
network requests, and source selection checks the same binding before mutating
selection state. Manifest equality alone previously allowed reusing a page across
two backends with identical snapshots. Two existing fixture literals and the
source-scene fixture were updated with the required field; no tests were run.

Source/call-site inspection and diff whitespace checks only. No tests, compilation,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Runtime cursor
compatibility, existing fixture behavior and full scientific/capacity acceptance
remain unverified; the full goal remains active.

### Checkpoint 509: strict UTF-8 for shared web scientific JSON reads (2026-09-24)

SourceIdentityBrowser already checks a monotonic 30-second deadline, abort signal
and current request identity before publishing results. Input edits, collapse and
unmount invalidate old requests; no extra publication gate was needed there.

The shared readStateTileJson path did accept replacement-character UTF-8 decoding.
It now uses a fatal UTF-8 decoder so malformed input cannot silently change source
IDs or provenance text. Both stream and non-stream responses pass through the
existing bounded raw-byte reader; the old text decode/re-encode length comparison
is removed. Cancellation checks surround text decoding and JSON parsing, while
byte budgets, HTTP/content-type checks and cancellation cleanup remain in place.

Source inspection and diff whitespace checks only. No tests, builds, runtime or
browser runs, benchmarks, CI waiting, commits or pushes. JSON.parse and TextDecoder
remain synchronous; surrounding checks do not preempt a busy JavaScript thread.
Transport compatibility and scientific/capacity acceptance remain unverified; the
full goal remains active.

### Checkpoint 510: strict stellar and ground-response text decoding (2026-09-24)

The stellar motion loader and shared ground observation payload loader now use
fatal UTF-8 decoding after their bounded byte reads. The latter covers direct
station observations, contact searches and visibility windows. Invalid byte
sequences therefore fail before JSON interpretation instead of becoming replacement
characters in source identifiers, provenance or backend error messages.

Both loaders check their existing monotonic deadline after receiving bytes and
again after text decoding, before parsing JSON. Their post-parse/validation checks,
byte limits, error envelopes, source binding and cancellation cleanup remain.
Other inspected scientific library readers already use fatal UTF-8; the remaining
default decoder found in this source scan belongs to an input export UI and has
not been treated as transport validation.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Synchronous decode
and JSON parsing still cannot be preempted mid-call, and runtime compatibility and
full scientific/capacity acceptance remain unverified. The goal remains active.

### Checkpoint 511: preserve imported dynamics input bytes on export (2026-09-24)

DynamicsLaboratory now constructs its initial-condition export Blob directly from
the retained input ArrayBuffer. Previously it decoded through a default
TextDecoder and re-encoded via saveTextExport, stripping a UTF-8 BOM accepted by
the strict input parser and changing the exported source hash. The raw-buffer
path retains BOM, whitespace and line endings without a text round trip.

The worker already receives a sliced copy, so transferring calculation input does
not detach the retained export buffer. Blob construction snapshots the bytes before
the existing saveExport call. Experiment report exports remain serialized JSON;
they are separate artifacts from the original input. Existing generation-bound
error reporting and export filename remain unchanged.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Download bytes
and hash round trips remain execution-unverified; the full goal remains active.

### Checkpoint 512: reuse stellar source bytes during receipt binding (2026-09-24)

Web stellar validation now decodes each submitted source once and reuses the CSV
bytes for SHA-256 and selected-row validation. Previously the CSV was decoded
again after hashing. Digest calls check the abort signal before/after Web Crypto,
and source decoding boundaries also check it. Original Base64 equality, hashes,
selected fields and scientific receipt checks remain required.

stellarSourceBase64 now encodes 12 KiB source chunks independently and joins their
encoded strings, avoiding a second whole-source binary string. The chunk length
is divisible by three, preserving final-only padding. Full Base64 output and
Web Crypto buffers still allocate; atob, btoa and digest itself are not made
interruptible by this change. The dynamics receipt path already compares original
Base64, bytes, hash and parsed input before publication.

Source/call-site inspection and diff whitespace checks only. No tests, builds,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Encoding
equivalence and memory improvement remain unmeasured; the full scientific/capacity
goal remains active.

### Checkpoint 513: incrementally decode web Gaia CSV evidence (2026-09-24)

The selected Gaia source scanner now decodes 32 KiB source slices through one
fatal streaming TextDecoder rather than allocating a whole-file decoded string.
Parser state retains pending quote and CR lookahead across chunks, so escaped
quotes and CRLF can straddle a boundary. The decoder retains partial UTF-8
sequences and is flushed at EOF to reject a truncated final sequence.

The scan still visits the entire file, checks duplicate selected IDs, header and
row shape, and the 10,000-row limit. It yields and checks cancellation before each
byte chunk, including within a single long field. Current field/row and selected
row strings still allocate; this change does not claim constant total memory.
Only the first decoded BOM is handled by the decoder, as in the previous path.

Source/state-transition inspection and diff whitespace checks only. No tests,
builds, runtime/browser runs, benchmarks, CI waiting, commits or pushes. Chunk
boundary equivalence and memory/latency gains remain execution-unverified; the
full scientific/capacity goal remains active.

### Checkpoint 514: monotonic Gaia chunk admission-to-consumption deadlines (2026-09-24)

Gaia chunk jobs now record a monotonic 30-second deadline at admission and check
it around cache/hash work, network receipt, decoding and serialized consumer
delivery. Expiry aborts the shared batch even when the timer callback has not yet
run. A response received after expiry is cancelled before reading its body; expired
decoded chunks do not enter the consumer, and expired consumer completion is not
counted as verified. Already-aborted batches reject before manifest snapshot work.

Existing concurrency, source-byte, row and total selection budgets remain, with
reservations held through decoding and consumer completion. Consumer/GPU-retained
storage remains explicitly outside these in-flight budgets. This does not measure
heap amplification, GPU residency or frame rates, and cannot preempt synchronous
JSON/Web Crypto work or retract effects a consumer already performed.

Source/control-flow inspection and diff whitespace checks only. No tests, builds,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Deadline behavior
and full scientific/capacity acceptance remain execution-unverified; the full goal
remains active.

### Checkpoint 515: distinguish Gaia retained display budgets from total memory (2026-09-24)

Source audit followed GaiaSky, GaiaPlot, gaia.worker and GaiaSourceCache ownership.
The main viewer caps retained source rows at 10,000; CPU display batches and the
GPU point buffer each contain at most 120,000 coordinate bytes at that capacity.
Canvas dimensions have a 2,048-side/device cap. Source objects, decoded worker
objects, transfer copies, framebuffers and driver allocations are additional.

Reset/unmount paths invalidate stale callbacks, terminate active workers, unmount
the old plot and delete its buffers/program/shaders. Completed idle workers retain
the intentional 16 MiB/128-entry source cache for reuse and terminate on component
unmount. No missing release was established in this source pass, so no speculative
renderer rewrite was made. docs/gaia-data.md now states the precise retained-data
boundaries and the distinction from measured heap/GPU/frame-rate evidence.

Source/lifecycle inspection and diff whitespace checks only. No tests, builds,
runtime/browser/device runs, benchmarks, CI waiting, commits or pushes. Actual
release timing and sustained capacity remain unverified; the full goal remains
active.

### Checkpoint 516: reject unrepresentable Gaia display projections in the worker (2026-09-24)

projectGaiaDisplay now validates the catalog RA domain, 10,000-row budget and
direction-array shape before allocating its display buffer. It rejects a zero or
nonfinite tangent scale and verifies each stored Float32 display tuple remains
finite. A positive but underflowing radius or overflowing display coordinate now
fails at the producer instead of transferring an invalid array for main to reject.

The direction-vector projection, north/east basis, 1.1 display margin and Float64
source arrays remain unchanged. No arbitrary minimum cone radius or clipping of
scientific values was introduced. Original rows remain authoritative; finite
display values alone do not establish accuracy at very small angular scales.

Source/formula-path inspection and diff whitespace checks only. No tests, builds,
numerical experiments, runtime/device runs, benchmarks, CI waiting, commits or
pushes. Pole/seam behavior and representability boundaries remain execution-
unverified; the full scientific/capacity goal remains active.

### Checkpoint 517: align Gaia picking with uploaded and visible points (2026-09-24)

GaiaPlot picking now traverses only processed upload batches and uses the zoom
recorded by its draw path, rather than all received batches and possibly newer
React props. It rejects lost/zero-size canvases and point centers outside clip
space. Distances are measured in CSS pixels on both axes with the existing
12-pixel radius, preserving global row indices when clipped points are skipped.

The pick projection rounds zoom and products to Float32 to follow the display
path. Scientific source values remain untouched, and row-number selection still
allows inspecting any loaded source. The change avoids selecting not-yet-uploaded
or offscreen points near the chart edge; it does not add an angular accuracy claim
or change the shader's magnitude-based visual point sizes.

Source/index-flow inspection and diff whitespace checks only. No tests, builds,
runtime/browser/device runs, benchmarks, CI waiting, commits or pushes. Pixel,
context-loss and zoom timing behavior remain execution-unverified; the full goal
remains active.

### Checkpoint 518: retain Gaia manifest text for exported hash replay (2026-09-24)

GaiaSky clears partial rows, chart state and completion summary on cancellation or
failure; its export remains inside the validated completion section. That gate
already requires every expected chunk and upload acknowledgement, so no new
partial-result export path was needed.

The worker now also sends the original strictly decoded UTF-8 manifest text with
BOM preservation and its byte length. Main bounds and checks that length, retains
the evidence with the page, clears it on reset, and includes it as originalManifest
in completed exports. UTF-8 encoding originalManifest.text can reproduce the
manifestSha256 input; serializing the parsed manifest object alone cannot preserve
its whitespace, numeric spelling or BOM. This adds at most the admitted 1 MiB
source text payload (not a measured JavaScript heap bound), and does not authenticate
the manifest independently of the worker/source.

Source/state/export inspection and diff whitespace checks only. No tests, builds,
runtime/browser runs, benchmarks, CI waiting, commits or pushes. Hash replay and
failure/export behavior remain execution-unverified; the full goal remains active.

### Checkpoint 519: share the Gaia worker's source-evidence message contract (2026-09-24)

Source inspection found GaiaSky is the production Gaia worker consumer; the
capacity browser script uses the real worker rather than a fabricated manifest
message. A new type-only protocol now defines manifest, chunk, completion and
error responses. The manifest variant requires raw UTF-8 text, byte count and
hash together; chunks require source rows, sequence, path and transferable display
coordinates. Every worker send passes through the typed post helper, and GaiaSky
uses the same discriminated response union and load-request type.

Existing runtime bounds and validation remain necessary and unchanged: TypeScript
types do not validate a received structured-clone message or independently certify
its hash. No message scheduling, extra transfer, cache or acknowledgement behavior
was introduced by the protocol declaration.

Source/call-site inspection and diff whitespace checks only. No tests, typechecks,
builds, runtime/browser runs, benchmarks, CI waiting, commits or pushes. Compiler
and transport acceptance remain unverified; the full goal remains active.

### Checkpoint 520: validate Gaia selections before posting or indexing files (2026-09-24)

The shared Gaia protocol now admits exactly one local-files or remote-URL input.
It checks the file count before mapping, then File identity, duplicate names,
nonempty byte limits and the required bounded manifest. GaiaSky performs admission
before worker creation/posting; the worker repeats it before constructing its file
map. URL admission retains HTTP(S), no-credentials/query/fragment constraints.

Worker acknowledgements are accepted only during an active job with an actual
pending callback and a matching positive safe-integer sequence. The callback owns
clearing itself; stale/duplicate confirmations do not release another upload.
Cancellation and consumer cleanup paths remain unchanged. Validation does not
read file contents, authenticate sources or replace subsequent hash/schema checks.

Source/control-flow inspection and diff whitespace checks only. No tests,
typechecks, builds, runtime/browser runs, benchmarks, CI waiting, commits or pushes.
Structured-clone and acknowledgement behavior remain execution-unverified; the
full scientific/capacity goal remains active.

### Checkpoint 521: one deadline for Gaia manifest preparation (2026-09-24)

The Gaia worker now holds one 30-second timer and monotonic deadline through
request admission, local or remote manifest reading, schema decoding, SHA-256,
original-text preservation and manifest publication. Previously the remote timer
ended after byte reading, leaving decode/hash outside that phase's deadline;
the local reader's separate 25-second limit also covered only file reading.

Each stage boundary checks cancellation/expiry. A late fetch response is cancelled
before consumption, and expired preparation cannot publish the manifest. Successful
publication clears the preparation timer before chunk streaming; exceptional
cleanup also clears it. Existing per-chunk deadlines remain independent, and
local FileReader retains its own tighter read limit.

Source/control-flow inspection and diff whitespace checks only. No tests,
typechecks, builds, runtime/browser runs, benchmarks, CI waiting, commits or pushes.
Synchronous parsing and hashing are not made preemptible; timing and full
scientific/capacity acceptance remain execution-unverified. The goal remains active.

### Checkpoint 522: distinguish Gaia verified source reads from cache reuse (2026-09-24)

Gaia completion summaries now include cacheHitBytes, sourceReadChunks and
sourceReadBytes alongside the existing cacheHits and totalBytes. They count only
verified chunk bodies on the successful batch path and identify the fetcher-body
semantics explicitly: a fetcher may be local-file based, and manifest bytes and
transport overhead are excluded. totalBytes remains the selected source-byte sum,
not network traffic or peak memory.

GaiaSky validates descriptor byte sizes and checks completion byte/count partitions
against the received manifest/chunks before accepting the exportable summary.
Existing allocation-reservation and cache-retention statistics remain separate.
Documentation now records these distinctions so capacity evidence can distinguish
source reads from reuse without claiming heap, GPU or network measurements.

Source/counter-path inspection and diff whitespace checks only. No tests,
typechecks, builds, runtime/browser runs, benchmarks, CI waiting, commits or pushes.
Counter behavior and sustained capacity remain execution-unverified; the full goal
remains active.

### Checkpoint 523: reject mismatched Gaia cache sizes before copying (2026-09-24)

The chunk scheduler now supplies the reserved descriptor byte length to the source
cache lookup. The cache checks that length before copying or promoting the entry;
a mismatch evicts the entry and follows the existing source-read fallback. This
prevents an incorrectly sized cache entry from allocating a copy larger than the
chunk reservation. Same-sized entries still undergo hash and decoded-content
verification before use. The optional lookup parameter preserves existing callers
that do not use a descriptor, and does not confuse a small cache capacity with an
invalid larger source descriptor.

Source-path inspection and diff whitespace checks only. No tests, typechecks,
builds, runtime runs, benchmarks, CI waiting, commits or pushes. Cache allocation
behavior and fallback execution remain unverified; this is not a total heap bound.
The full scientific expansion goal remains active.

### Checkpoint 524: dispose failed Gaia graphics work immediately (2026-09-24)

Gaia plotting now shares an idempotent disposal path across initialization errors,
upload failures, context loss and component cleanup. It disconnects the resize
observer, removes the context-loss listener, clears the live plotting state and
deletes allocated buffers, programs and shaders before reporting failure. A queued
resize callback becomes a no-op after disposal. Draw errors are checked inside the
common drawing path, including zoom and resize redraws; a failed draw returns
without acknowledging its chunk. This allows the existing parent failure path to
invalidate completion, terminate the active worker and discard the displayed data.
An idle worker's bounded source cache remains intentionally reusable.

Source lifecycle inspection and diff whitespace checks only. No tests, typechecks,
builds, browser execution, benchmarks, CI waiting, commits or pushes. Actual driver
reclamation and lifecycle behavior remain unverified; no measured GPU-memory or
capacity claim is made. The full scientific expansion goal remains active.

### Checkpoint 525: propagate Gaia batch cancellation to pending uploads (2026-09-24)

The chunk consumer now receives the scheduler's batch abort signal. The Gaia
worker checks it before projection and uses it for upload-acknowledgement waiting,
including listener removal and the already-aborted gate. A sibling chunk failure
or chunk deadline can therefore settle that wait, clear its timer and release the
acknowledgement callback without first waiting for the entire scheduler to drain
and abort the outer worker controller. Consumer failures still propagate through
the existing serial-consumption chain. Existing consumers may ignore the added
callback argument; no source data or Float64 calculation is changed.

Source call-site and cancellation-path inspection plus diff whitespace checks
only. No tests, builds, typechecks, runtime runs, CI waiting, commits or pushes.
Runtime cancellation timing and retained-memory measurements remain unverified.
The full scientific expansion goal remains active.

### Checkpoint 526: read local Gaia chunks without HTTP-buffer round trips (2026-09-24)

The scheduler accepts an optional owned-byte reader, mutually exclusive with a
custom HTTP fetcher. It snapshots that callback and invokes it only after chunk
byte/row admission, passing the validated path, expected length and batch signal.
Both source paths rejoin before deadline, byte length, hash and decoded-content
verification. The worker's local reader validates file size and returns a view of
the bounded FileReader buffer directly, removing the Response wrapper and the
second full output allocation in readBounded. Remote reads remain unchanged.

Read-counter semantics and the viewer completion gate now explicitly describe
verified source bytes from either reader, excluding manifest and transport costs.
Documentation distinguishes the removed application copy from unmeasured browser,
digest, decoded-object and GPU storage. Only source and diff whitespace checks
were performed; no tests, typechecks, builds, runtime runs, benchmarks, CI waiting,
commits or pushes. The full goal remains active and execution-unverified.

### Checkpoint 527: carry conic cancellation through source and GM binding (2026-09-24)

Inspection of other scientific import paths found source snapshots used to bind
hashes and receipts; those copies remain intentional. The conic laboratory had a
separate cancellation gap: generation guards suppressed stale UI results but the
parser and experiment could continue after asynchronous digest completion. Both
now accept an optional abort signal. The UI passes its controller through import
validation and creates one for calculations, so clear/replacement/unmount also
abort that work. Checks before copying, after parsing and source hashing, and
after GM hashing prevent cancelled work from progressing to later stages; a final
check guards the propagated result. Controller cleanup is identity-guarded.

This does not preempt synchronous JSON parsing, Base64 conversion or the bounded
conic solver, and does not cancel WebCrypto's already-started digest. It prevents
subsequent stages from running after cancellation becomes observable. Source and
diff whitespace inspection only; no tests, typechecks, builds, runtime runs, CI
waiting, commits or pushes. The full goal remains active and unverified.

### Checkpoint 528: bound conic UI work through result acceptance (2026-09-24)

Conic import and calculation now share a 30-second work lifecycle spanning file
or module loading, parsing, hashing and result acceptance. The timer invalidates
the generation, aborts the controller and exits the busy state. Monotonic checks
after asynchronous stages and in both success/error publication paths prevent a
late completion from clearing a delayed timer. Clear, replacement and unmount
cancel the timer; finalization only clears the controller/timer owned by that
operation, so stale work cannot tear down a newer request.

Source inspection also confirmed the existing 1 MiB conic input bound and bounded
solver iteration loops; these were retained. This is a UI acceptance deadline,
not preemption of synchronous work or a measured latency guarantee. Source and
diff whitespace checks only; no tests, typechecks, builds, runtime execution, CI
waiting, commits or pushes. The full goal remains active and execution-unverified.

### Checkpoint 529: bound covariance import and conversion acceptance (2026-09-24)

The orbit uncertainty panel now applies a 30-second lifecycle to source import
and solution-epoch coordinate conversion. Its prior FileReader deadline ended
before parsing, Base64 preservation and source hashing. The new timer covers
those stages and GM hashing/conversion; monotonic gates before source hashing and
before result/error publication reject late work even when timer dispatch was
delayed. Timeout invalidates the generation and releases the busy state. Clear,
replacement and unmount abort the controller and remove the timer. Finalization
checks controller identity before changing state, preventing an old operation
from clearing a newer operation's timer or busy indicator.

The 2 MiB source budget, original-byte evidence and scientific transformations
remain unchanged. This does not preempt synchronous parsing/conversion or stop an
already-started digest. Source-path and diff whitespace inspection only; no tests,
typechecks, builds, runtime runs, CI waiting, commits or pushes. Full scientific
and performance completion remains unproven; the goal stays active.

### Checkpoint 530: reject late dynamics and contact input installation (2026-09-24)

File imports in the dynamics and occultation laboratories now set a 30-second
monotonic acceptance deadline before starting the existing cancellable FileReader.
Installation checks cancellation and expiry both before parsing and before any
input/source/settings state updates, including after contact-input Base64 encoding.
This closes the gap where a timely file read could be followed by delayed parsing
and still install the input. Failure leaves the previously cleared input empty;
generation guards continue to suppress obsolete errors and busy-state updates.
Bundled examples retain their existing synchronous installation path.

No extra timer is needed for these synchronous post-read stages: the file reader
already has a 25-second timer, and acceptance checks reject an overlong parse.
This does not interrupt synchronous parsing or establish a responsiveness bound.
Source and diff whitespace checks only; no tests, typechecks, builds, runtime
execution, CI waiting, commits or pushes. The full goal remains active.

### Checkpoint 531: constrain covariance numeric syntax and source lists (2026-09-24)

The TypeScript SBDB covariance parser no longer accepts JavaScript radix strings
through Number conversion. Numeric source strings must use decimal syntax with
optional sign, decimal point and exponent; surrounding whitespace remains allowed,
and the existing finite-number check remains. This applies to epochs, nominal
parameters and covariance entries without changing retained original bytes.

Matrix-axis count validation now precedes source-list traversal. The chosen
solution-element list and model-parameter list are capped at 64 entries before
map construction, consistent with the conic import's explicit list budgets.
Oversized inputs are rejected rather than truncated. The documentation scopes
these policies to this parser and does not claim bounds on JSON.parse allocation
or cross-runtime validation parity. Source and diff whitespace inspection only;
no tests, typechecks, builds, runtime runs, CI waiting, commits or pushes. The full
scientific and performance goal remains active and unverified.

### Checkpoint 532: align SBDB numeric-text and list guards across consumers (2026-09-24)

Go covariance source import and Android/iOS covariance receipt binding now check
decimal numeric syntax before their native floating-point conversions. Existing
finite-value checks remain. The accepted grammar permits decimal sign, fraction
and exponent while rejecting runtime-specific radix, suffix and separator forms.
Each named element/model list is limited to 64 entries before map construction,
matching the browser's resource policy. Original bytes, source hashes and receipt
comparisons are unchanged; oversized lists are rejected rather than truncated.

Source inspection only establishes the intended guards, not complete cross-runtime
numeric equivalence: underflow, rounding and whitespace handling still use the
respective runtimes. No tests, typechecks, builds, runtime runs, CI waiting, commits
or pushes were performed. Diff whitespace checks passed. The full goal remains
active; numerical and performance acceptance remains unverified.

### Checkpoint 533: preserve representable source correlations across scales (2026-09-24)

The browser and Go covariance source parsers now divide by the smaller marginal
standard deviation first when forming correlation entries. Row-ordered division
could first divide a tiny covariance by a large standard deviation, rounding the
intermediate to zero even when the final correlation was representable. It could
also apply a different arithmetic order to the transposed source entry. The new
order is symmetric in the two scales. For a valid covariance, the pairwise bound
implies the first quotient cannot exceed the larger standard deviation.

Original matrix values, positivity checks and eigensolver tolerances are unchanged.
This does not recover decimal input lost during binary64 conversion, guarantee
correct rounding, or remove underflow when the final result is unrepresentable.
Source/math inspection and diff whitespace checks only; no numerical experiments,
tests, typechecks, builds, runtime runs, CI waiting, commits or pushes. The full
goal remains active and numerical acceptance remains unverified.

### Checkpoint 534: align covariance consumers and version sampling arithmetic (2026-09-24)

Browser Gaussian correlation factorization and 3D marginal ellipsoid construction
now normalize by the smaller standard deviation first. Both source directions in
the sampling symmetry check use identical scale order. Because the arithmetic can
change seeded offsets, the browser sampling algorithm advances to
mulberry32-box-muller-cholesky-correlation-v2 and its ensemble receipt binding
requires v2; the random stream and draw order remain unchanged.

Android/iOS Jacobian covariance receipt residuals use the same ordered division,
retaining the explicit zero-variance branch and comparison tolerance. No covariance
repair, clipping or relaxed numerical acceptance was introduced. Source inspection
and diff whitespace checks only; no tests, numerical experiments, builds,
typechecks, runtime runs, CI waiting, commits or pushes. Full numerical and capacity
acceptance remains unverified and the scientific expansion goal stays active.

### Checkpoint 535: bind ensemble sampling metadata to submitted evidence (2026-09-24)

Source inspection traced the v2 sampling label through browser workers and offline
ensemble/conversion exports. Event-ensemble receipt binding already reconstructs
the sampler and checks its metadata. Ordinary dynamics ensemble binding checked
the reconstructed offsets, seed and count but did not fully bind the sampling
record's scientific interpretation. It now compares algorithm, distribution,
count, dimension, seed, labels, units, nominal values, solution epoch and solution
identity against the sampler reconstructed from the submitted source and request.
Thus matching packed offsets cannot validate incorrect axis or epoch metadata.

This reuses the existing bounded reconstruction and adds no force integration or
extra sampling pass. Source/call-path and diff whitespace checks only; no tests,
typechecks, builds, runtime runs, numerical experiments, CI waiting, commits or
pushes. Old numerical artifacts were not regenerated or relabeled. Full numerical
and capacity acceptance remains unverified; the goal stays active.

### Checkpoint 536: bind propagated covariance coordinate metadata (2026-09-24)

SBDB covariance receipt binding now requires the declared variational square-root
pushforward method and verifies that final coordinates use the original supported
heliocentric J2000 ecliptic frame, x/y/z/vx/vy/vz axis order, and AU/AU-per-day units.
Any requested covariance refinement must carry the same metadata. Previously the
initial coordinates and final epoch were bound, but the final frame/axis/unit
declarations were not independently required by this path.

The binding helper also now uses decimal numeric text and the 64-entry solution
element-list budget, consistent with the source parser. This is source/metadata
binding, not recomputation of propagated states, Jacobians or covariance matrices.
Source and diff whitespace checks only; no tests, typechecks, builds, runtime runs,
numerical experiments, CI waiting, commits or pushes. The full goal remains active
and scientific/performance acceptance remains unverified.

### Checkpoint 537: bind covariance matrices to their reported factors (2026-09-24)

Live browser dynamics receipt checks now validate finite six-component nominal and
standard-deviation vectors and finite 6x6 covariance/square-root arrays for both
primary and requested refined coordinates. Explicit array copying checks every
slot, including sparse entries. Each covariance must be symmetric, have
nonnegative variances, and match B B^T using the producer's left-to-right sum;
reported marginal sigmas must equal the square roots of the diagonal entries.
The comparison is exact within this same-runtime worker path and is not a
cross-runtime or archival import tolerance.

The added work is bounded matrix-summary verification, not force integration,
Jacobian recomputation or independent scientific validation. It cannot establish
that a mutually consistent factor and matrix came from the correct trajectory.
Source and diff whitespace checks only; no tests, typechecks, builds, numerical
experiments, runtime runs, CI waiting, commits or pushes. Full numerical and
performance acceptance remains unverified; the goal remains active.

### Checkpoint 538: bind covariance factors to source and returned transitions (2026-09-24)

Browser covariance receipt acceptance now reconstructs the bounded solution-epoch
coordinate conversion and source correlation factor from the submitted SBDB
payload using the receipt's already-checked adopted solar GM. It checks initial
nominal values, Jacobian, covariance, standard deviations and GM metadata, then
replays the same frame/unit matrix products through the returned 6x6 state
transition. Primary and requested refined square-root factors must match these
products. Transition entries must be finite, and the primary transition must
declare the expected dimension and J2000/SSB row-major derivative layout.

This closes acceptance of a mutually consistent final factor/matrix unrelated to
the submitted source or returned transition. It still trusts the transition's
underlying force integration and is not independent verification of dynamics,
Jacobian accuracy or physical uncertainty. Algebra is bounded to six axes and
compared within the live same-runtime worker path. Source and diff whitespace
inspection only; no tests, typechecks, builds, runtime execution, numerical
experiments, CI waiting, commits or pushes. The full goal remains active.

### Checkpoint 539: preserve covariance state-frame translation evidence (2026-09-24)

Covariance propagation now returns explicit initial/final prescribed Sun states,
their km/km-per-second units, reference and endpoint epochs, ephemeris identity,
and the fixed ecliptic/J2000 rotation and AU/day conversion constants. Browser
receipt binding checks this metadata, the initial integration sample against the
converted source nominal plus the initial Sun, and primary/refined heliocentric
nominals against their barycentric endpoints minus the final Sun. A zero-duration
receipt must use the same initial and final Sun state.

The added evidence enables algebraic replay of the previously implicit translation.
It does not independently authenticate the returned Sun states or reintegrate the
trajectory, and contributes no solar ephemeris covariance. Source inspection and
diff whitespace checks only; no tests, typechecks, builds, runtime runs, numerical
experiments, CI waiting, commits or pushes. Full acceptance remains unverified;
the scientific expansion goal stays active.

### Checkpoint 540: require zero-duration integration identity evidence (2026-09-24)

For direct dynamics and covariance jobs, live receipt acceptance now requires a
6x6 identity transition at zero duration and zero accepted/rejected steps, attempts,
derivative evaluations and error/step-size diagnostics, with no minimum accepted
step. Direct dynamics endpoints must equal the submitted initial state. Covariance
endpoints must equal the reconstructed barycentric integration input. Requested
refinement must retain the identity transition, identical endpoint and zero
reported primary/refined differences.

The constraints follow the current integrator's explicit no-step path. They do
not require the heliocentric coordinate round trip to reproduce the original
nominal bit-for-bit, nor label a zero-duration comparison convergence evidence.
Source and diff whitespace inspection only; no tests, builds, typechecks, runtime
runs, numerical experiments, CI waiting, commits or pushes. Full scientific and
performance acceptance remains unverified; the goal remains active.

### Checkpoint 541: bind integration diagnostics and retained endpoints (2026-09-24)

Direct dynamics and covariance live receipts now require the primary integrator's
declared settings and actual elapsed time. Accepted plus rejected steps must equal
attempts within 20,000, and nonzero-duration derivative evaluations must equal
1 + 6 * attempts, matching the producer's initial evaluation and FSAL stages.
Accepted step extrema and maximum accepted error ratio must be finite and within
the configured bounds. Requested refined-run counters receive the same checks.

Retained trajectories are bounded to the producer's 2,048 nodes, bind their step
and node counts, preserve the initial/final times, and contain finite six-component
states in integration order within the requested interval. The final sample must
equal the returned endpoint; direct dynamics' first sample also matches submitted
initial data. Covariance's initial state is bound by its separate coordinate path.
These checks do not certify omitted intervals or numerical/physical accuracy.

Source and diff whitespace inspection only; no tests, builds, typechecks, runtime
runs, numerical experiments, CI waiting, commits or pushes. The complete goal
remains active and execution acceptance remains unverified.

### Checkpoint 542: bind refinement differences to returned states (2026-09-24)

The integration receipt gate now checks primary transition dimension/layout and
all 36 finite entries, including for direct dynamics jobs without covariance.
Requested refinement must also provide 36 finite transition entries. The gate
recomputes the reported position and velocity endpoint differences and maximum
normalized transition difference from the returned primary/refined arrays, using
the producer's same-runtime operation order. Nonfinite or inconsistent comparison
values are rejected before display/export instead of being accepted as evidence
of refinement agreement.

This is bounded summary replay, not a second integration or a physical error
estimate. It does not prove either returned trajectory correct. Source and diff
whitespace checks only; no tests, typechecks, builds, runtime runs, numerical
experiments, CI waiting, commits or pushes. The full goal remains active and
numerical/performance acceptance remains unverified.

### Checkpoint 543: bind displayed heliocentric trajectory diagnostics (2026-09-24)

Each retained dynamics trajectory node now records the prescribed J2000/SSB Sun
state used for its heliocentric difference. Live receipt acceptance validates all
six Sun/state components, recomputes the position and velocity difference, and
checks the osculating diagnostic record against that relative state and the
already-declared solar GM. The diagnostic model, frame, origin, GM and presence of
its limitation are also checked before charts or exports consume the receipt.

The existing 2,048-node bound remains. Six added binary64 values per retained node
represent at most 98,304 numeric payload bytes, excluding object/serialization
overhead; this is not measured heap usage. Algebraic replay does not independently
verify the Sun SPK state, integration or physical accuracy. Source and diff
whitespace checks only; no tests, typechecks, builds, runtime runs, numerical
experiments, CI waiting, commits or pushes. The full goal remains active.

### Checkpoint 544: retain accepted-step indices for decimated trajectories (2026-09-24)

The trajectory recorder now retains an accepted-step index beside each kept node,
starting at zero. Indices undergo the same decimation and final-node replacement
as samples. Its selection description explicitly records that a final endpoint
can replace the last sampled node at capacity. This makes an existing exception
to the every-stride-th-node description visible in exports.

Receipt acceptance derives the expected power-of-two stride and retained index
sequence from the bounded accepted-step count and 2,048-node capacity, including
final replacement, and checks these against the sample count and declared policy.
This binds bookkeeping, not the numerical authenticity of each sampled state or
continuous between-node behavior. Source and diff whitespace checks only; no
tests, typechecks, builds, runtime runs, numerical experiments, CI waiting,
commits or pushes. The full scientific/performance goal remains active.

### Checkpoint 545: clarify trajectory export and historical evidence boundaries (2026-09-24)

Source tracing confirmed that direct/covariance workers and their offline writers
retain the new trajectory evidence through object spreading and JSON serialization;
the existing offline implementation manifests include the recorder and diagnostic
modules. No regeneration was performed. The browser readout now identifies stride
as accepted-step spacing, explicitly distinguishes variable time spacing, and
explains final-node replacement and exported node indices.

The dynamics documentation records the added fields and marks its previous
integrator/browser results as historical, predating these changes. Current strict
live-worker acceptance is distinguished from archival JSON import; old artifacts
were not updated to imply current verification. Source and diff whitespace checks
only; no tests, typechecks, builds, runtime runs, CI waiting, commits or pushes.
The full goal remains active and current numerical/performance acceptance unproven.

### Checkpoint 546: consolidate pending validation without executing it (2026-09-24)

Added a source-linked inventory of deferred acceptance for recent Gaia lifecycle,
import deadlines, covariance numerics, live receipt binding and trajectory changes.
It records specific success/rejection cases, cross-runtime and independent-oracle
needs, acceptance-cost measurements, historical-artifact boundaries and the limits
of a scoped test-source search. Every item remains unverified. It explicitly
preserves all workstreams and full-inventory capacity requirements in the main
ledger rather than treating these recent fixes as the whole goal.

Only source/document reads and diff whitespace checks were performed. No tests,
typechecks, builds, runtime runs, numerical experiments, CI waiting, commits or
pushes. The inventory is preparation for later evidence, not evidence of completion.

### Checkpoint 547: follow changed catalog selections within existing budgets (2026-09-24)

The opt-in focused/selected shard priority now follows changes while an explicit
stream request is active. A content-stable, deduplicated list remains capped at
256 located objects, focus first. Changes coalesce for 250 ms before remounting
the stream canvas with the existing filters, capacity, budgets and initial epoch.
Manual starts and automatic reloads share the same bounded list. An unchanged
list does not restart loading on unrelated catalog or clock notifications.

Effect cleanup cancels deferred reloads; request identity checks keep an old timer
from replacing a manual refresh or resurrecting a stopped request. Access is
rechecked before automatic reload and failures enter the existing error readout.
The canvas remount uses its existing worker termination, animation cancellation
and renderer disposal path. UI copy discloses the cleared view and additional
source reads. This is full reload, not incremental admission or a verified
responsiveness improvement; runtime cancellation, allocation and capacity remain
unverified. Source and whitespace checks only; no tests, builds, runtime checks,
CI waiting, commits or pushes. The full goal remains active.

### Checkpoint 548: size catalog scratch arrays to admitted rows (2026-09-24)

Catalog filtering now first records admission in the existing source-row bitmask,
then allocates orbital and appearance arrays for the exact admitted count. Ordered
set-bit iteration gathers unchanged Float64 source values and appearance metadata;
the gather skips empty masks and stops after the final admitted row. It cooperates
at bounded mask intervals and checks the gathered count against the admission
count. Source filtering, priority reservations, screening counters and row order
remain on the existing path.

The exactly sized appearance buffer is transferred directly, removing its final
slice copy. Worker source inspection confirms it transfers ownership and does not
reuse that buffer. The conservative plan reservation remains unchanged: this
reduces explicit scratch allocation for sparse/capacity-limited shards, without
claiming a measured heap or frame-time improvement or increasing capacity. The
additional mask walk and cancellation behavior need deferred runtime evidence.
Incremental admission without stream reload remains unfinished. Source checks
only; no tests, builds, runtime checks, CI waiting, commits or pushes.

### Checkpoint 549: reuse uploaded membership for changed selections (2026-09-24)

The stream canvas now publishes its checked source-row masks to the workspace,
only for the current load owner, and invalidates the callback on cleanup or lost
source evidence. The workspace binds that evidence to the exact stream request.
For a changed bounded priority list it checks membership directly by shard and
bit, without scanning all row populations or copying coordinates. When every
requested object is already loaded, focus/selection updates use the existing
display path instead of restarting the worker. An empty list also retains the
current snapshot; deselection does not evict uploaded objects.

A missing object still uses the debounced full reload and unchanged capacity and
filter rules. Receipt/export priority remains the actual load-time list, not the
new display selection. This avoids changing the claimed source ordering merely
because a display selection changed. UI copy distinguishes reuse from reload.
Source lifecycle tracing and whitespace checks only; runtime races, rendering,
resource costs and missing-object incremental admission remain unverified or
unfinished. No tests, builds, runtime checks, CI waiting, commits or pushes.

### Checkpoint 550: reuse bounded source-row rank lookups (2026-09-24)

Focused and selected uploaded-row resolution now shares a lookup built once per
checked source-selection object. Each shard retains its upload-order offset and
one uint32 population prefix per 256 bitmap bytes. Each lookup performs direct
shard/membership checks followed by at most 255 prefix-tail byte populations,
instead of rescanning earlier shards or the full inventory for each selection
change. Bounded multi-selection preserves caller order and duplicate locators.
Missing/invalid locators remain absent rather than acquiring a display row.

The lookup borrows immutable checked masks, without coordinate or mask copies.
Its lifetime follows the canvas source evidence; no global cache retains old
catalog releases. The streaming plan explicitly reserves prefix storage and
per-shard map-entry headroom, potentially reducing admitted capacity slightly.
Object overhead is an estimate, not a browser RSS bound. The original scan helpers
remain available for deferred independent equivalence checks. Construction cost,
boundary correctness, lifecycle behavior and actual performance remain unverified.
Incremental admission still needs coordinated row/epoch/render updates. Source
and whitespace checks only; no tests, builds, runtime checks, CI waiting or commits.

### Checkpoint 551: preserve exact-epoch blocks under a zero drift budget (2026-09-24)

Retained-epoch worker requests now always provide the acknowledged block-reuse
path. Previously a zero drift budget disabled that path and recomputed every row,
including blocks already at the exact requested UTC epoch. The existing epoch
planner permits only exact-epoch reuse at zero budget, while unknown/invalidated
block epochs still require computation. This particularly avoids redundant work
when tightening a previously nonzero budget on a mixed-epoch snapshot. No new
reuse tolerance, interpolation or scientific approximation is introduced.

The canvas now requires zero displacement if and only if the block's computed
epoch equals the requested epoch, both at reuse receipt and final evidence
validation. This matches the producer's temporal bound, which rejects nonpositive
displacement for distinct valid epochs. Conflicting time/displacement evidence
fails before retaining the block. Source tracing covered bounded buffer return,
stale ACK handling and block invalidation, but did not execute those paths.
Performance, cancellation and exact-output equivalence remain unverified. No
tests, builds, runtime checks, CI waiting, commits or pushes; full goal active.

### Checkpoint 552: reject failed redraws before claiming presentation (2026-09-24)

Source tracing confirms partial epoch cancellation discards mixed CPU/GPU
snapshots, clears source/epoch evidence and terminates the worker; coherent stopped
snapshots retain only their supported display path. No runtime claim follows from
this tracing. The shared catalog renderer had a separate gap: camera/resize-only
draws could bypass upload checks and return success despite WebGL draw errors.

The common draw exit now checks context loss and WebGL errors after drawing, and
after clearing an incoherent frame. Both sample and streamed canvases already
catch renderer exceptions, dispose resources and mark the view unavailable; the
streamed path also invalidates evidence rather than claiming presentation.
Restoration therefore cannot rely on a silently failed final draw. The added GL
query has a potential driver synchronization cost that requires later measurement;
no frame-time gain or browser failure-handling acceptance is claimed. Source and
whitespace checks only; no tests, builds, runtime runs, CI waiting or commits.

### Checkpoint 553: hand single-priority preflight data into streaming (2026-09-24)

When the only admitted priority shard is the first scheduled shard, its verified
compact metadata and binary buffer now feed the normal streaming phase directly.
The buffer occupies a normal prefetch slot, and its preflight reference is cleared
when queued. Metadata ownership is handed to the first compute iteration. No
second priority shard may coexist with this handoff, preserving the one-metadata-
shard reservation; multi-shard preflight keeps the existing bounded behavior.

The normal full binary-element validation, exact source filters, reservation
logic, row masks and scientific propagation still run. Only repeated metadata
decode and repeated binary fetch/hash are removed for this case; bytes already
passed the same manifest-bound hash checks. Cancellation is checked before
consuming handed-off metadata and the existing queue/compute signal checks remain.
No new persistent cache or row capacity is introduced. Runtime read counts,
allocation lifetime and output equivalence remain unverified. Missing-object
incremental admission remains unfinished. Source and whitespace checks only;
no tests, builds, runtime runs, CI waiting, commits or pushes.

### Checkpoint 554: export explicit per-selection uploaded-row mappings (2026-09-24)

Catalog exports previously included the full selected-source list beside a compact
uploaded-row list that omitted absent objects. These lists cannot be positionally
paired when an earlier selection is missing. The display/export path now derives
an explicit selectedSourceRows list from the same checked rank lookup used for
display, preserving every selected source and using null for missing uploaded rows.
Row zero remains a present row. The compact renderer list derives from this mapping.

Exports retain the existing fields and add a layout explanation distinguishing
compact present-row indices from per-source mappings. This removes ambiguity for
capacity-limited selections and future row replacement; it does not implement
incremental replacement or authenticate object identities beyond the existing
source locator/hash contract. Source and whitespace checks only. Round-trip export
and selection behavior remain unverified; no tests, builds, runtime runs, CI
waiting, commits or pushes.

### Checkpoint 555: keep cancelled catalog requests stopped (2026-09-24)

The canvas cancellation/failure path now reports the stopped request to its
workspace. Automatic selection-follow reloads check that exact request identity
both before scheduling and synchronously when their debounce timer runs and state
update applies. This prevents a queued selection change from restarting work that
the user just cancelled, or silently retrying a failed snapshot. Existing coherent
stopped views remain available through their current display path.

Only explicit refresh/new requests or either canvas reload action re-enable
automatic following. Source-evidence delivery does not resume it: a completion
queued near cancellation must not override the stop. UI copy explains the stopped
state and resume actions. Request-scoped callbacks remain stable across selection
changes, avoiding restarts of the canvas load effect. These are source-level
lifecycle changes; timer races and retry behavior remain unverified. No tests,
builds, runtime checks, CI waiting, commits or pushes; the full goal remains active.

### Checkpoint 556: fence late catalog callbacks by committed request ownership (2026-09-24)

Workspace callbacks now check the committed active stream request before accepting
stop/resume signals or installing source evidence. Layout cleanup clears ownership
on request replacement, inactive filter/budget keys and unmount; abandoned renders
do not publish a new owner. Old source cleanup can clear only evidence belonging
to its own request, never a newer request's masks.

The automatic reload timer and its state updater also compare the latest committed
priority-list key. A callback queued before passive effect cleanup cannot load an
obsolete selection list or revive an inactive request. This strengthens checkpoint
555 beyond relying on canvas cleanup timing. Source and whitespace checks only;
React scheduling, timer/worker races and unmount behavior remain unverified. No
tests, builds, runtime checks, CI waiting, commits or pushes. Incremental row
replacement and the broader goal remain unfinished.

### Checkpoint 557: reconcile follow UI and current GitHub backlog (2026-09-24)

The source-selection caption no longer claims that missing bodies are never loaded
automatically. It now identifies the priority/follow control and the existing
filter/capacity limits, matching the implemented opt-in behavior. Static tracing
still shows that source masks, epoch blocks and upload order share a contiguous
layout; arbitrary incremental row replacement is not implemented or certified.

Read-only GitHub reconciliation used the confirmed origin dajiaohuang/solar and
the paginated open-issues endpoint, which includes pull requests. It returned an
empty page (openItemsOnPage: 0), so no currently open issue or PR needs disposition
in that snapshot. This is not evidence that all scientific requirements are done
or that closed historical changes are correct. No checks/CI status were queried
or awaited and no remote state was changed. Source/diff checks only; no tests,
builds, runtime runs, commits or pushes.

### Checkpoint 558: expose osculating orbital timescales (2026-09-24)

Dynamics conic diagnostics now include apoapsis and the instantaneous elliptic
period. The period uses 2*pi*sqrt(a)*(a/sqrt(mu)), avoiding an intermediate cube
of semimajor axis. Nonelliptic, near-parabolic, degenerate-plane or unrepresentable
values remain null. The browser shows initial/final values, retained-node ranges
and absolute experiment duration divided by the initial instantaneous period.
This contextualizes the short integration window without claiming measured
revolutions, resonance detection or long-term stability.

Reference: NAIF OSCLTX, https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscltx_c.html,
defines period for elliptic conics and documents near-parabolic/degenerate limits.
Solar uses null rather than NAIF's zero sentinel. Current worker/offline trajectory
exports carry the added fields, and live receipt checking reconstructs the same
diagnostic object; this source trace is not independent numerical validation.
Independent reference cases, actual exported artifacts and performance evidence
remain pending. No tests, builds, numerical runs, CI waiting, commits or pushes.

### Checkpoint 559: bind orbital timescale comparison into experiment receipts (2026-09-24)

The initial-period comparison is now a named diagnostics.timescaleComparison
record shared by the experiment producer, UI and strict live receipt checker.
It retains signed elapsed TDB seconds, the initial instantaneous period, the
absolute-duration ratio and its non-stability interpretation. Undefined periods,
overflow and nonzero-duration ratio underflow remain null; valid zero-duration
elliptic experiments retain a zero ratio. The UI reads the checked result rather
than deriving a separate display-only value.

The checker reconstructs the initial diagnostic from the submitted trajectory
state and Sun translation before comparing the complete timescale record. Existing
browser/offline full-result exports preserve it; the already-hashed osculating
implementation contains the shared calculation. No historical artifacts were
rewritten. This establishes source wiring, not numerical correctness or actual
export acceptance. No tests, builds, numerical runs, CI waiting, commits or pushes.

### Checkpoint 560: expose nominal diagnostics in covariance propagation (2026-09-24)

Source tracing confirms covariance propagation retains the complete nominal
experiment via object spreading, and browser export serializes that experiment.
The covariance panel now also renders the shared orbit diagnostics, including
period, apoapsis, retained-node ranges and the checked timescale comparison.
It explicitly distinguishes the nominal trajectory's heliocentric J2000 equatorial
diagnostics from the J2000 ecliptic coordinate covariance displayed above them.

The panel states that uncertainty in derived period/apoapsis is not propagated;
nominal variation is not mislabeled as covariance or event probability. No new
integration or scientific approximation is introduced by this UI connection.
Runtime receipt acceptance, rendering and exported artifacts remain unverified.
No tests, builds, numerical runs, CI waiting, commits or pushes. Full source-fit
uncertainty, independent numerical evidence and the other goal workstreams remain
unfinished.

### Checkpoint 561: propagate conditional osculating-period uncertainty (2026-09-24)

Added a source-wired analytic delta-method projection from the six-dimensional
heliocentric endpoint and its full covariance square root. With fixed solar GM,
alpha = 2/r - v.v/mu and dP = -(3/2)*(P/alpha)*dalpha. Sigma uses the norm of
gradient times the covariance factor, retaining cross-component correlations.
The result records units, fixed GM, period gradient, reciprocal-axis sigma and
whether its linear one-sigma interval reaches the parabolic boundary. Unsupported
or unrepresentable periods/gradients remain null rather than becoming a zero sigma.

Both baseline and refined covariance outputs carry the result. Live receipt
binding reconstructs it from the checked nominal state and propagated factor.
The covariance UI exposes the nominal period/formal sigma and interpretation;
offline implementation hashes now include the new helper. Method reference:
https://physics.nist.gov/cuu/Uncertainty/combination.html (first-order propagation
with covariance terms). This is a conditional instantaneous quantity, not a
nonlinear period distribution, actual return-time uncertainty, calibrated interval
or full SBDB fit reproduction. Independent derivative and numerical comparisons
remain pending. No tests, builds, numerical runs, CI waiting, commits or pushes.

### Checkpoint 562: distinguish unavailable period projections from zero sigma (2026-09-24)

The period projection now uses compensated summation for the six signed terms in
each covariance-factor column. Nonfinite terms/sums and detectable multiplication
or derivative underflow return null instead of a misleading zero sigma. Genuine
zero covariance and exactly cancelled projected components remain eligible for a
zero formal sigma. These guards are conservative floating-point checks, not error
bounds or high-precision validation.

An exported periodStatus distinguishes a computable conditional result from an
invalid/unrepresentable state, near-parabolic/degenerate/nonelliptic cases, and an
unrepresentable period or projection. The covariance UI translates each status;
the existing complete-record receipt comparison also binds it. A computable status
does not certify linear approximation quality; the separate alpha-boundary flag
and limitations remain visible. Source and whitespace checks only; no tests,
builds, numerical runs, CI waiting, commits or pushes. Full goal remains active.

### Checkpoint 563: compare baseline and refined formal period results (2026-09-24)

The covariance period panel now displays baseline and optional refined results
side by side, including each calculation status, nominal period, formal sigma,
reciprocal semimajor axis/sigma and the linear parabolic-boundary flag. Missing
values remain undefined per column; zero values are preserved. Without requested
refinement only the baseline column appears, rather than implying a failed or
unavailable comparison run.

Boundary messaging considers both columns and exposes the quantities behind the
flag. The UI states that no boundary crossing is not a linear-validity proof, and
that agreement under two integration settings is neither independent validation
nor convergence evidence for zero-duration experiments. Both columns consume the
existing checked/exported records; no extra integration runs were added. Source
and whitespace checks only; browser layout and numerical acceptance remain
unverified. No tests, builds, runtime runs, CI waiting, commits or pushes.

### Checkpoint 564: bind derivative units and reciprocal-axis availability (2026-09-24)

Period-uncertainty exports now identify Cartesian axis order, per-component units
for both analytic gradients, and the covariance-factor projection layout. The
reciprocal-axis gradient is retained alongside its sigma so the boundary flag is
auditable without inferring derivative units from field names. These fields pass
through the existing full-record reconstruction checks and both numerical outputs.

When the nominal reciprocal axis is unrepresentable, its gradient, sigma and
boundary flag now remain null together. A zero caused by an unrepresentable axis
outside the existing near-parabolic classification no longer appears as a valid
parabolic crossing. This is a numerical availability guard, not a physical regime
uncertainty estimate. Source and whitespace checks only; independent arithmetic,
unit-conversion and exported-artifact validation remain deferred. No tests, builds,
runtime runs, CI waiting, commits or pushes; the full goal remains active.

### Checkpoint 565: include solution-epoch period uncertainty (2026-09-24)

Covariance propagation now retains the initial Cartesian covariance factor already
used by the integration transform, and projects the initial nominal period through
that same factor. The initial result, baseline endpoint and optional refined
endpoint therefore all use the same fixed solar GM and analytic projection policy.
Live receipt checking reconstructs and compares the initial factor and complete
derived record, alongside the existing endpoint checks.

The UI displays two or three distinctly labeled columns with signed elapsed TDB
days from the solution epoch, preserving each column's status/nulls/boundary flag.
Its explanation distinguishes evolution across epochs from comparisons between
integration settings. Full-result exports retain the added initial evidence; no
new integration is required. Source/diff checks only, not numerical agreement or
round-trip export proof. No tests, builds, runtime runs, CI waiting, commits or
pushes; the broader scientific and incremental-loading goal remains unfinished.

### Checkpoint 566: retain covariance factorization diagnostics (2026-09-24)

The correlation-space Cholesky factor now reports its accepted maximum transpose
asymmetry, symmetry tolerance and maximum reconstruction residual against the
averaged correlation matrix. Metadata explicitly records transpose averaging and
the absence of jitter/eigenvalue clipping. Original source matrices remain intact;
these diagnostics do not claim bitwise identity with the direct source-unit
Cartesian covariance calculation, which has a different floating-point order.

Covariance propagation and Gaussian sampling retain this factorization record.
The covariance UI exposes its two measured residual quantities, and covariance,
endpoint-ensemble and event-ensemble receipt checks reconstruct the record from
the submitted source. Existing factor/sampling arithmetic is unchanged; the new
bounded residual pass rejects nonfinite reconstruction. This is consistency
metadata, not a condition number, accuracy bound or independent validation.
Source and whitespace checks only; no tests, builds, numerical runs, CI waiting,
commits or pushes. The full goal remains active.

### Checkpoint 567: expose shared factorization evidence across uncertainty panels (2026-09-24)

A shared bilingual factorization panel now serves conditional covariance,
nonlinear endpoint ensembles and distance-event ensembles. It displays source
dimension, correlation symmetry tolerance, maximum transpose difference and
reconstruction residual, including the dimensionless interpretation and limits.
The covariance page's duplicate inline explanation was replaced by this panel so
all three consumers describe the same checked record consistently.

Source tracing confirms both ensemble exporters serialize the full result and
only replace packed numeric arrays, preserving the new factorization object.
No new sampling or integration is performed by the panel. Browser behavior,
rendering and actual exported artifacts remain unverified; residuals are not
independent numerical validation. No tests, builds, runtime checks, CI waiting,
commits or pushes. The full goal remains unfinished.

### Checkpoint 568: expose event timing sample dispositions and reject sparse receipt vectors (2026-09-24)

Each directional event-time summary now exposes its included and excluded draws,
the exclusion reason, and the selected event/time for included draws. Draw buttons
select the corresponding existing detail panel. Display indices are one-based;
exports retain zero-based indices. The explanation makes clear that excluded
draws receive no zero event time and do not establish event absence. Existing
direction-specific sample selection and quantile arithmetic are unchanged.

Ensemble receipt vector validation now materializes and checks every required
array slot with Array.from. Sparse arrays can no longer bypass finite-number
validation through Array.prototype.some/every skipping holes, including tolerance
vectors. The returned vector is a dense numeric copy.

Source inspection and whitespace checks only. UI behavior, malformed receipt
rejection and numerical outcomes remain unverified. No tests, builds, runtime
checks, CI waiting, commits or pushes. The full goal remains unfinished.

### Checkpoint 569: bind reported event times to localization midpoints (2026-09-24)

Event-ensemble receipt checks now require each reported time to equal the exact
midpoint expression used by the trajectory search producer. Previously an altered
time anywhere inside its bracket could satisfy that particular check. The timing
summary also enforces midpoint consistency before selecting and sorting events.
Collapsed sampled-zero brackets retain their exact time, including zero.

The selected-draw event table now shows one-based event numbers matching the
conditional summary's displayed event numbers; exports retain zero-based indices.
This adds traceability without changing the search or quantile calculation.
Only source inspection and whitespace checks were performed. Numerical, receipt
mutation and browser checks remain deferred. No tests, builds, CI waiting,
commits or pushes. The full goal remains unfinished.

### Checkpoint 570: bind event ensemble receipts to their declared scan grid (2026-09-24)

Successful event draw receipts now reconstruct the declared elapsed-time scan
grid once per ensemble, capped at 2,048 points under the existing request limit.
The reconstruction preserves the producer's operation order and explicit final
endpoint. Reported maximum scan spacing must equal the reconstructed maximum,
and event scan brackets must use grid points. Sign-change brackets must connect
adjacent points; duplicate records in one scan slot and sign changes starting
from a reported sampled zero are rejected. Endpoint zero values must match the
presence of endpoint zero records. A zero-duration successful search must retain
one evaluation and identical endpoint values.

This is bounded receipt consistency checking, not trajectory reintegration or
independent event completeness/accuracy evidence. Failed and unresolved draws
do not require a successfully completed grid. Source inspection confirmed the
2,048 evaluation limit in both request and engine validation. Runtime and mutation
checks are deferred. No tests, builds, CI waiting, commits or pushes; the overall
goal remains unfinished.

### Checkpoint 571: trace event receipt checks through both export entry points (2026-09-24)

Source inspection traced browser acceptance from dynamicsJob.ts through
checkDynamicsReceipt and checkEnsembleEventReceipt before the UI's done callback.
EnsembleDistanceEvents exports the complete accepted result and converts only
Float64Array/Uint8Array values to JSON arrays. The original source bytes, payload,
draw statuses, event brackets, timing selections/exclusions and factorization
record therefore remain present in the serialization code. Invalid coordinate
NaNs serialize as null under the stated packed-array convention.

The offline search-sbdb-events.mjs entry point performs the same live typed-array
receipt checks before serialization and writeScientificReceipt. It additionally
retains the original settings file and hashes the event search, timing summary
and event receipt implementation files. No missing-field defect was found in
these two serialization paths, so no speculative serializer rewrite was made.
This establishes source-path continuity only: real JSON artifacts, decoding,
browser saves and offline execution remain unverified. No tests, builds, CI
waiting, commits or pushes. Incremental catalog admission and all other pending
acceptance-ledger requirements remain part of the unfinished goal.

### Checkpoint 572: retain existing epoch evidence when extending a sealed catalog store (2026-09-24)

Source tracing identified two incremental-admission constraints: the source-row
lookup assumes one upload per shard, and the retained epoch store previously
rejected every append after sealing. The epoch store now exposes appendUploaded
for acknowledged rows appended to a sealed snapshot, using its existing fixed
coefficient and block capacities. It validates all incoming coefficients, count,
speed and epoch before mutation, rejects appends during compute, and preserves
every existing block's computed or unknown epoch. Only the new block receives
the supplied upload epoch. Initial unsealed append and seal keep their lifecycle.

This is an implementation prerequisite, not delivered incremental loading:
the worker does not call appendUploaded yet. Source identity/deduplication,
repeat-shard upload-order mapping, spatial/GPU admission and ACK integration,
selection changes and cancellation still require coordinated implementation.
The fixed block capacity remains enforced; there is no silent budget increase,
eviction or full-cache reallocation. Runtime behavior is unverified. Source and
whitespace checks only; no tests, builds, CI waiting, commits or pushes.

### Checkpoint 573: preserve upload row identities across repeated-shard additions (2026-09-24)

A bounded source-append lookup now layers up to 256 added body identities over
the immutable base rank lookup. New row numbers follow append order and ascending
mask bits within each batch; existing row numbers never change. Repeated shards
must retain binary/metadata hashes and mask size. Whole batches are validated for
duplicate bodies, source identity, expected upload start and fixed capacity before
committing mapping changes. Added masks are consumed into numeric identities,
not retained or merged with base masks. The base lookup exposes its row count.

This is another incremental-admission prerequisite, not a working UI feature.
The new lookup is not yet called by the worker/canvas. Its base-source map and
bounded overlay storage must be included in budget admission when integrated;
the original static path does not allocate them. Worker upload acknowledgement,
epoch-cache admission, spatial indexing, append-aware export evidence and capacity
exhaustion handling remain outstanding. No runtime/performance evidence was
produced. Source and whitespace checks only; no tests, builds, CI waiting,
commits or pushes. The full goal remains unfinished.

### Checkpoint 574: stage appended source mappings until upload acknowledgement (2026-09-24)

The new source-append lookup now offers prepareAppend instead of immediate
append. A validated batch reserves its expected start/count without changing
visible lookup rows. Exactly one reservation is allowed. Commit requires the
matching acknowledged start/count and unchanged base count; mismatch releases
the reservation without publishing it. Cancel is idempotent, clears staged maps
and cannot cancel a newer reservation. Duplicate or stale commits are rejected.

Source inspection of CatalogStreamCanvas confirms existing initial-load ACKs
follow renderer append, GL error checks and draw. The future append protocol must
preserve that boundary and coordinate epoch/spatial changes; this helper alone
does not provide GPU rollback or distributed atomicity. Append storage budgeting,
worker/canvas integration and export evidence remain outstanding. Neither new
append helper has a runtime caller yet. No tests, builds, app checks, CI waiting,
commits or pushes; only source inspection and whitespace checks were performed.

### Checkpoint 575: reserve append rows and bookkeeping before initial loading (2026-09-24)

The stream planner accepts an optional 0..256 append-row reserve, requiring
retained epochs. It reports total capacity, initial capacity, append capacity,
append bookkeeping bytes and maximum epoch blocks. Append slots are carved from
the existing total requested-row ceiling and leave at least one initial slot
when capacity permits. Additional rank/source-map headroom, mask copies, staged
and committed identity maps and epoch-block receipts enter the fixed reservation.
Map/object estimates remain headroom, not a guarantee about total browser RSS.

The initial loader consistently applies initialCapacity to reservations, source
admission, prefetch decisions and stopping. Worker start parameters carry the
optional reserve and allocate the planned extra epoch blocks while keeping total
point storage fixed. The epoch store permits at most 65,536 source blocks plus
256 extension blocks. The default zero-reserve path keeps the prior capacity
formula. The Canvas does not opt in yet: append requests/ACKs, append-aware
completion and temporal receipts, spatial updates and exports still need wiring.
No end-to-end append or memory-performance result is claimed. Source/whitespace
checks only; no tests, builds, CI waiting, commits or pushes.

### Checkpoint 576: prepare bounded source-checked append batches (2026-09-24)

A new append-batch preparer freezes the manifest, filters and up to 256 unique
source locators before asynchronous work. It reuses streamCatalogPoints for
checksum/source validation, exact filtering, priority admission, Float64
propagation and cancellation. Output retains exact-sized positions, appearance,
prepared orbital coefficients, requested locators and the complete screening/
source-selection receipt. Expected content/index hashes and prepared/upload row
counts are checked before returning. It does not install data into GPU or epoch
storage; caller serialization and append-budget admission remain required.

The shared stream loader now marks candidate-containing shards with one byte per
shard and skips unrelated shards before index-row scanning. Skipping preserves
the existing exact candidate contract and still yields during long shard loops.
The planner reserves this additional byte array. The complete checked index is
still fetched; no reduced-network or measured latency claim is made.

Worker append requests, ACK publication and Canvas integration remain unfinished;
the new batch preparer has no runtime caller yet. Real source loading, peak memory,
numerical results and cancellation behavior are unverified. Source/whitespace
checks only; no tests, builds, CI waiting, commits or pushes.

### Checkpoint 577: connect bounded append preparation and ACK admission in the worker (2026-09-24)

The catalog worker now initializes an append layout after initial uploads drain
and the epoch store seals, only when its plan reserved append capacity. Append
requests require a fresh request identity, matching current row count/completed
epoch, available reserved slots and no concurrent epoch/append computation.
Preparation uses the frozen initial manifest/filters and rejects uploaded bodies.
The protocol carries source-bearing append tiles and a matching start/count ACK.

The worker transfers Float64 positions and appearance, waits for a bounded
30-second ACK, then commits epoch coefficients, source mapping and spatial row
count. Culling uses a checked Float32 tail copy. Until ACK, appended rows are not
available for spatial selection. Empty filtered batches preserve the old count
and return their screening evidence. Errors after preparation starts discard the
snapshot as a unit rather than claiming GPU rollback; cancellation releases the
append state and aborts pending work. Stale ACKs cannot publish another batch.

This connects the prior append helpers to a worker caller, but the Canvas still
does not request append mode or handle its new responses. UI upload/ACK binding,
temporal receipts, restoration and exports remain unfinished. No browser/worker
execution or performance claim: source and whitespace checks only; no tests,
builds, CI waiting, commits or pushes. The full goal remains unfinished.

### Checkpoint 578: bind append receipts to requested identities before transport (2026-09-24)

A shared bounded append-receipt checker now binds selected mask bits to the
request's exact unique locator set, source content/index hashes, shard hashes,
mask lengths/padding, selected-shard order and screening totals. It distinguishes
metadata rejection from binary screening and capacity stopping from complete
screening; retained speed bounds must be finite positive or explicitly unknown.
The batch preparer calls it before returning data to the worker transport.

Canvas initial completion handling now explicitly requires a done response before
reading initial-load fields, avoiding conflation with the newly expanded append
protocol. Canvas append upload/ACK handling itself is not complete and remains
disabled. The shared checker is ready for use at that receiving boundary but is
currently called only by the preparer. This is structural/source consistency,
not independent filter, position or physical accuracy validation. No tests,
builds, runtime checks, CI waiting, commits or pushes; source/whitespace checks
only. The full goal remains unfinished.

### Checkpoint 579: receive and acknowledge appended rows in the Canvas (2026-09-24)

CatalogStreamCanvas accepts an opt-in append reserve, propagates it to the
planner/worker and exposes a bounded manual append action when enabled. It checks
request/epoch/start identity and source receipts before converting transferred
Float64 positions to GPU attributes. Source mapping is staged, GPU errors are
checked before ACK, and the completion receipt must match the uploaded batch
before publishing its rows. Added attributes join context-restoration storage.
Cancellation or context loss during append discards the incoherent snapshot.

Appended batches extend source-block counts and undergo the normal epoch receipt
handshake before a new temporal summary is published. Selection lookup replays
acknowledged additions without renumbering base rows. Exports with additions use
schema 4 and retain requested locators, ordered batch masks, source/screening
records, start rows, initial/total loaded counts and append budget fields.
Repeated shards remain separate batches, never a union-mask upload layout.

The parent CatalogWorkspace still passes no append reserve; product opt-in and
coordination with its existing reload/follow behavior remain outstanding. No
end-to-end, browser, GPU or memory acceptance has been run. Empty/rejected append
attempts are not yet exposed as a dedicated UI result. Source/whitespace checks
only; no tests, builds, CI waiting, commits or pushes. Full goal unfinished.

### Checkpoint 580: expose manual selected-body append without automatic reload conflicts (2026-09-24)

CatalogWorkspace now exposes an opt-in append reserve when orbit retention is
enabled, passes the same reserve to capacity planning and Canvas, and includes it
in snapshot identity. Changing the option requires restarting the snapshot.
While enabled, selection changes no longer trigger the legacy whole-snapshot
reload timer; initial selected-first admission remains available with an accurate
label. The plot action manually appends missing selected bodies under the original
filters, fixed capacity and frozen source contract. Deselection does not reclaim
slots, and exhaustion requires explicit refresh.

Canvas shows remaining slots, busy/no-missing outcomes and the latest completed
attempt, including zero matches versus capacity-limited omissions. It retains
that latest attempt in source exports; append-enabled exports use schema 4 even
before a successful addition. Progress wording covers both object additions and
epoch updates. Source tracing connects the parent control through worker
preparation, checked upload/ACK and subsequent epoch reconciliation, but this
complete source path has not been run and is not runtime acceptance.

Automatic incremental following, persistent source/index cache reuse, richer
eviction/admission policy and measured capacity/performance remain outstanding,
along with other acceptance-ledger requirements. No tests, builds, browser/GPU
checks, CI waiting, commits or pushes. Source and whitespace checks only.

### Checkpoint 581: preserve unchanged epoch evidence after an empty append (2026-09-24)

Canvas now retains the last completed epoch receipt locally while an append is
pending. If no bodies are added, it restores the unchanged computed-epoch and
block evidence, then lets the ordinary latest-clock/drift-budget decision decide
whether another update is necessary. Previously every empty append invalidated
the temporal summary and forced a whole-layout epoch handshake despite leaving
all coordinates untouched. Successful nonempty appends still invalidate the old
layout's summary and reconcile all old/new blocks before publishing new evidence.

Append success feedback is now published only after the full completion receipt
matches the uploaded batch. Failure or cancellation that discards the incoherent
snapshot also clears appended-row history and the last-attempt notice; stale
success feedback cannot remain attached to the discarded view. Source tracing
confirms the latest target ref is consulted after append completion, and append
admission remains blocked during epoch compute/presentation. No runtime timing,
GPU or performance evidence: source/whitespace checks only, no tests, builds,
CI waiting, commits or pushes. The full goal remains unfinished.

### Checkpoint 582: bound whole append preparation and upload acknowledgement (2026-09-24)

Append requests now have a shared 300-second policy enforced independently by
Canvas and worker. The Canvas deadline starts before dispatch and is checked on
response receipt, after GPU upload, before mapping commit and before publishing
success. Its timer terminates the worker and discards incomplete state. Worker
timeout aborts the source/compute/ACK signal, with monotonic boundary checks after
preparation and before/after epoch admission and source-mapping publication.
The existing 30-second upload-ACK limit remains in force within the overall limit.

Success, failure, cancellation and component teardown clear their timers through
the existing ownership paths. UI and export budget metadata state that the limit
covers append preparation/upload acknowledgement; subsequent full-layout epoch
reconciliation is separate. JavaScript timers cannot preempt synchronous work,
so boundary checks reject late publication rather than promise hard real-time
interruption. Runtime deadline/cancellation behavior remains unverified. Source
and whitespace checks only; no tests, builds, CI waiting, commits or pushes.

### Checkpoint 583: reuse the verified compact index across worker append requests (2026-09-24)

Append-enabled workers now share an opaque, single-entry source cache between
initial loading and later append preparation. The complete cloned manifest keys
the entry, which retains only the checksum-bound compact index buffer and its
content-bound checksum resolver. A cache hit bypasses both descriptor/index
fetches; source-row checks, metadata/binary hashes and exact filters still run.
Callers cannot access or transfer the cached buffer. Concurrent cache use and
index sizes above its admitted capacity are rejected.

The existing fixed index-read and checksum reserves remain charged throughout
the worker lifetime. Retention is skipped if the resolver's deterministic weight
plus manifest key exceeds the 8 MiB checksum headroom. This estimate is not total
heap/RSS proof. Cancellation/failure clears the entry; a generation guard prevents
an in-flight fetch from repopulating an explicitly cleared cache. Different
manifest identities evict the prior entry before fetching, rather than retaining
multiple releases. Worker teardown releases ownership.

This supersedes the prior always-refetch-index behavior for cache-eligible append
calls only. Per-shard source caching, automatic incremental following and measured
network/memory/frame capacity remain outstanding. No tests, builds, runtime or
benchmark runs, CI waiting, commits or pushes. Source/whitespace checks only.

### Checkpoint 584: bound binary-shard reuse and clear cache on stream failure (2026-09-24)

The opaque worker source cache can now retain at most one checksum-verified binary
shard in addition to the compact index and resolver. Its constructor caps binary
capacity at one maximum source shard; the append planner separately reserves
chunkSize*64 bytes. A hit requires the live cache generation/entry plus identical
path, bound checksum and byte length. Source element validation, metadata reads
and current filter matching still run. Cached buffers are never transferred or
exposed outside the stream module, and preflight/compute consumers only read them.

The stream function itself now clears its cache and advances the generation on
any failure, including non-abort errors, rather than depending on worker cleanup.
Its busy lease is released in a nested finally after admitted prefetches settle.
Clear/generation guards prevent in-flight requests from repopulating or reusing
an invalidated entry. This is single-entry retention, not an unbounded cache or
a guarantee that every repeated shard will hit. Metadata remains uncached.

Peak memory, cancellation timing and network savings remain unmeasured. No tests,
builds, runtime/benchmark runs, CI waiting, commits or pushes; only source and
whitespace checks. All remaining scientific/capacity requirements stay active.

### Checkpoint 585: export bounded application reads and cache-hit accounting (2026-09-24)

Stream results now carry per-kind attempts, completed/failed reads and completed
artifact body bytes for checksum descriptors, compact indices, metadata and
binary shards, plus worker index/binary cache hits and reused byte counts. The
result references counters frozen only after admitted prefetches settle in the
finalizer, including failed/aborted speculative reads when capacity ends a load.
Initial Canvas acceptance and append receipt binding check bounded nonnegative
counts, terminal accounting and index fetch-versus-reuse consistency.

Initial exports retain read evidence; append results already flow into ordered
addition/latest-attempt exports. The UI exposes latest-attempt cache hits with
an explicit application-counter label. Export limitations exclude partial failed
body bytes, compression/transport overhead and browser HTTP-cache behavior.
Reused bytes are not reported as measured network savings, throughput or latency.

These are newly implemented runtime counters, not results from an executed run.
Real artifact/network and cancellation comparisons remain deferred. No tests,
builds, benchmarks, app runs, CI waiting, commits or pushes; source/whitespace
checks only. The full scientific and scale goal remains unfinished.

### Checkpoint 586: reject cancellation during prefetch finalization (2026-09-24)

Source inspection identified a cancellation window after the stream loop had
chosen a successful result but before admitted prefetches finished draining.
The finalizer now rechecks the caller signal after terminal read accounting is
frozen and the cache lease is released. A cancellation during that interval
rejects the pending result instead of publishing stale success. Aborted cache
cleanup also advances its generation and drops retained sources.

This covers the stream promise boundary; it is not execution evidence for
worker delivery, GPU teardown or cancellation latency. The drain remains
bounded by existing artifact read deadlines. No tests, builds, benchmarks,
runtime checks, CI waiting, commits or pushes were performed. The complete
scientific and performance objective remains active.

### Checkpoint 587: enforce visual coordinate admission on every upload path (2026-09-24)

Source review confirms initial completion checks cancellation after transfer
drain and append completion checks cancellation/deadline before publication.
The review also identified inconsistent Float32 spatial-copy admission: append
rejected overflow, while initial and temporal uploads did not. A shared worker
installer now checks row alignment, admitted storage bounds and finite converted
coordinates before invalidating the spatial index or publishing the tile.
All three upload paths use it. Scientific transport remains Float64; invalid
visual copies fail the snapshot rather than entering spatial selection.

This is source-level consistency, not executed cancellation, accuracy or
capacity evidence. No tests, builds, runtime checks, CI waiting, commits or
pushes were performed. All remaining requirements stay active.

### Checkpoint 588: refresh moving point-cloud culling bounds (2026-09-24)

Superseded by checkpoint 589: caller inspection showed both point layers disable
frustum culling. The claimed current display benefit below was unsupported;
the unnecessary bound computation was removed rather than retained.

The main-scene catalog geometry subtracts its reference origin before Float32
storage; current-state geometry reads already-relative scalar coordinates.
Inspection found that reused point geometries updated positions without
refreshing their bounding sphere. The shared writer now accumulates squared
distance during its existing live-row write loop and updates an origin-centered
conservative sphere, with outward rounding. It excludes spare capacity and
resets the radius to zero for an empty selection. No second full-buffer pass
or per-frame sphere allocation is introduced after the first update.

An origin-centered bound may be looser than a fitted sphere; the purpose is to
avoid stale culling after epoch/reference/selection changes, not to claim
optimal culling or measured speed. Browser rendering and frame cost remain
unverified. No tests, builds, benchmarks, CI waiting, commits or pushes occurred.

### Checkpoint 589: correct culling diagnosis and bound point attribute uploads (2026-09-24)

The actual callers explicitly disable frustum culling for catalog/current-state
point layers; trajectory lines already recompute their sphere on each update.
Checkpoint 588 therefore did not fix a current stale-culling bug. Its extra
point-loop arithmetic and sphere allocation have been removed.

Local Three.js WebGLAttributes source shows that absent update ranges upload
the entire retained attribute array. The point writer now marks only the live
position/color prefix, excluding geometric capacity headroom on subsequent
uploads. Position-only updates preserve unconsumed color ranges. Repeated
rewrites replace the position range because the full live prefix is rewritten;
hidden tails are outside drawRange and rewritten before reuse. Initial GPU
allocation still uploads the complete capacity. This is an upload-bound change,
not measured FPS or bandwidth evidence. No tests, builds, browser runs, CI
waiting, commits or pushes occurred.

### Checkpoint 590: separate catalog draw count from coordinate uploads (2026-09-24)

TrajectoryCanvas3D previously rewrote every catalog coordinate when only its
draw count changed, followed by a second effect updating the draw range. The
coordinate effect now depends only on source identity and reference origin.
The following draw-range effect also observes those identities and origin
components, so same-length source replacements and origin changes reapply the
selected count after the geometry writer resets it. Count-only changes update
visibility/draw range and invalidate the frame without rewriting attributes.

This removes a source-visible redundant path; runtime cost remains unmeasured.
No tests, builds, runtime checks, CI waiting, commits or pushes occurred. The
user clarified that further changes should stop when no justified improvement
is found. This checkpoint does not establish completion of the broader goal.

### Checkpoint 591: reconcile stale catalog verification fixtures without execution (2026-09-24)

Updated the synthetic catalog-streaming fixture to supply independent source
metadata and content-bound checksum descriptors. Rehashing does not repair
metadata inconsistencies; positive priority changes explicitly update source
flags, while corruption cases retain their mismatches. Full-load assertions now
include exact application-read byte/count evidence and source-selection masks.
Old assumptions about metadata-free loading, locator-only name queries, four
total live binary inputs and the previous full-inventory budget were revised
against current source paths. Timeout recovery no longer leaves cooperative
reloads waiting on unadvanced fake timers. No production validation was loosened.

Only files were edited and source/diff consistency inspected. No tests, builds,
numerical execution, CI waiting, commits or pushes occurred. These revisions are
pending execution and do not establish scientific or performance acceptance.

### Checkpoint 592: bind inventory snapshots to recursive SPK source lineage (2026-09-25)

Inventory snapshots now preserve the resolver-selected root SPK segment,
verified kernel checksum and recursive center-chain digest. The Go runtime and
Node audit generator use the same versioned little-endian binary digest format;
the Go index reads only the compact root descriptor instead of decoding each
row's full segment list. Exact snapshot tiles reject missing lineage and bind
the root checksum to the active catalog. Focused Go and Node checks passed,
including deterministic inventory generation and coverage audit. The full
suite and external inventory refresh remain unrun.

### Checkpoint 593: admit bounded native state-tile prefetch (2026-09-25)

Android and iOS state clients now fetch up to two adjacent tiles concurrently,
matching the Web client's cap and the backend's two encoder slots. Both native
clients admit the combined per-tile working allowance before launching a pair,
fall back to serial reads when the resident-state budget cannot hold both, and
validate/append results in plan order. Android cancels the peer request when a
tile in the pair fails; Swift task-group cancellation propagates to its HTTP
transfer. Protocol, provenance and exact/missing rules are unchanged. This is
a bounded-source improvement, not measured device throughput or a claim about
the 12/16/32 GB hardware targets. Only source and diff consistency were checked;
no tests, builds, benchmarks, device runs, CI waits, commits or pushes occurred.

### Checkpoint 594: align state-tile provenance and window rejection (2026-09-25)

Static cross-client review found whitespace-only provenance acceptance in
Swift, JSON null coercion in Android, noncanonical/nonzero alignment padding
acceptance in Android and Web, and reversed present windows accepted on missing
rows by Swift and Web. The clients now reject those malformed representations;
Android still permits an omitted optional source-chain digest, as the wire
schema specifies. The Go writer rejects malformed present windows and exact
states outside them using the same 0.0001-second ET allowance. Go's header
parser and all decoders require minimal zero alignment padding. The wire
contract records these constraints. Source and diff checks only; no tests,
builds, numerical runs, device checks, CI waits, commits or pushes occurred.

### Checkpoint 595: compare audit snapshots in ET at the wire tolerance (2026-09-25)

Static tracing found that backend snapshot selection compared TDB Julian dates
with a strict 1e-9-day threshold, while the state-tile writer and clients check
the decoded epoch in ET with a 0.0001-second allowance. Julian-date quantization
near J2000 can add roughly 20 microseconds on a round trip, so the two checks
could disagree near their boundaries. Snapshot eligibility now converts the
requested JD using the same JD-to-ET expression as state evaluation and applies
the shared Go wire allowance. Removed unused epoch-window helpers from the path.
No numerical execution, tests, builds, CI, commits or pushes occurred.

### Checkpoint 596: correct the universal-variable derivative comment (2026-09-25)

Static comparison of the Go and Web SBDB perifocal covariance transforms found
matching elapsed-periapsis-time derivative signs and matching coordinate
scales. The Web universal-variable derivative comment incorrectly said
`dF/du=radius/q`; `radius` there is already the dimensionless derivative
`1+e*u^2*C`. Corrected the comment only. No calculations, tests, builds, CI,
commits or pushes occurred.

### Checkpoint 597: refresh the local IERS rapid EOP snapshot (2026-09-25)

The existing cache snapshot was retrieved on 2026-09-22. Re-fetched the same
official `finals2000A.all` source through the repository's immutable ingestion
script, adding a 3,768,836-byte artifact with SHA-256
`cc80680ec05c91b65e7d02c6068fe0d44dd0998dc880551975092d2d14aa8e18`; the old
artifact and manifest remain intact. A read-only fixed-column scan found 19,997
rows with I/P Bulletin flags from MJD 41684 through 61680 and no missing-day
gaps among those rows. The new manifest remains in the development cache; no
runtime flag, deployment, parser execution, test, build or commit was changed.

### Checkpoint 598: bound schematic spacecraft current markers (2026-09-25)

Static UI tracing found that spacecraft teaching markers remained visible after
their final authored milestone and clamped to the final schematic coordinate.
Current markers are now limited to each finite authored interval; the
historical milestone trail remains available, with an explicit bilingual view
notice when the selected date falls outside those intervals. No scientific SPK
status or extrapolation is implied. Source and diff inspection only; no tests,
builds, browser checks, CI waits, commits or pushes occurred.

### Checkpoint 599: enforce event scan step after floating-point placement (2026-09-25)

Static cross-language review found that the Web event scanner chose
`ceil(duration / maxStep)` intervals but did not check the actual rounded sample
times. The Go path already adds an interval when any placed scan step exceeds
the configured maximum. Web now uses the same endpoint-placement formula,
checks each realized gap and adjusts within the caller's evaluation budget;
nonrepresentable scan times fail explicitly. Source comparison and diff checks
only; no tests, builds, numerical runs, CI waits, commits or pushes occurred.

### Checkpoint 600: bind scan-grid preflights and receipts to actual endpoints (2026-09-25)

The same floating-point step-boundary gap also affected occultation contacts,
ensemble-event preflights and result validators. These paths now share the
endpoint-aware bounded interval counter, apply their own evaluation budgets,
and require the reported/reconstructed maximum interval to remain within the
requested step. This keeps each producer, preflight and receipt on the same
grid without widening search budgets. Source/diff checks only; no tests,
builds, numerical runs, CI waits, commits or pushes occurred.

### Checkpoint 601: expose local integration diagnostics without error-bound claims (2026-09-25)

Distance-event results previously retained accepted/rejected counts and fixed
tolerances but discarded the adaptive integrator's accepted local error ratios
and step range. Web and Go draw receipts now aggregate the maximum accepted
DP54 ratio and smallest/largest accepted step over completed segments; the Web
receipt checks finite ranges and agreement with accepted-step counts. The
sample inspector labels these as local solver diagnostics, and the source
contract explicitly keeps accumulated state/event-time error unbounded. No
tests, builds, numerical runs, CI waits, commits or pushes occurred.

### Checkpoint 602: expose occultation search and light-time evidence (2026-09-25)

Static receipt/UI tracing found that the CN receipt checked convergence metrics
and null physical timing uncertainty but did not bind its solver model label;
the Web result also hid realized scan spacing and CN diagnostics. Receipt
validation now binds `converged-newtonian-reception`; the result panel displays
realized/requested scan spacing, root-localization tolerance, observed
iterations/residual/light-time against limits, and their physical-accuracy
boundaries. No tests, builds, numerical runs, CI waits, commits or pushes
occurred.

### Checkpoint 603: fix backend event refinement checkpoint parity (2026-09-25)

Cross-client static review found that Web event refinements integrate from fixed
scan/reference checkpoints, while Go cached bisection states and reused them for
later root queries. Backend event evaluation now caches only chronological scan
endpoints, selects the nearest fixed checkpoint with an earlier-epoch tie rule,
and uses binary lookup; root-query order no longer changes later trajectory
states. Android and iOS receipt decoders now bind the resulting v3 method instead
of rejecting the backend's event method. Updated the scientific contract. No
tests, builds, numerical runs, CI waits, commits or pushes occurred.

### Checkpoint 604: correct the 1PN source citation and model distinction (2026-09-25)

Source-level citation review found that the cited A&A DOI `202554676` is a
GRAVITY Collaboration paper on a fifth force at the Galactic Center, not the
solar 1PN acceleration. Replaced that and the inaccessible CERN link in Web/Go
model evidence with JPL's DSN formulation. The documentation now distinguishes
the adopted Sun-relative one-body term from JPL's full barycentric n-body
relativistic equations; it makes no equivalence claim. Web/Go force and Jacobian
formulas remain source-identical. No tests, builds, numerical runs, CI waits,
commits or pushes occurred.

### Checkpoint 605: audit source-fitted comet nongravitational axes (2026-09-25)

A read-only full-precision SBDB API query for 67P with `cov=mat` returned a
10-axis solution: the six osculating elements followed by estimated A1, A2, A3
and DT. The API payload supplies each parameter's units and physical
description; the official covariance contract states that labels append
estimated dynamical model parameters. A separate read-only query confirmed the
same parameter ordering in the returned matrix labels. SBDB distinguishes
`EST` from `CON` in `model_pars`, but only `EST` parameters belong in covariance
labels. The TypeScript and Go covariance parsers had accepted a `CON` parameter
as an extra axis; both now reject that source-contract violation. A static scan
of checked-in SBDB covariance fixtures found extra axes only for Bennu's EST
RHO/AMRAT, with the Eros covariance remaining six-dimensional.

JPL Horizons documents A1/A2/A3 in au/day^2, DT in days, and a semi-empirical
water-ice sublimation law with R0, ALN, NM, NN and NK constants for its
cometary A-term model. These constants describe a particular adopted force law;
their presence in Horizons defaults does not establish that every imported
orbit used them. See the [SBDB API model/covariance contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
and [Horizons nongravitational model inputs](https://ssd.jpl.nasa.gov/horizons/manual.html).
JPL labels DT as a lag/delay in days; the asymmetric Marsden form evaluates its
radial law at the shifted distance `r(t-DT)`, shifting peak activity by DT
relative to perihelion. This implies a past-distance dependency for positive DT
and a future-distance dependency for negative DT. That sign interpretation is
an inference from the published time-shift form, not a separate SBDB guarantee.

Current import paths retain the raw source model parameters, but the dynamics
laboratory does not integrate this comet outgassing law, and source-offset
ensembles reject unmatched extra axes. The physically safe next implementation
must bind the chosen distance law and signed time-shift treatment to explicit
source/model evidence, propagate every fitted axis and cross-correlation, and validate the
radial/transverse/normal force and its variational derivatives against an
independent trajectory. No default A1/A2 values were inferred, no code changed,
and no tests, builds, simulations, CI waits, commits or pushes occurred.

### Checkpoint 606: close native covariance-axis contract gap (2026-09-25)

Continued the source-only audit across all readers of extended SBDB covariance.
The TypeScript and Go parsers already required `EST` for additional matrix axes,
but the Android and iOS receipt binders still admitted `CON`. Both native
validators now require an estimated model parameter, while retaining and binding
the untouched original bytes. The independent high-precision Python coordinate
reference now applies the same gate before constructing any extra-axis case.
Static fixture inspection remains unchanged: Bennu's RHO/AMRAT extras are EST;
Eros has only its six orbital axes.

This matches JPL's [SBDB contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html):
covariance labels append estimated dynamical model parameters, while `CON`
describes a fixed value with fixed uncertainty considered in estimating the
other parameters. [Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
describes comet `DT` as a lag/delay in days; the published asymmetric Marsden
form uses `r'(t)=r(t-DT)` ([A&A 630 A4, 2019](https://www.aanda.org/articles/aa/pdf/2019/10/aa35229-19.pdf)).
Thus a positive shift reads past heliocentric distance and a negative shift reads
future distance; that sign interpretation follows from the equation. The current
force callback is state-local and has no trajectory-history interface, so it
cannot represent this term by adding DT as an ordinary force coefficient. A
source-fit force implementation remains open and must define how the shifted
distance is evaluated, preserve the signed fitted parameter and all covariance
cross-terms, and validate force plus variational derivatives independently.

No tests, builds, numerical simulations, CI waits, commits or pushes were run.

### Checkpoint 607: trace SBDB force parameters without implicit adoption (2026-09-25)

Static source-to-engine tracing found no automatic substitution or silent axis
loss for the inspected SBDB model parameters. The Web conic loader retains the
raw `model_pars`; covariance import keeps EST labels, values, units and all
matrix cross-terms. Coordinate conversion carries extra fitted parameters as
identity axes, while Web/Go/native propagation and event paths reject an
additional axis when no matching force derivative exists. Original source bytes
remain available in the source receipt.

The pinned [Bennu fixture](../tests/fixtures/sbdb-bennu-covariance.json) has EST
`AMRAT=2.635943157e-6 m^2/kg` and `RHO=1191.534909615045 kg/m^3`; both remain
unsupported dynamical axes, not inputs silently folded into the current force
model. The pinned [Borisov fixture](../tests/fixtures/sbdb-borisov-20260923/response.json)
has EST A1/A2/A3 in au/day^2 and `DT=-65.13009704907404 d`; its source also
retains SET values `ALN=1`, `NM=2`, `NN=0`, `NK=0`, and `R0=1 au`. The signed DT
requires the already documented shifted-distance treatment, and a generic
Horizons sublimation law cannot replace the source's retained model values.

The optional radial SRP implementation is a separate manually adopted model:
pressure at 1 au, area, mass, reflectivity and a source declaration are required
with no physical defaults. It does not infer AMRAT, implement directional
cometary A1/A2/A3 forces, use RHO, or model shadowing. These boundaries match
the [SBDB model-parameter contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
and the documented [Horizons small-body parameters](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
Source tracing only; no tests, builds or numerical propagation were run.

### Checkpoint 608: align cross-runtime solar force contracts (2026-09-25)

Static equation comparison found TypeScript and Go use the same Sun-relative
Schwarzschild-monopole 1PN acceleration, its position/velocity Jacobians, the
same `1e-4` weak-field/slow-motion guard, and the same prescribed barycentric
Sun state. Both explicitly identify this as an added one-body term rather than
full barycentric EIH dynamics. Their SRP paths also match: explicit SI pressure,
area, mass and reflectivity become km/s^2; the force is outward, radial,
unshadowed and inverse-square, with the same analytic position Jacobian. Sun
ephemerides and force parameters are fixed, not included in the transition
uncertainty. This is source parity only, not new independent physical validation.

The audit found one protocol mismatch: TypeScript limited the SRP provenance
string by UTF-16 code-unit count while Go, Android and iOS enforced 8192 UTF-8
bytes. TypeScript now applies the same UTF-8 byte budget, with a code-unit-count
precheck to bound temporary encoding allocation; the dynamics documentation
states the byte contract. No numerical behavior changed. Static diff/format
inspection only; no tests, builds, propagation, CI waits, commits or pushes.

### Checkpoint 609: verify SRP source declaration survives results and exports (2026-09-25)

Static receipt tracing found the same submitted SRP parameter object, including
the exact `source` declaration, bound into the Web result. Android and iOS
compare the returned SRP fields and source against their request. Go returns the
adopted parameter struct with that source and its unauthenticated-source
limitation; all three UI paths show the source alongside an explicit warning
that the declaration is not independently authenticated. Web JSON export retains
the checked result and original input, while Android/iOS export the complete raw
backend response bytes. No code change was justified by this pass. No tests,
builds, force evaluations, CI waits, commits or pushes occurred.

### Checkpoint 610: verify distance-event force and export boundary (2026-09-25)

The current seeded covariance distance-event API does not accept SRP: its Go
request schema has no `solarRadiationPressure` field and rejects unknown fields;
the Web worker protocol also forbids manual force adoption for covariance and
ensemble requests. It adopts restricted DE440, with optional solar 1PN only.
Consequently its force receipt records `solarRadiationPressure: null` and the
DE440 limitations say no non-gravitational forces were applied; the event UI
renders that force evidence rather than implying source-fit-force coverage.
The Web JSON export retains the result/source receipt, and Android/iOS export the
complete response bytes, including the force receipt and limitations. No SRP
declaration exists in this event request to be lost. No tests, builds, event
searches, CI waits, commits or pushes occurred.

### Checkpoint 611: compare browser and Go adaptive-integrator contracts (2026-09-25)

Static source comparison found matching Dormand–Prince 5(4) stage and embedded
error coefficients, component-maximum scaling, fifth-root step controller and
0.1–5 growth bounds. Both implementations use compensated elapsed-time and
state updates, retain FSAL only after accepted steps, and report the same
accepted/rejected and local-error diagnostics. Their scheduling differs by
runtime: the browser yields between attempts on a 32-attempt or 8 ms threshold;
Go checks request cancellation at integrator/derivative boundaries. This pass
supports arithmetic-contract parity only; source reading cannot establish
convergence, physical orbit accuracy or comparative throughput. The code already
states that tolerances are local numerical controls, not physical error bounds,
and claims no dense output, event detection or symplectic behavior, so no edit was
justified. No tests, builds, force evaluations, CI waits, commits or pushes
occurred.

### Checkpoint 612: clarify numerical covariance sampling eligibility (2026-09-25)

The covariance parser accepts a minimum normalized-correlation eigenvalue down
to `-1e-12` as positive semidefinite within roundoff, but sets
`positiveDefinite=true` only above `+1e-12`; the Gaussian sampler additionally
requires every computed Cholesky pivot to be positive. The intermediate band can
therefore pass source audit but is intentionally ineligible for sampling, so the
flag is a conservative numerical gate, not a proof of mathematical singularity
or definiteness. The covariance reference now records both thresholds and that
meaning. No runtime/API behavior changed. No tests, builds, force evaluations,
CI waits, commits or pushes occurred.

### Checkpoint 613: audit variational covariance pushforward units (2026-09-25)

The static propagation chain is consistent: factor the audited source covariance,
map it through the element-to-state Jacobian and ecliptic/unit transform, evolve
the row-major state transition matrix with the analytic Newtonian plus adopted
1PN/SRP state Jacobians, then form the final covariance from the pushed-forward
root. The deterministic prescribed-Sun translation changes the nominal state but
adds no covariance. The review also made the STM tolerance convention explicit:
its four 3x3 blocks carry dimensionless, seconds, seconds^-1 and dimensionless
units under km/km/s coordinates, despite sharing numeric absolute tolerance
1e-12 (1e-13 in the optional refinement). Documentation now warns that this is a
component policy, not a uniform dimensionless STM error target. No formula or
runtime behavior changed. No tests, builds, force evaluations, CI waits, commits
or pushes occurred.

### Checkpoint 614: align native tile-loading documentation with admission (2026-09-25)

The Android and iOS implementations do not always read state tiles serially: both
preserve ordinal output order and fetch two adjacent tiles concurrently when the
estimated combined working set fits the remaining 1536 MiB state budget, then
fall back to one tile when it does not. The existing streaming guide incorrectly
described all native tile reads as sequential; it now records the conditional
two-tile path and its transient allowance. This corrects performance documentation
without claiming an RSS cap or measured device throughput. No code changed. No
tests, builds, benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 615: release Android tile worker threads on close (2026-09-25)

MainActivity closes each single-use Android `StateTileService` in a `finally`
block. Its fixed two-thread executor is lazy, so ordinary single-tile runs do not
start workers, but a paired fetch can start both; the previous `close()` cancelled
HTTP only and left those daemon workers waiting after a successful load. `close()`
now delegates to the existing idempotent `cancel()` path, disconnecting active
requests and shutting down the tile executor. No tests, builds, benchmarks, CI
waits, commits or pushes occurred.

### Checkpoint 616: verify iOS tile-transfer cancellation ownership (2026-09-25)

The iOS state service has no persistent tile worker pool analogous to Android's:
it creates a bounded two-child task group only for a memory-admitted adjacent
tile pair. Each HTTP transfer owns an ephemeral `URLSession`; completion and task
cancellation both invalidate/cancel it and retire the checked continuation.
Cache reads close file handles with `defer`, and canceled observation tasks remain
the drain barrier before a replacement starts. This source audit found no matching
resource leak to fix. Runtime cancellation latency and memory behavior remain
unmeasured; no tests, builds, benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 617: state the Gaia observer length-scale assumption (2026-09-25)

Static comparison of the Gaia observer adapter and GoFA `Pmpx` confirmed that
the catalog rates/parallax are explicitly converted to TDB-compatible inputs,
while the source-backed station position is passed as native SPK kilometres
converted to AU. The code does not apply a separate TCB/TDB spatial rescaling to
that observer vector. Documented the required compatibility assumption in the
Gaia model description and API limitations so numerical parity is not mistaken
for physical validation of the SPK length basis. No tests, builds, benchmarks,
CI waits, commits or pushes occurred.

### Checkpoint 618: batch GL error checks during retained epoch uploads (2026-09-25)

The retained-epoch uploader replaces positions in 4,096-row slices under a
3-millisecond frame budget. A synchronous `gl.getError()` after every slice
could run several times during one 16,384-row worker tile. It now checks once
after each bounded frame slice, before yielding or returning the transfer buffer
to the worker. GL failures still take the failure path before the epoch can
become coherent or publish; the final renderer check remains. This reduces
source-level query count, but no runtime speedup is claimed. No tests, builds,
benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 619: retain the active architecture issue until acceptance (2026-09-25)

The remote repository has no open pull requests and one open issue, #109,
covering the same streaming, exact-state provenance, multi-platform rendering,
and hardware/science acceptance still required by this goal. Its owner-authored
reopen comment explicitly cites real-device frame/memory and reference-oracle
gaps, so it remains aligned with the current goal and should stay open. Static
route inspection found the current manifest/plan/tile/window v1 transports and
no legacy JSON current-state route. No issue or PR state was changed; no tests,
builds, benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 620: prepare and hash the Voyager source pack locally (2026-09-25)

Executed the bounded preparation command for Voyager 1 and 2 over TDB
`[0, 3155716800]`, writing only to a new `.cache/spacecraft-packs/` directory.
Archived original SPKs and source-note bytes, reviewed the NAIF caution and
1992 tracking-fit cutoffs, and independently read back all four crops to match
their receipt byte counts and SHA-256 digests. Type 1 spacecraft roots and
dependency-only Type 2 DE440 center crops have endpoint/interior descriptor
coverage without gaps. The receipt remains
`pending-source-and-numerical-acceptance`; coverage is structural only, with
no state calculation, oracle comparison, scientific admission, or runtime and
release integration. The cache pack remains local and untracked. No tests,
builds, benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 621: reuse DE440 center-chain scratch on the serial force path (2026-09-25)

Static inspection found `stateAt` constructing a recursive center resolver and
a visiting map for every requested force body, while the enclosing dynamics
object is already documented as single-run and not concurrency-safe. The
resolver and bounded visiting/cache maps now live for the run; visited entries
are cleared per requested body and cached positions are cleared only when the
split ephemeris epoch changes. Existing cycle, depth, cache-size, epoch and
cancellation guards remain. This is an allocation-reduction change inferred
from source structure only; no runtime profile or speedup is claimed. No tests,
builds, benchmarks, CI waits, commits or pushes occurred.

### Checkpoint 622: refresh New Horizons OD164 provenance from the full source (2026-09-25)

Fetched the complete current OD164 merged SPK, PDS label and `nh_v10.tm` into a
new local-only preparation directory. Recorded each source hash and archive
modification metadata; the SPK has no ETag and the archive remains mutable.
Full-file comments confirm the 2025-04-18 tracking cutoff, an RTG acceleration,
direction-specific SRP scale factors, and that spacecraft, planetary and
2014 MU69 small-body ephemerides are one source set. The prepared crop keeps
only the spacecraft root and its Sun-center dependency, so it is not admission
of that complete set or force model. Descriptor coverage is gap-free for the
requested window, but no states, reference residuals, tests, or runtime/release
integration were performed. The prediction beyond the tracking cutoff has no
new accuracy guarantee.

### Checkpoint 623: block partial New Horizons OD164 manifest admission (2026-09-25)

The spacecraft-pack integrator's two-file schema represents one spacecraft
root and its center dependencies, but not the coupled planetary and small-body
OD164 solution set stated in the source comments. It now fails closed for New
Horizons until that source set has an explicit manifest representation and
acceptance path. Voyager sources remain unaffected. This guard has source and
diff inspection only; no tests, builds, manifest integration, or release work
occurred.

### Checkpoint 624: represent the full New Horizons OD164 pool explicitly (2026-09-25)

Full SPK comments enumerate the spacecraft, DE433 planetary and 2014 MU69
small-body members. The preparation contract now pins all 16 companion target
IDs; it crops their 145 Type 2 segments into one dependency-only file and binds
the Type 1 -98 root to that exact pool. Descriptor/center-chain checks cover all
17 requested members with no gaps, and independent readback matched all five
source/label/note/crop byte counts and hashes. The integrator validates exact
membership and pool coverage, replacing the temporary blanket New Horizons
block without promoting the dependency file to global roots. No state values,
CSPICE residuals, tests, builds, runtime manifest integration, or release data
were produced; numerical acceptance remains required.

### Checkpoint 625: enforce spacecraft preparation implementation hashes (2026-09-25)

The prepared receipt already recorded hashes for its generation, crop, coverage,
SPK-reader and identity code, but the offline integrator did not compare those
hashes with the current repository. It now requires the exact eight-path
inventory and verifies each bounded local file before processing any kernels.
The coupled New Horizons pack was regenerated under this inventory; all eight
implementation hashes and all five source-data hashes match independent
readback. No manifest integration, tests, builds, benchmarks or release work
occurred.

### Checkpoint 626: bind cropped source metadata and integrator identity (2026-09-25)

The offline integrator now compares every crop's complete source identity
(URL, byte count, digest, fetch metadata, notes digest and optional label) with
the original source receipt. Integration evidence also records the current
integrator file digest. This closes a provenance gap where byte and notes
digests matched while ancillary source metadata could differ. Static code
inspection only; no manifest writes, tests, builds, benchmarks or release work.

### Checkpoint 627: trace analysis source pools and audit SPK reader structure (2026-09-25)

Traced browser event and mission requests from body selection through exact
dependency closure, worker loading, interval filtering, analysis evidence and
result binding. Event detail refinement reuses the result's frozen file list.
The backend independently selects a root, preserves its declared dependency
order, fails closed on incomplete pools, and keys epoch-local resolution by that
pool. No source-pool bypass or identity mismatch was found in these paths.

Compared the browser DAF/SPK structural reader against the NAIF Required
Reading: descriptor and summary layout, segment-order precedence, Chebyshev
Types 2/3, the 12-word Type 17 record, and Type 1/21 difference-line directory
structure. The Type 17 eccentricity limit matches NAIF. This is a format and
source-path audit only; it does not validate evaluated coefficients against
CSPICE, certify prediction accuracy, or establish a runtime performance gain.
Numerical acceptance remains for the deferred verification stage. No tests,
builds, simulations, benchmarks, CI waits, commits, pushes, or release
integration ran.

### Checkpoint 628: guard Type 17 results and inventory independent oracles (2026-09-25)

Type 17 evaluation now rejects a state if any returned position or velocity
component is nonfinite, including overflow from finite inputs. Record words are
read directly instead of allocating a temporary typed array and a spread array
on each evaluation. The equations and tolerances were not changed; the
allocation reduction is inferred from source, with no measured speedup.

Static inspection also confirmed checked-in independent CSPICE oracle
definitions for Type 1, Type 17 and Type 21, including synthetic boundaries and
source-backed cases. The DE440 dynamics reference also compares pinned
real-kernel states against CSPICE through the consumer that calls `SpkKernel`,
but does not isolate individual Type 2/3 coefficient evaluations. No Type 3
CSPICE oracle fixture was located; its direct synthetic checks are analytic.
These definitions were not executed in this audit, and isolated Type 2/3
oracle coverage remains an audit item. No tests, builds, simulations,
benchmarks, CI waits, commits, pushes, or release integration ran.

### Checkpoint 629: audit variational forces and covariance pushforward (2026-09-25)

Cross-checked the Dormand–Prince 5(4) stages/error coefficients, compensated
state/time advancement, and the explicit maximum-component error norm against
the implementation contract. Reviewed the restricted Newtonian position
gradient, solar-monopole 1PN position/velocity Jacobians, radial unshadowed SRP
gradient and SI-to-km units, plus the 6x6 covariance frame/unit transform and
square-root pushforward. Their formulas, frame labels and stated limitations
are internally consistent on source inspection; no additional code change was
justified. Numerical accuracy, convergence and independent force-model
acceptance remain unverified. No tests, builds, simulations, benchmarks, CI
waits, commits, pushes, or release integration ran.

### Checkpoint 630: audit bounded dynamics event search and timing subsets (2026-09-25)

Traced the event scan grid and confirmed its fixed endpoints use the same time
construction as the shared trajectory scanner. Refinement integrates from the
nearest retained scan/reference checkpoint without feeding root-query order
back into that cache; one shared force-call budget covers all restarted DP54
segments. Ensemble draws preserve failed and unresolved identities, and timing
order statistics use only direction-classified first detections while excluding
earlier unclassified sampled zeros. No additional source change was justified.
Sampled scanning still cannot prove event completeness or calibrated event
probability, and integration/root tolerances are not global event-time bounds.
No tests, builds, simulations, benchmarks, CI waits, commits, pushes, or release
integration ran.

### Checkpoint 631: audit ground-observation time and frame chain (2026-09-25)

Traced the IERS Bulletin A parser, UTC-to-TAI/TT/UT1/TDB conversion, EOP
coverage/interpolation, WGS84 station construction and the pinned GoFA `Apco` /
`Apcs` chain. UT1-TAI is interpolated across leap seconds; polar motion and
available celestial-pole offsets feed the terrestrial-to-celestial transform;
the solar deflector and reception/emission states use the declared source
conventions. Refraction remains bounded to its stated altitude domain. The
reported observer vector is explicitly an astrometric model with no tectonic,
tide, terrain or full relativistic terrestrial/BCRS corrections. No source
inconsistency justified a code change. This was static inspection only; no
observations, simulations, tests, builds, benchmarks, CI waits, commits, pushes,
or release integration ran.

### Checkpoint 632: expose ground-source coverage and EOP input errors (2026-09-25)

Ground-observation responses already carried the IERS UTC interpolation bracket,
pole/UT1/celestial-pole values and published endpoint errors, plus SPK hashes and
valid JD TDB intervals. The visible panels showed retrieval time and generic
non-propagation notices but hid those source details. Added one shared disclosure
to observation, visibility and contact results for IERS provenance and per-file
SPK coverage/hash; the single-epoch result also displays its EOP bracket,
interpolated values, flags and published input-error fields. The client now
rejects malformed EOP error/bracket/flag metadata and SPK intervals that do not
cover the requested reception epoch. Published source errors are explicitly not
presented as propagated direction/event uncertainty. Static contract and diff
inspection only; no tests, builds, simulations, browser runs, benchmarks, CI
waits, commits, pushes, or release integration ran.

### Checkpoint 633: restore the current verification hold (2026-09-25)

Reconciled the goal ledger and pending-validation inventory with the latest
instruction: defer all tests, builds, simulations, benchmarks and CI waits until
implementation/content work is complete; do not commit or push during that
phase. Static source, data, contract and diff checks remain allowed. Final
verification and direct-main submission follow completion; production
deployment and releases remain paused. Historical test results stay scoped to
their recorded heads. Documentation/reference search and `git diff --check`
only; no tests or waits occurred.

### Checkpoint 634: include IERS outer coverage in ground results (2026-09-25)

The backend metadata endpoint exposed the IERS table's outer MJD UTC coverage,
but observation, visibility and contact result envelopes omitted it. All three
result APIs now include `earthOrientationCoverageMjdUtc`; client validation
checks the ordered finite range, and the single-epoch validator also binds its
interpolation bracket within that table range. Ground source details display
these first/last-record endpoints and explicitly retain the internal-gap caveat.
This is source-validity evidence, not proof of continuous coverage or prediction
accuracy. Static route/schema inspection and `git diff --check` only; no tests,
builds, simulations, benchmarks, CI waits, commits, pushes or release integration.

### Checkpoint 635: bind ground source panels to table and fixture coverage (2026-09-25)

The three front-end validators now require a strictly ordered two-endpoint IERS
coverage range; contact results also bind the top-level and result-level IERS
manifest identities. Existing captured-response fixtures were synchronized to
the pinned sources: the full table spans MJD UTC 41684–61673, while the Dallas
contact excerpt spans 60407–60410. Ground panels show this outer range alongside
the actual SPK file intervals and hashes. Fixture/source inspection and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
commits, pushes or release integration.

### Checkpoint 636: audit trajectory-event scan and root brackets (2026-09-25)

Reviewed finite-domain and budget admission, representable closed-grid times,
zero handling, sign-change direction, bisection bracket preservation, cooperative
cancellation and typed partial-progress failures. The implementation reports
sampled zeros without inventing a direction and retains explicit limits for
tangencies, plateaus, multiple crossings and accumulated integration error. No
additional source change was justified. This remains sampled root-localization
evidence, not event-completeness or physical-time accuracy. Source inspection
only; no tests, builds, simulations, benchmarks, CI waits, commits, pushes or
release integration ran.

### Checkpoint 637: avoid browser argument limits in Gaia chunk retention (2026-09-25)

The browser retained each verified Gaia chunk with `Array.push(...rows)`. The
allowed 30,000-row chunk limit is bounded, but spread still depends on each
browser engine's maximum call-argument count. The receiver now appends rows in
an ordinary loop, preserving arrival order without making a valid manifest
depend on that engine limit. This removes a source-level compatibility failure
mode; it is not a throughput or memory benchmark. Source inspection and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
commits, pushes or release integration ran.

### Checkpoint 638: coalesce concurrent identical state-plan builds (2026-09-25)

After forming the full canonical plan key, the backend now shares an in-flight
build among identical requests. Waiters retain independent cancellation; if the
builder is cancelled, live waiters can retry under their own contexts. The
bounded cache records hits, builds, coalesced requests and active builds, and
returns those counters with resident usage from one lock-protected snapshot.
This removes duplicate simultaneous preflight work and makes local diagnostics
internally consistent, but has no measured throughput or latency claim. Source
inspection, formatting and `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, commits, pushes or release integration ran.

### Checkpoint 639: keep synchronous GPU checks at catalog publication boundaries (2026-09-25)

The catalog renderer synchronously queried `getError()` on every retained draw,
including repeated camera and resize redraws that reuse already-validated
buffers. Those passive redraws now check context loss without synchronizing on
the driver. Synchronous GL error checks remain after source uploads before ACK,
at complete epoch-tile recycle, before publishing completed epochs/selections,
and after context restoration; intermediate epoch/restoration frame slices
check context loss and defer error inspection until their ownership or
publication boundary. Gaia now checks the combined `bufferSubData` and draw
result once before each worker ACK; passive zoom/resize redraws only check
context loss. This addresses the recorded main-thread driver-stall source and
a duplicate star-upload query without dropping upload/presentation checks, but
no current reprofile or speedup is claimed. Source inspection and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
commits, pushes or release integration ran.

### Checkpoint 640: account for Gaia picker memory and cache invalidation (2026-09-25)

Reviewed the Gaia screen-index allocation and reuse path. At 100,000 rows its
ordinal links and Float64 pixel positions occupy 2,000,000 bytes, plus a
viewport-sized cell-head array; retained Float32 display batches occupy another
1,200,000 bytes. The cache key binds viewport dimensions, zoom and uploaded
count, while a new catalog generation remounts the plot. Float32 index
coordinates could save about 800,000 bytes but would change exact pixel-distance
arithmetic; current profiling does not include first-click latency. No source
change was justified without that evidence. This is bounded array accounting,
not total heap or device-memory measurement. Source inspection and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
commits, pushes or release integration ran.

### Checkpoint 641: trace state-tile concurrency across clients and backend (2026-09-25)

Static tracing confirms browser plans load serially in 32,768-ID chunks, each
with at most two tile lanes; a shared two-permit pool covers interactive,
trajectory and bulk work. Android and iOS also cap tile prefetch at two under
their 1,536 MiB state budget, and the backend has two tile encoder slots. A
client-only concurrency increase would add waiting transfers without expanding
the backend encoder limit, so none was made without device-tier latency, peak
memory, queue-wait and render-tail evidence. No tests, builds, simulations,
benchmarks, CI waits, commits, pushes or release integration ran.

### Checkpoint 642: compensate short covariance matrix dot products (2026-09-25)

The browser and Go covariance pushforwards now use Neumaier-compensated
Float64 dot products for coordinate/root matrix products and final covariance
Gram entries. The browser receipt checker recomputes with the same helper;
Android/iOS bind the explicit `neumaier-compensated-f64-dot-v1` arithmetic
identifier. This targets avoidable cancellation error in short off-diagonal
sums and adds only bounded six-state work. It does not prove a material change
to real outputs or physical accuracy. Static source review and `git diff
--check` only; no tests, builds, simulations, benchmarks, compiles, CI waits,
commits, pushes or release integration ran.

### Checkpoint 643: compensate covariance factorization and Gaussian draws (2026-09-25)

Extended the same Neumaier Float64 dot order to normalized source-correlation
Cholesky residuals and factor reconstruction diagnostics, and versioned the
factorization method in its receipt. Gaussian draw mapping uses the same
compensated sums; its algorithm identifier advanced to v3, and the receipt
binding and fixed-seed values were updated. Go uses the matching compensated
factor residual and coordinate projections. This improves arithmetic
consistency in cancellation-prone short sums; it is not a condition estimate or
physical-accuracy claim. The focused covariance-sampling test passed (5/5)
after refreshing its versioned outputs. No build, simulation, benchmark, native
compile, CI wait, commit, push or release integration ran.

### Checkpoint 644: audit nonlinear ensemble moments and event-time ranks (2026-09-25)

Static review confirmed that endpoint means are anchored on a sampled state,
sample covariance uses a compensated second pass and divisor `n-1`, and any
failed draw makes the moment summary unavailable. Event-time summaries retain
failed, unresolved, not-detected and ambiguous-zero outcomes separately; their
nearest-rank localization bounds remain enclosing bounds when event brackets
overlap. The code labels these as finite selected-draw descriptions, not
population confidence, calibrated event probability, convergence or complete
event detection. No source change was warranted. No test or runtime check was
run for this path.

### Checkpoint 645: audit adaptive integration tolerances and control (2026-09-26)

Static comparison found matching browser/Go Dormand–Prince 5(4) tableaux,
component-max error scaling, bounded step adaptation, FSAL behavior, attempt
limits and base/refined tolerance vectors. Browser yielding and Go context
checks provide separate cancellation/cooperation boundaries. The embedded
accepted-step ratio is a local solver statistic, not a trajectory-error bound
or physical-accuracy measure. The focused browser integrator suite passed 9/9;
Go parity and DE440/reference accuracy remain unverified. No controller or
tolerance change was justified without independent trajectory error evidence.

### Checkpoint 646: audit Type 21 reference parsing and construction cost (2026-09-26)

Compared the Type 21 record search, 100-record directory and difference-line
recurrence in TypeScript and Go with the NAIF SPK specification. Both readers
select the first record whose final epoch is not earlier than the query and
produce the same CSPICE-reference states. TypeScript scans all Type 21 record
words at open; Go checks the selected record during evaluation. On a checksum-
pinned Windows x64 Node 24.14.1 / i9-14900KF run, seven batched samples gave
0.0581–0.0587 ms median to construct the 272–275-record, approximately 0.20 MiB
Horizons fixtures, and 0.1746 ms for the 702-record, 0.53 MiB synthetic
mixed-dimension fixture. The SPK unit checks passed 11/11, the Go synthetic
CSPICE fixture passed, and the three original Horizons references passed 3/3.
These small fixtures do not measure large-kernel startup, peak memory or mobile
hardware; no optimization or relaxed validation is justified from them. Large
production-kernel and device-tier measurements remain open.

### Checkpoint 647: verify Go DE440 integration against the independent oracle (2026-09-26)

Added a focused Go counterpart to the browser DE440 reference check. It verifies
the pinned SPK/GM bytes and fixture hashes, compares all 11 prescribed masses
and DE440 barycentric states at three reference epochs, then integrates the
42-component Eros state plus STM to -10, +10 and +30 days. Each output component
is checked against the independent CSPICE/DOP853 fixture with the same
normalized tolerance as the browser check; the final position also has a
1e-4 km norm bound. The targeted Go test passed. This establishes Go/runtime
parity with that frozen restricted-model oracle, not equivalence to the original
Eros SPK orbit fit, complete physical accuracy or broad trajectory coverage.
No package-wide or full test suite ran.

### Checkpoint 648: validate Go covariance propagation against direct DOP853 (2026-09-26)

The Go uncertainty API previously had no end-to-end covariance oracle check. A
focused test now verifies raw SBDB, DE440, GM and both independent-generator
hashes, then compares propagated nominal coordinates and all covariance entries
against the direct CSPICE/DOP853 covariance evolution for Newtonian and solar
1PN models at -10, 0 and +30 days. The Go comparison also binds the output
epoch and covariance symmetry. The input-coordinate and time-propagation
reference files were regenerated as new dated immutable fixtures; after
excluding their updated generator hashes, their JSON values exactly match the
previous fixtures. Browser checks passed 28/28 and the Go oracle test passed.
This verifies implementation agreement for the pinned conditional model; it is
not an orbit-fit equivalence, global numerical error bound or physical-accuracy
claim. No full local test suite ran.

### Checkpoint 649: extend bounded Gaia collection capacity and source fields (2026-09-27)

The Gaia chart's aggregate row admission is now 200,000, while every individual
manifest and TAP acquisition remains capped at 100,000 rows. The selected-source
byte budget (128 MiB), in-flight byte/row budgets (96 MiB/90,000), chunk count,
manifest count and serial GPU upload acknowledgement remain unchanged. At the
schema-v2 field width, the retained packed source columns are 56,850,000 bytes
at the aggregate ceiling; the CPU and GPU point buffers each require 2,400,000
bytes. These formula-derived known-array sizes exclude JS object/Set overhead,
active parsing, driver memory and compositor allocations. The Gaia React path
also stopped copying the complete prior batch-reference list on each upload;
at the 2,592-chunk ceiling this removes 3,357,936 cumulative old-reference
copies without changing source order or upload acknowledgement. New contract
cases were written but not run, and 200,000 remains an admission limit, not a
device-capacity claim.

Two ESA Gaia DR3 cones are now in independent TAP UWS execution: the existing
Orion 1-degree cone at ICRS RA 83.8221°, Dec -5.3911°, and a new 1-degree cone
centered at ICRS RA 130.1°, Dec 19.67°. Their query-bound receipts are under
`public/data/gaia/`; neither result has produced a manifest or chunks yet. The
same process handles remain active, so neither query was resubmitted. No tests,
builds, benchmarks, commits, pushes, deployment or release ran for this
checkpoint.

### Checkpoint 650: keep scale gains tied to bodies, not guessed ceilings (2026-09-27)

Audited the current compute-to-display path against the user's goal of
simultaneously calculating and showing more bodies. The desktop maximum-quality
catalog path already admits the full 1,567,193-row MPC inventory subject to its
chosen memory budget; spatial rendering uses projected-cell representatives
plus exact in-viewport count bins, while all-row rendering follows the active
adaptive draw budget. Gaia's 200,000-row aggregate source cap and 128 MiB source
budget remain distinct from the asteroid renderer. Its worker already overlaps
up to eight bounded reads and serializes decode, source-ID deduplication and
GPU-acknowledged display to preserve deterministic identity and memory bounds.
The current historical render receipts have stale implementation hashes and
cannot justify larger ceilings. No further cap or concurrency was raised in
this pass. The two disjoint Gaia DR3 cone jobs continue under their existing
query-bound receipts; both were confirmed `EXECUTING` and have not produced
result manifests. No tests, builds, benchmarks, deployment, release or push ran.

### Checkpoint 651: align adaptive catalog growth with the P95 target (2026-09-27)

The shared catalog/explorer renderer budget used a weaker growth gate than the
project's required sustained frame target: four P90 < 18.5 ms windows and under
5% long frames could grow the displayed-body count despite P95 > 16.7 ms or
estimated missed slots >= 2%. It now samples p50/p95/p99 callback intervals and
estimated missed 60 Hz slots; growth requires four fully exercised windows at
P95 <= 16.7 ms, P99 < 28 ms and missed slots < 2%, with the same limits shared
by exact-state display. Two pressure windows reduce the displayed count, and
extreme pressure reduces it immediately. No source/physics calculations or
configured maxima changed. Regression cases were authored, not executed; the
callback sampler still does not measure GPU completion, compositor presentation,
memory, thermal state or target-device performance.

### Checkpoint 652: compact native planar point buffers (2026-09-27)

Native 2D rendering now carries only x/y Float32 values per displayed body:
Android's direct buffer and GLES attribute use two components, and the iOS
Canvas projection uses `SIMD2<Float>`. The source contracts still subtract
Float64 state coordinates before display conversion, preserve the deterministic
reference-first prefix and keep spatial 3D payloads unchanged. Static accounting
shows 12 to 8 bytes per Android body and a 16 to 8 byte Swift SIMD stride. This
does not justify raising row limits or assert measured frame/memory gains.
Regression source was updated but not executed under the current no-tests
instruction; no build, benchmark, device run, CI wait, commit, push, deployment
or release occurred.

### Checkpoint 653: do not lose a completed Gaia response on cleanup failure (2026-09-27)

Source review of the existing Orion acquisition showed the row result was read
before an ESA job DELETE failure caused `retrieveGaiaCone` to throw, preventing
local parse and manifest writes. The TAP fetcher now preserves downloaded CSV
for validation and persistence when remote cleanup remains unconfirmed and
records that state with the source while retaining the query-bound receipt.
The original Orion job is no longer served by ESA and has no local result
artifact; its receipt is preserved and was not resubmitted. Regression source
was authored but not run. Praesepe's existing job remains active. No data query,
test, build, benchmark, device run, push, deployment or release occurred in
this checkpoint.

### Checkpoint 654: base missed-slot estimates on complete window cadence (2026-09-27)

The Web adaptive-budget, exact-state display, Android GL and iOS native
samplers rounded each callback interval independently, yielding unstable missed
slot ratios for mixed cadence. They now compute the estimated 60 Hz missed
fraction from aggregate window duration and sample count, with unchanged
pressure/growth thresholds. Source-level cases cover regular 20 ms and mixed
10/25 ms cadence; they were not run. The result remains renderer-callback
throughput evidence, not vsync or compositor evidence.

### Checkpoint 655: reacquire the lost Orion Gaia cone (2026-09-27)

ESA no longer exposes the completed Orion UWS job or its result endpoint, and
there is no locally validated response to reuse. After fixing result retention
across cleanup errors, the exact same 1-degree, G <= 18 Orion cone was submitted
once with a new durable receipt. ESA reports the replacement and the separate
Praesepe job as `EXECUTING`; neither has produced local data artifacts. No
additional duplicate job, test, build, benchmark, device run, push, deployment
or release was initiated in this checkpoint.

### Checkpoint 656: make the verified Praesepe star region directly loadable (2026-09-27)

Packaged the 5,555-row ESA Gaia DR3 Praesepe/M44 cone after read-only checks of
source/chunk hashes and byte lengths, chunk/aggregate counts, exact source-ID
uniqueness, G <= 18, and the requested 1-degree ICRS cone. The manifest records
J2016.0 TCB, ICRS, query provenance, and no all-sky completeness claim. The
Gaia chart now exposes the region and a three-manifest Pleiades/Praesepe preset;
the latter reconciles 26,981 input rows to 22,521 unique source IDs under the
existing 200,000-row and 128 MiB admission budgets. These checks establish
source integrity and selectable coverage, not rendering performance. No test,
build, benchmark, push, deployment or release ran.

### Checkpoint 657: reconcile native ground-observation source state (2026-09-27)

Static source review confirms `NativeStellarMotionView` is referenced from `NativeObservationDeck`, and its station mode calls `NativeStellarMotionService.loadObserver`; Android `StellarMotionPanel` is attached from `MainActivity`; Android and iOS ground-contact views/panels are also attached to their app surfaces. Corrected `docs/gaia-data.md` and `docs/ground-observation.md`: station-direction and ground-contact UI is present in source, while native rise/set visibility-window search and propagated physical uncertainty remain pending. No compile, protocol test, simulator, device or live request was run; this is source-wiring evidence only. No deployment, commit or push occurred.

### Checkpoint 658: align Android moderate-thermal render caps with iOS (2026-09-27)

Static comparison found Android's moderate thermal status allowed 3D/planar limits to remain at their initial 100,000/250,000 rows, while iOS `.fair` caps them at 75,000/100,000 and allows only measured recovery to those caps. Android now applies the same caps and permits recovery during moderate thermal status only within them; the nominal limits and maximums are unchanged. Added focused regression source, but no tests, build, benchmark, device run, commit, push, deployment or release was performed. This parity correction does not claim a higher body count or rendering throughput.

### Checkpoint 659: revalidate Gaia capacity receipts against current sources (2026-09-27)

Recomputed SHA-256 for every implementation path in both retained 4,460-row Gaia Chromium receipts. Against the current worktree, the baseline matches 1/8 and the expanded receipt 1/9; `src/data/gaiaColumns.json` is the sole matching implementation in both. The expanded report's renderer hash is `7c58321c5e6a6c4060acb38f4d75df6150e3c6613c6fc6928c2e2b14eae75f67`; current `GaiaPlot.tsx` hashes to `1d1ebfbe0fa63c6c67c38e0af72e487569a4501295a20adbca6f380c1525027b`. The 200,000-row ceiling was not raised: neither these historical 4,460-row measurements nor the unbenchmarked 16,966-row Gaia pack establish current-renderer capacity at larger sizes, and the separate 1,561,171-row MPC path is not transferable evidence. Hash inspection only; no tests, build, browser run, benchmark, commit, push, deployment or release occurred.

### Checkpoint 660: avoid a redundant Gaia ID index for single-region loads (2026-09-27)

Static ownership review confirms each `streamGaiaChunks` invocation retains a per-region `Set<bigint>` and rejects repeated source IDs across that region's chunks before handing a decoded chunk to the packer. The worker's second collection-wide `Set<bigint>` is now allocated only for multi-region loads, where it is needed to keep the first manifest occurrence across overlapping regions. Single-region loads retain their required within-region validation while avoiding a second O(unique rows) ID index of up to 100,000 IDs under the current per-manifest cap. This removes a redundant unmeasured heap structure; no byte savings, larger capacity or throughput claim is made. No tests, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 661: avoid per-row key/value helper collections in Gaia validation (2026-09-27)

Source inspection found schema-v1/v2 row validation materialized `Object.keys(row)` and `Object.entries(row)` inside the per-record decode loop, then materialized `Object.keys(row)` again during packing. Replaced those checks with precomputed column-name sets and direct iteration over own enumerable keys; validation still rejects missing/extra enumerable fields and applies the existing finite/range checks. This reduces explicit per-row helper-collection construction in code, without claiming an observed heap or throughput gain. No tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 662: account for HTTP stream fragments in Gaia memory limits (2026-09-27)

Source inspection confirms `readBounded` preallocates the declared response length and copies each `ReadableStream` fragment into it. The current fragment can overlap the output allocation, while an overlong fragment is rejected only after `reader.read()` yields it; the loader's encoded-byte reservation does not separately count this transport storage. Documented this transient alongside the existing JSON string/object overlap and unmeasured browser buffering. The current single-output copy strategy avoids retaining all fragments plus a full concatenation copy, so no alternate allocation strategy or larger concurrency budget is justified by source inspection alone. No tests, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 663: keep Gaia display finiteness validation off the UI thread (2026-09-28)

The Gaia worker's projection writer stores each point into its Float32 display array and checks the rounded x/y/magnitude values for finiteness immediately afterward. The active worker transfers that array to the page, whose message handler repeated `Number.isFinite` across every element before upload. Removed only the redundant UI-thread value scan; worker-side numeric validation plus page-side transfer type and exact row-length checks remain. This avoids up to three extra predicate calls per displayed row on the UI thread (600,000 at the 200,000-row ceiling), based on source inspection only; no frame-rate or throughput change is measured. No tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 664: overlap Gaia chunk reads across bounded manifest groups (2026-09-28)

Static inspection showed the collection worker awaited each manifest stream before starting the next, leaving request slots unused for small region manifests. Added ordered read groups of up to eight manifests; each group is split when the sum of member maximum chunk bytes or rows would exceed the existing 96 MiB/90,000-row limits. Per-stream reservations start at that manifest's largest descriptor and divide only remaining capacity, while allocated job slots sum to at most eight. Source reads and hashes can overlap across manifests; a cancellable pre-decode turn preserves first-manifest duplicate precedence and keeps JSON parsing/packing serial. Waiting for that turn pauses the chunk-stage timer, which restarts for active decode/consume. Collection summaries now report actual aggregate reservation peaks and concurrent manifests with source reads; the opt-in capacity receipt schema 4 records both windows and checks multi-manifest overlap whenever source chunks are actually read. Cache-only samples correctly report zero source-read overlap. This is source-level progress only: no tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran, and no throughput increase is claimed.

### Checkpoint 665: keep catalog throughput changes evidence-led (2026-09-28)

Static review of the general asteroid catalog path found four bounded binary-shard prefetch jobs, one ordered shard compute/delivery path with awaited tile backpressure, a separate four-credit upload window, and frame-sliced 4,096-row GPU uploads. The byte admission model explicitly retains its per-row scratch reserve because it has not been replaced by linked memory evidence. This supports keeping the current concurrency and capacity limits; no source change or higher-body-count claim is justified by inspection alone. No tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 666: retain native object limits until device evidence supports growth (2026-09-28)

Static comparison confirms Android and iOS begin at 100,000 3D or 250,000 planar points, with maxima of 250,000 and 500,000 respectively and matching fair/moderate-thermal ceilings of 75,000 and 100,000. Both reduce limits from active frame evidence or memory/thermal pressure without deleting the verified scientific source frame. iOS projection preparation cancels and drains its prior worker before allocating a replacement, avoiding overlapping full-frame buffers during rapid mode/reference changes. No larger native cap or parallel full-frame compute is justified without device and memory measurements. No device run, build, test, commit, push, deployment or release ran.

### Checkpoint 667: add analytic contracts for ellipsoid ray intersections (2026-09-28)

The new ellipsoid-ray implementation had no direct unit contract. Added source cases for a sphere's exact first intercept, backward and missed rays, tangent classification inside the numerical screening margin, and a rotated triaxial intercept transformed back to J2000. These cover closed-form geometry and frame mapping only; no test was executed, and large-distance conditioning remains pending independent numerical comparison.

### Checkpoint 668: target star scaling at real source rows and useful views (2026-09-28)

The capacity target is more scientifically accepted source rows calculated and
more meaningful stars displayed together, not arbitrary lowering of costs or
raising renderer ceilings. Restored a completed 0.35-degree Gaia DR3 cone near
the Galactic center from its existing query receipt: 9,686 unique rows to G <=
18, with the `TOP 100,001` sentinel absent. Independent local checks re-read
the source CSV through the production Gaia parser, checked its cone/epoch/fields,
verified source and chunk hashes, and matched the entire spatial chunk to the
parsed rows. The remote UWS delete returned HTTP 500; the manifest preserves
`cleanupPending`, while the retrieved local bytes remain complete.

Across the five packaged region manifests, 43,557 rows reconcile to 39,097
unique source IDs, with 4,460 repeats from the nested Pleiades cones. The new
Galactic-center region is now a standalone Gaia-chart choice in both locales.
All five regions need a 163.771-degree conservative tangent-plane radius, so
they cannot be combined under the existing 80-degree admission rule. The four
nearer fields remain the largest current collection at 29,411 unique stars;
this addition expands source coverage but does not claim a higher per-chart
count or rendering throughput. A static audit confirms the 200,000-row / 128
MiB admission ceiling remains unchanged; the retained 4,460-row browser receipt
uses different implementation hashes and cannot establish current capacity.
The wider Orion UWS query is aborted. A new 0.8-degree inner-bulge query is
executing to target a larger single-view star count within existing chunk and
collection limits. No tests, typecheck, build, browser run, benchmark, commit,
push, deployment or release ran.

### Checkpoint 669: stabilize far-observer ellipsoid surface coordinates (2026-09-28)

Static numerical review found that ray intercept points were reconstructed by
adding the observer's scaled position to its nearly equal opposite ray offset.
For distant, oblique rays this can lose small transverse surface coordinates
even when the hit/miss decision remains stable. The solver now reconstructs
the point from the perpendicular ray component and forward half-chord; the
existing product-of-roots distance and near-limb screening policy are unchanged.
Added an oblique unit-sphere case at the ellipsoid helper's maximum accepted
scaled observer distance. An initial estimate that an aligned ray rounded to
the sphere center was too strong: division can recover that near-axis root.
This remains source-level conditioning evidence, not an independent physical
oracle or error bound. No tests, typecheck, build, browser run, benchmark,
commit, push, deployment or release ran.

### Checkpoint 670: separate Gaia drawn rows from loaded rows (2026-09-28)

The Gaia completion summary previously labeled its verified unique-row count as
"displayed" as soon as upload ACKs arrived, although the final persistent-canvas
composite could still be queued for the next animation frame. The chart now
reports its drawn-row count only after a successful framebuffer composite, and
the interface separates that value from unique source rows loaded. This is a
software draw/composite count, not proof of physical-display presentation or
visible non-overlap. No browser run, test, build, benchmark, commit, push,
deployment or release was performed.

### Checkpoint 671: retain the focused ray case for the final verification phase (2026-09-28)

Attempted only `tests/unit/ellipsoid-ray.test.ts`, matching the later
authorization for periodic focused validation. The RTK Vitest filter rejected
the first invocation; the repository npm test entrypoint then confirmed that
the local checkout has no installed `vitest` executable (`node_modules` is
absent). No test case ran, and dependencies were not installed during this
implementation pass. The test remains for the final verification phase.

### Checkpoint 672: admit New Horizons OD164 with explicit prediction limits (2026-09-28)

Refreshed the OD164 source pack under the current reader and preparation hashes.
Across 35,259 sampled ETs, CSPICE N0067 found all six state components identical
between the original SPK and crops. The production TypeScript and Go readers,
with the explicit 16-target dependency pool, matched CSPICE at zero position
difference and at most 1.78e-15 km/s velocity difference. The source root and
dependency-only pool are now added to both Pages and full manifests, bringing
each to 672 entries and adding 6,351,872 bytes. Runtime manifest projection
retains the OD164 tracking cutoff and prediction caveat, and the body inspector
displays that boundary for New Horizons. This confirms sampled parser/crop
equivalence for the pinned official bytes, not trajectory accuracy after the
2025-04-18 tracking cutoff or a physical residual bound. No tests, build,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 674: reconcile and audit both current SPK source profiles (2026-09-28)

The two checked-in manifests now contain 672 files each after OD164 admission,
but the scientific-validation source and build verifier still pinned the prior
670-file profiles. Ran the read-only SPK asset audit across the 874-file union:
all declared sizes and hashes matched, target IDs matched each SPK descriptor,
and five samples per descriptor produced finite states. The audit covered
1,259,552,768 bytes, 1,334 segments and 6,670 sampled states. Both windows use
J2000 frame and contain types 1/2/3/17/21. The 470 shared paths have identical
metadata; the 202 profile-specific paths retain the documented short Pages
window and long full-profile window.

Refreshed `modelEvidence.json`, `verify-build.mjs` and the physical-ephemeris
source totals from current manifest bytes and hashes. Re-derived the curated
Pages preview closure from the product selector: 41 files and 92,071,936 SPK
bytes remain unchanged, and the New Horizons roots are outside that preview
closure. Five samples per descriptor and file hashes do not establish full
interval physical accuracy. No tests, build, deployment, release, commit or
push ran.

### Checkpoint 673: refresh fixed-epoch fallback states when their source inputs change (2026-09-28)

The optional fallback-body generator previously reused a stored record by NAIF
identity alone. A source-manifest refresh showed seven Uranian/Neptunian moon
fallbacks still named older SPKs even though the current manifest selects
ura182/nep098. Regeneration now reuses records only when the manifest, GM file,
generator/parser/dynamics code hashes, and selected SPK identity/hash match.
The regenerated 316-row table keeps the same identities and TDB epoch, refreshes
those seven states to the current manifest sources (maximum change 518.64 km and
0.00498 km/s), and adds each selected SPK SHA-256. The other 309 position and
velocity records are unchanged. This aligns fallback seeds with current source
selection; it is not independent physical-accuracy acceptance. No tests, build,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 675: add a source-verified inner-bulge Gaia view (2026-09-28)

ESA aborted the prior 0.8° G <= 18 inner-bulge query, so its retained UWS
receipt is recorded as an unsuccessful acquisition and contributes no rows.
A smaller 0.15° ICRS cone centered at RA 264.8°, Dec -30.2°, G <= 17 returned
654 Gaia DR3 rows. The repository parser confirmed the J2016.0 source records,
cone and magnitude bounds, the TOP 20,001 non-overflow receipt, the raw CSV and
single chunk hashes, and the receipt hash bound into the manifest. The 654
source IDs are disjoint from all five existing packaged regions. The new
manifest, original CSV, chunk and UWS receipt are checked in as local working
tree assets; no data was deployed.

Added bilingual standalone and Galactic-center paired presets. The pair loads
10,340 unique sources (9,686 existing plus 654 new). It increases the dense
Galactic-center view, while the separate Pleiades/Praesepe/Orion preset remains
the largest documented chart at 29,411 unique stars. The wider same-field Gaia
capture is being acquired before claiming an increase to that maximum. The
200,000-row allocation budget was not changed without device evidence. No tests,
build, browser/device run, benchmark, deployment, release, commit or push ran.

### Checkpoint 676: stop the wider Gaia query at the ESA execution limit (2026-09-28)

The 2° G <= 18 Pleiades expansion remained in `WRITING_RESULT` until ESA's
two-hour execution limit aborted the job. The client had resumed the same UWS
job after its shorter local timeout; it did not submit a duplicate query. No
CSV, manifest or chunks were returned, so no rows were added. The public UWS
receipt is retained for provenance. The small inner-bulge addition and its
10,340-source paired field remain valid; the 29,411-star Pleiades/Praesepe/Orion
view remains the largest packaged chart. No new query with the same 2° radius
was started against the archive.

### Checkpoint 677: try one narrower same-field Gaia capture (2026-09-28)

To check whether a smaller spatial selection can finish within the archive limit,
submitted one distinct 1.75° G <= 18 cone around the Pleiades center. Its UWS
job is still `EXECUTING`; no CSV or row count has been returned, so it adds no
stars to the packaged views. The separate receipt is retained at
`public/data/gaia/gaia-pleiades-ra55-dec25-r1p75-g18-20260928.tap-job.json`.
This is a single bounded acquisition attempt; no renderer admission or upload
budget changed. No tests, build, benchmark, deployment, release, commit or push
ran.

### Checkpoint 678: coalesce simultaneous exact-state evaluation (2026-09-28)

The catalog's bounded evaluation cache reused completed target/epoch results but
allowed independent cache-cold plans to evaluate the same target at the same
exact epoch concurrently. Added a catalog-local in-flight table keyed by NAIF
target and the exact Julian-date bits. Concurrent requests now share immutable
state and provenance results; if the builder request is cancelled, a live
waiter retries with its own context. Missing and failed results are not kept in
the completed cache. Added coalesced and active-computation counters for the
existing window benchmark output, plus focused concurrency and cancellation
regression cases. These changes have not been tested or benchmarked; no increase
in throughput is claimed. No deployment, release, commit or push ran.

### Checkpoint 679: preserve queue priority while sharing exact-state work (2026-09-28)

Follow-up inspection found the state-plan path still called the legacy catalog
entry point directly, so the new scheduler-aware admission helper was not on the
actual plan-resolution path. State-plan resolution now uses that helper, which
acquires a compute slot only for a flight leader that owns uncached exact-state
work. Same-priority in-flight calculations may coalesce; interactive,
trajectory and bulk flights remain independent, while completed target/epoch
values remain shareable across those classes. This avoids making a bulk leader
hold up an interactive waiter and avoids spending another slot on a coalesced
waiter. Each slot is released as soon as its target calculation finishes,
avoiding holding one slot while a batch waits on another queued target. No body,
tile, upload or byte limit changed, and no throughput or device capacity gain
is claimed. The cache metric is named `activeFlights` because it
also includes a leader waiting for compute admission; it does not measure CPU
execution. The focused admission path is still untested; no test, build,
benchmark, deployment, release, commit or push ran.

### Checkpoint 680: audit the large-catalog compute-to-render path (2026-09-28)

Source inspection traced the current snapshot path through
`catalog-stream.worker.ts`, `CatalogEpochStore`, `CatalogStreamCanvas` and the
fixed-capacity WebGL point renderer. Epoch calculation runs serially in one
stream worker: it evaluates 1,024-row tiles, yields every 256 rows, and allows
two tile ownership acknowledgements in flight. The retained source coefficients
use ten Float64 values per row (80 bytes); a second full prepared copy of the
1,567,193-row desktop inventory would add about 125.4 MB before output tiles or
GPU attributes. Spatial selection follows the computed positions and reduces
overlapping rows to deterministic screen-cell representatives; it does not
reduce orbital computation. Existing large-catalog reports are historical and
explicitly do not validate the changed current source tree. No worker count or
draw ceiling was raised without current execution and device evidence. Any
parallel compute implementation must transfer each prepared partition once,
keep ordered row ownership, retain the two-tile acknowledgement bound, and
measure peak memory as well as frame cadence. No test, build, benchmark,
deployment, release, commit or push ran.

### Checkpoint 681: remove the retained-coefficient copy on the stream path (2026-09-28)

Static ownership tracing confirmed each initial source shard creates its own exact-sized
prepared Float64 slab and the stream producer does not reuse it after `onPrepared`;
append batches own a separate prepared slab, while only positions and appearance are
transferred for GPU upload. `CatalogEpochStore` now retains those coefficient slabs in
upload order rather than allocating another capacity-sized array and copying every row
into it. Epoch tiles propagate across slab boundaries while preserving source order and
the existing per-block epoch metadata. `retainedBytes` now accounts retained coefficient
bytes, fixed epoch metadata arrays and the source-reference slots. This removes one full
coefficient write pass and avoids reserving unused capacity eagerly; it does not reduce
the 80-byte retained-source charge per admitted row or justify a higher row cap by itself.
An unrun source-level regression case covers cross-slab tile propagation. No tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 682: stabilize Gaia formal-covariance propagation and scaling (2026-09-28)

The Go stellar-motion covariance adapter validated the normalized source
correlation by strict Cholesky, but then formed each propagated entry with a
naive four-index sum of J C J-transpose. It now retains the corresponding
source covariance factor, propagates it through the numerical Jacobian, and
forms K K-transpose with Neumaier-compensated six-term dot products. This
preserves the positive-semidefinite factor construction and reduces
roundoff-sensitive cancellation without changing Starpm, finite-difference
steps, source policy or the reported first-order model. The prior derivative
scale check compared mixed-unit Jacobian entries against `max(1, |D|)`; it now
measures the two-scale Jacobian difference after input-covariance weighting,
normalized by each extrapolated output marginal standard deviation. This makes
the retained `maxScaledDerivativeDifference` diagnostic dimensionless; its
threshold remains a local numerical gate, not an error bound. Existing 64-case
independent ERFA evidence predates these implementation changes and is not
revalidated here. Source inspection and formatting checks only; no tests,
build, numerical run, deployment, release, commit or push ran.

### Checkpoint 683: close the stale status on the wider Gaia TAP attempt (2026-09-28)

Rechecked the exact 1.75-degree Pleiades TAP job retained by checkpoint 677.
ESA now reports `ABORTED` at its 7,200-second execution limit. Job metadata
lists a 1,203,758-byte result link, but the result endpoint returns HTTP 500;
no complete CSV or verified row count is available. No rows were ingested and
the packaged-chart count is unchanged. Treat the acquisition as failed rather
than interpreting an inaccessible aborted-job result as complete coverage.
This closes the stale `EXECUTING` status only; no replacement broad query,
tests, build, benchmark, deployment, release, commit or push ran.

### Checkpoint 684: distinguish sampled ground overlap from sampled zero (2026-09-28)

Cross-platform tracing found the Go ground-contact scanner tagged every sampled
overlap-window endpoint `sampled-zero`, including interior samples with a
strictly negative angular gap. The Web, Android and iOS receivers correctly
required each such label to match an actual zero-contact record, so otherwise
valid overlap-window responses could be rejected and the scientific edge
meaning was false. The scanner now emits `sampled-overlap` for negative-gap
samples while preserving exact-zero, bracketed-contact and clipped-boundary
labels. All three receivers accept a point-bracket sampled-overlap edge without
inventing or requiring a contact; zero and root edges still require matching
contact evidence. Updated the ground-observation contract. Source review only;
no Go, Web, Android or iOS tests, builds, or runtime requests were run.

### Checkpoint 685: label sampled overlap edges accurately in native and Web UI (2026-09-28)

The follow-up presentation audit found Android mapped unrecognized edge kinds to
“bracketed contact”, while the Web and iOS ground-contact readouts showed raw
protocol values. Added explicit English/Chinese labels for search boundaries,
sampled zeros, sampled negative gaps and bracketed contacts. This makes the
new `sampled-overlap` evidence legible without changing the exported protocol
receipt. Static source review only; no tests, builds, browser/simulator/device
run, deployment, release, commit or push ran.

### Checkpoint 686: search point-source contacts against oriented PCK ellipsoids (2026-09-28)

Added a bounded signed-gap root search and a dedicated Occultation laboratory
panel for a user-supplied fixed J2000 point-source ray. Each sample resolves the
observer and target from the pinned DE440 kernel and uses an exact PCK body ID.
Unequal-axis shapes use text-PCK orientation at reception (`NONE`) or
target-center emission (`CN`); exact spheres are rotation-invariant. The signed gap is explicitly the scaled ellipsoid impact
parameter minus one, not an angle or physical distance. Input bytes, source
identities, budgets, scan/root brackets and incomplete-coverage limits are
retained and bound before display. This does not add catalog star identities,
finite background-body overlap, topography, differential limb light time,
topocentric station search, or Go/native parity. The new path has source-level
review only: no tests, build, browser run, benchmark, commit, push, deployment
or release ran, as requested. Independent CSPICE cases and runtime verification
remain required before the new event model can be accepted.

### Checkpoint 687: exclude numerically indeterminate samples from ray contacts (2026-09-28)

The point-source ellipsoid-ray helper already classified samples within its
distance-scaled near-limb screening margin as numerically indeterminate, but the
contact scanner still used their raw signs during crossing refinement and
negative-gap window assembly. The scanner now requires definite signs outside
that margin; if bisection enters it, the result retains a screened candidate
and does not claim a localized contact or infer a window through that interval.
Receipts bind the indeterminate samples and candidate brackets, and the panel
shows their counts. This is conservative numerical classification, not a
certified floating-point or physical error bound. Static source inspection and
diff review only; no tests, typecheck, build, browser run, benchmark, independent
CSPICE comparison, deployment, release, commit or push ran.

### Checkpoint 688: add bounded eastern Galactic-center Gaia fields (2026-09-28)

Two additional schema-v2 Gaia DR3 cones were retrieved from ESA TAP and
persisted with their original CSVs, job receipts, manifests and SHA-256-checked
spatial chunks: RA 267.15°, Dec -29°, radius 0.25°, G<=18 (10,244 rows), and
RA 267.7°, Dec -29°, radius 0.20°, G<=18 (12,008 rows). Neither used an
independent COUNT(*) scan; each is bounded-query evidence below `TOP 20,001`,
not a catalog-completeness claim. Their spherical separations from each other
and the prior six regions exceed the sum of cone radii, so the reported row
addition is disjoint by geometry. The packaged set now has eight region
manifests, 66,463 rows, 62,003 unique source IDs and 54,314,351 encoded chunk
bytes. Every CSV field value across all 66,463 rows matches its decoded chunk
record, and per-region source-ID multisets reconcile; the only repeated cross-manifest IDs are the 4,460 nested
Pleiades rows. The Galactic-center selection now loads four regions and 32,592
unique sources across 29,051,311 encoded chunk bytes, below the current
128-MiB admission cap but without a throughput or frame-time claim. English
and Chinese controls expose both new fields. A nearby wider
0.25° query exceeded its 20,000-row budget and was rejected by the sentinel;
its receipt is retained without a manifest. The old 0.8° inner-bulge and
1.75° Pleiades attempts were rechecked as aborted at ESA's 7,200-second limit;
no partial result link was treated as complete data. This grows source coverage,
not measured renderer capacity. The current-renderer frame/memory budget remains
unmeasured, so performance is not described as excellent. Static data, hash,
geometry and UI-path reconciliation only; no tests, build, benchmark, commit,
push, deployment or release ran.

### Checkpoint 689: reconcile Gaia and SOFA stellar-motion conventions (2026-09-28)

Static review compared the Gaia DR3 catalog contract with the Go adapter and
ERFA's SOFA-derived `Starpm` source. Gaia positions are ICRS at J2016.0 TCB and
`pmra` is the tangent-plane `mu_alpha*cos(dec)` component. `Starpm` takes
two-part TDB Julian Dates, coordinate-angle RA/Dec rates in radians per TDB
Julian year, parallax in arcseconds and positive-receding radial velocity in
km/s; it assumes uniform rectilinear constant-velocity motion. The adapter
converts both catalog epochs, unwraps `pmra` by `cos(dec)`, converts units and
TCB-compatible rates/parallax, requires an explicit spectroscopic-RV adoption,
and rejects any SOFA warning status. No source-level epoch/unit/sign mismatch
was identified. This is contract reconciliation, not independent numerical
acceptance; the model's disclosed limitations and independent reference checks
remain outstanding. No tests, build, benchmark, deployment, release, commit or
push ran.

### Checkpoint 690: verify removal of legacy exact-state JSON routes (2026-09-28)

Read-only call-graph review confirms Web exact current-state loading uses the
catalog manifest plus `/v1/state/plan` and `/v1/state/tiles`; Android and iOS
use the same plan/tile protocol. The registered backend routes contain no
`/v1/current-states`, legacy JSON trajectory, or identity-state endpoint.
`/v1/state/window` remains a separate length-prefixed binary history stream,
not a JSON compatibility path. No production call to a removed endpoint or
dual-write path was found in the three clients. Existing source tests specify
404 contracts, but they were not run. This closes the source-level legacy-route
check only; it does not verify build/runtime client coverage, cancellation,
cross-platform semantics or performance. No test, build, benchmark, deployment,
release, commit or push ran.

### Checkpoint 691: add Juno reconstructed ephemeris with cross-reader CSPICE evidence (2026-09-29)

Added Juno (NAIF -61) as a selectable source-backed spacecraft using the
mission-navigation reconstructed Type 1 SPK records from 2022-01-01 through
the source coverage end on 2026-08-24. The product manifest selects the
trajectory lazily and names DE440S separately for Jupiter-barycenter/Sun-relative
center resolution; it does not claim DE440S was the navigation fit ephemeris.
The original 146,816,000-byte SPK is retained in local audit cache; the product
contains only the 91,458,560-byte cropped trajectory. The official PDS archive
describes broad informal reconstruction scales, not per-state covariance or a
bound for this product window.

Extended the CSPICE reference and Solar TypeScript/Go comparison tools to
verify independently identified external center kernels. Their 635,061 sampled
epochs showed exact zero difference between original and cropped CSPICE states,
and both Solar readers matched positions exactly with maximum velocity
differences below 1.5e-14 km/s. This is reader/crop parity for the pinned source
bytes, not navigation-fit accuracy or a measured physical residual. No project
tests, application build, benchmark, browser/device run, deployment, release,
commit or push ran. Juno remains one of four spacecraft sources; additional
spacecraft/physical-parameter coverage and device capacity evidence remain open.
