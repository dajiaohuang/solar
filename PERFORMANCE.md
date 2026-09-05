# Performance budgets

Solar Atlas treats the million-object catalog as a columnar filtering problem, not as a million JavaScript objects or meshes. The Observation Deck uses two deliberately separate render layers:

- **Focus layer:** named, selectable bodies with trajectories, labels, inspection, and analysis. The limit is 160 bodies in 3D and 320 in 2D.
- **Catalog cloud:** an optional single-buffer point cloud generated in a worker. It is off by default, so opening the Observation Deck requests no asteroid sample. Enabling it reuses the immutable mobile or desktop sample already identified in the scene URL.

The application opens in 3D and falls back to 2D if WebGL is unavailable or lost. On an untouched first visit, a lightweight spatial preview sits behind the tutorial choice and the interactive Three.js renderer chunk is downloaded and initialized only after the visitor chooses a path; returning visits initialize 3D directly. An idle paused 3D scene renders on demand. Continuous drawing runs for the playing catalog cloud, or for backend exact-state playback and pointer/wheel interaction as described below. The renderer does not retain its drawing buffer.

## Runtime point budgets

These are point counts, not focus-body or dataset-size limits. A split comparison view shares one total budget between both panels.

| Device profile | 2D Auto | 3D Auto | 3D Balanced | 3D Maximum |
| --- | ---: | ---: | ---: | ---: |
| Conservative mobile (≤4 GB hint) | 8,000 nominal initial; 2,000–8,000 | 4,000 initial; 2,000–8,000 | fixed 4,000 | 6,000 initial; 2,000–10,000 |
| Mobile target | 100,000 initial; 25,000–500,000 | 100,000 initial; 25,000–250,000 | fixed 75,000 | 150,000 initial; 25,000–250,000 |
| Desktop default | 250,000 initial; 50,000–1,250,000 | 250,000 initial; 50,000–750,000 | fixed 250,000 | 500,000 initial; 50,000–1,567,193 |
| Desktop higher-memory ceiling | 250,000 initial; 50,000–1,567,193 | 250,000 initial; 50,000–1,567,193 | fixed 250,000 | 500,000 initial; 50,000–1,567,193 |

Viewport width selects mobile or desktop first; a coarse-pointer landscape device up to 1,180 px remains mobile. A ≤4 GB browser memory hint selects the conservative mobile tier. CPU concurrency never implies physical RAM. A finite memory hint of at least 24 GB may raise the desktop Auto ceiling, but never its initial count or minimum. Maximum can explore the larger desktop ceiling even without that hint. Low-memory/low-concurrency hints may reduce adaptive initial counts further. Both renderers cap device pixel ratio.

2D Balanced is fixed at 8,000 conservative-mobile, 100,000 mobile or 500,000 desktop points. 2D Maximum starts at 8,000 / 150,000 / 500,000 respectively, with ranges 2,000–10,000 / 25,000–500,000 / 50,000–1,567,193. Its adaptive state is independent from 3D. These are catalog-cloud policies, not an exact-current-state admission controller.

Auto and Maximum evaluate two-second frame windows after a two-second warm-up in both modes. 3D reports its draw-loop intervals; 2D samples animation-frame delivery while its clock-driven workload is active. Neither is a GPU timer or a physical-device SLO. Two consecutive slow windows (p90 above 28 ms or more than 15% long frames) reduce the count by 25%; four consecutive fast windows (p90 below 18.5 ms and fewer than 5% long frames) raise it by 12.5%, but only if loaded points exercise the current budget. Adjustments use 5,000-point quanta and a five-second cooldown. Hidden tabs, paused simulations, and warm-up periods do not influence the controller. Balanced is a deterministic fixed-count option.

The raised ceilings are capacity envelopes for the single-buffer renderer, not proof that the current 8,000/30,000 display samples contain that many points or that every target device is smooth. The active count remains capped by loaded data, and real-device p90 frame time, dropped frames, memory, thermal state and context-loss evidence are required before making a hardware smoothness claim.

The scene URL records the immutable catalog sample, whether the cloud is enabled, and the requested quality profile. It intentionally does not record the locally effective adaptive point count. A comparison gives both frames the same deterministic prefix and discards any unshared remainder. This preserves scientific replay while allowing each browser to protect interactivity.

## Android exact-state display controller

Android's current-state budget is independent of the Web catalog-cloud policy:
3D initial 100K/max 250K, 2D initial 250K/max 500K, minimum 25K each. An active gesture
temporarily enables continuous GL rendering; idle/hidden/paused views stop
continuous work. The bounded sampler uses actual GL callback intervals,
two warm-up intervals and 12–120 samples over roughly one second. It reports
p50/p95 and estimated missed 60 Hz slots, not GPU/compositor timings.

Two windows with p95 > 18.5 ms or missed-slot ratio > 5% reduce 25%; p95 > 33.3 ms or
ratio > 20% reduces after one. Four windows with p95 <= 16.7 ms and ratio < 2% grow
about 12.5% in 5,000-point steps only when loaded exact candidates exercise the
budget. A five-second cooldown separates ordinary adjustments. API 29+ severe
thermal or foreground memory warnings cap 25K immediately; moderate thermal
caps the initial limit and blocks growth. Recovery never restores a high limit
without measured headroom. Repeated memory warnings at the minimum reset the
cooldown and growth evidence. Mode/lifecycle transitions reset evidence; limits
and controller state remain separate between 2D/3D. Coalesced callbacks and
generation/PreparedPoints identity checks prevent old samples or prepared
buffers from changing a newer observation. The Float64 scientific frame remains
independent of the deterministic reference-first display prefix.

Unit and small real-SPK emulator checks are not target-load SLO evidence.
Physical 12 GB Android, 16/32 GB desktop, 60-second frame targets, 30 FPS fallback,
decode/tile-latency feedback and full native/GPU memory measurements remain
pending. Web exact-state and iOS adaptive control are not implemented by this
Android controller. See [MOBILE.md](./MOBILE.md) for scope and runtime checks.

## Web exact-state display controller

The verified backend layer now has a separate controller from the approximate
catalog cloud. It reuses the documented device/mode candidate envelopes, keeps
2D and 3D counts independent across mode switches, and splits **capacity**, not
the available sample, between comparison panes. The same selected-reference /
focus-priority source prefix is used in both frames. All source states, audit
rows, gaps and exact requests are retained regardless of the display limit.
The Deck reports verified received states separately from drawn states; a
missing reference can therefore yield zero displayed but nonzero exact states.
Budget-only changes do not auto-reframe the 3D camera; initial framing retains
the full source extent. Fixed-pixel point materials remain unchanged.

During playback or pointer/wheel interaction, the mounted renderer draws and
reports callback intervals. Hidden/idle rendering contributes no headroom
evidence. The 2D loop reuses uploaded buffers, rather than re-uploading static
geometry on each measured draw. Windows discard two warm-up intervals, retain
12–120 samples over roughly one second, and expose p50/p95 and estimated missed
60 Hz slots. Two slow windows (p95 > 18.5 ms or missed slots > 5%) reduce the
limit by about 25%; severe pressure (p95 > 33.3 ms or > 20%) reduces after one.
Four fast exercised windows (p95 <= 16.7 ms, < 2%) grow about 12.5%, with a
five-second cooldown. Even fixed-quality selection can lower under pressure.

These metrics are renderer callback intervals, not GPU queries or compositor
presentation timestamps. JS/native/GPU memory, decode queue and tile-latency
feedback, thermal sensing and explicit 30 FPS degraded mode remain incomplete.
Synthetic policy tests and desktop/mobile-viewport browser lifecycle tests do
not establish 12/16/32 GB physical-device performance or new exact-body coverage.

## iOS pressure-only display limits

Native 3D/2D start at 100K/250K. Foundation thermal notifications lower the
limits to 75K/100K for fair state and 25K/25K for serious or critical state;
UIKit memory warnings lower both to 25K. The current thermal state is read
before subscribing and whenever the viewport becomes active. Repeated warnings
advance the pressure revision even at the floor. Nominal temperature does not
restore high limits; neither do reloads or mode switches in the current view.

Reduction copies only the existing immutable coordinate prefix and releases
its former larger backing array when no longer referenced. It does not rescan
the scientific frame or change the full-source scale/camera. Detached projection
results are clamped again to the current policy before publication. Background
transitions cancel projection tasks and release display coordinates, preserving
the source frame for reprojection on return. Missing-reference projections keep
the count of exact source targets while publishing no coordinates.

This is pressure response, not frame-time adaptation: actual-draw sampling,
automatic growth, GPU/native-memory measurement and device SLOs remain pending.
OS memory warnings are best-effort; retaining scientific source arrays is not
a proof that every full-catalog observation fits memory. See Apple's
[memory warning guidance](https://developer.apple.com/documentation/uikit/responding-to-memory-warnings)
and [thermal notification contract](https://developer.apple.com/documentation/foundation/processinfo/thermalstatedidchangenotification).
Pure Swift policy/prefix tests and real-SPK simulator mode/cache checks are
separate gates from physical thermal-stress and 12/16/32 GB target-load evidence.

## Data and delivery budgets

| Budget | Limit | Enforcement |
| --- | ---: | --- |
| Catalog/Element desktop first-screen data | 15 MiB | dataset validator |
| Catalog/Element mobile first-screen data | 5 MiB | dataset validator |
| Desktop main-thread `AsteroidRecord` sample | 30,000 | precomputed sample manifest + validator |
| Mobile main-thread `AsteroidRecord` sample | 8,000 | precomputed sample manifest + validator |
| Default Observation Deck catalog sample requests | 0 | Playwright network assertion |
| Catalog first-screen full-shard requests | 0 | first screen reads two sample artifacts; locator detail shards are lazy |
| Exact-result locators retained | 2,000 | deterministic worker sample |
| Exact-result hydration per page | 480 records / 32 unique shards | loader paging unit coverage |
| Decoded detail-shard LRU | 8 | loader constant and unit coverage |
| Obsolete scan cancellation | 300 ms | persistent worker yields at checkpoints and accepts cancellation |
| GitHub Pages artifact | 700 MiB maximum / 600 MiB warning | `npm run check:capacity` and deployment gate |
| Initial application shell transfer | reported, regression-reviewed | generated `dist/capacity-report.json` |
| Typical Catalog session transfer | reported, regression-reviewed | shell + compact index + desktop sample + manifest/provenance |
| Lighthouse script transfer | 1,500,000 bytes | deployment Lighthouse CI assertion |
| Lighthouse total first-load transfer | 3,500,000 bytes | deployment Lighthouse CI assertion |
| Third-party first-load requests | 0 | deployment Lighthouse CI assertion |
| Lighthouse total blocking time | 600 ms | median of three deployment runs |
| Lighthouse cumulative layout shift | 0.10 | median of three deployment runs |
| Lighthouse accessibility / SEO | 0.90 minimum | median of three deployment runs |

Run the repeatable checks with:

```bash
npm run benchmark:catalog
npm run check:capacity
```

When a current dataset is installed, the benchmark measures its compact index and reports actual sample sizes. Without one, it scans a deterministic 1.55-million-row synthetic index so code-path regressions remain visible in development.

The local timing is diagnostic, not a cross-machine performance guarantee. Stable byte, object-count, request-count, cancellation, accessibility, and layout budgets are hard release gates. Performance score and largest-contentful-paint thresholds begin as warnings because hosted-runner timing is noisy; their reports are retained for regression review. Real-device profiling remains required before making hardware-specific smoothness claims.

Production uses `npm run build:deploy`. The builder excludes stale releases, copies only the audited active version, keeps binary numeric artifacts byte-identical, and deterministically gzip-compresses large search, lookup, metadata, legacy chunk, and sample JSON. The generated capacity report separates application shell, total dataset, cold-load, and typical Catalog-session bytes; it fails closed above the Pages budget.

## Web state-tile evidence storage

Verified Web tile metadata now retains an interned string table, ten Uint32
string-index columns, four Float64 evidence-window columns and one flag byte
per record. Decoding parses, validates and packs one row at a time rather than
retaining a parsed metadata array. ID/ordinal reads do not materialize evidence objects; `rowAt`
materializes only a requested row and does not cache it. Unknown original IDs
and all validated provenance/window flags remain intact. Availability and
precision come from the verified bitmaps, never optional metadata extensions.
The bounded source-directory inspection reads at most one 50-row evidence page.

The maximum-size synthetic tile regression checks 32,768 rows, 73 typed-column
bytes per row plus interned strings, a 20-row materialization, mutation isolation
and byte-identical Float64 six-vectors. These are structural storage checks,
not total JavaScript heap/RSS, device FPS or astronomical-coverage measurements.
The binary wire format, hash/ordinal checks and scientific values are unchanged.

This is not yet packed delivery end to end: the resolved-state Maps,
reference-frame audit/current-position objects and historical trajectory
unpacking remain to be replaced. Bulk render consumers must ultimately read
typed buffers directly; a full-size object adapter is not the migration target.

## Shared backend tile encoding

Exact-state tiles retain a 64 MiB byte-bounded response cache and two concurrent
encoder slots, behind the server's bounded request admission. Requests for the
same plan and tile sequence share one in-progress encoding and immutable result;
waiters do not allocate another state array or take an encoder slot. Each waiter
can cancel independently. If the owner cancels, healthy waiters may retry under
their own contexts and the same admission limits. Failed or partial results are
not cached. Oversized-to-cache results are shared only with already-joined
waiters and do not raise the resident cache budget.

`TileCacheStats` reports `coalesced` joins and `activeEncodings` alongside resident
bytes/hits/misses to the local benchmark harness, not as a public metrics API.
`activeEncodings` counts outstanding flights; `encoderSlotsActive` and
`encoderSlotsLimit` separately report actual encoder admission. `PlanCacheStats`
reports retained plan items and estimated resident bytes for the memory probe.
This avoids duplicate encoding, not duplicate plan computation, and is not
evidence of real-device throughput. Run the
deterministic cancellation/concurrency and loopback HTTP regressions with
`go test ./internal/httpapi -run 'TestTileFlight|TestHTTPDuplicateTiles'`;
Linux CI also executes the backend race detector.

## Backend request scheduling

Before decoding request bodies or computing states, the service admits at most
its configured worker count and queues at most 32 requests **per class** (96
total). The three FIFO queues use weighted round robin: four interactive grants,
two trajectory grants, then one bulk-directory grant, skipping empty queues.
State plans/tiles, manifests and body/identity details are interactive;
`POST /v1/trajectory` is trajectory work; `GET /v1/catalog`, `/v1/inventory` and
`/v1/identities` are bulk-directory work. Priorities are server-selected, not a
client field. A background precomputation service is not implemented.

Each nonempty class gets a turn within seven grants under contention. This is
non-preemptive admission fairness, **not** a latency guarantee: a running job
or blocked response write still occupies a worker. Full queues reject with
HTTP 429 and `Retry-After: 1`; queued waits expire after five seconds with the
same retry response. An observed request-context cancellation removes the
waiter, returns HTTP 408, and releases any concurrently granted slot. HTTP/1
disconnect detection can be delayed while a POST body remains unread; that
case is bounded by queue expiry, not a claimed immediate disconnect signal.
The two-encoder limit and identical-tile coalescing remain independent.

`SchedulerStats` exposes active/queued limits, peak queued count and per-class
grants, rejections, cancellations, expiries and aggregate wait nanoseconds to
the local benchmark. Grants count reserved slots, including a grant returned
by a racing cancellation; they are not counts of completed science results.
The benchmark reports main-workload and overload-probe scheduler snapshots
separately. A short burst may now queue and succeed instead of returning 429;
zero rejections is not proof that admission limits were exercised.

Run deterministic fairness, boundedness, timeout, cancellation/grant race and
loopback HTTP checks with
`go test ./internal/httpapi -run 'TestRequestScheduler|TestHTTPScheduler|TestOverload'`.

## Isolated single-tile memory probe

Use a fresh process for each case:

```text
go run ./cmd/bench -tile-memory-only -concurrency 1 -data-dir <full-data-dir> -inventory-dir <inventory-dir>
go run ./cmd/bench -tile-memory-only -concurrency 4 -data-dir <full-data-dir> -inventory-dir <inventory-dir>
```

This mode requires 32,768 real source IDs, without synthetic padding. Every plan
must contain **one 32,768-row tile**, unlike the ordinary mixed benchmark's
32,768-row plans containing two 16,384-row tiles. Distinct rotations of the same
IDs at the same epoch produce distinct plan hashes, so concurrent requests
cannot all coalesce into one encoding. The report keeps exact/missing counts
separate; source-record count is not exact-body coverage.

Plans are prepared before the measured phase and must all remain resident. GC
runs before the RSS/heap baseline; the tile cache must be empty. The phase
includes encoding, cache retention, loopback HTTP client buffers, checksum and
header/status verification, and any bounded retries. Four clients start
together, but the server still permits only two concurrent encoders. HTTP 429
retries honor `Retry-After`, with at most four attempts and a 90-second overall
probe deadline. `sampledPeakEncoderSlots` is observed occupancy, not inferred
from client count; a value below two does not prove two encoders overlapped.

RSS/heap are sampled every 2 ms and can miss short peaks. On Windows, the OS
lifetime working-set peak minus the pre-phase working set is reported separately
as `rssIncrementUpperBoundBytes`: a conservative phase-increment upper bound
which can overestimate because it includes earlier startup/plan peaks. Platforms
without that OS metric report the bound unavailable, not zero-cost success.
Heap allocation excludes non-Go memory and is not interchangeable with RSS.
The measurement includes the same-process client and sampler; it does not
isolate server-only allocation, first-use kernel costs, offline loading or
native rendering. In `tile-memory-only` mode other workload fields left at zero
mean **not run**. Raw per-plan counts, byte sizes and payload hashes accompany
the memory report. These are engineering measurements, not universal hardware
guarantees.

Reference probe (Windows amd64, 2026-09-05; one frozen executable, sequential
fresh processes, full 1,567,193-source-record inventory):

| Clients / distinct plans | Rows per single tile | Observed encoder slots | Conservative RSS increment upper bound | Phase including retries |
| --- | ---: | ---: | ---: | ---: |
| 1 / 1 | 32,768 | 1 | 93.87 MiB | 90.0 ms |
| 4 / 4 | 32,768 | 2 | 197.48 MiB | 1,096.5 ms |

Each tile was 19,500,200 bytes and contained 16 exact source records plus 32,752
explicit missing rows. The four-client case had two 429 responses; both succeeded
after one Retry-After wait. All four distinct tiles were verified. Its final
tile cache retained three entries / 58,500,798 bytes, below 64 MiB, with no active
encoders or flights. For these measured warm-plan/cold-tile cases only, the
conservative bounds are below 256 MiB (single) and 1 GiB (four clients). This is not
four simultaneous encoders, an all-exact 32K workload, a physical 16 GB device result
or a guarantee for other metadata/datasets. The executable SHA-256 and raw
reports are retained locally; the catalog/inventory hashes match the startup
reference below. No source data or benchmark executable is committed.

## Backend cold-process startup

Run `go run ./cmd/bench -startup-only -data-dir <full-data-dir> -inventory-dir <inventory-dir>`
to measure catalog and inventory loading without starting the HTTP workload.
The report's `mode` is `startup-only`; zero request-workload fields in this mode
mean **not run**, not a measured zero cost. `startup` separates resident/heap
boundary samples from an OS process high-water mark. The latter is currently
implemented on Windows; other platforms report `processPeakAvailable: false`
instead of substituting an ordinary RSS sample. The normal benchmark also
retains this startup evidence before running its mixed workloads.

A frozen executable was run in three sequential fresh Windows amd64 processes
on an i9-14900KF (2026-09-05), with the same 1,567,193-source-record inventory,
314 shards / 97,111,820 compressed bytes, and 510 packaged SPK candidates:

| Run | Catalog + index startup | OS process peak working set |
| --- | ---: | ---: |
| 1 | 7.682 s | 461.70 MiB |
| 2 | 7.649 s | 424.30 MiB |
| 3 | 7.758 s | 422.55 MiB |

All three observed peaks are below the 512 MiB startup target **for this data,
machine and cold-process workload only**. Filesystem caches were not flushed;
other user processes were not stopped. This does not prove cold-disk latency,
cross-platform memory, first-use integrity costs, concurrent request memory or
native rendering smoothness. All 510 candidates remained pending verification
with zero integrity bytes read; they are not 510 verified current states.

The measured catalog manifest SHA-256 was
`7e7fa1df8080b505abba52cc8ca9a4d8bd6d1c10d47d3e421953e7c1b8494257`;
inventory manifest SHA-256 was
`bef21e3bc5820db0b70c24ad464262cb67df279f8d0a3e2b8731ca5ca9c39583`.
The exact executable SHA-256 and raw reports are retained with local benchmark
evidence; generated datasets and the executable are not committed.

## Reference run

Measured on 2026-08-20 with `mpcorb-919b585f403b185a-full` (1,557,710 valid objects):

| Metric | Result |
| --- | ---: |
| Compact index | 35.65 MiB |
| Full numeric index scan | 58.17 ms |
| Desktop immutable sample | 11.34 MiB / 30,000 records |
| Mobile immutable sample | 3.00 MiB / 8,000 records |
| Default Observation Deck sample transfer | 0 bytes / 0 requests |

Catalog and Element Space fetch a cached route-level sample. The compact index is fetched only for an exact scan. Each explicit exact-result page hydrates no more than 480 row locators from 32 unique shards, while broad-filter point clouds continue to use the cached route sample.
