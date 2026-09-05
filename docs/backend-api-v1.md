# Solar Atlas current backend contract

The current wire prefix is `/v1/`; responses include
`apiVersion: "solar.api/v1"`. Clients consume the current contract and its
explicit precision/status fields.

## Scientific contract

* `epochJd` and `startJd`/`endJd` are Julian Date on TDB. A trajectory sample's
  epoch is `startJd + i*(endJd-startJd)/(samples-1)`.
* `frame` is currently `ECLIPJ2000`; positions are km and velocities km/s.
* `id` is a stable application identity (`sun`, `earth`, `naif:401`, etc.).
  `naifId` is the source identity and is never used to infer a different body.
* `datasetVersion`, `source`, validity bounds and `availability` are part of
  the scientific result, not UI decoration.
* Catalog `operational` identifies a packaged kernel candidate admitted from
  the manifest, not a verified state or an operational-navigation guarantee.
  Full-file integrity verification and SPK parsing are lazy; manifest counts
  expose verified, pending and invalid kernel files separately. Only the
  evaluated plan/tile status establishes exact availability at a requested
  epoch after verification and center-chain resolution. `snapshot` means a
  validated source state at one declared audit epoch; `fallback` means an
  explicitly requested source-element fixed two-body approximation; `missing`
  means no exact state is available for the requested result. Missing states
  include a machine-readable `missingReason`.
* No endpoint performs N-body integration. No endpoint fetches arbitrary URLs or
  reads arbitrary client-selected paths.

## Endpoints

`GET /v1/capabilities` returns API/catalog versions, scientific contract,
resource limits and full/Pages-preview profiles. Its `contract.auditIdentities`
array contains exact allowed `{source,datasetVersion,model}` tuples from the
loaded catalog and indexed inventory; clients must reject row metadata outside
these tuples. The preview profile is a
product availability policy: full-only entries may be visible but restricted
actions are blocked.

The optional `-coverage-report` backend configuration enables two read-only
audit endpoints. Without a validated report they return `404` with
`coverage_unavailable`; a configured report that does not match the loaded
full-profile catalog or inventory fails backend startup.

`GET /v1/coverage` returns the small audit summary. It includes the report,
catalog and inventory SHA-256 identities, the pinned source-snapshot and
identity-mapping evidence hashes, `auditEt`, fixed TDB/ECLIPJ2000 units, the
requested dependency window, source identity counts and unresolved reasons.
`windowCounts.numericallyCertifiedWholeWindowTargets` remains `null` in this
report. The counts describe source records and dependency availability at the
declared audit epoch; they are not current display counts, live state
availability, unique-body counts or whole-window numerical-accuracy claims.

`GET /v1/coverage/targets?ids=earth,naif:399` returns at most 64 distinct
catalog IDs or explicitly audited canonical NAIF IDs. Catalog aliases are canonicalized to their NAIF target.
Each row is either `audited`, with its audit-epoch state label, source-record
references and dependency window points/intervals/gaps, or `not_audited`.
`not_audited` never implies missing state. The response repeats the report and
runtime manifest identities and contains no request epoch. Both endpoints
load the report once at startup; requests use bounded in-memory indexes and do
not scan the report or inventory shards.

The loader checks actual indexed source ordinals as well as IDs, source rows
and mapped targets. Available audit states require six explicit finite numbers;
`no-state-at-audit-epoch` requires an explicit null state and is not counted as
available. A single-epoch dependency window is valid. Missing numeric fields
cannot silently become zero, and numerical whole-window certification must be
explicit null. The HTTP summary is capped at 64 KiB including its envelope;
report loading is capped at 8 MiB, 2,048 target groups and 8,192 source references.
Exceeding these bounds fails startup rather than truncating scientific coverage.

Run hermetic coverage checks with `go test ./internal/coverage ./internal/httpapi`.
Optional real-report tests require all of `SOLAR_COVERAGE_REPORT`,
`SOLAR_COVERAGE_INVENTORY_DIR` and `SOLAR_COVERAGE_DATA_DIR`; without them those
external-data cases explicitly skip. Source snapshot/mapping hashes remain audit
provenance, not independently reread source bytes at server startup.

`GET /v1/catalog?q=&limit=&pageToken=` returns a lexicographically stable,
paginated list. `limit` is 1–500 and page tokens are opaque to clients.

`GET /v1/inventory?q=&limit=&pageToken=` streams the optional audited all-body
source inventory. It reports `totalRecords`, declared compressed input bytes and
`sourceRecords: true`; rows are
not deduplicated, promoted to selectable bodies, or counted as unique objects.
Each row retains source designation, identity/parent status, geometry and
ephemeris status (including open-conic and missing-parent states). The service
builds a bounded compact index once from the explicit `-inventory-dir` input;
requests fetch only referenced rows and never rescan all source shards.
The startup contract bounds indexed input at 2,000,000 records, 12,000,000
identity postings, 10,000 shards and 64 MiB per compressed shard; these limits
are surfaced by `/v1/capabilities`.

`GET /v1/identities?q=&limit=&pageToken=` returns paginated source identity
assertions from the same inventory. `GET /v1/identities/{id}` returns one
identity summary plus its untouched source record. These are source assertions,
not an all-sources deduplicated ontology: unresolved components, candidates,
open-conic records and missing parents remain visible with explicit statuses.
`q` is a case-insensitive exact match against an indexed ID, designation, name
or source-provided alias (whitespace is normalized); it does not scan every
source row for arbitrary substrings.
`GET /v1/inventory/{id}` returns only the untouched source record envelope.

`GET /v1/identities/{id}/state?epochJd=&precision=exact` returns one position /
velocity state in ECLIPJ2000. Exact mode uses only a verified operational SPK
state or a validated source snapshot at its audit epoch and declared kernel
segment window (returned as `evidenceWindowEt`). `precision=approximate`
is an explicit opt-in for a bounded two-body source-element model; it is never
reported as exact. A known identity without an exact state returns HTTP 200 with
`availability: "missing"` and a machine-readable reason.

`GET /v1/catalog/manifest` publishes the exact-state dataset identity and state
tile limits. `POST /v1/state/plan` accepts 1–32,768 unique catalog or source IDs
at one TDB Julian epoch. It permits only `ECLIPJ2000`, `precision: "exact"` and
`fieldMask: ["position","velocity"]`. Planning resolves the actual states,
freezes their metadata and values in a bounded two-minute LRU cache, and reports
exact/missing counts that match the eventual tile bitmaps. Approximate count is
always zero. Unknown or uncovered IDs retain their requested ordinal as an
explicit missing row.

`POST /v1/state/tiles` accepts a plan ID and tile sequence. It returns
`application/vnd.solar.state-tile+binary` with a fixed 200-byte little-endian
header, NDJSON provenance rows, exclusive exact/approximate/missing bitmaps and
row-major Float64 `[x,y,z,vx,vy,vz]` states. Every exact state is SSB/barycentric
(`stateOriginId: "naif:0"`), TDB, ECLIPJ2000, km and km/s. The payload, plan,
catalog manifest and optional inventory manifest hashes are embedded in the
header. Missing rows are zero-filled; approximate bitmap bits are forbidden by
the exact-only contract. A repeated tile request for a live plan is byte-stable
and does not repeat state evaluation. The default tile size is 16,384 rows;
the declared maximum is 32,768 rows and 64 MiB per tile. See
[the complete binary wire contract](./state-tiles-v1.md).

Trajectory and identity endpoints keep their separate, explicit approximate
opt-in.

`GET /v1/bodies/{id}` returns one catalog record. Unknown IDs are a 404; a
known source target without local data is a 200 catalog record with
`availability: "missing"`.

`POST /v1/trajectory` accepts source or catalog IDs and:

```json
{"bodyIds":["earth","sb:asteroid:1"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000","precision":"exact"}
```

The request is limited to 64 bodies, 10,000 samples and a 1,000-year window.
Cancellation is honoured between samples and returns a structured `cancelled`
error. Exact mode does not propagate rounded/open-conic/unvalidated source
elements. Bodies without an exact model remain in the response with an empty
`states` array and an explicit missing reason; they are not silently dropped.
Returned trajectory `states` are one compact row-major numeric array per body;
`stateStride: 6` and the response `stateLayout` identify
`[x,y,z,vx,vy,vz]` for each sample in the declared frame and units. Source
identity trajectories also carry `centerId` when the source declares an
orbital center; no center is inferred.

`GET /v1/preview/manifest` is a deterministic, hash-tagged Pages profile
snapshot. It is not the full data host and does not imply that a full Web or
native endpoint has been deployed.

## Full Web boundary

The full Web client reads `VITE_SOLAR_API_BASE_URL` from its deployment
configuration and uses the manifest/plan/binary-tile transport only when that
value is present. Pages builds intentionally omit a real backend configuration and keep
the curated static preview; they do not request the full catalog or claim full
coverage. The project currently has no official public full-Web backend URL.

## Errors

Errors are JSON objects with `apiVersion` and `error.code`/`error.message`.
Relevant codes include `invalid_limit`, `invalid_page_token`,
`body_not_found`, `identity_not_found`, `invalid_precision`, `invalid_epoch`,
`unsupported_frame`, `state_unavailable`, `cancelled`, and `overloaded`. A
`429 overloaded` response includes `Retry-After: 1`. The backend queues at most
32 waiting requests in each server-selected class before body decoding: current
state plans/tiles, manifests and details are interactive; trajectories have their
own class; catalog/inventory/identity list scans are bulk. FIFO within each class
and weighted round robin (4 interactive, 2 trajectory, 1 bulk) prevent an occupied
class from consuming all waiting capacity. Running requests remain bounded by
the configured worker count. A full class queue or five-second queue wait expiry
returns 429. Observed context cancellation removes the waiter and returns 408;
HTTP/1 disconnect notification may be delayed while a POST body is unread, in
which case queue expiry remains the limit. Running work is not preempted and
these are not end-to-end latency guarantees. Tile encoding retains its separate
two-slot limit and may also return 429 when both encoders are occupied.
