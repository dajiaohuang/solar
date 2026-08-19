# Performance budgets

Solar Atlas treats the million-object catalog as a columnar filtering problem, not as a million JavaScript objects.

| Budget | Limit | Enforcement |
| --- | ---: | --- |
| Catalog/Element desktop first-screen data | 15 MiB | dataset validator |
| Catalog/Element mobile first-screen data | 5 MiB | dataset validator |
| Desktop main-thread `AsteroidRecord` count | 30,000 | precomputed sample manifest + validator |
| Mobile main-thread `AsteroidRecord` count | 8,000 | precomputed sample manifest + validator |
| Initial full-catalog shard requests | 0 | first screen reads two sample artifacts; detail shards are lazy |
| Decoded detail-shard LRU | 8 | loader constant and unit coverage |
| Obsolete scan cancellation | 300 ms | the active worker is terminated synchronously when scan identity changes |

Run the repeatable catalog benchmark with:

```bash
npm run benchmark:catalog
```

When a v3 dataset is installed, the command measures its compact index and reports actual sample sizes. Without one, it scans a deterministic 1.55-million-row synthetic index so code-path regressions remain visible in development.

The timing is a local diagnostic, not a cross-machine performance guarantee. Release acceptance is based on the byte, object-count, request-count, and cancellation budgets above.

## v0.8.0-beta.1 reference run

Measured on 2026-08-19 with `mpcorb-8519a29c850069e0-full` (1,557,710 valid objects):

| Metric | Result |
| --- | ---: |
| Compact index | 35.65 MiB |
| Full numeric index scan | 39.59 ms |
| Desktop first-screen sample | 10.41 MiB / 30,000 records |
| Mobile first-screen sample | 2.75 MiB / 8,000 records |

The first screen does not download the 35.65 MiB index. It is fetched only when an exact catalog-wide numeric count is requested.
