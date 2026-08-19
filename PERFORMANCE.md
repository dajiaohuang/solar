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
| Decoded detail-shard LRU | 8 | loader constant and unit coverage |
| Obsolete scan cancellation | 300 ms | persistent worker yields at progress checkpoints and accepts explicit cancellation |

Run the repeatable catalog benchmark with:

```bash
npm run benchmark:catalog
```

When a v3 dataset is installed, the command measures its compact index and reports actual sample sizes. Without one, it scans a deterministic 1.55-million-row synthetic index so code-path regressions remain visible in development.

The timing is a local diagnostic, not a cross-machine performance guarantee. Release acceptance is based on the byte, object-count, request-count, and cancellation budgets above.

## v0.9.0-beta.1 reference run

Measured on 2026-08-20 with `mpcorb-919b585f403b185a-full` (1,557,710 valid objects):

| Metric | Result |
| --- | ---: |
| Compact index | 35.65 MiB |
| Full numeric index scan | 58.17 ms |
| Desktop first-screen sample | 11.34 MiB / 30,000 records |
| Mobile first-screen sample | 3.00 MiB / 8,000 records |
| Explorer catalog sample transfer | 0 bytes / 0 requests |

Explorer does not download either sample or the 35.65 MiB index. Catalog and Element Space fetch a cached route-level sample; the compact index is fetched only for an exact scan, and visible exact results are hydrated by bounded row locators.
