# Exact state-tile Web performance contract

The Web client creates an exact plan and downloads fixed-header binary tiles.
One plan accepts at most 32,768 unique IDs, defaults to 16,384 rows per tile,
uses at most two concurrent tile requests, retries each tile once, and publishes
no frame until the complete plan has passed identity, checksum, ordering,
bitmap, provenance and numeric validation. Playback coalesces work while a
request is active; seeking cancels stale work and only the latest generation
may publish.

The deck coverage summary uses the last verified backend frame, never the
browser's local SPK registry. The expanded ledger counts selected entries,
received rows, distinct received request identities, exact/missing states,
pending responses and reference-relative positions separately. Reference-only
responses are excluded from selected totals; an unavailable reference can
prevent projection without changing the exact target-state count. Pending
responses are not classified as explicit missing states. The ledger preserves
the published TDB epoch and catalog/inventory hashes, with per-entry provenance
and distinct snapshot validity/evidence intervals in 20-row pages. It does not
claim a global unique-body count, visible pixels, or measured FPS. Local kernel
coverage remains separately inspectable for historical trajectories.

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
