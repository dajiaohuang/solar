# Performance budgets

Solar Atlas treats the million-object catalog as a columnar filtering problem, not as a million JavaScript objects.

| Budget | Limit | Enforcement |
| --- | ---: | --- |
| Catalog/Element desktop first-screen data | 15 MiB | dataset validator |
| Catalog/Element mobile first-screen data | 5 MiB | dataset validator |
| Desktop main-thread `AsteroidRecord` count | 30,000 | precomputed sample manifest + validator |
| Mobile main-thread `AsteroidRecord` count | 8,000 | precomputed sample manifest + validator |
| Explorer catalog sample requests | 0 | Playwright network assertion |
| Catalog first-screen full-shard requests | 0 | first screen reads two sample artifacts; locator detail shards are lazy |
| Exact-result locators retained | 2,000 | deterministic worker sample |
| Exact-result hydration per page | 480 records / 32 unique shards | loader paging unit coverage |
| Decoded detail-shard LRU | 8 | loader constant and unit coverage |
| Obsolete scan cancellation | 300 ms | persistent worker yields at progress checkpoints and accepts explicit cancellation |
| GitHub Pages artifact | 700 MiB maximum / 600 MiB warning | `npm run check:capacity` and deployment gate |
| Initial application shell transfer | reported, regression-reviewed | generated `dist/capacity-report.json` |
| Typical Catalog session transfer | reported, regression-reviewed | shell + compact index + desktop sample + manifest/provenance |
| Lighthouse script transfer | 1,500,000 bytes | deployment Lighthouse CI assertion |
| Lighthouse total first-load transfer | 3,500,000 bytes | deployment Lighthouse CI assertion |
| Lighthouse total blocking time | 600 ms | median of three deployment runs |
| Lighthouse cumulative layout shift | 0.10 | median of three deployment runs |
| Lighthouse accessibility / SEO | 0.90 minimum | median of three deployment runs |

Run the repeatable catalog benchmark with:

```bash
npm run benchmark:catalog
npm run check:capacity
```

When a v3 dataset is installed, the command measures its compact index and reports actual sample sizes. Without one, it scans a deterministic 1.55-million-row synthetic index so code-path regressions remain visible in development.

The local compact-index timing is a diagnostic, not a cross-machine performance guarantee. Stable byte, object-count, request-count, cancellation, accessibility, and layout budgets are hard release gates. Performance score and largest-contentful-paint thresholds begin as warnings because hosted-runner timing is noisy; their reports are retained for regression review.

Production uses `npm run build:deploy`. The builder excludes stale releases, copies only the audited active version, keeps binary numeric artifacts byte-identical, and deterministically gzip-compresses large search, lookup, metadata, legacy chunk, and sample JSON. The generated capacity report separates application shell, total dataset, cold-load, and typical Catalog-session bytes; it fails closed above the Pages budget.

## v0.9.0-beta.1 reference run

Measured on 2026-08-20 with `mpcorb-919b585f403b185a-full` (1,557,710 valid objects):

| Metric | Result |
| --- | ---: |
| Compact index | 35.65 MiB |
| Full numeric index scan | 58.17 ms |
| Desktop first-screen sample | 11.34 MiB / 30,000 records |
| Mobile first-screen sample | 3.00 MiB / 8,000 records |
| Explorer catalog sample transfer | 0 bytes / 0 requests |

Explorer does not download either sample or the 35.65 MiB index. Catalog and Element Space fetch a cached route-level sample; the compact index is fetched only for an exact scan. Each explicit exact-result page hydrates no more than 480 row locators from 32 unique shards, while broad-filter point clouds continue to use the cached route sample.
