# Pending validation of current scientific changes

Validation inventory, 2026-09-24. This supplements the full acceptance ledger in
[scientific-expansion-goal.md](scientific-expansion-goal.md); it does not narrow the
goal or certify implementation completion. The owner authorizes scoped tests
periodically, regular commits and collected direct-to-main pushes, while
prohibiting the full local test suite. Deployment/release is paused. Earlier
statements that a check has not run remain historical unless updated with a
scoped result.

Items below remain **unverified except for the explicitly scoped results here**.
Historical artifacts are not evidence for the current dirty worktree. Preserve
them rather than relabeling or overwriting them.

## Source-only follow-up (2026-09-25)

`CatalogPointRenderer` no longer calls synchronous `getError()` on passive
camera/resize redraws; those still reject a lost graphics context. Catalog tile
ACK, append upload, complete epoch-tile recycle, epoch/selection publication,
buffer initialization and context restoration retain GL error checks. Epoch
and restoration slices defer the synchronous query until a safe ownership or
publication boundary. Gaia combines each `bufferSubData` plus draw error check
before ACK and skips synchronous checks on passive zoom/resize redraws. These
changes target the driver-stall hotspot recorded below, but that profile is
from a prior source revision and does not establish current improvement. No
test, build, simulation, benchmark, browser run or CI wait was performed for
this source follow-up.

### Gaia point-selection memory and invalidation review

The current chart admits up to 200,000 rows. `ScreenPointIndex` allocates an
800,000-byte `Int32Array` ordinal-link array at that limit and a cell-head
array of `4 * (ceil(width/18)+2) * (ceil(height/18)+2)` bytes. Its Gaia point
reader recomputes pixel coordinates from the retained Float32 display batches
only for candidates in the clicked cells; it therefore does not allocate the
former 1,600,000-byte Float32 pixel-coordinate cache at this row limit. The
reader's two-number Float64 scratch array is 16 bytes. The chart's retained
Float32 display batches separately occupy 2,400,000 bytes at 200,000 rows.
These are typed-array sizes, not total JS heap, receipt storage, GPU/driver
memory or device measurements. The cached index key includes CSS width/height,
rendered zoom and uploaded row count; replacing the dataset remounts the chart
by generation, so the inspected invalidation path is coherent. Index
construction still scans up to 200,000 points synchronously on the first click
for each key. Its interaction latency remains unmeasured; the source review
does not justify adding worker handoff or another per-point cache without
measurements.

### Checkpoint 882: trace Gaia chunk-to-render capacity accounting (2026-09-28)

The motion worker admits two concurrent source reads within a 64 MiB / 60,000-
input-row reservation. Chunk decode and per-manifest source-ID discovery remain
serialized; at most two backend propagation callbacks may run concurrently, and
their deduplication, projection and publication commit in manifest order. The
same two-slot / 60,000-row upload credits are reserved before propagation and
held through chart acknowledgement. Each source chunk is capped at 30,000
rows. During projection, four worker typed arrays account for at most 32 bytes
per propagated row when every propagated row is plotted (12-byte point scratch,
4-byte full-capacity ordinal scratch, 12-byte exact display copy and 4-byte
exact ordinal copy), or 960,000 bytes for one maximum-sized chunk. Each API
response body is capped at 14 MiB, so two concurrent responses admit at most
28 MiB of serialized receipt bytes before decoded text and row objects. These
are individual source and typed-array bounds, not a combined worker/page heap
limit.

The complete per-chunk scientific receipt is structured-cloned to the page and
retained for selection and exact export; only display coordinates and plotted
row ordinals are transferred. Response bytes, decoded JSON text, parsed receipt
objects, the cross-manifest source-ID set, retained display batches and GPU
storage overlap during the load. Their combined browser/device high-water mark
has not been measured, so the source ceilings do not justify raising the
200,000-row chart limit or claiming real-device capacity. Only static source,
reference and whitespace checks were performed; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 883: overlap bounded Gaia tile propagation (2026-09-28)

The loader previously serialized backend tile requests along with decode and
source-ID verification, leaving server compute slots beyond the first unused
when available. A separate `consumerConcurrency` limit now
allows two verified chunks to propagate concurrently while chunk parsing and
source-ID insertion stay ordered. Worker upload credits are reserved before
each request and held until the page acknowledges its checked GPU upload/draw,
so the two requests share one two-slot / 60,000-row compute-to-render bound.
Receipts can return in either order, but deduplication, projection and messages
commit in manifest order. Any failed request aborts the collection before a
later result can publish. This is a bounded parallelism change, not proof of
higher throughput or device smoothness. Static review only; concurrency,
ordering, cancellation and acknowledgement cases remain for the final test
phase. No tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 884: keep Gaia upload ACKs alive across stream completion (2026-09-28)

Cancellation-path review found that `streamGaiaChunks` aborts its private signal
when a manifest stream finishes normally. A posted chart receipt may still be
waiting for its GPU upload ACK at that point, so binding the ACK reservation to
the per-stream signal could mistake normal stream teardown for cancellation.
Slot waits now observe both the chunk-stream and batch-task signals, while a
published receipt's reservation lives until its ACK or batch-task abort. Any
batch failure aborts the task signal before worker cleanup, releasing posted
and waiting reservations; successful completion still waits for all ACK tasks
before emitting `done`. Static source review only; final tests must cover a last
chunk ACK after stream teardown, cancellation during slot wait, ACK timeout,
out-of-order backend completion and failure release. No tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 885: preserve Gaia descriptor order across parallel reads (2026-09-28)

Static tracing found that each completed read appended its decode callback to a
promise chain. A later descriptor whose read and hash finished first could
therefore be decoded and propagated first, changing duplicate-source
precedence and the sequence expected by the page. The scheduler now reserves a
decode/callback-start turn at descriptor admission, while reads and hashes
remain parallel and bounded. Callback work and backend propagation can still
overlap after each ordered start. A focused delayed-read regression case was
added but not run. Final validation must check this case together with
cancellation, timeout, cross-manifest order, backend completion, and ACK
lifecycle. No tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 886: reconcile Gaia chart ceilings with retained storage (2026-09-28)

Static tracing confirms the 200,000-row admission value is shared by aggregate
manifest planning, the catalog-epoch worker/page, the propagated-motion worker,
and the WebGL point buffer. At that ceiling the chart retains up to 2,400,000
bytes each for transferred Float32 coordinates and the GPU point buffer; the
2048-square RGBA8 render target adds 16 MiB by format. Gaia catalog mode also
retains 56,850,000 bytes (54.216 MiB) of schema-v2 packed IDs, Float64 fields
and null bits before active parse/cache state. These paths do not include JS
object/set overhead or browser/driver allocations. Motion mode instead retains
complete propagated receipts, and its aggregate high-water mark is likewise
unmeasured. The 200,000 value is a software admission ceiling, not verified
device capacity; no increase is justified without final multi-tier memory,
frame and cancellation evidence. Corrected the Gaia data guide to keep the
catalog-epoch chart distinct from the target-epoch propagation workflow. Static
source and exact-size arithmetic only; no tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 887: compact retained Gaia motion receipts (2026-09-28)

The batch motion page retained one JavaScript object per source row solely for
plot selection and full receipt export. The worker now validates each returned
row against its already-verified BigInt64 source ID, compacts status and reason
codes and a two-byte state index, with six binary64 values stored only for
propagated rows. Fixed columns use 13 bytes per input row; the worst-case state
array adds 48 bytes per row if every input propagated, or 12,200,000 bytes at
200,000 rows, plus bounded reason strings, instead of the full row/state object
graph. Missing/rejected rows add no state array values. Selected rows are
reconstructed on demand; export snapshots the result list and serializes one
reconstructed chunk per stream pull, preserving the
schema-v1 receipt fields and partial/complete marker. This moves packing off
the UI thread and releases worker-side response-row objects before ordered
publication. Transient response JSON, the source-ID Set, display/GPU buffers,
Blob storage, and unknown device/driver overhead remain outside that fixed
column figure. No tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran; final validation must check exact
receipt round-trip, reason/status variants, selection mapping, export format,
transfer detachment and cancellation.

### State loading concurrency and backpressure review

The browser fetches at most two tiles per plan, and its shared admission pool
allows two in-flight tile bodies/decodes across interactive, trajectory and bulk
workers, with a bounded queue of 32. Current-state requests split IDs at 32,768
and run up to two plan workers; each plan admits at most two tile workers through
the same two-slot pool, and completed chunks are restored to request order.
Android/iOS also admit at most two adjacent tiles when the estimated working set fits their 1,536 MiB state
budget; the backend exposes two tile encoder slots. This means raising a client
lane count alone cannot raise backend tile encoding parallelism and can increase
queued bytes and transient decoding memory. No cross-plan prefetch or concurrency
increase is justified by static source alone. The missing evidence is per-tier
plan/tile latency, queue wait, peak resident/transient memory, cancellation drain
time, and render-frame tails while loading increasing body counts. No tests,
builds, simulations, benchmarks or CI waits were run for this review.

### Covariance dot-product accumulation review

The six-state covariance path previously used ordinary left-to-right sums for
short matrix dot products, including off-diagonal Gram entries where signed
terms can cancel. Browser and Go now use the same Neumaier compensated Float64
dot order for coordinate/root products, covariance formation, source
correlation Cholesky factorization and reconstruction residuals. Gaussian draw
mapping also uses the same dot order; its algorithm ID advanced to v3 and the
receipt binding and fixed-seed reference were updated. Go's initial and final
coordinate projections use the same dot order as the browser. This controls
roundoff and cross-runtime accumulation order; it does not establish a
condition estimate, physical accuracy or material benefit on real receipts.
The focused `tests/unit/covariance-sampling.test.ts` passed all five cases after
updating the versioned fixed-seed values; the initial run exposed the expected
old-output mismatch. No build, simulation, benchmark, native compile or
cross-language/reference comparison was run; numerical agreement and material
benefit on real receipts remain pending.

### Nonlinear ensemble moments and event-time summaries

Static review found that endpoint means are computed from offsets to the first
draw, and covariance uses a second compensated pass with the sample divisor
`n-1`; a failed draw makes the moment summary unavailable. Event-time
summaries select the first chronologically detected sign-changing event in
each direction and keep failed, unresolved, not-detected and preceding
unclassified-zero draws separate. Nearest-rank timing bounds use separately
ranked localization lower/upper bounds, which enclose the corresponding order
statistic even when draw intervals overlap. The summaries explicitly do not
claim convergence, population confidence, calibrated event probability,
physical uncertainty or a complete crossing search. No source change was
justified by this inspection; no test or runtime check was run for this path.

### Adaptive integration error policy

Static comparison found matching TypeScript/Go Dormand–Prince 5(4) tableaux,
componentwise `atol + rtol * max(|y|, |y_trial|)` scaling, maximum-component
acceptance, bounded proportional step changes, FSAL reuse, attempt limits and
the same base/refined tolerance vectors. The browser yields by attempt/time
slice; Go checks context at integration and derivative-stage boundaries.
The accepted-step embedded error ratio is bounded by one by construction and
is a local numerical diagnostic, not accumulated trajectory error or physical
accuracy. `tests/unit/adaptive-integrator.test.ts` passed all nine focused
cases. This exercises the browser integrator only; Go parity remains source
inspection, and DE440/reference accuracy remains unverified.

## Latest targeted execution (2026-09-24)

Commit `2f68038` adds a passing desktop browser check of actual retained-epoch
playback with zero source reloads. After a completed new epoch, the test holds
the next real upload ACK, cancels through the visible control, and checks zero
remaining drawn rows plus removal of epoch/export claims. This is a three-row
behavioral test, not a full-inventory continuous-simulation capacity result.

Run `35958101923` is now terminal failure. Its iOS run passed six of seven tests;
the import test failed before finding a file. The recorded accessibility tree
is still on empty Recents, with `DOC.browsingModeTabBar` containing Browse. The
test's immediate optional `exists && isHittable` check skipped that navigation.
Commit `7ea5715` waits for the observed tab and its hittability, then requires
each Browse/local-storage/fixture-folder transition rather than silently
skipping absent controls. Original file-read and scientific-result assertions
are unchanged. This does not yet prove the original bookmark issue is fixed.

The cumulative batch through `7ea5715` was pushed to
`codex/scientific-audit-batch-20260924` after the prior run became terminal.
It includes the verified Web/preview fixes and catalog integration. Main has
not been pushed or deployed; await the exact new head's gate results.

The catalog Worker/UI integration has now been committed after independent
checkout verification. The scan fixtures carry valid metadata, complete bound
descriptors, consistent empty-index dimensions and exact per-shard locators.
Thirteen focused scan/key/cancellation/point-worker cases passed. Six desktop
browser scenarios passed after a new build: expanded restoration, failed GPU
ACK, selected-object append/export, rotation without attribute reupload,
out-of-sample exact hydration and preserved exact-result paging. Two mobile
scenarios (append/export and failed GPU ACK) passed after the final effect/timer
cleanup changes. App TypeScript checking and scoped ESLint pass without the
previous hook warnings. This integrates only the catalog lane; the broader
scientific/native dirty worktree and whole-goal acceptance remain unfinished.

The iOS job of `35958101923` remained live at the latest read; do not infer
failure merely from its duration or restart it before its terminal result.

The retained GPU renderer is now separately committed: it hides incomplete
in-place epoch replacements, requires all row ranges before completion, checks
actual GPU allocation/upload/draw errors, does not cache failed attribute
uploads, and reuses index-buffer high-water capacity. Eleven focused renderer
cases passed in the isolated checkout, including partial epoch, failed finish,
fresh recovery, failed sample upload retry and lost-context cases. The related
scheduler's 15 existing cases also passed. No whole local suite was run.

Worker/UI integration is staged only in the audit checkout, not committed as a
whole. Its app TypeScript check passes after including catalog scan/store and
sample hook dependencies. Point-worker tests now await asynchronous messages;
both pass, but the scan-worker's older fixtures still have four failures
(incomplete metadata, inconsistent empty compact dimensions, and missing bound
compact descriptors). Keep these failures visible and repair their real source
contracts before publishing that integration. The prior iOS run is still live.

Commit `13566b5` repairs the cancellation/concurrency fixtures rather than
relaxing source validation. Search buckets, counts, locators and all eight
hydration shards are generated before descriptor binding. Two focused desktop
browser cases passed in the isolated checkout: cancellation closes the real
unfinished HTTP response and permits a fresh search; eight valid shards retain
all matches with at most four simultaneous requests. Scoped ESLint passed.

The same CI run also found an actual preview delivery regression: the new
sample loader requires `checksums.json`, while the preview allowlist omitted
it. The build now includes the original complete checksum descriptor (hashes,
not full orbital shard bytes), binds that descriptor to the original source
content identity, and continues to hash each copied artifact. Four focused
preview-delivery cases passed, including changed/incomplete descriptor rejection.
An independent preview build with eight original input artifacts from the
pinned local release passed both desktop and mobile real-sample scenarios;
their no-full-shard-download assertions remain enabled. No deployment occurred.

At the latest inspection, iOS job `107500839484` in run `35958101923` was still
executing its native UI step; Android succeeded. Preserve this live run until
the iOS result is available rather than cancelling it with a replacement push.

Commit `5c8b39c` closes the catalog streaming library dependency set (source
metadata/hash binding, bounded source cache and append receipts, upload-order
lookup, retained block epochs, spatial bounds). The independent checkout at
`82a751a` plus exactly those files passed app TypeScript checking and 44 focused
cases across streaming, append-state and spatial selection. Scoped ESLint and
staged whitespace checks passed. A new build in that checkout passed four
desktop browser scenarios: expanded snapshot/context restoration, source H
filtering and empty index exclusion, corrupt expanded-index/sample recovery,
and zoom/detail changes without source reloads. These are not whole-suite or
native acceptance evidence. Worker/UI integration remains separately dirty.

The spatial checks exposed a real under-budget display defect: a grid sized
from the small uploaded count collapsed distinct visible rows in the same cell.
When count is within the display limit, selection now retains all visible rows
using bounded source-row slots. Over-budget snapshots still select spatial
representatives. Added cases cover collocated/focused rows and equivalence of
indexed versus direct selection across rotations, partial blocks and invalidation.

Run `35958101923` on the earlier `82a751a` is still active; desktop and mobile
Chromium jobs have failed while iOS remains active. Do not push another batch
until its remaining native result and browser failures are reconciled.
The completed desktop job log identifies three failing scenarios: corrupt
expanded source (already corrected in `5c8b39c`), cancelled name search, and
bounded parallel shard hydration. The latter two create/replace search buckets
after `installMockCatalog` has bound the descriptor; the hydration case also
invents shards beyond its three-row manifest. Rebuild those fixtures with valid
source descriptors and locators before judging transport cancellation or
concurrency. Their current zero-request failures do not measure those behaviors.

Commit `82a751a` changes iOS fixture staging to the independent Files local
provider, in a new `Solar Gaia Fixtures` folder, with unique provider lookup,
owned-device path validation, symlink rejection and original-byte comparison.
The UI continues to use the production system picker and unchanged calculation
assertions. Ten focused `ios-native-smoke` script cases and scoped ESLint passed;
these do not establish that iOS bookmark resolution is repaired. The cumulative
committed batch was pushed to `codex/scientific-audit-batch-20260924` and run
`35958101923` is in progress at exact head
`82a751a94026da684a397ac8ce0aefb5cbdf0740`. Main has not been advanced.

Two dirty-worktree desktop browser cases passed after correcting their scope:
H source filtering examines all three fixture shards (compact H is not the
authoritative source), while exact Float64 semi-major-axis exclusion still
avoids all binary reads for the empty selection. The corruption case now
damages only the expanded index rather than the common checksum descriptor,
so its independent-sample recovery assertion is meaningful. Both cases reused
the previously built dirty application; this is not clean-head CI evidence.

Related simulator fixture guidance:
https://developer.apple.com/forums/thread/787297 describes Files local-storage
workarounds for simulator import limitations; it does not prove our failure's
root cause or that the proposed fixture change succeeds on this runtime.

Further inspection of the iOS provider artifact narrows the remaining failure:
at 04:44:44.380 DocumentManager reports `did pick urls` for the staged
`Documents/manifest.json`. At 04:44:45.853 the app's file-provider bookmark
resolution fails with `NSFileProviderErrorDomain -1005` and underlying resolver
error `-1012`; DocumentManager then refuses to deliver an empty URL array.
The earlier `Attempting to open it? false` line does not mean the tap missed:
subsequent delegate selection proves that the system accepted it. Do not change
the tap target or weaken the dismissal assertion based on that line. The
remaining investigation concerns simulator document-provider materialization
and fixture/container lifecycle; the root cause and repair are not yet proven.
No tests were rerun for this log-only investigation.

Loader integration is now committed as `dc0d421` with only its provenance type
field staged from the broader dirty types file. The detached checkout passed
app TypeScript checking and 28 focused loader/search/provenance/integrity cases.
Browser fixture descriptors were separately committed as `5018c66`; its detached
build and two browser cases (lazy sample loading and real context restoration)
passed. Broader streaming implementation and browser tests remain dirty.

CI run `35956120579` has now completed **failure**, not an ongoing wait. All Web,
browser and Android jobs passed. iOS executed seven selected tests with one
failure: `testOriginalGaiaFilesThroughSystemPickerAndLiveBackend`, line 144.
The picker showed `manifest.json, json`; its image was not reported hittable,
so the test tapped the cell. The File View remained open for the ten-second
dismissal expectation. Lifecycle logs show import requested/presentation true
but no import completion callback. This locates failure before scientific
calculation; its cause is not yet proven. Downloaded artifacts are under
`.cache/ci-35956120579-ios/`, including `xcode-test.log`, lifecycle/provider logs
and the xcresult bundle. The aggregate gate correctly failed; main was not
updated, and no retry or protection bypass has been performed.

Local commit `b901350` contains immutable transport/cache ownership, bounded
validation copies and optional persistence, plus typed HTTP failures. The cache
delivery suite passed 10 cases after adding a validator-transfer regression;
the six adjacent cache contract cases had also passed. The old concurrency case
was updated to distinguish four acquisition leases from two validator-copy
leases and still checks coalesced transport and cancelled queue exclusion.
Transferring a validator's owned buffer rejects that consumer without detaching
its sibling's result or issuing a duplicate download. All three changed files
passed ESLint and diff checks. These scoped cases do not prove every IndexedDB
quota/transaction timeout in a live browser. CI for the earlier staged head
remains separate; no main push or deployment was performed here.

Catalog integrity helper commit `97d1b9a`: 5 focused tests passed for descriptor
tamper/missing-artifact rejection, cancellation, duplicate/mislocated identities,
altered index labels, invalid elliptic rows and summary identity/coverage ownership.
The three standalone validators and test passed ESLint; the loader integration
remains dirty and is not included in this helper commit.

Loader integration check: `catalog-loader-cache.test.ts`,
`catalog-sample-ownership.test.ts` and `catalog-search.test.ts` passed 18 cases
after repairing three obsolete fixtures (lookup bucket partition, valid recovery
metadata and a complete release pointer). The initial run failed these three
cases; production validation was not relaxed. The cache fixture changes passed
ESLint and remain uncommitted with the loader changes. iOS CI evidence refers to
the simulator workflow using real source data, not physical-device acceptance.

Two additional independent local commits: `3c2cbae` contains owned time-scale
source receipts and the direct UTC/leap-difference TT interval used in catalog
displacement bounds; `2ecaf8e` contains terminal upload-ACK deadlines. The former
passed 15 focused cases across temporal budgets, catalog time scales and apparent
time conversion, including exactly representable intervals around the 2017 leap
boundary and both rounded/direct TT bounds. The leap increment was checked
against NAIF's `naif0012.tls` (36 -> 37 seconds at 2017-JAN-1). The latter passed
6 transfer-window cases, including a late ACK arriving before its delayed timer,
timeout of a partial window and rejection of further publication after failure.
Both groups passed changed-file ESLint. They have not been included in CI head
`38bd007e6427` or pushed to main.

Latest observation of CI run `35956120579`: repository/Web, all four browser
projects and Android passed. iOS job `107494900117` was still running its real-SPK
HTTPS UI step (started 04:37:01 UTC). The required aggregate gate is not yet
confirmed; this is a live running job, not an assumed stalled process.

Large-tier profiling: the benchmark now optionally writes `--cpu-profile` CDP
main-renderer samples and records long-task start/duration rather than durations
alone. In `.cache/catalog-stream-20260924-profile-1m.*`, the final 150 ms of
samples was dominated by `getError` (115.4 ms in the largest sampled node), not
the source-row loops. Worker/GPU execution is not covered by this profiler.
`CatalogStreamCanvas` had a pre-draw `checkGl` followed immediately by the
renderer draw's own GL check for both point uploads and spatial-index uploads.
Those redundant pre-draw checks were removed; post-draw errors still prevent
ACK/presentation publication. A new injected GPU-error browser case verifies
that failed uploads produce an error, zero upload ACKs and no source export.
That case plus append/export and actual context-restoration passed 3/3 on desktop
Chromium after the final change. Build and diff checks passed; scoped ESLint had
zero errors and the same three existing hook-dependency warnings.

One profiled before/after pair for the initial point-upload change observed
5,553.5 -> 5,112.8 ms loading and 1,248.9 -> 799.3 ms sampled `getError` time.
These single runs include profiler overhead and do not establish a stable speedup.
The final unprofiled combined-check run loaded 1,000,000 real-source rows in
5,120.5 ms with no GL errors or rotation reuploads, but retained a 78 ms final
long task. Synchronous driver stalls are therefore **not resolved**; this evidence
does not justify dropping post-draw error/ACK validation. The report is
`.cache/catalog-stream-20260924-combined-check-1m.json`. These changes remain part
of the uncommitted streaming integration, outside CI head `38bd007e6427`.

Committed-state isolation: a detached checkout at `38bd007e6427` passed app
TypeScript checking, `npm run build` including artifact verification, and 29
targeted cases across cache/admission/bounded delivery and point geometry/tiles.
Its tracked tree stayed clean. This rules out dependence on the primary dirty
tree for these checks; it does not validate every preceding scientific change.
The direct main push was rejected by the required `Pull request quality gate`.
The exact commit was pushed to `codex/scientific-audit-batch-20260924`, without a
PR, for run `35956120579`. The last observed run was in progress; main still
pointed to `c3b87f736f47a2a182752b2c02bdc2a199b4f961`. Both deployment and dataset
publication workflows were disabled; Pages used the separate `gh-pages` branch.

Current dirty-tree real-source capacity runs used a freshly rebuilt application,
MPC release `mpcorb-26bbcb75e45b7cbb-full` (1,561,171 rows / 313 shards), Chromium
151 and a 1600x1000 viewport. Reports in `.cache/catalog-stream-20260924-current-*`
retain source/implementation/built-asset hashes and screenshots. Hardware runs
identified NVIDIA GeForce RTX 5070 Ti through ANGLE D3D11:

| Loaded source rows | Load ms | Submitted representatives | Attribute bytes | Main-thread long tasks |
| --- | ---: | ---: | ---: | --- |
| 100,000 | 690.5 | 15,986 | 2,800,000 | 0 |
| 300,000 | 1,668.8 | 20,828 | 8,400,000 | 0 |
| 1,000,000 | 5,490.9 | 29,582 | 28,000,000 | 1, 76 ms |
| 1,561,171, explicit 512 MiB budget | 8,669.9 | 33,119 | 43,712,788 | 1, 99 ms |

All four completed their requested tiers with no observed page/GL errors;
12 rotation steps added no source requests, allocations or attribute uploads.
The initial full-inventory attempt at the default budget was correctly limited
to 1,144,103 rows, contradicting the benchmark's full-completion expectation;
its failure artifact was preserved. The benchmark now accepts `--budget-mib`
and records the actual selected budget rather than relying on the UI default.
The separate 30,000-row run used SwiftShader and is not hardware evidence.
The 300,000-row cancellation probe observed worker settlement 1.7 ms after
request, zero later attribute uploads and zero pending browser/server requests
after a one-second quiet interval. These are local HTTP, single-epoch capacity
measurements, not physical FPS, sustained epoch playback or process/GPU RSS.
The 76/99 ms long tasks require profiling before claiming responsive large-tier
loading. This capacity evidence applies to the dirty build, not the staged CI
commit, and does not replace scientific accuracy or native acceptance.

Additional cache/admission execution: `shared-catalog-cache.test.ts` passed 4
cases after a new failure-cleanup test first reproduced early batch rejection
while sibling consumers were still active. `catalogForEachBounded` now drains all
active consumers after signalling cancellation and preserves the initiating
failure. The weighted-cache test checks LRU eviction, oversized-value bypass,
owned configuration and clear/reload behavior. Local commit `1967b6c` includes
the self-contained cache module and these cases.

`catalog-admission.test.ts` and `bounded-catalog-delivery.test.ts` passed 12 cases,
including queue saturation/cancellation, deadline rejection before timer delivery
and holding the reader until asynchronous source cancellation completes. These
four files passed ESLint and are in local commit `38bd007`. No full local suite
ran. Remote `Deploy application` workflow was read as `disabled_manually` before
considering a batched push; no push was performed in this execution. The branch
is 43 commits ahead of the last locally known `origin/main`; this is not a fresh
remote-ref comparison or proof that the entire committed batch is validated.

Browser integration: the two targeted catalog scenarios passed on desktop and
mobile Chromium (four project/case combinations): expanded source loading with
actual WebGL context loss/restoration, and two manual selected-body appends.
The latter verifies 1 -> 2 -> 3 uploaded rows, exhausted-slot disabling, a single
compact-index request, zero WebGL error and a normally clicked JSON export with
acknowledged addition start rows 1/2 and selected uploaded rows 1/2. The synthetic
fixture now hashes metadata, samples and summary into the manifest descriptor,
reports actual magnitude/range coverage and supplies source locators.

The export interaction exposed a real layout bug: long absolute-positioned
status content intercepted clicks on the export button. A bounded, scrollable
overlay now contains status and export controls in normal flow; the context-loss
notice remains outside it. Both browser configurations passed after this fix.
The current application build and `git diff --check` passed. Changed-file ESLint
reported zero errors and three existing hook-dependency warnings in
`CatalogStreamCanvas.tsx`; these warnings are not claimed resolved. This is
synthetic browser integration evidence, not full-catalog throughput, frame-time,
RSS or independent physical-accuracy acceptance. These integration changes remain
uncommitted with their broader source dependencies; no push/deployment occurred.

`catalog-streaming.test.ts`, `catalog-transfer-window.test.ts` and
`catalog-relative-geometry.test.ts`: 36 tests passed after three stale assertions
were reconciled with source metadata screening, spatial-index byte reserves and
terminal transfer failures. This covers the synthetic cache/read/cancellation
cases and CPU-side point attribute upload ranges. It does not establish browser
GPU behavior, frame timing, RSS, real full-catalog capacity or scientific accuracy
outside these cases. No full local suite was run.

Changed-file ESLint passed for `pointGeometry3d.ts` and the three named test
files. Local commit `40312f8` contains only live-prefix point uploads and their
geometry regression case; the streaming/transfer fixture revisions and broader
worktree changes are not included in that commit. No push or deployment occurred.

Additional targeted execution: `catalog-append-state.test.ts` and
`catalog-temporal-budget.test.ts` passed 9 cases covering repeated-shard row
ordering, staged/wrong/cancelled ACK mappings, block-epoch reconciliation,
cancelled computation recovery and temporal displacement. The append/epoch
modules and their tests passed changed-file ESLint. These are direct helper
tests, not main-thread/worker/GPU handshake acceptance.

`catalog-point-tiles.test.ts` and `catalog-points.test.ts` passed 10 cases.
The new cases compare bounded offset tiles against circular quarter-orbit
geometry in both dimensions, preserve source coefficients and reject invalid
range/capacity before writes. Changed-file ESLint passed. Local commit `715fd68`
contains only the bounded Float64 tile implementation and its new tests; the
larger append integration remains uncommitted. No push or deployment occurred.

Append-batch execution found a genuine receipt-binding gap: a selected bit could
point beyond a shard's examined prefix after a capacity stop. The negative case
failed before the fix. `checkCatalogAppendReceipt` now requires every selected
row to be below `examinedRows`; after the fix, `catalog-streaming.test.ts` and
`catalog-append-state.test.ts` passed all 37 cases. Positive additions cover
priority-shard order, capacity omissions and metadata-rejected empty batches.
Changed-file ESLint passed for batch preparation, append/read receipt checking
and the streaming tests. This proves the exercised helper contracts, not the
browser upload/ACK lifecycle or real-source capacity.

Application type checking (`tsc --noEmit -p tsconfig.app.json`) initially found
12 diagnostics in four files. Explicit class property assignments replaced
parameter-property syntax forbidden by erasableSyntaxOnly, the covariance
provider snapshot now retains the complete provider interface, and a declared
never-returning function allows event evidence to narrow without assertions.
The same application type check then passed. Two shared-cache tests also passed.
This is compilation and narrow cache evidence, not scientific validation of the
covariance/event changes or a full local test run.

## 1. Gaia loading and graphics lifecycle

Relevant source: `gaiaCache.ts`, `gaiaChunks.ts`, `gaia.worker.ts`, `GaiaSky.tsx`,
`GaiaPlot.tsx`; checkpoints 523–526, plus their prerequisite changes.

- Mismatched cached length must evict before copying; same-length hash corruption
  must fall back to source reading without being counted as a hit.
- Direct local reads must retain size/hash/content checks and begin only after
  byte/row admission. HTTP reads must retain their transport checks. Read/cache
  counters must partition verified chunks and bytes under the updated semantics.
- Sibling failure, cancellation and timeout must settle pending GPU acknowledgement
  waits, remove listeners/timers and release reservations without a false completion.
- Initialization, upload, resize/zoom draw and context-loss failures must dispose
  graphics resources and invalidate results. Queued resize callbacks after disposal
  must not draw; successful retained caches must remain bounded and reusable.
- Source inspection cannot prove browser allocation or cancellation timing. Later
  evidence must separate encoded cache, active source buffers, decoded objects,
  transferred display arrays and GPU/driver storage, including local-file loads.

Existing focused locations: `gaia-cache.test.ts`, `gaia-chunks.test.ts`,
`gaia-schema-v2.test.ts`; browser `gaia-sky.spec.ts`, `gaia-capacity.spec.ts`.
Their existence does not establish coverage of the new paths or passing results.

## 2. Import cancellation and acceptance deadlines

Relevant source: conic, orbit uncertainty, dynamics and occultation laboratories;
`sbdbConic.ts`, `sbdbConicExperiment.ts`; checkpoints 527–530.

- Cancel, replacement and unmount must suppress stale success and error publication.
  Old finalizers must not clear a newer operation's timer or busy state.
- File/module completion and digest completion arriving after the monotonic deadline
  must be rejected even if the timer callback has not run. Parse/Base64 completion
  must be checked before installing imported inputs.
- Normal completion must clear timers and preserve source evidence. A timeout must
  leave incomplete imports unavailable and permit a new operation.
- Distinguish acceptance deadlines from synchronous preemption: JSON parsing,
  coordinate conversion and an already-started WebCrypto digest are not interruptible
  by the added boundary checks. Do not report a hard responsiveness bound.

Existing browser locations include `conic-laboratory.spec.ts`,
`orbit-uncertainty.spec.ts`, `dynamics-laboratory.spec.ts`; helper unit cases alone
cannot establish React lifecycle behavior.

## 3. Covariance input and scale handling

Relevant source: SBDB covariance parsers/binders in TypeScript, Go, Android and iOS;
sampling and ellipsoid factorization; checkpoints 531–534 and 536.

- Decimal syntax must admit supported signs/fractions/exponents and reject radix,
  suffix, separator, missing and nonfinite inputs. Verify real source fixtures and
  list boundaries at 64/65 entries without silently truncating scientific axes.
- Verify very different standard-deviation scales, transpose consistency,
  representable subnormals, zero variance and invalid pairwise bounds. Compare
  against an independent higher-precision calculation, not only the same formula.
- Solution-epoch coordinate conversion now has a generator-hash-bound 80-digit
  mpmath reference for 16 cases, including source-hashed Eros and Bennu covariance,
  threshold-adjacent, parabolic and hyperbolic cases, plus actual Borisov nominal
  elements with an explicitly synthetic covariance. The independent suite checks
  state, Jacobian and covariance pushforward and its 20 focused assertions pass.
  This closes only the solution-epoch arithmetic comparison for these cases; it
  does not validate decimal-source rounding across runtimes or temporal propagation.
- Distinguish source decimal conversion loss from intermediate arithmetic loss.
  Rounding, underflow and whitespace behavior require explicit cross-runtime cases;
  aligned regular expressions do not establish complete numeric equivalence.
- Sampling v2 must preserve the declared seed/draw order while recording arithmetic
  changes. Do not relabel historical v1 outputs as v2 or claim bitwise compatibility.

Existing focused locations: SBDB covariance, covariance sampling, ellipsoid,
projection and conic unit files. Native/backend acceptance must be demonstrated
separately from browser fixtures and from receipt metadata checks.

## 4. Live dynamics receipt rejection and faithful acceptance

Relevant source: `dynamicsReceipt.ts`, `integrationReceipt.ts`,
`covariancePushforwardReceipt.ts`, `sbdbReceiptBinding.ts`; checkpoints 535–543.

- First establish acceptance of real current producer receipts for direct dynamics,
  covariance, ensemble and event ensemble, forward/backward/zero durations, with
  and without requested refinement. Sparse or nonfinite arrays must be rejected.
- Mutate one item at a time: sampling interpretation, frame/units/axis order,
  adopted GM, initial Jacobian, square-root factor, matrix, marginal sigma,
  transition entries/layout, Sun states, endpoint and osculating diagnostic.
  Each inconsistent receipt must fail before visualization/export.
- Check counters against the producer: attempts = accepted + rejected, nonzero
  derivative evaluations = 1 + 6 × attempts, actual elapsed time = requested time.
  Zero duration must retain initial state and identity transition with no steps.
- Refinement differences must match the returned endpoint/transition arrays.
  Factor pushforward and heliocentric conversion must match their declared inputs.
  Exact comparisons apply to the current same-runtime worker path, not arbitrary
  archival or cross-runtime receipts.
- Measure the main-thread acceptance cost for maximum retained data, including
  reconstruction and per-node diagnostics. Bounded loops alone do not demonstrate
  acceptable latency. These consistency checks still do not independently verify
  SPK states, force integration or physical uncertainty.

The source search performed for this inventory did not find direct references to
`checkIntegrationReceipt`, `checkCovariancePushforward`, `acceptedStepIndices` or
`coordinateTransform` in the selected dynamics/Gaia/covariance/ensemble unit files.
This is a scoped search finding, not proof of absent indirect coverage. Coverage
must be inspected and completed before the deferred execution stage.

## 5. Trajectory provenance and full-goal acceptance

### Known catalog fixture incompatibility (source inspection, 2026-09-24)

Source inspection found `tests/unit/catalog-streaming.test.ts` incompatible with
the current producer contract: its fixture omitted manifest `contentSha256` and
source metadata files, and a case asserted that no metadata was fetched. Current
`bindCatalogChecksums` requires a descriptor-bound content identity and
`loadStreamMetadata` checks each source shard. Several result assertions also
required exact equality with only sourceRows/drawnRows/complete, omitting current
screening, selection, speed and application-read evidence. The four-prefetch
assertion also omitted the current separate active-compute slot.

Checkpoint 591 edits add explicit synthetic metadata/content descriptors,
separate intentional priority flag changes from rehashing, retain corruption
cases, and assert completed read bytes and selected masks. Prefix result checks
coexist with exact new-evidence assertions. Prefetch admission now expects four
queued shards plus one active input; the stalled-body case still expects four.
Timeout recovery switches back to real timers before its cooperative reload.
Name search without locators now exercises source metadata matching. Budget
assertions distinguish constrained 256 MiB admission from 512 MiB full admission.
These are unexecuted test-source revisions: neither correctness nor passing
results are established. Verify the cases before relying on them as evidence;
production checks and scientific tolerances were not relaxed.

Additional unexecuted cache cases now cover same-source index/binary reuse with
changed magnitude filtering and fresh metadata reads, exact read counters and
frozen accounting, explicit clear, changed content identity, and metadata hash
failure followed by uncached recovery. They use three synthetic circular rows,
not real network/throughput/memory evidence. Further unexecuted cases inject
caller cancellation after capacity-triggered prefetch abort while a fetch is
still draining, then require an uncached recovery. A held-upload case checks
concurrent cache-lease rejection without destroying the owner's eventual cache.
Concurrent explicit invalidation remains a separate pending case; these
additions do not establish coverage of the full cache or worker lifecycle.

### Remaining acceptance work

Relevant source: recorder, worker, browser and offline writers; checkpoints 544–545.

- Verify index/sample alignment before, at and after each capacity/stride boundary,
  final-node replacement, reverse time and zero duration. Confirm immutable saved
  artifacts retain their historical meaning and current exports retain added fields.
- Check plots/readouts explain accepted-step spacing and variable time spacing.
  Confirm no UI interprets decimated samples as continuous extrema or event absence.
- Source-only tracing found full-result spreading/serialization in current workers
  and offline direct/covariance writers; execution and actual exported artifacts
  are still needed to establish delivery.
- Return to every workstream in the main ledger: SPK/mission analysis, SOFA/IERS,
  SBDB, occultations, dynamics, source coverage, catalog streaming, rendering/time
  and real 30k/100k/300k/1m/full-inventory capacity evidence. This supplement does
  not resolve those outstanding implementations or their independent reference gaps.
- Catalog selection following (checkpoint 547): unchanged lists must not reload;
  rapid selection changes must coalesce; stop, unmount, changed filters and manual
  refresh must invalidate old timers. Verify the 256-object focus-first limit,
  preserved initial epoch and resource budgets, filter exclusions, access denial,
  worker/GPU disposal and visible reload behavior. Measure repeated-reload cost;
  this path does not yet provide incremental admission without clearing the view.
- Exact catalog scratch sizing (checkpoint 548): compare output/source masks for
  zero, sparse, full and capacity-limited admission, including reserved priority
  rows across shards and a partial final byte. Confirm Float64 source order and
  appearance transfer ownership, cancel during gathering, and measure both sparse
  allocation reduction and dense-path cost before claiming a performance gain.
- Uploaded-membership reuse (checkpoint 549): changing focus/order/subsets entirely
  within checked uploaded masks must update display without loading; missing rows
  must still schedule loading. Empty selection must retain the snapshot. Stale
  completion, old callback cleanup, retry, stop and manifest/filter changes must
  never use a prior request's masks. Confirm export distinguishes actual load-time
  priority from the current display selection, including after reuse.
- Rank lookup reuse (checkpoint 550): compare against the existing scan helpers
  for reordered shards, duplicate locators, missing rows, empty masks, final partial
  bytes, and both sides of every 256-byte prefix boundary. Confirm source evidence
  replacement discards the old lookup, borrowed masks stay immutable, and capacity
  reflects the added prefix/map reservation. Measure initial construction and
  repeated focus/multi-selection cost separately before claiming responsiveness.
- Exact-epoch reuse at zero drift (checkpoint 551): tighten a mixed-epoch snapshot
  to zero, retain only blocks already at the target epoch, and recompute every
  other or invalidated block. Compare exact coordinates and row/block evidence
  with full recomputation; cover forward/backward time, stale ACKs, cancellation
  and unknown speed caps. Reject different epochs claiming zero displacement and
  equal epochs claiming positive displacement in reuse and final receipts.
- Catalog redraw failure (checkpoint 552): cover drawArrays/drawElements and
  incoherent-frame clear errors without new attribute uploads, including resize,
  camera changes and context restoration. Both canvases must dispose/mark failure;
  streamed display must not claim presentation or preserve usable failed evidence.
  Measure the GL error-query cost separately on target devices. Source inspection
  of cancellation paths is not execution evidence for mixed-frame rejection.
- Single-priority preflight handoff (checkpoint 553): verify one metadata read and
  at most one binary read for the sole first priority shard, with and without a
  name query. Cover metadata-only rejection, excluded priority rows, corrupt
  nonpriority binary rows, cancellation before handoff, multiple priority shards
  and capacity exhaustion. Compare exact source masks/coordinates with the former
  path and measure memory lifetime; the optimization must not bypass full source
  validation or exceed the original prefetch/metadata reservations.
- Per-selection export mapping (checkpoint 554): missing entries before/between
  present entries must keep explicit nulls, while uploaded row zero stays zero.
  Check duplicate locators and reordered selections, and confirm the compact
  renderer row list equals exactly the non-null entries of selectedSourceRows.
  Export consumers must not zip selectedSources with the compact row list.
- Cancellation versus automatic follow (checkpoint 555): cancel/fail before a
  debounce timer fires and after it queues a state update; neither may restart
  the stopped request. Late source completion must not resume following. Both
  explicit canvas reload actions and workspace refresh must restore following,
  while old request callbacks cannot stop a newer request. Check that ordinary
  selection changes do not change the load-effect callback identities.
- Committed request ownership (checkpoint 556): deliver old stop/resume/source
  callbacks after replacement or inactive filters, and fire a timer after a new
  selection commits but before passive cleanup. None may alter the new request,
  install stale masks or reload obsolete priorities. Include unmount, abandoned
  renders and old evidence cleanup following new evidence installation.
- Osculating timescales (checkpoint 558): independently compare elliptic period
  and apoapsis against NAIF OSCLTX/reference conics, including near-circular,
  near-parabolic, radial, unbound and extreme-scale states. Cover zero/reverse
  integration duration and undefined initial periods in the UI. Current producer
  receipts/exports must include the new fields; old results must not be relabeled
  as current. A duration/period ratio does not establish completed revolutions,
  resonance, continuous extrema or long-term stability.
- Exported timescale comparison (checkpoint 559): accept genuine current direct
  and covariance experiment receipts, reject changed duration/initial period/ratio/
  method fields, and compare the UI with exported diagnostics.timescaleComparison.
  Cover zero and reverse duration, undefined periods, overflow and positive-ratio
  underflow. Same-helper reconstruction is consistency evidence only; independent
  reference comparisons remain required.
- Covariance nominal diagnostics (checkpoint 560): confirm the shared panel uses
  the same nominal experiment retained in exported JSON, in both languages and
  with/without numerical refinement. Verify the equatorial/ecliptic distinction
  and undefined derived values, and ensure nominal period/range values are never
  labeled as propagated uncertainties or ensemble distributions.
- Formal period projection (checkpoint 561): compare analytic derivatives and
  correlated-factor projection with independent high-precision calculations;
  cover rotations, zero/rank-deficient covariance, circular/near-parabolic/unbound
  states, extreme scales and invalid inputs. Check baseline/refinement receipts,
  field mutations, implementation hashes and UI null/boundary handling. Distinguish
  linear formal sigma from nonlinear distributions and model/GM uncertainty.
- Projection status and arithmetic (checkpoint 562): independently exercise
  signed cancellation, nonzero-product underflow, derivative underflow, overflow,
  true zero covariance and rank-deficient zero projections. Verify the exported/UI
  reason distinguishes undefined conics from numerical range failures; a finite
  bound orbit with an unrepresentable axis/period must not become nonelliptic.
  Compensated summation and detectable underflow checks do not establish accuracy.
- Period refinement display (checkpoint 563): verify one/two-column behavior,
  different statuses/nulls per column, genuine zero values, refined-only boundary
  flags, translated labels and narrow-screen table access. Values must match the
  baseline/refined exported records without triggering another integration.
- Derivative units/availability (checkpoint 564): independently verify position
  and velocity gradient units, Cartesian ordering and C = B B^T orientation.
  Unrepresentable nominal inverse axes must leave gradients/sigma/boundary flags
  null; distinguish exact/near-parabolic classification from numerical underflow.
  Mutated gradient metadata must fail current live receipt binding.
- Solution-epoch period uncertainty (checkpoint 565): compare initial factor and
  derived quantities with independent source-coordinate propagation, including
  rank deficiency and source symmetrization tolerances. Check initial/baseline/
  refined columns and signed TDB durations; zero duration can retain floating-point
  frame-conversion differences and is not convergence evidence. Verify initial
  factor/derived record mutation rejection and complete exported JSON.
- Factorization diagnostics (checkpoint 566): independently assess normalized
  transpose averaging, factor reconstruction and direct source-unit transformation
  for strongly scaled, nearly singular and asymmetric-within-tolerance inputs.
  Confirm unchanged v2 draws, original source preservation, finite diagnostic
  output and mutation rejection in all three receipt paths. Residual agreement
  alone must not be treated as physical or numerical accuracy acceptance.
- Shared factorization panel (checkpoint 567): verify covariance, endpoint
  ensemble and event-ensemble pages display the same checked factorization fields
  in both languages and preserve them in real JSON exports. The panel must not
  trigger another sampling/integration job or label residuals as physical accuracy.
- Event timing dispositions and dense receipt vectors (checkpoint 568): verify
  per-direction selections and exclusions partition all draws, preserve genuine
  zero event times, and distinguish failed, unresolved and not-detected draws.
  Check bilingual reasons, one-based display versus zero-based exports, and draw
  buttons selecting the matching detail panel. Sparse arrays, including entirely
  empty tolerance slots, must fail receipt validation; dense finite vectors must
  preserve their values. These checks are deferred, not executed.
- Event midpoint binding (checkpoint 569): reject received and direct-summary
  event times altered within unchanged localization brackets. Verify producer
  compatibility for collapsed zeros, positive and negative windows and rounded
  midpoint endpoints. Check selected event numbers match the detail table and
  exported zero-based indices. No checks in this entry have been executed.
- Event scan-grid receipt binding (checkpoint 570): check positive, negative and
  zero-duration windows, final-endpoint rounding, and the 2,048 evaluation cap.
  Mutations of actual maximum spacing, off-grid/nonadjacent brackets, duplicate
  scan slots, sign changes after sampled zeros and inconsistent endpoint zero
  records must be rejected. Confirm failed/unresolved draws remain admissible
  without completed scans. No runtime or mutation checks have been executed.
  Receipt agreement must not be reported as event completeness or accuracy.
- Sealed epoch-store extension (checkpoint 572): after protocol integration,
  check append ordering, coefficient ownership, fixed row/block capacity and
  rejection during compute. Invalid input must leave count and old coefficients/
  epochs unchanged; valid appends must preserve mixed and unknown old epochs and
  participate in subsequent recompute/reuse accounting. Cover zero-row appends,
  cancellation/ACK ordering and failed GPU admission. The new method currently
  has no worker caller and is not end-to-end delivery evidence.
- Repeated-shard append mapping (checkpoint 573): after integration, compare
  base and appended GPU identities across interleaved shards and out-of-order
  source rows. Reject duplicate bodies, changed hashes/mask sizes, wrong start
  rows and row-capacity/256-addition overflow without partial mapping changes.
  Verify index zero remains selectable, new-shard identity persists across
  batches, source buffers may be released after admission, and overlay storage
  is budgeted. The module has no runtime caller yet; no checks were executed.
- Append mapping acknowledgement (checkpoint 574): verify prepared rows stay
  invisible until a matching commit, cancellation/mismatch releases the slot,
  only one batch can be pending, and duplicate/stale commits cannot publish rows.
  A stale cancel must not cancel a newer batch. Confirm staged storage is released
  on every terminal path and actual GPU/epoch failures never publish the mapping
  once the protocol is connected. No runtime checks have been executed.
- Append budget admission (checkpoint 575): check zero-reserve equivalence,
  retained-epoch requirement, bounds 0..256, row-budget clipping and insufficient
  budget rejection. Initial rows plus reserved append slots must equal admitted
  total capacity without exceeding requested rows. Confirm all initial-loader
  capacity decisions use initialCapacity and planned epoch blocks cover repeated
  shard appends. Actual peak memory and object overhead still require measurement
  after integration; planner arithmetic is not capacity/performance evidence.
- Append batch preparation and candidate-shard pruning (checkpoint 576): verify
  real source/hash binding, frozen inputs, duplicate/bounds rejection, exact
  filters and priority membership, prepared/position/source-row correspondence,
  all-filtered and capacity-limited results, and cancellation without publishing
  partial batches. Compare pruned candidate scans with the previous full traversal,
  including empty candidates and final short shards. Measure actual memory and
  latency after worker integration; full index fetching remains in place.
- Worker append admission (checkpoint 577): after Canvas integration, exercise
  initial drain/seal gating, retained source identity, current epoch/start binding,
  concurrent epoch rejection, reserved-slot exhaustion and empty filtered batches.
  Check wrong/stale ACKs, deadline boundaries, transfer failure and cancellation
  before/after upload. No appended row may enter selection before matching ACK;
  partial failure must discard the snapshot consistently on both sides. Actual
  Float32 culling limits and retained Float64/epoch correspondence remain untested.
- Append receipt identity binding (checkpoint 578): reject substituted candidates,
  duplicate/missing/out-of-order shards, invalid final-shard mask padding, source
  hash changes and inconsistent screening totals/completion reasons. Cover fully
  filtered batches and partial-capacity screening. Confirm the future Canvas
  receiver invokes the same checks before GPU upload/ACK. Numerical positions
  and actual source-filter agreement require separate evidence; none was run.
- Canvas append reception (checkpoint 579): once the parent opts in, verify
  request/mask/epoch binding before upload, GPU checks before ACK and unchanged
  completion evidence before mapping publication. Exercise cancel/context loss
  at each stage, CPU restoration, repeated-shard selection, mixed old/new epoch
  blocks and changed target time during append. Inspect schema-4 exports and
  initial/total counts. Parent reload coordination and empty/rejected-attempt UI
  remain unfinished; no browser/GPU checks have been executed.
- Product append control (checkpoint 580): exercise opt-in/restart, matching
  parent/worker capacity, selected-first initial load and suppression of the old
  reload timer while append mode is active. Verify manual append, busy/no-missing
  notices, zero-filter results, exhausted slots, deselection, refresh and schema-4
  last-attempt exports in both languages. Follow the real source-to-GPU-to-epoch
  path; source wiring is not runtime or performance acceptance.
- Empty append and clock continuity (checkpoint 581): confirm zero additions
  restore the prior uniform/mixed epoch receipt without a forced epoch request;
  a genuinely newer target or tightened budget must still schedule needed work.
  Verify nonempty appends reconcile the new block layout, and rejected completion,
  cancellation or context-loss discard clears success notices/history. These
  are source-derived expectations; no runtime checks have been performed.
- Whole append deadline (checkpoint 582): cover slow source reads, cooperative
  compute, delayed ACK, stalled worker and delayed main-thread timer delivery.
  Responses crossing the 300-second boundary must not publish success even when
  a timer callback has not run. Verify abort propagation and timer cleanup on
  success/error/cancel/unmount; the separate 30-second ACK limit still applies.
  Subsequent epoch reconciliation is outside this deadline. No timer or runtime
  checks have been executed.
- Worker-local source-index cache (checkpoint 583): measure initial miss and
  repeated append hits with real artifacts, confirming metadata/binary checks
  still occur and changed manifests cannot reuse a prior index. Exercise busy
  rejection, oversized checksum-retention fallback, clear during fetch,
  cancellation and worker teardown. Verify no detached/mutable buffer exposure
  and actual retained memory against budget; source branches are not measured
  request savings, latency or memory evidence. No checks have been executed.
- Single binary-shard reuse and failure cleanup (checkpoint 584): verify exact
  source/path/hash/size hit conditions, one-entry eviction, invalidation during
  concurrent prefetch, non-abort failure cleanup and lease release. Confirm hits
  still validate source elements and metadata/filter agreement; measure retained
  bytes and overlapping reads against the added shard reservation. Runtime hit
  rate, memory and cancellation behavior have not been checked.
- Application-read evidence (checkpoint 585): compare real instrumented artifact
  reads with attempts/completions/failures/body-byte totals and worker-cache hits.
  Include capacity-stopped prefetch and abort before/during body consumption;
  counters must settle before result resolution. Verify initial and append export
  records and malformed accounting rejection. Do not equate these counters with
  wire bytes, HTTP-cache misses, network savings or throughput. Nothing was run.
- Prefetch finalization cancellation (checkpoint 586): cancel after a capacity
  result is selected but while an admitted read is still draining. Require
  promise rejection, frozen terminal accounting, cache invalidation and lease
  release; no done receipt may be published. Also cover exhausted success and
  existing failure paths. This is pending execution, not observed behavior.
- Spatial coordinate admission (checkpoint 587): cover initial, temporal and
  append uploads with finite Float64 values that overflow Float32, nonfinite
  input and invalid row layout. Require snapshot failure before tile publication
  or spatial selection; ordinary finite copies must preserve row ordering and
  index invalidation. No execution evidence is available yet.
- Point attribute upload ranges (checkpoint 589, superseding 588): confirm
  retained GPU updates upload only live components, with full capacity still
  allocated initially. Cover growth, shrink, empty selection, multiple writes
  before render and recolor followed by position-only update. Both point layers
  currently disable frustum culling; no stale-culling fix or speed is claimed.
- Catalog draw-count separation (checkpoint 590): confirm count-only changes
  leave coordinate/color attributes unchanged while updating visible draw count.
  Include simultaneous source/count changes, equal-length source replacements,
  reference-origin changes and zero count; the draw cap must survive each
  geometry rewrite. No runtime checks have been performed.
- Later evidence must identify exact source revision, source hashes, environment,
  execution scope and limitations. Plan focused checks once implementation is ready;
  do not execute now or substitute a full local suite for explicit coverage.

### Solar radiation pressure foundation — 2026-09-24

- Added focused SI/km conversion, inverse-square direction, additive force, independent finite-difference Jacobian with a nonidentity transition matrix, translation invariance, immutable parameter ownership, and source-versus-sample failure checks.
- Five cases pass in both the working tree and isolated committed-dependency checkout; focused ESLint passes. No full local suite was run.
- Model remains explicitly constant-parameter, outward radial and unshadowed; eclipses, attitude and parameter uncertainty are excluded. LLNL reference: https://software.llnl.gov/SSAPy/api/ssapy.accel.AccelSolRad.html .
- This commits only the standalone force foundation and sample-error type. DE440 integration, native delivery and whole-project scientific validation remain pending.

### DE440 radiation pressure and offline experiment delivery — 2026-09-24

- Commit ddd5f18 composes the optional radial SRP correction with pinned DE440 Newtonian and solar 1PN models. Eight focused source/integration tests pass in the isolated checkout. Parameter ownership before source hashing and actual force evidence are covered.
- Commit 770e567 connects explicit SRP adoption to offline experiment receipts, bounded cancellable file snapshots and no-overwrite atomic publication. Adds retained accepted-step indices, cloned run evidence, refinement statistics and initial osculating timescale diagnostics.
- Isolated dependency closure passed 37 focused tests, then 17 targeted tests after new yield/timescale/hash checks; the latter repeats relevant earlier cases, so counts are not additive. TypeScript app checking and scoped ESLint pass. No full local test suite.
- Independent epoch precision work in SPK/de440Dynamics remains uncommitted and was deliberately excluded from the tested committed dependency closure. Web worker/native SRP delivery remains pending.
- Current CI 35959897270 at 7ea5715 has Web, four browser projects and Android successful; iOS was still running at last observation. New local commits are not covered by that run and have not been pushed to main.
- Period applicability source checked: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscltx_c.html . Undefined/non-elliptic periods remain null; the duration ratio is not a physical revolution count.

### Split-epoch numerical correctness — 2026-09-24

- Confirmed a cancelling relative-time pair could shift the DE440 reference epoch by 1408 seconds. Normalizing relative components before reference addition fixes it.
- Confirmed direct SPK Type 2/3 split evaluation could select the wrong record for a large cancelling absolute-time pair. Error-free normalization before coverage and record-relative subtraction fixes it.
- Added analytic two-record fixtures for sub-ULP offsets, coverage edges, record boundaries and Type 3 velocity. Real pinned DE440 checks cover low-part cache identity, source-window enforcement and equivalent time representations.
- Isolated dependency closure: 27 targeted cases pass across five files; TypeScript app check, scoped ESLint and staged whitespace checks pass. No full local suite. Type 1 SPK and metadata-immutability changes remain separate and uncommitted.

### iOS retained-directory evidence and next batch — 2026-09-24

- CI 35959897270 finished: Web, all four browser projects and Android passed; iOS failed one of seven tests. Downloaded evidence to .cache/ci-35959897270-ios.
- ObservationUITests.swift line 141 expected an On My iPhone StaticText. The actual hierarchy resumed an empty Solar Atlas directory and exposed On My iPhone as the BackButton in FullDocumentManagerViewControllerNavigationBar. This disproves the prior assumption that Browse always opens Locations.
- Commit 1f7099d navigates that observed parent button, retaining the Locations fallback and all original file-import/result assertions. Swift runtime acceptance remains unverified until new CI.
- Batch through 1f7099d pushed to codex/scientific-audit-batch-20260924 for exact-head validation. No main push, deployment or release. Deployment and dataset workflows rechecked disabled_manually.

### SPK Type 1 reader and independent oracle — 2026-09-24

- Commit 46ca25c adds Type 1 browser parsing and immutable segment metadata. Type 1 tail/layout differs from Type 21; original descriptor type is retained.
- Independently generated 408 CSPICE N0067 states with SpiceyPy 8.2.0 across 1-record and 101-record synthetic Type 1 segments, including all record boundaries and adjacent representable times. Binary SHA-256: 01e9aa4711f37c711298bb7401511b4d57a0e04e2154d66cbd41d30361381878. Generator and source hashes retained in fixture.
- First oracle attempt exposed a real acceptance gap: Type 21 maximum-order-plus-one=16 fixtures overrun CSPICE Type 1 workspace. Failed binary retained at .cache/spk1-rejected-order16.bsp. Type 1 parsing now caps that field at 15; Type 21 remains unchanged. Synthetic fixture controls are explicitly adapted, not claimed as unchanged observed coefficients.
- Isolated checkout: 27 focused cases across Type 1/2/3/17/21 and split epochs pass; TypeScript and scoped ESLint pass. New Type 1 samples are parser/interpolation evidence, not admitted spacecraft coverage.
- Remaining: mirror the Type 1 order bound in pending Go reader, compare Go states, validate original/cropped spacecraft kernels and source pools, then scene admission. Go validateType21Record currently permits dimension+1 for both types and needs the original segment type in its validation contract.

### Go Type 1 and original Voyager crop evidence — 2026-09-24

- Commit 9f74f02 admits Type 1 in the Go reader, validates its epoch directory and enforces the Type 1 order bound. Both resident and 16-KiB paged readers agree with all 408 CSPICE fixture states; cancellation makes no reads/publications. Isolated selected Go tests pass.
- Prepared .cache/spacecraft-packs/audit-voyager-20260924 for ET [631108800,978264000] using both original official Voyager SPKs. Original hashes and source notes retained. Four crop files total 456704 bytes; no manifest admission or deployment. Preparation is still pending scientific/source acceptance.
- scripts/reference-spacecraft-pack.py compared independent CSPICE original and explicit cropped source pools at 2070 Voyager 1 and 2042 Voyager 2 epochs, including record boundaries, adjacent representable epochs and midpoints. All six original/crop CSPICE components agree exactly. Full reference retained in pack/cspice-reference.json.
- Project TypeScript comparison initially found a 1-ULP velocity difference between original/crop at ET 893678399.9999999. Scalar Chebyshev evaluation lacked boundary correction when the offset was zero. Commit b272c1e applies nearby-boundary selection to scalar epochs too, adds discontinuous analytic regression and Type 1 crop/footer checks.
- After the fix, project original/crop states agree exactly across all 4112 samples. Maximum difference from CSPICE is 4.440892098500626e-16 km/s in Voyager 1 velocity Z; other components and Voyager 2 agree exactly. Evidence: pack/typescript-comparison.json and .cache/verify-voyager-ts.mjs. Isolated 16 focused cases and scoped ESLint pass.
- This is sampled numerical equivalence, not physical trajectory uncertainty, historic center-transition acceptance, full Go real-source verification or scene admission. Original source tracking cutoff and caution notes remain applicable.
- User permits relaxing resource budgets. Apply larger loading/memory/compute budgets based on measured capacity; do not weaken numerical correctness thresholds or cancellation.

### Checkpoint 592: bind dynamics transition matrices to accepted worker receipts

Direct and covariance dynamics receipts now carry SHA-256 over each 36-entry,
row-major Float64 transition matrix encoded as canonical little-endian bytes. The
main-thread checker recomputes the digest for the primary matrix and any
requested refined matrix before accepting or exporting the result. This detects
matrix mutation between worker production and receipt acceptance; it is content
integrity evidence only, not independent integration-accuracy, force-physics or
physical-uncertainty validation.

Focused dynamics receipt coverage generated actual DE440 direct receipts both
with and without refinement, accepted unchanged results, and rejected isolated
changes to the primary matrix on both paths and to the refined matrix. The
focused file passed 3/3; app TypeScript checking and `git diff --check` passed.
No full local suite was run. Main-thread acceptance latency at maximum retained
trajectory size remains unmeasured.

GitHub triage found no open issues/PRs before this review. Issue #109 matches the
active science and scale goal, but real-hardware capacity/latency and independent
oracle acceptance are still unproven; it was reopened with this rationale. PR
#112 is closed without merge and was superseded by merged PR #111. All other
historical issues are closed and PRs merged. Local `main` is 70 commits ahead of
`origin/main`, with a broad dirty worktree; nothing was staged, committed,
pushed or deployed in this checkpoint.

### Checkpoint 593: independently validate parabolic and hyperbolic covariance conversion

The prior 80-digit oracle's true-anomaly root became ill-conditioned when
`mp.diff` perturbed eccentricity across exactly one. Its `1e124` derivative was
an oracle failure, not an application result; direct inspection showed the app
state remained consistent. The reference now uses a separate 80-digit
universal-variable root near `e=1`, cross-checks the exact parabolic state
against Barker's equation, and retains classical elliptic/hyperbolic formulations
outside that narrow boundary. CSPICE independently checks nominal states wherever
its conic routine supports them.

The 16 cases include both sides of the application's `e=0.9999` formulation
boundary, exact parabolic forward/reverse time, hyperbolic forward/reverse time,
and the source-hashed 2019 Q4 (Borisov) nominal orbit. Borisov's retained API
snapshot contains no covariance, so its covariance matrix is explicitly
synthetic and is not presented as observed uncertainty. The fixture binds the
generator SHA-256, software versions, real source hashes and fixed adopted GM.
Focused orbit-covariance validation passes 20/20, including finite-difference
free independent Jacobian/matrix agreement for all 16 cases. This is
solution-epoch coordinate conversion evidence, not temporal covariance accuracy,
source-fit uncertainty or physical trajectory validation. The complete local
test suite remains unrun.

### Checkpoint 594: align compensated epoch progress in Go dynamics

Source review found that the browser Dormand–Prince integrator checked the
compensated candidate endpoint, while the Go implementation checked the
uncorrected `elapsed + step`. Go now rejects nonfinite or non-advancing actual
candidate epochs, matching the browser rule. A focused Go regression covers
forward and backward sub-ULP steps recovered by the carried correction and
exact endpoint pinning. The browser guard also rejects nonfinite candidate
epochs.

The Go regression passed in `internal/orbituncertainty`; the focused browser
integrator file passed 9/9. These results validate the progress guard and the
existing browser integrator cases, not orbital-force accuracy, covariance
accuracy or full-system behavior. No full local suite, production build,
external CI or deployment was run for this checkpoint.

### Checkpoint 595: cross-runtime solar force reference checks

Added Go-side focused checks for the solar force models. The 1PN correction's
acceleration and all six position/velocity Jacobian columns match the retained
independent complex-step reference derived from CSPICE-prescribed DE440 states.
The radial SRP check independently evaluates the SI-to-km/s² vector expression,
checks inverse-square magnitude, and compares the state Jacobian against a
central finite difference. Both targeted Go tests pass. Browser 1PN/SRP force
and selected trajectory checks also passed 15/15 in the prior checkpoint.
This cross-runtime evidence does not validate full long-duration physical
accuracy, real spacecraft parameters, illumination/shadows, native delivery,
capacity or rendering performance. No full local suite or production build ran.

### Checkpoint 596: opt-in one-million-point spatial rendering

The D3D11 capacity harness failed before measurement because it served the renderer
but not its statically imported projection module. The harness now serves and
hashes that real dependency. Its standalone deterministic synthetic disk benchmark
completed on Windows with an NVIDIA GeForce RTX 5070 Ti using Chromium ANGLE D3D11.
At 1,000,000 points, 180 animation-frame intervals had P95 16.8 ms and P99
16.8 ms; draw-submission P95 was 11.4 ms. Upload-submission P95 was 25.9 ms,
and the synchronized initial upload took 59.2 ms. At 1,561,171 points, frame
P99 rose to 33.1 ms and draw-submission P99 to 36.4 ms. Full measurements and
source hashes are in docs/benchmarks/catalog-gpu-synthetic-20260925-d3d11.json.

The catalog spatial-detail selector now offers 1,000,000 points as an opt-in
ceiling; existing 30,000 mobile and 100,000 desktop defaults are unchanged. The
focused spatial-selection file passed 7/7; git diff --check passed. This is one
synthetic high-end GPU renderer measurement, not full catalog ingestion, orbit
computation, native rendering, mobile acceptance, physical-display FPS or
cross-device capacity evidence. No full local suite, deployment or release ran.

### Checkpoint 597: index Gaia chart point picking

Gaia chart selection now builds and caches the existing packed screen-grid index by
canvas size, rendered zoom, and uploaded row count. Repeated clicks in the same view
search nearby cells instead of rescanning every source row; size, zoom, or appended
rows invalidate the cache. Float32 clipping, the 12 CSS-pixel hit radius, and stable
source-order tie behavior are preserved. The lazy first pick still builds the index
in O(N) time, and view changes rebuild on the next click.

Two focused Gaia picking/index files passed 4/4 and targeted ESLint reported no
issues. This reduces repeated interaction cost but has no measured end-to-end Gaia
latency result; source-count and transfer budgets remain unchanged. No full local
suite, deployment or release ran.

### Checkpoint 598: overlap Gaia reads while serializing decoded retention

Gaia chunk reads and hash checks still run concurrently, while JSON parsing,
Float64 direction allocation, duplicate-source checks and the consumer/GPU ACK now
run through one serial queue. This bounds simultaneously retained decoded chunk
objects to one while other source bytes are prefetched. Cache hits are hashed once
rather than twice. Default in-flight reservations increase from 64 MiB/60,000 rows
to 96 MiB/90,000 rows, allowing three maximum-sized chunks; accepted ceilings are
128 MiB/120,000 rows. Per-chunk limits and total selection limits remain 32 MiB/
30,000 rows and 128 MiB/100,000 rows.

Focused Gaia chunk coverage passed 10/10; targeted ESLint and git diff --check
passed. Synthetic small-shard coverage verifies the configured three-way overlap,
not large-shard throughput, heap or end-to-end latency. No full local suite,
deployment or release ran.

### Checkpoint 599: UTC-to-TDB finite-difference velocity and backlog audit

Approximate analysis velocities use centered position samples at UTC Julian days.
Their finite-difference denominator now uses the actual ET/TDB interval between
the sample epochs, including inserted leap seconds, instead of assuming that the
UTC numeric-JD interval is exactly the same dynamical duration. A 2017-01-01
boundary case verifies the computed velocity against its two sampled positions
and the converted interval. Focused ephemeris, kernel-loading, dependency-pool
and buffer-budget coverage passed 17/17; targeted ESLint and `git diff --check`
passed. No full local suite, build, deployment or release ran.

The remote audit found one open issue, #109, for the continuing architecture and
scientific-capacity goal, and no open PRs. Its acceptance still includes native
and real-device capacity evidence, so it remains open. The three closed,
unmerged PRs returned by the complete closed-PR query (#112, #78, #75) each have
an owner-authored supersession record pointing to merged replacements; none
contains a remaining unique change to reapply.

### Checkpoint 600: make apparent-state time contract explicit

Apparent reception geometry now identifies both the observation and emission
epochs as continuous TDB Julian days and callback states as barycentric km and
km/s. Parent-relative observation exports preserve that scale marker. The
default light-time tolerance is 50 microseconds, matching the one-part Julian
day resolution near J2000; the reported residual checks both the fixed-point
step and the light-time equation at the actual representable emission epoch.
Focused time-scale/apparent and observation coverage passed 8/8, with targeted
ESLint clean. This verifies numerical convergence reporting and API units, not
physical light deflection, astrometric accuracy or a full ephemeris oracle. No
full local suite, build, deployment or release ran.

### Checkpoint 601: verify state-plan preflight ordering

Source review confirms state-plan requests are normalized and bounded to 32,768
unique IDs, then estimated against the 8 MiB plan-response and configured tile
byte budgets before inventory reads, SPK/Kepler state resolution, or tile
encoding. Body resolution is split into 1,024-row blocks; accepted plans are
retained under a separately accounted resident-byte cache. No evidence-backed
change was needed in this path. This is source inspection, not measured
throughput or heap evidence; no test, build, deployment or release ran.

The local branch remains ahead of `origin/main`. A push to `main` triggers the
Pages deployment workflow, so the current committed batch remains local while
the owner's deployment/release hold is active.

### Checkpoint 602: preflight over-budget occultation scans

Static review found that over-dense browser scans were rejected by the geometry
engine only after the worker had fetched the DE440 source. The input parser now
uses the same shared interval-count and 20,000-evaluation limit as the search
and receipt verifier, so impossible requests reject before source loading. A
focused regression was added but not run during this source-only pass. The
default evaluation cap remains unchanged: raising it alone would admit jobs
that can exceed the existing 30-second worker deadline. Changed tracked source
files pass `git diff --check`; no tests, build, deployment or release ran. The
worktree contains extensive unrelated uncommitted changes, so no commit or push
was made in this checkpoint.

### Checkpoint 603: review finite-ensemble event accounting

Source review confirms that six-parameter solution-epoch Gaussian offsets keep
stable draw indices; invalid coordinate conversion, failed integration or
localization, unresolved resource budgets, and searches with no detected events
remain separate outcomes. Shared force exhaustion does not label remaining draws
event-free. Timing summaries use only the first detected sampled crossing per
direction and conditional nearest-rank order statistics; their limitations
exclude event probability, physical identity across draws, and calibrated
uncertainty. No source change was justified. This is a source-contract review,
not numerical validation or convergence evidence; no tests, build, deployment or
release ran.

### Checkpoint 604: audit covariance pushforward conventions

Source review traced the SBDB element covariance through the solution-epoch
Jacobian, AU/AU-day to km/km-second scaling, fixed ECLIPJ2000-to-J2000 rotation,
deterministic Sun translation and the integrated transition matrix. The returned
square-root pushforward uses `Phi B` and forms covariance as `B B^T`; receipt
validation separately checks the propagated matrix against that factor. The
orbital-period projection uses the analytic reciprocal-axis gradient and clearly
reports its fixed-GM, first-order boundary. No source change was justified.
Independent reference fixtures exist, but they were not rerun in this review;
this checkpoint is not new accuracy evidence.

### Checkpoint 605: release state-tile admission before overload retries

The backend returns `429` with `Retry-After: 1` when state-plan work, tile
encoding, observation, stellar or other scientific queue admission is full.
Browser plan, tile, state-window, ground-observation, stellar, identity and
coverage clients now honor an advertised queue delay for at most one retry,
cancel rejected response bodies first, release tile admission before waiting,
and stop promptly when the caller aborts. Queue-aware plan, window, observation,
stellar, identity and coverage requests retry only explicit HTTP 429 responses
with `Retry-After`; they do not replay after transport failures. Tile downloads
retain their existing one-retry transient policy and now respect server delay.
An internal state-window queue failure encoded after streaming starts still
fails closed; restarting it could repeat work after earlier epochs were already
delivered.
Retry delays are capped at 30 seconds; oversized numeric delta-seconds saturate
at that cap instead of falling back to a short default. Focused regression cases
were added but not run. Static source review and whitespace checking only; no
tests, build, deployment, release, commit or push ran.

### Checkpoint 606: include frame-tail pressure in adaptive rendering

The retained-renderer synthetic benchmark recorded a 33.1 ms frame-interval P99
at 1,561,171 points. Explorer's catalog budget sampler previously used P90 and
required either P90 above 28 ms or more than 15% of samples above 33 ms to count
a window as slow; its exact-state point sampler relied on P95 and missed-frame
ratio. A roughly 1% tail could therefore qualify as a fast window and promote
either budget. Both samplers now record P99, consider P99 above 28 ms slow, and
require P99 below 28 ms before growing. Two slow windows still trigger the
existing 25% reduction; policy ceilings and the 1,000,000-point spatial
selector remain unchanged. Focused regressions were added but not run. The
benchmark remains synthetic, headless and single-device; no full-catalog or
cross-device capacity claim follows from it. Static source review only; no
tests, build, deployment, release, commit or push ran.

### Checkpoint 607: expose spatial-selection wall time to capacity reports

Catalog selection responses now include worker wall-clock time from selection
start through completion, including cooperative yields. The canvas exposes that
diagnostic value and the local catalog benchmark records it in spatial mode,
separately from total load time; it excludes main-thread index upload and final
draw. This makes future tier comparisons able to attribute selection latency
without changing selection policy or claiming an improvement. Static source
review and `git diff --check` only; no tests, build, benchmark, deployment,
release, commit or push ran.

### Checkpoint 608: supersede stale catalog camera selections

Static request-path review found that the UI updated its camera generation but
withheld a replacement `view` message until the old selection receipt arrived.
That meant the worker's existing generation cancellation could not respond to
ordinary pan, zoom or resize while a scan was active. Spatial view changes now
post immediately; the worker cancels at its next cooperative yield and replaces
its single pending view with the latest request. Switching to all-points and
WebGL context loss explicitly cancel the current view request. Static review
and `git diff --check` only; no tests, build, benchmark, deployment, release,
commit or push ran.

### Checkpoint 609: audit epoch and spatial-cancel interleaving

Static message-order review confirms that epoch start increments the worker view
generation and clears the pending view before marking the spatial snapshot
incoherent. A racing `view-cancel` only advances that generation and cannot
clear or interrupt epoch work. The UI clears its active view receipt before
posting epoch work; old selections are rejected by request identity, and the
completed epoch redraw schedules a fresh view from the current camera. Append
and context-loss paths also invalidate selection state. No additional race was
found in these transitions. `git diff --check` passed; no tests, build,
benchmark, deployment, release, commit or push ran.

### Checkpoint 610: clear stale selection timing on context loss

Selection timing belongs to a completed spatial presentation. Static lifecycle
review found that WebGL context loss cancelled the active selection but retained
the prior duration in the canvas data attribute. The loss handler now clears
that diagnostic while preserving the pending state for renderer restoration.
Epoch, append, mode-switch, worker-error and completion paths already clear or
replace it through their display-state transitions. `git diff --check` passed;
no tests, build, benchmark, deployment, release, commit or push ran.

### Checkpoint 611: cover latest-view submission while a receipt is held

The existing real-Worker browser scenario now holds the first spatial selection
receipt, changes the map radius again, and waits for a newer request and receipt
before releasing either result. This protects the UI-side latest-view submission
path and leaves context-loss recovery coverage in the same fixture. The focused
browser case was added but not executed. Playwright's default web server runs
the full build, and a `dist` directory already exists; no build or test ran to
avoid overwriting that existing artifact during this source-only pass. Targeted
ESLint over the component, worker protocol/handler, benchmark and browser case
reported no issues; `git diff --check` passed.

### Checkpoint 612: audit catalog worker selection cleanup

Static lifecycle review confirms that component cleanup detaches worker handlers
and terminates the Worker, which releases its selection arrays, index and
MessageChannel. Worker errors increment the selection generation, clear pending
views and discard the failed snapshot before reporting the error; the UI then
terminates that Worker and clears its active request. Explicit source stop keeps
the visual snapshot by design, but invalidates current selection work before
resubmitting the retained view if needed. No additional cleanup change was
justified. `git diff --check` only; no tests, build, benchmark, deployment,
release, commit or push ran.

### Checkpoint 613: reconcile million-row selector scratch with admission

For the capped representative path, `n` admitted rows and display limit `m`
bound selector-local arrays by `4*min(n,m)` winner bytes, the same number of
one-byte winner flags, `4*ceil(n/32)` membership bytes and at most
`4*min(n,m)` output-index bytes. At one million rows and a one-million-point
view that upper bound is 9,125,000 bytes (about 8.70 MiB). A previous installed
CPU index array and the GPU element buffer can each retain at most another
`4*n` bytes during replacement. The planner's 2D/3D admitted-row charges
decompose to 73/85 bytes: CPU+GPU point
attributes, Float32 worker culling positions, winner/output arrays, previous
CPU/GPU selection high-water storage and the one-byte winner-priority flag.
The source-sized membership bitmap and per-block spatial bounds are charged
separately. This reconciles explicit array/GPU allocations, not JavaScript heap
or process RSS. The retain-all branch now writes source membership directly and
skips winner and priority arrays, saving up to 5,000,000 bytes at one million
rows while preserving the same source-order indices. The plan retains its
worst-case row charge. The focused spatial-selector unit file passed 7/7,
targeted ESLint reported no issues and `git diff --check` passed. Commit
`35ab600` contains only the selector and allocation-plan source files. No build,
benchmark, deployment, release or push ran.

### Checkpoint 614: coalesce SPK page misses and reduce catalog validation overhead (2026-09-25)

Concurrent readers of one uncached SPK page now share its in-flight read and
page-integrity digest. A gated eight-reader regression observed one underlying
`ReadAt`, one retained page load and identical bytes for every caller. The
focused `internal/spk` package passed 17 tests and `go vet` passed. The race
detector could not start because this Windows environment has CGO disabled;
the non-race regression passed.

Large Float32/Float64 coordinate validations in the retained renderer, catalog
stream UI and worker now use a direct finite-value loop. Existing rejection
behavior is covered by the renderer tests. A Node v24 microbenchmark scanning
4,701,579 finite Float32 values measured a 23.83 ms median for
`.every(Number.isFinite)` and 2.25 ms for the direct loop (10.6x in this local
microbenchmark); this is not a browser or GPU benchmark. The catalog renderer
and streaming focused files passed 50 tests, ESLint and `git diff --check`
passed. Commit `61c318e` contains the initial isolated renderer change.

The event/trajectory/mission worker path now selects dependency-closed SPK
files from its actual body targets instead of sending every currently loaded
kernel. The targeted event, mission-window, selection and trajectory files
passed 15 tests after correcting the lifecycle fixture to a valid event
request. Source-set size establishes avoided unrelated file requests; no live
memory or latency benchmark was run.

No full local tests, browser capacity run, deployment, release or push occurred.
The 30k/100k/300k/1m/full-inventory frame-tail, memory, first-visible and
cancellation measurements remain open acceptance work; focused tests and the
local Node benchmark do not close those items.

### Checkpoint 615: record follow-up catalog commit and remote backlog state (2026-09-25)

Commit `724ee85` carries the shared finite-value loop into the catalog stream's
Float64-to-Float32 validation boundaries and worker spatial buffer. Its staged
diff excludes the unrelated in-progress camera cancellation/selection timing
changes in those files. The catalog renderer/streaming focused set passed 50
tests before this commit; no full suite was run.

The live repository backlog has one open issue: #109, the architecture and
capacity acceptance goal this tracker follows. It remains open because hardware
capacity evidence, full-profile scientific acceptance and several native
integration items are unfinished. The open-PR query returned none; historical
issues in the all-state inventory are closed. No remote issue or PR was mutated.
Main-only commits remain local; deployment, release and push are still paused.

### Checkpoint 616: measure full-catalog desktop capacity (2026-09-25)

After rebuilding the current application, a Chromium 151 / NVIDIA RTX 5070 Ti
D3D11 run loaded and checksum-checked the complete 1,561,171-row, 313-shard
MPC source in 3D spatial mode under the default 512 MiB display budget. It
completed in 8.98 s; first nonempty draw was 254 ms and worker spatial
selection was 42.2 ms. The sampled animation-frame interval was 16.8 ms at P95
and 17.0 ms at P99, with one observed 114 ms long task. The browser-reported
JavaScript heap sample peaked at 98.0 MB (not process, worker, GPU or driver
memory). Point attributes accounted for 43.7 MB, with a separate 0.40 MB
spatial index and 9.16 MB of index uploads. At most four shard requests and
two unacknowledged tiles were observed. Twelve 3D rotations caused no new
requests, allocations or point-attribute uploads; there were no observed WebGL
or page errors. The source, manifest and checksums were validated for this
local snapshot.

At 256 MiB, a full-inventory request stopped in the intended limited phase at
1,144,103 rows rather than exceeding its admission budget. The same budget
completed an exact 1,000,000-row tier in 5.37 s; first nonempty draw was
221 ms, spatial selection 25.7 ms, sampled P95/P99 frame interval was 16.8/17
ms, and one 78 ms long task was observed. At 128 MiB, the UI disabled starting
the full-inventory request before any shard was fetched. These outcomes expose
the actual catalog tiers supported by this workstation's budget settings;
they do not establish minimum-device limits.

The measured ceiling matches `planCatalogStream` exactly for this manifest and
its non-retained-epoch settings: the 256 MiB fixed reserve is 171,186,697
bytes, the 3D per-row charge is 85 bytes, and 1,144,103 admitted rows leave
4 bytes unused. At 128 MiB, the 137,632,265-byte fixed reserve already exceeds
the budget, so the planner correctly reports zero capacity and disables the
full-tier start. At 512 MiB the admitted capacity clamps to the manifest's
1,561,171 rows. No budget-planner change is justified by these measurements.

This is a targeted built-app benchmark, not a test suite. It uses local HTTP,
one fixed epoch, headless animation callbacks and CPU-side WebGL submission
timings. It does not establish public-network throughput, physical display
FPS, continuous simulation, total process/GPU memory, or mobile capacity.
Build passed, as did the focused catalog renderer/streaming tests and targeted
SPK checks recorded above; no full local test suite, deployment, release or
push ran. Desktop capacity is now measured; Android/iOS hardware, network and
long-duration/cancellation acceptance remain open under issue #109.

### Checkpoint 617: observe cancellation settlement during full-catalog load (2026-09-25)

A full-inventory D3D11 run with the real cancel control enabled loaded the same
1,561,171-row source, then refreshed and cancelled on the first received source
tile before its scheduled GPU upload. UI cancellation state appeared 1.7 ms
after the request and the worker reported terminal cancellation 1.8 ms after
it. No tile arrived after the request and no attribute bytes were uploaded
after the retained-snapshot boundary. Browser requests and server responses
reached a one-second quiet interval 1.26 s after refresh dispatch; both were
inactive at observation. The worker intentionally remained alive to serve the
retained spatial view. This is one warm-page, local-HTTP initial-load case; it
does not cover epoch updates, remote transports, mobile devices or long-run
resource reclamation. Full inventory completed, the 12-rotation audit again
created no extra requests, allocations or attribute uploads, and no WebGL or
page errors were observed. No full test suite, deployment, release or push ran.

### Checkpoint 618: measure a 60-second interactive full-catalog window (2026-09-25)

The catalog benchmark now has an optional bounded steady-state window. It
re-enables frame and long-task sampling after the isolated load measurement,
samples the browser heap during that window, performs 12 evenly spaced 3D
azimuth changes, and reports view-selection and buffer/request deltas. A first
run exposed that the old load-only sampler intentionally stopped after source
completion; its zero-sample result was discarded. The sampler lifecycle was
corrected and the script passed Node syntax, targeted ESLint and
`git diff --check`.

The corrected full 1,561,171-row, 512 MiB D3D11 run observed 60.25 seconds and
3,614 animation-frame intervals. P95/P99 were 16.8 ms and maximum was 17.0 ms;
no interval exceeded the 25 ms missed-cadence proxy threshold, and no long
tasks were observed. The strict 16.7 ms P95 goal is therefore not proven by
this headless callback measurement (it exceeds that numeric threshold by
0.1 ms); the run is also not a physical display-frame or dropped-frame
measurement. The 12 spatial selections had P95 44 ms. They added no source
requests, point-attribute allocations or point-attribute uploads; spatial
index uploads increased by 1.46 MB. Browser-reported JS heap samples peaked
at 111.0 MB, with 226 samples; this excludes total process, worker and GPU
memory. No WebGL errors occurred. No full test suite, deployment, release or
push ran.

### Checkpoint 619: align exact-state origin and provenance across APIs (2026-09-25)

The SPK resolver recursively adds each segment's center state until NAIF 0, so
its public state is barycentric even when the target segment itself is Sun-
centered. State plans already declare `stateOriginId=naif:0`; exact tile rows,
inventory snapshot rows and identity-state responses now report that same
origin. Inventory snapshots without a verified kernel digest or source
identity status are not returned as exact states or admitted as exact tile
rows. The Go encoder binds each exact row's dataset digest to the catalog or
inventory digest in its tile header, requires center `naif:0` and a kernel
digest, and requires snapshot identity status. Android applies the same
kernel-digest rule as Web and iOS. Every platform decoder now also
rejects an exact row whose center differs from the plan's barycentric origin.

The inventory-element fallback uses the solar two-body model, so it now accepts
only source elements explicitly centered on `naif:10`. The trajectory endpoint
reports each resolved sample's center and refuses to return one series when
samples cross model or center boundaries. Exact and approximate states can no
longer be mislabeled as one homogeneous trajectory.

The focused Go state-wire package passed 15 tests. The inventory-snapshot HTTP
test passed with the NAIF 0 origin asserted and a mixed exact/approximate
trajectory rejected. The Web state-tile unit file passed all 31 tests, focused
ESLint passed, and `git diff --check` passed. The Android decoder class test
could not reach compilation: the machine only has Temurin Java 26, whose
class-file version 70 is unsupported by this repository's Gradle build. No
full test suite, deployment, release or push ran; the Android check remains
pending a compatible JDK.

### Checkpoint 620: retire the legacy JSON trajectory endpoint (2026-09-25)

The current API audit found that `/v1/trajectory` returned JSON states without
selected kernel provenance and compared only model and center. The open
architecture issue #109 explicitly requires removing this legacy endpoint, so
the implementation was aligned with that future contract instead of extending
it: the route and handler were removed, scheduler classification no longer
admits it, and the capabilities response advertises exact state windows and
their actual limits. The supported historical path remains the bounded exact
state-window and binary state-tile transport. The per-identity JSON state route
is retired as well; identity endpoints return source records and directory
metadata only, while exact source, dataset, kernel, and recursive source-chain
evidence stays attached to state-tile rows.

The API documentation and local benchmark harness were updated to stop claiming
or calling the removed route; old measurement records are labeled historical.
The stale endpoint-focused benchmark/test cases were removed or changed to
assert route retirement. Formatting, reference searches, `go vet
./internal/httpapi ./cmd/bench`, and `git diff --check` were performed; vet and
diff checks pass. No tests were run, in keeping with the current request to
defer testing until the broader work is complete.
Deployment, release, and push remain paused.

### Checkpoint 621: cross-runtime solar-force audit (2026-09-25)

Static review compared the Go and TypeScript solar-force paths. Both use the
same Sun-relative Schwarzschild 1PN expression, position/velocity Jacobians,
light-speed constant and explicit weak-field/slow-motion guard. Both SRP paths
use the same declared SI-to-km/s² conversion, outward inverse-square model and
state Jacobian. The pinned Go DE440 mass order explicitly places NAIF 10 first,
matching its solar-GM selection. Their restricted-force assumptions and
omissions remain visible in evidence. This inspection found no justified code
change; it is not a new independent numerical validation. No tests were run.

### Checkpoint 622: repair the DOP853 covariance-reference source pin (2026-09-25)

The focused covariance check found that the checked-in DOP853 reference still
named the previous coordinate-oracle SHA. Regenerated the independent oracle
with its pinned SciPy 1.16.1, SpiceyPy 8.2.0 and mpmath 1.3.0 environment into a
new ignored cache file. The source SBDB, SPK and GM hashes matched; all six
nominal states, covariance matrices and refinement values matched the checked-in
reference bit-for-bit. Updated only the stale coordinate-generator SHA in the
reference manifest. The focused covariance receipt/reference files passed
11 tests and `git diff --check`; no full suite ran. Commit `5a4b0de` is local on
`main` and awaits the next authorized push batch. Broader uncertainty acceptance
remains in progress.

### Checkpoint 623: bind inventory snapshots to recursive SPK source lineage (2026-09-25)

Inventory snapshot claims now retain the exact resolver-selected root descriptor,
its manifest checksum and a recursive source-chain digest. Go runtime resolution
and the Node audit generator share a versioned little-endian byte layout, tested
against the same fixed SHA-256 vector. Inventory validation requires the root
descriptor to appear in the audited segment list. The backend verifies that the
root kernel checksum matches the active catalog and downgrades incomplete
snapshots to missing; its index reads only the compact selected-root descriptor.
Focused verification passed: Go source-chain and catalog resolution checks,
three Go state-plan/tile checks, the Node source-chain vector, identity-ledger
and inventory-resolver checks, plus the deterministic inventory-generation and
coverage-audit pipeline. No full local tests, build, deployment or release ran.
The workspace contains no generated inventory/source snapshot to refresh, so
older external snapshots remain missing until regenerated with this lineage.

### Checkpoint 624: stabilize event angular separation (2026-09-25)

Conjunction/opposition sampling, numerical refinement, and the event detail
curve now share unsigned separation via `atan2(|u × v|, u · v)` after
overflow-safe normalization. The Moon phase angle uses the same stable angular
kernel. This retains small angles that rounded `acos(u · v)` to zero, resolves
near-180-degree offsets, and removes the prior fixed, unit-dependent
minimum-vector threshold. Event/export model identifiers were advanced to v6 so
the changed numerical method is visible in result provenance. Focused unit,
sampled-event, event-benchmark, event-worker, and Moon phase checks passed (26
cases); scoped ESLint and `git diff --check` passed. No full test suite or build
ran. This is numerical stability evidence, not a change to ephemeris accuracy or
event completeness.

### Checkpoint 625: bind sampling evidence to the requested window (2026-09-25)

The worker, cache key, UI, and result receiver all derive the sample count from
the same adaptive policy. The exported `maximumResolvablePeriodDays` now uses
the actual requested window; the one-hour floor remains only a sample-count
policy. Worker results also carry a reproducible closed-grid receipt with actual
sample count, endpoints and maximum representable interval. The receiver
recomputes and binds that receipt even when the event list is empty, and the
cache/UI export preserve it. Admission rejects grids whose Julian Day samples
collapse to duplicate epochs and bounds receipt construction to 720 rows. Event
benchmark, worker, and cache checks passed (17 cases), including altered-receipt
rejection, empty-result receipt binding, short-window cadence and duplicate-JD
rejection. App TypeScript, scoped ESLint and `git diff --check` passed. No full
test suite or build ran. A sampled grid still cannot certify that unsampled
events did not occur.

### Checkpoint 626: declare the event sampling input time scale (2026-09-25)

Event sampling receipts now identify their uniform grid as UTC Julian-Day
coordinates and carry `inputTimeScale: UTC`. Their interval fields are documented
as coordinate intervals; ephemeris evaluation still reports its separate
dynamical scale (TDB for modern epochs, legacy numeric JD before UTC support).
The result receiver binds the scale and method along with the closed-grid
endpoints, count and intervals, rejecting a forged TDB label. Existing
time-conversion evidence covers TAI−UTC offsets and velocity/flight-time handling
across the 2016 leap second. The focused event benchmark, result-binding and
worker-lifecycle checks passed (16 cases); TypeScript, scoped ESLint and
`git diff --check` passed. No full test suite or build ran. This clarifies the
receipt contract and does not claim event completeness or greater physical
ephemeris accuracy.

### Checkpoint 627: discard stale render samples after tab suspension (2026-09-25)

The adaptive canvas budget now clears its frame window and restarts warm-up on
each document visibility transition. The 3D animation loop resets its previous
frame timestamp while hidden, so a suspended-tab gap is not reported as a slow
render frame after resume. This aligns controller evidence with the documented
rule that hidden tabs do not affect adaptation. The focused render-budget unit
checks passed (19 cases); TypeScript, scoped ESLint and `git diff --check` passed.
No full test suite or build ran. The controller still needs real-device frame,
memory and thermal measurements before hardware smoothness claims.

### Checkpoint 628: budget event scans for relative and periapsis motion (2026-09-25)

Event cadence now considers resolved trajectories needed by the requested
geometry, including angular references, apsis centers, and implicit state
dependencies. It estimates relative orbital-phase change from the two largest
participant rates in linear time, and applies
the Keplerian periapsis angular-speed factor for elliptic high-eccentricity
targets. The extra one-hour cadence floor was removed; the one-hour minimum
window remains only for the minimum-sample policy. Requested counts still cap at
720, and insufficient plans remain explicitly marked capped. Admission, cache
keys, UI evidence and result binding use the same participant set. The exported
event model and algorithm identifiers are now v7. Four focused
event test files passed (21 cases), including reference-motion and eccentric
periapsis cadence; TypeScript, scoped ESLint and `git diff --check` passed. No
full test suite or build ran. This rate-based cadence is still heuristic and the
result receipt continues to state that event completeness is not certified.

### Checkpoint 629: measure Type 21 reader parity and construction cost (2026-09-26)

`rtk pnpm exec vitest run tests/unit/spk.test.ts` passed 11 tests;
`rtk go test ./internal/spk -run "^TestSyntheticType21MatchesCSPICEFixture$"`
passed; and the focused original-Horizons Type 21 CSPICE comparison passed 3/3
(10 unrelated tests skipped by the name filter). `rtk npm run benchmark:spk`
verified fixture checksums and measured two warmup batches plus seven 50-parse
batches. The Horizons fixtures measured 0.0581–0.0587 ms median per construction
(272–275 records, about 0.20 MiB); the mixed-dimension synthetic fixture
measured 0.1746 ms (702 records, 0.53 MiB). These runs confirm current small-
fixture behavior only; large kernels, peak memory and mobile startup remain
unmeasured. TypeScript eagerly validates all record words while Go validates a
selected record on evaluation; neither path was changed without representative
large-kernel evidence. No full local test suite, build, deployment or release
ran.

### Checkpoint 630: compare Go DE440 propagation with the shared oracle (2026-09-26)

Added `TestDE440RestrictedIntegratorMatchesIndependentReference` to the Go
uncertainty package. The test verifies checksum-pinned DE440 and GM inputs,
fixture masses, 11-body barycentric states at three epochs, and all 42 integrated
state/STM components for -10, +10 and +30 days against the existing independent
CSPICE/DOP853 fixture. The single targeted command
`rtk go test ./internal/orbituncertainty -run '^TestDE440RestrictedIntegratorMatchesIndependentReference$' -count=1`
passed. The reference explicitly distinguishes restricted-model numerical
error from original-SPK model residual. No package-wide/full suite, build,
deployment or release ran.

### Checkpoint 631: reconcile the live issue and PR queue (2026-09-26)

The refreshed `dajiaohuang/solar` tracker has 46 closed issues and one open
issue, #109. Its requested audited coverage, scientific provenance, source-backed
simulation and multi-client rendering/performance remain aligned with the
current goal, so it stays open until its remaining hardware and scientific
acceptance evidence is complete. A title review of the closed issues found no
reason to reopen any of them. There are no open PRs; 130 PRs are merged and the
three unmerged closed PRs are superseded duplicates: #112 by #111, and #75/#78
by #81/#82. All three replacement merge commits are reachable from refreshed
`origin/main`.

The local `main` is 103 commits ahead and zero behind refreshed `origin/main`.
No push was made: `.github/workflows/deploy.yml` deploys GitHub Pages on every
push to `main`, and actual deployment/release remains deferred. No tracker
comments, closures or other remote mutations were made in this audit.

### Checkpoint 632: cross-check Go conditional covariance propagation (2026-09-26)

Added a Go end-to-end reference test for the DE440 covariance propagation API.
The immutable coordinate and direct DOP853 time-covariance references were
regenerated to dated `20260926` fixtures because the coordinate generator gained
an estimated-parameter-axis guard and its recorded SHA had become stale. The
existing fixtures were preserved. After omitting only the updated generator
hash fields, new and old JSON values match exactly. Focused browser coordinate
and dynamics covariance tests passed 28/28; the single Go test
`TestPropagateCovarianceMatchesIndependentDOP853Reference` passed across the
six Newtonian/1PN and -10/0/+30 day cases. Source, generator, epoch, nominal
state, covariance symmetry and all matrix entries are bound. No full local
suite, build, deployment or release ran. These are conditional-model numerical
comparisons, not physical uncertainty validation.

### Checkpoint 633: restore the current web production build (2026-09-26)

Wrapped canvas capture and resize callbacks so browser event arguments cannot
change the draw function's GPU-verification flag. Restored the distance-event
accepted-step diagnostic type at the boundary where TypeScript cannot follow
writes from its asynchronous evaluator, and narrowed the validated observation
epoch before source-window comparisons. `rtk npm run build` passed TypeScript,
Vite production bundling, and the build-artifact contract. `rtk git diff --check`
passed. No tests, performance benchmark, deployment, or release ran. This build
does not establish device rendering performance or independent scientific
accuracy.

### Checkpoint 634: avoid discarded accepted-state copies (2026-09-26)

The browser integrator retains its existing owned-copy callback and adds an
exclusive synchronous read-only state-view callback for consumers that do not
retain the integrator buffer. The dynamics recorder uses the view and copies
only the six displayed state coordinates at its at-most-2,048 retained nodes;
the prior callback allocated a 42-value `Float64Array` at every accepted step,
including nodes discarded by decimation. With the 20,000-attempt ceiling, this
removes at most 20,000 such array copies (6.41 MiB of typed-array payload); this
is a structural upper bound, not measured latency or allocation evidence.
Static comparison found the browser and Go DP54 coefficients, component-max
error norm, tolerances, step caps, attempt caps and 365-day/source-window limits
aligned. Go retains an extra low-order product residual when forming reference
ET; the browser's direct product differs by less than one ET-second ULP and is
below the input Julian-date resolution over the pinned span. Build and
`git diff --check` passed. No tests, benchmark, deployment or release ran.

### Checkpoint 635: audit DE440 coverage and source-cache lifetimes (2026-09-26)

Both dynamics adapters require a frozen interval containing elapsed time zero,
check the interval endpoints against the pinned DE440 source, and reject each
evaluation outside that interval. The experiment and covariance APIs also cap
duration at 365 days. When both orbit-source flags are configured, Go parses one
immutable `DE440Source` at backend startup and injects it into propagation,
ensemble and event requests; each run's mutable center-chain map is cleared on
high/low epoch change and capped at 64 entries. Browser dynamics verifies the
pinned byte hashes and retains only a
single-epoch resolver cache within one experiment. Its dedicated worker is
terminated at the end of each job, so parsed SPK state is rebuilt for the next
job; browser HTTP-cache reuse and the cost of reparsing have not been measured.
Go also keeps a product residual when converting reference JD to ET; the
browser rounds that product directly, by less than one ET ULP over this source
range. Cross-job browser cache reuse remains unresolved and requires measured
startup cost together with worker cancellation, memory-budget and lifetime
evidence before changing the one-worker-per-job boundary. Static source review
only; no tests, benchmark, deployment or release ran.

### Checkpoint 636: transfer owned DE440 bytes into the worker kernel (2026-09-26)

`fetchDe440Bytes` allocates a fresh buffer used only by its dynamics worker, but
the source constructor copied it again before hashing and parsing. Added an
explicit ownership opt-in: ordinary callers still get the defensive copy,
while the worker hands its unaliased buffer to the parsed kernel. Its live
kernel-buffer reservation consequently drops from two source-sized buffers to
one (5.30 MiB less per active job), held until worker termination. This is a
bounded allocation reduction derived from ownership and reservation code, not
a measured peak-memory or latency result. The TypeScript/Vite build and
`git diff --check` passed. No tests, benchmark, deployment or release ran.

### Checkpoint 637: share the owned SPK buffer across occultation geometry (2026-09-26)

Contact, body-limb and stellar-limb workers now pass their freshly downloaded
SPK buffer through the explicit ownership contract to the DE440 parser. The
stellar-limb path also avoids its extra pre-validation copy when that ownership
is asserted; direct callers retain the previous defensive snapshot behavior.
The occultation job budget now reserves one raw DE440 buffer for every geometry
kind instead of two for contacts/body-limb and three for stellar-limb. This
saves 5.30 MiB per contacts/body-limb job and 10.60 MiB per stellar-limb job
relative to the prior reservations, matching the one retained backing buffer.
These are code-derived allocation bounds, not measured latency or peak process
memory.
The TypeScript/Vite build and `git diff --check` passed. No tests, benchmark,
deployment or release ran.

### Checkpoint 638: verify managed-worker kernel reservations (2026-09-26)

The managed trajectory and conjunction workers retain their own parsed
`kernelStore` for their lifetime. The wrapper charges only newly requested IDs,
deduplicates them across each worker's lifetime, reserves before posting, rolls
back if posting throws, and releases the union exactly once on termination.
The worker-local `kernelStore` also deduplicates concurrent loads and returns
already installed IDs without reparsing. Main-window and worker copies are
distinct raw buffers and are correctly charged separately; there is no
double-reservation of the same worker buffer. This static audit found no safe
cross-worker parsed-object sharing path. No code change, tests, benchmark,
deployment or release occurred in this checkpoint.

### Checkpoint 639: increase Gaia small-chunk read overlap (2026-09-26)

The Gaia chunk loader now defaults to eight concurrent reads (from four) while
retaining the existing 96 MiB/90,000-row in-flight reservations, 32 MiB/30,000-row
per-chunk limits and 128 MiB/100,000-row selected-catalog limits. Those
reservations still admit at most three maximum-sized chunks simultaneously;
eight slots are available when chunks are smaller. JSON decode, duplicate-ID
checks and GPU acknowledgement remain serialized, so the change only raises
read/hash overlap and does not increase the configured in-flight source-byte or
row ceilings. This is a throughput hypothesis for small-shard manifests, not a
measured improvement; existing 4,460-row desktop receipts do not establish large
catalog heap use or mobile capacity. The Gaia data guide was corrected to match
the current loader defaults. Static budget cross-check and `git diff --check`
passed. No tests or benchmarks ran.

### Checkpoint 640: align Gaia generator and loader source budgets (2026-09-26)

Static inspection confirmed that `fetch-gaia-cone.mjs` and the browser loader
share `gaiaCapacity.json`: both cap catalogs at 100,000 rows, chunks at 30,000
rows/32 MiB, chunk count at the 2,592 possible 5-degree bins, CSV at 64 MiB and
manifests at 1 MiB. The producer uses a top-plus-one sentinel, assigns bins from
returned J2016 coordinates, and validates each serialized chunk; the consumer
checks the manifest/chunk totals, columns, frame, bin paths, sizes and hashes.
The generator now also explicitly enforces the catalog/chunk-count limits and
the final UTF-8 manifest byte cap accepted by the consumer. No remaining
producer/consumer limit drift was found in this audit.

The TAP CSV collector previously retained all network fragments and then copied
them into a concatenated buffer, permitting two full raw-source representations
to coexist near the 64 MiB cap. It now copies into a geometrically grown bounded
buffer and returns a view of the received prefix, avoiding the second full
concatenation allocation. This is a source-derived allocation improvement, not
a measured RSS or generation-time result. Static review and `git diff --check`
passed; no tests, benchmark, deployment or release ran.

### Checkpoint 641: release Gaia worker chunk payload during GPU backpressure (2026-09-26)

The Gaia stream now drops its per-job encoded-byte reference after integrity
checks, decode and any bounded-cache copy complete. In the sole production
consumer, the worker also releases decoded source rows and Float64 direction
vectors immediately after `postMessage` clones the rows, while retaining the
existing upload-ACK backpressure. The main thread remains the owner of source
rows for selection and export; the GPU owns its fixed-capacity point buffer, and
Float32 display batches remain retained for lazy picking. This reduces duplicate
worker-side chunk residency during upload waits, but total JS heap and driver
memory remain unmeasured. Static lifetime review only; no tests or benchmarks
ran. The existing default-budget expectation was updated to concurrency 8 but
was not executed.

### Checkpoint 642: stream large Gaia JSON exports (2026-09-26)

The Gaia export no longer creates one pretty-printed string for all source rows
before constructing a Blob. A new shared helper serializes the unchanged
top-level metadata once, then emits at most 64 formatted source records per
ReadableStream pull into browser-managed Blob storage. It preserves the exact
source objects and metadata fields, keeps `sources` as the final array property,
and limits transient row-string batches; it does not claim to cap browser Blob
storage or total RSS. Static code review only; no tests, browser export check or
benchmark ran.

### Checkpoint 643: retain Gaia sources in transferable columns (2026-09-26)

The worker now transfers Gaia source records as BigInt64 source IDs, row-major
Float64 numeric fields and a null bitset. The page retains those transferred
buffers as manifest-bounded chunk segments; selection reconstructs one source
object and the streamed JSON exporter reconstructs at most 64 rows per pull.
This preserves the canonical v1/v2 column order, decimal source-ID strings,
Float64 values and null-versus-number distinction while removing the permanent
per-row object graph and structured-clone object copy. At 100,000 schema-v2 rows,
the retained packed columns are about 27.1 MiB, plus small per-segment padding;
this excludes worker decode temporaries and duplicate-ID validation state, the
bounded source cache, display/GPU buffers and browser Blob storage. Existing
UI/export and covariance paths have not been exercised after the protocol change.
`rtk tsc --noEmit -p tsconfig.app.json`
and `rtk git diff --check` passed. No tests, emitted build or benchmarks ran.

### Checkpoint 644: reuse Gaia source-ID columns during validation (2026-09-26)

Chunk decoding now parses each decimal source ID to `BigInt` once, uses that
value for the existing signed-range and strict-order checks, and stores it in
the chunk's `BigInt64Array`. Cross-chunk duplicate rejection still runs before
the chunk is sent to the chart, using a `Set<bigint>` instead of retaining a
second set of decimal-string keys. The worker packs the same ID column into the
transfer message, so it no longer reparses each ID or allocates another
`BigInt64Array`; the validation buffer is transferred into the UI's packed
store. Static TypeScript checking and `rtk git diff --check` passed. No tests,
benchmarks, browser checks, build, deployment or release ran. JavaScript heap
usage for the duplicate set remains engine-dependent and is not included in
the packed-column byte estimate.

### Checkpoint 645: avoid intermediate filtered catalog pages (2026-09-26)

Forward asteroid-section paging now scans each loaded chunk once and retains
only rows belonging to the requested orbit class and page. It no longer builds
a complete filtered array plus a second sliced array. Once the page is full,
the first additional matching row establishes the same in-chunk end cursor;
when none remains, paging advances to the next chunk as before. This preserves
row order and filtering while reducing temporary arrays and copied references.
Static TypeScript checking and `rtk git diff --check` passed. No tests,
benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 646: map the multi-body throughput limits (2026-09-26)

Static review found distinct limits rather than one global body ceiling. The
current asteroid release contains 1,561,171 rows, and the adaptive point-cloud
policy can display up to 1,567,193 points in its desktop high-memory profile;
the point cloud is already a worker-prepared, single-buffer path. Exact backend
state plans accept up to 32,768 requested bodies, while retained history trails
are bounded to 320 bodies and 600 samples (4,608,000 bytes for the maximum
Float64 xyz buffer, before provenance and render buffers). The 3D focus layer
uses at most 160 individual detail meshes; remaining states render in a point
cloud. The saved 1,561,171-row propagation benchmark measures CPU work only
(186.0 ms median on its recorded desktop); it does not measure real-device
frame time or GPU throughput. No count ceiling was raised from this evidence:
exceeding the asteroid rows needs a larger authoritative source, and raising
trail capacity needs end-to-end tile, memory and frame measurements. No tests,
benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 647: expose spatial screening work in capacity reports (2026-09-26)

The full-catalog D3D11 report records 1,561,171 uploaded rows, 33,119 displayed
rows and a 48.1 ms initial spatial selection, but omits how many source rows
were individually screened versus skipped by the existing block bounds. The
worker already reports both counters and the page already validates their sum
against the uploaded row count. The canvas now exposes them to the benchmark,
which records the initial counts and every steady-window rotation sample and
rejects missing or inconsistent counters. This diagnostic change does not
accelerate selection or justify a new index; it enables the next approved
measurement to distinguish a weak block-pruning rate from per-row projection
cost. `rtk git diff --check` passed. No tests, benchmark, build, deployment or
release ran.

### Checkpoint 648: remove temporary row-location buffers from state snapshots (2026-09-26)

Exact state requests may span multiple 32,768-body plans so the selected-body
set is not truncated. Static review found that snapshot assembly then allocated
two extra `Uint32Array`s (8 bytes per received row total) and traversed every
tile row twice before creating the requested-body bindings. The snapshot now
stores a verified row's tile and row as one safe integer in the temporary
identity map, removing both arrays and one full-row pass without dropping state,
alias bindings or provenance. At 1,561,171 rows this removes 12,489,368 bytes
(about 11.9 MiB) of temporary typed storage; this is structural accounting, not
a measured runtime claim. TypeScript checking and `rtk git diff --check` passed.
No tests, benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 649: reuse the 3D current-state point ordinal buffer (2026-09-26)

Static render-path review found that every 3D frame update allocated a fresh
`Uint32Array` sized to the current-position count before filling the renderer's
point layer. The renderer now retains this CPU ordinal buffer and grows it
geometrically, exposing only the populated subarray to point geometry and hit
testing. It retains all rows passed to that layer; Explorer's separate adaptive
display budget is unchanged, and exact positions remain in the frame. TypeScript
checking and `rtk git diff --check` passed. No tests, benchmarks, browser checks,
build, deployment or release ran.

### Checkpoint 650: keep 3D fit identity independent of frame epochs (2026-09-26)

The 3D frame update rebuilt and sorted every current body ID to detect scene
composition changes when local ephemerides were active. With exact backend
states it rebuilt a full selected-ID string because the frame object changes
each epoch. The workspace now supplies a stable composition token derived from
selection identity, available body count, source mode and the small spacecraft
identity set. The renderer compares that token by identity, preserving camera
refits when scene composition changes while removing state-count-sized ID
sorting/string churn on ordinary epochs. TypeScript checking and
`rtk git diff --check` passed. No tests, benchmarks, browser checks, build,
deployment or release ran.

### Checkpoint 651: reuse the large-point picking buffers (2026-09-26)

The 3D screen-point index is rebuilt after position-buffer, camera or viewport
changes, because its pixel locations must stay exact for hit testing. When the
viewport and point count are unchanged, the renderer now clears the cell heads
and repopulates the existing link and coordinate arrays. This avoids allocating
new per-point arrays (4-byte links plus two Float64 coordinates, 20 bytes per
point) for each rebuild; the first-build memory and O(n) projection pass remain.
New indexes no longer perform an explicit full-length `next.fill(-1)`, because
only entries reachable from cleared heads are read and each linked entry is
rewritten by `add`. Local TypeScript checking and `rtk git diff --check` passed.
No tests, benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 652: pipeline large exact-state plan batches (2026-09-26)

Selections above the 32,768-body protocol plan size previously prepared and
downloaded every plan serially. Current-state loading now allows at most two
plan workers, preserving original chunk order in the final snapshot. Their tile
requests still use the page-wide two-transfer admission pool (or an equivalent
two-transfer local pool when called without the worker admission hook). A failed
plan cancels its peer, and no frame publishes until all plans finish. This
overlaps plan preparation with tile transfer without raising tile concurrency
or truncating selection. TypeScript checking and `rtk git diff --check` passed;
throughput impact is unmeasured. No tests, benchmarks, browser checks, build,
deployment or release ran.

### Checkpoint 653: reduce full-count 2D selection work (2026-09-26)

The 2D hover, double-click and touch-pick paths scan every displayed body. Their
nearest-body decisions now compare squared planar distances, avoiding a square
root for each candidate while preserving the existing strict hit radius and
source-order tie behavior. Hover still computes the selected body's reported
3D distance once. Static TypeScript checking and `rtk git diff --check` passed.
The render ceilings already reach the full source inventory on supported
desktop quality tiers; no budget was raised without runtime frame evidence.
No tests, benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 654: retain stable 3D bulk-point colors across epochs (2026-09-26)

The 3D catalog layer already reuses color data by catalog-record identity while
rewriting only positions for new epochs. The selected-state layer instead used
the newly-created ordinal subarray view as its color key, so unchanged body
colors were rewritten and uploaded on every position refresh. Its color key now
tracks stable scene identity, detailed-body exclusions and source count; epoch
changes continue to rewrite positions, while source/selection changes still
rebuild colors. Static TypeScript checking and `rtk git diff --check` passed.
No tests, benchmarks, browser checks, build, deployment or release ran.

### Checkpoint 655: remove per-row color objects from 2D point construction (2026-09-26)

The 2D catalog loop created a fresh four-number color array for every point, and
ordinary current-body colors also allocated temporary arrays per row. Catalog
colors now use three shared immutable palette tuples; regular RGBA conversions
use a bounded cache, while distance-dependent NEO colors write scalar channels
directly. At the full 1,567,193-row source ceiling this structurally removes up
to that many catalog color-array allocations per geometry rebuild; this is not
a measured frame-time claim. Static TypeScript checking and `rtk git diff
--check` passed. No tests, benchmarks, browser checks, build, deployment or
release ran.

### Checkpoint 656: reuse 2D geometry storage after React commit (2026-09-26)

The 2D canvas previously created five exact-sized Float32 arrays while rendering
each new prop set. The canvas now builds geometry in its committed effect into
retained buffers, growing them by 1.5x and shrinking after demand falls below a
quarter of capacity. This keeps abandoned concurrent renders from mutating
arrays referenced by the active draw closure and removes repeated large-array
allocations while capacity is sufficient. Returned views expose only written
vertices, also preventing skipped trajectory-break segments from becoming
zero-filled lines at the origin. WebGL buffers are still uploaded for each
changed geometry; no frame-time improvement is claimed. Static TypeScript
checking and `rtk git diff --check` passed. No tests, benchmarks, browser checks,
build, deployment or release ran.

### Checkpoint 657: preserve verified SPK hashes for selected-segment lineage (2026-09-26)

The resolver's recursive `sourceChain` API requires each loaded kernel's SHA-256,
but registration kept that verified digest only in a `WeakMap` and the frozen
analysis pool dropped it before constructing the resolver. Registered kernels
and analysis snapshots now pass the digest obtained from successful byte
verification, so lineage queries can bind selected SPK segments to their exact
source bytes. Existing event and mission receipt schemas still report the
eligible kernel pool rather than per-epoch segment lineage. `rtk git diff
--check` passed; static TypeScript checking could not run because `tsc` is not
installed in the workspace. No tests, benchmarks, browser checks, build,
deployment or release ran.

### Checkpoint 658: allow dense spatial views to use the full loaded catalog (2026-09-26)

The spatial selector and its UI stopped at one million requested points even
when a larger catalog snapshot had been admitted under the existing memory
budget. The spatial limit now offers the manifest's complete row count; actual
requests remain clamped by admitted capacity, and worker scratch remains
bounded by rows currently loaded. The 100,000-point desktop default and device
capacity policy are unchanged. Updated the invalid-input boundary in the unit
test source; no tests ran. `rtk git diff --check` passed. TypeScript checking
could not run because `tsc` is not installed in the workspace. No benchmarks,
browser checks, build, deployment or release ran.

### Checkpoint 659: default desktop catalog requests to the full release (2026-09-26)

An untouched desktop catalog request previously stopped at one million rows,
leaving the last 561,171 release rows out of both propagation and display
selection despite an existing 512 MiB full-source application result. The default
now follows the loaded manifest's total count; explicit user choices remain
pinned. The existing planner still caps the admitted count to its memory budget,
mobile still requests 30,000, and spatial representatives remain capped at
100,000. This uses the recorded full-source fixed-epoch spatial application
evidence; continuous-time/native acceptance is still open. No tests, benchmarks,
browser checks, build, deployment or release ran.

### Checkpoint 660: release the iOS 3D projection staging array (2026-09-26)

The iOS native 3D projection retained its `[SIMD3<Float>]` staging array after
copying the same points into the SceneKit vertex payload. It now retains the
payload's displayed count and releases the staging array after payload creation;
2D projection behavior and source Float64 states are unchanged. Bounded projection
reduction copies only the requested vertex prefix and rebuilds its small identity
index buffer. This removes one steady-state display array, about 8 MiB at 500,000
points given the current 16-byte `SIMD3<Float>` stride; it does not establish peak
RSS or justify raising native limits. No tests, builds, benchmarks, device runs,
deployment or release ran.

### Checkpoint 661: fit iOS 3D points with a rotation-invariant radius (2026-09-26)

Static cross-platform review found that Android fit its 3D cloud using Euclidean
radius, but iOS used the largest absolute coordinate component. Rotated diagonal
points could exceed the iOS fit and be clipped. iOS now uses Euclidean radius for
3D and planar radius for 2D, with a 5% display margin. An existing protocol test
source was updated with the new scale and a diagonal-radius assertion, but no test
ran. Source state precision, exact counts and the native display ceiling are
unchanged. Device-level visibility remains unverified.

### Checkpoint 662: allow admitted iOS tile decodes to use separate CPU workers (2026-09-26)

Static review found that iOS fetched up to two state tiles concurrently, but the
cache actor also performed each full payload SHA-256, NDJSON validation and
Float64 decode synchronously, serializing CPU work. Bounded cache file access
and quota writes remain actor-isolated; verified decode now runs in cancellable
utility tasks. The existing two-tile cap, memory admission, plan-order
accumulation and all-or-nothing frame publication are unchanged. This removes
an actor serialization point, but device throughput and peak RSS still require
native measurement. No tests, builds, benchmarks, device runs, deployment or
release ran.

### Checkpoint 663: remove the duplicate worker-side display-coordinate scan (2026-09-26)

The streaming worker copied each computed Float64 tile into its Float32 visual
array and immediately scanned the entire copy for finite values. The main thread
already checks every rounded upload slice before drawing it or requesting a
spatial view, and the worker's invalidated spatial index rejects nonfinite
coordinates when selection runs. The redundant worker scan was removed; source
Float64 computation, display values, row limits and rendering admission are
unchanged. This removes one full visual-array read per installation by code
inspection; no device throughput improvement is claimed. No tests, builds,
benchmarks, browser checks, deployment or release ran.

### Checkpoint 664: make full-source stream-budget reserves auditable (2026-09-26)

The fixed `totalCount * (48 + 9)` reservation appeared to duplicate the
per-admitted-row renderer allocation. Source tracing showed it instead reserves
two compact-index strides during bounded-stream assembly (48 bytes/source row)
plus worst-case Uint32 query-locator pairs and a conservative one-byte-per-row
candidate-membership allowance (9 bytes/source row). CPU/GPU point attributes,
worker culling coordinates and display-selection scratch remain separately
charged by admitted row. The formula is now named by those input lifetimes; its
numeric value and capacity outcomes are unchanged. This is a source audit, not
a measured process-memory guarantee. No tests, builds, benchmarks, browser
checks, deployment or release ran.

### Checkpoint 665: fuse Gaia source packing and display projection (2026-09-26)

The Gaia worker previously traversed each decoded source chunk once to project
display coordinates and again to pack source columns for transfer. It now
prepares the same gnomonic basis once and writes both outputs in one row loop,
retaining cooperative cancellation yields and the existing Float64 source,
Float32 display, GPU acknowledgement, and row/byte budgets. Scientific source
values and projection equations are unchanged. Source inspection confirms one
per-row traversal instead of two; no frame-rate or capacity improvement is
claimed. No tests, builds, benchmarks, browser checks, deployment or release ran.

### Checkpoint 666: add a source-backed 94-star Gaia example (2026-09-26)

The Gaia chart keeps its existing 19-row schema-v1 example and now also exposes
the repository's schema-v2 Pleiades-area capture: 94 source rows, a matching
independent count query, one verified storage chunk and pseudocolour fields for
solutions that provide them. This gives the UI a five-times-larger real-data
example without changing the existing example's source IDs or behavior. The
94-row capture is still a small cone sample, not sky coverage or a capacity
benchmark. No tests, builds, benchmarks, browser checks, deployment or release
ran.

### Checkpoint 667: expose the measured 4,460-row Gaia region as a data asset (2026-09-26)

The source capture behind the existing desktop and mobile-emulation receipts was
present under `.cache`: its independent count is 4,460 and each source CSV/chunk
SHA-256 matches the original manifest. The exact capture files are now retained
under `public/data/gaia/pleiades-ra55-dec25-r1-g17-20260923`, with a chart entry
that loads its manifest through the configured application base URL. This adds
a one-degree, G <= 17, four-chunk real star region that can be imported without
manual file selection. It remains a magnitude-limited sample; the old 4,460-row
receipts predate the current worker implementation and do not verify its present
throughput. No tests, builds, benchmarks, browser checks, deployment or release
ran.

### Checkpoint 668: derive Gaia pick coordinates from retained display batches (2026-09-26)

The Gaia point-picking grid previously retained a Float64 x/y screen-coordinate
pair for every source in addition to the original Float32 display batch. The
grid now keeps its cell heads and 32-bit linked ordinals, then reconstructs the
same rounded screen position from the immutable display batch only for candidates
inside the clicked cells. The generic trajectory picker keeps its existing
Float64-coordinate path. Gaia therefore removes 16 bytes per admitted row of
duplicate picking storage (1,600,000 bytes at 100,000 rows); scientific values,
visible points, zoom, pick radius and row cap are unchanged. No click-latency or
larger-catalog result is claimed. No tests, builds, benchmarks, browser checks,
deployment or release ran.

### Checkpoint 669: retain full Gaia redraws pending a persistent-buffer design (2026-09-26)

The current loader redraws all accepted Gaia points after each GPU chunk upload,
which can resubmit earlier points when a manifest contains many small chunks.
Append-only drawing was reviewed but not retained: the WebGL context does not
request `preserveDrawingBuffer`, so previously presented pixels cannot be relied
on between worker messages. Preserve the full redraw until a persistent render
target or a bounded upload/draw batching protocol can retain visible points with
verified error and acknowledgement semantics. No source change or performance
benefit is claimed. No tests, builds, benchmarks, browser checks, deployment or
release ran.

### Checkpoint 670: omit transient Gaia direction columns in the chart worker (2026-09-26)

The generic verified Gaia stream still returns its Float64 ICRS unit-direction
column by default. The production chart worker now opts out: it reconstructs the
same unit-vector components from validated RA/Dec into one reusable three-value
scratch vector during the existing packed-source/display row traversal. This
removes the per-row 24-byte direction array while preserving the public default
shape, source values and projection arithmetic. Source inspection shows chunk
decode and consumption are serialized, so the structural saving is at most
720,000 bytes for one 30,000-row chunk; it does not multiply by the 90,000-row
encoded admission ceiling. Heap peak, throughput and larger-catalog capacity
remain unmeasured. No tests, builds, benchmarks, browser checks, deployment or
release ran.

### Checkpoint 671: reuse Gaia source buffers across the session cache (2026-09-27)

The Gaia stream previously copied each cached chunk with `Uint8Array.slice()`
before hashing and JSON decoding. It now borrows the private LRU-owned array for
that read-only path; the sole stream call site hashes and decodes without
mutating or transferring the bytes. The existing public `get()` and `put()` keep
their defensive-copy behavior. After a fresh source chunk passes hash, row and
duplicate-ID validation, the stream adopts its whole owned `ArrayBuffer` view
into the LRU; subviews fall back to an exact-sized copy so a larger backing store
cannot evade the cache byte budget. This removes one typed-array copy per cache
hit (bounded by active encoded admission: 96 MiB by default, up to 128 MiB when
explicitly configured) and one cache-insertion copy for a chunk (at most 32 MiB).
These are source-derived allocation bounds, not measured heap or throughput
evidence. No tests, builds, benchmarks, browser checks, deployment or release ran.

### Checkpoint 672: release validated Gaia ID strings in the chart worker (2026-09-27)

The default verified stream continues to expose decimal source IDs in each row.
The production chart worker now requests omission after decode has parsed,
range-checked, order-checked and stored each ID in its exact `BigInt64Array`
column. The packed-source converter requires the explicit omission marker and an
empty row field, then transfers the typed column; the page reconstructs decimal
text only when materializing a selected or exported row. This removes retained
per-row decimal strings from the worker's decoded chart batches without changing
public default records or rendered rows. The maximum row count affected at once
is one 30,000-row serialized chunk; actual heap bytes and capacity improvement
are unmeasured. No tests, builds, benchmarks, browser checks, deployment or
release ran.

### Checkpoint 673: bound the remaining Gaia JSON decode peak (2026-09-27)

Static tracing found the remaining decoded-source peak: `decodeVerifiedChunk`
must hold the admitted encoded bytes while `TextDecoder.decode` creates a full
JavaScript string and `JSON.parse` creates all row objects. The string and parsed
objects overlap during parse; later stages release the encoded-byte reference
after row/ID validation and cache handling. Existing in-flight byte/row limits
bound input reservations, not the transient JavaScript heap multiplier. The
repository's row-at-a-time parser is for canonical NDJSON metadata and does not
accept the Gaia chunk object's JSON contract. No safe parser substitution was
identified in this pass; total heap and a scalable streaming-parser replacement
remain unverified. No tests, builds, benchmarks, browser checks, deployment or
release ran.

### Checkpoint 674: retain Gaia chunks in an owned GPU render target (2026-09-27)

The Gaia chart previously redrew its complete uploaded point prefix after every
chunk. It now draws only each newly uploaded vertex range into a renderer-owned
RGBA8 framebuffer texture. Appends queue one default-canvas composite for the
next animation frame, coalescing chunks that arrive before that frame. The
browser's default drawing buffer is not used as persistent storage. Zoom or
canvas-size changes clear and rebuild the target from the already allocated
point buffer, then present immediately. Chunk ACK follows checked buffer upload
and persistent-target draw; a view rebuild also checks its immediate composite
before ACK. This makes star-primitive submission linear in accepted rows
between view changes and caps routine full-surface composites at the frame rate.
Picking uses only the last composited row prefix, excluding newly uploaded stars
until they are visible. The maximum 2048-square target adds 16 MiB of texture
storage by format, not a measured total GPU-memory bound. Source inspection
only; no tests, builds, benchmarks, browser checks, deployment or release ran.
Visual equivalence, context/resource behavior and larger real-catalog
performance remain pending.

### Checkpoint 675: recheck the evidence before changing Gaia's row ceiling (2026-09-27)

The historical Gaia capacity receipts all use the real 4,460-row, four-chunk
capture. A read-only SHA-256 comparison finds 0/6 recorded implementation files
matching the current worktree in the 2026-09-23 desktop receipt, and 2/9 in the
2026-09-24 expanded desktop receipt. The latter's `GaiaPlot.tsx` hash is
`7c58321c5e6a6c4060acb38f4d75df6150e3c6613c6fc6928c2e2b14eae75f67`; current
is `45d1b4276d8a6bc50905cfd81e2d41b3d120dafb2660e799e34c004f022c50c0`. Its
recorded capacity profile also differs from the current file. The older MPC
1,561,171-row measurements exercise another data and render path. These records
cannot justify increasing Gaia's 100,000-row admission ceiling or certify the
new persistent-framebuffer path. Keep that ceiling until a larger real Gaia
capture is measured against exact current hashes on the intended device tiers.
This was static hash auditing only; no tests, builds, benchmarks, browser checks,
deployment or release ran.

This historical checkpoint was superseded for implementation scope by
Checkpoint 795: the source now admits 200,000 aggregate rows under unchanged
per-manifest and in-flight budgets. The capacity is not performance-accepted;
the current-renderer and intended-device evidence requested here remains pending.

### Checkpoint 676: add a deeper, count-verified Gaia star field (2026-09-27)

An ESA Gaia DR3 TAP capture for ICRS RA 55°, Dec 25°, radius 1.5° and G <= 18
completed with an independent `COUNT(*)` match: 16,966 rows, four spatial
chunks and no TOP 100,001 overflow sentinel. The source CSV, count receipt,
manifest and four chunk files total 18,177,400 bytes; all six manifest-listed
source/chunk hashes were recomputed and matched. Manifest SHA-256:
`1e8e1959bbfbf70b43f1deb0523effb31b615950c86eaea98135ac8fa21e89ea`.
The Gaia chart now exposes this source beside the original 4,460-row region.
Static enumeration using the current public-copy exclusions found 300,504,354
bytes (286.58 MiB) across 715 selected public files, including the new region;
this is not a built artifact or a deployment check. The 16,966-row data has not
been measured for renderer throughput, frame time, total memory or device
capacity, so the 100,000-row software ceiling remains unchanged. No tests,
builds, benchmarks, browser checks, deployment or release ran.

### Checkpoint 677: confirm the production current-state wire is tile-only (2026-09-27)

Static route and caller inspection found the current browser observation client
uses `/v1/catalog/manifest`, `/v1/state/plan` and `/v1/state/tiles`; it bounds
parallel plans at two and sends each binary tile through the shared admission
pool. Android and iOS state services request the same manifest/plan/tile
endpoints. No production call in web or native app code to the removed
`/v1/current-states` or prior JSON trajectory/identity-state paths remains.
`/v1/state/window` is a distinct
current time-grid stream that embeds the same verified binary tiles and requires
a terminal completion frame; it is not a JSON fallback. Unknown old paths reach
the server's `not_found` case. Updated one stale Go comment that still named the
removed current-states endpoint. This verifies source routing only, not live
deployment, three-platform builds, cancellation under load or runtime behavior.
No tests, builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 678: reject the stale Voyager preparation receipt (2026-09-27)

Read-only SHA-256 auditing confirmed that the four archived Voyager source/note
entries and four cropped kernels match the local preparation receipt. The
receipt's implementation binding does not match the current preparation code:
only 5 of the current 8 listed implementation files match. The preparation
script and Type 1 evaluator hashes are stale, and the receipt omits
`scripts/lib/spacecraft-source-sets.mjs` entirely. Its seven-entry list therefore
cannot satisfy the current integrator's exact implementation inventory check;
matching data-file hashes do not repair that provenance gap.

The archived NAIF notes identify Voyager 1's tracking fit through 1992-04 and
Voyager 2's through 1992-10, while this candidate requests ET `[0,
3155716800]` (J2000 through 2100). Its full requested interval begins in 2000,
after both stated fit cutoffs. The 2100 descriptor endpoint is published
trajectory-extension coverage, not tracking coverage, a quantified error bound
or evidence of future physical accuracy. Keep this candidate out of runtime and
release selection. Any later admission needs a fresh receipt bound to the exact
current implementation, source review, and numerical comparison of the final
cropped files against an independent reference. This checkpoint is provenance
and scope evidence only; no coefficients or states were evaluated. No tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 679: expose Gaia's catalog time scale (2026-09-27)

Static comparison of the packaged Gaia manifest and chart confirmed that all
displayed directions are intentionally fixed at the catalog reference epoch;
the manifest records J2016.0 TCB, and both the chart and data limitations state
that proper motion and observer effects are not applied. The heading previously
omitted the manifest's time scale, so it now reads `J2016.0 TCB · ICRS`. This
clarifies the existing coordinate snapshot without adding per-star propagation
or implying current apparent-sky positions. No other astrometric model or row
admission changed. No tests, builds, simulations, benchmarks, CI waits,
deployment or release ran.

### Checkpoint 680: audit the bounded dynamics integrator and force gradient (2026-09-27)

Source inspection of the Go propagation engine found that its documented
Dormand–Prince 5(4) pair matches the implementation: every component has a
positive absolute tolerance, acceptance uses the maximum scaled local embedded
error, rejected steps do not publish state, the endpoint derivative is reused
only after acceptance, and duration/attempt/cancellation boundaries fail closed.
The restricted gravity path requires geometric J2000/SSB/TDB source positions
at each evaluation and uses the analytic point-mass acceleration gradient in
the variational equation. The source and documentation both retain the limits:
prescribed masses do not react, close-approach exclusion is sampled at force
evaluations, and local tolerance does not establish global or physical error.
No static correctness defect or evidence-backed performance change was found
in this slice, so the numerical algorithm and selection limits are unchanged.
No tests, builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 681: verify shared evaluation-cache identity and bounds (2026-09-27)

Static backend tracing found one bounded LRU per immutable `Catalog`. Cache
identity is the exact NAIF target plus the IEEE-754 bits of the requested JD;
manifest and solution-pool identity is supplied by the owning catalog, while
wire aliases do not split identical physical evaluations. Cached state and
provenance are value-owned, successful states only are inserted, cancellation
is checked before evaluation and insertion, and eviction keeps the declared
cache accounting at or below 16 MiB. Concurrent cold requests for the same
target and epoch can still perform duplicate work because misses are not
coalesced. No request-frequency or wait-time evidence supports adding
single-flight synchronization, whose cancellation and admission behavior would
also need review. No cache change is justified from this audit. No tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 682: compare binary state-tile contracts across clients (2026-09-27)

Static comparison of the Go writer and Web, Android and iOS readers found the
same v1 200-byte little-endian envelope, six Float64 state components, exact or
explicitly missing rows, zeroed missing states, payload SHA-256, manifest/plan
binding, and exact-state source-chain checks. The client plan paths bind ordered
tile ordinals, count, requested TDB epoch, ECLIPJ2000 frame, `naif:0` origin,
km and km/s units before assembling a frame. The per-plan ceiling is 32,768
bodies; server default and both native requests use 16,384 rows per tile. Web,
native and server admission each cap active tile work at two; increasing only a
client lane count would not increase backend encoder slots and could enlarge
transient memory. No wire or admission mismatch requiring a source change was
found. Larger tile/concurrency limits still require real frame-tail and memory
evidence. This was static inspection only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 683: trace the scientific-to-GPU precision boundary (2026-09-27)

The Web, Android and iOS state-tile decoders retain the source six-vectors as
Float64/Double. Web current-state projection converts km to AU and subtracts
the Float64 reference before the Three.js point writer stores Float32 display
coordinates. Native projection subtracts the reference in Double, normalizes
for its view, and only then casts to Float32; unavailable states are excluded
and the reference point is explicitly retained. The explorer's adaptive point
budget changes only the displayed subset: the verified state frame and its
source evidence remain complete, and the UI reports computed versus displayed
counts. No numerical-state precision is lost in the scientific source frame.

One unmeasured scale-sensitive path remains: Web `TrajectoryCanvas3D` rewrites
the displayed point attributes on the UI thread, including per-point reference
projection and Float32 packing. Moving this conversion to a worker would add a
Float32 result transfer and another owned buffer; source inspection alone does
not show whether that trade improves frame tails at the actual adaptive tiers.
Measure this path with exact current source hashes before changing ownership or
raising a display ceiling. No implementation or test was run for this audit;
no builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 684: remove the duplicate display-ordinal copy (2026-09-27)

The display-budget path filled a fresh `Uint32Array` of selected ordinals, then
passed a subarray to the general selector, which correctly made a defensive
copy for its public ownership contract. The display caller has exclusive
ownership of its newly allocated array, so it now transfers that view directly
to `CurrentPositions`; the general selector keeps its defensive-copy behavior.
This removes one O(N) copy and its temporary `4 * displayedCount` bytes on each
display-selection rebuild without changing order, membership, source states or
coverage. Static call-site inspection confirms the ownership-transfer helper is
used only by this fresh-buffer path. This establishes the allocation removed,
not a measured frame-time improvement. No tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 685: reuse the backend identity index in the inspector (2026-09-27)

`StateTileSnapshot` already maintains a `BodyId`-to-ordinal index, but the
backend body inspector scanned every evidence row to find its selected target.
The evidence contract now exposes that existing O(1) lookup and the inspector
uses it before materializing only the requested audit row. Missing IDs still
return no row, and state values, frame membership, and display positions are
unchanged. This removes one O(N) selected-target scan per inspector recompute;
it does not claim a larger renderer ceiling or measured frame-time gain. No tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 686: correct the current-state concurrency record (2026-09-27)

The concurrency note above said current-state ID chunks were fetched one plan at
a time. Source inspection of `loadCurrentStateObservation` showed two plan
workers, with two tile workers per plan still bounded by the shared two-slot
admission pool. Results are stored by chunk index and assembled in request order.
The note is corrected; this review does not raise any concurrency ceiling. The
two-slot pool and backend's two encoder slots remain coordinated bounds, and
source alone provides no evidence that increasing them would improve total
time without increasing queued bytes or decode memory. No tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 687: make exact-state count proportional to selected IDs (2026-09-27)

Each explorer pane used the detailed coverage-ledger builder only to read
`exactCount`. That path also scanned projected positions and allocated selected,
projected and request-identity sets, an ordinal buffer, a reason map and a full
ID array; comparison panes repeated that work for the same evidence snapshot.
The explorer now counts selected exact rows by querying the existing evidence
identity index and status column, then shares the scalar count across panes.
Duplicate selected IDs remain deduplicated, and the count still describes exact
source states independently of reference-relative projection. This removes
unneeded ledger work without changing coverage or display membership. No tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 688: defer hidden per-body coverage calculations (2026-09-27)

`EphemerisStatus` previously rebuilt local coverage arrays and evaluated
`kernelCoverage` for every selected body on each render, even when the exact
backend supplied the visible coverage summary and the local-evidence disclosure
was closed. Its detailed backend coverage ledger was also built while the parent
disclosure was closed. Exact summary counts now reuse the shared evidence-index
count from `ExplorerWorkspace`; the full ledger is built only while expanded,
and exact-mode local kernel evaluation is deferred until its nested disclosure
is open. Full fallback/unavailable identity lists remain available through
80-row pages rather than one large text node. Local-mode summary counts remain
computed for display. This changes when optional detail work runs, not state
values or coverage semantics. No tests, builds, simulations, benchmarks, CI
waits, deployment or release ran.

### Checkpoint 689: reduce peak memory while binding large exact-state snapshots (2026-09-27)

The exact-state request path stable-deduplicates backend identities, splits plans
at 32,768 IDs, retains chunk order, and admits at most two tile transfers. The
snapshot constructor nevertheless built a temporary `Map` for every returned
backend row before creating the persistent selected-ID index. For large selected
inventories that doubled the number of live hash-table entries during binding.
The constructor now binds the verified one-to-one, same-order case directly into
its compact tile/row ordinals and existing ID index. Alias identities and
different caller order still use the previous map-based path. The scientific
spacecraft records and historical schematic overlay remain separate by design;
both are explicitly labeled, so this audit found no justified identity rewrite.
Static source inspection and `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 690: pack 3D point colors as normalized RGB8 (2026-09-27)

Both 3D bulk point layers stored display colors in three Float32 components
per object, while positions already have their own Float32 attributes and are
formed only after Float64 reference subtraction. Point colors now use a
normalized Uint8 attribute, reducing color storage from 12 to 3 bytes per
point without changing scientific coordinates or the color-to-shader range.
The catalog palette writes byte constants directly, and body colors are
quantized from Three.js linear color values. Existing geometry assertions were
updated to describe the new attribute representation. The installed Three.js
source confirms normalized integer attributes map to [0,1] shader values.
Only static source inspection and `git diff --check`; no tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 691: make 3D picking cache reusable and smaller (2026-09-27)

3D hover and click picking caches its screen-space index by viewport, camera
matrices, GPU position-buffer revision, and displayed count. On a cache miss it
reuses the linked-cell arrays when dimensions and count match, but the caller's
`clear()` path had no implementation, so later frame/camera invalidations could
throw before rebuilding. Added a reset that clears cell heads; stale links are
unreachable and overwritten as new points are inserted. The non-reader index
also now stores UI screen coordinates as Float32, halving that cache's large
coordinate column while retaining subpixel precision; Gaia's reader-backed
path still reads its existing Float32 display batches. Added a regression
assertion for cache reuse, but did not run it. Only static inspection and
`git diff --check`; no tests, builds, simulations, benchmarks, CI waits,
deployment or release ran.

### Checkpoint 692: pack 2D scatter colors as normalized RGBA8 (2026-09-27)

The 2D geometry pool already retains typed buffers across renders and grows them
geometrically; live motion rewrites positions and uploads once per committed
geometry, while animation-only redraws reuse the GPU buffers. Each visible
point nevertheless carried four Float32 color components. Point colors now use
four normalized bytes and the WebGL attribute declares `UNSIGNED_BYTE` with
normalization, leaving Float32 projected positions and sizes unchanged. This
reduces point-color storage from 16 to 4 bytes per point in both the retained
CPU pool and uploaded attribute. Updated the existing type assertion. Static
source inspection and `git diff --check` only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 693: retain GPU buffer storage across 2D frame updates (2026-09-27)

The CPU geometry pool already reused capacity, but every committed frame passed
typed arrays to `gl.bufferData`, replacing the corresponding GPU data stores.
2D rendering now allocates each GPU store geometrically only when it grows,
uploads live prefixes with `gl.bufferSubData`, and releases oversized stores
when the active byte count falls below one quarter or reaches zero. Animation
redraws still issue no uploads. This retains complete per-frame position and
style updates while reducing GPU allocation churn and bounding stale capacity.
Static source inspection and `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 694: verify whether 2D label ordinals can be reused safely (2026-09-27)

The 2D overlay materializes at most 18 non-asteroid and 6 asteroid label rows,
but its current first-match scan can still visit the whole displayed list when
one kind is absent. Reusing cached ordinals based only on count or selected IDs
is not safe: exact-state coverage can change the projected membership/order at
the same count, reference/focus priorities affect ordering, and dated schematic
markers enter or leave the appended layer. The existing 3D fit token also does
not encode every one of those identity changes, and the 2D canvas receives no
complete ordered-membership token. No cache shortcut was added; a safe version
needs an upstream identity-membership generation or equivalent verified
invalidation evidence. Static source audit only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 695: reuse the 2D scene pass for spatial picking (2026-09-27)

Mouse hover, double-click reference selection, and touch selection previously
scanned every current body for each input event. The 2D spatial index is now
populated inside the already-required per-body geometry pass, then reused for
pixel-radius nearest queries; its backing arrays are retained when viewport,
cell size, and body count remain stable. The AU interaction radii are converted
using the projection scale, preserving the prior hit thresholds and source
order for ties. Static source inspection and `git diff --check` only; no tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 696: reconcile the active GitHub backlog (2026-09-27)

The repository currently has one open issue, #109, whose scope matches the
ongoing scientific-accuracy, state-streaming, and high-density rendering goal.
Its owner comment explicitly keeps it open pending hardware/frame-time and
reference-oracle evidence, which has not been collected. There are no open PRs.
The issue remains open until those acceptance gaps and the remaining work are
resolved; no remote issue/PR mutation was made. This was a metadata and scope
check only; no tests, builds, benchmarks, CI waits, deployment or release ran.

### Checkpoint 697: compensate SBDB covariance coordinate products (2026-09-27)

Static review found that the audited SBDB-to-Cartesian covariance Jacobian
transform still used ordinary reductions for both dense covariance products,
while the propagation path already uses the repository's Neumaier-compensated
Float64 arithmetic. The coordinate conversion now uses that shared product,
restores exact stored symmetry by averaging transpose pairs, and reports the
arithmetic version. Receipt binding checks include this field for both direct
and ensemble coordinate conversions. Formula and unit flow were reviewed;
only `git diff --check` was run, with no tests, builds, simulations, benchmarks,
CI waits, deployment or release.

### Checkpoint 698: review geometric event-search numerical boundaries (2026-09-27)

Static review of the universal-conic coordinate map and restricted-dynamics
distance-event pipeline found the intended boundaries intact: periapsis time is
kept unwrapped for covariance sensitivity, sign-change search is explicitly
sampled rather than complete, ambiguous sampled zeros remain unclassified,
draw and force-budget gaps retain distinct identities, and local solver/root
diagnostics are not claimed as physical event-time bounds. No further change was
justified by this pass. Existing high-precision/reference cases were not run
under the current no-test instruction; only static inspection and
`git diff --check` were used.

### Checkpoint 699: bind coverage populations to the loaded inventory (2026-09-27)

Per-source exact/approximate/missing buckets previously reconciled with the
report's own source totals, but those totals were not checked against the
currently loaded inventory. The inventory index now counts source rows during
its existing bounded scan; coverage loading compares those populations before
accepting the report, without rereading large shards or retaining a duplicate
source-name map. Go, Web, Android and iOS also reject whitespace-only source
labels consistently. Fixtures and the API description carry the source totals.
Static inspection and `git diff --check` only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 700: distinguish exact-state coverage from renderer detail budgets (2026-09-27)

Explorer passes the full selected identity set to current-state loading and
splits it into protocol-sized plans; the 320/160-body limit applies only to
historical trajectory detail. Exact current states are separately capped by an
adaptive per-pane draw budget that measures renderer callback intervals and
prioritizes reference/focused bodies before filling in source order. The
existing high-memory policy already reaches the installed source inventory
count. Raising plan concurrency or changing device-tier limits has no support
from source inspection alone; existing backend evidence shows memory and 429
pressure at higher client fan-out. No count or concurrency ceiling changed.
Static tracing only; no tests, builds, simulations, benchmarks, CI waits,
deployment or release ran.

### Checkpoint 701: audit high-density 2D and 3D point uploads (2026-09-27)

The 2D renderer reuses CPU geometry arrays and geometrically sized GPU stores;
committed frames upload only live typed-array prefixes, while animation redraws
reuse those uploads. The 3D bulk layer remains one point draw with RGB8 colors,
retained geometry capacity and relative-coordinate subtraction before Float32
conversion. Scene updates still scan displayed positions to separate the small
detail-mesh set from bulk points. That pass may matter at a larger live sample,
but source inspection cannot establish it as the limiting cost or justify a
different membership index. The existing 60-second local-browser 3D MPC report
covers all 1,561,171 source rows but draws 33,119 selected points; its callback
P95 is 16.8 ms. Its harness targets the separate `CatalogStreamCanvas` MPC
catalog cloud, not Explorer's exact-state point layer, and the report does not
attest that its built assets came from its listed source. A read-only SHA-256
comparison finds only 4 of its 10 listed implementation files match the current
worktree, so the timing is historical context rather than current-code capacity
evidence. It also is not physical presentation FPS or GPU execution time. No
rendering or concurrency ceiling changed; exact-state high-density frame-tail
and device-memory evidence remain open. Static inspection, source hashing and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
deployment or release ran.

### Checkpoint 702: separate synthetic state coverage from live scale evidence (2026-09-27)

The 293-position Saturn E2E case uses `tests/e2e/fixtures.ts`, whose state
vectors are deterministic ID-derived fixture values; it checks UI/request
contracts, not real SPK accuracy or throughput. The live Go state-tile browser
case requests only Earth, Moon and Mars. The million-row MPC browser reports
exercise the separate catalog-stream point layer, and their source hashes are
partly stale as recorded above. Static search found no capacity report that
combines a large real-backend exact-state selection with 3D point/detail counts,
frame tails and resource observations. These are distinct evidence gaps; no
test or benchmark was run under the current instruction.

### Checkpoint 703: reconcile Saturn identities with declared SPK intervals (2026-09-27)

The full manifest declares interval coverage at the Saturn E2E epoch (TDB JD
2461287.5) for all 292 numeric Saturn-moon identities in the catalog. The
catalog has 293 moon rows: the remaining record, provisional S/2009 S1, has no
NAIF identity and no source ephemeris. This establishes declared target/time
eligibility for the 292 numeric identities, not downloaded-kernel integrity or
runtime state correctness. The E2E fixture's reported 293 positions are
Saturn plus those 292 identities and are generated from deterministic ID-based
vectors; they remain synthetic UI/protocol evidence, not confirmation that a
real SPK evaluation returns 293 valid states. A capacity claim still needs a
real-backend run with reference-state checks and renderer/resource observations.
Static manifest/catalog comparison and `git diff --check` only; no tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 704: avoid unchanged 3D state-point uploads (2026-09-27)

The Explorer's shared 3D scene effect also runs for zoom, trajectory, ring,
glow and ecliptic changes. It previously rebuilt the current-state point
positions and marked the full live GPU range dirty on each run, even when the
position source and bulk-point membership were unchanged. The bulk geometry
writer now keys position uploads by both source identity and point membership;
presentation-only effect reruns keep existing position storage while a new
frame or membership still rewrites it. The color-buffer invalidation path is
keyed to the same immutable frame/member identity. Presentation-only reruns now
also reuse the detailed-body rows and bulk ordinal partition, avoiding the
full source scan and both point-attribute writes/uploads. A changed frame,
selected identity, detail set or reference body invalidates the cache and
rebuilds the partition. This removes a provable redundant O(N) CPU and transfer
path without changing body limits or draw calls. A focused regression case was
added but not run. Static call-graph/source review and whitespace inspection
only; no tests, builds, simulations, benchmarks, CI waits, deployment or
release ran.

### Checkpoint 705: separate 2D overlays from bulk-point rebuilding (2026-09-27)

The 2D canvas effect rebuilds and uploads all line and point streams together.
Changing line-only overlays such as the ecliptic or orbit visibility also
reprojects every current body, rebuilds point colors/sizes, and repopulates the
screen-picking index; opacity changes likewise reproject positions that do not
depend on opacity. The geometry builder now keys point positions/picking
separately from colors/sizes: line-only overlays reuse all point streams,
opacity/reference-style changes refresh colors while reusing projected
positions, sizes and the picker; changed frame/projection/catalog inputs rebuild
positions, styles and picking together.
Line streams continue to update independently for overlay changes. This removes
source-proven redundant O(N) projection/picking work without raising star
limits. Its frame-time benefit is not measured; focused regression cases were
added but not run. Static source review only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 706: identify category-starved 2D label scans (2026-09-27)

The 2D canvas builds labels in a render-time scan that stops only after it finds
18 non-asteroids and 6 asteroids. If either class is underfilled, such as a
large asteroid-heavy exact-state selection, it traverses the entire position
roster although at most 24 detail rows are produced. A new frame already has
its own bulk point pass, so this is an additional O(N) main-thread pass. An
arbitrary scan cap would change the existing first-in-source/category priority;
reliable per-kind counts or candidate ordinals do not currently flow through
all exact-state, selection and concatenation wrappers. No edit or sampling cap
was added. Static source/call-site review only; no tests, builds, simulations,
benchmarks, CI waits, deployment or release ran.

### Checkpoint 707: select budgeted exact states in one source traversal (2026-09-27)

`selectStateDisplayPositions` previously traversed the complete source once to
find priority IDs, then started at the beginning again to fill the display
budget. With large exact-state selections, the second traversal can add up to
the full visible count in repeated `CurrentPositions.bodyAt` calls. The selector
now stages priority and source-order ordinals during one traversal, then packs
the bounded output in place. It keeps the same priority-first/source-order
result, including repeated source identities, and stops early only after all
priority IDs have appeared and the remaining display slots are filled. This
does not change computed-state coverage, renderer ceilings, or draw count; it
reduces selection overhead so more of the measured frame budget can serve
visible bodies. Static algorithm and call-site inspection only; no tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 708: gate render-budget evidence on ready positions (2026-09-27)

The Explorer passed filtered catalog row count to the adaptive budget even
while the point worker had not published positions for the current epoch. The
2D frame sampler also ran while no catalog points were draw-ready. In that
window, fast animation-frame intervals could be mistaken for evidence that the
current body budget had actually been exercised. The budget now uses the
worker's ready-position count, and frame sampling waits for a nonempty,
epoch-aligned point snapshot. The displayed denominator stays the full
filtered catalog count. This keeps capacity promotion evidence tied to stars
that can be drawn, without reducing the configured maximum or altering the
computed positions. Static call-site and source review only; no tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 709: write iOS 3D points into final geometry storage (2026-09-27)

The Android native projector writes reference-relative Float64 coordinates
straight into its final bounded Float32 buffer. iOS 3D first retained a full
`[SIMD3<Float>]` projection and then copied it into the vertex `Data` used by
SceneKit. iOS now fills the final vertex buffer during the exact-state scan and
creates its index data directly, avoiding that intermediate 16-byte per-point
array at the 250,000-point 3D ceiling (4,000,000 bytes at that limit by the
declared SIMD3 stride). The 2D Canvas path and display ceilings are unchanged;
no higher capacity or device-performance claim is made without native-device
evidence. Static source/call-site inspection only; no tests, builds,
simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 710: publish the first verified Web state plan progressively (2026-09-27)

The Web state worker previously withheld every frame until every 32,768-ID plan
had completed. Large selections therefore showed no exact backend positions
while later plans were still being prepared. The Explorer now places reference
identities first, publishes the first fully decoded and provenance-checked plan
only when more than one plan is needed, and then replaces that bounded partial
frame with the complete result. The initial selection is capped at one protocol
plan; identities absent from its evidence stay pending in the existing coverage
ledger, and missing/exact states are derived only from rows actually returned.
The stream is requested only when no complete frame exists for the same source
and selection identity, so playback refreshes keep the previous complete frame
instead of repeatedly replacing it with a smaller chunk. If a later plan fails
after the initial plan is verified, the exact initial frame remains visible
with the load error. Native Android and iOS publication remain all-or-nothing.
The partial worker message clones the first plan's tile buffers while the worker
retains them for the complete result, so this trades a temporary bounded-by-plan
memory copy for earlier display; actual device cost and any capacity increase
remain unmeasured. Static source review and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
deployment or release ran.

### Checkpoint 711: publish verified native prefixes while later plans load (2026-09-27)

Android and iOS now match the Web initial-frame behavior for multi-plan
observations: the reference ID is requested first, and the first frame is
published only after its complete plan and tiles pass the existing protocol,
provenance and digest checks. Later plans replace that bounded prefix with the
complete frame. Android copies only the prefix arrays and refuses the snapshot
when its additional resident estimate would exceed the native state budget.
iOS copies the prefix into independent reserved arrays, charges their measured
capacities to its existing resident estimate, and skips early publication when
the remaining budget is insufficient. Cancellation and later-plan failure keep
an already verified prefix visible; unverified rows never enter it. This lowers
time to first native frame for large selections but does not increase the steady
state render ceiling or establish device capacity. Added source-level checks for
copy isolation and budget refusal. Static source review and `git diff --check`
only; no tests, builds, simulations, benchmarks, CI waits, deployment or release
ran.

### Checkpoint 712: expose loaded-but-undrawn catalog rows (2026-09-27)

The expanded catalog already distinguished admitted rows from GPU submissions,
but did not state the number withheld from the current frame. The status panel
now reports loaded rows not submitted for drawing and explicitly identifies
when the spatial representative limit omits in-view candidates. This is
accounting only: it does not alter source filtering, ephemerides, representatives,
or the render limit. Static source review and `git diff --check` only; no tests,
builds, simulations, benchmarks, CI waits, deployment or release ran.

### Checkpoint 713: bound all-row catalog drawing without thinning computation (2026-09-27)

The all-loaded-rows display previously submitted every retained point to
`drawArrays`, bypassing the configured render budget. Both catalog display modes
now honor the render limit. Spatial mode keeps its screen-cell selection; the
all-row mode uses a worker to select evenly spaced indices in upload order,
prioritizing the focus and located selections. Every row remains in the computed
snapshot; the index selection affects rendering only and is explicitly not a
spatial or statistical sample. During loading above the limit, one bounded view
is retained instead of rescanning each arriving tile; the terminal snapshot is
selected once more so later loaded rows can enter the display. The all-row view
does not recompute selection for camera or viewport changes. Static source
review and `git diff --check` only. Selection unit cases were added but not run;
no tests, builds, simulations, benchmarks, CI waits, device measurements,
deployment or release ran.

### Checkpoint 714: coalesce spatial selection work during catalog loading (2026-09-27)

Static review found that each uploaded tile changed the spatial view key and
posted a replacement worker request. Since a newer view cancels the active
selection at its next cooperative yield, continuous tile uploads could prevent
the representative pass from publishing during a long scan. Spatial selection
now refreshes at geometric row-count milestones; an in-flight pass is allowed
to finish, and a newer milestone is processed from its receipt. The terminal
snapshot still receives an exact final selection. The status panel reports the
row count belonging to each selection pass so candidate counters are not
mistaken for full-snapshot coverage during streaming. Static source review and
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
device measurements, deployment or release ran.

### Checkpoint 715: verify view invalidation and terminal selection routes (2026-09-27)

Static call-site tracing confirms radius, display mode/limit, 3D rotation, focus
and selected-row changes call the renderer immediately; `ResizeObserver` also
redraws on viewport changes. Each changed spatial selection context posts a new
worker view even when an older view is in flight. Normal source exhaustion and
capacity termination both set `loading` false before the final draw; explicit
stop clears the in-flight count and draws the retained snapshot, and appended
rows trigger count-based reselection. No route identified here bypasses the
selection worker for an over-budget spatial frame. `git diff --check` passed;
this was source tracing only, with no tests, builds, simulations, benchmarks,
device runs, deployment or release.

### Checkpoint 716: audit upload ACK and view-selection ownership (2026-09-27)

The worker installs each tile's Float32 culling suffix before publishing it and
records the total computed prefix. The canvas increments its drawable row count
only after appending the matching slices to the renderer; each view request uses
that drawable prefix, and the worker rejects counts beyond its computed prefix.
Later tile writes are append-only suffixes, while selection traverses only its
requested count; cooperative worker yields therefore do not mutate rows already
being scanned. The tile remains inside the bounded transfer-credit window until
the canvas uploads the entire tile and returns its ACK. This is protocol/source
ownership evidence, not runtime race testing or measured cancellation latency.
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
device runs, deployment or release ran.

### Checkpoint 717: trace cancellation, ACK cleanup and stale-response gates (2026-09-27)

Static cancellation-path review found the main thread closes tile and terminal
response acceptance before posting cancel, drops queued-but-not-uploaded tiles,
and invalidates its in-flight view identity. The worker aborts the shared stream
controller and increments the view generation; abort releases transfer-window
credits and clears their timers, allowing blocked publish/drain operations to
observe the abort and reach `finally` disposal. Late tile and terminal messages
are ignored, while stale selection responses fail the in-flight request check.
For a coherent stopped snapshot, retained visual positions remain selectable;
an epoch or append canceled during a partially installed update is discarded as
a unit because its CPU/GPU layout cannot be claimed coherent. The reviewed
append path uses the same abort signal and cancels its pending source
reservation. No specific cancellation fix was justified by this source trace;
it does not establish runtime race behavior or measured stop latency.
`git diff --check` only; no tests, builds, simulations, benchmarks, CI waits,
device runs, deployment or release ran.

### Checkpoint 718: audit the compute-to-render star-count path (2026-09-27)

The retained catalog renderer allocates fixed-capacity position/color/size GPU
buffers once and uploads only each new slice with `bufferSubData`; the canvas
keeps the corresponding CPU attributes for context restoration. When every
loaded point fits the draw limit, the all-points path uses `drawArrays` directly
and does not build identity indices. Above that limit, the worker creates a
bounded deterministic display index while all admitted rows remain computed;
spatial mode also selects from the worker's cached Float32 display coordinates,
not by repeating orbital propagation. The planner explicitly reserves the
estimated CPU/GPU attributes, culling coordinates, selection replacement
high-water, and bounded read/transfer pipeline, while documenting that this is
not a total browser-RSS guarantee. A four-credit ACK window couples further
production to completed GPU uploads. This source structure provides no
measurement-backed basis to enlarge the draw cap or transfer window, and no
clear duplicate full-buffer upload was found. Static review only; hardware
capacity and current-commit throughput remain unverified. `git diff --check`
only; no tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran.

### Checkpoint 719: trace compute, prefetch and view-selection scheduling (2026-09-27)

The ordinary source path keeps four binary-shard reads in a bounded prefetch
queue and refills before validating and propagating the current shard. Each
admitted tile still awaits its upload ACK before the producer advances, so
prefetch can overlap current-shard work but cannot outrun rendering indefinitely.
Propagation checks cancellation and cooperates in 256-row ranges; stream yields
allow worker messages at a 4 ms cooperative cadence. View selection runs in the
same worker and yields through the same message channel during bounded row
batches, while WebGL upload/draw runs on the main thread. Thus rendering can
continue alongside worker computation, but propagation and selection do not
execute on separate worker CPU threads. Name search intentionally serializes
metadata reads and starts binary reads only after metadata matches; raising that
concurrency would need a larger metadata-memory reserve and measured evidence
that search latency is a real target. Static scheduling review only; no fairness,
network throughput, or device latency was measured. `git diff --check` only;
no tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran.

### Checkpoint 720: classify historical capacity reports against current sources (2026-09-27)

The archived application and spatial reports identify the 1,561,171-row MPC
source by content/manifest/checksum hashes and list SHA-256 values for the
implementation files they captured. The 2026-09-22 spatial report does not
record a Git commit or complete tree hash. Each of its four core loading/render
file hashes differs from the current worktree hash, and Git history plus the
current dirty state show later changes to those paths. The reports remain useful
for their exact captured 2D source/build/browser/hardware configuration and for
the measured all-points versus representative-display trade-off. They do not
establish the current worktree's throughput, current capacity ceiling, dynamic
3D performance, public-network behavior, total process memory, or mobile/native
limits. The public performance note now states this boundary. No remeasurement
ran, consistent with the request to defer tests until the full audit/expansion
is ready. `git diff --check` only; no tests, builds, simulations, benchmarks,
CI waits, device runs, deployment or release ran.

### Checkpoint 721: map measured capacity tiers to missing device profiles (2026-09-27)

The newest archived tier set covers desktop Windows Chromium 153 on an RTX
5070 Ti/D3D11 with 512 MiB admission: five 2D spatial row requests from 30,000
through the full 1,561,171-row MPC source, one full-source 3D steady-interaction
window, and one 300,000-row cancellation probe. It supplies sampled JS heap and
frame-callback evidence but not total process/GPU memory or physical FPS. The
set does not cover reduced admission budgets, conservative/mobile profiles,
software rendering on the same revision, or Android/iOS native devices. Its
receipts independently fingerprint built assets and checkout source and state
that equivalence is unestablished; the four core source hashes also differ from
the current dirty worktree. Older SwiftShader observations are not a controlled
same-revision comparison. The tier README now makes these coverage limits and
the distinction from `PERFORMANCE.md` catalog-cloud point policies explicit.
No test or benchmark ran. `git diff --check` only; no builds, simulations, CI
waits, device runs, deployment or release ran.

### Checkpoint 722: compare UI and CLI memory-budget tiers (2026-09-27)

The catalog workspace selector and benchmark CLI expose the same explicit
64/128/256/384/512 MiB tiers, and the harness converts each selected MiB value
to bytes before choosing the matching UI option. CLI value zero is a sentinel
that leaves the UI automatic default untouched, not a sixth UI tier. The
workspace defaults to 256 MiB when the browser memory hint is at most 4 GB or
the viewport is at most 800 px wide, otherwise 512 MiB. Reports store a null
requested tier for this automatic case and separately capture the effective
byte value. No tier-mapping defect was found; the missing evidence is running
those lower explicit tiers and the 256 MiB default profile on their intended
devices. The benchmark README now records this distinction. Static source and
receipt-schema review only; `git diff --check` only, with no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release.

### Checkpoint 723: bound the 64 MiB option against the active source index (2026-09-27)

Static arithmetic on the active 1,561,171-row manifest and planner's fixed
24-byte compact-index stride shows the double-buffered index-assembly reserve
alone is 74,936,208 bytes, exceeding a 64 MiB budget (67,108,864 bytes) before
pipeline, metadata and other reserves. Therefore the active full MPC source
must have zero admitted rows at 64 MiB; the workspace disables its load action
and displays the existing no-budget explanation. The tier CLI option is valid
for smaller source manifests, but a 64 MiB attempt against this active source
is an expected admission rejection, not a performance observation. This is a
planner-bound derivation, not a runtime measurement. The tier README now records
the boundary. No tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran; `git diff --check` remains the only executed check.

### Checkpoint 724: derive the 128 MiB admission floor for the active manifest (2026-09-27)

At 128 MiB, a subset of unconditional `planCatalogStream` fixed reserves
already exceeds the budget: double-buffered index assembly 74,936,208 bytes,
candidate-locator headroom 14,050,539, metadata reserve 33,609,432, pipeline
reserve 5,120,000 and base headroom 8,388,608. The subtotal is 136,104,787
bytes, 1,887,059 above the budget, before spatial bounds, membership,
source-selection and other fixed reserves. Thus the current full MPC manifest
has zero capacity at both 64 and 128 MiB; neither is a usable star-count
throughput tier for this source. The UI intentionally disables load with its
existing no-budget explanation. These options remain meaningful for smaller
manifests. This arithmetic verifies a planner admission bound only, not runtime
memory or performance. The tier README now records both thresholds. No tests,
builds, simulations, benchmarks, CI waits, device runs, deployment or release
ran; `git diff --check` passed.

### Checkpoint 725: derive the active manifest's 256 MiB 2D ceiling (2026-09-27)

Applying the planner's current fixed-reserve formula to the active 1,561,171-row
manifest in 2D with retained epochs/append disabled gives a 256 MiB static
ceiling of 1,332,509 rows; 384 and 512 MiB admit the full source on that model.
The automatic workspace profile selects 256 MiB for at-most-4-GB memory hints
or viewports no wider than 800 px. Its default request is 30,000 rows on the
narrow viewport, but a user-selected full-source request would be partial at
the planned 1.33 million-row ceiling. These values derive from planner math;
they are not observed device memory or performance. The 256 MiB mobile/default
profile remains unmeasured. The benchmark README now distinguishes this static
admission envelope from measured capacity. No tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran; `git diff --check`
passed.

### Checkpoint 726: derive 3D and retained-epoch admission ceilings (2026-09-27)

With append reservations disabled and a full-source request, current planner
arithmetic yields these 256 / 384 / 512 MiB caps: 2D without epoch retention,
1,332,509 / 1,561,171 / 1,561,171; 3D without retention,
1,144,103 / 1,561,171 / 1,561,171; 2D with retained epochs,
621,803 / 1,499,043 / 1,561,171; 3D with retained epochs,
576,433 / 1,389,874 / 1,561,171. This follows the planner's 73/85-byte
static row charges and additional 80 bytes per retained-epoch row plus its
fixed reserve. Thus 384 MiB fits all rows only without epoch retention, while
512 MiB fits all four planner configurations. These ceilings do not include
append reservations and are not measured memory, throughput or device claims.
The benchmark script has no retained-epoch option, and the UI defaults that
setting off, so the retained-epoch matrix rows are not backed by a matching
runtime receipt. The tier README now shows the matrix and labels these rows as
derived; mobile/default and retained-epoch observations are still missing. No
tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran; `git diff --check` passed.

### Checkpoint 727: make retained-epoch benchmark configuration explicit (2026-09-27)

The catalog benchmark's new `--retain-epochs` option now explicitly checks or
unchecks the UI control to match the requested mode, then verifies the effective
state. Success and failure receipts record requested and effective settings;
epoch advancement remains marked `not-measured`. This avoids silently tying a
no-retention run to a future UI default and makes retained-storage receipts
classifiable when deliberately run after the wider audit is complete. The tier
README states the option is available but has not been exercised; the planner
matrix remains formula-derived. Static source/document review only; no tests,
builds, simulations, benchmarks, CI waits, device runs, deployment or release
ran. `git diff --check` only.

### Checkpoint 728: audit progressive spatial display during catalog loading (2026-09-27)

The spatial view now requests an initial selection as soon as rows are available,
then schedules loading-time refreshes when the loaded-row count doubles. It keeps
an in-flight selection instead of canceling it for every uploaded tile, and the
terminal refresh catches the final admitted rows. This lets the visible
representative set grow before a long catalog load completes while limiting
refresh frequency for an unchanged view. Each selection still examines some or
all accumulated rows, so this is a scheduling bound, not a measured speedup;
camera changes can request fresh work. The interface and benchmark receipt now
separate computed rows, representative rows submitted to draw, selection
snapshot size, and spatial rows screened versus skipped by whole block. Worker
selection time excludes GPU submission/draw. Static control-flow review only;
no tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran. `git diff --check` only.

### Checkpoint 729: bind progressive selection receipts to their requested snapshot (2026-09-27)

The catalog UI now requires each selection response to report a positive safe
integer row count equal to the exact snapshot size requested for that worker
request and no greater than rows already uploaded. A mismatched current response
is treated as a protocol failure instead of a plausible partial selection; an
older request ID still follows the stale-response path. Spatial mode must return
both screened and block-skipped row counters, while all-points mode must not
claim those spatial counters. This protects progressive display counts and future
benchmark classification without changing row, memory or drawing limits. Static
review only; no tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran. `git diff --check` only.

### Checkpoint 730: grow all-points representatives while loading (2026-09-27)

The all-points display path now starts a bounded representative selection as
soon as the loaded catalog exceeds its existing draw budget, then refreshes at
geometric row-count milestones without canceling an in-flight selection. Once
loading stops it requests the final admitted snapshot. Below the draw budget it
continues submitting all loaded points directly; above it, the configured cap
and deterministic selection policy remain unchanged. This makes additional
computed rows visible during long loads in both spatial and all-points modes
without raising memory or draw limits. Static scheduling review only; this is
not a throughput or frame-time measurement. No tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran. `git diff --check`
only.

### Checkpoint 731: preserve all-points imagery during representative refresh (2026-09-27)

When all-points mode first crosses its draw cap or its selection context changes,
the renderer now keeps the last valid point selection while the worker prepares
the replacement instead of uploading an empty selection. The UI labels the
pending representative update and suppresses selection counters until the new
receipt arrives. At the first draw-cap crossing, the existing renderer budget
continues to limit the temporary direct draw; it does not increase the cap.
This removes a structurally identified blank-frame interval without changing
scientific state or claiming faster worker selection. Static source review only;
no tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran. `git diff --check` only.

### Checkpoint 732: retain coherent representatives during viewport selection (2026-09-27)

Spatial mode now keeps its last valid selection while a new camera, focus or
selection context is being processed. Those indices still address the same
append-only coherent snapshot; the displayed-row count remains the number
actually submitted, while viewport-candidate and selection-work figures are
hidden until the new receipt arrives. The updating label remains visible. Epoch
replacement continues to hide coordinates until all uploaded positions are
coherent, and a new source gets a new renderer. This removes an avoidable blank
canvas on ordinary viewport changes without retaining stale-epoch data or
raising draw limits. Static lifecycle review only; no tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran. `git diff --check`
only.

### Checkpoint 733: verify selection recovery after source cancellation (2026-09-27)

Static message-order review confirms that user cancellation stops admitting new
tiles, clears the client in-flight selection marker, marks loading complete and
requests a fresh view of the retained uploaded snapshot. The worker increments
its view generation for cancel and view messages, so an older cooperative
selection cannot publish after the fresh request; its loop can then process the
new pending view using the retained spatial rows. The client rejects receipts
whose request ID no longer matches and ignores queued source-terminal messages
after tile admission closes. Rows lacking upload ACK were never added to the
client draw count and are excluded from this recovery request. No cancellation
or browser runtime test ran; static lifecycle review and `git diff --check` only.

### Checkpoint 734: disclose the bounded direct-draw fallback (2026-09-27)

When the catalog selection worker fails after a user has stopped loading,
spatial screening is unavailable and the renderer can still directly draw the
retained uploaded rows. If the row count exceeds the draw cap, that fallback is
an upload-order prefix, not the normal viewport or even-spacing representative
selection. The alert now states this limit, and exported display policy records
the direct-row or prefix fallback instead of claiming worker selection ran.
This is a provenance/interpretation correction; it does not raise computed-row
or draw limits. Static source review only; no tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran. `git diff --check`
only.

### Checkpoint 735: separate computed-row and rendered-point ceilings (2026-09-27)

Static workspace review confirms that computation and rendering already have
independent controls: desktop requests default to the manifest's full row count
under the 512 MiB profile, and the point-display selector can be raised from
100,000 to the full manifest count. The narrow/mobile default requests 30,000
rows under 256 MiB; planner math admits up to 1,332,509 rows for the active
2D, no-retained-epoch configuration, but this is only an allocation estimate.
Archived large-catalog rendering receipts do not fingerprint the current dirty
source, and there is no current-revision mobile or total-memory evidence. Thus
the display cap is user-adjustable today, while a larger global default or
mobile default is not justified by the available evidence. A future capacity
change needs same-revision rendering, memory and frame-tail measurements at
each intended device tier. No tests, builds, simulations, benchmarks, CI waits,
device runs, deployment or release ran; `git diff --check` only.

### Checkpoint 736: recheck the live issue and pull-request backlog (2026-09-27)

The live repository remains `dajiaohuang/solar`, with issues enabled and
`main` as the default branch. The only open issue is #109, and its owner comment
explicitly keeps it open while same-revision hardware/frame-time and scientific
reference-oracle/boundary evidence remain outstanding. Those acceptance gaps
still match the current scientific-expansion goal, so closing it would misstate
completion. There are no open pull requests to merge or close. This was a
read-only live metadata/owner-comment check; no issue or PR was modified and no
tests, builds, benchmarks, CI waits, deployment or release ran.

### Checkpoint 737: keep failure-fallback counts truthful (2026-09-27)

After a stopped catalog selection worker fails, the bounded direct-draw fallback
now records the number of rows actually submitted when the renderer draw
succeeds; a failed draw records zero. Spatial availability remains explicitly
false, so these rows cannot be mistaken for a completed viewport selection.
The canvas diagnostic count now agrees with the retained snapshot and configured
draw ceiling without presenting prefix rows as representatives. Static message
and state review only; no tests, builds, benchmarks, CI waits, device runs,
deployment or release ran.

### Checkpoint 738: distinguish manual stream limits from adaptive budgets (2026-09-27)

The reusable adaptive render-budget hook is currently wired into
`ExplorerWorkspace`, while the high-volume `CatalogStreamCanvas` view receives
a manually selected point cap and does not publish active-view frame-tail
measurements to that controller. The user can raise its cap to the full
manifest, but this path has no runtime feedback that would safely grow or reduce
that cap under a live catalog workload. Reusing the existing global animation
frame sampler without tying samples to actual catalog redraws could mistake an
idle canvas for headroom, so no speculative controller wiring or default change
was made. The precise remaining work is a same-revision, active-draw measurement
contract before adaptive cap decisions. Static call-site review only; no tests,
builds, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 739: enforce a lowered draw cap during selection refresh (2026-09-27)

Changing the display limit invalidates and replaces the worker selection, while
the renderer intentionally retains its previous indices during that refresh.
The draw call previously used the retained selection's full length and ignored
the new `maximumPoints` argument, so reducing the limit could exceed the chosen
cap for a transition frame. Indexed drawing now submits at most the smaller of
the retained selection length and the caller's current cap. The old selection
remains visible until replacement, without transiently exceeding the draw
budget. Static call-path review only; no tests, builds, benchmarks, CI waits,
device runs, deployment or release ran.

### Checkpoint 740: audit Float64 science to Float32 display boundaries (2026-09-27)

Static paths keep catalog propagation and transported scientific positions in
Float64, then create separate Float32 copies for the GPU and worker culling
index. The streaming star map uses heliocentric ecliptic coordinates centered
on the Sun; the interactive 3D pane subtracts its selected heliocentric origin
from catalog positions before Float32 conversion, while current-state rows are
already expressed in the selected reference frame. Gaia plotting similarly
projects Float64 ICRS directions around the requested tangent-plane center
before rounding display offsets. No Float32 display copy is written back into
the orbital-element, current-state or Gaia source storage. The stream's
64-ULP-scaled clip margin and doubled spatial-bound padding are conservative
engineering guards, explicitly not a certified hardware precision bound.
No coordinate or precision change is indicated by this source audit; actual
GPU edge agreement and device precision remain runtime/reference checks. No
tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran.

### Checkpoint 741: rebase backend catalog views into heliocentric coordinates (2026-09-27)

The checkpoint 740 source review missed a mixed-origin path: MPC catalog positions
are heliocentric, while exact backend state evidence is stored in the solar-system
barycentric frame. Subtracting a barycentric reference position directly from an
MPC point offsets the cloud by the Sun's barycentric position. Catalog display
origins now compute `referenceSSB - sunSSB` in Float64 before 2D/3D geometry
rounds positions for display. While the catalog cloud is enabled, state-tile
selection requests the Sun as a hidden transform dependency, without adding it
to the visible selected-body list; with the cloud off, it no longer spends a
state-plan row on that transform.
If the selected reference state is unavailable, the scene remains unavailable.
If only the Sun transform is missing, the catalog layer is suppressed while
other scene layers continue. This corrects the backend path. Primary contracts
confirm the MPC heliocentric/J2000-ecliptic source
convention and the NAIF backend state origin: [MPC orbit format](https://docs.minorplanetcenter.net/mpc-ops-docs/orbits/minor-planet-orbit-format/),
[MPC Cartesian-state conversion](https://docs.minorplanetcenter.net/tutorials/notebooks/mpc_tutorial_orbit_to_assist/),
and [NAIF `spkssb_c`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkssb_c.html).
A same-epoch numeric MPC/backend comparison and device rendering remain later
runtime/reference checks. Static source review only; no tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 742: preserve available rows at the final draw-budget split (2026-09-27)

The adaptive policy rounds budget adjustments to 5,000-point steps, but the
final split rounded a single-pane draw count down a second time and rounded each
comparison pane independently. A single view therefore drew zero of any sample
below 5,000 rows, while an arbitrary comparison sample could lose almost 10,000
available rows. Final allocation now preserves every available row for a single
view; comparison views preserve equal shared prefixes and can leave at most one
odd row unused. The source-level regression expectations in
`tests/unit/render-budget.test.ts` still describe the old output and must be
updated during the deferred final test phase. No tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 743: refresh the catalog sample when the viewport tier changes (2026-09-27)

The sample hook resolved desktop/mobile profile only when its manifest or URL
request changed. A user who widened a mobile viewport therefore kept the smaller
8,000-row source sample even though the desktop artifact is available; narrowing
had the reverse stale-profile behavior. The hook now tracks viewport resize and
the coarse-pointer breakpoint, then reloads the profile selected by the current
device class. Explicit URL profile/count requests remain authoritative because
the resolver still prioritizes them. Preview builds keep their fixed profile.
No tests, builds, benchmarks, browser interactions, deployment or release ran;
the profile-switch lifecycle remains for the final test phase.

### Checkpoint 744: identify the full-stream Explorer integration boundary (2026-09-27)

The high-volume catalog stream and Explorer share the same Float64 MPC
propagation, but not a directly reusable render surface. Stream tiles carry
heliocentric Float64 positions and compact appearance bytes; `CatalogStreamCanvas`
owns a separate WebGL context and uploads bounded Float32 slices through its
orthographic point shader. Explorer 2D converts source positions through its
pan-aware `viewProjection` into the trajectory canvas's clip-space buffers, while
Explorer 3D subtracts the selected origin in Float64, converts ecliptic XYZ into
Three.js XZY, and renders through a perspective camera with orbit controls.
Passing the stream canvas or its GPU buffers directly into Explorer would use a
different context and camera transform. A correct larger Explorer cloud must feed
the Explorer's own point layer with the stream's cancellable tiles and appearance
metadata, while sharing its current epoch, origin, camera and draw budget. This
boundary review is static only; no tests, builds, benchmarks, browser runs,
deployment or release ran.

### Checkpoint 745: isolate catalog-origin failure from the Explorer scene (2026-09-27)

The reference-state gate previously doubled as the catalog-origin gate. When the
catalog overlay was enabled but the exact Sun state was unavailable, that made
`catalogOrigin` null and hid otherwise valid selected-body and trajectory
layers. Explorer now gates the scene on the selected reference position, gates
only the heliocentric catalog overlay on the Sun transform, reports the two
missing-state cases separately, and passes empty catalog buffers while that
overlay cannot be placed. The state-tile request still includes the Sun only
when the overlay is enabled. Static source review and `git diff --check` only;
no tests, builds, simulations, benchmarks, CI waits, device runs, deployment
or release ran.

### Checkpoint 746: correct catalog-worker capacity accounting (2026-09-27)

The performance guide described the Explorer point-worker transfer as Float32,
but its active worker path allocates and transfers Float64 heliocentric
positions so each reference pane can subtract its exact origin before GPU
rounding. The guide now distinguishes the Float64 worker result from Float32
GPU geometry and records the known typed-array lower bounds: 64 bytes per row
for transferred source elements, 80 for prepared worker coefficients during
initialization, then 16/24 for the 2D/3D result. JavaScript records, GPU
geometry, prior-epoch overlap and process overhead remain outside those byte
counts. Static source arithmetic and `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 747: keep the Explorer sample and full-stream limits distinct (2026-09-27)

Source review confirms that the Explorer adaptive draw ceiling is not its loaded
catalog capacity: it uses immutable 30,000-row desktop / 8,000-row mobile
samples. The Catalog workspace has a separate budgeted stream and renderer, up
to the active source inventory. That stream cannot be passed directly to
Explorer because it owns another WebGL context and camera. The Explorer 2D
viewport also scans the active draw prefix on each new point epoch for an exact
cloud radius. Changing that scan to a conservative bound could alter framing;
no such change is justified without profiling and a source-equivalent extent
comparison. The stream already bounds shard reads and tile uploads separately
at four in flight and cooperatively yields to worker messages after about 4 ms;
its planner reserves for those windows. Changing the concurrency constant alone
would invalidate that admission arithmetic. Static source review and `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 748: let measured pressure reduce an undersized Explorer sample (2026-09-27)

The adaptive policy's normal floors (25,000 mobile / 50,000 desktop) exceeded
the loaded Explorer samples (8,000 mobile / 30,000 desktop). Its slow-frame
logic reduced the internal policy count but `min(policyCount, readyCount)` kept
drawing every loaded row, so that feedback could not relieve pressure. Slow
windows now reduce from the actually exercised count when the source sample is
below the normal policy floor, with a 2,000-row global floor (or the smaller
available sample); undersized samples use 1,000-row quantization, and fast
growth no longer snaps back to the normal floor before it is exercised. The
focused regression source now asserts the resulting 7,000-row draw count for a
10,000-row sample. Static control-flow review and `git diff --check`
only; no tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran.

### Checkpoint 749: sample Explorer 2D frame cadence from the live canvas

The 2D budget hook and the continuously drawing canvas could both report RAF
intervals into the same adaptive window, double-weighting periods where the
simulation state was also continuously repainting. The hook-level sampler has
been removed. The primary 2D canvas now samples through its own RAF loop: it
draws when continuous rendering is active, otherwise it observes cadence only
while the catalog cloud workload is active. Both paths require a mounted draw
callback and a live WebGL context; comparison's secondary canvas does not add a
second sampler. Static callback/data-flow review and `git diff --check` only;
no tests, builds, simulations, benchmarks, CI waits, device runs, deployment
or release ran.

### Checkpoint 750: audit SBDB covariance semantics against JPL's API contract

The current parser's critical epoch/axis handling matches the official JPL
[SBDB API v1.3 covariance contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html):
`cov=mat` is the full matrix form with au/degree/day units; its labels start
with the six orbital elements and may continue with estimated dynamical model
parameters; covariance is only valid at the solution epoch, with corresponding
solution-epoch elements supplied when the main orbit epoch differs. The parser
requires the covariance epoch and refuses to substitute standard-epoch elements.
The coordinate conversion explicitly adopts and receipts solar GM, and labels
its transform first-order and solution-epoch-only. The time propagator explicitly
rejects sources with any extra covariance axes until matching force derivatives
exist; this leaves estimated comet nongravitational-parameter uncertainty
unpropagated and remains a real scope gap, not completed coverage. Static source
review against the primary API documentation only; no tests, builds, simulations,
benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 751: delimit the source requirements for comet force propagation

The official [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
defines `A1/A2/A3` as radial, transverse and normal non-gravitational
accelerations in au per day squared. It gives the JPL water-ice sublimation law constants
(`R0`, `ALN`, `NM`, `NN`, `NK`) and separately documents a deliberately selected
inverse-square law; `DT` is another comet-only lag parameter. At this audit,
the SBDB parser retained extra covariance-axis names but did not expose all
fixed/considered model parameter values needed to reproduce the fitted comet
force law. Adding default A values or propagating those axes would therefore be
unsupported. The law requires a source-specific implementation and matching
force/parameter derivatives; lagged or custom laws remain separate limits.
Source inspection and the official Horizons manual only; no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 752: preserve SBDB model parameters outside covariance axes

The normalized SBDB source now retains every `model_pars` entry separately from
the covariance axis order: index, `SET`/`EST`/`CON` kind, value, units, sigma,
title and description. The solution-epoch covariance result carries the same
source list; receipt binding reconstructs it from the submitted original SBDB
payload with the same bounded schema parser and checks the copy nested in the
coordinate-conversion receipt. The conversion boundary rejects missing,
duplicate or malformed model parameters and requires each extra covariance
axis to match an estimated model parameter's value and units. The uncertainty
page displays the list separately so fixed or considered parameters are not mistaken for random
covariance axes. Focused regression
source now covers Bennu's RHO/AMRAT records and an A2 axis lacking optional
metadata, and direct conversion-source mutations. This does not add comet forces
or make extra-axis temporal propagation supported. Static source review and
`git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 753: pin a current JPL comet covariance and trace its force gap

The [official SBDB API response](https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=67P&full-prec=true&cov=mat)
for 67P/Churyumov–Gerasimenko was retrieved on
2026-09-27 and pinned as `tests/fixtures/sbdb-67p-covariance.json` (SHA-256
`65e96d6b7950e1712131969d591d3234cb3956a0ef99803734366407aea81295`). It is
JPL solution `K284/1`, dated 2026-09-04, with a 10×10 covariance over
`e,q,tp,node,peri,i,A1,A2,A3,DT`; the four extra axes are estimated parameters
with units and sigmas. Parser regression source now checks the exact joint
labels, units, parameter values and matrix, and dynamics regression source
asserts that this real input is still rejected instead of silently propagated
without its force derivatives. These test sources were not run.

The [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
documents the default water-ice model constants as appropriate for JPL cometary
`A1/A2/A3` data-fit solutions, a separate inverse-square law, and `DT` as the
activity-peak offset. The SBDB record itself does not list `R0/ALN/NM/NN/NK`;
the law selection must therefore be explicit in the force-model receipt and
limited to compatible source provenance. `DT` is the asymmetric activity-peak
shift described by [Yeomans and Chodas (1989), NASA NTRS](https://ntrs.nasa.gov/search.jsp?R=19890064375);
it and the radial law need their state/parameter derivatives. Current
`de440Dynamics` still has no comet force, while `covariancePropagation`
deliberately requires a six-axis source. This real case narrows the target to a
source-aware JPL water-ice plus lag implementation and a joint 10-axis
variational path; it does not establish either as complete. Static source and
payload-contract inspection plus `git diff --check` only; no tests, builds,
simulations, benchmarks, CI waits, device runs, deployment or release ran.

### Checkpoint 754: derive the lag and augmented-variational requirements

The primary [Chesley and Yeomans ESM paper](https://doi.org/10.1017/S1743921304008786)
defines the comet acceleration in the heliocentric RTN frame as
`g(r)(A1 eR + A2 eT + A3 eN)` and applies `DT` by evaluating `g` at a shifted
heliocentric radius. Its text extraction writes the shift as `r(t + DT)`, while
the same paper identifies 67P's fitted `DT ≈ +47 d` as a post-perihelion peak;
the pinned JPL solution gives `+45.6667 d`. The physical-time sign and exact
state history used for that shifted radius must be resolved from the typeset
equation or authoritative implementation before coding. This distinction
matters: evaluating a past numerical trajectory needs dense history, which the
current Dormand–Prince implementation explicitly does not provide.

The current integrator accepts arrays up to 512 components, but the dynamics
derivatives accept only 6 or 42 components, `withIdentityTransition` always
creates a fixed 6×6 transition matrix, and transition-matrix integrity accepts
exactly 36 values. Thus adding a 10-axis SBDB covariance requires a 6×10
sensitivity matrix, source-parameter forcing columns, shape-bound receipt
integrity, and the position and velocity Jacobians of the RTN directions; a
larger state array alone would silently leave `A1/A2/A3/DT` sensitivities zero.
The standard JPL water-ice law and its constants are documented in checkpoint
753, but these structural and `DT` semantics remain unresolved. Static source
and primary-literature review only; no tests, builds, simulations, benchmarks,
CI waits, device runs, deployment or release ran.

### Checkpoint 755: settle the physical sign of cometary `DT`

The peer-reviewed 67P orbit study by Kramer and Läuter (2019, A&A 630, A4)
explicitly defines the shifted solar distance as `r' = r(t - Δt)`, then
integrates the equation of motion with that Marsden acceleration. Because the
activity law reaches its maximum at perihelion distance, `Δt > 0` moves that
maximum to `t = t_perihelion + Δt`; this agrees with the original Yeomans and
Chodas description of a peak after perihelion and the pinned JPL 67P fit. The
earlier extracted `r(t + DT)` in checkpoint 754 is inconsistent with this
primary equation and its post-perihelion example, so it is not the convention
to implement. Sources: [Kramer and Läuter 2019](https://doi.org/10.1051/0004-6361/201935229),
[Yeomans and Chodas 1989](https://ntrs.nasa.gov/search.jsp?R=19890064375), and
the [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).

The remaining implementation boundary is the delayed-radius history and its
provenance at the integration epoch. The paper describes integrating the
non-gravitational equation but does not, in the accessible text, specify how
the history on `[t0 - DT, t0]` is initialized for a newly supplied state.
Using the evolving trajectory literally requires dense trajectory history and
a history source; using an osculating Kepler arc instead would be a distinct
approximation that must be named and validated against the source solution.
The current integrator has no dense output, and the comet force plus 10-axis
SBDB variational path remain unimplemented. Static primary-source and source
review only; no tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran.

### Checkpoint 756: separate computed inventory from individually drawable bodies

The catalog path already separates source rows admitted/computed from points
submitted to the renderer. Its spatial mode chooses one exact source row per
occupied projected screen cell. The worker's `visible` counter includes points
inside the viewport plus its clipping margin; `edgeCandidates` counts the
margin-only subset. A historical full-inventory run loaded all 1,561,171 MPC rows;
at its 545 by 698 pixel viewport and 100,000-point ceiling, spatial selection
submitted 34,505 representatives. The all-points software-renderer run was much
slower (3,553.5 ms snapshot; callback P95/P99 66.7/83.4 ms); the representative
run was 1,536.8 ms with 16.8/16.8 ms callback P95/P99 on SwiftShader, and
16.8/16.8 ms on the separately measured NVIDIA renderer. These measurements
are explicitly stale for the current worktree: the four loading and rendering
source hashes changed after that run.

This makes a larger numeric representative ceiling alone an ineffective fix
for the measured view: the selection is already limited by occupied screen
cells, not by 100,000. Drawing more overlapping source points may increase
fragment work without making more bodies individually resolvable. The evidence
supports retaining the computed source inventory and exact visible count; it
does not yet support raising the individual-draw policy. A useful next design
candidate is a separate, count-preserving screen-cell density layer alongside
the exact representative/focus layer, so every in-view source contributes to
the overview while individual coordinates remain available for selection and
scientific calculations. This is a design finding, not an implemented renderer
or a performance claim. Static source and historical-report audit only; no
tests, builds, simulations, benchmarks, CI waits, device runs, deployment or
release ran.

### Checkpoint 757: report only mathematical-viewport bodies as in-view

The canvas previously displayed the worker's combined viewport-plus-margin
candidate count under the "in view" label, even though it separately received
the margin-only count. It now subtracts `edgeCandidates` for the in-view label,
the spatial-limit notice, and the exported `viewportCandidates` field. Edge
margin representatives remain eligible for drawing and stay separately
reported; selection and admission behavior are unchanged. Static data-flow
review only; no tests, builds, simulations, benchmarks, CI waits, device runs,
deployment or release ran.

### Checkpoint 758: distinguish parallel shard reads from serial orbit computation

`catalogStreaming.ts` admits four concurrent binary reads, but one ordered
shard loop performs validation, exact filtering, selected-row packing, orbital
coefficient preparation, Kepler propagation and tile delivery. Cooperative
yields keep that worker responsive; they do not compute multiple shards at the
same time. The admission planner reserves scratch for four reads and one active
compute shard, plus the bounded transfer window. A compute-worker pool is a
plausible way to calculate more bodies per unit time, but multiplying active
shard scratch without changing this reservation would invalidate the current
memory budget. Any later pool must bound its worker count and scratch, retain
deterministic source-order publication, and keep the renderer's separate draw
budget. Static call-path and allocation-reservation audit only; no tests,
builds, simulations, benchmarks, CI waits, device runs, deployment or release
ran.

### Checkpoint 759: reconcile the live issue and pull-request queue

After fetching `origin`, GitHub reports #109 as the only open issue. Its current
acceptance criteria match the continuing science and scale goal, and its owner
reopened it because real-device frame/memory evidence and independent science
oracles were still missing; it remains open. There are no open PRs. The only
closed, unmerged PRs are #112, superseded by merged #111 and the current Pages
capacity gate, plus #75/#78, superseded by merged #81/#82 dataset pins. The
remaining closed PRs are merged; closed issues remain closed. No queue item
needs merging or further closure based on this inventory.

The fetched remote default branch is protected; local `main` is 103 commits
ahead and the worktree also contains a large dirty change set. A push to `main`
triggers `.github/workflows/deploy.yml`, so publishing now would violate the
explicit deployment pause. Keep the committed work local until deployment can
be held safely or the pause is lifted; continue implementation and verification
without deploying. Static GitHub metadata, branch-protection and workflow-trigger
inspection only; no tests, builds, simulations, benchmarks, CI waits, commits,
pushes, deployment or release ran.

### Checkpoint 760: reduce sparse all-row display selection work

Static tracing found that `selectCatalogAllPoints` scanned every uploaded row
even when its deterministic evenly-spaced display retained a much smaller
subset. It now computes the same midpoint ranks directly among unpinned rows,
maps those ranks through a bounded sorted pin list, and merges pinned/sample
indices in place. Selection traversal now scales with the number of submitted
points plus at most 257 pins instead of all loaded rows; the output array stays
the only row-sized index allocation. Static formula and ownership review
confirms source-order output, focused/selected priority, visible count, and
cooperative cancellation are retained. No tests, builds, simulations,
benchmarks, device runs, CI waits, commits, pushes, deployment or release ran;
runtime speedup and million-row device behavior remain unmeasured.

### Checkpoint 761: verify the retained-epoch speed bound

Derived the catalog model's speed bound from its own Kepler propagation:
`M = n(t-T)`, `dE/dt = n/(1-e cos E)`, and the orbital-plane coordinates
`x = a(cos E-e)`, `y = a sqrt(1-e^2) sin E` give
`|v|^2 = (a n)^2 (1+e cos E)/(1-e cos E)`. For `0 <= e < 1`, its maximum is
the periapsis value `a n sqrt((1+e)/(1-e))` used by
`catalogOrbitMaximumSpeedAUPerTtDay`; orthogonal orbital-plane rotation
preserves the norm. Integrating this global cap bounds displacement in the
unchanged ideal two-body model over the larger of the directly differenced TT
interval and the interval between converted TT epochs. Unsupported and
overflowing inputs disable reuse. The source and UI explicitly exclude
observational/physical uncertainty and solver/GPU floating-point error, so this
is a temporal model-displacement allowance, not a state-accuracy certificate.
No code change was justified. Static derivation and source/label inspection
only; no tests, builds, simulations, benchmarks, CI waits, commits, pushes,
deployment or release ran.

### Checkpoint 762: expose retained-epoch worker timing

Static tracing confirmed the refresh path is strictly single-buffered: each
16,384-row transfer tile is computed in 256-row cooperative slices, then the
worker waits for the main thread to upload it and return the same Float64
buffer before computing the next tile. Initial catalog loading has a separate
four-credit transfer window; it does not apply to epoch updates. Existing
`benchmark-catalog-stream.mjs` reports `epochUpdates: not-measured` and its
captured runs use one fixed epoch, so the serialization is a demonstrated
pipeline boundary but not yet a measured bottleneck.

Added worker receipt intervals for propagation plus cooperative yields,
transferred-tile ownership/ACK wait, retained-position ACK wait, and total
worker wall time; the UI rejects missing, negative or non-finite counters.
Documented that these are diagnostic intervals, not GPU execution or FPS
measurements. This provides the evidence needed before changing credits or
scratch capacity. Static source, protocol and whitespace review only; no tests,
builds, simulations, benchmarks, CI waits, commits, pushes, deployment or
release ran. No speedup is claimed.

### Checkpoint 763: bounded real playback sampling in the catalog benchmark

Added the opt-in `--epoch-seconds 5..300` benchmark window, which requires
`--retain-epochs` and rejects simultaneous steady-interaction or cancellation
sampling. It enters Explorer, starts the actual simulation clock, navigates to
Catalog, and keeps the default fixed-epoch route unchanged. The Worker wrapper
captures source-load completion separately from later uploads, then records
bounded per-request start/tile/reuse/done/error receipts, supersession, rows,
worker timing, frame-callback intervals, and attribute/index upload deltas.
The report schema is now version 6 and fingerprints the clock, workspace,
temporal store, Worker and canvas sources involved in the observation.

Documentation distinguishes this future measurement from existing fixed-epoch
receipts and states that worker wall time and headless callback cadence are not
GPU time, physical FPS, or accuracy evidence. Static code and report-contract
review only; no tests, builds, benchmarks, simulations, CI waits, commits,
pushes, deployment or release ran. The playback measurement remains unobserved.

### Checkpoint 764: distinguish computed rows from settled renderer rows

Static tracing found that `data-display-count` is set to zero as soon as an epoch
starts and is restored only after the epoch completes and the matching display
selection is installed. The `complete`/`limited` phase can return before that
selection settles, so an endpoint-only benchmark snapshot could report an
apparently loaded catalog while the renderer remains blank or pending. The
attribute is the selected point-row count submitted to drawing; it is not a
pixel-visible body count, and all-points mode may include offscreen rows.

The bounded playback receipt now samples phase, source rows, renderer rows,
selection rows, pending state and any computed Julian-day label every 100 ms.
It reports the fraction of samples with a settled display state and row-count
distributions, while labeling these as headless DOM occupancy evidence rather
than physical presentation. The sample and single-pixel-readback overhead are
called out. Static source review, syntax parsing and whitespace checks only; no
tests, builds, benchmarks, simulations, CI waits, commits, pushes, deployment
or release ran.

### Checkpoint 765: expose target-to-computed simulation-time separation

Static source tracing confirmed that `CatalogWorkspace` samples the running
`SimulationClock` every five seconds and passes that target into
`CatalogStreamCanvas`. The canvas updates its latest-target ref while an epoch
is busy, then requests that newest value only after the current frame and its
presentation callbacks finish. This is request coalescing, not concurrent epoch
worker dispatch.

Added nonvisual canvas data attributes for the latest target Julian day and the
configured temporal displacement budget. The bounded playback samples now
compare that target with the currently published uniform computed epoch and
report signed simulation-time separation. The receipt identifies the fixed
playback start/rate and states that this gap is not wall-clock latency or orbit
error; a positive displacement-reuse budget can make it intentional. Static
source tracing and report review only; no tests, builds, benchmarks, simulations,
CI waits, commits, pushes, deployment or release ran.

### Checkpoint 766: preserve mixed computed epoch ranges in playback receipts

Static review found that the published single-epoch label is intentionally
absent when temporal reuse leaves retained blocks at different computed dates.
The playback sampler now reads the canvas's block-evidence minimum and maximum
Julian days as well as its separate maximum displacement in AU. Its report
summarizes the signed target-to-range separation in simulation seconds and
retains explicit second and AU units. Updated the benchmark-method notes for
this interval. Static source and whitespace checks only; no tests, builds,
benchmarks, simulations, CI waits, commits, pushes, deployment or release ran.

### Checkpoint 767: relate settled display rows to loaded catalog rows

The bounded playback receipt now retains the active display mode and summarizes
loaded source rows alongside selected renderer rows, including settled samples.
It reports the settled selected-to-loaded ratio with an explicit caveat: the
ratio describes display coverage for that mode, not visible pixels or scientific
sampling quality. It applies no adaptive cap or automatic throttling. Static
source and whitespace checks only; no tests, builds, benchmarks, simulations,
CI waits, commits, pushes, deployment or release ran.

### Checkpoint 768: remove the epoch display scratch-to-cache copy

Static source tracing found that every recomputed epoch slice was converted
from Float64 into a temporary Float32 array, uploaded, then copied again into
the existing Float32 CPU restoration snapshot. Epoch slices now stop at the
current restoration-tile boundary, convert directly into that retained array,
and upload the same Float32 view. This removes one per-row Float32 CPU copy and
the temporary slice allocation while preserving Float64 Worker-buffer
ownership, bounded frame slices, existing restoration storage, and the renderer's
finite-coordinate validation. This is a source-level optimization claim only;
no tests, builds, benchmarks, simulations, CI waits, commits, pushes, deployment
or release ran.

### Checkpoint 769: establish catalog GPU coordinate origin and precision boundary

Static tracing followed the stream from Float64 elliptic propagation in
heliocentric ecliptic AU through Float32 culling and vertex attributes to the
3D shader's rotation. The current camera zooms/rotates about the Sun and exposes
no translated origin, so the stored values are already Sun-relative for this
view; no rebase change is justified by the current camera model. The Float32
screening margin is conservative for viewport arithmetic on stored coordinates,
not a restoration of source Float64 precision or a certified position/angle
bound, especially when large rotated terms cancel in the screen plane. The
catalog temporal notes now state this boundary and the evidence required before
adding a translated observer/camera origin. Source inspection only; no tests,
builds, benchmarks, simulations, CI waits, commits, pushes, deployment or release
ran.

### Checkpoint 770: count every in-viewport body in the spatial display (2026-09-27)

The spatial renderer previously submitted one exact source point per occupied
screen cell, so increasing its numeric ceiling could not show the population
behind collisions. It now keeps that representative/focus layer intact and
adds a second visual channel: a translucent logarithmic count overlay over at
most 65,536 equal-area projected bins. The worker increments one bin for each
mathematical-viewport source row, including pinned rows, and excludes numerical
edge-margin-only candidates. The main thread verifies the exact sum against
`visible - edgeCandidates` before drawing; export receipts retain the source-row
total, occupied-cell count and grid size. This gives all in-view records a
count-preserving place in the overview without claiming individually resolved
positions, depth-normalized physical density or event probability. The stream
budget reserves 12 bytes per maximum bin for the worker grid, image data and
canvas surface. Static source/data-flow review only; no tests, builds,
benchmarks, simulations, CI waits, device runs, commits, pushes, deployment or
release ran.

### Checkpoint 771: audit catalog concurrency against the actual pipeline (2026-09-27)

The current stream has four asynchronous binary-prefetch slots and four
unacknowledged transfer credits, while metadata admission, source-row filtering,
element preparation and orbital propagation run through one ordered compute
loop. Propagation yields every 256 rows; the four network reads are not four
orbital-compute workers. The desktop workspace requests the full manifest under
its 512 MiB default. Viewports no wider than 800 px default to 30,000 requested
rows and 256 MiB. A low-memory hint also selects 256 MiB, while its requested-row
default still depends on viewport width. Both requested rows and point-display
limits can be raised explicitly.

The archived 2026-09-25 RTX report recorded 288.9 ms for Kepler propagation,
949.8 ms for metadata decoding/validation, and 4,772 ms total worker time for
its 1,561,171-row build. Its source/build hashes predate the current dirty tree,
so those timings identify no current bottleneck and cannot justify changing
parallelism or defaults. No concurrency constant was raised. The 2026-09-25
static capacity table is now explicitly marked as pre-count-overlay: checkpoint
770 added a fixed 786,432-byte planner reserve, so constrained-tier row ceilings
must be recomputed from the current function before they are quoted as current.
This is source and archived-receipt review only; no tests, builds, benchmarks,
simulations, CI waits, device runs, commits, pushes, deployment or release ran.

### Checkpoint 772: reduce per-body streaming display storage (2026-09-27)

The streaming canvas now retains RGB color channels as normalized 8-bit values
and point sizes as exact tenths in 8-bit values, both on CPU and GPU. This keeps
the three appearance categories and sizes while bounding color rounding to at
most 0.5/255 per channel. Float32 display positions and Float64 orbital
calculations are unchanged. The per-admitted-body planner charge falls by 24
bytes: 2D 73 to 49 bytes, 3D 85 to 61 bytes, or 153/165 to 129/141 bytes when
retaining ten Float64 epoch coefficients. The 2026-09-25 capacity table is now
explicitly historical because the count-overlay reserve and packed attributes
have opposing effects on its row ceilings. This is source review only; no tests,
builds, benchmarks, simulations, CI waits, device runs, commits, pushes,
deployment or release ran.

### Checkpoint 773: bit-pack spatial winner priority (2026-09-27)

Spatial selection now stores the inside-viewport priority for each winning
screen cell as one bit rather than one byte. The planner reserves
`ceil(capacity / 8)` bytes for that bitmap and solves the capacity bound with
that rounded reserve included. The winner-selection order and inside-viewport
priority are unchanged; this removes up to seven eighths of that scratch while
avoiding a one-byte-per-body reserve on small requested workloads. This is
source review only; no tests, builds, benchmarks, simulations, CI waits, device
runs, commits, pushes, deployment or release ran.

### Checkpoint 774: release uploaded spatial index arrays (2026-09-27)

The renderer now stores only the active spatial selection count after copying
the sorted row indices into its WebGL element buffer. The transferred CPU
`Uint32Array` is no longer retained for redraws; draw count and the GPU
high-water allocation are preserved. The planner removes that 4-byte-per-row
CPU selection from its high-water model: 2D/3D base row charges are now 44/56
bytes, plus the separately solved one-bit-per-capacity winner-priority bitmap
and any retained-epoch coefficients. This is source review only; no tests,
builds, benchmarks, simulations, CI waits, device runs, commits, pushes,
deployment or release ran.

### Checkpoint 775: adapt catalog drawing only from active view frames

The streaming catalog's automatic display cap now starts at the existing
30,000-row mobile or 100,000-row desktop cap. It collects animation-frame
intervals only when populated data is actually redrawn, including while shards
are being computed and uploaded; the observer stops after two frames without
another draw. Each sample also carries the number of points actually submitted,
and a whole sample window uses its minimum submitted count. The catalog changes
its cap only when every sample exercised the current limit, so a sparse spatial
viewport, an under-filled source, a mid-window limit increase, or slow loading
with fewer displayed points cannot raise or lower the cap. Repeated fast windows
can raise it and slow windows can lower it once the limit is exercised. The UI states that drawing
remains bounded by rows computed for this request and directs users to raise the
separate source-row limit to make more bodies available. Low-memory policy
ceilings are extended only to preserve the current baseline; this does not
authorize growth past it. Source-only review; no tests, build, benchmark,
browser/device run, performance improvement or capacity increase has been
verified.

### Checkpoint 776: preserve Gaia admission until larger fields are measured

The Gaia path already uploads and draws every row in an admitted manifest,
currently capped at 100,000 rows. Its reader admits up to eight concurrent chunk
reads but holds aggregate reservations at 96 MiB and 90,000 rows by default;
decoded batches remain retained through serialized GPU upload acknowledgement.
The packaged 16,966-row field and the pending TAP request do not establish
larger-device memory or interactive frame capacity. Raising the Gaia catalog,
chunk, in-flight, or chart ceilings from source inspection alone would couple
network, decoded-source, picking, CPU/GPU buffers and render costs without
measured headroom. Keep those limits until the pending source count and exact
current-device performance/memory receipts are available. Static source audit;
no tests, builds, benchmarks, browser/device runs, or ceiling changes.

### Checkpoint 777: retain the timed-out Gaia TAP request as unresolved

The RA 55°, Dec 25°, 2° radius, G <= 19 TAP request exceeded its 85-minute
job budget and exited with an error. The script exhausted its four deletion and
phase-confirmation attempts but could not confirm remote cleanup; DELETE returned
HTTP 500. The target output directory was not created and the two existing
packaged regions remain. A read-only request to the TAP async endpoint timed out
without a response, and the expired process did not preserve its remote job URL
for targeted inspection. Do not retry this query until the service can confirm
the prior job is gone. This is an external-service blocker; no test, build,
benchmark, or deployment ran.

### Checkpoint 778: retain TAP job handles in failure output

Future Gaia TAP acquisitions now log the validated UWS job URL immediately
after creation, and an unconfirmed cleanup error includes that URL after all
delete/phase retries. This makes an asynchronous job address available for
targeted recovery if the endpoint later fails. It cannot recover the URL for
Checkpoint 777's already-finished process, so that remote job remains
unresolved and must not be duplicated without a service-side status check.
Source-only review; no tests or TAP request ran for this change.

### Checkpoint 779: compare Type 21 SPK reader with NAIF layout

The Type 1/21 readers were checked against NAIF's SPKE21 routine description
and SPK Required Reading. The inspected code uses DLSIZE = 4*MAXDIM+11, places
the final-epoch list after N records, validates floor(N/100) directory entries,
and binary-searches for the first final epoch greater than or equal to ET. The
TypeScript and Go evaluators use matching difference-table recurrence and
position/velocity coefficient offsets. This establishes source-level agreement
with the described layout and algorithm only; no independent CSPICE numerical
comparison or test was run. References: NAIF
[SPKE21](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke21.html)
and [SPK Required Reading, Type 21](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html#Type-21-Extended-Modified-Difference-Arrays).

### Checkpoint 780: retain catalog backpressure until load/render evidence exists

The asteroid stream admits four concurrent binary shard reads, but validates,
filters, prepares and propagates one shard at a time before waiting for the
bounded tile-transfer acknowledgement. The Gaia reader overlaps up to eight
bounded source reads while serializing decode and upload acknowledgement. These
separate limits protect different memory and ownership stages. Increasing either
concurrency would multiply resident buffers or alter selection order without
current device-level throughput and memory receipts. The automatic catalog
display cap measures only frames where an actual populated draw occurred and
never exceeds computed rows; the source-row compute ceiling remains separately
user controlled. No concurrency or admission limits were raised. This is source
review only; no tests, builds, benchmarks, simulations, browser/device runs,
commits, pushes, deployment or release ran.

### Checkpoint 781: distinguish the DE440S parent from its bundled crop

The dynamics receipts now identify the 5,558,272-byte SHA-256-pinned local DE440S
crop separately from its 32,726,016-byte NAIF parent download. The parent identity
carries its official URL, recorded Last-Modified value and NAIF-published MD5; no
parent SHA-256 was captured, and the MD5 is not presented as authentication. The
crop derivation records that `scripts/crop-spk.mjs` retains original J2000 type-2/3
records overlapping the bounded TDB window without refitting. Browser and Go
evidence emit these fields, while Android and iOS bind and display them. This is
source/metadata review only; no test, build, benchmark, simulation or runtime
request ran.

### Checkpoint 782: separate current-state capacity from trail detail limits

Explorer passes the complete selected-body set to its current-state resolver or
state-tile planner; `selectDetailBodies` separately limits historical trajectory
work to 160 identities in 3D or 320 in 2D. The 3D canvas batches selected current
positions outside its detailed-mesh set as point markers. The 320-body / 600-sample
accumulator guard is a trajectory-output bound, not the selected current-state
count; Explorer requests at most 240 historical samples. `PERFORMANCE.md` now
states these distinctions and keeps source coverage and planner admission as
separate constraints. No trail limit was raised because the repository has no
current focused-body rendering receipt; catalog-cloud timing does not establish
that capacity. Source review only; no test, build, benchmark or runtime request ran.

### Checkpoint 783: keep current-body and catalog-display budgets evidence-led

The selected-body path still resolves the full selected identity set; the 160/320
limits apply to detailed trails. Existing equal-work CPU receipts cover 510
built-in objects at shared-resolver P90 2.48 ms, but they do not cover renderer,
mobile hardware or the entire exact-state inventory. The approximate MPC cloud
has a separate adaptive visible-point budget, with desktop automatic ceilings
of 1.25 million in 2D and 750,000 in 3D, and an explicit maximum profile up to
the 1,567,193-row source inventory. Its recorded full-inventory worker median
is 275.2 ms per epoch; that is compute timing, not a real-time rendering receipt.
Frame-time adaptation samples active populated draws, while GPU/native memory,
decode pressure and physical-device limits remain unmeasured. These findings
support keeping the current trail, catalog and admission budgets unchanged until
focused end-to-end device evidence exists; the next scale gain should come from
adding verified source rows within the existing budgets. Static source and
receipt review only; no test, build, benchmark, simulation or runtime check ran.

### Checkpoint 784: retain the pending Gaia TAP acquisition handle

A second, disjoint Gaia DR3 cone acquisition is active for ICRS RA 90°, Dec 0°,
radius 0.75°, G <= 18, capped at 50,000 rows. Its intended output is
`public/data/gaia/milky-way-ra90-dec00-r0p75-g18-20260927`; that directory did
not yet exist at the latest local check. The service-side UWS phase endpoint
returned `EXECUTING` for
`https://gea.esac.esa.int/tap-server/tap/async/6a3062e7-ba4d-11f1-924c-bc97e148b76b-O/`.
Do not submit a duplicate while this job is active. The acquisition script keeps
polling the same job and is responsible for recording completion receipts and
remote cleanup. No output rows have been integrated or represented as verified.

### Checkpoint 785: expose Gaia's share of packaged data capacity

The artifact report now accounts for `data/gaia` bytes and file count separately
from the asteroid sample and ephemeris kernels. The build verifier compares that
report with files actually present in the packaged Gaia tree, and the capacity
summary prints those categories so a larger star pack cannot disappear inside
the shell/total figures. Gaia source CSVs remain in the package because the
motion panel consumes them. Source review only; no build or test ran.

### Checkpoint 786: reconcile Gaia and observer coordinate scales

The packaged pages manifest roots Earth and Sun in the pinned JPL `de440s`
kernel; the later DE441/DE442 candidates are dependency-only. JPL specifies
DE440 positions in AU with TDB integration days and a fixed AU, while ERFA
`Apco` accepts TDB dates and barycentric Earth PV in AU and `Pmpx` consumes an
SSB observer vector in BCRS AU. Gaia DR3 astrometry is parameterized in BCRS
with TCB. Together these source contracts support the current no-extra-spatial-
factor convention for the pinned packaged path, but do not prove a numerical
error bound. Custom `--data-dir` manifests can omit a typed spatial-scale
contract, so that path remains an explicit limitation and keeps source hashes
in its result. No scientific formula changed. Static manifest, resolver and
primary-source review only; no tests, builds, benchmarks or runtime checks ran.

### Checkpoint 787: preserve Gaia region identity when expanding the chart

The packaged Gaia tree currently contains two Pleiades-area profiles with the
same center and nested cones, not two disjoint sky regions. The intended RA 90
degree acquisition directory is still absent. The original local TAP poller
session is alive without output, while a direct UWS phase request timed out
after 20 seconds; this checkpoint does not reconfirm the remote job phase and
does not restart it.

The current Gaia workspace accepts one manifest per load, sizes its packed
source store and WebGL chart from that manifest's row count, and projects every
chunk around that manifest's cone center. Combining preprojected arrays from
different regions would overlap their local tangent-plane coordinates. A
multi-region display must either reproject all sources to one declared ICRS
tangent plane or render separately labeled panels; it must also retain each
manifest/query hash, deduplicate source IDs across regions, and enforce one
aggregate row/byte budget. Current limits remain 100,000 selected rows,
30,000 rows per chunk, and the existing in-flight byte/row reservations. These
are source-contract limits, not hardware-capacity evidence. Static source and
data-tree review only; no tests, builds, benchmarks or runtime checks ran.

### Checkpoint 788: retain the Gaia acquisition after local timeout

The original local TAP poller has now exited with status 1 after its 85-minute
budget. It reports that the Gaia request timed out and remote cleanup could not
be confirmed. The expected output directory is still absent. A fresh read-only
GET of the exact UWS `phase` endpoint timed out after 15 seconds with HTTP 000
and no bytes, so the remote job state is unknown; the prior `EXECUTING` receipt
is stale. Do not report this acquisition as complete, failed remotely, or
cleaned up, and do not resubmit it while the service state is unknown. Any next
step must reconcile this same job handle or use another nonduplicating way to
inspect its result. No tests, builds, benchmarks or runtime checks ran.

### Checkpoint 789: preserve Gaia UWS job identity for future resumptions

The Gaia cone CLI now writes an exclusive sidecar job receipt immediately after
validating ESA's UWS URL. It binds the exact job URL to the generated ADQL and
hash, settings, schema version, `MAXREC`, and creation time; optional count and
row scans use separate receipts. A new `--resume-job` path validates that
receipt against the supplied query and polls the existing job without another
POST. CLI retries to the same output target stop when a receipt already exists.
If polling is interrupted or times out after a receipt was saved, local cleanup
does not send DELETE; recovery is attempted only if ESA still exposes the job.
Successful manifests bind the job URL and receipt hash beside each source CSV.
Documentation and focused regressions for early receipt persistence, exact
resume/no-duplicate behavior, query mismatch refusal, and preserving a job after
poll failure were added.

This does not recover the earlier RA 90-degree task automatically: that run
predated receipts, and its remote phase endpoint remains unreadable. No receipt
is fabricated and no duplicate Gaia query was submitted. The new regression
case has not run. Source/diff review only; no tests, builds, benchmarks or
runtime checks ran.

### Checkpoint 790: keep Gaia scale changes tied to aggregate evidence

Current source confirms the Gaia workspace admits one manifest per load and
centers its gnomonic chart on that cone. Local file requests require one unique
`manifest.json`; there is no multi-manifest aggregation or cross-region source
ID deduplication. The stream already overlaps at most eight bounded encoded
reads while serializing parse, source-ID checks, display packing and GPU ACK;
raising that concurrency or the 100,000-row ceiling is unsupported by the
current Gaia hardware receipts. A multi-region view therefore needs explicit
per-region provenance and projection plus aggregate row/byte admission before
any capacity increase.

A read-only 20-second poll of the exact RA 90-degree UWS `/phase` URL again
timed out with no response; remote state remains unknown and the old run has no
saved receipt. GitHub currently reports issue #109 as the only open issue and no
open PRs; #109 acceptance remains incomplete, so it stays open. No test, build,
benchmark or new TAP query ran.

### Checkpoint 791: bounded multi-region Gaia chart

The chart now accepts up to eight remote Gaia manifests per load. It validates
all manifests and their aggregate row, byte, chunk and manifest-JSON budgets
before reading chunks, requires a common source schema, and records each original
manifest, hash and source location in the export. Regions stream sequentially
through the existing per-region eight-read ceiling and existing in-flight and
GPU-ack budgets; those performance ceilings were not raised. A shared ICRS
gnomonic display projection covers a conservative spherical cap up to 80 degrees.
Cross-region Gaia DR3 source IDs are retained once in first-manifest order, while
the summary reports verified input rows and duplicates separately.

The two packaged Pleiades manifests were inspected: 4,460 and 16,966 rows,
3,332,424 and 12,636,780 encoded chunk bytes, and an exact 4,460-source overlap.
Their collection therefore declares 21,426 rows and 15,969,204 bytes and should
display 16,966 unique IDs. Existing E2E selectors were updated for the current
URL form and summary, and new focused collection/deduplication and combined-data
scenarios were authored. These are pending validation only: no tests, builds,
benchmarks or runtime checks were run, and no capacity increase or device
throughput claim is made.

### Checkpoint 792: acquire a disjoint Gaia DR3 Orion region

To increase authoritative star coverage rather than raise a renderer limit,
started a new 1-degree ICRS cone centered at RA 83.8221°, Dec -5.3911° (Orion),
G <= 18, with a 100,000-row cap. The existing row-query path uses `TOP 100001`
as an overflow sentinel; the optional extra COUNT scan was not requested. Its
center is 41.33887° from the packaged Pleiades cone center, leaving 38.83887°
between the requested cone boundaries, so it is an independent field. ESA
returned UWS job `https://gea.esac.esa.int/tap-server/tap/async/010d03bb-ba62-11f1-924c-bc97e148b76b-O`;
the durable query-bound receipt is
`public/data/gaia/orion-ra83p822-dec-5p391-r1-g18-20260927.tap-job.json`.
The local poller last reported `QUEUED` then `EXECUTING` and remains active;
the data output directory does not exist yet. Do not resubmit this query; resume
or reconcile this exact receipt if the poller stops. No test, build or benchmark
ran.

### Checkpoint 793: tie body rendering headroom to observed frame windows

Source inspection found that the binary catalog path already permits the full
inventory as a requested row ceiling, subject to a user-selected maximum 512 MiB
typed-array/GPU admission budget. Its current charge is 44 bytes per 2D row or
56 bytes per 3D row, plus 80 bytes per retained-epoch row and fixed index,
selection, metadata and pipeline reserves. Manual display choices include the
full source count; automatic display starts at 100,000 desktop rows and can grow
only after repeated populated redraw windows meet the frame-tail controller.
Current desktop 16 GiB policy maxima are 1.25M in 2D / 750k in 3D; the 32 GiB
tier can reach the 1,567,193-row inventory. Those are policy ceilings, not
verified device throughput. No row ceiling or concurrency was raised; the next
scale gain is the independent Gaia source data in Checkpoint 792. This was static
source review only; no tests, builds or benchmarks ran.

### Checkpoint 794: avoid copying the full Gaia batch queue on every upload

The Gaia chart holds one display batch per verified chunk. At the existing
2,592-chunk ceiling, immutable array spread copied 3,357,936 prior batch
references cumulatively (the exact total is N(N-1)/2 for N=2,592)
while loading. GaiaSky now appends each acknowledged display batch to a
generation-owned queue and increments a scalar version so GaiaPlot processes
only newly appended entries. This removes the repeated prefix copies without
changing row order, source identities, scientific values, the 100,000-row
admission, the 30-second chunk ACK deadline, or the requirement that each GPU
upload/draw succeeds before the next chunk proceeds. It reduces queue-management
work; it does not establish a frame-rate or total-memory improvement. Static
diff/whitespace review only; no tests, build, browser run or benchmark was run.

### Checkpoint 795: double the Gaia collection admission with bounded source budgets

The Gaia collection row ceiling is now 200,000, while each manifest/query
remains capped at 100,000 rows. The 128 MiB selected-source, 96 MiB/90,000-row
in-flight, 2,592-chunk, eight-manifest and single-upload-ACK limits are unchanged.
For the wider schema-v2 layout (34 Float64 fields), exact retained source columns
at 200,000 rows use 56,850,000 bytes including BigInt64 IDs and null flags;
retained Float32 display batches use 2,400,000 bytes and the GPU point buffer
another 2,400,000 bytes. The lazy screen-picking index adds about 4,000,000 bytes
for ordinal and Float64 coordinate arrays, excluding its cell heads. These
figures omit JS object/Set overhead, active decoding, browser/driver allocations
and compositor memory; they are accounting bounds for known typed arrays, not a
total-memory or throughput guarantee. The collection contract was updated to
admit two full bounded manifests and refuse a third. No tests or renderer
measurements have run; the new ceiling remains unaccepted on target devices.

### Checkpoint 796: audit simultaneous compute and display ceilings (2026-09-27)

The scale path was checked end to end before changing any numeric ceilings.
Desktop maximum-quality policy can reach the complete 1,567,193-row asteroid
inventory; automatic 16 GiB desktop policy is lower, and 3D policy is lower
than 2D on that tier. A streamed snapshot is propagated row-for-row, while
spatial mode draws deterministic projected-cell representatives and overlays
exact in-viewport row counts; all-row mode can draw up to its active render
budget. This distinction keeps overlapping stars visible as counts without
claiming they are individually resolved. Gaia remains a separate 200,000-row,
128 MiB source admission with up to eight bounded reads, serial decode/display
consumption and upload ACK backpressure. No evidence supports raising either
render or Gaia ceilings: the retained benchmark artifacts predate the current
pipeline hashes, and total heap, driver memory and target-device frame tails are
not measured. Therefore this pass changes no runtime cap or concurrency. Both
new disjoint Gaia TAP queries remain `EXECUTING` under their existing durable
receipts; no result artifacts exist yet. Source and documentation review only;
no tests, builds, benchmarks or device runs were performed.

### Checkpoint 797: require P95 headroom before growing the catalog draw budget (2026-09-27)

The catalog/explorer adaptive budget previously promoted after four windows at
P90 < 18.5 ms, P99 < 28 ms and fewer than 5% long frames. That admitted growth
above #109's P95 <= 16.7 ms and estimated missed-frame < 2% target. It now
records P50/P95/P99 callback intervals and estimated missed 60 Hz slots, and
shares the same target, pressure and emergency thresholds with exact-state
display control. Growth still requires the observed point count to reach the
active cap for the complete window; sustained pressure lowers the cap by 25%.
Tests for strict thresholds and malformed statistics were updated but not run.
Callback intervals are not GPU/compositor timestamps, and hardware acceptance
is still pending. Static source and diff review only; no tests, builds,
benchmarks or devices were run.

### Checkpoint 798: store native planar display coordinates without an unused z component (2026-09-27)

Android's native 2D deck now allocates and uploads two Float32 components per
displayed body, using a two-component vertex attribute while the shader's
missing planar z defaults to zero. This reduces its CPU/direct display buffer
from 12 to 8 bytes per body. iOS stores its Canvas projection as
`SIMD2<Float>` instead of `SIMD3<Float>`, reducing element stride from 16 to 8
bytes. Both paths retain the same verified Float64 frame, exact candidate set,
reference-first ordering, projection scale and row cap; native 3D remains on
its existing three-component geometry. Existing source-level regression
assertions were updated but not run. This is an allocation reduction, not
evidence of higher device throughput, GPU memory reduction, or a larger safe
display ceiling. No tests, builds, benchmarks, browser/device runs or CI waits
were performed.

### Checkpoint 799: preserve a completed Gaia download when TAP cleanup fails (2026-09-27)

The existing Orion row job reached `COMPLETED` and its CSV response was fully
read, but four failed ESA DELETE attempts then aborted the acquisition before
CSV parsing and artifact writes. The UWS phase and result URLs now return 404;
only the query-bound local receipt remains, so that response cannot be resumed
and no Gaia Orion manifest/chunks were produced. The fetcher now treats remote
job deletion as best-effort after a successful bounded download, continues
parse/validation and persistence, and exposes a per-source `cleanupPending`
flag while retaining the acquisition receipt. Focused regression source covers
four server-error delete attempts and retained result rows; it was not run. The
Praesepe UWS job remains under its existing receipt and was not resubmitted.
No tests, builds, benchmarks, replacement query, device runs or CI waits were
performed.

### Checkpoint 800: estimate missed frame slots over the sample window (2026-09-27)

Web adaptive and exact-state samplers, Android GL callbacks, and iOS native
callbacks previously rounded every measured interval separately to a whole
number of 60 Hz slots. Static examples show this can classify a steady 20 ms
cadence as zero misses or inflate a mixed 10/25 ms cadence despite its 17.5 ms
mean. All four controllers now estimate the missed-slot fraction from total
window elapsed time and callback count; thresholds are unchanged. Regression
source covers steady and mixed cadence and the existing 34 ms samples. Callback
cadence remains an estimate, not presentation-timestamp evidence. No tests,
builds, benchmarks, device runs or CI waits were performed.

### Checkpoint 801: reissue the Orion cone after ESA expired the completed job (2026-09-27)

The earlier Orion row job and result endpoint now return 404, with no validated
local CSV or manifest to recover. After fixing the post-download cleanup failure
path, the same query-bound 1-degree, G <= 18 cone was submitted once more; its
new UWS receipt is
`public/data/gaia/orion-ra83p822-dec-5p391-r1-g18-recovered-20260927.tap-job.json`.
ESA currently reports the new job `EXECUTING`. The separate Praesepe query
remains `EXECUTING` under its original receipt. Neither job was duplicated
again, and neither has produced a local result artifact yet. This is a live
data acquisition, not a test; no tests, builds, benchmarks or device runs were
performed.

### Checkpoint 802: package and combine an independently captured Gaia region (2026-09-27)

The Praesepe/M44 1-degree, G <= 18 ESA Gaia DR3 capture completed with 5,555
rows in four ICRS spatial chunks and a 1,830,790-byte source CSV. A read-only
integrity audit matched the CSV and every chunk against manifest byte lengths
and SHA-256 values, reconciled each chunk and aggregate row count, found 5,555
unique source_id values, and checked all positions against the requested
one-degree cone and G limit. The manifest identifies J2016.0 TCB/ICRS and does
not claim a completeness-certified all-sky sample. The capture is now packaged,
documented, and exposed as a native Gaia chart preset; a combined Pleiades plus
Praesepe preset accepts three schema-v1 manifests under the existing 200,000-row
and 128 MiB budgets. A source-ID reconciliation across those manifests found
26,981 input rows, 22,521 unique stars, and 4,460 duplicates from the nested
Pleiades cones. This is data integrity and source-selection evidence, not a
renderer performance or device-capacity result. No tests, builds, benchmarks,
browser/device runs or CI waits were performed.
The raw `public/data/gaia` source tree currently accounts for 28,976,836 bytes
across 23 files; this is a source-directory total, not a rebuilt Pages artifact
size.

### Checkpoint 803: overlap bounded Gaia packing and point uploads (2026-09-27)

The Gaia worker previously waited for each chunk's renderer acknowledgement
before resuming serialized decode and packing. It now permits three outstanding
upload credits, at most 90,000 rows under the unchanged 30,000-row chunk and
90,000-row in-flight limits. The output-credit limit is separate from network
read reservations and is not a total-memory bound. This lets the worker prepare
later chunks while the main thread submits earlier point-buffer work. When
several chunks arrive before one render effect, the renderer writes their
contiguous ranges and performs one incremental draw, then acknowledges each
sequence. Out-of-order ACK completion is tracked until the contiguous sequence
advances; empty duplicate-only chunks
still release their credits immediately. Aggregate row and byte ceilings are
unchanged. CPU packing remains sequential, and no current throughput, frame-tail,
heap or device-capacity claim follows from this source change. Static source and
diff review only; no tests, builds, benchmarks or device runs were performed.

### Checkpoint 804: verify and expose the recovered Orion Gaia region (2026-09-27)

The reissued ESA Orion cone completed with 6,890 rows in two chunks. Static
read-only verification matched source CSV and chunk byte lengths and hashes,
confirmed the recovered TAP receipt hash, reconciled chunk and manifest row
counts, found unique positive decimal source IDs, and confirmed every row is
within the requested one-degree ICRS cone, G <= 18, and J2016.0. The 100,001-row
overflow sentinel was absent; no separate COUNT(*) query was run. ESA's remote
DELETE returned HTTP 500 after retrieval,
so the source receipt keeps `cleanupPending=true` while the validated local data
is retained. Its manifest hash binds the recovered job receipt (UWS `04c39417`);
the earlier failed job receipt (UWS `010d03bb`) remains a separate record and is
not the manifest's acquisition source. The UI now offers the region by itself and in a four-manifest
Pleiades/Praesepe/Orion collection. Across those manifests, 33,871 input rows
reconcile to 29,411 unique IDs and the shared tangent-plane radius bound is
47.8014°, within current collection limits. The Gaia public source tree is now
27 files and 36,372,926 bytes. This expands real source coverage, not measured
render capacity. No tests, builds, benchmarks or device runs were performed.

### Checkpoint 805: request a wider Orion source cone (2026-09-27)

To increase the actual workload before considering a larger chart admission
limit, a second bounded ESA Gaia DR3 query was started for a 2° cone at ICRS RA
83.8221°, Dec -5.3911°, G <= 18, with the existing 100,000-row top-plus-one
sentinel. Its durable receipt is
`public/data/gaia/orion-ra83p822-dec-5p391-r2-g18-20260927.tap-job.json`, and the
current UWS phase was `EXECUTING`. The query is nested around the verified 1°
Orion region; source IDs will be deduplicated if both are combined. No output
manifest exists yet, and no duplicate query was submitted. This is an external
data acquisition, not a test. Its receipt brings the Gaia source tree to 28
files and 36,373,951 bytes before row/chunk results; this is source-tree size,
not a built Pages artifact size. No tests, builds, benchmarks or device runs
were performed.

### Checkpoint 806: retain evidence-based Gaia admission limits (2026-09-27)

Static review traced the chart's concurrent workload and retained state. Each
displayed row occupies 12 bytes in the preallocated point buffer (2.4 MB at
200,000 rows), and the maximum 2048-square RGBA8 persistent target is 16 MiB.
The source store additionally retains packed Gaia numeric fields and exact IDs;
duplicate detection retains a `Set<bigint>`, and the CPU picker keeps the
Float32 point batches for screen-index rebuilds. At this checkpoint, three
upload credits capped worker-to-renderer pending output at 90,000 input rows,
separate from the loader's encoded-byte reservation; checkpoint 808 below
supersedes the fixed-count policy while retaining the same row ceiling. These
figures are component budgets, not a
measurement or bound on browser heap, graphics-driver memory or total device
residency. No current per-device memory or sustained frame/upload measurements
justify raising the 200,000-row, 128-MiB selected-source or 90,000-row
in-flight limits. They remain unchanged. The current 29,411-star collection
demonstrates packaged source volume only; the wider Orion query remains
`EXECUTING` and is not included. This source audit found no additional safe
capacity change to make without runtime evidence. No tests, builds, benchmarks,
browser/device runs or CI waits were performed.

### Checkpoint 807: acquire a second bounded Gaia sky field (2026-09-27)

The same Orion 2-degree Gaia DR3 query remains `EXECUTING`; it was neither
restarted nor duplicated. To add an independent field while preserving the
existing per-region and chart limits, a 0.35-degree cone centered at ICRS RA
266.4 degrees, Dec -29 degrees, G <= 18, was submitted with the existing
100,000-row limit and 100,001-row overflow sentinel. ESA assigned UWS job
`d631f6d4-ba7b-11f1-924c-bc97e148b76b-O`; the receipt is
`public/data/gaia/galactic-center-ra266p4-dec-29-r0p35-g18-20260927.tap-job.json`.
Both the running local poller and the remote phase endpoint reported
`EXECUTING`. This records only a bounded acquisition request; no source rows,
star count, density, manifest, or render-capacity result is claimed yet. The
query is read-only catalog retrieval, not a test. No tests, builds, benchmarks,
browser/device runs or CI waits were performed.

### Checkpoint 808: use small-chunk upload slots within the existing row window (2026-09-27)

Static accounting found that the previous three-credit upload window was
derived from three maximum 30,000-row chunks, but also limited three small
chunks to the same count. The loader's actual request ceiling is eight, while
the unchanged 90,000-row reservation already bounds aggregate input rows. The
chart worker now admits up to eight unacknowledged chunk slots and sums their
manifest input rows against that existing 90,000-row window. The main thread
tracks the same per-sequence row totals and rejects an over-budget worker
message before accepting its data. Duplicate rows count conservatively toward
the window. At maximum chunk size the window still admits only three chunks;
smaller chunks may use more slots. `maxParallelChunks` is centralized in Gaia
capacity configuration and shared by loader and upload policy. No aggregate
row, encoded-byte or selected-data budget was raised; CPU packing remains
sequential. This is a source-level scheduling improvement with no measured
throughput or device-capacity claim. No tests, builds, benchmarks, browser/device
runs or CI waits were performed.

### Checkpoint 809: expose observed Gaia upload-window occupancy (2026-09-27)

The Gaia worker's completed-load receipt now carries the configured upload slot
and input-row limits plus the observed high-water marks for pending chunks and
their summed manifest input rows. The page validates those values against its
own limits and reports them alongside the verified/displayed star counts.
This makes real chart loads show whether small-chunk slots were used without
conflating queue occupancy with throughput, frame time, heap or total graphics
memory. The values are observations for one load, not a capacity benchmark.
Only source and diff review were performed; no tests, builds, benchmarks,
browser/device runs or CI waits were performed.

### Checkpoint 810: capture upload-window peaks in real Gaia capacity reports (2026-09-27)

The completed chart exposes upload-window limits and per-load high-water counts
as structured data attributes. The opt-in real-capture browser measurement now
reads those fields for each sample, requires valid positive limits and observed
activity within both limits, and includes them in a schema-version-2 report at
this checkpoint; checkpoint 811 below upgrades that report to schema 3 for
single captures and the packaged multi-region mode. The report adds the counts
alongside load time and retained-buffer frame measurements. This makes later
real Gaia data-tier runs able to compare whether small-chunk overlap was
actually exercised, while preserving the report's existing host, source and
implementation hashes and its memory/frame limitations. The collector was not
run. Source and diff review only; no tests, builds, benchmarks, browser/device
runs or CI waits were performed.

### Checkpoint 811: include the packaged multi-region Gaia chart in capacity collection (2026-09-27)

The opt-in Gaia capacity collector now has a packaged-collection mode for the
four-region Pleiades/Praesepe/Orion preset, in addition to a caller-supplied
single capture. It reads source IDs from the packaged chunks to derive the
expected unique-row count independently, loads the actual UI preset, and reports
aggregate input/unique rows, per-manifest hashes and source receipts, upload
window occupancy, retained point-buffer size and zoom frame intervals. The
collection contains 33,871 input rows and 29,411 unique stars according to the
current checked-in source manifests; its capacity run has not been executed.
This adds a real approximately-30k star tier to the future evidence path, not a
measured performance result. No tests, builds, benchmarks, browser/device runs
or CI waits were performed.

### Checkpoint 812: overlap two retained-epoch compute and upload tiles (2026-09-27)

The retained-epoch worker previously waited for every 16,384-row-or-smaller
Float64 tile to return from main-thread upload before beginning the next tile.
The worker and renderer now share a two-slot ACK window: propagation remains one
ordered compute loop, while the next tile may be computed during the preceding
tile's upload. The canvas queues at most two and writes them in contiguous row
order; source-block epoch evidence is committed only after that block's tiles
are acknowledged. At the worker's 1,024-row setting the 3D transfer pair is
49,152 bytes (48 KiB), an increase of 24 KiB from one slot. The API permits
larger tiles up to 16,384 rows; two such 3D buffers would use 786,432 bytes.
The MPCORB publisher defaults to 5,000 records per shard, allowing five
worker tiles per full shard; smaller shards may not fill both slots. This makes
overlap available for the default profile but does not establish a speedup.
The existing planner's 1,024-byte-per-row
pipeline floor still exceeds the explicit 904-byte-per-row component sum, so
admitted row capacity is unchanged. Successful epoch receipts now expose the
configured slot count and observed peak occupancy for later real playback
measurement. Numerical propagation and source data are unchanged. This is a
bounded scheduling change, not a measured speedup or FPS/capacity result. The
focused regression was added but remains unrun under the user's testing hold;
no tests, builds, benchmarks, browser/device runs or CI waits were performed.

### Checkpoint 813: retained-frame memory boundary (2026-09-27)

Source review confirms an epoch update invalidates the current position buffer
and hides display until every new row is installed. This prevents a frame from
mixing epochs. Keeping the prior complete frame visible while a replacement is
computed would require a second CPU Float32 restoration array and GPU position
buffer. At 1,561,171 rows, those 3D position copies add 37,468,104 bytes
(35.7 MiB) before driver overhead. The current admission planner does not reserve
that front/back cost, so this change is deferred until a per-device budget and
atomic buffer-swap lifecycle are designed. The two-slot worker/upload overlap
does not make partial epochs visible and does not claim a higher visible-body
count or FPS. Source inspection only; no tests, builds, benchmarks, browser or
device runs were performed.

### Checkpoint 814: align Android moderate-thermal render caps with iOS (2026-09-27)

Static comparison found Android's moderate thermal status could leave its initial
3D/planar render limits at 100,000/250,000 rows, while iOS `.fair` caps them at
75,000/100,000 and permits measured recovery only to those caps. Android now
applies the matching limits and bounds recovery during moderate thermal status;
its nominal and maximum limits are unchanged. Focused regression assertions were
updated, but remain unrun under the user's testing hold. No build, benchmark,
device run, commit, push, deployment or release occurred. This does not establish
a higher body count or rendering throughput.

### Checkpoint 815: revalidate Gaia capacity receipts against current sources (2026-09-27)

Recomputed SHA-256 for every implementation path in both retained 4,460-row Gaia
Chromium receipts. Against the current worktree, the baseline matches 1/8 and the
expanded receipt 1/9; `src/data/gaiaColumns.json` is the sole matching
implementation in both. The expanded report records `GaiaPlot.tsx` as
`7c58321c5e6a6c4060acb38f4d75df6150e3c6613c6fc6928c2e2b14eae75f67`, while the
current renderer hashes to
`1d1ebfbe0fa63c6c67c38e0af72e487569a4501295a20adbca6f380c1525027b`. The
200,000-row ceiling remains unchanged: historical 4,460-row measurements and
the unbenchmarked 16,966-row pack do not establish current-renderer capacity at
larger sizes; the MPC path is separate evidence. This was a static hash audit;
no tests, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 816: avoid redundant Gaia ID index for single-region loads (2026-09-27)

Source review confirms each `streamGaiaChunks` call already holds a per-region
`Set<bigint>` and rejects duplicate source IDs across that region's chunks. The
worker's collection-wide `Set<bigint>` is now allocated only for multi-region
loads, preserving first-manifest-order deduplication where regions overlap.
Single-region loads keep required within-region validation without the second
O(unique rows) index of up to 100,000 IDs under the current per-manifest cap.
This is a source-level memory-lifetime reduction only; no
measured byte saving, higher capacity or throughput is claimed. No tests, build,
browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 817: avoid per-row key/value helper collections in Gaia validation (2026-09-27)

The schema-v1/v2 decoder previously called `Object.keys(row)` and
`Object.entries(row)` per record, and the packer called `Object.keys(row)` again.
Both paths now check own enumerable keys against precomputed schema sets and
iterate them directly, preserving exact schema and numeric validation while
avoiding those explicit per-row helper collections. This is source-level evidence
only; no runtime heap or throughput gain is measured. No tests, typecheck, build,
browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 818: account for HTTP stream fragments in Gaia memory limits (2026-09-27)

Source inspection confirms `readBounded` preallocates the declared response length and copies each `ReadableStream` fragment into it. The current fragment can overlap the output allocation, while an overlong fragment is rejected only after `reader.read()` yields it; the loader's encoded-byte reservation does not separately count this transport storage. Documented this transient alongside the existing JSON string/object overlap and unmeasured browser buffering. The current single-output copy strategy avoids retaining all fragments plus a full concatenation copy, so no alternate allocation strategy or larger concurrency budget is justified by source inspection alone. No tests, build, browser run, benchmark, commit, push, deployment or release ran.


### Checkpoint 819: keep Gaia display finiteness validation off the UI thread (2026-09-28)

The Gaia worker's projection writer stores each point into its Float32 display array and checks the rounded x/y/magnitude values for finiteness immediately afterward. The active worker transfers that array to the page, whose message handler repeated `Number.isFinite` across every element before upload. Removed only the redundant UI-thread value scan; worker-side numeric validation plus page-side transfer type and exact row-length checks remain. This avoids up to three extra predicate calls per displayed row on the UI thread (600,000 at the 200,000-row ceiling), based on source inspection only; no frame-rate or throughput change is measured. No tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 820: overlap Gaia chunk reads across bounded manifest groups (2026-09-28)

Static inspection showed the collection worker awaited each manifest stream before starting the next, leaving request slots unused for small region manifests. Added ordered read groups of up to eight manifests; each group is split when the sum of member maximum chunk bytes or rows would exceed the existing 96 MiB/90,000-row limits. Per-stream reservations start at that manifest's largest descriptor and divide only remaining capacity, while allocated job slots sum to at most eight. Source reads and hashes can overlap across manifests; a cancellable pre-decode turn preserves first-manifest duplicate precedence and keeps JSON parsing/packing serial. Waiting for that turn pauses the chunk-stage timer, which restarts for active decode/consume. Collection summaries now report actual aggregate reservation peaks and concurrent manifests with source reads; the opt-in capacity receipt schema 4 records both windows and checks multi-manifest overlap whenever source chunks are actually read. Cache-only samples correctly report zero source-read overlap. This is source-level progress only: no tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran, and no throughput increase is claimed.

### Checkpoint 821: keep catalog throughput changes evidence-led (2026-09-28)

Static review of the general asteroid catalog path found four bounded binary-shard prefetch jobs, one ordered shard compute/delivery path with awaited tile backpressure, a separate four-credit upload window, and frame-sliced 4,096-row GPU uploads. The byte admission model explicitly retains its per-row scratch reserve because it has not been replaced by linked memory evidence. This supports keeping the current concurrency and capacity limits; no source change or higher-body-count claim is justified by inspection alone. No tests, typecheck, build, browser run, benchmark, commit, push, deployment or release ran.

### Checkpoint 822: retain native object limits until device evidence supports growth (2026-09-28)

Static comparison confirms Android and iOS begin at 100,000 3D or 250,000 planar points, with maxima of 250,000 and 500,000 respectively and matching fair/moderate-thermal ceilings of 75,000 and 100,000. Both reduce limits from active frame evidence or memory/thermal pressure without deleting the verified scientific source frame. iOS projection preparation cancels and drains its prior worker before allocating a replacement, avoiding overlapping full-frame buffers during rapid mode/reference changes. No larger native cap or parallel full-frame compute is justified without device and memory measurements. No device run, build, test, commit, push, deployment or release ran.

### Checkpoint 823: add analytic contracts for ellipsoid ray intersections (2026-09-28)

The new ellipsoid-ray implementation had no direct unit contract. Added source cases for a sphere's exact first intercept, backward and missed rays, tangent classification inside the numerical screening margin, and a rotated triaxial intercept transformed back to J2000. These cover closed-form geometry and frame mapping only; no test was executed, and large-distance conditioning remains pending independent numerical comparison.

### Checkpoint 824: add a verified Galactic-center Gaia field without claiming capacity (2026-09-28)

The recovered Gaia DR3 field has 9,686 source rows to G <= 18. The production
parser revalidated its coordinate cone, J2016.0 epoch, schema and source IDs;
the manifest, CSV and JSON chunk hashes and exact parsed-row/chunk equivalence
were checked. No independent COUNT(*) query was run. The Gaia chart exposes a
localized standalone load button, and the docs reconcile five fields to 39,097
unique source IDs. The all-five projection radius exceeds the existing 80-degree
limit, so they remain separate chart groups. UI execution and star-count
rendering remain unverified; the only retained hardware receipt covers 4,460
rows and does not match the current renderer. No tests, typecheck, build,
browser run, benchmark, commit, push, deployment or release ran. The separate
0.8-degree inner-bulge query is still executing.

### Checkpoint 825: reconstruct distant ray surface points without large-vector cancellation (2026-09-28)

The frozen oriented-ellipsoid ray solver now reconstructs an intercept point
from the perpendicular ray component and half-chord rather than adding the
large observer vector to its near-equal opposite displacement. This targets
loss of small transverse surface coordinates for distant observers; the
first-root distance expression and near-limb classification are unchanged. A
1e12-scaled-distance oblique sphere regression case was added but not executed.
This source audit does not compare against an independent geometry oracle or
establish a physical error bound. No tests, typecheck, build, browser run,
benchmark, commit, push, deployment or release ran.

### Checkpoint 826: report Gaia drawn and loaded counts separately (2026-09-28)

The Gaia interface now receives the current count only after a successful
persistent-framebuffer composite. Its progress and completion summaries
separate drawn rows from unique source rows loaded, avoiding an early
"displayed" claim while a presentation frame is queued. This count confirms
draw/composite submission only; pixel-level overlap and physical display timing
remain unmeasured. No test, build, browser run, benchmark, commit, push,
deployment or release was performed.

### Checkpoint 827: focused ray test unavailable in the current checkout (2026-09-28)

Attempted only `tests/unit/ellipsoid-ray.test.ts` under the periodic focused-test
authorization. The RTK Vitest filter rejected the first invocation; the project
npm test entrypoint then reported that `vitest` is not recognized, and the local
`node_modules` directory is absent. No test body ran and no dependencies were
installed. Run the retained focused case after the completed implementation
enters its authorized verification phase.

### Checkpoint 828: record New Horizons reader parity and source admission (2026-09-28)

Prepared a fresh hash-bound New Horizons OD164 pack. Source-versus-crop CSPICE
comparison covered 35,259 states and had zero component difference. TypeScript
and Go production readers with the explicit dependency pool matched the same
CSPICE report to zero position difference and at most 1.78e-15 km/s velocity
difference. Added the two SPK files to each runtime source manifest and carried
the tracking cutoff into the runtime projection and spacecraft inspector.
Static JSON/projection checks and git diff --check pass. This is bounded
representation agreement, not independent tracking-residual accuracy or a
prediction uncertainty estimate. No tests, typecheck, build, browser/device
run, benchmark, deployment, release, commit or push ran.

### Checkpoint 829: bind fixed-epoch fallback seeds to current source and computation hashes (2026-09-28)

Static regeneration found seven stale source selections in the 316-body
osculating fallback table. Updated source reuse to require matching manifest,
GM constants, calculation/parser file hashes and selected SPK identity/hash.
Rebuilt at the existing TDB epoch with the same 316 body IDs; all per-body SPK
hashes match the Pages manifest. Seven Uranus/Neptune moon states now use the
current ura182/nep098 source files; the other 309 position/velocity records
are identical. Source/checksum verification and diff checks only; no tests,
typecheck, build, browser/device run, benchmark, deployment, release, commit
or push ran. This does not provide independent trajectory-residual accuracy.

### Checkpoint 830: update SPK profile evidence after source admission (2026-09-28)

The read-only `audit-scientific-assets.mjs` pass verified every file in both
runtime profiles: 874 unique SPKs / 1,259,552,768 bytes, 1,334 descriptors and
6,670 finite sample states at five points per descriptor. Both manifests have
672 entries; their 470 shared paths agree, while 202 profile-specific paths
preserve the short Pages and long full coverage windows. Refreshed the scientific
evidence pins, build verifier expectations and physical-source byte totals. The
derived 41-file / 92,071,936-byte Pages preview closure remains unchanged.
`git diff --check` remains the only repository-wide validation command; no test,
typecheck, build, browser/device run, benchmark, deployment, release, commit or
push ran. This sampled source audit does not prove accuracy over complete SPK
windows.

### Checkpoint 831: record a bounded inner-bulge Gaia source capture (2026-09-28)

The earlier 0.8° G <= 18 inner-bulge TAP job ended ABORTED and produced no
manifest; its receipt remains for provenance and the rows are not counted. A
bounded 0.15° cone at ICRS RA 264.8°, Dec -30.2°, G <= 17 completed with 654
rows, below the 20,000-row cap. The repository's Gaia parser verified J2016.0,
cone and magnitude constraints; the TOP 20,001 sentinel was absent; CSV, chunk,
manifest and receipt hashes reconcile. All 654 IDs are disjoint from the five
prior packaged regions. Totals are now 44,211 source rows, 39,751 unique IDs and
33,001,529 encoded chunk bytes. The standalone and paired browser presets expose
the inner region and its 10,340-source Galactic-center combination. The largest
existing chart remains 29,411 unique sources, pending a larger same-field
capture; no rendering ceiling was raised.

This is source and manifest reconciliation, not proper-motion propagation,
all-sky completeness, or sustained rendering evidence. The 2° G <= 18
same-field Gaia query was resumed from its receipt after the local 85-minute
polling deadline, then ESA aborted that same UWS job at its two-hour execution
limit while it remained in `WRITING_RESULT`. No CSV, count, manifest or chunks
were returned; this query adds no rows. The receipt remains at
`public/data/gaia/gaia-pleiades-ra55-dec25-r2-g18-20260928.tap-job.json`.
The verified 0.15° inner-bulge region and its 10,340-source Galactic-center
pair remain usable; the largest packaged view remains 29,411 stars. One
separate, narrower 1.75° same-field TAP query was then submitted with a new UWS
receipt at `public/data/gaia/gaia-pleiades-ra55-dec25-r1p75-g18-20260928.tap-job.json`.
It remains `EXECUTING` and has returned no rows or count; it is not included in
the packaged data. No further cone query will be submitted if this narrower
attempt also reaches the archive execution limit. No tests, typecheck, build,
browser/device run, benchmark, deployment, release, commit or push ran.

### Checkpoint 832: coalesce overlapping catalog state calculations (2026-09-28)

Source inspection found that `EvalBatchContext` reused completed exact
target/epoch values but computed a cache-cold target independently when distinct
plans overlapped in time. The catalog evaluation cache now coalesces only the
same NAIF target and exact epoch within one immutable catalog identity. A live
waiter retries after builder cancellation with its own context; missing and
failed values are not retained. Existing benchmark output now includes
coalesced request and active computation counters. Focused success and builder-
cancellation regression cases were added but not run. This is a bounded-work
deduplication change, not measured throughput or proof of greater device
capacity. No typecheck, build, runtime benchmark, deployment, release, commit or
push ran.

### Checkpoint 833: route state-plan evaluation through priority admission (2026-09-28)

The first source review found `resolvePlanRows` still called
`EvalBatchContext` directly. That meant the catalog could coalesce duplicate
exact-state work, but the state-plan route did not apply compute admission at
the owner calculation and the new queue scopes were unused there. It now routes
through the scheduler-aware catalog helper. Only a request that leads an
uncached calculation acquires a compute slot; a same-class in-flight waiter
does not. Different request classes can evaluate independently to preserve
priority, while completed exact target/epoch results remain cross-class cache
hits. Each permit ends with its target evaluation, so a batch cannot hold a slot
while waiting on another queued target. These changes preserve all existing body
and transfer budgets. No test, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran. The cache's `activeFlights` statistic
includes leaders waiting for compute admission, not just active CPU work. The
parallel admission path and larger-body capacity still need final verification.

### Checkpoint 834: record current worker and renderer capacity boundary (2026-09-28)

The current large-catalog source path is one `catalog-stream` worker. Retained
epoch propagation is synchronous inside that worker, in 1,024-row tiles, with
cooperative yields every 256 rows and at most two tiles awaiting GPU ownership
ACKs. The prepared scientific source occupies 80 bytes per admitted row; a
naive per-worker full copy would add about 125.4 MB at 1,567,193 rows. The
spatial selector runs after coordinates are computed and represents overlapping
rows per screen cell, so it bounds draw work without reducing the source
propagation pass. The historical 1.56-million-row benchmark predates changed
current worker/renderer files and is not current acceptance evidence. No source
count, renderer ceiling or worker count changed. A safe parallel-compute design
needs single-transfer partition ownership and ordered bounded tile returns;
current-worker memory and sustained desktop/mobile frame measurements remain
pending. No tests, build, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 835: retain owned coefficient slabs without a second catalog copy (2026-09-28)

`CatalogEpochStore` now adopts the exact-sized prepared Float64 buffers supplied by
initial stream shards and acknowledged append batches, instead of preallocating a
capacity-sized slab and copying each source block into it. Static call-site inspection
found that source preparation does not mutate or transfer those buffers after handoff;
the append path transfers only positions and appearance before installing the separate
prepared coefficient buffer. Epoch computation maps each bounded tile across ordered
source slabs, including tiles that cross a source-block boundary. An unrun regression
case compares those computed rows against the per-source propagation path. The change
removes one full coefficient copy pass and the eager unused-capacity allocation, but
does not change the modeled 80 bytes per retained row or increase the admitted catalog
limit. Actual speed and memory impact need the deferred final profiling/device review;
no tests, build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 836: separate actual draw ceilings from screen-count bins (2026-09-28)

Static inspection found no fixed 65,536-point renderer ceiling: that constant limits only
the optional screen-cell count overlay. The spatial selector can retain up to the caller's
draw limit, while `all` mode samples up to that limit in upload order; both stay within the
loaded plan capacity. The WebGL renderer reserves attributes for the admitted capacity and
uses a 32-bit index buffer for spatial selection. Automatic display policy ceilings remain
device-specific (desktop16: 1.25 million in 2D and 750,000 in 3D; desktop32: the current
source inventory maximum), while manual choices include the full inventory. The default
desktop display begins at 100,000 and relies on measured frame windows to grow. These are
deliberate interactive safeguards; raising them without current desktop/mobile frame and
GPU evidence would be blind tuning. No display cap changed; the unrun coefficient-slab
regression remains queued with the final tests.

### Checkpoint 837: map Gaia collection admission and upload ceilings (2026-09-28)

The Gaia path already overlaps up to eight source reads, bounded by 96 MiB and 90,000
in-flight rows, while a separate eight-chunk/90,000-input-row upload window applies
backpressure at GPU ACKs. Manifest admission caps one cone at 100,000 rows, a combined
chart at 200,000 rows and selected encoded data at 128 MiB. JSON decoding and packing
remain serialized per stream so parsed object graphs do not multiply with read concurrency;
the renderer retains packed scientific columns and draws into one persistent texture.
These source limits explain why simply raising network concurrency would not increase
the number of displayed stars. Increasing the row ceilings needs measured peak memory,
GPU frame cadence and an explicit strategy for retaining packed source columns. The
Pleiades 100,000-row TAP query remains `EXECUTING` at its existing UWS job; it was not
resubmitted. No tests, build, benchmark, browser/device run, deployment, release, commit
or push ran.

### Checkpoint 838: retain the aligned cross-platform issue (2026-09-28)

The live open-issue list contains only #109, and the live open-PR list is empty. I
re-read #109's body: its goal is explicitly to calculate, transfer and display as many
known bodies as possible while preserving scientific provenance, bounded memory,
adaptive multi-device rendering and missing-state honesty. That still matches this
project goal, and the full acceptance list remains incomplete, so #109 stays open. The
current main worktree remains dirty and 103 commits ahead of `origin/main`; no commit or
push was made during this implementation-only phase.

### Checkpoint 839: retain the over-budget Gaia TAP job (2026-09-28)

The existing local poll reached the fetch script's 85-minute deadline and exited with
the job receipt intact. Its cleanup branch explicitly did not send UWS DELETE when a
resume receipt was present. A direct read of the same remote `/phase` endpoint at
2026-09-27 23:09:44 UTC still returned `EXECUTING`. No second job was submitted, and
no output rows were downloaded or written.

### Checkpoint 840: charge candidate locator memory only when supplied (2026-09-28)

The catalog stream planner reserved nine bytes for every source row for an
optional candidate-locator list, even though ordinary catalog loads have no such
list. The worker allocates the locator pairs and membership bitmap only when a
candidate list is supplied. Admission now charges the actual pair count plus the
source-row bitset and per-shard flags for candidate queries, while omitting that
reserve for ordinary loads. For the 1,567,193-row inventory, the ordinary-load
reserve removed is 14,104,737 bytes (about 13.45 MiB); this can increase admitted
rows only when the request was memory-bound, and does not change the inventory or
device ceiling. A focused unrun regression covers absent, empty and full candidate
lists. No tests, build, benchmark, browser/device run, deployment, release, commit
or push ran.

### Checkpoint 841: separate temporal propagation and cooperative-yield timing (2026-09-28)

Temporal worker timing previously combined Float64 propagation, traversal across
retained source slabs and cooperative message yields into `computeAndYield`. The
receipt now also records `propagation` and `cooperativeYield` separately while
retaining the aggregate, GPU ownership waits, reuse ACK waits, tile bounds and
overall worker duration. The UI validates both new finite nonnegative intervals;
focused timing assertions were added but not run. These intervals identify which
worker phase to profile later and are not a performance result. No tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 842: reuse Kepler scratch across propagation slices (2026-09-28)

`propagatePreparedRange` previously allocated a two-value Float64 scratch array on
every call. Temporal updates call it once per 256-row cooperative slice, or about
6,122 times for 1,567,193 rows. A worker-owned workspace now reuses that scratch
across sequential slices in catalog streaming, retained-epoch recomputation and
the standalone catalog-point worker. The workspace rejects source/output buffer
aliasing and is documented as exclusive to one synchronous lane. A focused unrun
regression compares sliced results and checks alias rejection. This removes those
repeated typed-array allocations by source inspection; no elapsed-time or GC gain
is claimed. No tests, build, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 843: keep large worker selections off the UI-thread validation loop (2026-09-28)

The catalog worker's spatial selector emits representatives by ascending bits in
a source-membership bitmap, and all-row selection merges two source-ordered
sequences; both produce unique, increasing row IDs. The main-thread renderer
previously rescanned every transferred ID before WebGL upload. The canvas now
checks the worker array's exact buffer extent, requested row ceiling and final
row in constant time, then uses a worker-specific upload entry point. The generic
renderer entry point retains complete order validation for other callers. Focused
renderer coverage was added but not run. This removes a redundant main-thread
O(displayed rows) validation pass; no frame-time improvement is claimed. No tests,
build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 844: retain the terminal outcome of the 1.75-degree Gaia job (2026-09-28)

The same UWS job recorded in the local Pleiades receipt returned `EXECUTING` at
23:40:26 UTC and `ABORTED` at 23:41:20 UTC. The receipt confirms the 1.75-degree,
G<=18 query and its 100,001-row sentinel; the public Gaia directory contains only
that job receipt, with no rows, count, manifest or chunks for this attempt. The
earlier decision not to submit another same-field cone query now applies. No
dataset totals or rendering limits changed. This records an archive execution
limit, not an implementation test. No tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 845: align adaptive render pressure with the workload actually drawn (2026-09-28)

Catalog auto rendering previously blocked slow-frame reductions until the entire
current cap had been drawn. The render controller now reduces from the minimum
drawn count observed in its frame window while streaming is incomplete; growth
still requires the current cap to have been exercised. Source inspection confirms
all four catalog paths (2D/3D and all/spatial) use the same `min(plan.capacity,
displayLimit)` ceiling, while the planner independently bounds computed rows by
the request and dimension-specific memory charge (44 B/row in 2D, 56 B/row in 3D,
plus retained-epoch storage). The current MPC manifest has 1,561,171 rows; desktop
16 GB auto policy tops out at 1.25M in 2D and 750k in 3D, while manual all-row
display remains available. No runtime frame evidence justifies changing those
ceilings. `git diff --check` passed. No tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 846: revalidate Gaia chart capacity against current buffers (2026-09-28)

Current source still caps one combined Gaia chart at 200,000 rows and 128 MiB
of selected source bytes. Reads/hash may overlap across up to eight chunks, but
decoded chunk consumption is serialized; the UI also limits pending uploads to
90,000 aggregate input rows and releases credits only after upload and draw
acknowledgement. At 200,000 rows, known retained storage includes about 56.85 MB
of packed source columns, 2.4 MB of CPU display batches, a 2.4 MB GPU point
buffer, and up to a 16 MiB persistent render target, before the on-demand screen
picker index, duplicate-ID Set, transient parse objects and graphics-driver
allocations. These are typed-array accounting figures, not a total memory or
throughput bound. No safe source-only change justifies raising the chart or byte
ceilings; keep them pending current device memory and sustained upload/frame
measurements. `git diff --check` passed.
No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran.

### Checkpoint 847: verify Gaia chart epoch, projection and magnitude semantics (2026-09-28)

The browser contract requires Gaia DR3 `gaia_source`, ICRS, reference epoch
2016.0 TCB, and each row's `ref_epoch` to equal 2016. The chart converts the
catalog RA/Dec into ICRS unit vectors without epoch propagation, applies the
gnomonic basis with east left and north up, and stores `phot_g_mean_mag` only as
a Float32 display attribute for bounded point-size encoding. The UI already
disclaims current-sky, distance and angular-diameter interpretations; its
selected-field label now identifies G as a Vega magnitude. Gaia DR3 includes the
EDR3 millimagnitude-level G-band correction for its two- and six-parameter
solutions; the chart must not apply a second photometric correction. This
agrees with the
[ESA DR3 release summary](https://www.cosmos.esa.int/web/gaia/dr3) and the
[Gaia DR3 source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).
The same audit found and corrected a stale three-slot upload description: the
current window permits eight chunk slots under a separate 90,000-row limit.
Static source review only; no tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 848: expose the scope of Gaia source correlations (2026-09-28)

ESA DR3 documents that the published 5x5/6x6 within-source correlations are
estimated from each source's normal matrix while neglecting between-source
correlations; they therefore approximate the actual within-source values and
do not provide cross-source covariance. The selected-star 2D, 5D and 6D results
now label that scope in export metadata and the inspector. Propagated single-star
formal-covariance assumptions carry the same limitation, and the data guide
links directly to ESA's processing note. This matters before interpreting
multi-star or cluster statistics; it does not invalidate the per-source
reconstruction. No test, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 849: distinguish computed catalog rows from displayed representatives (2026-09-28)

The stream UI controls requested/calculated rows, byte admission, projection
dimension, viewport radius, display mode and draw limit independently. Spatial
mode computes and retains every admitted source position, then draws deterministic
screen-cell representatives and reports the visible population separately;
all-points mode is available under the same explicit draw limit. The 2026-09-25
desktop receipt loaded 1,561,171 source rows but displayed 34,505 representatives
at an 8 AU viewport. A 60-second 3D receipt reported 33,119 representatives,
P95/P99 callback intervals of 16.8 ms and 3,616 callbacks, but did not exercise
the configured 100,000 draw ceiling. Both receipts predate current stream/render
source hashes. Because live spatial occupancy, all-points steady-state behavior,
current mobile limits and current-worktree source equivalence remain unverified,
no draw-cap, frame-threshold, worker-concurrency or memory-budget increase is
justified by this audit. No tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 850: align MPCORB catalog workers on UTC-to-TT limits (2026-09-28)

The MPC fixed-width contract stores the packed epoch as `.0 TT`, with mean
anomaly, perihelion argument, node, inclination, eccentricity, mean daily motion
and semimajor axis in the documented degree/AU units. The parser decodes the
calendar day to a midnight Julian date, writes those eight values as Float64,
and the prepared propagator rotates the elliptic two-body state into heliocentric
ecliptic J2000 coordinates. It uses the source mean motion as published instead
of deriving a replacement from rounded semimajor axis. This is an osculating
two-body visualization model; it does not add perturbations or upgrade MPCORB
elements into precision ephemerides. See the [MPC minor-planet orbit format](https://docs.minorplanetcenter.net/mpc-ops-docs/orbits/minor-planet-orbit-format/)
and [MPC orbit schema](https://docs.minorplanetcenter.net/mpc-ops-docs/data-and-services/schema/mpc-orbits/).

The standalone catalog-point worker had passed pre-1972 UTC Julian dates through
as if they were TT, while the full streaming path already rejected them because
the supported leap-second table begins in 1972. It now uses the same strict
UTC-to-TT conversion, so unsupported historical dates cannot silently produce
coordinates with a fabricated time-scale equivalence. Four-way shard prefetch
remains network concurrency; propagation is a single cooperative worker and at
most two temporal tiles await renderer acknowledgement. Higher compute parallelism
would need current memory and sustained rendering evidence before changing its
worker or draw limits. No tests, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 851: admit the pinned MPCORB orbit envelope and classify missing H (2026-09-28)

A read-only pass over the pinned full release's 1,561,171 metadata/binary rows
found 627 with semimajor axis above the old default 80 AU bound and 42 with the
fixed-width H value `99.99`; the single perihelion above 80 AU overlaps the first
group. Those 669 rows were still present in the immutable source catalog, but the
default filters excluded them. Defaults now cover the pinned release's maximum
semimajor axis of 4,688.35827 AU and perihelion of 80.64144 AU. The sample map
has its own adjustable view radius, initially 80 AU, so wider scientific
selection does not change its projection scale. The stream view retains its
separate radius and render budget.

The MPC fixed-width reference labels columns 9–13 as H; its API tutorial says H
is included when available. It does not document the `99.99` sentinel. The
pinned snapshot has exactly 42 such values; the live MPC API currently reports
H=16.7 for 1999 CM154, so this work marks that pinned value unavailable without
backfilling a newer value into its historical source record. Filtering, sample
classification and decoded records now treat this exact value as unknown, and
the preprocessing parser applies the same rule to future MPCORB generation.
This is an export-specific inference, not an MPC-defined sentinel; the other 41
rows have not been independently re-queried, and new source versions need review.
The generated pinned summary/checksums still reflect the previous encoding; the
original raw MPCORB snapshot is absent, so a provenance-preserving regeneration
is pending. Sources: [MPC orbit format](https://docs.minorplanetcenter.net/mpc-ops-docs/orbits/minor-planet-orbit-format/)
and [MPC Orbits API tutorial](https://docs.minorplanetcenter.net/tutorials/notebooks/mpc_tutorial_api_orbits/).
No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran.

### Checkpoint 852: prevent stale MPCORB H coverage counts (2026-09-28)

Catalog summary schema 3 now identifies magnitude counts generated with this
export-specific `99.99` inference. The loader validates any declared count
partition in schema 1/2 summaries but hides those older coverage values, so the
pinned schema-2 summary does not display its 42 candidate sentinels as measured
H values. Its stored counts are 1,561,010 known and 161 unknown; if all 42 values
are unavailable, corrected counts would be 1,560,968 known and 203 unknown.
Those corrected values remain unapplied until the raw source can be rechecked.
The raw source snapshot needed to rebuild the immutable release is absent; its
summary and checksums have not been rewritten. The validator derives coverage
from source metadata, so a future source-backed regeneration still needs a
focused audit before acceptance. No tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 853: reconcile the live issue and pull-request backlog (2026-09-28)

After fetching `origin/main`, the remote head is `c3b87f736f47a2a182752b2c02bdc2a199b4f961`; local `main` is 103 commits ahead and not behind, with a large dirty working tree. GitHub reports 46 closed issues and one open issue, #109, plus 130 merged PRs, three closed-unmerged PRs and no open PRs. Issue #109 still directly matches the scientific-scale objective; its owner comment keeps it open pending real-device resource/frame evidence and scientific-reference coverage, so it must not be closed as complete.

The three closed-unmerged PRs are superseded: #112 by merged #111, and old dataset pins #75/#78 by merged #81/#82 and the current pinned release. The current source includes the delivered-preview capacity gate and `.github/asteroid-dataset.json` still points to `mpcorb-26bbcb75e45b7cbb-full`. A static route audit also found `/v1/state/window`, used by the Web history client; it is the documented bounded time-grid stream carrying individually validated binary state tiles, not the removed JSON `/v1/trajectory` or `/v1/current-states` compatibility path. No issue or PR state was changed. No tests, build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 854: audit the simultaneous catalog compute and display path (2026-09-28)

The capacity controls were traced through the production worker path before
considering any change. `CATALOG_STREAM_CONCURRENCY=4` overlaps bounded artifact
reads; ordered source shards are still validated, filtered, prepared and
propagated in one catalog worker. Fixed-epoch preparation caches the orbital
rotation coefficients, and source positions remain Float64 until visual
conversion. Temporal recomputation is also single-worker, using 1,024-row
upload tiles, two ownership slots and cooperative 256-row slices. The separate
catalog-points worker retains one prepared set, coalesces clock requests to the
latest epoch and computes one requested epoch at a time. These are distinct
network and compute limits; changing the read window would not add compute
lanes.

The display path has two explicit policies. Spatial mode selects at most one
representative per occupied projected cell and reports exact source-row counts
per cell in a grid capped at 65,536 cells; all-row mode also samples when the
requested draw ceiling is smaller than the loaded population. Both preserve
focused/selected rows within their budget. Adaptive promotion now requires P95
frame-callback headroom. Callback intervals do not measure GPU/compositor work.
The last complete-catalog reports predate the current pipeline hashes; their
device, memory and frame claims cannot establish present capacity.

No compute worker, read concurrency, temporal tile, spatial-cell or draw ceiling
was changed. Source review shows no evidence that increasing any of those
limits would let more bodies be calculated and shown while preserving frame
cadence. When the audit is ready for its deferred verification phase, a useful
capacity comparison must bind current source hashes and separately report full
source filtering/preparation/propagation, visible-cell population and draw
count, P95/P99 frame callbacks, browser memory and target-device behavior. This
checkpoint is source inspection only; no tests, build, benchmark or device run
was performed.

### Checkpoint 855: audit temporal reuse as a bounded catalog-capacity lever (2026-09-28)

The retained-epoch path derives each elliptic row's maximum speed as
`a*n*sqrt((1+e)/(1-e))`, using the same source mean motion that advances its
mean anomaly. The maximum speed times the larger represented/rounded TT
interval bounds path length in the fixed-element two-body model; code adds a
small floating-point allowance and refuses reuse when the bound is unavailable.
Reused coordinates keep their original computed epoch. The UI reports the
requested/computed epochs and reused/recomputed row counts, and states that the
AU budget does not include physical-orbit, solver or GPU error. The allowance
therefore bounds model motion as intended; it is not a certified physical error
bound or an exact requested-epoch result.

One plausible compute-efficiency improvement is visible in the data flow:
the worker accumulates one maximum-speed bound over the selected rows of each
source shard, and the retained store reuses or recomputes that shard as a unit.
A fast row can therefore force slower rows in its shard to be recomputed. Finer
ordered row blocks could retain the same conservative speed bound while
increasing reuse, but they would add epoch receipts, selection boundaries and
worker/main-thread handshakes. No current-hash measurement shows how often this
case occurs or how many rows it would save, so block granularity is unchanged.
Evaluate that lever only against measured recompute/reuse ratios and P95/P99
frame intervals after the deferred verification phase begins. Static formula,
data-flow and UI review only; no tests or simulations were run.

### Checkpoint 856: refine temporal reuse from pinned speed distribution (2026-09-28)

A read-only scan of the pinned `mpcorb-26bbcb75e45b7cbb-full` Float64 shards
(manifest-declared source SHA-256 `4a506b526777ae86cc2b04adbb1f82ca6570e5960cfa10eb9c215c6f90a9afb3`,
1,561,171 rows in 313 5,000-row shards; the count-only scan did not recompute
the shard checksums) applied the existing speed bound to
the interface's three reuse budgets over exactly one five-second playback
interval. It did not time the code or run a performance benchmark:

| AU budget | Whole-shard eligible rows | 1,024-row tile eligible rows | Per-row upper bound |
| ---: | ---: | ---: | ---: |
| 0.000001 | 50,000 | 332,288 | 1,516,830 |
| 0.0001 | 1,561,171 | 1,561,171 | 1,561,171 |
| 0.001 | 1,561,171 | 1,561,171 | 1,561,171 |

The strictest budget is where finer groups can matter: a whole-shard maximum
lets only 3.2% of rows reuse their prior state, while a 1,024-row maximum lets
21.3% reuse it under the same fixed-model displacement bound. The per-row
column is an unattained independent-group ceiling, not a promised result.
Busy-worker clock coalescing can make the actual interval longer than five
seconds and reduce eligible reuse. These counts do not bound MPC fit error,
solver error or rendered Float32 error.

The stream now retains each 1,024-row block's maximum while doing the existing
256-row cooperative source scan. Temporal receipts and reuse decisions align
with upload-tile boundaries; adjacent rows that still need recomputation are
coalesced into the existing two-tile upload window. All sub-blocks share the
same prepared Float64 source slab, and the resident-memory estimate includes
the added block offsets. Source orbits, propagation, position precision, reuse
budget, object admission and display ceilings are unchanged. This makes more
rows eligible for bounded reuse in the measured strict-budget scenario; it is
not evidence of faster end-to-end frames or proof that more bodies can yet be
drawn at the existing frame target.

A focused regression source covers independent bounded reuse, shared source
storage and preserved two-tile overlap. It has not been run. No tests, build,
benchmark or device run was performed; full verification remains deferred until
the requested audit/implementation phase is complete.

### Checkpoint 857: keep Gaia limits evidence-bound while auditing simultaneous display (2026-09-28)

The Gaia path admits up to 200,000 combined chart rows and 128 MiB of selected
source bytes. Source reads can overlap in at most eight bounded jobs; parsing,
validation, projection packing and first-manifest duplicate resolution remain
serialized so concurrent reads do not multiply parsed object graphs or change
which overlapping row wins. A separate eight-slot / 90,000-input-row upload
window limits unacknowledged chart payload. Each admitted display row is written
to the retained point buffer and appended to the persistent render target; the
screen-count grid is not the draw ceiling.

At the existing row ceiling, source review accounts for about 56.85 MB of packed
scientific columns, 2.4 MB of CPU display batches, 2.4 MB of GPU point storage,
and up to a 16 MiB persistent render target. Picking, duplicate IDs, transient
JSON parse objects, the canvas back buffer and driver allocations add memory
outside that subtotal. The code exposes accepted and drawn row counts plus read,
upload and acknowledgement peaks, but these receipts still need current-hash,
real-device memory and sustained frame-cadence evidence. Increasing the row,
byte, read or upload ceilings from source inspection alone would therefore be
blind tuning; no Gaia limit or worker count changed in this audit.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran. Static source inspection only; capacity acceptance remains pending.

### Checkpoint 858: distinguish active frame-cadence evidence from GPU timing (2026-09-28)

The catalog's automatic draw controller samples `requestAnimationFrame` intervals
only around actual redraw activity, stops after two idle callbacks, and associates
each sample window with the minimum displayed-point count actually exercised.
Promotion requires at least eight samples in a two-second window, four consecutive
fast windows, a fully exercised current cap, P95 at or below 16.7 ms, P99 below
28 ms and estimated missed-frame ratio below 2%; each adjustment also observes a
five-second cooldown. Sustained pressure reduces the count. These limits are
conservative frame-cadence safeguards, not measurements of isolated GPU execution
time or total canvas presentation latency.

The policy already scales the candidate workload using observed active frame
cadence, while memory hints only choose the candidate device tier and do not
promote the initial workload. Raising automatic ceilings, changing the 2D/3D
tiers, or adding GPU-query-driven adaptation is not justified by stale benchmark
hashes or source review. No policy or render ceiling changed; current-source,
full-workload, device-specific capacity evidence remains pending.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran. Static source inspection only.

### Checkpoint 859: add optional GPU draw timing to the catalog capacity harness (2026-09-28)

The catalog benchmark now probes WebGL 1's `EXT_disjoint_timer_query` and, when
the device exposes it, samples every fourth catalog draw call using bounded,
asynchronous queries. Results record the submitted point count, draw method and
per-call GPU elapsed time; unavailable, busy, disjoint and failed queries remain
visible as status/counters rather than being converted into zero-cost samples.
The report separates samples submitted by initial-load completion, includes the
benchmark-harness SHA-256, and preserves the existing animation-callback cadence
as a distinct measure. Sampling is capped at 4,096 results and 16 outstanding
queries.

This is benchmark instrumentation only: it does not alter production render
policy, draw ceilings, worker scheduling or source calculations. GPU elapsed
time excludes CPU submission, uploads, framebuffer presentation/composition and
physical display cadence; the timer queries also add measurement overhead. The
Khronos extension specifies asynchronous result polling and invalidation on GPU
disjoint events ([WebGL extension specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query/)).
No capacity increase can be based on the new field until a fresh build and
current-hash desktop/mobile evidence are collected in the deferred verification
phase.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran. Source change and documentation only; benchmark output schema advanced
to version 8.

### Checkpoint 860: reconcile 3D selection counts with submitted point primitives (2026-09-28)

Static tracing confirms both 2D and 3D catalog renderers issue `POINTS` draws.
All-row selection returns unique source-row indices; spatial selection emits
strictly increasing source-row representatives from a membership bitset. The
renderer uploads those rows as 32-bit element indices and calls
`drawElements(POINTS, min(selectionCount, drawLimit), ...)`; the direct path
calls `drawArrays(POINTS, 0, drawLimit)`. Therefore the benchmark's WebGL count
argument is a point-vertex submission count in either path, including 3D. The
receipt now names the primitive and explains the array/index count unit.

This is submitted work, not distinct stars across repeated redraws or pixel-
visible bodies: all-row mode may include offscreen points, while spatial mode can
include its documented clipping-margin candidates. Source inventory counts,
selected display rows and per-draw point submissions remain separate. No
renderer limit, 3D policy or scientific position changed.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this count reconciliation is static source inspection only.

### Checkpoint 861: separate admitted computation from rendered-body capacity (2026-09-28)

The default desktop request follows the full manifest row count; mobile defaults
to 30,000 rows. The catalog budget defaults to 512 MiB on desktop and 256 MiB on
mobile, with an explicit user control from 64 to 512 MiB. These are admission
inputs, not proof that a device can sustain every admitted row.

The default automatic draw cap starts at 100,000 desktop points or 30,000 mobile
points. It grows only after four consecutive two-second windows with at least
eight active redraw samples, P95 at or below 16.7 ms, P99 below 28 ms, and missed
frame ratio below 2%; it backs off under sustained frame pressure. The desktop16
automatic policy ceiling is 1,250,000 points in 2D and 750,000 in 3D; desktop32
can reach the 1,567,193-row inventory ceiling in either mode. The mobile12
policy ceilings are 500,000 and 250,000 respectively. One policy edge remains:
devices classified as mobile-conservative (reported memory at or below 4 GiB)
have an 8,000-point auto ceiling, but the catalog page supplies its 30,000-point
default as `initialCount`, and the hook widens the policy maximum to at least
that baseline. The actual starting cap on that path is therefore 30,000. The
explicit draw-limit control can request the full manifest count. These ceilings
and thresholds are source policy, not measurements of this checkout on target
hardware.

Computation still runs sequentially in one catalog Worker. Four-way concurrency
overlaps bounded binary-shard reads with one active shard's validation, filtering,
preparation and propagation. Adding compute Workers would require ordered tile
publication and a shared/partitioned verified index; copying the compact index
per Worker can add tens of MiB per copy and invalidate the current admission
budget. Existing stage receipts distinguish read/hash, validation, filtering,
packing, element preparation, propagation, and tile wait; the optional benchmark
GPU timer adds asynchronous draw-time evidence where supported. Those receipts
have not been run in this audit phase, so no source evidence shows which stage
currently limits admitted or displayed bodies. No cap or concurrency changed.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records static policy and data-flow inspection only.

### Checkpoint 862: verify that spatial display selection does not take a source prefix (2026-09-28)

Static tracing of `selectCatalogSpatialPoints` confirms that it projects each
candidate with the same 2D or rotated 3D display basis used by the renderer,
maps in-view rows into an aspect-aware screen grid sized to the draw budget, and
chooses a deterministic row hash winner for each occupied cell. A point inside
the mathematical viewport replaces an edge-margin candidate in the same cell;
explicit focus and located selections receive priority. Selected membership is
then emitted in ascending source-row order. The winner decision therefore does
not use first-row truncation, and output order is not the selection priority.

When all computed rows fit under the cap, the selector retains every visible
row. When the snapshot exceeds the cap, it keeps at most one ordinary
representative per occupied screen cell, alongside any in-view pinned rows. When
generated, the separate count overlay aggregates all in-viewport source rows
per projected cell, bounded to 65,536 cells; dense populations are not
represented as individually resolved stars. This is a visual screen-space
selection, not a physical-density, probability, or event-rate sample. The
separate all-row mode uses deterministic midpoint ranks in upload order and
remains explicitly labeled as non-spatial thinning.

No source-order omission was found in spatial mode. A multi-representative cell
policy could spend more of the draw cap on dense pixels, but would increase
overdraw without creating additional screen resolution; no change is justified
by source inspection alone. No selection policy, rendered count, or scientific
position changed.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records static source, consumer and contract-test
inspection only.

### Checkpoint 863: verify mixed known/unknown temporal block bounds end to end (2026-09-28)

The per-block speed path preserves a finite bound for each supported block and
marks an unsupported block as unknown. The stream-level aggregate becomes null
if any block is unknown, but `appendSource`'s fallback for an explicit null block
therefore remains unknown; finite sibling values stay block-local. `planEpoch`
recomputes an unknown-speed block after a changed epoch and can still reuse a
supported sibling whose periapsis-speed displacement remains under budget.

The source propagator advances mean anomaly linearly at the stored mean motion,
solves `M = E - e sin(E)`, and constructs the standard elliptic position from
eccentric anomaly before applying its orbital-plane rotation. Differentiating
that ellipse gives `|v| = a n sqrt(1 - e^2 cos^2(E)) / (1 - e cos(E))`, whose
maximum is the implemented periapsis bound `a n sqrt((1+e)/(1-e))`; `n` is
converted from degrees/day to radians/day. The orbital-plane rotation preserves
this mathematical Euclidean-speed bound in both 2D and 3D projections.

Prepared source appends are split into at most 1,024-row blocks. The main thread
reconstructs those original boundaries from the acknowledged selected-row
layout. Adjacent blocks marked for recomputation may be coalesced into transfer
tiles that cross an original boundary, but every crossed block is computed at
the same target epoch. The receiver advances the tile through its original
block boundaries, then checks each completed epoch/date/displacement receipt
against that layout before restoring the renderer. Reuse messages remain ordered
and separately acknowledged.

This disproves the suspected null-fallback regression and shows no unsafe
cross-boundary temporal reuse in the inspected path. Existing source tests cover
independent finite block bounds and preservation of the two-tile upload window;
no test was run, and mixed unknown/finite block behavior has not been executed in
this audit phase. This derivation validates the displacement bound only for the
implemented elliptic two-body model; it does not bound MPC element-fit error or
floating-point/solver error. No speed policy, propagation, or upload behavior
changed.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records static producer, store, worker and consumer
inspection only.

### Checkpoint 864: align future UTC quality boundary with NAIF LSK notice (2026-09-28)

IERS Bulletin C 72 confirms no leap second at the end of December 2026 and
states UTC−TAI remains −37 seconds from 2017-01-01 until further notice. NAIF's
18 July 2026 announcement says the current `naif0012.tls` remains current until
at least 2027-07-01. The prior quality flag changed to `future-uncertain` on
2027-01-01, six months before the announced current interval ended.

Moved the uncertainty boundary to 2027-07-01, added the NAIF announcement to
the returned time-scale provenance, clarified the distinction between the
historical leap table and the published current interval, and added a focused
June 30 / July 1 boundary regression. `utcTimeScaleQuality` is also consumed by
the explorer status and analysis evidence receipts, so the same boundary flows
into UI and exported evidence. The regression has not been run, per the current
no-tests instruction.

The NAIF wording is “until at least” July 1; this implementation marks July 1
itself uncertain, conservatively at the first instant beyond the prior UTC
offset's applicability. Recheck the IERS/NAIF announcements before extending
the supported interval further.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records source, UI/receipt consumer and official
source inspection only.

### Checkpoint 865: audit current catalog compute/render capacity (2026-09-28)

The current Web catalog requests the complete admitted desktop release, up to
1,567,193 rows; the 3D buffer materializes only the adaptive active draw prefix.
Desktop 3D Auto tops out at 750,000 on the default tier and 1,567,193 on the
higher-memory tier; Maximum may reach the full release. Mobile 3D stays at or
below 250,000. Spatial mode computes the full eligible source pool before
selecting one deterministic representative per occupied screen cell. This
separates computation coverage, ready rows and actually drawn rows explicitly.

The retained spatial benchmark reports 1,561,171 computed rows and 34,505
submitted representatives at 545x698, with 16.8 ms callback P95 on both
SwiftShader and NVIDIA D3D11; drawing every row measured 66.7 ms P95 on
SwiftShader. The same report says its four core files predate the current
worktree, so those values are historical evidence only and cannot justify a
current cap or speed claim. The render budget already promotes after repeated
headroom and reduces after measured frame pressure. No source-based argument
supports raising a hard ceiling or allowing multiple points per screen cell
without current device/load evidence.

The separate Gaia sky loader already overlaps up to eight chunk reads, keeps
in-flight work under 96 MiB and 90,000 input rows, serializes decode/packing
within one worker, and limits a chart to 200,000 rows. These bounds coordinate
network throughput, CPU decode and UI upload acknowledgements; increasing them
without current memory and frame evidence risks moving the bottleneck to parsing
or rendering. No cap, sample policy, display identity, or parallelism changed.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records static budget, worker, renderer, documentation
and stale-measurement review only.

### Checkpoint 866: reconcile live GitHub issue and PR inventory (2026-09-28)

The live repository inventory contains 47 issues: 46 closed and one open.
Open issue #109, “架构升级：流式精确状态瓦片、惰性 SPK 与自适应多端渲染,”
matches the current project goal and explicitly remains incomplete pending real
hardware capacity/frame evidence and scientific reference-oracle/boundary
validation. Its owner-authored reopen comment also says deployment and release
stay paused. Leave it open until those criteria are actually met.

The 133-PR inventory has 130 merged, three closed unmerged and none open. The
closed dataset-pin PRs #75 and #78 point to older MPCORB hashes; the current pin
is `mpcorb-26bbcb75e45b7cbb-full`, so neither old pin should be restored. Closed
PR #112's Pages-capacity behavior is present in the current product-aware builder
and docs. No open PR or unmerged contribution requiring action was found; no
remote status or GitHub content was modified.

This is a live status inventory, not a re-audit of every previously closed
issue's original scientific claim. No issue was reopened or closed during this
read-only pass. Broader scientific, interaction and device-validation scope
remains under #109.

No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran; this checkpoint records live GitHub state plus local source/data-pin
comparison only.

### Checkpoint 867: align UTC future leap-second warning horizon (2026-09-28)

The ground-observation backend previously emitted
`no-leap-seconds-after-2017-assumed` for every observation after 2017, even
though the pinned GoFA table and current IERS/NAIF notices support the existing
37-second offset through 2027-06-30. This overstated the future assumption for
present-day and near-term results.

Moved the warning threshold to 2027-07-01 and renamed it
`future-leap-seconds-assumed`. Single-observation, visibility-window and ground-
contact contracts now share and publish that uncertainty boundary; browser
validators enforce it, and single-observation, visibility and contact result
views surface the warning for future-dated requests. Updated the explanation
with direct IERS Bulletin C 72 and NAIF announcement links, and synchronized
the three affected fixtures so 2024/2026 samples no longer claim a future leap
assumption.

Static checks verified the fixtures parse, expose the same contract boundary,
and no active source or fixture retains the old warning key. `git diff --check`
passed for the changed scope. Regression/runtime tests, build, benchmark,
browser/device acceptance, deployment, release, commit and push remain deferred
under the current no-tests instruction.

### Checkpoint 868: separate catalog computation from visual admission (2026-09-28)

Static tracing confirms the catalog controls can request the complete manifest
row count on desktop and independently set a drawing ceiling. The `all` display
mode submits all rows already computed when they fit that ceiling; above it, the
renderer uses a deterministic bounded source-order selection. The `spatial`
mode chooses viewport representatives and reports the eligible population, but
does not thin the computed ephemeris snapshot. Automatic drawing starts at its
current cap and changes only after sustained measured frame windows; it will
not draw more rows than the current stream admitted. Raising the source row
request increases how many bodies can be computed and made available to either
display mode.

Dynamic full-snapshot epoch propagation remains serial inside the catalog
Worker, split into 1,024-row upload tiles and cooperative 256-row propagation
chunks, with at most two upload buffers awaiting ownership return. A worker pool
would change prepared-coefficient ownership and retained-memory admission; the
current-source bounded-playback benchmark has not been captured, and historical
performance receipts do not match the current source hashes. No render cap,
default, or parallelism change is justified without that measurement, so this
pass made no speculative performance adjustment.

This was a source/UI/benchmark-document audit only. No tests, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 869: compare exact-state tile ceilings across clients and backend (2026-09-28)

The exact SPK state path has independent bounded stages, none of which is the
local MPCORB catalog's 1,567,193-row drawing ceiling. Web partitions requests at
32,768 IDs and 8 MiB, allows two active plan workers, and limits page-wide tile
fetch/decode to two permits. Android and iOS accept up to 2,000,000 aggregate
rows and fetch two adjacent tiles only after reserving both temporary working
sets; otherwise they fall back to one tile. Android serializes/replaces an
allocation-heavy load while its worker is still retiring the previous request.
The Go server plans 32,768 IDs, defaults to 16,384 rows per tile, encodes at
most two tiles concurrently, and resolves plans in 1,024-row blocks with up to
four blocks per request under a separate configured/global compute scheduler.
Its plan cache is byte-bounded.

The 1,024-ID, 1,024-epoch and 262,144 body-epoch caps belong to the streamed
history endpoint; they do not limit the current-frame state-tile route or local
catalog rendering. The current limits therefore preserve a path to request more
exact states without conflating history, catalog propagation and GPU admission.
Increasing tile concurrency or worker counts without a current workload's
throughput and peak-memory evidence could spend memory without increasing the
number of bodies successfully displayed. No cap or concurrency change was
made. The next useful measurement, once test/benchmark work resumes, is paired
state-plan throughput plus peak client/backend memory across worker counts,
followed by target-device frame and memory measurements.

This was a static source and contract audit only. No tests, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 870: audit Gaia row admission, retained arrays and packaged source scale (2026-09-28)

Gaia input and display admission share a 200,000-row collection ceiling, with
100,000 rows per manifest, 128 MiB selected chunk bytes, 96 MiB/90,000 rows
reserved for active source chunks, eight maximum parallel chunk reads, and a
64 MiB default worker source cache. `GaiaPlot` preallocates 12 bytes per admitted
row in its GPU point buffer and retains 12 bytes per displayed row in worker
transfer batches for later point picking. The source store uses exact Float64
columns plus 64-bit IDs and null flags; at 200,000 schema-v2 rows these typed
columns alone occupy 57,000,000 bytes. That is a lower bound, not a peak-memory
measurement: parser objects, duplicate-ID sets, active chunk bytes, cache data,
GPU render targets and browser/driver overhead add more.

The six currently packaged Gaia manifests contain 44,211 input rows in total;
the largest is 16,966 rows. The only retained real Gaia performance receipt
covers 4,460 rows and is bound to older renderer source. The 16,966-row pack and
the current renderer have no paired device/frame/peak-memory receipt. The 200k
ceiling therefore remains a bounded software admission value, not demonstrated
device capacity. Static evidence does not justify increasing row admission,
chunk concurrency or the per-manifest ceiling, and no speculative tuning was
made. A useful future measurement must record current source hashes, loaded and
unique rows, peak JS/GPU memory, sustained frame timing, and target device tier.

This was a static source, manifest and receipt audit only. No tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 871: refresh open issue and closed pull-request alignment (2026-09-28)

The live repository has one open issue, #109, and no open pull requests. Issue
#109's objective still matches the user's current goal: compute, transfer and
display more known bodies under auditable scientific contracts, with deployment
and release kept paused. It remains incomplete because end-to-end acceptance,
real-device performance and scientific-oracle coverage have not been verified;
keep it open while implementation work continues.

Three historical pull requests are closed without merge. #112's Pages capacity
gate is already superseded on remote `main` by the product-profile-aware preview
gate (`DELIVERY.product === 'preview'`); #75 and #78 are intermediate MPCORB pin
updates superseded by the current remote pin `mpcorb-26bbcb75e45b7cbb-full`.
No reopening or duplicate implementation is justified. The issue listing has no
other open items; previously closed issues and merged pull requests need no new
action from this status refresh.

This was a read-only GitHub and source-status audit. No issue or pull-request
comments, closes, merges, tests, builds, benchmarks, deployment, release, commit
or push ran.

### Checkpoint 872: identify the missing batch Gaia motion path (2026-09-28)

The Gaia catalog schema already carries `pmra`, `pmdec`, parallax, their formal
errors/correlations, and radial velocity where the archive provides it. The
existing SOFA-backed motion experiment is bound to one `sourceId` and one
original CSV/manifest receipt; the sky chart is explicitly fixed at J2016.0.
Catalog chunk selection is also defined by capture-time bins and rejects later
epochs until motion-aware bounds exist. Therefore today’s chart cannot honestly
claim to compute a current-epoch stellar cohort, even though a separate selected
star can be propagated.

A useful capability slice is batch propagation of a frozen, source-verified
cohort with per-source validity/missing reasons, explicit TCB epoch and model,
and an exported source receipt. It must distinguish position-only or missing
parallax/RV from a fully specified single-star state and must not reuse the
J2016 cone bins as a completeness claim at a later epoch. A bounded packed-array
worker or backend batch route could serve up to the current admitted cohort,
but its numerical oracle, per-row error policy, source-coverage semantics and
peak-memory behavior must be established before scaling beyond the single-star
path. No propagation model or performance limit changed in this audit.

This was a source and scientific-contract audit only. No tests, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 873: bound exact Gaia batch propagation by the existing SOFA path (2026-09-28)

The reusable numerical primitive is already `internal/stellarmotion.Propagate`,
which calls `gofa.Starpm` and converts Gaia `pmra` (including cos(dec)) plus
parallax through the project's explicit TCB/TDB-compatible scale. Its accepted
domain is deliberately narrower than the chart schema: Gaia epoch 2016, solution
codes 31 or 95, finite RA/Dec/proper motion, positive parallax, finite radial
velocity, the explicit `spectroscopic-as-astrometric` policy, and at most 100
Julian years from the reference epoch. SOFA nonzero status is rejected.

The existing HTTP experiment verifies one original CSV and one source ID. Its
CSV parser stops at 30,000 rows, the request envelope is 26 MiB, the response is
14 MiB, and the handler has a 20-second deadline in the trajectory-work queue.
This is not a scalable chart path: repeating the full CSV per tile would multiply
I/O and decode, while silently filling missing parallax or radial velocity would
invent model inputs. Any batch path should reuse the existing SOFA primitive,
verify source chunks once, return per-source propagated/missing/rejected status,
and keep bounded tiles with cancellation and provenance. The chart must retain
the fixed-J2016 label until it actually consumes the batch result.

This was a static Go/HTTP contract audit only. No tests, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 874: implement bounded Gaia chunk propagation contract (2026-09-28)

Added `POST /v1/stellar/motion/tile` for one original Gaia JSON chunk (up to
30,000 rows). The handler accepts a 45 MiB maximum base64 JSON body, isolates
batch request admission to at most two active requests, then uses the existing
compute scheduler and SOFA propagation model. The service rechecks exact source
hashes, the Gaia manifest contract, row columns and selection/bin constraints;
per-row outcomes remain propagated, missing or rejected. Batch TDB epoch parts
are computed once and shared across rows, leaving the SOFA single-source math
and published fields unchanged.

Added a client receipt validator for the endpoint. It checks uploaded byte
hashes, ordered source IDs, result counts, SOFA model/policy, and split TDB
receipts. The Gaia chart does not call this helper yet and remains fixed at
J2016.0, so this is an available bounded backend capability, not an integrated
multi-epoch chart. Its request size, active limit and throughput still lack
runtime/device evidence. `gofmt` and `git diff --check` were run as static
format/diff checks; no tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 875: display the bounded propagated Gaia cohort (2026-09-28)

The stellar workspace now offers a batch mode taking one original manifest and
one listed Gaia chunk. It reuses the browser's chunk-hash, schema, row, bin and
cone checks, submits the same raw bytes to the backend receipt validator, and
uses the existing WebGL renderer to plot only propagated rows that remain
inside the original cone. Missing or rejected rows are excluded from this
target-epoch plot; point size still uses J2016 Gaia G magnitude. The user can
inspect selected rows and export all per-source outcomes. The principal Gaia
sky-chart stream is still at J2016 and has no multi-chunk motion integration.
Manifest/chunk reads, hash/schema validation, backend upload, receipt checks and
projection run in a dedicated Web Worker; the UI thread receives the bounded
Float32 draw buffer and selected-row records.

This is a source-contract implementation only. Go files were formatted with
`gofmt`; no tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran. The new React/TypeScript and WebGL path still needs
final type/test checks and visual acceptance before it can support wider cohort
or performance claims.

### Checkpoint 876: stream every chunk in a bounded Gaia motion cohort (2026-09-28)

Expanded stellar batch mode to accept one original manifest with every chunk it
declares, reject omissions, duplicates and unlisted files, and reconcile all
chunk hashes and row counts before reporting completion. The dedicated Worker
uses two bounded source-read slots while serializing decode, backend propagation
and result delivery. Each verified chunk is appended to the existing WebGL
buffer as it completes; the buffer capacity is fixed from the manifest's
declared rows, up to 100,000. Source data remains capped at 128 MiB. Cone
membership now uses an atan2 cross/dot angular separation, avoiding acos loss of
precision for small fields. Receipts and source hashes are exported together.
For non-empty display batches, the worker waits for the chart's checked GPU
upload/draw acknowledgement before sending the next batch, bounding queued UI
results. The acknowledgement does not certify physical display presentation.

Only static code and documentation inspection has been performed for this
checkpoint. Per user instruction, no tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran. Multi-manifest
200,000-row motion rendering and device throughput evidence remain unverified.

### Checkpoint 877: admit a bounded multi-manifest Gaia motion field (2026-09-28)

Extended stellar batch mode from one manifest to one through eight remote
manifests, with aggregate checks for 200,000 declared rows, 128 MiB of selected
chunk bytes, 8 MiB of manifest bytes and a conservative shared tangent-plane
radius capped at 80 degrees. Same-schema manifests are streamed in order and
cross-manifest Gaia `source_id` duplicates use first-manifest precedence. Local
file input remains one complete manifest and its declared chunks. The manifest
collection SHA-256 and every original manifest/chunk receipt remain exportable.

Static inspection found that appending selected plot rows with array spread
copied the full accumulated index for each chunk. The UI now appends compact
source ID/RA/Dec/parallax records through a ref, keeping per-chunk insertion
linear and avoiding a second full propagated-state copy for chart selection.
Each verified chunk now requires an acknowledgement; plotted chunks wait for
the checked WebGL upload/draw path, while empty-display chunks are acknowledged
after their receipt is queued on the page. This prevents empty or unpropagatable
chunks from flooding the main-thread message queue. The existing row/byte limits
are admission policies, not total-heap or device-performance measurements.

Only source and documentation inspection has been performed. Per user
instruction, no tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran. Multi-manifest scientific consistency,
200,000-row runtime rendering and device throughput remain unverified.

### Checkpoint 878: reuse verified Gaia manifests across motion tiles (2026-09-28)

Source inspection confirmed that the Go service admits at most two active Gaia
motion-tile requests per instance, with a 45 MiB request limit and 14 MiB JSON
response limit. Increasing the browser's one-request-at-a-time propagation to
two would overlap large decoded inputs and outputs; there is no representative
heap or throughput evidence to justify that change yet. The client continues
to use two bounded source-read slots and preserves ordered propagation and
per-chunk chart acknowledgement.

Removed a definite repeated client cost: each chunk previously re-hashed and
Base64-encoded its full manifest. The worker now creates a private snapshot,
checks its SHA-256 and prepares Base64 once, reuses that upload form for the
manifest's chunk requests, then releases it after the manifest completes. The
wire still retransmits the manifest and the backend still parses it per chunk;
this is source-level CPU/allocation reduction only, with no measured latency or
throughput claim.

Only static source, reference and whitespace checks were performed. Per user
instruction, no tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 879: reuse parsed Gaia manifests within a bounded backend cache (2026-09-28)

The HTTP path reparsed the same bounded manifest and rebuilt its chunk descriptor
map for every tile, even though one collection sends many tiles under the same
manifest. Each backend instance now keeps at most four successful parses under
an 8 MiB conservative admission budget, keyed by SHA-256 of the exact manifest
bytes, with least-recently-used eviction. Invalid or over-budget parses are not
retained. Concurrent duplicate parses can still occur, but a second lookup
prevents retaining both copies. Local counters expose hits, misses, duplicate
parses, evictions, and charged resident bytes for a later focused measurement.

The cache reuses only immutable parsed manifest settings and descriptors. Every
tile still hashes the provided manifest and chunk and validates chunk structure,
IDs, source fields, bin, magnitude and cone membership before propagation. It
does not reduce transfer size or establish a throughput gain. The 8 MiB figure
is conservative cache admission accounting, not measured Go heap usage.

Only static source, reference and whitespace checks were performed. Per user
instruction, no tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 880: overlap Gaia chunk calculation with chart upload (2026-09-28)

Source inspection found that `streamGaiaChunks` already overlaps two bounded
source reads, but the motion worker held its ordered consumer until each chart
upload ACK arrived. `GaiaPlot` performs checked buffer upload and draw before
ACK, then schedules the final compositor presentation. The worker now uses a
two-slot, 60,000-input-row ACK window: after posting one verified result it can
read, validate and calculate the next chunk while the earlier draw is awaiting
presentation; it waits for credit before starting further calculation. Chunk
sequence, source-ID deduplication, and manifest order remain serial and stable.

This adds bounded compute/render overlap; it does not run two large propagation
requests from one worker concurrently. It also does not prove higher measured
throughput or physical presentation timing. The aggregate browser heap and
device-specific capacity remain unmeasured. Only static source, reference and
whitespace checks were performed. Per user instruction, no tests, typecheck,
build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 881: replace duplicated Gaia plot rows with typed ordinals (2026-09-28)

Each plotted source was retained twice in the page: inside the complete
scientific tile receipt and as a second structured-cloned object containing its
source ID and displayed coordinates. The worker now transfers one `Uint32` row
ordinal per plotted source; selection and the first-20 table resolve that index
against the retained receipt. At 200,000 plotted sources the ordinal payload is
800,000 bytes, replacing the additional per-row object graph and its worker-to-
page structured clone. The complete scientific receipts, point-coordinate
buffers, and source-ID deduplication set remain retained, so this does not bound
total browser heap or device memory. Export still serializes the same receipt
fields and omits the UI-only ordinals. Only static source and whitespace checks
were performed; no tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran.


### Checkpoint 888: Gaia motion buffer and export lifetime audit (2026-09-28)

Static inspection traced ownership across `loadStellarMotionTile`, the ordered
`streamGaiaChunks` consumer, worker transfer, page retention, selection, reset,
and streamed export. The tile loader validates every returned row status and
reconciles propagated/missing/rejected counts before compaction. The worker
checks each response row against its verified source ID, projects and
deduplicates while the `BigInt64Array` is still attached, and transfers it only
after those reads finish. After the callback resolves, `streamGaiaChunks` uses
descriptor metadata for its completion counters and does not access transferred
chunk row buffers. The worker also finishes using the compact arrays before the
transfer call.

The page validates typed-buffer lengths and plot ordinals before retaining a
receipt. Export captures a shallow snapshot of the verified chunk list at click
time; a subsequent clear, cancel, or new run replaces the live page refs but
does not mutate that export snapshot. The stream pulls one tile receipt at a
time and reconstructs its rows on demand. Thus an export already started is
intentionally a snapshot operation and continues after the UI state is reset.
The generic stream exposes its underlying `cancel` hook, but this export call
does not expose a user-facing abort handle; an explicit export-cancel control is
not implemented. `Response.blob()` still creates the final browser-managed
download Blob, outside the bounded JavaScript serialization batches.

This was a source-lifecycle audit only. No tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran. Final validation
must exercise transfer detachment, clear/cancel during export, exact receipt
serialization, and download behavior in supported browsers.

### Checkpoint 889: bound Gaia duplicate-index cardinality (2026-09-28)

The current admission contracts cap one manifest at 100,000 rows, a collection
at eight manifests and 200,000 aggregate rows. `streamGaiaChunks` holds one
manifest-local `Set<bigint>` to reject duplicate source IDs inside that
manifest. Stellar batch processing also holds a collection-wide set while it
streams manifests serially, so its two indexes can retain at most 300,000
distinct BigInt keys at once (200,000 collection keys plus 100,000 for the
current manifest). The catalog worker processes bounded manifest read groups;
all active manifest-local indexes together are limited by the collection's
200,000 rows, in addition to its collection-wide index of at most 200,000,
giving a 400,000-key aggregate ceiling. These are entry-count bounds, not byte
bounds: ECMAScript does not specify `Set` storage overhead, hashing cost, or
garbage-collection timing.

The three Gaia duplicate-index loops now perform one native `Set.add` per
source ID and distinguish duplicates by whether `Set.size` increased. This
preserves exact BigInt identity, first-occurrence behavior and duplicate errors
while avoiding the explicit `has` lookup before each insertion. It does not
change retained-set memory or claim measured throughput improvement.

A typed open-addressed index could make the storage bytes explicit and reduce
object overhead, but it adds custom hash/probe work to every source row and may
change packing throughput. No replacement is justified without the deferred
multi-tier memory and throughput measurements. Keep the existing native sets
until final hardware evidence can compare exact duplicate semantics, peak
memory and processing rate; do not treat the row ceiling as verified device
capacity. This loop simplification was checked against the synchronous
iteration and collection ordering contracts in source. Source inspection and
arithmetic only; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 890: distinguish catalog spatial and temporal screening stages (2026-09-28)

Cross-file source tracing confirms catalog source filters and the admitted-row
budget run before binary element preparation and initial propagation. The
spatial view index is downstream: it builds lazy, conservative bounds over the
same Float32 visual coordinates used by point selection, then skips only whole
1,024-row blocks proven outside the current viewport. Its cached AABB/end/dirty
arrays match the planner's per-block byte formula; a cold selection still reads
positions to build bounds, and broad bounds still fall back to per-point tests.
It does not suppress source downloads or propagation for admitted rows.

Temporal reuse is separately partitioned into 1,024-row retained source blocks.
Each block's original Float64 elements provide a periapsis-speed upper bound;
unknown bounds force recomputation, and reuse requires its source-model path-
length cap to fit the requested displacement budget. This avoids recomputing
some admitted rows across nearby epochs, but `planEpoch` still visits each
retained block and it is not an object-wise space-time visibility index.

No correctness defect in the existing conservative skip/reuse gates was
identified by source inspection. Do not promote viewport culling into a source
or compute prefilter without a conservative orbit-over-time envelope: an
offscreen position can enter the viewport later. Any finer hierarchy also
needs end-to-end source-order, Float32-edge, cancellation, memory and throughput
evidence. No code, test, typecheck, build, benchmark, browser/device,
deployment, release, commit or push ran in this audit.

### Checkpoint 891: conservatively screen catalog shards from compact-index intervals (2026-09-28)

The compact-index writer stores semi-major axis exactly as Float64 and encodes
eccentricity, inclination and absolute magnitude at 1e-9, 1e-6 degree and 0.01
magnitude scales. Shard admission now tests each candidate row against outward
half-quantum intervals for those fields. For perihelion filters it propagates
the eccentricity interval through `q = a(1-e)` and includes floating-point
padding. Exact semi-major-axis and orbit-class filtering remains in place;
unknown-magnitude status follows the existing matcher contract. A row can keep
a shard in consideration but cannot pass final selection from compact values:
the source-precision binary and metadata filters still decide selected rows.

This gate runs before per-shard metadata and orbital-element reads, so it can
reduce those reads and subsequent preparation/propagation when every candidate
row in a shard is provably outside the requested filters. It does not reduce the
compact-index download or its row scan, raise the memory-admitted row ceiling,
or establish a throughput improvement. Static source inspection matched the
quantization constants to `scripts/preprocess-asteroids.mjs` and the source
domain checks to the catalog validator. No tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran.

Deferred validation should compare admitted chunk sets against a source-
precision reference across half-quantum boundaries for eccentricity,
inclination and magnitude; perihelion products near range edges; unknown H
statuses and sentinel encoding; and filters outside source-domain bounds. It
should also measure metadata/binary reads and propagation only on representative
full and selective catalog filters. No test was run during this audit.

### Checkpoint 892: keep catalog read and compute concurrency tied to admitted memory (2026-09-28)

The compact-index reader owns each network chunk as it arrives and geometrically
grows one destination buffer. During growth the old destination, replacement
destination and current stream chunk can overlap. The planner reserves two full
compact-index strides per source row; this covers old-plus-new destination
storage and the worst case where one stream chunk contains the entire index.
Reducing that reserve based on typical browser fetch chunk sizes would not be a
safe way to raise the admitted body count. The stream's binary prefetch queue is
explicitly capped at four shards, while validation, exact row filtering,
preparation and Kepler propagation process one shard at a time. Their bounded
scratch is included in `pipelineBytes`; increasing read concurrency would add
fixed scratch and can reduce row capacity before proving a throughput gain.

Source inspection found no justified concurrency or full-index-memory reserve
reduction without representative device and stream evidence. Exact-size direct
index filling could reduce intermediate copies for ordinary chunking, but its
worst-case peak still includes a full incoming chunk and no capacity gain is
established; defer it unless a measured read/assembly bottleneck warrants the
extra path. No code, tests, typecheck, build, benchmark, browser/device run,
deployment, release, commit or push ran for this checkpoint.

### Checkpoint 893: separate admitted, computed and individually rendered star populations (2026-09-28)

The MPCORB catalog has separate source admission and point-draw limits. Its
planner caps admitted rows by the byte budget and request; the viewer caps
individual draws by `min(plan.capacity, displayLimit)`. The source inventory
ceiling is 1,567,193 rows. Desktop 2D auto can adapt up to 1,250,000 and max
quality up to the inventory ceiling; desktop 3D auto tops out at 750,000, while
max quality can reach the inventory ceiling. On desktop32, both auto and max
policies can reach the inventory ceiling in both modes. Mobile tiers are lower.
Adaptive growth uses repeated frame-duration samples; the callback interval is not a
measurement of GPU completion or compositor latency. In spatial mode, the
bounded screen-count overlay summarizes rows behind the representative points,
so its count is not an individually rendered-body count.

Gaia motion batch ingestion has a different contract: at most eight manifests,
200,000 aggregate input rows and 128 MiB of selected chunks. Network jobs use
the separate 96 MiB / 90,000-row default in-flight reservation, up to eight
active reads, and ordered decode/callback admission. The motion-batch worker
uses two concurrent consumers and waits for page upload credit; the page returns
credit after `GaiaPlot` appends to a preallocated `capacity * 12`-byte WebGL
buffer and validates the incremental draw. Its persistent RGBA8 render target
is bounded by a 2,048-pixel side and device limits. The page also retains
per-row propagation receipts and display batches for selection/export, so the
read reservation does not bound total process/GPU memory. Increasing a read
window would not itself increase propagated or presented rows. No source
evidence justifies raising these caps without GPU/RSS/throughput measurements
on target devices.
No code, tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran for this checkpoint.

### Checkpoint 894: trace Gaia motion response buffers through GPU acknowledgement (2026-09-28)

Each motion request is limited to 30,000 input rows and a 14 MiB JSON response.
The batch worker permits two concurrent consumers, but reserves no more than
two pending chart-upload acknowledgements or 60,000 rows. Backend result rows
are validated, then compacted to a `BigInt64Array` of source IDs; `statuses`,
`reasonCodes` and `stateIndexes` typed columns; and six-field Float64 state
rows. The worker releases the original row-object array after compaction.
Projection builds a per-chunk
Float32 display array and Uint32 row ordinals; both are transferred to the page.
The page retains these exact-sized batches alongside compact scientific results
for picking and export, without making a second row-object copy during ordinary
display. `GaiaPlot` appends each batch to its single preallocated vertex buffer
and acknowledges only after the incremental draw passes its WebGL error check.

The projection scratch is bounded by one 30,000-row chunk (at most 360,000
bytes for the full Float32 point buffer before the exact-sized display copy),
and ordered publication prevents the second concurrent request from building
another projection buffer while the earlier one commits. However, the 64 MiB
in-flight budget measures encoded source-chunk bytes; it does not model Base64
request strings, bounded JSON response bodies, parsed object graphs or total
browser/driver memory. Those remain bounded by separate row/chunk/response
limits but are not calibrated as a total RSS ceiling. No source-supported
change to concurrency or the 200,000-row collection cap is justified without
peak-memory and frame-time measurements. No code, tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran for this
checkpoint.

### Checkpoint 895: align Gaia motion tile limits across browser and server (2026-09-28)

Static cross-layer inspection found matching payload and row boundaries. The
browser accepts at most a 1 MiB manifest, a 32 MiB source chunk and 30,000 rows;
the server's 45 MiB JSON request limit covers the combined 44 MiB base64 source
payload plus envelope. The server model limit is
`stellarmotion.MaxBatchRows = 30,000`; the browser separately caps its chunk
manifest and request at the same numeric value. These limits currently agree
but are not generated from one cross-language source, so future changes must
update both sides together. Server manifest verification also retains the
matching 32 MiB per-chunk and 128 MiB per-manifest selected-byte ceilings. The
server caps the marshaled tile response below 14 MiB including its trailing
newline, matching the browser's 14 MiB bounded response reader.

Server admission limits active tile handlers to at most two and queues at most
four before body decoding; the request then passes through a separate bounded
compute scheduler. The handler's 30-second deadline is shorter than the
browser's 40-second tile deadline. Thus no source-level client/server size,
row-count or active-request mismatch was found. The browser's 64 MiB in-flight
reservation is still a source-chunk-byte measure: it excludes base64 request
strings, parsed response objects and actual process/GPU memory. These have
separate finite row, per-request and concurrency caps, but no end-to-end RSS
measurement. No limit was raised. Static inspection only; no tests, typecheck,
build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 896: use one browser Gaia motion capacity source (2026-09-28)

Browser motion manifest preparation, request validation and base64 encoding,
plus compact-result packing, now use their applicable manifest-byte,
chunk-byte or per-chunk-row limits from `src/data/gaiaCapacity.json`. This
removes duplicate browser-side numeric limits without increasing any admission
ceiling. Go still owns independent server constants, so cross-language drift
remains possible and the existing cross-layer audit still records that
limitation. This makes browser limit updates internally consistent; it does
not increase the number of stars computed or displayed, prove a throughput
gain, or justify raising concurrency. Static source and whitespace checks
only; no tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 897: trace Gaia admission through presentation storage (2026-09-28)

Both application callers of `streamGaiaChunks` first pass their complete
selection through collection planning. `planGaiaCollection` rejects aggregate
rows above 200,000 and selected source bytes above 128 MiB. The Gaia sky worker
uses that plan and default stream budget; the stellar-motion batch worker also
plans the whole collection before it streams each manifest. Its per-manifest
`maxTotalBytes` is the verified manifest chunk sum, already bounded by the
collection total. The stream helper's explicit-override validator permits up
to 1 GiB, but no current application call path uses that to bypass collection
admission. No capacity-contract change is justified from this finding.

The display path allocates one 12-byte-per-row WebGL vertex buffer and uploads
each accepted Float32 batch incrementally; at the configured 200,000-row cap,
the vertex payload is 2,400,000 bytes. The page retains the same 2,400,000-byte
maximum display payload for point selection. `ScreenPointIndex` stores a
4-byte-per-row linked-cell ordinal array and reads coordinates from those
display batches on demand, avoiding a second 8-byte-per-row coordinate cache.
After upload, GPU redraws use the retained vertex buffer; CPU display batches
remain necessary for the current picking reader, while scientific records
remain available for source selection and export. These byte counts exclude JS
object overhead, scientific-result columns, GPU/driver copies and device
limits. No static finding supports raising the row cap or changing those
lifetimes without measured device memory and interaction/frame-time evidence.
Static source and whitespace checks only; no tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 898: trace MPCORB source rows through compute and draw caps (2026-09-28)

The full-catalog request defaults to the manifest row count on desktop and
30,000 on narrow mobile viewports, with manual request choices up to the source
total. `planCatalogStream` applies source filters and the memory budget before
computation. `streamCatalogPoints` reports examined source rows separately
from its accepted and propagated Float64 position rows. `CatalogStreamCanvas`
then applies a separate viewport-selection and draw-limit stage: the actual
submitted-point count may be lower than the computed position count, and the
display limit cannot exceed `min(plan.capacity, displayLimit)`.

Auto mode currently seeds its draw cap from the manual-limit state (100,000 on
desktop; 30,000 on narrow mobile), then raises it only after four exercised
fast render windows and available computed rows. Slow windows lower it. The
active sampler receives the actual submitted count, but measures JS/render
callback intervals rather than GPU completion or compositor presentation.
`PERFORMANCE.md` separates the MPCORB streaming budget from Explorer's 250,000
desktop initial point policy and requires stream-specific measurement before
raising this baseline. No hidden source/compute truncation was found beyond
the explicit plan and draw budgets. No code or budget was changed. Static
source inspection only; no tests, typecheck, build, benchmark, browser/device
run, deployment, release, commit or push ran.

### Checkpoint 899: separate MPCORB stream admission from draw-budget policy (2026-09-28)

`CatalogWorkspace` requests the full source row count by default on desktop and
30,000 on narrow mobile viewports, with explicit request choices up to the
manifest total. `planCatalogStream` then caps rows by filters and its separate
memory budget. Drawing has another bound: the stream's Auto baseline comes from
the current draw-limit setting (100,000 desktop / 30,000 narrow mobile), while
manual draw choices can reach the manifest total; the canvas submits no more
than `min(plan.capacity, displayLimit)`. Auto growth needs four exercised fast
frame windows and only samples active redraw intervals, not GPU completion or
compositor presentation. Slow windows reduce the count.

The shared `renderBudget` desktop initial value of 250,000 describes the
Explorer catalog-cloud policy. `PERFORMANCE.md` explicitly gives the full
MPCORB stream its own draw limit and load-memory plan, and requires measurement
before raising its limits. Therefore the lower stream Auto baseline is a
confirmed policy choice, not proven accidental truncation; changing it to the
Explorer baseline would be an unverified workload increase. No code or budget
was changed. Static source inspection only; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 900: let MPCORB Auto use its device-tier initial count (2026-09-28)

`CatalogWorkspace` previously passed its manual draw-limit state as
`initialCount` even while Auto was selected. That forced Auto to start at the
100,000 desktop / 30,000 narrow-mobile manual defaults and bypassed
`selectInitialRenderBudget`'s memory and concurrency hints. Auto now omits that
override and starts from the existing device-tier adaptive policy; manual mode
still passes and uses the user's explicit draw cap. The computed-row and stream
plan limits still bound the effective draw, and the adaptive maximum and
concurrency were not raised. The localized Auto description now identifies
the device-tier starting count.

This can raise the nominal desktop Auto start from 100,000 to the existing
250,000 tier initial count, while low-memory or low-concurrency hints can lower
it; no render-throughput or smoothness gain is claimed. Deferred device
acceptance must verify initial caps across desktop/mobile tiers, slow-frame
reduction, Auto growth only after exercised fast windows, manual caps, partial
computed samples, first-visible latency, frame tails and memory. Static source
inspection and whitespace checks only; no tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 901: trace MPCORB scientific and display buffer ownership (2026-09-28)

The stream worker keeps its admitted Float32 spatial-coordinate array for later
view selection and epoch updates. It publishes computed positions as Float64;
the main thread converts at most 4,096 rows per cooperative upload slice to
Float32 positions and packed appearance attributes. The fixed-capacity WebGL
buffers receive those attributes, and the same CPU attribute arrays are kept
in `retained` for context restoration and in-place epoch updates. These
resident copies serve separate culling, restoration and GPU roles; removing
one would require recomputation or dropping existing recovery behavior.

After the incremental draw succeeds, the page transfers the original Float64
position buffer back to the worker. The worker admits it into one exact-size
recycle slot, consumes it only when the next tile has the same length, and
drops mismatched or terminal buffers. This is bounded reuse, not a retained
pool. The planner charges 44 bytes per 2D row or 56 per 3D row for resident
display/culling/index storage, plus its bounded transfer pipeline; retained
epoch coefficients add 80 bytes per row. Source inspection found no safe
resident duplicate to remove that would increase row capacity. Memory and
frame-time effects still need the deferred device evidence. Static source and
whitespace checks only; no tests, typecheck, build, benchmark, browser/device
run, deployment, release, commit or push ran.

### Checkpoint 902: distinguish Gaia read concurrency from compute parallelism (2026-09-28)

The Gaia collection worker admits at most eight chunk reads, while its default
collection budget reserves at most 96 MiB and 90,000 encoded source rows in
flight. The per-region consumer count is separately bounded by the read-group
allocator and is currently at most two; manifests are decoded in stable order
for first-source precedence. JSON validation, source-ID de-duplication,
astrometric projection and typed-column packing all execute on the same worker
event loop. Async read/ack overlap therefore provides pipeline concurrency, not
parallel CPU calculation. Raising read or consumer concurrency alone cannot
prove more simultaneous computation and may increase transient decoded-object,
typed-array and upload memory beyond the encoded-byte reservation. No such
increase is justified without device evidence. A genuine compute-parallel path
would need bounded worker ownership, stable cross-chunk ID precedence and a
shared total memory budget; those changes were not made in this audit. Static
source inspection only; no tests, typecheck, build, benchmark, browser/device
run, deployment, release, commit or push ran.

### Checkpoint 903: make the MPCORB Auto view submit individual rows (2026-09-28)

The previous default selected one point per occupied projected cell. Existing
full-source receipts show 1,561,171 computed rows but 34,505 submitted points
in 2D and 33,119 in a separate 3D steady window. This is a deliberate spatial
representative reduction, so increasing the Auto cap alone cannot display more
than the occupied-cell winners. The full MPCORB stream now defaults to the
existing all-loaded-rows mode, which uses the existing device-tier Auto cap and
deterministic upload-order sampling above that cap. Spatial representatives
remain selectable. The memory admission ceiling, Auto maximum, compute request
and scientific coordinates are unchanged; no FPS or current-tree throughput
gain is claimed. Deferred validation must compare actual submitted points,
frame tails, selection time and memory in 2D/3D across supported device tiers,
including explicit switching back to spatial mode. Static source inspection
and whitespace checks only; no tests, typecheck, build, benchmark, browser/device
run, deployment, release, commit or push ran.

### Checkpoint 904: bind adaptive samples to submitted point counts (2026-09-28)

The active-render sampler records the displayed selection count only after a
successful draw, clamped to the current display limit and admitted plan
capacity. The adaptive policy uses the minimum observed count in each frame
window: a streaming sample smaller than its current cap cannot qualify that
cap as exercised, while all-row mode reaches the cap once enough computed rows
are available. Spatial representatives can remain below the cap because fewer
projected cells are occupied, so that mode does not automatically infer extra
headroom from unsubmitted rows. With all-row mode now the MPCORB default, the
normal Auto path measures the workload it is expanding; spatial mode remains a
manual option. Source inspection found no reliable controller defect to fix.
No tests, typecheck, build, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 905: verify all-row priority and index-order contract (2026-09-28)

`selectCatalogAllPoints` admits at most 256 located selections. It inserts the
focused row first, then selected rows in caller order into a `Set`, so duplicate
focus/selection identities occupy one slot and a full pin budget preserves
focus before later selections. Remaining slots use deterministic midpoint ranks
over the unpinned upload-order population. A monotone cursor skips pinned rows,
then an in-place reverse merge combines those samples with sorted pins. Since
the draw count never exceeds the source count, sampled ranks are strictly
increasing; the merge therefore yields exactly `min(count, maximumPoints)`
unique, strictly increasing source indices. The page checks transferred type,
length and upper bound; WebGL upload skips a full ordering scan and relies on
this worker invariant. “All” means all rows stay computed, with this explicit
draw selection; its `visible` value is the submitted snapshot population, not
a viewport-visibility claim. Static source and arithmetic review only; no
tests, typecheck, build, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 906: prevent stale catalog selections from replacing a newer view (2026-09-28)

Each main-thread view request has a monotonically increasing request ID. The
worker increments a separate selection generation on every view, cancel,
epoch or append transition; it keeps only the latest pending view, and the
running all-row/spatial selector checks cancellation at cooperative yield
boundaries. The worker publishes either result or error only if its captured
generation is still current. The page accepts a response only when its ID is
both the current in-flight ID and the current view ID. If a response became
stale during the handoff, the handler clears the presentation key and requests
the current view again; epoch and append transitions also invalidate row
coordinates before starting their work. Static tracing found no path for an
old selection to overwrite a newer camera, mode, epoch or append view. This
does not establish a cancellation-latency bound beyond the selectors' bounded
yield slices. Static source inspection only; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 907: distinguish cooperative selection slices from a latency guarantee (2026-09-28)

Selection targets a 4 ms cooperative slice but checks elapsed time only at
bounded intervals: each 1,024 source rows, winner cells or bitset words. A
spatial-index rebuild itself visits at most one 1,024-row block before control
returns to the selector. This bounds the amount of unchecked algorithmic work
by operation count, not elapsed milliseconds; slower devices and worker
scheduling can exceed the target, and `MessageChannel` delivery adds further
latency. The source explicitly labels the value a scheduling policy rather
than a measured guarantee. Static inspection supports cooperative
cancellation, but no wall-clock cancellation bound or device responsiveness
claim. No interval change is justified without measuring its clock-check cost
against cancellation delay. Static source inspection only; no tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 908: trace catalog stream cancellation through queues and leases (2026-09-28)

The main thread admits at most four unacknowledged tiles and four queued UI
tiles. User cancellation disables further tile intake, drops queued UI tiles,
stops upload frames and aborts the worker request; unmount terminates the
worker. The transfer window resolves every outstanding credit on abort or
dispose, so blocked publish/drain calls resume and observe cancellation. The
stream's internal controller aborts active reads and speculative prefetches;
its finalizer awaits admitted prefetch outcomes before releasing the source
cache lease. Artifact fetches release the FIFO admission permit, abort listener
and deadline timer in `finally`. The acquisition queue removes a cancelled or
expired waiter and has a fixed queue limit. Static tracing found no resource
that remains intentionally owned after these terminal paths, except the
bounded visual-coordinate snapshot retained after an explicit stop. Cancellation
remains cooperative and has no measured wall-clock bound. Static source review
only; no tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 909: trace native state-tile cancellation and stale-result handling (2026-09-28)

Android state loads register active `HttpURLConnection` instances under a
cancellation lock; cancellation disconnects all registered connections and
interrupts the bounded tile executor. Batch failure cancels its peer and the
single-use load. Decoder loops check interruption, connection registrations
are removed in `finally`, and the UI load queue permits one running allocation
plus one latest queued replacement. UI result slots invalidate queued
notifications by generation. On iOS, each transfer owns one bounded
`URLSession`; task cancellation finishes its continuation, clears the partial
body and invalidates the session. The decoder and cache read check task
cancellation cooperatively, while the observation request gate blocks stale
partial and final frame publication and awaits the previous load before
starting another. Static tracing found no retained active network request or
stale frame path in these lifecycles. Cancellation still has no measured
latency guarantee, and this audit does not establish maximum-device capacity
or throughput. No tuning is justified without multi-device measurements.
Static source inspection only; no tests, typecheck, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 910: separate Gaia collection, calculation and drawing ceilings (2026-09-28)

The Gaia collection admits at most 200,000 declared source rows and 128 MiB of
selected input chunks across at most eight manifests. Each manifest remains
capped at 100,000 rows. The motion worker emits compact source rows plus
Float64 propagated states and Float32 display points; plotting validates that
each displayed ordinal refers to a propagated source row. The renderer accepts
up to the same 200,000 chart rows and allocates a 12-byte-per-row GPU point
buffer; CPU display batches retain another 12 bytes per plotted row. At the
200,000-row ceiling, the docs account 2.6 MB of fixed compact receipt columns,
up to 12.2 MB of Float64 states, 0.8 MB of plot-row mappings, and 2.4 MB each
for CPU display coordinates and the GPU point buffer. Source-record objects,
worker/runtime overhead and end-to-end device latency are outside those byte
figures. The current source therefore computes and plots within the same hard
row ceiling; it does not have a separate lower Gaia draw cap. The existing
documentation explicitly says neither workflow has demonstrated 200,000-row
device capacity. Raising this ceiling or claiming real-time capacity is not
supported by the source accounting alone. Static source/documentation review
only; no tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 911: reconcile catalog calculation, admitted and drawn rows (2026-09-28)

The desktop's untouched request follows the release row count; mobile starts at
30,000 rows. The catalog planner admits no more than the requested rows or its
array/GPU budget can hold, then reserves optional append slots out of that
total. The worker increments `drawnRows` only for rows that passed exact source
filters and stops at `initialCapacity`; tile receipts and the UI both reject
non-monotone counts or counts above `plan.capacity`. The completion receipt
distinguishes exhausted input from capacity-limited input, and the visible
scanned count remains separate from loaded orbit rows. In all-row mode, every
loaded row is drawn when it fits the current draw cap. Above the cap, the
selector returns a deterministic upload-order-spaced subset, with focus and
located selections first; this is not a spatial or statistical sample. If the
selection worker fails, the documented fallback is an upload-order prefix and
the UI warns about that loss of representativeness. Frame-budget windows receive
the actual submitted-point count from the canvas, including during progressive
loading, rather than the delayed completed-load count. Static tracing found no
count or receipt mismatch in this path. It proves count handling and declared
sampling semantics, not frame-time smoothness, visual distribution quality or
device-scale capacity. No change to the row or draw ceilings is supported by
this static evidence alone. Static source review only; no tests, typecheck,
build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 912: distinguish bounded catalog compute from parallel compute (2026-09-28)

The orbit-catalog planner caps admitted rows at the minimum of requested rows,
source rows and its explicit memory budget. Its documented resident per-row
charge is 44 bytes in 2D or 56 bytes in 3D, with another 80 bytes per row when
retaining epochs. Propagation runs in one catalog-stream worker, in contiguous
256-row cooperative slices; each emitted position tile contains at most 1,024
rows, and at most two tiles can await GPU-upload ownership at once. This bounds
temporary storage and allows cancellation/messages between slices, but does not
spread orbital propagation across CPU workers. Separately, the renderer keeps
all selected points only when the loaded count fits its display limit; otherwise
the established deterministic representative selection applies. The source
therefore identifies bounded single-worker propagation and per-row residency
as candidate constraints on scaling, but does not show that either is the
measured limit on target devices. A bounded worker-pool comparison could be
considered only after the full content is complete and measurements can compare
computed rows, actually submitted points, frame time and peak memory at matched
scientific output. No capacity or algorithm change is justified by this static
trace. Static source/documentation review only; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 913: separate Gaia chunk reads, propagation and GPU presentation (2026-09-28)

The Gaia source-collection worker allows up to eight parallel chunk reads under
its 96 MiB and 90,000-row in-flight limits; that path verifies and packs source
rows and is not the target-epoch stellar propagation worker. The propagation
worker streams at most two chunks to the backend concurrently, bounded by
64 MiB and 60,000 rows, while serializing source-ID deduplication, projection
and publication in manifest order. Each backend chunk is limited to 30,000 rows
and `PropagateBatchContext` walks its rows sequentially; independent requests
can run concurrently under the server compute scheduler, whose configured limit
is `GOMAXPROCS`. The chart admits at most 200,000 rows and allocates 12 GPU
bytes per row, with incremental draws on upload and a full draw on resize/zoom.
These source contracts distinguish input concurrency, propagation parallelism
and presentation capacity. They identify a possible client-side compute
concurrency ceiling of two requests, but do not establish spare CPU, network,
memory or GPU headroom on any target device. Do not raise these limits until
matched measurements show which stage limits completed and presented star
counts. Static source/documentation review only; no tests, typecheck, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 914: reconcile Gaia propagation through visible presentation (2026-09-28)

The Gaia chunk streamer overlaps reads and hashes but starts parsing, source-ID
insertion and consumer callbacks in descriptor order. The batch worker assigns
its sequence before awaiting each backend response, then serializes deduplication,
projection and publication through that callback order. For each chunk, the
backend receipt partitions every input row into propagated, missing or rejected;
the UI then checks that unique outcomes plus duplicate source IDs equal the
manifest row count. At collection completion, every chunk/path and input row is
reconciled again. Plot points and source-row ordinals have equal lengths, ordinals
are strictly increasing, and each points to a propagated row with a compact
state. Out-of-field propagated stars remain in the scientific count but are not
uploaded. GaiaPlot increments its GPU row count from those display arrays and
acknowledges nonempty chunks only after checked upload/draw; the worker waits for
all such acknowledgements before reporting completion. The onscreen composite
may update on the following animation frame, so presented rows can temporarily
lag uploaded rows; the UI reports them separately. Static tracing found no
count mismatch across these stages. This establishes count and provenance
contracts, not real-time frame performance or device capacity. Static review
only; no tests, typecheck, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 915: total the source-accounted Gaia motion chart arrays (2026-09-28)

At 200,000 rows with every row propagated and inside the common field, the
current compact result columns and binary64 states account for 12,200,000 bytes;
source-row ordinals add 800,000, CPU Float32 display coordinates add 2,400,000,
and the preallocated GPU vertex buffer adds 2,400,000. Their 17,800,000-byte
subtotal is about 16.98 MiB. At a 2048-square render target, the RGBA8 texture
adds 16 MiB, making the documented subtotal about 32.98 MiB before point
selection. The first point pick adds an `Int32Array` row link (up to 800,000
bytes) and a viewport-sized cell-head array; the picker reads retained display
coordinates and does not allocate another per-point coordinate cache. The
subtotal after the row-link array is about 33.74 MiB, plus the cell heads.
These byte counts are derived from current array declarations and allocation
sizes, not measured device memory. The cross-stage audit therefore confirms a
modest known typed-array floor but still does not bound the cross-manifest
BigInt deduplication set, decoded/request objects, browser file/Blob storage or
GPU driver overhead. The 200,000-row ceiling remains unsupported as a device
capacity claim. Static source and document arithmetic only; no tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 916: trace overlapping Gaia motion request buffers (2026-09-28)

The client admits at most two chunk consumers and reserves at most 64 MiB or
60,000 rows of raw source chunks; each chunk is capped at 32 MiB and 30,000
rows. The worker's raw-chunk map retains each chunk through the backend response.
Before Fetch, `loadStellarMotionTile` Base64-encodes each raw chunk and passes a
`JSON.stringify` request body. Two maximum chunk fields therefore contain
89,478,488 ASCII Base64 characters (about 85.3 MiB of request text), in addition
to up to 64 MiB of raw chunk arrays; the two response readers are separately
capped at 14 MiB each. Stream consumers also retain decoded source rows while
the backend call is in flight. Returned JSON is parsed and compacted before
ordered projection; the second response may wait for the first commit while
holding its compact arrays, but does not allocate a second projection scratch.
The server admits at most two tile handlers before body decoding, then uses its
separate compute scheduler; each handler decodes the chunk into source records
and output row objects before marshaling its bounded response. These byte and
row limits establish concurrency bounds, not a total client/server RSS ceiling.
Fetch/body storage, JavaScript string representation, parsed object expansion,
Go object graphs and allocator/driver overhead cannot be recovered from wire
caps alone. No code-supported memory optimization or concurrency increase is
justified without runtime peak-memory and frame-time evidence. Static tracing
and arithmetic only; no tests, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 917: stream backend Gaia source-row decoding (2026-09-28)

The tile handler's JSON decoder retains each base64-decoded chunk. The former
backend parser then unmarshaled all rows into `[]json.RawMessage`, retaining a
second copy of the source-row JSON up to the 32 MiB chunk limit per handler, or
64 MiB across the two admitted handlers. The parser now reads one row at a time,
applies the existing schema, identity, epoch, spatial-bin, cone, magnitude,
solution and finite-astrometry checks, then appends its compact `Source`. It
rejects a repeated top-level `sources` field, which was previously accepted
with last-value decoder semantics; duplicate object keys are ambiguous JSON.
The one-row buffer, parsed `Source` slice, propagation outputs and bounded
14 MiB serialized response still overlap. This removes one source-derived
allocation with a source-proven ceiling; it is not a measured RSS reduction or
a total-memory limit, and it does not establish a higher star count or
throughput. Static source, formatting and whitespace checks only; no tests,
typecheck, build, benchmark, browser/device run, deployment, release, commit or
push ran.

### Checkpoint 918: avoid revalidating accepted Gaia rows in the SOFA kernel (2026-09-28)

`PropagateBatchContext` classified each row's ID, signed-64-bit range, reference
epoch, solution and missing required fields before calling
`propagateStateWithEpochs`. That helper called `validatePropagationInput` again,
repeating identity, epoch, model-policy, required-field and finite/domain
checks for rows that had passed the batch gates. Validation is now split so
batch classification and finite coordinate-domain checks each run once before
the SOFA kernel; the scalar API still performs its full validation before the
same kernel. SOFA inputs, epoch conversion, output formulas and per-row
missing/rejected categories are unchanged by source inspection. This is a
provable duplicate-check removal, not a measured throughput gain; concurrency
and row limits remain unchanged. Static source, formatting and whitespace
checks only; no tests, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 919: release unused Gaia row objects before backend propagation (2026-09-28)

The stellar-motion consumer uses decoded `GaiaChunk.sources` only to read each
row's `phot_g_mean_mag` after the backend has propagated the original chunk.
Verified numeric source IDs are already stored in a separate `BigInt64Array`,
and the original chunk bytes remain available for the source-bound request. The
worker now copies G magnitudes into a 30,000-row-bounded Float64 column and
clears the decoded source-object array synchronously before the first await in
the consumer. This removes those full row-object references during network and
acknowledgement waits; the compact replacement is at most 240,000 bytes per
chunk. JavaScript object-heap savings and total RSS remain unmeasured. Static
reference tracing confirms the stream scheduler does not read `chunk.sources`
after awaiting the consumer. No tests, build, benchmark or browser/device run.

### Checkpoint 920: reconcile Gaia page retention with GPU upload ACKs (2026-09-28)

The worker transfers ownership of the compact receipt columns, display points and
plotted-row ordinals; the page stores those received arrays by reference in its
result and chart queues. `GaiaPlot` uploads each display batch into its
preallocated GPU buffer and ACKs only after the checked upload and incremental
draw. The ACK releases the worker's two-slot / 60,000-input-row backpressure
reservation; it does not release page data. The page retains display arrays to
rebuild its CPU screen-space picking index after zoom or resize, and retains
compact receipts for source selection and export. The separate GPU buffer is
the rendered copy. Reset clears both queues; cancellation intentionally keeps
verified partial receipts exportable. At the 200,000-row chart ceiling, source
accounting gives a 2,400,000-byte CPU display buffer and an equal point-buffer
allocation, before the picker and other state. Static reference tracing found
no redundant structured clone or message-handler array copy. Releasing the CPU
display data would remove later pick-index rebuild input; no material
measurement supports trading that behavior for a small nominal memory saving.
This does not establish that real-device performance is excellent. Static
source review only; no tests, build, benchmark or browser/device run.

### Checkpoint 921: push Gaia formal covariance through its Cholesky factor (2026-09-28)

The Go covariance path already required strict positive-definite Cholesky of
the normalized input correlation, but discarded the factor and formed output
entries through a naive four-index `J C J^T` sum. It now retains the row-scaled
input factor, computes `J L` with Neumaier-compensated dot products, and forms
the symmetric output as `(J L)(J L)^T` with compensated accumulation. Invalid
and nonfinite products still fail closed; input parsing, matrix policy, finite
difference Jacobian and Starpm model are unchanged. Review also found that the
prior cross-step Jacobian difference divided mixed-unit derivatives by
`max(1, abs(finerDerivative))`, so the advertised scaled diagnostic was not
dimensionless and its gate could understate small derivatives. It now compares
the covariance-weighted two-scale Jacobian difference against the propagated
output marginal sigmas. Both changes improve numerical stability/diagnostics,
not physical-accuracy guarantees. The existing 64-case independent ERFA
receipt predates these changes and must be rerun after implementation work is
complete. Static source and formatting review only; no tests, build, numerical
run, browser/device run, commit or push.

### Checkpoint 922: keep sampled ground overlap edges distinct from zero contacts (2026-09-28)

The Go scanner now tags interior negative-gap window samples as
`sampled-overlap`; only exact-zero samples are `sampled-zero`. Web, Android and
iOS validators accept sampled-overlap as a degenerate sampled-point edge and
do not require a fabricated contact record. Search boundaries and bracketed
roots keep their existing evidence rules. Static control-flow and contract
inspection only; add/run focused cross-platform regressions after the remaining
implementation work is complete. No tests, builds or live observation request
ran.

### Checkpoint 923: localize the sampled-overlap edge in all three readouts (2026-09-28)

Web, Android and iOS now display explicit bilingual labels for clipped search
boundaries, sampled zeros, negative-gap overlap samples and bracketed contacts.
Android no longer treats the new kind as a bracketed root, and the Web/iOS
readouts no longer show the raw kind string. The JSON export retains the exact
protocol value. Source inspection only; no tests, typecheck, build, browser,
simulator or device run.

### Checkpoint 924: honor indeterminate ellipsoid-ray samples during event search (2026-09-28)

The ellipsoid-ray contact scanner now consumes each geometry sample's signed gap
and numerical screening margin. Samples within the margin are retained as
indeterminate evidence; sign-changing refinements that enter the margin are
listed as screened candidates and do not become contact records. Intercept
windows use only definite negative-gap endpoints and are not bridged across a
screened crossing. The receipt validator checks these new bounded records, and
the panel reports their counts. This improves agreement with the existing
geometry classification without asserting that its policy margin is a certified
error bound. Pending: focused unit/receipt cases, independent near-limb
comparison, typecheck/build, browser runtime and CSPICE event comparison. None
were run in this turn, per instruction.

### Checkpoint 925: package two bounded eastern Galactic-center cones (2026-09-28)

Added 10,244 and 12,008-row Gaia DR3 schema-v2 cones, with original CSVs,
receipts, manifests and verified chunk hashes. Their cones are disjoint from
the prior six packaged regions and from each other. The chart now exposes each
and a 32,592-unique-source four-region Galactic-center preset (29,051,311
encoded chunk bytes, below the existing 128-MiB admission cap). Eight packaged
manifests total 66,463 rows, 62,003 unique source IDs and 54,314,351 encoded
chunk bytes. All 2,016,728 CSV field values match their decoded chunk records,
and source-ID multisets reconcile; the only cross-manifest duplicates are the
4,460 nested Pleiades rows. No
all-sky completeness or renderer-capacity result is inferred. An over-budget
nearby query was rejected and has no manifest. UI runtime and browser/GPU cost
remain pending. No tests, build,
benchmark, deployment, release, commit or push ran.

A further 0.20° cone centered at RA 268.15°, Dec -29°, G<=18 was submitted
once with a 20,000-row budget at 2026-09-28T12:36:25.723Z. ESA's UWS phase was
still `EXECUTING` at 12:54 UTC. Its receipt is
[`public/data/gaia/galactic-center-ra268p15-dec-29-r0p2-g18-20260928.tap-job.json`](../public/data/gaia/galactic-center-ra268p15-dec-29-r0p2-g18-20260928.tap-job.json).
No result has been retrieved, so it has no manifest and contributes nothing to
the packaged totals. Continue from that recorded job state; do not treat a
result as complete unless the bounded sentinel and artifact hashes validate.

### Checkpoint 926: verify removal of legacy exact-state JSON routes (2026-09-28)

Static call-graph and route review found Web, Android and iOS exact-state
clients use the catalog manifest and binary state plans/tiles. No production
client call remains for `/v1/current-states`, `/v1/trajectory`, or the old
identity-state route. The existing `/v1/state/window` route is a separately
framed binary history stream, not the legacy JSON contract. Server source has
no handlers for the removed endpoints, and existing test source documents the
404 contract; tests were not run. Runtime, cancellation, exact-source parity and
device performance acceptance remain pending.

### Checkpoint 927: close the over-budget Galactic-center TAP query

The previously pending 0.20-degree cone at RA 268.15 degrees completed at ESA
TAP. The query requested `TOP 20,001` for a 20,000-row budget; the result
contained the overflow sentinel, so `parseSources` rejected it before output
directory creation or chunk/manifest generation. The only matching local
artifact remains the immutable job receipt; there is no CSV, package or partial
catalog contribution. This confirms a dense region exceeds the requested
bounded export, not its exact all-catalog count or a complete sky census. No
retry was submitted. No tests, build, benchmark, deployment, release, commit or
push ran.

### Checkpoint 928: add an antipodal Gaia comparison field (2026-09-28)

Retrieved and packaged a schema-v2 Gaia DR3 cone at ICRS RA 86.4°, Dec +29°,
radius 0.20°, G<=18. Its center is the exact antipode of the packaged
RA 266.4°, Dec -29° Galactic-center query center; the relation selects a
geometric comparison field and does not claim equivalent stellar populations.
The result has 1,155 rows and one 1,093,632-byte chunk, below the `TOP 20,001`
sentinel; no independent COUNT(*) query or completeness claim was made. CSV,
chunk, TAP job receipt and manifest hashes reconcile; the receipt SHA-256 is
`17cb29c58c353f3cb3c3c766c2f74f9afb8fbbf60e3c88f6f6b2e1550f200632`. Static
reconciliation of all nine packaged manifests confirms 67,618 rows, 63,158
unique source IDs and 4,460 repeated rows, all from nested Pleiades cones; the
new cone is disjoint from the other eight by spherical geometry. The chart has
a bilingual load control for the new region. No UI runtime, tests, build,
benchmark, deployment, release, commit or push ran. Real-device frame and
memory capacity remain unmeasured.

### Checkpoint 929: trace reception and emission epochs in event geometry (2026-09-28)

Static call-site review found every `receptionLightTime` consumer rebases the
solver to a local zero-second origin. The event epoch stays in the separate
elapsed argument, while each target callback passes the iterative emission
offset to `stateAtOffset`; the DE440 adapter combines that pair with compensated
addition before its split-ET SPK evaluation. Spherical occultation CN evaluates
the observer at reception and each body center at its own emission epoch.
Oriented ellipsoid-ray CN also evaluates text-PCK orientation at target-center
emission; NONE evaluates both at reception. The ground-station limb uses the
observer receipt's two-part TDB epoch and the same split-offset SPK/PCK path.
The inspected frame contract is J2000/SSB/TDB, with PCK's declared
J2000-to-body-fixed matrix applied to both observer and ray. No source-level
time-origin or matrix-direction mismatch was identified. This is a static
call-graph review, not independent CSPICE/contact acceptance. Center-only CN,
fixed-direction and physical timing limits remain. No tests, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 930: preserve split TDB through ground-observation SPK evaluation (2026-09-28)

Static trace found the HTTP ground-observation handler received SOFA's TDB as
two parts but evaluated Earth/Sun and retarded target states through a single
Float64 JD. The new additive catalog entry evaluates by seconds past J2000 TDB,
uses those seconds as the exact cache key and still routes all admitted SPK
segment types through the normal resolver. The HTTP handler now selects that
entry; the legacy scalar-JD callback API remains intact. Light-time offsets are
subtracted in ET seconds, the production solver advertises a 0.5-microsecond
numerical residual target, and available target results carry normalized
`emissionJdTdbParts`. The browser result type and readout expose and validate the
split timestamp. These changes address numeric epoch quantization only; the
single-JD compatibility callback, physical timing uncertainty, excluded
relativistic effects and other ground-window/contact evaluators remain outside
this change. Their current 30-second sampling and 0.25-second visibility / 0.05-second
contact brackets are much wider than the ~40-microsecond single-JD epoch grid,
so this pass did not change them. No tests, builds, benchmarks, commits or
pushes ran; focused regression coverage and fixture reconciliation are deferred
to the user's requested final verification phase.

### Checkpoint 931: reconcile Gaia DR3 motion units with the SOFA propagation contract (2026-09-28)

Static source-to-model review compared the schema-v2 Gaia rows with the Gaia DR3
archive datamodel and the ERFA implementation of SOFA `Starpm`. Gaia DR3 defines
`ref_epoch` in Julian years TCB and `pmra` as the tangent-plane component
`mu_alpha*`; `Starpm` takes split TDB dates and coordinate-angle RA motion, so
the current adapter's divide-by-cos(dec), epoch conversion and inverse output
mapping are consistent at the API/unit boundary. This is not an independent
astrometric oracle, and it does not validate the selected spectroscopic radial
velocity as astrometric radial velocity, single-star motion, or physical
accuracy. Those model limits remain explicit and the numerical reference
reconciliation is still pending. Sources: [Gaia DR3 `gaia_source`
datamodel](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html),
[ERFA `starpm.c`](https://github.com/liberfa/erfa/blob/master/src/starpm.c).

The available high-point renderer report does not establish current integrated
load/compute/draw performance for the modified worktree or mobile devices. No
source evidence shows that raising the four-shard prefetch limit, admitted-row
budget or draw cap would increase simultaneous scientific computation and
visible coverage without exceeding memory or frame budgets, so this audit made
no such tuning. This is not a claim that full-product performance is excellent.
Static review only; no tests, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 932: audit restricted dynamics force dimensions and derivatives (2026-09-28)

Static equation-to-code review found the prescribed Newtonian point-mass term
and its position Jacobian use the declared km, km/s and km^3/s^2 units, with
the gradient sign consistent with the source-minus-spacecraft displacement.
The optional solar-monopole 1PN term has acceleration units and separate
position/velocity Jacobians; the constant radial SRP term converts explicit SI
pressure, area and mass to km/s^2 and its inverse-square gradient is consistent
with its outward unit vector. The Dormand-Prince 5(4) tableau and embedded error
weights are internally paired. No dimensional or sign defect was identified by
this inspection. The implementation is still a restricted prescribed-source
model: JPL's orbit-determination formulation includes the broader barycentric
relativistic terms, so this code's existing warning that solar-only 1PN is not
full EIH/DE440 physics remains material. Independent force/Jacobian and
integration reference comparisons remain pending; this is not numerical
acceptance. See [JPL DESCANSO orbit-determination formulation](https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_all.pdf).
Static inspection only; no tests, build, numerical run, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 933: cross-check SPK type guards and frozen time conversion against NAIF (2026-09-28)

Static comparison found the Type 17 eccentricity ceiling of 0.9 is a CSPICE
contract, not an arbitrary local coverage restriction; the existing Go and Web
guards match NAIF `SPKE17`. The shared Type 1/21 evaluator's record length,
reference-state fields, per-axis difference tables, maximum/component orders,
and every-100th epoch directory also match the NAIF Type 21 record contract;
Type 1's fixed dimension and one-word footer remain distinct. The frozen
`naif0012.tls` leap-second table and DELTET constants/formula match their NAIF
source, with the documented approximately 30-microsecond periodic-model
accuracy and future-UTC limits preserved. Numeric-JD UTC still cannot represent
the `23:59:60` label, as the API documentation already states. This is a
contract/source audit, not an independent binary-kernel comparison or a live
future-leap acceptance. Sources: [NAIF SPKE17](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke17.html),
[NAIF SPKR21](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spkr21.html),
[NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html),
[NAIF naif0012 LSK](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls),
and [NAIF Time Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html).
No implementation defect was identified, so no code was changed. Static review
only; no tests, build, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 934: audit SBDB covariance coordinates and square-root pushforward (2026-09-28)

Static comparison with the official SBDB covariance contract confirms that
`cov=mat` is a full matrix in au, degrees and days, is defined only at the
solution epoch, and labels six orbital elements before any estimated model
parameters. The parser rejects vector and square-root wire forms rather than
silently treating their different storage or units as `cov=mat`, and it does
not substitute standard-epoch elements when solution-epoch elements are
required. Equation-level review found the orbital-element-to-Cartesian
Jacobian's elliptic derivatives, angular rotation blocks and units internally
consistent. The covariance sampler factors a normalized correlation matrix,
restores each marginal scale, and applies no jitter or clipping. The dynamics
pushforward uses a deterministic prescribed-Sun frame translation, compatible
state-unit transforms and `B B^T` from the propagated square root. No defect
was identified by this static audit. An independent high-precision orbital
oracle, near-parabolic finite-domain comparisons and end-to-end covariance
reference reconciliation remain pending; the audit does not establish physical
fit accuracy or model uncertainty. Source: [NASA/JPL SBDB API documentation](https://ssd-api.jpl.nasa.gov/doc/sbdb.html).
No tests, build, benchmark, browser/device run, deployment, release, commit or
push ran.

### Checkpoint 935: review universal conic domains and adaptive event integration (2026-09-28)

Static equation review of the conic coordinate path found the Stumpff `C` and
`S` functions, their small-argument series and derivatives, the unwrapped
universal-anomaly equation, and its periapsis position/velocity mapping
internally consistent across the elliptic, parabolic and hyperbolic branches.
The implementation keeps explicit finite dimensionless-time limits and does
not wrap revolutions where that would erase periapsis-time sensitivity. The
adaptive integrator's Dormand-Prince 5(4) stages, embedded weights, component
error scaling, compensated elapsed-time updates and cooperative attempt
budget were reviewed against their stated contracts. Distance-event scanning
still finds sampled sign changes only; event bracketing excludes accumulated
trajectory error, and both limitations are returned to callers. No source
defect was identified. Independent high-precision derivatives across the
parabolic boundary, orbit-propagation oracles, and event-time acceptance remain
pending; local embedded error ratios are not physical-accuracy bounds. No
tests, build, numerical propagation, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 936: retain exact sampled-zero endpoints for ellipsoid intercept windows (2026-09-28)

Static control-flow review of signed-gap aggregation found that an exact sampled
zero was recorded as a contact but was neither a definite negative sample nor
a bracketed sign change. Consequently, a neighboring confirmed negative span
could be omitted from `sampledInterceptWindows`. The aggregation now joins a
definite inside sample to an exactly sampled zero only when the zero has no
indeterminate margin, and symmetrically starts a span from that zero into a
definite inside sample. Near-zero points inside the numerical screening band
remain indeterminate and still do not bound an intercept window. Adjacent spans
meeting at the same exact sample merge through the existing interval rule.
The ray and limb coordinate contracts also match NAIF's first ray-surface
intercept and center-plus-generating-vectors ellipse definitions; this is a
source-contract comparison, not a binary-kernel numerical oracle. Sources:
[NAIF `SURFPT`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/surfpt.html),
[NAIF `EDLIMB`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/edlimb.html),
and [NAIF Ellipses Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/req/ellipses.html).
This source-level fix has not been exercised; tangent classification and
sampled-sign completeness retain their existing limitations. No tests, build,
numerical geometry run, benchmark, browser/device run, deployment, release,
commit or push ran.

### Checkpoint 937: review native state-load admission and display headroom policy (2026-09-28)

Static cross-platform review found Android state loads serialize allocation-heavy
work and retain at most one queued replacement. iOS overlaps two verified tile
reads only after admitting their combined transient working-set estimate against
the per-load resident budget; if they do not fit, it reads serially. Both keep
the full verified Float64 source separate from display-only capped projection.
Native display caps adapt only after measured frame-callback windows and react
to thermal or memory pressure; those callback intervals are not presented-frame
or GPU timing. No platform limit was raised because no new device result showed
safe extra concurrent throughput. This is source review only; multi-view
aggregate memory and real Android/iOS sustained-frame capacity remain
unmeasured. No tests, builds, device runs, benchmarks, deployment, release,
commit or push ran.

### Checkpoint 938: reconcile Gaia DR3 covariance position axes and RV policy (2026-09-28)

The official Gaia DR3 source model defines `ra_error` as the standard error in
the tangent-plane coordinate `alpha* = alpha cos(dec)`, matching the Go formal
covariance's east-coordinate label and its finite-difference perturbation. The
five astrometric correlations are retained as a correlated 5D marginal for
both accepted solution classes; the six-parameter pseudocolour remains
marginalized, while spectroscopic-RV uncertainty is appended only under the
explicit independent-RV policy. No source/unit mismatch was identified. The
existing independent ERFA covariance receipt predates the recent factor and
diagnostic changes, so current numerical acceptance remains pending. Source:
[Gaia DR3 `gaia_source` datamodel](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).
Static contract review only; no tests, numerical run, build, benchmark,
browser/device run, deployment, release, commit or push ran.

### Checkpoint 939: audit Gaia TCB to SOFA observer-input scale conversion (2026-09-28)

The Gaia DR3 processing model defines catalogue astrometry in BCRS coordinates
with TCB as the independent time variable; IAU 2006 Resolution B3 defines TDB
as a linear scaling of TCB by `1 - L_B` plus an epoch offset. The observer
path converts the epoch through SOFA, scales angular proper motion and parallax
by `1 / (1 - L_B)` for its TDB-compatible SOFA inputs, and leaves radial
velocity unchanged. This is dimensionally consistent with the existing
TDB-compatible input convention, but the exact spatial-scale compatibility
between a custom SPK source and the Gaia BCRS catalogue remains an explicit
assumption. No new source-level mismatch was identified. References:
[Gaia DR3 reference systems and time scales](https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_refsystems.html),
[IAU 2006 Resolution B3](https://www.iau.org/static/resolutions/IAU2006_Resol3.pdf),
and [SOFA astrometry cookbook and routine documentation](https://www.iausofa.org/cookbooks).
Independent numerical comparison against a current TCB/TDB observer oracle
remains pending. Static source review only; no tests, numerical run, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 940: make exact state-tile scientific units self-describing across clients (2026-09-28)

Cross-platform protocol review found that plan JSON declared TDB,
ECLIPJ2000, `naif:0`, km and km/s, but the binary tile header omitted those
shared scientific fields. The envelope is now wire v2 with a 208-byte header;
fixed contract codes identify each field and every decoder rejects unknown
codes or nonzero reserved bytes. Web, Go, Android and iOS decoders, fixture
generation, protocol docs and the window benchmark's tile validation now use
the same boundary. Android's disk cache uses a v2 namespace; iOS rejects and
invalidates incompatible cached v1 tiles when read. The server ETag and all
payload checksums begin at byte 208. A static SPK path review confirms that J2000
segment states are rotated to ECLIPJ2000 and center states are composed through
the barycentric chain before the tile contract is applied. NAIF identifies both
as built-in inertial frames and documents the direction of its frame-rotation
matrix; this source review did not numerically compare the local rotation with
SPICE. Sources: [NAIF frames required reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/req/frames.html)
and [NAIF IRFROT](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/irfrot.html).
No cross-runtime execution or independent numerical frame oracle was run, so
wire interoperability and numerical acceptance remain unverified. No tests,
build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 941: trace state-window and ground-observation time/unit conversions (2026-09-28)

Static review found the state-window route requires finite, strictly increasing
TDB Julian dates and validates each returned plan against the requested epoch.
The ground-observation route retains SOFA's split UTC/TT/TDB dates through its
astrometry setup and evaluates catalog states in seconds past J2000 TDB; the
EOP table interpolates UT1-TAI before restoring the date's leap offset. The
SPK-to-SOFA vector path rotates ECLIPJ2000 into J2000, converts positions from
km to AU and velocity from km/s to AU/day, then reports the observer velocity
back in km/s. To make that dimensional boundary explicit, the former combined
rotation-and-position-scaling helper is now an axis-only rotation plus named
position and velocity converters. No source-level time-scale or unit mismatch
was identified. This does not verify the GoFA port against current SOFA
numerical acceptance, the current IERS input, or physical observation error.
Sources: [IAU SOFA time-scale and calendar cookbooks](https://www.iausofa.org/cookbooks)
and [NAIF frame definitions](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/req/frames.html).
No tests, numerical comparison, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 942: reconcile nested Gaia opposite-field captures and expose the wider region (2026-09-28)

Two bounded ESA Gaia DR3 schema-v2 captures were added at ICRS RA 86.4°, Dec
29°, G <= 18: a 0.4° cone with 4,964 rows and a 0.6° cone with 11,157 rows.
The independent artifact audit checked all eleven packaged manifests, original
CSV byte lengths and SHA-256 values, every chunk byte length/hash and row sum,
and source-ID overlap. It found 83,739 input rows, 73,160 unique source IDs and
70,664,634 encoded chunk bytes. The 0.2° and 0.4° sets are fully nested inside
the 0.6° set; the wider query adds 6,193 IDs over 0.4°. The three opposite-field
cones contribute 6,119 repeated rows in aggregate; the other 4,460 repeats are
the nested Pleiades cones. Both new captures were below their `TOP 20,001`
sentinel, but neither used an independent COUNT(*) scan and neither certifies
Gaia completeness. The 1° query receipt remains preserved after ESA's 7,200-second
abort. Added explicit Chinese and English load buttons for 0.4° and 0.6° regions.
This is source acquisition and integrity evidence, not sustained device frame
time or total-memory evidence. No tests, build, benchmark, browser/device run,
deployment, release, commit or push ran.

### Checkpoint 943: preserve split UTC precision in IERS interpolation (2026-09-29)

Ground-observer input already retained SOFA's two-part UTC through UTC→TAI, TT,
UT1 and TDB conversions, but it collapsed `utc1 + utc2` before sampling the
IERS table. At modern epochs that loses roughly 40 microseconds of Float64
resolution in the full Julian Date. Added `Table.AtUTCParts`, which subtracts the
MJD zero point from the large date component before adding the quasi-JD day
fraction, and switched the observer EOP lookup to that path. A source regression
case compares the split lookup with the compatibility single-part API; it was
not run. Direct arithmetic gives about 0.63 microseconds of MJD resolution for
the split representation and 15.7 microseconds of rounding for the selected
collapsed sample. This corrects date representation loss, not IERS interpolation
error or total observation accuracy. The IAU SOFA time cookbook explains that
its two-part dates are apportioned to preserve time resolution and warns against
adding them before precision-sensitive processing: [SOFA Time Scale and
Calendar Tools](https://www.iausofa.org/s/sofa_ts_c.pdf). No tests, build,
benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 944: route window and Gaia station SPK samples through split TDB epochs (2026-09-29)

The split-UTC EOP fix exposed a downstream gap: the fixed-observation HTTP
endpoint used `EvaluateWithET`, but visibility windows, ground sphere contacts
and Gaia station directions still passed the compatibility one-part-JD catalog
callback. Added `SearchVisibilityWithET`, `SearchGroundContactsWithET` and
`FromCSVAtStationWithET`, and switched their HTTP handlers to
`EvalBatchContextAtET`. Each sampled UTC instant now converts from SOFA's
two-part UTC through TAI/TT/UT1/TDB and reaches catalog/SPK evaluation as seconds
past J2000 TDB. Existing scalar-callback functions remain for compatibility.
Static call-site review confirms the production HTTP paths use the ET variants;
no test, typecheck, build, browser/native run or independent window/contact
reference was performed. This removes single-JD quantization from source-state
samples but does not improve the declared sampling cadence, numerical brackets,
model exclusions or physical uncertainty. No tests, build, benchmark,
deployment, release, commit or push ran.

### Checkpoint 945: audit SBDB fitted-force covariance axes (2026-09-29)

Static source review compared SBDB covariance semantics, the pinned 67P response
and the current browser/Go variational propagators. The fixture is solution
`K284/1` (SHA-256
`65e96d6b7950e1712131969d591d3234cb3956a0ef99803734366407aea81295`), has ten
axes (`e,q,tp,node,peri,i,A1,A2,A3,DT`), and declares planetary/small-body
ephemerides `DE441`/`SB441-N16`. SBDB defines covariance labels after the six
orbital elements as estimated dynamical parameters; Horizons documents cometary
`A1`/`A2`/`A3`, the default water-ice distance law and `DT` lag/delay. Current
propagation uses restricted DE440s forces and a six-by-six state transition;
the optional radial SRP path also treats its separately supplied SI properties
as fixed, without SBDB fitted-parameter covariance derivatives. A second pinned
source, Bennu solution 118 (SHA-256
`8cc7ff03d7fec9e15016d7ab0e78edc7a0e4d69227a322cde7190518a24ccb90`), has eight
axes including `RHO` and `AMRAT` and records `DE424`/`SB424-N343`. The source
describes those parameters as bulk density and solar-pressure area-to-mass
ratio, but the available parameter metadata alone does not fully define the
fitted acceleration law or its derivatives. Both source solutions therefore
also expose a force-ephemeris mismatch with the current DE440s integration.
Rejecting extra estimated axes remains scientifically necessary; neither their
storage nor a matching parameter name is fit-model propagation. The
orbit-uncertainty guide now records these source-specific gaps and states the
requirements for a future matched implementation. Browser, Android and iOS
covariance-propagation results now place SBDB PE/SB identifiers beside the
adopted integration-kernel identifier, with an explicit statement that this
comparison does not reproduce the source fit. These UI changes have only been
source-reviewed. No tests, build, benchmark, browser/device run, deployment,
release, commit or push ran. Source contracts are documented, not independently
reproduced against either JPL orbit solution.

### Checkpoint 946: classify the current large-catalog render receipt (2026-09-29)

Read the retained [300000-row spatial receipt](benchmarks/catalog-tiers-20260925/300000-d3d11-spatial.json) without rerunning it. It is
an observed, local-HTTP, built-application snapshot on an NVIDIA RTX 5070 Ti:
the source manifest has 1,561,171 rows, the request uploaded/drew 300,000 rows,
and the final spatial draw displayed 21,590 representatives. Reported load time
is about 1.24 seconds, worker total about 1.11 seconds, and spatial selection
about 9.8 milliseconds. Seventy-four callback intervals have p50 16.7 ms and
p95 16.8 ms, but `steadySeconds` is zero and sustained-display evidence is null.
The receipt explicitly excludes GPU execution timers, continuous full-catalog
simulation, total process/driver memory and mobile capacity. This is useful
single-machine snapshot evidence, not proof that end-to-end real-time loading,
simultaneous simulation/rendering or diverse devices are already excellent. No
performance change was justified from this receipt alone; the user has deferred
all tests and benchmarks until content work is complete, so none were run.

### Checkpoint 947: trace fitted-parameter axis gates across propagation paths (2026-09-29)

Static call-site review traced the 6-to-16-axis SBDB inspection format through
browser covariance propagation, nonlinear ensembles and event ensembles; the
standalone propagation scripts; Go covariance, ensemble and event packages and
their HTTP handlers; and browser/Android/iOS receipt validation. The propagators
reject any covariance axes beyond the six orbital elements before integrating,
and receipt validators bind the exact source labels and reject additional force
parameters. The shared source-offset-to-state converter intentionally retains
additional offsets and reports them as unapplied parameters, but it is a
coordinate conversion with an explicit no-force-propagation limitation; its
integration callers enforce the six-axis gate. General covariance inspection
and conversion remain able to preserve and report additional estimated axes.
No bypass or silent axis dropping was found in these inspected paths. This was
source review only: no tests, build, benchmark, browser/device run, deployment,
release, commit or push ran.

### Checkpoint 948: inspect catalog compute-to-render scheduling (2026-09-29)

Static review of the browser catalog path found a bounded four-tile source
transfer window with ACK-based backpressure, a two-tile temporal compute/upload
window, 1,024-row temporal tiles, cooperative worker yields on roughly 4 ms
slices, and main-thread GPU upload slices limited to roughly 3 ms per animation
frame. Rendering is capped separately from admitted/computed rows. Temporal
state calculation itself remains serial within one worker; completed tiles can
overlap with transfer and rendering, but this code does not demonstrate parallel
CPU integration. The retained 300,000-row receipt lacks sustained-display and
GPU execution measurements, so neither end-to-end excellence nor a CPU/GPU
bottleneck is established. No code change was justified without that evidence;
the requested ban on tests and benchmarks remains in force.

### Checkpoint 949: audit spatial-bound invalidation and capacity reserve (2026-09-29)

Static tracing found one 1,024-row block-bound index per admitted snapshot.
Initial ingest, epoch tiles and appended rows all update the same Float32 culling
snapshot and invalidate only the touched blocks; the next spatial query lazily
rebuilds each full block bound. Selection skips only blocks whose conservative
projected bounds miss the viewport, then preserves exact per-row clipping and
representative selection for candidates. The memory plan reserves block metadata
using the full source row count while the worker allocates it for admitted
capacity; for the retained 1,561,171-row source this upper reserve is under
60 KiB, so tightening it would not materially raise the current row capacity.
No repeated whole-index rebuild or actionable capacity bottleneck was found in
these call paths. This conclusion is source-level only; rendering performance
still requires the deferred sustained GPU and device evidence.

### Checkpoint 950: refresh issue and pull-request disposition (2026-09-29)

Read-only GitHub inventory found 46 closed issues, the single open issue #109,
130 merged pull requests, three closed-unmerged pull requests, and no open PRs.
Issue #109's current body directly describes the retained full-scope objective;
its latest owner comment keeps it open for real-device performance and scientific
reference evidence, so it remains aligned and must stay open. Closed-unmerged PR
#112's capacity change is superseded by merged #111 and the current remote-main
builder gates only the published preview. Dataset pin PRs #75 and #78 are
superseded by merged #81/#82; remote `main` currently pins
`mpcorb-26bbcb75e45b7cbb-full`. No issue or PR state was changed. This refresh
did not run tests, build, benchmark, deployment or release, and did not commit
or push.

### Checkpoint 951: audit backend admission lanes and response budgets (2026-09-29)

Static tracing of the state-plan, binary-tile and state-window handlers found
preflight byte budgets before inventory/SPK work, bounded plans and caches,
joined duplicate tile encodes with two encoder slots, and state-window streams
limited to two concurrent requests with four-epoch lookahead and bounded frame
sizes. The weighted compute queues are separately capped per class and compute
workers are independently limited by `GOMAXPROCS` configuration. General HTTP
requests, state-window streams and Gaia motion-tile batches use separate bounded
admission lanes; the `-max-concurrent` CLI help and shared-compute guide now
describe that contract and its maximum combined active request count. This is a
documentation/help-text correction only; no runtime behavior changed. Source
review found no actionable queue or response-budget change from this pass. No
tests, builds, benchmarks, browser/device runs, deployment, release, commit or
push ran.

### Checkpoint 952: reconcile Type 1/21 record layout with NAIF SPK (2026-09-29)

Compared the Go Type 1/21 reader's record sizing, Type 21 dimension/count footer,
final-epoch table, each-hundredth-epoch directory and first-final-epoch-not-less-
than-request selection with [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
and the [SPKE21 record definition](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke21.html).
The inspected offsets and structural bounds align: Type 1 uses the fixed 15-term
layout, while Type 21 uses its declared dimension and checks finite record data,
orders and nonzero active steps. The repository contains a synthetic Type 21
CSPICE-fixture comparison, but it was not run; this source audit does not verify
the recurrence numerically against CSPICE or validate original spacecraft
kernels, segment boundaries, center transitions, cancellation or continuity.
No code change was justified by this format comparison. No tests, builds,
benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 953: trace New Horizons OD164 source-set identity and closure (2026-09-29)

The current full/runtime manifests agree on the New Horizons root target `-98`,
its `newhorizons-od164-de433` source-set boundary, and the single explicit
dependency kernel. The 16 distinct `selectionEvidence.sourceSet.memberTargets`
equal the dependency kernel's target inventory exactly. The pack-preparation
source verifies this list against every non-root target in the full original
SPK, walks overlapping center dependencies, rejects an omitted transitive
center, and requires gap-free windows for the root and every source-set member.
Read-only digest checks found the original 13,074,432-byte OD164 SPK and its
source-note bytes in four retained preparation packs with the manifest's source
hashes; both admitted public crop files also match their declared byte lengths
and SHA-256 values. The reviewed NAIF identity registry maps `-98` to New
Horizons, and the scientific body descriptors derive from that registry with
no coordinate fallback. Runtime projection retains the root's dependency IDs,
dependency-only flag and source boundary; selection closes over that exact pool,
and the resolver does not use dependency-only files as unrelated roots. No
membership or identity mismatch was found. This verifies provenance and routing
metadata, not the numerical OD164 trajectory against CSPICE, tracking residuals,
force-model reconstruction, original-kernel runtime behavior or device use. No
tests, builds, benchmarks, browser/device runs, deployment, release, commit or
push ran.
### Checkpoint 954: integrate bounded Voyager source packs with fit cutoffs (2026-09-29)

The old local Voyager packs did not match the current preparation fingerprint,
so a fresh source pack was generated for TDB ET `[631108800, 978264000]` using
the current preparation code and the official `vgr1.x2100.bsp` and
`vgr2.x2100.bsp` bytes. The source hashes match the pinned originals; the four
cropped files total 456,704 bytes. Each spacecraft root names its own
dependency-only Sun kernel. The Pages and full source manifests now each contain
the same four Voyager entries, increasing each manifest from 672 to 676 files.
The integration pass checked current source hashes, crop hashes, descriptors,
and gap-free center coverage; read-only checks confirmed all four public crop
files match their declared sizes and SHA-256 values. This is source and structural
integration only, not current-reader numerical acceptance.

The integration path previously retained the generic extrapolation warning but
dropped Voyager's more useful NAIF fit-through month. It now carries
`trackingFitThroughMonth` through the runtime manifest, and the spacecraft
inspector displays that month in English and Chinese with an explicit statement
that later coverage is extrapolation, not observation or an accuracy/uncertainty
bound. The tracked months are 1992-04 for Voyager 1 and 1992-10 for Voyager 2.
The older CSPICE/TypeScript comparison receipts are bound to earlier source
fingerprints and do not verify the current reader. No current CSPICE comparison,
test, build, benchmark, browser/device run, deployment, release, commit or push
ran.

### Checkpoint 955: refresh the fixed-epoch body table after manifest integration (2026-09-29)

The `ephemerisBodies.json` provenance still named the pre-Voyager Pages manifest
after the new source entries were integrated. Regenerated the body table at its
existing TDB epoch JD `2461287.5`; the candidate had the same 316 body records,
with no added, removed or changed body rows, while its manifest digest matched
the updated Pages manifest (`d81fa6997ce76f70c9045beaf4fb0e2406d426ff78629a415715a8eade2dde1f`).
The canonical table now carries that current manifest digest. The source-only
identity sidecar contains no Voyager `-31`/`-32` rows that could suppress their
new operational roots. These were data-provenance and static catalog-path
checks, not backend runtime acceptance. No tests, builds, benchmarks,
browser/device runs, deployment, release, commit or push ran.

### Checkpoint 956: qualify current catalog-render performance evidence (2026-09-29)

Reviewed the retained desktop MPCORB observations and the current render/load
admission paths without running tests or benchmarks. The recorded RTX 5070 Ti
Chromium session loaded all 1,561,171 rows in about five seconds; steady 3D
callback intervals over 60 seconds had P95/P99 16.8 ms and maximum 16.9 ms,
while its load-phase maximum was 100.2 ms. The measured 2D run had a 66.6 ms
load-phase maximum. The benchmark ledger says its stream/render source hashes
do not match the later implementation now in the workspace, and neither run
covers mobile hardware or physical presentation. Thus the old desktop steady
3D result is promising but cannot establish current-tree or cross-device
performance as excellent. No speculative concurrency, buffer or render-budget
change was justified without fresh workload evidence. This is a documentation
and static-path audit only. No tests, builds, benchmarks, browser/device runs,
deployment, release, commit or push ran.


### Checkpoint 957: reconcile the live issue and pull-request queue (2026-09-29)

Read-only GitHub inventory found 47 issues (46 closed, one open) and 100 pull requests (97 merged, three closed, none open). The sole open issue is #109, whose requested streaming state tiles, lazy SPK, full-directory access, cross-platform rendering, science ledger, and explicit hardware/source-oracle acceptance remain aligned with the owner's current objective. Its latest owner comment explicitly keeps it open because real-device capacity and scientific reference/boundary evidence remain unverified; the local ledger still records those pending boundaries. Keep #109 open until its acceptance is evidenced. No issue/PR mutation, test, build, benchmark, deployment, release, commit or push ran.


### Checkpoint 958: register source-bounded comet 67P (2026-09-29)

Added selectable comet 67P/Churyumov-Gerasimenko (NAIF 1000012) using the uniquely selected JPL Horizons record 90000703 and SBDB solution K284/1 (dated 2026-09-04; observation arc 2008-06-01 through 2025-06-21). Both manifests retain original type-21 records without refitting: Pages covers 2026-01-01/2027-01-01 with a 21,504-byte crop, and the full profile covers 2020-01-01/2031-01-01 with a 207,872-byte crop. Their SHA-256 values match the manifest entries; both profiles now contain 677 files and total 281,231,360 and 1,188,815,872 bytes respectively. Regenerated the fixed-epoch optional body table at JD 2461287.5: it still has 316 bodies and no invented 67P fallback row.

The scene registry exposes 67P as kind comet, without a fabricated propagation orbit, mass or radius. The 2D trajectory marks it as a comet, both languages show the solution and observation cutoff with the uncertainty boundary, and event-reference selection continues to exclude small bodies. These checks establish data identity, file integrity, and static registration only; they do not verify the current runtime numerically against CSPICE, covariance propagation, actual rendering, device capacity, or physical accuracy across the requested SPK interval. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.


### Checkpoint 959: expose the pinned 67P joint covariance example (2026-09-29)

The Orbit Uncertainty panel can load the retained 5,459-byte SBDB K284/1 response with one action; its SHA-256 is `65e96d6b7950e1712131969d591d3234cb3956a0ef99803734366407aea81295`. The sample exposes all ten source axes (`e,q,tp,node,peri,i,A1,A2,A3,DT`) and their source model metadata through the existing parser and coordinate-conversion path. The existing time-covariance, nonlinear-ensemble, and event-ensemble panels visibly refuse this ten-axis source because no matched force derivatives are implemented; no estimated non-gravitational parameter is discarded or held fixed. This improves access to real comet uncertainty data without presenting the restricted DE440 model as the original DE441/SB441-N16 K284/1 fit. The manual code review and source-hash check are not UI or calculation acceptance. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 960: audit the available 67P force-model source closure (2026-09-29)

Both current ephemeris manifests retain 12 target-specific crops from the SB441-N16 asteroid kernel (NAIF IDs 2000001, 2000003, 2000007, 2000015, 2000031, 2000052, 2000065, 2000087, 2000088, 2000107, 2000511 and 2000704). The DE441 planetary kernel entry covers targets 1–10 and the listed Earth/Moon and planetary-system centers. The 67P delivery entries are original Horizons type-21 trajectory crops; these are not a numerical reference for independently reproducing the joint orbit-fit covariance.

The official [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html) specifies A1/A2/A3 units, default water-ice sublimation-law constants and DT as a cometary lag/delay in days. The checked [SBDB API contract](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) identifies estimated dynamical model parameters among the covariance axes. These references and manifest metadata do not establish K284/1's exact DT time-shift convention, full small-body force closure or derivatives. No source-mismatched force model or partial six-axis approximation was added. Static file/manifest review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.


### Checkpoint 961: qualify the published 67P lag-sign evidence (2026-09-29)

The historical 67P analysis by [Królikowska (2003)](https://acta.astrouw.edu.pl/Vol53/n2/pap_53_2_7.pdf) writes its asymmetric Marsden law with the retarded distance `r(t - τ)` and reports a positive fitted `τ = 34.3` days, consistent with a light-curve maximum about 35 days after perihelion. This establishes a physically interpretable positive-lag convention for that DE405-era study, not for the newer Horizons K284/1 `DT` parameter. The official Horizons manual still calls `DT` a lag/delay without defining its signed time-shift equation. K284/1 source-fit force closure, DE441/SB441-N16 coverage and derivatives for A1/A2/A3/DT remain incomplete, so its joint ten-axis propagation stays refused. Documentation-only source audit; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.


### Checkpoint 962: add source-matched 2I/Borisov trajectory and mapped uncertainty (2026-09-29)

Captured the current JPL Horizons solution 54 for C/2019 Q4 (Borisov), explicitly selected as DES=1003639 / record 90004568. The 292,864-byte original type-21 SPK is pinned as 8e2931d03595c01ab5c50d9d268376ee0024ebf881846dc1def6f2c1559e1705 and durably retained with its receipt at tests/fixtures/horizons-borisov-spk-20260929; its observation arc is 2019-02-24 through 2020-09-30 (964 observations), while the integrated request spans 2019-01-01 through 2031-01-01 TDB. Horizons reports DE441/SB441-N16 and fitted A1/A2/A3/DT. Both profiles retain unrefit crops: Pages 2026-01-01/2027-01-01 (21,504 bytes, SHA-256 3bed0cd9b33ca684f7c9d78ef9ebf7dd7a1264f6d73e09dd6afd6335e7ca0a4e) and full 2019-01-01/2031-01-01 (231,424 bytes, SHA-256 f61a72eab622841148966da23693544b05e0fc0533d45463e5bde19fa6922f3d). The profile manifests now contain 678 files totaling 281,252,864 and 1,189,047,296 bytes.

The scene registry adds Borisov as a selectable comet with no fabricated osculating fallback, mass or physical radius. A pinned full-precision SBDB cov=mat response (SHA-256 c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987) records all ten joint axes e,q,tp,node,peri,i,A1,A2,A3,DT at JD 2458853.5 TDB. The Orbit Uncertainty panel can load this source; time propagation continues to refuse it because the fitted force-parameter derivatives are unavailable. A separately pinned Horizons VEC_TABLE=2r response (SHA-256 b737db2def7ab7cf971834d9b7211f50ca4b66f137d9b5b7cc2fefd8547e165c) contains 147 30-day TDB samples through 2030-12-29. The evidence workspace shows the reported RTN marginal 1-sigma values as samples and does not infer cross-axis/cross-epoch covariance, an uncertainty tube or event probability.

The immutable-source parsers checked response hashes, solution IDs, orbit elements, nongravitational parameters, the ten-axis covariance shape, target/center/type descriptors, and profile manifest entries. These establish source identity and static registration only; the current runtime still awaits independent CSPICE state comparison, UI/device inspection, fitted-force/covariance acceptance and full-product capacity evidence. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 963: reconcile Horizons and SBDB nominal fit snapshots

Static review found that the pinned Horizons solution header and SBDB `cov=mat` response share solution 54 but do not report bit-identical nominal values for every axis. Replaced broad fixed absolute tolerances with a ten-axis comparison against the SBDB covariance's formal marginal sigmas; the largest normalized residual is A1 at 2.91e-7 sigma. Both ephemeris manifests and the exported Horizons uncertainty evidence now retain the per-axis values, deltas, sigmas, and an explicit boundary: this is source-snapshot compatibility, not proof of identical covariance mapping or a model-error bound. Static source/hash/manifest checks, syntax-only checks and `git diff --check` passed. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 964: pin vector-correction and uncertainty semantics

The frozen Horizons vector query omits `VEC_CORR`; the official API defines its default as `NONE` (geometric states) and documents `VEC_TABLE=2r` as position/velocity with formal RTN uncertainty components when available. The source model and export now record that the geometric correction is an API default, and describe the returned values as formal statistical marginal state uncertainties rather than a complete propagated covariance. Cross-axis and cross-epoch covariance remain unavailable. Static official-document/source-query reconciliation only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 965: compare state-tile wire contracts across clients

Read-only source audit compared the Go encoder, Web decoder/worker, Android and iOS decoders, and the three client services. All use wire version 2, a 208-byte header, little-endian scalars, six Float64 state fields, the same payload-hash span, bounded tiles, and the same scientific contract tags. Request-ID hashing uses little-endian UTF-8 byte lengths on Go, Web, Android and iOS. Android checks expected body IDs in its service accumulator and epoch/descriptor after decode; iOS/Web bind IDs and epoch during decode, with ordered descriptor checks in the service. No mismatch was found in the inspected contract; this does not replace cross-language golden fixtures or runtime acceptance. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 966: correct mission phase geometry and ephemeris policy

Static call-chain audit found the mission phase display bypassed the selected SPK policy and calculated an angle using the z component of a 3D cross product with a 3D dot product. That does not equal the ecliptic-longitude difference for inclined states. It now uses the same frozen `createAnalysisEphemeris` policy as transfer analysis, computes arrival minus departure ECLIPJ2000 heliocentric longitude, reports the actual state-source evidence, and leaves phase unavailable when strict SPK states cannot be resolved. The Hohmann target mean motion shares the solver's `SOLAR_GM_AU3_PER_DAY2` constant. Also corrected the Earth/EMB boundary text: only the circular Hohmann baseline uses the EMB-seed Earth-system semi-major axis, while Lambert and porkchop follow the selected policy and expose their model summaries. Source inspection and diff checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 967: audit ellipsoid ray geometry and inertial-frame convention

Read-only algebra review of the forward-ray solver confirmed its scaled-unit-sphere clearance for a forward closest point and for a closest point behind the observer, its rationalized near-root distance, and cross-product closest-point reconstruction are mutually consistent. Tangencies within the stated floating-point screening policy remain indeterminate; fixed-step scans can miss tangencies or multiple crossings, as the UI and receipt already disclose. The station stellar ray deliberately treats the BCRS/ICRS-aligned direction as the J2000-labeled DE440/PCK orientation frame; NAIF's Frames Required Reading says modern JPL DE series SPK and corresponding orientation products labeled J2000 are ICRF-referenced and need no transform. No extra frame rotation is justified by this source contract. This was source/algebra and official-document review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. Source: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/req/frames.html

### Checkpoint 968: reconcile state streaming routes and shared Hohmann constant

Static route/call-site inspection found no production Web, Android or iOS calls to legacy JSON current-state/trajectory routes. `/v1/state/window` is a bounded binary stream of length-prefixed metadata and the same validated binary state tiles, ending in a completion certificate; it is the temporal batching transport, not a JSON fallback. The mission phase target also now imports the same `SOLAR_GM_AU3_PER_DAY2` value used by the Hohmann solver instead of duplicating the numeric literal. Source inspection and diff checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 969: identify the full SBDB comet-force axes that propagation still excludes

Static inspection of the pinned 2I/Borisov SBDB solution-54 covariance confirms ten joint axes: `e,q,tp,node,peri,i,A1,A2,A3,DT`. Its model parameters include fixed `ALN=1`, `NM=2`, `NN=0`, `NK=0`, `R0=1`, and estimated `DT=-65.130097... d`. The coordinate transform preserves additional axes as identity parameters, while dynamics and event-ensemble entry points reject any source whose force parameters lack a matching model; they do not silently propagate a six-axis subset. JPL SBDB documentation says model parameters may be fixed, estimated or considered and that the covariance includes estimated model parameters. The Horizons manual defines A1/A2/A3 components, activity-law constants, and DT in days; peer-reviewed Yeomans-Chodas asymmetric-law descriptions evaluate activity using the shifted heliocentric distance `r(t-DT)`. This establishes concrete remaining work: source-matched 10D force propagation and the shifted-distance contract must be implemented and independently checked before event distributions can be called complete. Existing restricted six-axis products remain explicitly conditional. Source review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. Sources: https://ssd-api.jpl.nasa.gov/doc/sbdb.html ; https://ssd.jpl.nasa.gov/horizons/manual.html ; https://www.acta.astrouw.edu.pl/Vol44/n1/pap_44_1_8.pdf

### Checkpoint 970: validate SBDB model-parameter covariance axis provenance

JPL's SBDB schema defines `model_pars.n` as the index in the estimated/considered parameter list (zero for fixed parameters) and defines covariance labels as the six orbital elements followed by estimated dynamical model parameters. Static review of the pinned Bennu, 67P, and Borisov records confirms their estimated parameters are labelled in ascending `n` order; Bennu's API array is deliberately in a different order, showing why list order alone is insufficient. The parser and the downstream Cartesian covariance contract now require extra covariance labels to match the complete estimated-parameter set, reject duplicate/nonconforming model indices, and check available indices are ascending while allowing gaps occupied by considered parameters. Regression cases cover contradictory source labels and a malformed object passed directly to the coordinate converter. The source tests were added but deliberately not run under the current no-tests instruction. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. Source: https://ssd-api.jpl.nasa.gov/doc/sbdb.html

### Checkpoint 971: align platform SBDB covariance-axis validation

The same covariance input has independent readers in Go, Android receipt validation, iOS receipt validation, and the TypeScript six-axis receipt binder. Static comparison found those paths accepted a covariance label if it named an `EST` model parameter but did not prove that every estimated model parameter was present or that available `n` indices agreed with covariance-label order. They now apply equivalent completeness, kind/index, uniqueness, and ordering checks; the Go and Android source cases cover order and considered-index gaps. The iOS app has no separate unit-test target in this checkout, so its change remains source-reviewed pending the requested later test phase. This preserves SBDB's distinction between estimated, considered, and fixed parameters across the clients and API. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. Source: https://ssd-api.jpl.nasa.gov/doc/sbdb.html

### Checkpoint 972: pin the Marsden `DT` semantics against comet source fits

Re-read the frozen Borisov and 67P SBDB records and JPL's Horizons model definitions. Borisov's `A1/A2/A3` units are `au/d^2`, its `ALN=1`, `R0=1 au`, `NM=2`, `NN=NK=0` reduce the radial law to inverse-square activity evaluated at the shifted distance, and `DT=-65.130097 d`; 67P's fitted `DT=+45.666654 d`. The peer-reviewed 67P analysis explicitly substitutes `r(t-τ)` and associates positive `τ≈34.3 d` with a maximum roughly 35 days after perihelion. Thus the fitted peak is approximately `t_perihelion + DT`: positive shifts need past distance history and negative shifts need future distance during forward stepping. The current Dormand–Prince integrator is an initial-value stage evaluator without delayed/advanced trajectory history. The comet records use `DE441`/`SB441-N16`; static inspection found a `DE441` satellite kernel, 12 cropped `SB441-N16` asteroid kernels, and no DE441 planetary core in either manifest, while the dynamics experiment pins its DE440 core and restricted 11-mass force plan without composing those extra kernels. The archived Borisov Horizons SPK preserves an already fitted path but does not supply that source force model. The dynamics guide now records the equation, signs, repository inventory and source/integrator blockers; no incomplete comet force was added. Source review and doc change only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. Sources: https://ssd.jpl.nasa.gov/horizons/manual.html ; https://acta.astrouw.edu.pl/Vol53/n2/pap_53_2_7.pdf

### Checkpoint 974: verify the SPK Type 17 eccentricity limit

Static source review confirms that this SPK reader evaluates Types 1, 2, 3, 17 and 21 in J2000 or ECLIPJ2000; a matching segment in another type or frame fails closed. Segment lookup uses the last matching segment, and interval admission requires gap-free coverage for every target in the selected kernel. The apparent Type 17 `e <= 0.9` restriction is required by NAIF: its required reading defines Type 17 as an elliptic-orbit representation, while both `spke17` and `eqncpv` reject eccentricities greater than 0.9. The implementation's semi-major-axis and eccentricity guards therefore match the reference domain; widening this check would accept data outside NAIF's evaluator contract. No interpolation change is justified by this audit. Non-elliptic comet support must use a representation such as the existing Horizons Type 21 path or a separately specified hyperbolic model, not Type 17. This source audit and ledger entry did not run tests, builds, benchmarks, browser/device checks, deployment, release, commit or push. Sources: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html ; https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke17.html ; https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/eqncpv.html

### Checkpoint 975: check whole-kernel interval admission against bundled SPKs

The Pages and full manifests each contain 678 files and 16 multi-target SPKs. A read-only DAF descriptor audit read only those 32 kernel summary chains (all referenced files were present), grouped each file's inclusive descriptor intervals by target, and merged overlaps exactly as the runtime coverage index does. In every multi-target file, all targets have the same merged interval sequence in both profiles; thus the current whole-kernel coverage predicate does not exclude a target with fuller time coverage merely because a sibling target has a gap in the bundled data. Single-target kernels cannot exhibit that mismatch. No runtime filter change is justified by these manifests. This result is bounded to the two checked manifest profiles and does not establish coverage for future or externally supplied kernels. The audit was read-only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 976: reconcile every bundled SPK descriptor with both manifests

A read-only DAF summary-chain inventory covered every one of the 678 kernel paths in both the Pages and full manifests. All paths exist; actual file byte counts, unique segment target sets, and minimum/maximum segment epochs exactly match the manifest records. The Pages profile contains 1,091 descriptors (types 1: 3, 2: 892, 3: 17, 17: 2, 21: 177); the full profile contains 1,122 (types 1: 3, 2: 906, 3: 17, 17: 2, 21: 194). Every descriptor uses frame 1 (J2000), and no bundled descriptor uses an SPK type/frame rejected by the current parser. This closes the manifest-to-DAF summary inventory for these two snapshots only. The audit read summary metadata, not segment coefficient payloads; it did not independently verify every binary checksum, interpolated state, numerical reference error, or runtime selection. No tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 977: sweep explicit SPK source-center dependency chains

For both manifests, a read-only descriptor-level sweep evaluated every explicit source root at every segment-boundary epoch and every midpoint between adjacent boundaries in its direct dependency pool. It used the runtime's last-matching-file and last-matching-segment precedence, then recursively followed each selected segment's center to the SSB. Pages covered 447 roots and 2,061 root-segment/epoch cases; full covered the same 447 roots and 2,119 cases. No dependency file was missing, no root omitted a dependency-declared nested ID, and no selected root segment had an unavailable or cyclic center chain at the swept cases. This verifies structural center reachability across descriptor-selection intervals for the current manifests, not numerical state accuracy, file checksum validity, physical consistency between source solutions, or external/future kernels. No application runtime or tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 978: reconcile event and mission receipts with numerical-method limits

Read-only inspection followed event UI request construction through `useConjunctionWorker`, worker admission, event result binding, and cache-key construction. Event runs freeze the relevant body descriptions, exact kernel IDs, policy, and request window; worker admission bounds input weight, body count, event kinds, sampling size, and refinement count. Result binding checks the exact UTC window, manifest identity and hashes, pool IDs, sampled-body models, sampling receipt, event bounds, and event-to-request IDs. Mission requests similarly pin endpoint kernel dependencies and policy; result binding checks the 26-by-22 grid, point order/times, UTC conventions, manifest hashes, and model evidence. These are consistency checks, not independent recomputation of event extrema or Lambert solutions.

The event cadence estimate uses the peak true-anomaly rate for elliptic Kepler descriptions, combines the two fastest rates, targets 36 samples per estimated relative orbit, and caps the grid at 720 samples. The receipt correctly keeps completeness uncertified. Local golden-section refinement re-evaluates the model in the bracket but assumes a unimodal objective there; its reported half-width is only the numerical search interval, not physical prediction uncertainty. These limitations are disclosed in the code and do not justify silently promising complete event detection or physical accuracy. Static review of the bundled SPK evaluator also matches the documented record shapes and roles: Type 2 position Chebyshev sets with differentiated velocity, Type 3 separate position/velocity sets, and Type 1/21 modified difference lines. References: [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html), [NAIF SPKE21](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke21.html). This was a formula/contract inspection only; bundled numerical coefficient evaluations were not independently compared with CSPICE/reference states. No actionable mismatch was established, so no algorithm or performance changes were made. No tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 979: correct the 1994 UTC leap-second effective date

Comparing the entire in-code leap table with NAIF's current `naif0012.tls` found one date mismatch: the table assigned TAI-UTC = 29 seconds starting 1994-01-01, while the LSK specifies 1994-JUL-1. Corrected the entry to 1994-07-01. For numeric UTC Julian dates from 1994-01-01 through 1994-06-30, the previous table advanced UTC to TT/TDB by one second early; the corrected date restores the documented offset for that interval. The same table drives state-kernel ET and TT conversions. NAIF's announcement confirms the current LSK is expected to remain current until at least 2027-07-01; the existing future-uncertain receipt boundary therefore matches the current announcement. Sources: [NAIF naif0012.tls](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls), [NAIF announcements](https://naif.jpl.nasa.gov/naif/announcements.html), [NAIF DELTET documentation](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/deltet_c.html). Static verification only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 980: verify the restricted-dynamics GM source identity

Static inspection confirmed the force plan selects Sun, Mercury/Venus/Mars/Jupiter/Saturn/Uranus/Neptune/Pluto system barycenters, and Earth plus Moon as separate masses; it does not additionally include the Earth-Moon barycenter or those planetary constituents. In the pinned `gm_de440.tpc`, Earth GM plus Moon GM equals the EMB GM within the stored decimal precision, supporting the intended non-overlap representation. The local GM source SHA-256 equals the digest pinned in `de440Source.ts` (`924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140`). This authenticates the locally selected parameter file against the repository pin, not the external source's scientific derivation or the full DE440/Horizons dynamical model. The runtime force receipts already state fixed prescribed masses/trajectories, no back-reaction, and omitted higher-order forces; no unsupported full-fit accuracy claim was found. No tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 981: verify Gaia TCB-to-TDB stellar parameter scaling

Primary-source review confirms Gaia DR3 astrometric catalog parameters are BCRS/TCB compatible, and Klioner's TCB-to-TDB mapping scales time and spatial coordinates together by F=1-LB. With the IAU-defined AU fixed to 149,597,870,700 m for all time scales, the SOFA kernel's formal distance expressed in AU must scale by F: angular-rate and inverse-distance (parallax) inputs therefore divide by F, while coordinate velocity is unchanged; outputs are mapped back to TCB-compatible values. The existing stellarmotion conversion matches this dimensional mapping, so no code change is justified. The station km-to-AU conversion uses DAU/1000 and is dimensionally correct. This verifies scale consistency under the documented fixed-AU and ephemeris-compatibility assumptions; it does not provide independent positional-accuracy validation. Sources: Gaia DR3 reference systems and time scales (https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_refsystems.html), Klioner 2008 (https://arxiv.org/html/astro-ph/0508292), IAU Resolution B2 (2012) (https://syrte.obspm.fr/IAU_resolutions/Res_IAU2012_B2.pdf). Static derivation and source review only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 982: reconcile Gaia formal astrometric covariance coordinates

Static review traced the covariance coordinates and finite-difference Jacobian. Gaia ra_error is sigma(alpha*cos(dec)); pmra and its uncertainty use mu-alpha-star; input/output RA perturbations are converted to tangent-plane mas consistently. The first five fields form the archived within-source astrometric covariance, while Gaia documents these correlations as approximations derived from 5x5 or 6x6 normal matrices that omit between-source correlations. The adapter keeps the five-coordinate marginal for both five- and six-parameter solutions and treats the spectroscopic RV error as independent only under an explicit policy; labels disclose the no-systematics and no cross-source scope. The Cholesky factor and its propagated K K^T construction are dimensionally consistent, and the centered Richardson derivative maps wrapped RA into the output tangent-plane coordinate. No mismatch was established, so no algorithm change was made. Sources: Gaia DR3 correlations (https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_quality/ssec_cu3ast_quality_corr.html), Gaia EDR3 astrometric parameter definitions (https://gea.esac.esa.int/archive/documentation/GEDR3/Gaia_archive/chap_datamodel/sec_dm_main_tables/ssec_dm_gaia_source.html). Static contract/algebra review only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.

### Checkpoint 983: audit optional solar force equations

Static algebra/source review confirmed the optional solar-monopole 1PN term uses the standard central-body weak-field test-particle acceleration, with analytic derivatives of the position and velocity factors matching the implemented variational-state Jacobians. The implementation composes this Sun-relative term with prescribed barycentric Newtonian forces, so its receipt correctly limits the claim to a restricted hybrid model rather than full n-body relativistic dynamics. The SRP term has outward radial direction and pressure*Cr*A/m*(AU/r)^2 magnitude with the SI-to-km/s^2 conversion; its radial-state Jacobian is consistent. Illumination is explicitly fixed unshadowed and attitude, eclipses and time-varying spacecraft properties are excluded. No formula or performance change is justified by this review. Sources: JPL ODP relativistic equations (https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_all.pdf), LLNL SSAPy simple solar-radiation-pressure model (https://software.llnl.gov/SSAPy/api/ssapy.accel.AccelSolRad.html), NASA spacecraft SRP formulation (https://ntrs.nasa.gov/api/citations/19720023166/downloads/19720023166.pdf). Static equation/source review only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran.


### Checkpoint 984: make spacecraft manifest contract updates idempotent

Static review found that both Pages and full ephemeris manifests contained the
same spacecraft evidence clause twice. The offline spacecraft integrator had
unconditionally appended that clause on every source-pack integration. It now
validates the existing contract, collapses adjacent duplicates, and adds the
clause only when absent. Both current manifest contracts now contain one copy;
the source descriptors and historical selection receipts were left intact.
JSON parsing, occurrence counts and diff whitespace checks passed. No tests,
builds, source integration, benchmark, browser/device run, deployment, release,
commit or push ran. This metadata correction does not change or certify
spacecraft state coverage, numerical accuracy, or the remaining issue 109
acceptance gaps.

### Checkpoint 985: route strict single-transfer Lambert states through the shared backend

Strict-SPK single-transfer calculations now use the configured backend's bounded `/v1/state/window` stream when an API base is available. The adapter requests departure, arrival, and Sun states at the exact UTC endpoint epochs, verifies exact `spk-original` barycentric rows and kernel hashes, converts SSB km / km/s values into the solver's Sun-relative ECLIPJ2000 AU / AU-day contract, and retains manifest, plan, source, ordinal, and tile-hash receipts in the exported Lambert result. Endpoint changes and unmount cancel pending requests; a configured backend failure does not silently substitute a local source. With no API base, the prior local SPK path remains. Porkchop grid calculations and applying a selected grid opportunity still use the grid's frozen local kernel snapshot, so backend integration is partial. Static contract/call-chain and diff-whitespace inspection only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran. Issue 109 remains open pending target-device and cross-platform acceptance.

### Checkpoint 986: review catalog concurrency limits against the scale objective

The checked-in budget already admits four concurrent catalog shard reads, a separate four-tile upload window, and cooperative worker yields around 4 ms; the memory planner charges these simultaneously resident buffers and keeps a larger legacy per-row reserve because no linked-device memory evidence supports reducing it. Explorer's initial clouds remain 8,000/30,000-point samples, while full Catalog streaming has its own draw and load-memory limits. The documented 1,567,193-point desktop ceiling is a policy envelope, not a measured integrated capacity or a physical-device frame-time claim. No concurrency or capacity increase is justified by source inspection alone; raising it without throughput, memory, thermal and UI-responsiveness evidence would be blind tuning. No performance code change, test, build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 987: use one bounded exact backend window for strict Porkchop grids

The current mission worker uses a fixed 26×22 grid. Deriving UTC epochs from the same row-major formulas gives at most 598 unique departure/arrival epochs; the client and server state-window limits are each 1,024 epochs and 262,144 body-epoch states, while the server holds only four epoch plans ahead. Strict-SPK grids with a configured API now request the complete deduplicated endpoint set once inside the worker, solve all 572 points against those exact cached states, and return the per-epoch plan/source/tile receipts. Local strict-SPK and exploratory policies retain their existing kernel paths. Result binding now verifies every expected TDB epoch, endpoint identity, source ordinal, manifest, plan hash, contiguous tile receipt and source/kernel hash; applying a backend-grid opportunity refetches its two states only if the same catalog/inventory manifest remains current. Single-transfer state reads now expose a cancel action and abort on input change or unmount. This removes paths where a selected-point or transfer result could silently refer to a different source snapshot. Static protocol/call-chain/diff inspection only; no tests, builds, benchmarks, browser/device checks, deployment, release, commit or push ran. Issue 109 remains open pending runtime, cross-platform and target-device acceptance.

### Checkpoint 988: make event-refinement cancellation cooperative

The event worker's cancel protocol was already effective during kernel loading, coarse sampling and pair/body boundaries, but one pair could synchronously refine many sampled extrema before yielding. Refinement now yields to worker messages every 64 candidates and exits through the existing `cancelled` response when the request is cancelled or superseded. The React event hook now sends that protocol message and retains the worker until it acknowledges cancellation; a subsequent run or component unmount still terminates the prior worker. The numerical extremum algorithm, sample grid, evaluation cap, source model and result values are unchanged. Event calculations remain on the local frozen SPK provider: their adaptive refinement epochs depend on sampled results, so the finite predeclared state-window route used by mission grids cannot replace them without an exact batched-refinement protocol. No test, build, benchmark, browser/device run, deployment, release, commit or push ran.

### Checkpoint 989: bound the remaining exact event-window batching problem

The live event sampler caps the coarse grid at 720 epochs. A rectangular exact-state request can fit at most `floor(262144 / 720) = 364` body IDs at that cadence under the `/v1/state/window` state budget (the separate ID ceiling is 1,024), so the coarse scan is batchable after counting its actual frozen resolution-body set. Refinement is different: the current golden-section routine makes up to 19 model evaluations per candidate (two initial interior points, up to 16 new points, and the returned midpoint); the existing 50,000-candidate ceiling therefore permits up to 950,000 adaptively chosen evaluation epochs. The window endpoint accepts the same IDs at every epoch, so blindly padding each candidate with every resolution body wastes state budget, while interpolation or reusing a nearby sample would change the exact-SPK contract. The worker remains on its local frozen kernel provider until an exact variable-ID-per-epoch batch protocol and candidate admission budget can be integrated end to end. This is a source-derived resource bound, not a claim that all accepted requests reach that maximum. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 990: name the event cadence metric without a resolution claim

The exported event samplingPlan serialized maximumResolvablePeriodDays, although its value is 36 times the nominal grid interval. That arithmetic describes a period equivalent to 36 nominal intervals; it does not establish a maximum resolvable period or certify event completeness. Renamed the field to periodAt36NominalIntervalsDays and aligned the existing contract assertions. The grid policy, sample count, event solver and numerical results are unchanged. Static reference search and diff checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 991: confirm Gaia motion chunks have bounded source and upload memory

Static source review confirms that Gaia motion reads and consumes at most two chunks concurrently, with 30,000 rows per source chunk and a 64 MiB / 60,000-row in-flight window. The worker permits two backend uploads and two pending acknowledgements, retains BigInt64 source identities and Float64 scientific state columns, compacts status/reason columns, emits Float32 only for derived display coordinates, and commits chunks in manifest order even when backend responses finish out of order. These contracts bound chunk and acknowledgement concurrency; they do not establish aggregate RSS, real-device frame time, or completion of every 200,000-row chart. No budget was raised because source inspection alone does not justify it. Static inspection only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 992: qualify the historical desktop renderer benchmark

The existing RTX 5070 Ti report measured the standalone synthetic 2D renderer at 1,561,171 points, with 16.8 ms callback p95/p99 and 1.0 ms CPU position-upload submission. Its pinned renderer hash is 6e3ef49dd1f15467a476fa0334f5ab7cfb5ec10f7b921ddbf658877681bab53f; the current renderer hashes to bc72fd282462c253d9fabd488809dcf81c23e275230d6fe6da9a647cdd91013b and has uncommitted changes. Those changes include RGB8/size-tenths attributes, retained GPU-only spatial indices and reduced passive getError checks. The style table stores point size in tenths and the shader multiplies it by 0.1; normalized byte color attributes match the RGB8 producer. No source-level mismatch was established. Because the measured renderer hash differs, the historical result is not a current-source performance claim; it also excludes full application streaming, concurrent orbit computation, total memory and mobile/native devices. No renderer capacity change or new benchmark was made. Static source/hash review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 993: reconcile catalog stream memory charges with retained buffers

Static cross-check matched planner charges to source allocations: 2D/3D per-point bytes cover retained CPU attributes, matching GPU attributes, worker culling coordinates, and output/index high-water buffers; the full source membership bitset and draw-priority bitset are separate; the capped screen-count overlay charges 12 bytes per cell for worker counts, ImageData, and canvas backing; and the optional 80 bytes per point matches ten Float64 prepared coefficients. Tile concurrency, two epoch upload slots, spatial block indexes, compact-index assembly, metadata, source locators, and fixed reserves have separate planner entries. No missing retained-array category was found in these formulas, so no speculative budget increase is warranted. These are planner-accounted arrays and bounded queues, not a guarantee on total browser RSS, JavaScript/runtime overhead, driver allocations, frame time, or cross-device throughput. Static source review and whitespace checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 994: align selection and draw limits with admitted capacity

Static call-path review confirms one effective ceiling: the canvas computes maximumDrawPoints as min(plan.capacity, UI displayLimit), passes that value to both all-row and spatial worker selection, and passes the same value into every retained GPU draw, including transition frames. The GPU renderer additionally clamps element draws to min(selectionCount, retainedCount, draw limit). Selection requests are serialized by one worker loop; a new view advances the cancellation generation and replaces the single pending request, while old work cooperatively returns before the next pass allocates its workspace. Spatial winner, output, priority, membership, and screen-count buffers remain within the stream planner formulas recorded above. No mismatched ceiling or overlapping selection-workspace path was found, so no capacity or performance change is justified by static evidence. This establishes source-level coupling only; it does not establish current-device frame latency, total process RSS, or that the historical renderer benchmark applies to the current source. Static inspection and whitespace checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 995: verify spatial block rejection remains conservative

Static geometry review found block bounds are built from the same Float32 display coordinates used by per-row screening. For each projected axis, the index interval-arithmetic combines signed coefficient times per-axis minima/maxima, then pads by twice the point-screen relative margin scaled by the sum of term magnitudes and viewport extent; blocks whose bounds cannot intersect the padded viewport are skipped. Exceptional or overflowing normalization takes the exact per-row path. Every installed coordinate range invalidates its 1024-row bounds, including streamed tiles and epoch updates; epoch selection remains disabled until the full updated snapshot is coherent. This is a conservative visual prefilter, not a scientific-state filter, and source rows, identifiers, and numerical states remain unchanged. No false-rejection path was found in the inspected 2D/3D projection math; the documented margin is still an engineering bound rather than a formal guarantee over all GPU implementations. Static source review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 996: audit SBDB covariance units and propagated-model coverage

The frozen 2026-09-28 JPL response for 2I/Borisov (SPK 1003639, solution 54; SHA-256 c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987) is a 10x10 cov=mat, full-prec=1 matrix at TDB JD 2458853.5. Its axes are e, q, tp, node, peri, i, A1, A2, A3, DT; units are dimensionless, au, day, degree, degree, degree, au/day^2 for A1-A3, and day for DT. The JPL SBDB API defines covariance as solution-epoch-only, the first six orbital axes followed by estimated dynamical parameters, and differentiates cov=mat degree units from cov=src radian units. The repository fetch script requests cov=mat and full-prec=1; the parser requires the full square matrix and binds the covariance epoch to its solution elements. The coordinate conversion converts angular derivatives from degrees and retains additional axes and cross-correlations. Sources: https://ssd-api.jpl.nasa.gov/doc/sbdb.html#orbit-subsection-covariance and https://ssd-api.jpl.nasa.gov/doc/sbdb.html#orbit-subsection-elements.

The same frozen source lists estimated non-gravitational A1/A2/A3 and DT, plus ALN=1, NK=0, NM=2, NN=0, R0=1; its orbit metadata cites DE441 and SB441-N16. JPL Horizons documents A1-A3 in au/day^2, DT in days, DT as a comet lag/delay, and the ALN=1, NK=0, NM=2, R0=1 special case as inverse-square acceleration (NN is inactive when NK=0). The current application can parse and convert this complete 10D source covariance, but the time propagator explicitly requires exactly six axes; the nonlinear ensemble has the same six-axis restriction, and the current restricted DE440 force model has no nongravitational acceleration. This is an intentional rejection rather than lost cross-correlation, but it means Borisov source uncertainty is not yet propagated in time. DT handling, matched A1-A3 state and parameter derivatives, and model/ephemeris parity need a separately validated design before this source can be accepted by the propagator. Sources: https://ssd.jpl.nasa.gov/horizons/manual.html#user-specified-small-bodies.
Static source, frozen-receipt, and official JPL documentation review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 997: explain the full-axis rejection across covariance tools

Rechecked the existing research record in docs/scientific-expansion-goal.md (checkpoints 605-607): it already documents the asymmetric shifted-distance form r(t-DT), the signed interpretation, and why a state-local forward initial-value force callback cannot represent a negative delay without a future-distance model. The current dynamics derivative accepts a 42-value state containing six Cartesian components plus a fixed 6x6 transition matrix; it has no fitted-parameter sensitivity columns or trajectory-history interface. The frozen Borisov source still has A1/A2/A3 and DT, so rejecting its complete covariance remains necessary.

Improved all three covariance-dependent panels (linear covariance, nonlinear orbit ensemble, and ensemble distance events) to show the actual unsupported source axes with their nominal values and units, explain that only the first six axes cannot preserve joint covariance, and call out the future-distance requirement when DT is negative. The source-axis list comes from the already parsed covariance labels and aligned nominal/unit arrays. This changes the refusal explanation only; it does not add comet force terms, delay-history evaluation, or sensitivity propagation. Static call-site and whitespace checks plus git diff --check passed. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 998: distinguish Borisov's stored SPK from a covariance-compatible force source

The pinned Horizons type-21 SPK for Borisov solution 54 is present in the full ephemeris manifest over 2019-01-01 through 2031-01-01 TDB (231,424 bytes; target 1003639, center 10); the Pages manifest intentionally contains only its 2026-2027 window (21,504 bytes), which does not reach the solution epoch. The integration receipt preserves the original Horizons record 90004568, solution identity, source hashes, DE441/SB441-N16 fit metadata, and the explicit observation-arc/extrapolation boundary. This stored trajectory is usable as source evidence, but it is not currently consumed by the dynamics worker: that worker loads the pinned DE440 kernel and constructs only the restricted DE440 force model. Substituting the fixed Horizons trajectory into a delayed A1-A3 law would not by itself propagate the ten-dimensional fitted covariance or its state/parameter cross-correlations; the source SPK also does not encode orbit uncertainty. Under the adopted r(t-DT) formula a negative DT requires a future-distance evaluation, but the JPL Horizons documentation calls DT a lag/delay parameter without establishing this particular solution's sign mapping. Keep the covariance rejection until force/source parity, the source-specific DT convention, and matched trajectory/parameter sensitivities are established; do not imply that source SPK coverage closes the model gap.

For simultaneous catalog rendering, source review found existing admission/draw-limit coupling, 1024-row conservative spatial blocks, serialized cancellable selection, 3 ms frame upload budget, four-file cancellable ephemeris loading, and an aggregate 768 MiB kernel-buffer budget. The latest static audits found no mismatched capacity or avoidable overlapping selection workspace. No target-device timing or current-source benchmark was run, so this supports stopping blind tuning, not a claim of measured peak performance. Static source and manifest review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 999: expand the local SBDB fitted-axis inventory and qualify DT sign

Read-only inspection of the checked-in source fixtures finds 67P/K284/1 and Borisov/54 with ten axes (`e,q,tp,node,peri,i,A1,A2,A3,DT`), Bennu/118 with eight (`...RHO,AMRAT`), and Eros/659 with six orbital axes. These fixtures carry different orbit-fit ephemeris identities: DE441/SB441-N16 for 67P and Borisov, DE424/SB424-N343 for Bennu, and DE441/SB441-N16 for Eros; all therefore differ from the restricted DE440 propagation contract even when only six axes are present. Existing covariance code rejects additional axes instead of dropping them or holding fitted parameters fixed. The source-facing notice lists the actual unsupported axes and values and now states the gap as an unverified binding to the source's fitted force law, rather than implying that no related force term exists in any mode. This local fixture inventory is not a claim about every live SBDB object.

The official [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html#user-specified-small-bodies) identifies `DT` as a comet non-gravitational lag/delay in days but does not state its signed mapping to the asymmetric `r(t-DT)` equation for these pinned solutions. Accordingly, the UI now phrases the negative-DT future-distance statement conditionally and explicitly says that the source-specific sign mapping is unverified. The fitted 67P and Borisov non-gravitational axes remain unsupported; this clarification does not relax the refusal. Static fixture, documentation and source review only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 1000: complete the declared SB441-N16 asteroid target crops

The official upstream [JPL SB441-N16 SPK](https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/sb441-n16.bsp) declares 16 asteroid targets in `scripts/build-ephemerides.mjs`, but both local manifests previously contained only 12. A range-based read of its DAF summaries verified the four omitted NAIF targets—Pallas (2000002), Vesta (2000004), Hygiea (2000010), and Psyche (2000016)—as J2000-frame, heliocentric-center-10 type-2 segments covering the packaged 2020-01-01 through 2031-01-01 TDB window. Added exact source-record crops for those four targets to both manifests and added `scripts/integrate-sb441-n16-completion.mjs` so the same bounded, ETag-pinned integration can be reproduced without rebuilding expanded manifests. Each new crop is 29,696 bytes and retains the original remote source identity plus its own SHA-256. The manifests now cover all 16 targets declared by the source. Existing `asteroid:<number>` identity mapping resolves these NAIF targets, and target selection loads only the matching kernel files. This completes the packaged SB441-N16 target list; it does not make the restricted DE440 dynamics worker a DE441/SB441 source-fit propagator. Static source/data checks only; no tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran.

### Checkpoint 1001: add Juno reconstructed-orbit source

The official [NAIF Juno SPK archive](https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/) supplies juno_rec_orbit.bsp; the [PDS Juno SPICE profile](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=JNO-J%2FE%2FSS-SPICE-6-V1.0) describes the spacecraft files as navigation-team reconstructions. A full source copy retrieved on 2026-09-29 was 146,816,000 bytes, SHA-256 13c8c7c431a67af69485b272ebde740f3135585925a454134eb3b80283a4a487, Last-Modified 2026-09-01 18:17:23 GMT. Its DAF summary declared 286 target -61 / center 5 / frame 1 / Type 1 segments and the merged-file comment records coverage through 2026-08-24. The [official orbit-event table](https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/juno_rec_orbit.orb) independently lists perijove events through August 2026.

Both manifests now expose naif:-61 from TDB ET 694267269.1839212 (2022-01-01 UTC converted to TDB) through 840884700, preserving 176 original Type 1 segments in a 91,458,560-byte crop with SHA-256 a35de1849693a31464b86631cdd4d8f2ce5661e17352644b755db83fd9106c43. The root explicitly selects de440s-2000-01-01-2051-01-01 for the Jupiter-barycenter and solar-origin chain. This composes two separately identified sources; it does not assert that DE440S was the Juno navigation fit ephemeris. Selecting Juno resolves to the root plus seven existing core kernels (103,441,408 declared bytes total).

Read-only checks matched both manifest entries and file hashes, found no descriptor/center coverage gaps over the crop, confirmed the body selector includes the root and DE440S dependency, and evaluated finite Sun-relative position/velocity with the expected two-source chain at start, midpoint and end. PDS reports only broad informal reconstruction scales (about 25 km 1-sigma during cruise and about 1 km 1-sigma near perijove); they are not a covariance product or per-state bound for this crop. No independent numerical reference or trajectory residual was compared. No tests, builds, benchmarks, browser/device runs, deployment, release, commit or push ran. The dedicated [preparation script](../scripts/prepare-juno-reconstruction.mjs) and [integrator](../scripts/integrate-juno-reconstruction.mjs) preserve the full source in local cache and publish only the bounded crop.

### Checkpoint 1002: compare Juno source, crop, and readers against CSPICE

Extended the spacecraft reference generator and TypeScript/Go comparators to
bind external center/origin kernels by runtime-manifest identity and bytes. This
covers Juno's actual source structure: reconstructed target -61 relative to
Jupiter-system barycenter 5, with a separately identified DE440S dependency.
Using SpiceyPy 8.2.0 / CSPICE_N0067, the reference enumerated 635,061 epochs
over ET 694267269.1839212 through 840884700, including source-record boundaries,
neighboring representable epochs, and interval midpoints. The original full
SPK and the packaged crop had exactly zero difference in all six CSPICE state
components under the same DE440S center source. The Solar TypeScript and Go
readers both matched the independent CSPICE state positions exactly; their
maximum absolute velocity-component differences were 7.105427357601002e-15,
1.4210854715202004e-14, and 7.105427357601002e-15 km/s. Prepared receipt SHA-256
is `8ca97c16c2b17f8054a12cbfbbbaa9730a49256fcc02de73c77bd036f535b3ed`; the
CSPICE reference report SHA-256 is
`ea59b5d9df4e061087574bb715a9581b29504c4eb79ec1b5d6dadda17a4e632c`.

This establishes sampled source-crop and implementation parity for the bound
bytes and conventions; it does not establish agreement with Juno navigation
truth, a trajectory residual, the navigation fit's planetary ephemeris, or a
per-state accuracy/covariance bound. PDS's broad informal reconstruction scales
remain the only uncertainty description. No project tests, application build,
benchmark, browser/device run, deployment, release, commit, or push ran.

### Checkpoint 1003: audit Cassini Grand Finale trajectory and covariance candidate

The official PDS SPK guide identifies 171214R_SCPSE_17224_17258 as an
operations-era Cassini NAV reconstruction delivered 2017-12-14 for 2017
DOY 224 through 258. The separate RU products are a later uniform
reconstruction; PDS says initial science-team feedback did not find it better
than the operational reconstruction and that RU files were omitted from archive
meta-kernels. Do not call this selected NAV source the final uniform solution.
Sources: [PDS SPK guide](https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/data/spk/spkinfo.txt), [PDS Cassini profile](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=CO-S%2FJ%2FE%2FV-SPICE-6-V1.0).

Fetched the original 14,167,040-byte SPK and matching 44,660-byte Saturn-699
covariance table into the ignored local audit cache. The source hashes are
2b5e4747e06adb2f6db0d6718d84b47945c3588ec5cef19b5afa8aa7e09290a4 and
6b19436ff4eaa1f78a369b6c6009f3a44a3d277f86fc19e04359987c33d839c5.
Static DAF parsing found Cassini target -82 relative to Saturn-system barycenter
6 in J2000 Type 1 across 15 segments; the same file contains target 699
relative to 6 and target 6 relative to SSB, so the source provides the needed
center chain. PDS covariance documentation says the 699-suffixed table is
Saturn-relative, stores a symmetric 3x3 position covariance in radial,
transverse, normal axes, and reports formal 1-sigma values. The matching table
has 405 finite chronological rows at two-hour intervals from
2017-08-12T03:58:50.8170 UTC through 2017-09-14T19:58:50.8176 UTC; every
sampled correlation matrix is positive definite. The SPK continues about
14 hours past the covariance table, which must remain an explicit uncertainty
gap. PDS recommends multiplying uncertainty by three for systematic effects
by scaling each covariance row and column by three.
Sources: [covariance table guide](https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/extras/spkxtra/covtab/covinfo.txt), [matching table](https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/extras/spkxtra/covtab/171214R_SCPSE_17224_17258_699.txt).

Unit audit: the accessible PDS covariance guide and table header define the RTN
matrix fields and formal one-sigma interpretation, but do not state the matrix
term units. Do not label these values as km² or render a spatial uncertainty
ellipsoid until the NAV/PDS unit convention is independently established. The
trajectory may be integrated separately with this uncertainty source withheld.
The table suffix `699` denotes Saturn's body center, whereas the selected
Cassini Type 1 state is relative to Saturn-system barycenter `6`; any future
covariance use must preserve that center/frame distinction. The runtime crop
therefore keeps only the trajectory's actual center chain and Sun origin.

### Checkpoint 1004: integrate the Cassini Grand Finale NAV trajectory

The current official PDS archive entry for
`171214R_SCPSE_17224_17258.bsp` identifies the operations-era Cassini NAV
reconstruction for 2017 DOY 224–258. The downloaded source is 14,168,064 bytes,
SHA-256 `02eb41ad1f107e9d4c9c6fd4edd4b89c8305d937f7d46d3f097ea109e268a3e5`;
the archive directory lists its 2017-12-28 modification date. An earlier local
capture of the same path was 14,167,040 bytes with SHA-256
`2b5e4747e06adb2f6db0d6718d84b47945c3588ec5cef19b5afa8aa7e09290a4`. Both
parse to the same 43 SPK segment descriptors. Aligning the DAF segment-address
offsets shows all 14,156,568 bytes across those segment data regions are
identical; CSPICE_N0067 also returned bit-identical six-component SSB states
for 2,091 boundary, adjacent-ULP, and interior epochs. Product manifests use the
current official bytes.

Added Cassini NAIF `-82` as a source-backed selection in both Pages and Full.
The root preserves 15 J2000 Type 1 segments relative to Saturn-system barycenter
6 over TDB ET `[555782400, 558743640]`. Its separately hashed dependency crop
contains only target 6 and Sun target 10, each Type 2 relative to SSB 0; this
supports the runtime's Sun-relative state without selecting the source's
unrelated satellite segments. The trajectory crop is 13,662,208 bytes
(`a7c4819d9cb6eff268578e2fc0e40d214f8ae8fea30e29dd8b442336b46d72cf`); the
dependency crop is 5,120 bytes
(`494b205a5c662b1745b89fb576d40a688b10a322ae9b28122982f6e50fa535ea`). Pages
manifest SHA-256 is `2a6a2627820aa560f937cecf093da2de61045fb57eec342eaf94778b70ebc686`;
Full manifest SHA-256 is
`6611e75b5dfc3fdc19a00dd517c0987f5afe79c292c1957634c579073b28220d`.
Prepared pack receipt SHA-256 is
`48a2ef1f2742f018eb217d331f75d5b4030ae26320eaa892e8c7917d5da0a2b0`.

The archived original and two prepared crops agree exactly in all six CSPICE
components at 94,839 sampled epochs. Solar's TypeScript and Go SPK readers also
match CSPICE over those epochs: positions are exact, and the largest velocity
component difference is `3.552713678800501e-15 km/s`. The actual runtime
`createKernelResolver.relative(-82, 10)` chain was separately compared with
CSPICE Sun-relative states after rotating J2000 into the app's ecliptic frame;
maximum position component differences are
`[0, 7.152557373046875e-7, 3.129243850708008e-7] km`, with velocity differences
no greater than `1.0658141036401503e-14 km/s`. Reports are retained in the
ignored `.cache/spacecraft-packs/cassini-grand-finale-20260929-r2` audit pack:
CSPICE `554fda0c487aaed48057760914e6baca20b7c64e089eb072577ec0681b34ef03`,
TypeScript `7102b9357eb6b0737c2dd7d7c62fc43d971835099c8fb83319c058426ca95953`,
Go `3ca8d58efd115e81d57ab7303c195ba6fd6eba1065f352888ab3b22a5ef25550`, and
Sun-relative CSPICE states `df759d189a16967640d8619f771f2288770f1a07f7df4810160710192f4b3009`.

These comparisons establish source/crop/reader parity, not Cassini trajectory
accuracy or a nav-fit error bound. The formal Saturn-relative RTN covariance
table stops about 14 hours before the SPK trajectory end, and its matrix-term
units are not stated in the accessible PDS guide or table header; it remains
unavailable to calculations and UI. No project tests, application build,
benchmark, browser/device run, deployment, release, commit, or push ran; the
checks here were source, manifest, and independent numerical audits only.

The available table header does not declare a unit for its covariance terms.
The square-root diagonal values numerically range from about 0.005 to 0.422,
but labeling those values in km would currently be an inference from the SPK
position convention, not an explicit table declaration. Do not expose kilometer
ellipsoids or feed these position-only terms to the six-dimensional covariance
pipeline until units, UTC-to-TDB epoch conversion, Saturn-center offset, RTN
basis, and interpolation behavior are bound and reviewed. This is a strong
candidate for a source-backed spacecraft uncertainty view, not integrated
product data yet. No project tests, build, benchmark, browser/device run,
deployment, release, commit, or push ran.

### Checkpoint 1005: expose Gaia's documented zero-radial-motion fallback in bulk propagation

The official Gaia DR3 standard stellar-motion model states that epoch
propagation needs six astrometric parameters and assumes zero radial proper
motion (`mu_r=0`) when radial velocity is unknown. The batch propagator now has
an opt-in `gaia-mu-r-zero-when-rv-missing` policy: supplied catalog RV remains
in use, missing RV may use the documented `mu_r=0` assumption, and affected
successful rows carry `zeroRadialMotionAssumed=true` plus a receipt count. The
existing strict policy remains the default. Position, proper motion and
positive parallax are still required; the single-source and station paths are
unchanged. The output's adopted 0 km/s is explicitly not a measurement, and
unknown true radial motion can still cause perspective acceleration.

A static audit of the 11 packaged Gaia region manifests, deduplicated by
`source_id`, found 73,160 rows. Of these, 70,368 met the current batch's other
solution, position, proper-motion and positive-parallax input conditions;
60,580 (86.1%) lacked catalog RV. This indicates a potential increase from
9,788 otherwise-eligible rows to 70,368 before runtime/SOFA rejections or field
clipping. It is a count for the packaged regions, not a full Gaia census or
successful propagation/rendering evidence. The Gaia chart also reports the
number of unique processed rows using the assumption, while per-source flags
remain in compact/exported receipts. The browser cross-checks each flag against
the verified row's RV availability using a one-byte/source vector; at the
30,000-row chunk ceiling this adds 30,000 bytes alongside the existing 240,000
byte G-magnitude vector. Focused Go and compact-receipt regressions
were added but deliberately not run. Source inspection, official-documentation
review and local manifest/chunk data reconciliation only; no tests, typecheck,
build, benchmark, browser/device run, CI wait, deployment, release, commit or
push ran.
