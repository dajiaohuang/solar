# Reproducible backend performance evidence

The benchmark harness exercises the real `httpapi.Server` through an in-process
HTTP server. It measures sequential trajectory latency (p50/p95/p99 in
nanoseconds), concurrent catalog throughput, allocation deltas and a cancelled
request. It does not claim these numbers for other hardware or data versions.

Run from this worktree:

```text
go run ./cmd/bench -requests 500 -concurrency 32
go test -bench . -benchmem -benchtime=200ms ./...
```

Record the complete JSON line together with `go version`, OS/architecture,
CPU model, request arguments and the catalog `manifestSha256` returned by
`/v1/capabilities`. Compare cold process runs separately from warm in-process
runs. `go test -race ./...` is the concurrency correctness gate.

Reference run (2026-09-04, Windows amd64, Intel Core i9-14900KF, 4,000
trajectory requests measured as 500 eight-request batches, 32 workers,
manifest-backed catalog with 101 entries):

```json
{"goos":"windows","goarch":"amd64","catalogEntries":101,"latencyRequests":4000,"concurrency":32,"p50Ns":125000,"p95Ns":194425,"p99Ns":250125,"minNs":0,"maxNs":267050,"throughputRequestsPerSecond":10837.81173987622,"allocDeltaBytes":3317696,"totalAllocBytes":59359952,"invalidResponses":0,"cancelledObserved":true}
```

The Go microbenchmarks on the same run reported 136.3 ns/op and 0 allocs/op
for one Kepler propagation, 76.9 µs/op and 81,377 B/op for a 100-entry catalog
page, and 43.6 µs/op and 24,383 B/op for a 64-sample trajectory. These are
engineering evidence, not a universal fastest claim.
