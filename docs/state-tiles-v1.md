# Exact state tiles v1

State tiles are the current high-volume exact-position transport shared by the
Go backend, full Web client and independent Android/iOS clients. They replace the removed columnar JSON
current-state endpoint; no old-wire compatibility is promised.

## Request sequence

1. `GET /v1/catalog/manifest` pins `apiVersion`, catalog version, catalog
   manifest SHA-256, optional inventory manifest SHA-256 and hard limits.
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

Plans and tiles are bounded independently: plan JSON is capped at 8 MiB and
each tile at 64 MiB. A plan may contain multiple tiles. A larger UI selection
is stably deduplicated and partitioned into multiple plans instead of being
silently truncated. Clients fetch at most two tiles concurrently and publish
only after every plan's complete set validates.

## Binary envelope

All integers and Float64 values are little-endian. The fixed header is exactly
200 bytes.

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 8 | ASCII `SLRTILE` plus NUL |
| 8 | 2 | wire version (`1`) |
| 10 | 2 | header bytes (`200`) |
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

The payload contains one NDJSON metadata object per row, three equally sized
bitmaps, zero padding to an eight-byte boundary, and row-major Float64
`[x,y,z,vx,vy,vz]` states. Units are km and km/s. All present states use
ECLIPJ2000 coordinates relative to the solar-system barycenter (`naif:0`).

Exactly one status bit must be set per row. This transport is exact-only, so
an approximate bit is a protocol error. Exact rows require source, dataset,
model and state-evidence provenance and must not carry a missing reason.
`sourceRecord: false` binds `datasetSha256` to the catalog manifest;
`sourceRecord: true` binds it to the inventory manifest. Operational provenance
comes from the actual selected kernel and segment at the requested epoch,
including its checksum, center and validity. An audited snapshot additionally
requires its source identity status and verified evidence-kernel checksum.
Missing rows require a machine-readable reason and six zero state components.
Every numeric component must be finite.

## Client rejection rules

Before publishing a frame, a client rejects any response with a mismatched API
or catalog version, manifest hash, plan hash, inventory hash, epoch, frame,
origin, units, field mask, stride, tile count, sequence, ordinal span, section
offset, payload hash, metadata count, provenance/status relation, or nonfinite
state. It also rejects incomplete or conflicting duplicate tile sets.
Transport checks require the declared Content-Type and bounded Content-Length;
the strong ETag must equal the tile payload checksum. Approximate and unused
bitmap bits are zero. Failed or cancelled downloads release their streams.

This validation boundary is intentional: catalog presence never means exact
state availability. Only a row whose validated exact bit and evidence agree is
rendered as an exact position. Missing coverage stays visible as missing; it is
never filled with a two-body or N-body approximation.
