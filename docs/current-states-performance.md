# Exact state-tile Web performance contract

The Web client creates an exact plan and downloads fixed-header binary tiles.
One plan accepts at most 32,768 unique IDs, defaults to 16,384 rows per tile,
uses at most two concurrent tile requests, retries each tile once, and publishes
no frame until the complete plan has passed identity, checksum, ordering,
bitmap, provenance and numeric validation. Playback coalesces work while a
request is active; seeking cancels stale work and only the latest generation
may publish.

Run the focused measurement with:

```text
npx vitest run tests/unit/state-tiles.test.ts
go test ./internal/httpapi -run StateTile -v
go test ./internal/httpapi -bench StateTile -benchmem
```

The Go benchmark reports plan/tile wire bytes and allocations. The Web unit
suite checks deterministic binary decoding, hash mismatch rejection, complete-
set atomicity, bounded concurrency, retry and cancellation. Measured elapsed
time is a repeatable test-run observation, not a hardware-independent
smoothness guarantee; deployers must repeat it with their backend, inventory,
network and target device classes.
