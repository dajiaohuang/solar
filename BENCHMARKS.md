# Reproducible backend performance evidence

The harness exercises the real `httpapi.Server` through an in-process HTTP
server backed by the post-PR94 full manifest. It measures the startup catalog
load (cold data path), first request, warm sequential p50/p95/p99, concurrent
catalog throughput, a mixed catalog/trajectory/inventory workload, a 64-body
batch, a 10,000-sample long trajectory, allocations, peak working set, a
pre-cancelled request and fail-fast overload. It never uses a toy catalog or
an empty HTTP handler, and it does not claim that one machine is universally
fastest.

Run from this worktree:

```text
go run ./cmd/bench -requests 500 -concurrency 32 -inventory-dir D:/repo/repostew/.repostew/cache/solar-all-body-coverage/inventory-pr94-20260904
go test -bench 'Benchmark(CatalogIDMapLookup|CatalogPage|Trajectory64Samples|Trajectory64BodyBatch|Trajectory10000Samples)$' -benchmem -benchtime=200ms ./internal/httpapi
go test -race ./...
go test -fuzz FuzzSPKParserNeverPanics -fuzztime=10s ./internal/spk
go test -fuzz FuzzDecodeCursorNeverPanics -fuzztime=10s ./internal/inventory
```

Record the complete JSON line together with `go version`, OS/architecture,
CPU model, request arguments and the catalog `manifestSha256` returned by
`/v1/capabilities`. `catalogLoadMs` and `firstRequestMs` are the cold path;
the repeated latency and mixed runs are warm in-process paths. To separate
binary startup from data-page cache effects, build once with `go build` and
run the resulting executable twice without changing the data directory.
`peakRSSBytes` is sampled process working set on Windows and `/proc` RSS on
Linux; `peakHeapBytes` remains available on every platform. The Go benchmark
reports authoritative `B/op` and `allocs/op`.

Reference harness run (2026-09-04, Windows amd64, Intel Core i9-14900KF,
full source inventory 1,567,193 rows / 314 gzip shards (compressed input bytes
are reported by the harness), 552 catalog entries;
100 requests per workload, 16 workers, 5,000-sample long trajectory):

```json
{"goos":"windows","goarch":"amd64","catalogEntries":552,"inventoryRecords":1567193,"inventoryShards":314,"inventoryCompressedBytes":89626020,"catalogLoadMs":28.576,"latencyRequests":800,"concurrency":16,"firstRequestMs":2,"p50Ns":124987,"p95Ns":125087,"p99Ns":125175,"minNs":0,"maxNs":250012,"throughputRequestsPerSecond":19998.000199980004,"mixedRequests":100,"mixedP50Ns":1999800,"mixedP95Ns":7000100,"mixedP99Ns":9000300,"batchBodies":64,"batchSamples":128,"batchMs":1.999,"longSamples":5000,"longTrajectoryMs":4,"longResponseBytes":857078,"overloadRequests":32,"overloadRejected":31,"peakRSSBytes":41074688,"peakHeapBytes":13771368,"allocDeltaBytes":0,"totalAllocBytes":9162264,"invalidResponses":0,"cancelledObserved":true,"overloadStatusExpected":429}
```

The direct HTTP benchmarks on the same machine reported:

```text
BenchmarkCatalogPage-32                3135    92240 ns/op      75544 B/op 282 allocs/op
BenchmarkCatalogIDMapLookup-32      44948870       5.501 ns/op          0 B/op   0 allocs/op
BenchmarkTrajectory64Samples-32        5600    51339 ns/op      24525 B/op  70 allocs/op
BenchmarkTrajectory64BodyBatch-32       100  2131010 ns/op     764721 B/op 175 allocs/op
BenchmarkTrajectory10000Samples-32        46  5381111 ns/op    3585515 B/op  84 allocs/op
```

The batch benchmark submits all 64 catalog IDs; rows without a supported
state are returned as explicit `missing` records, so the timing includes the
real availability branch rather than silently dropping them.

The bounded-concurrency comparison used the same 552-entry catalog and 100
requests per workload (no source inventory attached):

| workers | catalog throughput | mixed p95 | peak RSS |
| ---: | ---: | ---: | ---: |
| 1 | 5,882 req/s | 2.00 ms | 19.1 MiB |
| 8 | 9,512 req/s | 5.00 ms | 29.6 MiB |
| 32 | 19,113 req/s | 16.09 ms | 47.4 MiB |

The compiled binary was then run twice without changing the data directory to
observe cold versus warm process/page-cache behaviour. The two 16-worker runs
measured `catalogLoadMs` 26.849 / 27.693 ms, `firstRequestMs` 1.628 / 1.994 ms,
throughput 19,999 / 23,221 req/s, and peak RSS 43.2 / 38.9 MiB. This is a
cache observation, not a promise of a fixed warm-up improvement.

CPU and allocation profiles were captured with:

```text
go test -cpuprofile=D:/repo/repostew/.repostew/solar-backend-cpu.pprof -memprofile=D:/repo/repostew/.repostew/solar-backend-mem.pprof -bench '^BenchmarkTrajectory10000Samples$' -benchtime=3s ./internal/httpapi
go tool pprof -top D:/repo/repostew/.repostew/solar-backend-cpu.pprof
go tool pprof -top -alloc_space D:/repo/repostew/.repostew/solar-backend-mem.pprof
```

The profile put JSON float encoding and response-buffer growth ahead of Kepler
math (the latter was about 14% cumulative CPU in the long-trajectory run).
The harness reports compressed inventory input bytes and long-response bytes as
I/O scale; rerun it with the same shard manifest to compare disk/cache paths.
That supports the current choices: compute all requested states in one bounded
batch, keep the 552-entry catalog as an immutable sorted slice plus ID map,
stream the 1.5M-row inventory from gzip shards instead of materialising it,
and load the manifest once per process. A response cache was deliberately not
added: scientific requests have high-cardinality time/range/body keys and an
unbounded cache would violate the memory budget; warm-process and OS page-cache
runs are the measured cache comparison. The semaphore is fail-fast at its
configured limit (`429 overloaded`, `Retry-After: 1`) so bursts do not create
an unbounded scientific work queue.

These figures are evidence for the recorded hardware and dataset only. They
are not latency, RSS, accuracy or “best” guarantees for another client,
release, operating system or data profile.
