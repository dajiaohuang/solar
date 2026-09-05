# Reproducible backend performance evidence

The harness exercises the real `httpapi.Server` through an in-process HTTP
server backed by a deliberately selected catalog and audited source inventory. It
measures fresh-process catalog/inventory load, warm catalog latency and throughput,
mixed catalog/trajectory/search traffic, exact source-state lookup at the
declared audit epoch, compact trajectory transport, cancellation, overload
backpressure, allocations and process memory. It does not use a toy catalog
or an empty handler, and the measurements are evidence for the recorded
machine and dataset rather than universal guarantees.

## Historical snapshot identity (pre-tile implementation)

This section preserves earlier measurements, not a supported storage format.
The current reader requires independently compressed inventory v2 blocks;
use the current binary state-tile command below for the current checkout.

The benchmark below uses the retained `inventory-pr94-20260904` snapshot. Its
manifest is 1,567,193 records in 314 gzip shards with 89,626,020 declared
compressed bytes, manifest SHA-256
`99312497b037caae4097b3e663283d1e8fc63799bd5e546e52a2ae3489e1e9c1`, kernel
manifest `5c390d7bb8e02a28ebe45d32979c2f5db12983f8ec6044e4206750c5c89c29e0`,
and identity mapping `6d36c44543bc7f28e2f1696ec8c7e18c7a5ddedc58b51aec25826ad08395188e`.
The separately retained `inventory-20260904-final` snapshot has the same row
and shard counts but 89,588,299 bytes, manifest SHA-256
`e859e463c12323eff3f8318cea3b2640382c32010f7e7137cb924cc06294a8b9`, kernel
manifest `b48c25698085cdf0288442c2e6c8b0bbb5f97deaddbe226cb73bc4bcc5249379`,
and identity mapping `397d23592b3a63a7a174cbb35f0b0c20d238eb076b0c940c64e67c61759e4270`.
They are different point-in-time outputs and must not be combined in a single
claim or benchmark.

Commands recorded for the historical implementation (not the current checkout):

```text
go run ./cmd/bench -requests 500 -concurrency 32 -long-samples 10000 -inventory-dir D:/repo/repostew/.repostew/cache/solar-all-body-coverage/inventory-pr94-20260904
go test -bench 'Benchmark(CatalogIDMapLookup|CatalogPage|Trajectory64Samples|Trajectory64BodyBatch|Trajectory10000Samples)$' -benchmem -benchtime=200ms ./internal/httpapi
go test -race ./...
go test -fuzz FuzzSPKParserNeverPanics -fuzztime=10s ./internal/spk
go test -fuzz FuzzDecodeCursorNeverPanics -fuzztime=10s ./internal/inventory
```

The benchmark trajectory requests set `precision: "approximate"` explicitly:
the checked-in catalog has no packaged binary SPK, so an exact request would
correctly return an empty state array. Exact behavior is measured separately
with `/v1/identities/sb:asteroid:1/state?epochJd=2461287.5`, which uses the
validated source kernel snapshot and reports `availability: "snapshot"`.
Approximate results are never labelled exact. The source-state workload is
run with 100 successful requests; query/detail requests use the same indexed
identity and source row.

Record the complete JSON line together with `go version`, OS/architecture, CPU
model, request arguments and the `manifestSha256` returned by
`/v1/capabilities`. `catalogLoadMs` and `inventoryIndexLoadMs` are fresh-process startup
paths, not proof of a cold operating-system/disk cache. `firstRequestMs`, repeated latency and mixed runs are warm in-process
paths. `peakRSSBytes` is sampled process working set on Windows and `/proc`
RSS on Linux; `peakHeapBytes` remains available on every platform. Go's
benchmark reports authoritative `B/op` and `allocs/op`.

The backend must be measured against an explicitly staged profile. First run
the normal build/data preparation so `public/data/ephemerides` contains the
selected profile, then run `node scripts/stage-backend-profile.mjs
<output-directory> [full|pages]` and start `go run ./cmd/solar-backend
-data-dir <output-directory>`. The staging validator checks all source bytes and
hashes before copying the manifest last; `src/data` alone is source-only
metadata and does not prove that exact kernel files are available. The results
below are retained evidence for their recorded fixtures, not a final profile
performance sign-off; repeat measurements after staging the intended profile.
The recorded full-profile staging check found 510 files totaling
1,147,897,856 bytes; this is an artifact validation result, not a runtime
resident-memory or performance guarantee.

## Current binary state-tile evidence

The current harness uses `-epoch-jd 2461287.5` by default. This is TDB
ET=841,752,000, the audited inventory epoch, and is inside the packaged full
profile coverage; the older `2451545.0` default was outside most packaged
segments and therefore reported only 18 exact catalog rows. Catalog state
tiles use all 552 catalog entries. Source workloads first scan the inventory
index and select a reproducible mixed set containing 16 exact-capable rows and
the remainder missing at this epoch, then measure 16,384 and 32,768 IDs.
Directory-search traffic samples a fixed six-name query set
(`Ceres`, `Halley`, `Europa`, `Sedna`, `Apophis`, `Voyager`) so the run covers
different indexed terms while remaining reproducible.

Run the current evidence with:

```text
go run ./cmd/bench -requests 5 -concurrency 1 -epoch-jd 2461287.5 -data-dir D:/repo/repostew/.repostew/cache/solar-issue109-backend-full-20260905 -inventory-dir D:/repo/repostew/.repostew/cache/solar-issue109-addressable-inventory-20260905 -long-samples 100
```

The 2026-09-05 Windows amd64 run reported catalog 552 entries / 510 manifest-
valid packaged files, catalog exact/missing 552/0, source exact/missing
16/16,368 at 16,384 IDs and 16/32,752 at 32,768 IDs. Lazy integrity evidence
reported 501 verified kernel files, 9 still pending, 0 invalid, 501 full-file
verification reads and 1,135,819,776 verified bytes after the workload. The
catalog SPK page counters are reported separately from those integrity reads;
the warm run recorded 1,252 page loads, 852,574 page-cache hits and 1,252
page-cache misses. A fresh-process catalog load was about 27 ms on that run;
the inventory index load was about 7.7 s. These are host- and filesystem-cache-
dependent observations, not universal startup guarantees.

Successful tile samples are reported separately from `overload429` and
`otherErrors`; with concurrency 1 there were 5, 5 and 10 successful tiles
respectively, with zero overload or other errors. Each state result now reports
plan latency, tile-workload latency, total latency, successful/rejected tile
throughput, separate successful/rejected quantiles, and final-response cache
hits/misses. The response cache is bounded at 64 MiB and shares the two-slot
tile encoder limit. A concurrency-4 run intentionally produced 429
backpressure (3 catalog, 3 per source size); those rejections are reported
separately and are not included in successful latency quantiles.

The catalog manifest SHA-256 was
`7e7fa1df8080b505abba52cc8ca9a4d8bd6d1c10d47d3e421953e7c1b8494257`; the
inventory manifest SHA-256 was
`2c0aca1e6412c6e7785acd901bb987ce0f57c5353e2a8ff87aed032b291377b7`.
In a warm-cache concurrency-1 run, source successful-tile p50/p95 latencies
were 5.808/40.456 ms (16,384) and 17.418/34.641 ms (32,768); these are
transport/encoding measurements for the mixed set, not an SLO or a claim that
every source row is exact. `peakRSSBytes` is explicitly a sampled process RSS
value, not an OS peak. The JSON also records inventory compressed-block cache
hits/misses/loads and the sampled cancellation-observation delay; no hard-device
I/O or universal memory claim is inferred from those counters. The same run
observed the server handler after client cancellation in about 18.5 ms; this is
an in-process cancellation-observation measurement, not an end-to-end network
guarantee.

## Historical JSON/index results (not current implementation claims)

Reference harness run (2026-09-05, Windows amd64, Intel Core i9-14900KF,
full source inventory 1,567,193 rows / 314 gzip shards, 89,626,020 declared
compressed bytes, 552 catalog entries; 100 requests, 16 workers,
5,000-sample long trajectory):

```json
{"goos":"windows","goarch":"amd64","catalogEntries":552,"inventoryRecords":1567193,"inventoryShards":314,"inventoryCompressedBytes":89626020,"inventoryIndexLoadMs":7139.183,"inventoryIndexTerms":4034405,"inventoryIndexPostings":4034430,"trajectoryPrecision":"approximate-opt-in","catalogLoadMs":29.31,"latencyRequests":800,"concurrency":16,"firstRequestMs":0,"p50Ns":124975,"p95Ns":125050,"p99Ns":125075,"minNs":0,"maxNs":125187,"throughputRequestsPerSecond":33334.44448148272,"mixedRequests":100,"mixedP50Ns":1000100,"mixedP95Ns":3999000,"mixedP99Ns":4999600,"exactStateRequests":100,"exactStateP50Ns":1000000,"exactStateP95Ns":1999700,"exactStateP99Ns":2999700,"identitySearchP50Ns":998600,"identitySearchP95Ns":1999700,"identityDetailP50Ns":999400,"identityDetailP95Ns":1999300,"inventoryWorkloadErrors":0,"batchBodies":64,"batchSamples":128,"batchMs":1.999,"longSamples":5000,"longTrajectoryMs":2.001,"longResponseBytes":597239,"overloadRequests":32,"overloadRejected":31,"peakRSSBytes":226906112,"peakHeapBytes":131913800,"allocDeltaBytes":7402024,"totalAllocBytes":7402024,"invalidResponses":0,"cancelledObserved":true,"overloadStatusExpected":429}
```

The compact source index uses stable `recordRef` rows and sorted 64-bit term
postings for exact normalized ID, designation, name and source-alias lookup.
It is bounded at 2,000,000 records, 12,000,000 postings, 10,000 shards and
64 MiB per compressed shard; those limits are exposed by `/v1/capabilities`.
Startup scans each shard once, verifies declared byte counts/hashes while
streaming, then releases the temporary sortable posting buffer before serving
requests. Detail/search reads reopen only the referenced shard rows and stop
once the requested rows are found. There is no unbounded response cache: the
bounded startup index and the operating-system page cache are the only retained
warm data paths.

Historical JSON current-state batch reference run (2026-09-05, same Windows amd64 Intel Core
i9-14900KF host, PR94 inventory snapshot above, 100 requests per size, 16
workers) recorded the following JSON evidence. This is retained as historical
backend evidence only; it is not the current client wire contract. Each request
uses one shared TDB epoch and explicit `precision: "approximate"` for catalog
fallback rows; operational rows remain exact when packaged SPK data is available.

```json
{"currentStateBatches":[{"ids":160,"requests":100,"p50Ns":1000200,"p95Ns":2999400,"p99Ns":4001100,"p50Bytes":36815,"errors":0},{"ids":294,"requests":100,"p50Ns":1051400,"p95Ns":1810600,"p99Ns":2325300,"p50Bytes":65868,"errors":0},{"ids":510,"requests":100,"p50Ns":1046200,"p95Ns":1585200,"p99Ns":2108500,"p50Bytes":110677,"errors":0}],"inventoryIndexLoadMs":10206.074,"inventoryIndexTerms":4034405,"inventoryIndexPostings":4034430,"peakRSSBytes":245587968,"peakHeapBytes":150828048,"cancelledObserved":true,"overloadRequests":32,"overloadRejected":31,"invalidResponses":0}
```

The index-load variation from the earlier run is host/cache noise; both runs
use the same frozen PR94 manifest and posting counts. The batch workload is a
transport/concurrency measurement, not a claim that every source row has an
exact operational state.

The same 100-request run also used the first 510 source identities from the
PR94 inventory (500-row page plus a 10-row continuation), exercising the
grouped `GetMany` shard reader rather than one shard open per ID:

```json
{"currentStateSourceBatches":[{"ids":160,"requests":100,"p50Ns":3000300,"p95Ns":4999400,"p99Ns":4999400,"p50Bytes":47678,"errors":0},{"ids":294,"requests":100,"p50Ns":5999800,"p95Ns":7999200,"p99Ns":9000800,"p50Bytes":87092,"errors":0},{"ids":510,"requests":100,"p50Ns":9001300,"p95Ns":12000000,"p99Ns":12998600,"p50Bytes":150652,"errors":0}]}
```

Source IDs include missing and approximate-only records by design; these values
measure bounded source-row access and transport, not scientific coverage.

The focused inventory benchmark on the same host compared 510 individual
lookups with one grouped `GetMany` call over a synthetic one-shard fixture:

```text
BenchmarkGetManyVsIndividualGet/individual-32        4   51,996,350 ns/op   57,533,508 B/op 15,868 allocs/op
BenchmarkGetManyVsIndividualGet/grouped-32         315      922,807 ns/op      639,574 B/op  6,185 allocs/op
```

Grouped reads were about 56x faster and used about 90x less allocated memory
for this workload; the benchmark is an implementation signal, not a service
SLO.

The direct HTTP benchmarks from the same machine were:

```text
BenchmarkCatalogPage-32                3536      65787 ns/op      75373 B/op 282 allocs/op
BenchmarkCatalogIDMapLookup-32      46340097          5.118 ns/op          0 B/op   0 allocs/op
BenchmarkTrajectory64Samples-32        6308      43236 ns/op      21926 B/op  76 allocs/op
BenchmarkTrajectory64BodyBatch-32       147    1504527 ns/op     659663 B/op 182 allocs/op
BenchmarkTrajectory10000Samples-32       50    4852430 ns/op    3120147 B/op  92 allocs/op
```

The same machine compared candidate one-epoch batch wire shapes using the
same 160/294/510 row counts. Those results are historical serialization
evidence. The current Web and native contract is the fixed little-endian
binary state-tile protocol with manifest/plan identity, provenance and typed
Float64 payloads; see [current-state tile performance](./docs/current-states-performance.md).
The row and columnar JSON measurements below are not supported transport APIs.

| IDs | Columnar JSON | Row JSON | Fixed binary candidate |
| ---: | ---: | ---: | ---: |
| 160 | 28,951 B | 47,517 B | 9,766 B |
| 294 | 52,937 B | 87,583 B | 17,940 B |
| 510 | 91,601 B | 152,167 B | 31,116 B |

Serialization benchmarks (Go 1.25, Windows amd64, Intel Core i9-14900KF)
measured columnar JSON at 80.6–241.3 µs with 2 allocs/op for 160–510 IDs,
versus row JSON at 392.3 µs–1.44 ms with 4,002–12,753 allocs/op. The binary
candidate measured 29.4–76.0 µs but used an intentionally minimal fixed
metadata envelope; it is evidence for the trade-off, not a second supported
API.

The latest direct Go benchmark also measured `CatalogPage` 109,948 ns/op
(75,862 B/op, 282 allocs/op), `Trajectory64BodyBatch` 1,672,736 ns/op
(626,184 B/op, 181 allocs/op), and `Trajectory10000Samples` 6,722,205 ns/op
(2,766,505 B/op, 88 allocs/op). These figures are host-specific and are kept
alongside the earlier reference run rather than treated as universal limits.

The 64-body benchmark includes missing records explicitly and returns one
compact numeric array per body when a state exists. `stateStride: 6` and
`stateLayout: "row-major-[x,y,z,vx,vy,vz]"` define the six values per sample;
there are no parallel object-shaped state arrays to multiply response memory.
The long response above is 597,239 bytes for 5,000 samples using that layout.

The overload workload uses a one-slot server with the current bounded scheduler.
Its burst may queue and succeed; `429` with `Retry-After: 1` indicates a full
class queue or an expired wait, not simply an occupied worker. The report now
separates main-workload `scheduler` from `overloadScheduler` snapshots, including
peak queued requests, grants, rejected/expired/cancelled waits and aggregate wait
nanoseconds. `queueWaitTimeoutNs` is the configured wait limit, not an observed
maximum latency. Zero rejections does not prove saturation. See
[request scheduling](./PERFORMANCE.md#backend-request-scheduling) for fairness
and cancellation limits. The inventory reader checks cancellation while scanning
rows.

These figures are measurements, not latency, memory, precision or “best”
guarantees for another client, release, operating system or data profile.
