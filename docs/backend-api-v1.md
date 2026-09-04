# Solar Atlas current backend contract

The current wire prefix is `/v1/`; responses include
`apiVersion: "solar.api/v1"`. This batch intentionally has no legacy-client
compatibility promise: clients consume the current contract and its explicit
precision/status fields.

## Scientific contract

* `epochJd` and `startJd`/`endJd` are Julian Date on TDB. A trajectory sample's
  epoch is `startJd + i*(endJd-startJd)/(samples-1)`.
* `frame` is currently `ECLIPJ2000`; positions are km and velocities km/s.
* `id` is a stable application identity (`sun`, `earth`, `naif:401`, etc.).
  `naifId` is the source identity and is never used to infer a different body.
* `datasetVersion`, `source`, validity bounds and `availability` are part of
  the scientific result, not UI decoration.
* `operational` means a packaged, validated source kernel; `snapshot` means a
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

`POST /v1/current-states` is an exact-only endpoint: it resolves one shared TDB
Julian epoch for 1–512 unique catalog or source IDs and rejects approximate
precision. Its capabilities contract declares `currentStates.precision:
"exact-only"` and `stateOriginId: "naif:0"`; trajectory and identity endpoints
retain their separate explicit approximate opt-in. The request is bounded by
the JSON body limit and response is capped at 8 MiB; a saturated scientific
worker pool fails fast with
`429 overloaded`. The response is compact columnar JSON: `ids` and each
parallel metadata array use the same order, while `stateValues` is a flat
row-major `[x,y,z,vx,vy,vz]` numeric array with `stateOriginId: "naif:0"` marking
that every present state is SSB/barycentric and `statePresent` marking rows that
contain a state (missing rows are zero-filled). Per-ID arrays retain
`availability`, `precision`, `source`, `datasetVersion`, `model`, `centerIds`,
validity/evidence windows, `missingReason`, and source identity status. The
envelope includes catalog and inventory manifest SHA-256 values, TDB,
ECLIPJ2000, km and km/s. Exact rows use the same SPK/snapshot resolver as the
single-state endpoint; source-element fallback is represented as exact
`missing` and is never labelled exact. Unknown IDs remain in order as `missing`
with
`missingReason: "unknown-identity"` so mixed selections are not shifted.

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
configuration and uses the current-states adapter only when that value is
present. Pages builds intentionally omit a real backend configuration and keep
the curated static preview; they do not request the full catalog or claim full
coverage. The project currently has no official public full-Web backend URL.

## Errors

Errors are JSON objects with `apiVersion` and `error.code`/`error.message`.
Relevant codes include `invalid_limit`, `invalid_page_token`,
`body_not_found`, `identity_not_found`, `invalid_precision`, `invalid_epoch`,
`unsupported_frame`, `state_unavailable`, `cancelled`, and `overloaded`. A
`429 overloaded` response includes `Retry-After: 1`; the backend rejects work
when its configured scientific worker pool is full rather than accumulating an
unbounded queue.
