# Performance budgets

Solar Atlas treats the million-object catalog as a columnar filtering problem, not as a million JavaScript objects or meshes. The Observation Deck uses two deliberately separate render layers:

- **Focus layer:** named, selectable bodies with trajectories, labels, inspection, and analysis. The limit is 160 bodies in 3D and 320 in 2D.
- **Catalog cloud:** an optional single-buffer point cloud generated in a worker. It is off by default, so opening the Observation Deck requests no asteroid sample. Enabling it reuses the immutable mobile or desktop sample already identified in the scene URL.

The application opens in 3D and falls back to 2D if WebGL is unavailable or lost. On an untouched first visit, a lightweight spatial preview sits behind the tutorial choice and the interactive Three.js renderer chunk is downloaded and initialized only after the visitor chooses a path; returning visits initialize 3D directly. A paused 3D scene renders on demand; continuous animation runs only while the clock is playing with the catalog cloud visible. The renderer does not retain its drawing buffer.

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
This avoids duplicate encoding, not duplicate plan computation; it is not yet
a fair priority scheduler or evidence of real-device throughput. Run the
deterministic cancellation/concurrency and loopback HTTP regressions with
`go test ./internal/httpapi -run 'TestTileFlight|TestHTTPDuplicateTiles'`;
Linux CI also executes the backend race detector.

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
