# Current-state and point-pipeline measurements

These measurements distinguish selected identities, precise SPK states,
approximate fallback positions and actual rendering. They are not a claim that
all known Solar System bodies have precise states or that a memory tier guarantees
smooth rendering. Source identity and valid epochs remain scientific requirements.

## Equal-work current-state CPU comparison

Run `npx vitest run --config vitest.focus-benchmark.config.ts` from the repository.
The reproducible harness loads the original Pages-window SPK files, warms ten
epochs, then alternates the order of baseline and optimized evaluations for 80
epochs starting at UTC JD 2461287.5, stepping 0.001 days. It compares every output
component and missing-body ID at each epoch.

Baseline: separate absolute resolver for each reference, plus the previous
quadratic missing-ID scan. Optimized: one same-epoch resolver shared by Saturn
and Titan reference frames, with linear missing-ID membership. Both variants
process the **same complete selection**, without imposing the old 160-object prefix.

Observed on the development Windows host, 2026-09-05:

| Selection | SPK / fallback / missing | Baseline P50 / P90 (ms) | Shared P50 / P90 (ms) |
|---|---|---|---|
| 160 Saturn-system objects | 160 / 0 / 0 | 1.39 / 1.64 | 0.67 / 0.87 |
| 294 Saturn-system objects | 293 / 0 / 1 | 2.57 / 2.79 | 1.17 / 1.37 |
| 510 built-in objects | 508 / 1 / 1 | 5.72 / 6.43 | 2.18 / 2.48 |

Manifest: `jpl-satellite-expansion-20260904-pages`. This measures Node CPU work
after kernel loading, not React layout, historical trajectories, GPU frames,
network, kernel memory or phone performance. Wall-clock values vary by host/load;
do not make these numbers brittle CI thresholds. Numerical equality is asserted.

## Browser coverage regression

The real desktop/mobile Chromium Saturn test retains all 294 selected IDs and
verifies 293 current SPK positions, one explicit missing state, bounded detailed
meshes, and extra positions in one fixed-pixel GPU point buffer. It also checks
80-row object-list pagination without dropping selection, two reference frames,
and switching both frames to 2D without reducing current-position counts.

Historical trails remain bounded separately (160 in 3D, 320 in 2D); focusing an
object prioritizes its trail. A skipped trail budget is not a missing current
state. Extra current-state points are not the approximate MPC catalog cloud.

## Persistent catalog worker

On the same development host, Chromium 152.0.7977.76 ran 80 epochs at 125 ms
intervals using a production worker bundle. The scheduler was imported through
Vite's development server. Each run used real pinned MPC sample records, one
worker and one initialization, completed all 80 computations and reached final
JD 2461079. The final Float32 output was compared component-by-component with
`propagateCatalogElementPositions` at that epoch, with zero mismatches.

| Objects | Element bytes transferred once | P50 / P90 (ms) | Components compared |
|---|---:|---:|---:|
| 8,000 | 512,000 | 2.6 / 3.0 | 24,000 |
| 20,000 | 1,280,000 | 5.8 / 6.4 | 60,000 |
| 30,000 | 1,920,000 | 8.3 / 9.3 | 90,000 |

The previous per-epoch initialization transferred the same element payload 80
times in the retained 80-epoch baseline. The new protocol transfers it once per
record set and sends scalar epoch requests thereafter. These figures exclude
result-buffer transfers and do not measure React or GPU rendering. Because the
old and new benchmark loading paths differ, their latency difference is not an
isolated causal performance comparison. Catalog propagation remains approximate
MPC-element propagation, not a precision upgrade to SPK.

## Complete-system loading under CPU constraints

CI exposed a real cold-loading bottleneck: the complete Saturn scene was still
loading at its existing 60/90-second assertions, despite successful HTTP responses.
Every file start, install and completion previously invalidated the body registry,
repeating current-state evaluation and renderer updates hundreds of times.

The loader now separates loading/error notifications from scientific revision
changes, combines background install notifications in a 100 ms window and flushes
terminal successful state before returning. Initial loading is published immediately.
Direct kernel installation still invalidates immediately; four-way concurrency,
checksums, error reporting and overlapping-request deduplication are preserved.
Preset tests wait for the requested scene's loader and computation, not unrelated
background network silence. Existing deadlines and exact position counts remain.

Local production Chromium 152 with ANGLE SwiftShader and synthetic 4× CPU throttling
gave the following observed runs with the same 294 selected identities and epoch:

| Implementation | Time to 293 valid positions | Script CPU time | Main-thread long tasks |
|---|---:|---:|---:|
| Per-file revision updates | 45.33 s | 40.63 s | 304 |
| Batched 100 ms updates | 9.58 s | 5.47 s | 41 |

Both runs retained the one missing state and had no browser page errors. This is
a local diagnostic comparison, not a repeated statistical benchmark, a hardware
memory-tier guarantee, or proof of physical-device performance. It measures time
to complete current-position coverage, not completion of historical trajectories.
The baseline's Resource Timing buffer capped network observations; those partial
network counts are not used to claim a network-throughput improvement.

## Remaining measurement boundaries

### Prepared catalog propagation and cooperative work (2026-09-23)

The production point worker now validates each source element set once and
retains Float64 rotation/scale coefficients. It yields through a message channel
between 20,000-row preparation/compute blocks. Reset or replacement invalidates
the old generation before it can publish a result. This does not change the MPC
two-body model, the UTC-to-TT conversion or the current fixed display samples.

The local benchmark verified all 313 binary shards against the immutable MPC
release checksums, covering 1,561,171 actual records. No replicated synthetic
orbit was substituted. Seven measured runs followed a warm-up at each size;
both CPU implementations allocated one new Float32 output per run. Input and
implementation digests, host information, every timing and output digests are
retained in the [before](benchmarks/catalog-points-cpu-before-20260923.json) and
[after](benchmarks/catalog-points-cpu-after-20260923.json) reports.

| Actual records | Before CPU median ms | Prepared CPU median ms | Production Chromium worker median ms |
| ---: | ---: | ---: | ---: |
| 30,000 | 5.14 | 3.61 | 5.40 |
| 100,000 | 16.70 | 11.89 | 17.50 |
| 300,000 | 49.59 | 35.03 | 52.80 |
| 1,000,000 | 169.53 | 119.53 | 173.40 |
| 1,561,171 | 261.14 | 186.02 | 275.20 |

The CPU reduction in this run is approximately 29%. Final Float32 output hashes
match at every measured size. This agreement checks numerical equivalence of
the visualization path, not physical accuracy. The independent browser column
includes worker message/transfer/cooperative scheduling and uses UTC inputs
converted to TT; it is not a before/after causal comparison with the Node rows.
Seven samples support a median/range, not a reliable latency-tail estimate.

The [isolated Chromium worker report](benchmarks/catalog-worker-chromium-20260923.json)
records production-bundle measurements with the same complete source inventory.
At the full count, reset after the first progress message produced an empty new
job in 3.6 ms and no stale full result. Every final browser output hash matched
the original propagator evaluated independently at the same TT epoch. A 16 ms
main-thread heartbeat had P95 17.1 ms and P99 17.8 ms over 252 observations.
Those are timer intervals, **not
rendered frames**. The harness loads source bytes separately from production
catalog loading; it does not establish streaming, first-visible time, GPU
upload costs, app peak memory, mobile hardware throughput or million-body FPS.

The preparation tradeoff is explicit: retained worker elements increase from
64 to 80 bytes per record (124,893,680 bytes at the full count), replacing six
per-epoch trigonometric rotations with prepared coefficients. Initialization
temporarily also holds the original input. Prepared data is a display-compute
cache, not a replacement scientific source. At that checkpoint each 3D result
was a new 12-byte-per-record transferable buffer. The later Float64 checkpoint
below increases this to 24 bytes. Inter-frame buffer recycling remains future
work. Range-based evaluation also accepts caller-owned output without allocating
another result buffer, tested separately.

Reproduce CPU measurements with
`rtk proxy node --experimental-strip-types scripts/benchmark-catalog-points.mjs`.
For a baseline, retain the earlier `catalogPoints.ts` and `kepler.ts` together
and pass `--module <baseline-directory>/catalogPoints.ts`. Run the isolated
browser measurement after a production build with
`rtk proxy node --experimental-strip-types scripts/benchmark-catalog-worker.mjs`.
Both write local reports;
neither publishes data nor deploys the application.

Full React/GPU allocation and frame-time comparisons, large catalog selection
stress and actual Android/iOS device tests must be
reported separately. A passing CPU harness or browser correctness test does not
establish those outcomes.

### Two-dimensional catalog GPU reuse (2026-09-23)

The catalog page previously recompiled shaders and recreated its three GPU
buffers on every position/appearance/radius change. Resize callbacks uploaded
positions, colors and sizes again. It now owns one renderer per mounted canvas
and live WebGL context: changed positions use `bufferSubData` at the same count,
while unchanged attributes and uniform-only changes require no attribute upload.
Count changes replace the backing stores at their exact sizes; smaller selections
do not retain a former large allocation. Context restoration deliberately creates
new resources and reuploads the latest snapshot because former WebGL resources
are invalid after loss. See the [WebGL update API](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/bufferSubData)
and [context restoration requirements](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event).

Colors retain their Float32 RGB values. Opacity is one uniform instead of a
duplicated fourth component, reducing appearance attributes from 20 to 16 bytes
per point. Including the two-dimensional position buffer, that is 24 bytes per
point instead of 28, before driver overhead. These are array byte counts, not
measured total GPU/process memory. No frame-rate claim is made for this change.

The focused production-build browser test instruments actual WebGL calls with
three synthetic input records. Desktop/mobile Chromium, Firefox and WebKit retained one program,
three buffers and three initial uploads across an epoch update and resize; the
epoch update made one position upload. Actual `WEBGL_lose_context` restoration
created exactly one replacement set, rendered non-background point pixels and
recorded no WebGL errors. Navigation released both sets. The CI test attaches
`catalog-gpu-lifecycle.json` with the counts and scope. Resource-failure/shrink
unit tests are mock contract evidence. Neither proves million-body rendering.

### Float64 catalog snapshots and relative GPU positions (2026-09-23)

The worker now transfers heliocentric coordinates as Float64. Each reference
pane subtracts its own origin before converting to Float32 GPU attributes. The
3D point object no longer subtracts a large origin later in its GPU model
transform; 2D projection likewise receives the unrounded coordinates. The
heliocentric catalog map explicitly converts its zero-origin positions once
per snapshot. GPU attribute capacity and color reuse remain unchanged.

A synthetic circular orbit of radius `100 + 1e-7` AU illustrates the former
loss: absolute Float32 rounds its perihelion x coordinate to 100 AU, leaving
zero after subtracting a 100 AU reference. The new path preserves the small
relative displacement. Tests cover two independent reference panes, 2D clip
projection and source preservation. Another 513-orbit numerical test agrees
with the existing scalar evaluator within 64 machine-epsilon times the orbital
scale. This bounds numerical disagreement for those cases, not physical orbit
uncertainty. The MPC two-body model and source epochs are unchanged. Camera
recentring at an arbitrary distant focus remains separate from this
reference-relative conversion.

The cost is explicit: transferred/retained snapshot positions rise from
8 to 16 bytes per point in 2D, and 12 to 24 bytes in 3D. At the complete count,
the 3D array is 37,468,104 bytes rather than 18,734,052. The 2D catalog map also
holds its Float32 upload array; GPU storage still uses Float32. This does not
establish a total process-memory budget or buffer recycling.

The [Float64 production-worker report](benchmarks/catalog-worker-float64-chromium-20260923.json)
revalidates all 313 source shards and all five real-input tiers:

| Actual records | Worker median ms | Maximum of seven runs ms |
| ---: | ---: | ---: |
| 30,000 | 5.5 | 7.7 |
| 100,000 | 17.9 | 18.9 |
| 300,000 | 53.4 | 53.7 |
| 1,000,000 | 178.9 | 198.8 |
| 1,561,171 | 281.6 | 285.8 |

These runs were separate from the earlier Float32 measurements; their difference
is not an isolated causal speed comparison. Every final snapshot, rounded to
Float32 solely for compatibility checking, has the same hash as the original
propagator at the same TT epoch. The report also records the actual Float64
hashes and byte counts. Reset-to-empty response was 2.9 ms, with no stale result.
The main-thread timer recorded P95 17.1 ms, P99 31.1 ms and maximum 60.1 ms over
262 samples, including the benchmark's hash work. These are not GPU frame
timings and do not prove large-inventory application rendering performance.

Eight targeted production-browser checks passed across desktop/mobile Chromium,
Firefox and WebKit, covering the new result byte counts, 2D/3D switching,
persistent catalog GPU resources and context restoration. The checks use
synthetic records. The required broader capacity/rendering work remains open.

### Isolated software-renderer capacity (2026-09-23)

The [synthetic WebGL report](benchmarks/catalog-gpu-swiftshader-chromium-20260923.json)
uses the actual `createCatalogPointRenderer` implementation, with syntax-only
TypeScript transpilation. It draws a deterministic dense disk at 1280×720,
pixel ratio 1 and 1.7-pixel point size. Two position snapshots alternate at a
requested 200 ms interval; colors and sizes stay resident. Each tier warms up
for eight frames, then measures up to 180 animation-frame callbacks or eight
seconds. The renderer reported **ANGLE SwiftShader**, a software implementation,
not a physical GPU. These are isolated headless callback timings, not displayed
FPS or full application capacity.

| Synthetic points | Callback interval P95 / P99 ms | Observed callback rate Hz | Position upload submission P95 ms |
| ---: | ---: | ---: | ---: |
| 30,000 | 16.8 / 16.8 | 60.0 | 0.4 |
| 100,000 | 16.7 / 16.8 | 60.0 | 0.3 |
| 300,000 | 16.7 / 16.8 | 60.0 | 0.4 |
| 1,000,000 | 50.1 / 50.1 | 21.4 | 0.6 |
| 1,561,171 | 83.4 / 83.4 | 14.0 | 1.0 |

Upload timings measure CPU submission, not GPU execution. `gl.finish` is used
only for separate first-draw and final-drain wall times; shader/program creation
is outside the first-draw timer. Those synchronized times must not replace the
callback intervals or be presented as GPU timer-query measurements.

Every tier retained exactly three GPU buffer allocations and updated only the
position buffer. Non-background probe pixels and no WebGL errors were verified.
The full-count attributes occupy 37,468,104 bytes; the two synthetic position
arrays plus appearance occupy 49,957,472 CPU bytes. Neither includes driver,
browser, transient, source-element or React memory. No total RSS measurement or
memory ceiling is established.

This software path loses callback cadence above 300k in this workload. It is
evidence for adaptive draw budgets and spatial LOD, not a universal 300k limit.
Other hardware GPUs, native devices, high pixel-ratio, three-dimensional comparison,
real full-inventory streaming and simultaneous orbital computation remain open.
The current production sample limits have not been raised from this harness.

Reproduce with a new report path (existing reports are never overwritten):

```sh
rtk proxy node scripts/benchmark-catalog-gpu.mjs --output .cache/catalog-gpu-new.json
```

### Verified NVIDIA D3D11 rendering (2026-09-23)

A separate [hardware report](benchmarks/catalog-gpu-rtx5070ti-chromium-20260923.json)
used the same renderer and synthetic workload with the
[Chromium channel's new headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode)
and `--use-angle=d3d11`. Its unmasked renderer identified the NVIDIA GeForce
RTX 5070 Ti through Direct3D11, matching the local Windows video-controller
inventory (driver 32.0.16.1088). Hardware mode rejects missing renderer identity
or recognized software fallback instead of labeling that result hardware.

All five tiers completed 180 measured callbacks near 60 Hz. At 1,561,171 points,
callback P95/P99 were 16.8 ms and position-upload CPU submission P95 was 1.0 ms.
The first upload/draw/finish took 16.3 ms, excluding program creation. Buffer
counts, non-background pixels and WebGL error checks passed. This establishes
one discrete-GPU result for the standalone synthetic two-dimensional renderer.
It does not establish full-product FPS, native/device coverage, real catalog
streaming, total memory use or simultaneous worker computation. The earlier
software run used a different Chromium mode, so their ratio is not a controlled
GPU-only speedup measurement.

Together with the real-input worker's 281.6 ms full-count computation, these
separate measurements motivate keeping scientific updates and render cadence
independent while exposing the displayed epoch. They are not a combined-system
benchmark and do not justify silently presenting stale positions as current.

```sh
rtk proxy node scripts/benchmark-catalog-gpu.mjs --graphics d3d11 --output .cache/catalog-gpu-hardware-new.json
```

### Full-source application snapshot (2026-09-23)

The Catalog workspace now offers an expanded map with a requested point limit,
a separate map radius, explicit refresh time, cancellation and partial-coverage
status. The default sample remains available. Unlike the earlier isolated
harnesses, this path reads the real release from inside the built application:
the worker loads checksums, the compact index and binary orbital shards without
hydrating metadata objects for every body. Name filters use the existing exact
search locators; unsupported locator contracts fail visibly.

Four source shards may be in flight. Initially an upload acknowledgement gated
each next shard, keeping one computed tile awaiting the main thread. The main
thread uploads only its new ranges into three fixed-capacity GPU buffers. It
retains Float32 attributes for context restoration; the worker discards a
shard's prepared Float64 orbit coefficients after its fixed-epoch computation.
UTC converts to TT once per scan; pre-1972 requests fail explicitly. The source
precision and two-body model are unchanged. Hashes are checked against the
release's same-origin checksum list, whose identity is recorded in benchmarks;
that list is not an independently signed trust anchor.

The admission plan reserves index/transfer scratch and 48 bytes per requested
point for CPU/GPU attributes. Conservative device hints select a 64/128/256 MiB
explicit-buffer budget. A source index that does not fit is rejected before
starting a worker. This is not a measured process-memory bound: browser/driver
allocations, optional name-search metadata, garbage-collector timing and the
rest of the application have separate lifetimes. Names and full metadata are
not needed by the unfiltered cloud. Oversized requested clouds are capped and
the actual capacity is visible. Source-order truncation is labeled partial,
never a representative sample. Spatial LOD is still pending.

The [NVIDIA application report](benchmarks/catalog-stream-app-rtx5070ti-20260923.json)
and [SwiftShader application report](benchmarks/catalog-stream-app-swiftshader-20260923.json)
both loaded all **1,561,171 rows in 313 shards** at UTC JD 2461306.5. The
benchmark explicitly widens scientific filters to include the complete source,
then uses an independent 8 AU map radius. Offscreen points count as submitted,
not visible. The reports pin the manifest, checksum list and implementation
hashes and verify actual rendered pixels and absence of page/WebGL errors.

| Actual application renderer | Complete snapshot ms | Callback P95 / P99 ms | Main-thread long tasks |
| --- | ---: | ---: | ---: |
| NVIDIA RTX 5070 Ti / D3D11 | 5,443.1 | 16.8 / 16.8 | 0 |
| ANGLE SwiftShader | 13,255.8 | 66.7 / 83.4 | 112, maximum 76 ms |

Both runs used local HTTP with caches disabled and observed at most four active
binary responses. Exactly 99,914,944 orbital bytes were served; there were 315
expanded artifact requests including index/checksums and no metadata/sample
requests. Each allocated and uploaded 37,468,104 GPU attribute bytes through
three buffers and 939 incremental uploads. GPU resource loss, restoration,
cancellation, refresh, filter invalidation and view-radius changes are also
covered by focused tests in all four supported browser profiles.

These results establish the first full-inventory **static 2D application
snapshot**, not continuous simulation, physical-display FPS or public-network
throughput. The two browser modes differ, so their ratio is not a controlled
GPU-only speedup. The software result demonstrates a real loading-cadence limit
and does not justify enabling full inventory by default. Continuous clock
updates, 3D integration, spatial/time/error budgets, upload batching, prepared
state reuse, process memory and native/mobile hardware evidence remain open.

```sh
rtk npm run build
rtk proxy node scripts/benchmark-catalog-stream.mjs --graphics d3d11 --output .cache/catalog-stream-new.json
```

### Bounded upload batching (2026-09-23)

The producer now has four independent transfer credits. It stops computing
when all four are waiting for upload and cannot declare completion until the
last acknowledgement returns. The main thread consumes ready tiles within a
3 ms budget, checked between source tiles, and draws the cumulative cloud once
per batch. A slow individual tile or GPU draw can exceed this budget; it is not
a guaranteed frame deadline. Network admission remains four shards. Duplicate
or unknown acknowledgements cannot add credits. Cancellation releases blocked
producers and discards pending main-thread tiles. Screen-reader announcements
now follow status changes rather than every progress-count update.

The [batched NVIDIA report](benchmarks/catalog-stream-batched-rtx5070ti-20260923.json)
and [batched SwiftShader report](benchmarks/catalog-stream-batched-swiftshader-20260923.json)
use the same complete MPC input, fixed UTC epoch, view radius and viewport as
the preceding application runs:

| Renderer | Earlier / batched load ms | Earlier / batched draw calls | Batched callback P95 / P99 ms | Earlier / batched long tasks |
| --- | ---: | ---: | ---: | ---: |
| NVIDIA RTX 5070 Ti / D3D11 | 5,443.1 / 1,518.8 | 315 / 81 | 16.8 / 16.8 | 0 / 0 |
| ANGLE SwiftShader | 13,255.8 / 3,738.9 | 315 / 81 | 83.3 / 83.4 | 112 / 32 |

These are separate local runs, not repeated-run statistical estimates. Both
new runs establish a peak of four unacknowledged tiles and four active binary
responses. The first nonempty draw was submitted after 200.1 ms on D3D11 and
229.1 ms on SwiftShader; this is not first physical-display presentation.
The exact source count, three allocations, 37,468,104 uploaded bytes, final
rendered pixels and absence of page/WebGL errors are preserved. Incremental
attribute uploads remain 939: the optimization removes redundant cumulative
draws rather than skipping source records or reducing numeric precision.

Software long tasks fell in number but the worst observed task was 81 ms and
callback P95 did not improve. The full software-rendered cloud is still unsuitable
for an assumed 60 Hz continuous view. Spatial LOD and measured adaptive draw
budgets remain required. A four-browser test withholds real worker upload
acknowledgements and verifies four-tile saturation, no early completion and
complete eight-shard recovery after acknowledgements resume. Unit checks also
cover duplicate/out-of-order acknowledgements, concurrent producers, send
failure, cancellation and the final partial window.

### Spatial representatives over full-source snapshots (2026-09-23)

Expanded snapshots now default to a bounded visual selection: one deterministic
source row per occupied projected screen cell. The representative with the
smallest mixed row-index hash wins, avoiding a simple early-source prefix.
The grid respects the requested display limit and view aspect; point centers
outside the current view are omitted. Selection uses the Float32 coordinates
already destined for display. Source propagation and transport remain Float64.
This is a visual simplification, **not a density-preserving sample or an event
probability calculation**. The loaded count and complete/partial source status
remain separate from the displayed count and number of points inside the view.

The worker retains visual coordinates after loading or cancellation so radius
and detail changes do not reload source files. Selection yields every 20,000
rows, superseded requests cancel, and the main thread rejects obsolete results.
Same-view source additions keep the previous partial image until replacement
indices arrive. A view change clears the old representatives. The complete
attributes remain resident; one reusable Uint32 element buffer selects the
displayed rows. Switching to all points uses the same source buffers immediately.
Restored GPU contexts rebuild their attributes and request fresh indices.

The explicit allocation plan now reserves 72 bytes per loaded point: 48 for
CPU/GPU source attributes, 8 for worker display positions, and 16 for selection
scratch and CPU/GPU indices. Fixed source/transfer reserves remain additional.
This is still an array/GPU planning bound, not measured total browser or driver
memory. The worker is released on navigation or source/filter replacement.

The following separate local runs used the same production build, complete MPC
source, fixed UTC epoch, 8 AU radius, 100k representative limit and **545 by 698
pixel canvas**. The map height no longer stretches with its controls. Earlier
reports used a taller canvas and should not be treated as a controlled comparison
with this table. The benchmark now makes an explicit final capture draw and
records source-attribute and spatial-index bytes separately.

| Renderer and detail | Loaded / final submitted points | Snapshot ms | Callback P95 / P99 ms | Long tasks |
| --- | ---: | ---: | ---: | ---: |
| [SwiftShader, all points](benchmarks/catalog-stream-spatial-comparison-all-swiftshader-20260923.json) | 1,561,171 / 1,561,171 | 3,553.5 | 66.7 / 83.4 | 30 |
| [SwiftShader, representatives](benchmarks/catalog-stream-spatial-indexed-swiftshader-20260923.json) | 1,561,171 / 34,505 | 1,536.8 | 16.8 / 16.8 | 0 |
| [NVIDIA D3D11, representatives](benchmarks/catalog-stream-spatial-indexed-d3d11-20260923.json) | 1,561,171 / 34,505 | 1,550.0 | 16.8 / 16.8 | 0 |

Every run checked all 313 shards, loaded all source rows, observed four network
requests and four transfer credits at peak, uploaded 37,468,104 source attribute
bytes through 939 range updates, rendered non-background pixels and reported no
page/WebGL errors. Representatives used 138,020 final/peak index bytes, with
894,404 total index upload bytes on SwiftShader and 904,076 on D3D11. First
nonempty draw submission occurred at 204.6 and 221.0 ms respectively. On
SwiftShader, total submitted vertices across loading fell from 64,352,342 to
1,836,111; all source rows still underwent computation and attribute upload.

These one-off local measurements do not establish a statistical tail estimate,
public-network throughput or physical-display FPS. The 16.8 ms callback result
belongs to a **34,505-representative display**, not simultaneous display of all
1.56 million rows. Hardware and software browser modes differ. The reports pin
the implementation before the later stale-selection/context-loss correction;
that correction was verified separately using actual browser context loss.
Continuous/3D updates, adaptive time/error budgets, total process memory and
native/mobile hardware remain unverified.

```sh
rtk npm run build
rtk proxy node scripts/benchmark-catalog-stream.mjs --detail spatial --output .cache/catalog-spatial-new.json
rtk proxy node scripts/benchmark-catalog-stream.mjs --detail spatial --graphics d3d11 --output .cache/catalog-spatial-hardware-new.json
```
