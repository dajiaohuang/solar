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
cache, not a replacement scientific source. Each 3D result is still a new
12-byte-per-record transferable buffer; inter-frame buffer recycling remains
future work. Range-based evaluation also accepts caller-owned output without
allocating another result buffer, tested separately.

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
