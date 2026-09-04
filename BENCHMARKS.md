# Reproducible backend performance evidence

The harness exercises the real `httpapi.Server` through an in-process HTTP
server backed by the post-PR94 catalog and the audited source inventory. It
measures cold catalog/inventory load, warm catalog latency and throughput,
mixed catalog/trajectory/search traffic, exact source-state lookup at the
declared audit epoch, compact trajectory transport, cancellation, overload
backpressure, allocations and process memory. It does not use a toy catalog
or an empty handler, and the measurements are evidence for the recorded
machine and dataset rather than universal guarantees.

Run from this worktree:

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
`/v1/capabilities`. `catalogLoadMs` and `inventoryIndexLoadMs` are cold startup
paths. `firstRequestMs`, repeated latency and mixed runs are warm in-process
paths. `peakRSSBytes` is sampled process working set on Windows and `/proc`
RSS on Linux; `peakHeapBytes` remains available on every platform. Go's
benchmark reports authoritative `B/op` and `allocs/op`.

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

The direct HTTP benchmarks from the same machine were:

```text
BenchmarkCatalogPage-32                3536      65787 ns/op      75373 B/op 282 allocs/op
BenchmarkCatalogIDMapLookup-32      46340097          5.118 ns/op          0 B/op   0 allocs/op
BenchmarkTrajectory64Samples-32        6308      43236 ns/op      21926 B/op  76 allocs/op
BenchmarkTrajectory64BodyBatch-32       147    1504527 ns/op     659663 B/op 182 allocs/op
BenchmarkTrajectory10000Samples-32       50    4852430 ns/op    3120147 B/op  92 allocs/op
```

The 64-body benchmark includes missing records explicitly and returns one
compact numeric array per body when a state exists. `stateStride: 6` and
`stateLayout: "row-major-[x,y,z,vx,vy,vz]"` define the six values per sample;
there are no parallel object-shaped state arrays to multiply response memory.
The long response above is 597,239 bytes for 5,000 samples using that layout.

The overload workload uses a one-slot server and confirms fail-fast `429`
responses with `Retry-After: 1`; the normal worker pool never accumulates an
unbounded queue. Pre-cancelled requests are observed by the harness, and the
inventory reader checks cancellation while scanning rows.

These figures are measurements, not latency, memory, precision or “best”
guarantees for another client, release, operating system or data profile.
