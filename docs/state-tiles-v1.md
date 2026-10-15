# Exact state tiles: API v1, binary envelope v2

State tiles are the current high-volume exact-position transport shared by the
Go backend, full Web client and independent Android/iOS clients. They replace the removed columnar JSON
current-state endpoint; no old-wire compatibility is promised.

The [multi-epoch window protocol](./shared-compute-refactor.md#multi-epoch-protocol)
embeds these unchanged binary tiles in one progressively consumed response.

## Request sequence

1. `GET /v1/catalog/manifest` pins `apiVersion`, catalog version, catalog
   manifest SHA-256, optional inventory manifest SHA-256 and hard limits,
   including `limits.maxIds` and `limits.maxPlanBytes` for plan requests.
2. `POST /v1/state/plan` submits 1–32,768 unique IDs, one finite TDB Julian
   date, `ECLIPJ2000`, `precision: "exact"`, and
   `fieldMask: ["position","velocity"]`. `tileSize` defaults to 16,384 and is
   bounded to 32,768.
3. The backend performs the actual SPK/source-evidence resolution once. The
   returned plan's exact and missing counts therefore describe the frozen
   rows, rather than optimistic catalog declarations.
   `requestIdsSha256` binds the ordered request: for each ID, hash a four-byte
   little-endian UTF-8 byte length followed by those UTF-8 bytes, in order.
   A tile's row IDs must exactly match that plan's requested ordinal range.
4. `POST /v1/state/tiles` submits `{ "planId": "<sha256>", "sequence": 0 }`.
   Live plans are retained in a bounded LRU for two minutes. Repeating a tile
   request produces identical bytes without repeating numerical evaluation.

Plans and tiles are bounded independently: each state-plan request and response
is capped at 8 MiB and each binary tile at 64 MiB. The catalog manifest reports
the plan input ceiling as `limits.maxPlanBytes`; capabilities reports it as
`limits.statePlanBytesMax`. Web, Android and iOS partition each selection by
both the advertised ID count and the actual UTF-8 JSON request size, then check
the serialized body against that same ceiling before sending. If an older
manifest omits plan limits, clients use the previous 1 MiB request ceiling.
Other JSON request routes keep their independently configured limits. A plan
may contain multiple tiles. A larger UI selection is stably deduplicated and
partitioned into multiple plans instead of being silently truncated. Web,
Android and iOS fetch at most two tiles concurrently
and publish only after every plan's complete set validates. Native clients
reserve both tile working sets against their resident-state budget before
starting a pair; if only one tile fits, they fetch serially. Every result is
validated and accumulated in plan order regardless of response completion
order. On iOS, the cache actor owns bounded file reads, writes and quota
eviction, while payload hashing, metadata validation and Float64 state decoding
run in cancellable utility tasks. This lets an already-admitted pair use two
CPU workers without raising the two-tile concurrency or resident-memory limits.
It removes actor-level decode serialization; device throughput and peak memory
still require native measurement.

## Binary envelope

All integers and Float64 values are little-endian. The fixed header is exactly
208 bytes. API routes remain `/v1`; wire version 2 makes each binary tile carry
its own scientific contract, so decoders do not infer units or frame from a
separate response.

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 8 | ASCII `SLRTILE` plus NUL |
| 8 | 2 | wire version (`2`) |
| 10 | 2 | header bytes (`208`) |
| 12 | 4 | tile sequence |
| 16 | 4 | total tile count |
| 20 | 4 | first plan ordinal |
| 24 | 4 | record count |
| 28 | 2 | state stride (`6`) |
| 30 | 2 | numeric field mask (`3`: position + velocity) |
| 32 | 8 | TDB Julian date |
| 40 | 4 | NDJSON metadata offset |
| 44 | 4 | NDJSON metadata bytes |
| 48 | 4 | exact bitmap offset |
| 52 | 4 | bytes in each status bitmap |
| 56 | 4 | approximate bitmap offset |
| 60 | 4 | missing bitmap offset |
| 64 | 4 | Float64 state offset |
| 68 | 4 | Float64 state bytes |
| 72 | 32 | raw plan SHA-256 |
| 104 | 32 | raw catalog-manifest SHA-256 |
| 136 | 32 | raw inventory-manifest SHA-256, or zeros when absent |
| 168 | 32 | SHA-256 of every byte after the header |
| 200 | 1 | time-scale code (`1`: TDB) |
| 201 | 1 | frame code (`1`: ECLIPJ2000) |
| 202 | 1 | state-origin code (`1`: solar-system barycenter, `naif:0`) |
| 203 | 1 | distance-unit code (`1`: km) |
| 204 | 1 | velocity-unit code (`1`: km/s) |
| 205 | 3 | reserved; all bytes must be zero |

The payload contains one NDJSON metadata object per row, three equally sized
bitmaps, zero padding to an eight-byte boundary, and row-major Float64
`[x,y,z,vx,vy,vz]` states. Units are km and km/s. All present states use
ECLIPJ2000 coordinates relative to the solar-system barycenter (`naif:0`).
The header contract codes are mandatory and currently admit only the values in
the table. Per-row metadata still carries source identity, model, validity and
missing-reason evidence; the header states the shared epoch scale, frame,
origin and units once for the entire tile.

Exactly one status bit must be set per row. This transport is exact-only, so
an approximate bit is a protocol error. Exact rows require source, dataset,
model, state-evidence and a valid `sourceChainSha256` digest for the recursively
resolved SPK center chain; they must not carry a missing reason. If a stored
audit-epoch state lacks that lineage, the plan reports it as missing instead
of promoting the snapshot to exact.
`sourceRecord: false` binds `datasetSha256` to the catalog manifest;
`sourceRecord: true` binds it to the inventory manifest. Operational provenance
comes from the actual selected kernel and segment at the requested epoch,
including its checksum, center, validity and recursively resolved source-chain
digest. An audited snapshot additionally requires its source identity status,
selected root-segment descriptor, verified root-kernel checksum and the same
complete source-chain lineage.
The v2 digest uses a shared byte layout: SHA-256 of the UTF-8 SSB domain seeds
the chain; each selected segment hashes a NUL-terminated domain, little-endian
uint32 kernel-ID byte length, UTF-8 kernel ID, raw kernel SHA-256, little-endian
int32 target/center/frame/type, little-endian Float64 segment bounds and raw
parent digest. Links are folded from SSB outwards, avoiding language-specific
float text. The digest identifies provenance; it is not a signature or a
numerical error bound.
Its validity start and end both equal the single audit epoch; a separate
evidence window describes the source kernel segment, not permission to reuse
that snapshot at other times.
Missing rows require a machine-readable reason and six zero state components.
Every numeric component must be finite. Present validity and evidence windows
must contain the requested TDB epoch after conversion to ET, within a fixed
0.0001-second rounding allowance; the Go writer and every client reject
nonfinite or reversed present windows. Alignment padding is the minimum needed
to reach the next eight-byte boundary, and every decoder requires its bytes to
be zero. The JD/ET allowance reconciles Float64 conversion at the protocol
boundary; it does not extend SPK segment coverage.

## Client rejection rules

Before publishing a frame, a client rejects any response with a mismatched API
or catalog version, manifest hash, plan hash, inventory hash, epoch, time-scale
code, frame code, origin code, unit code, field mask, stride, tile count, sequence, ordinal span, section
offset, payload hash, metadata count, provenance/status relation, or nonfinite
state. It also rejects incomplete or conflicting duplicate tile sets.
After reconciling duplicate tiles, the client counts each row once and requires
the actual exact/approximate/missing totals to equal the validated plan totals
before publishing any frame. A matching total body count alone is insufficient.
Transport checks require the declared Content-Type and bounded Content-Length;
the strong ETag must equal the tile payload checksum. Approximate and unused
bitmap bits are zero. Failed or cancelled downloads release their streams.

This validation boundary is intentional: catalog presence never means exact
state availability. Only a row whose validated exact bit and evidence agree is
rendered as an exact position. Missing coverage stays visible as missing; it is
never filled with a two-body or N-body approximation.
