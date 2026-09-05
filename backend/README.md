# Unified Go backend workstream

The implementation in `cmd/solar-backend` is a local service shared by Web,
Android and iOS. See [`docs/backend-api-v1.md`](../docs/backend-api-v1.md) for
the versioned scientific contract.

Run from the repository root with `go run ./cmd/solar-backend`. Before starting
the service, run the normal build/data preparation so that
`public/data/ephemerides` contains the selected Web profile, then stage that
profile into an independent output directory and point the service at it:

```text
node scripts/stage-backend-profile.mjs <output-directory> full
go run ./cmd/solar-backend -data-dir <output-directory> -inventory-dir <inventory-directory>
```

The staging command streams and verifies source bytes/hashes, prefers hardlinks
when possible, falls back to copies without overwriting an existing directory,
and copies the manifest last. Omit the profile to use `full`; pass `pages` only
when that profile has been prepared. `src/data` is source-only metadata and may
describe identities or missing states; it is not a packaged exact-kernel data
directory. The inventory endpoint is deliberately separate from the
deduplicated catalog and preserves source-record identity, parent, geometry and
ephemeris status.

The service builds a bounded startup index for the audited source inventory, so
identity search and detail requests do not rescan all gzip shards. Exact state
requests use verified SPK data or a validated source snapshot; rounded or
unvalidated elements are missing unless `precision=approximate` is explicitly
requested. The service uses a bounded scientific worker pool. When all slots
are in use it returns `429 overloaded` with `Retry-After: 1`; it does not
accumulate an unbounded work queue. Reproduce the measured cold/warm, batch,
long-trajectory, binary state-tile transport, mixed-load, RSS and profile evidence
with the commands in
[`BENCHMARKS.md`](../BENCHMARKS.md).

The current binary state-tile benchmark defaults to TDB `epochJd=2461287.5`,
the reproducible audited epoch. At that epoch the full-profile evidence used
552 catalog entries (510 packaged files) and source workloads containing both
exact-capable and missing inventory rows at 16,384 and 32,768 IDs. Successful
tile latency/bytes are quantified independently from expected `429 overloaded`
backpressure; sampled RSS is labelled as sampled rather than a machine peak.
The retained historical 160/294/510 JSON batch measurements below are not
state-tile performance evidence.

For one shared TDB epoch, clients first create an exact plan with
`POST /v1/state/plan`, then fetch its fixed-header binary tiles through
`POST /v1/state/tiles`. A plan accepts up to 32,768 unique catalog or source
IDs; the default tile contains 16,384 rows. Planning resolves and freezes the
actual exact/missing result, and the bounded two-minute LRU cache makes tile
retries byte-stable without repeating SPK evaluation. Each tile carries
manifest and plan hashes, row metadata, exclusive status bitmaps and little-
endian Float64 `[x,y,z,vx,vy,vz]` values. Approximate rows are forbidden.

This is the current state-tile contract. See the [state-tile wire reference](../docs/state-tiles-v1.md) for offsets, validation rules and memory boundaries.
