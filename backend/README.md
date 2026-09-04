# Unified Go backend workstream

The implementation in `cmd/solar-backend` is a local service shared by Web,
Android and iOS. See [`docs/backend-api-v1.md`](../docs/backend-api-v1.md) for
the versioned scientific contract.

Run from the repository root with `go run ./cmd/solar-backend`. Use
`-data-dir src/data` (the full manifest is selected automatically) and,
optionally, `-inventory-dir` for the audited gzip-JSONL source inventory. The
inventory endpoint is deliberately separate from the deduplicated catalog and
preserves source-record identity, parent, geometry and ephemeris status.

The service builds a bounded startup index for the audited source inventory, so
identity search and detail requests do not rescan all gzip shards. Exact state
requests use verified SPK data or a validated source snapshot; rounded or
unvalidated elements are missing unless `precision=approximate` is explicitly
requested. The service uses a bounded scientific worker pool. When all slots
are in use it returns `429 overloaded` with `Retry-After: 1`; it does not
accumulate an unbounded work queue. Reproduce the measured cold/warm, batch,
long-trajectory, compact-state transport, mixed-load, RSS and profile evidence
with the commands in
[`BENCHMARKS.md`](../BENCHMARKS.md).
