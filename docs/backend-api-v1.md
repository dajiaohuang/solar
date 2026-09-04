# Solar Atlas backend API v1

The wire prefix is `/v1/`; responses include `apiVersion: "solar.api/v1"`.
Unknown fields may be added, but existing field meaning and enum values are
stable. Clients must reject an unknown major API version and preserve unknown
body IDs as unselectable rather than substituting another body.

## Scientific contract

* `epochJd` and `startJd`/`endJd` are Julian Date on TDB. A trajectory sample's
  epoch is `startJd + i*(endJd-startJd)/(samples-1)`.
* `frame` is currently `ECLIPJ2000`; positions are km and velocities km/s.
* `id` is a stable application identity (`sun`, `earth`, `naif:401`, etc.).
  `naifId` is the source identity and is never used to infer a different body.
* `datasetVersion`, `source`, validity bounds and `availability` are part of
  the scientific result, not UI decoration.
* `operational` means a packaged, validated source kernel; `fallback` means a
  source-backed fixed osculating/two-body model; `missing` means no supported
  state is available for the requested result. Missing states include a
  machine-readable `missingReason`.
* No endpoint performs N-body integration. No endpoint fetches arbitrary URLs or
  reads arbitrary client-selected paths.

## Endpoints

`GET /v1/capabilities` returns API/catalog versions, scientific contract,
resource limits and full/Pages-preview profiles. The preview profile is a
product availability policy: full-only entries may be visible but restricted
actions are blocked.

`GET /v1/catalog?q=&limit=&pageToken=` returns a lexicographically stable,
paginated list. `limit` is 1–500 and page tokens are opaque to clients.

`GET /v1/inventory?q=&limit=&pageToken=` streams the optional audited all-body
source inventory. It reports `totalRecords` and `sourceRecords: true`; rows are
not deduplicated, promoted to selectable bodies, or counted as unique objects.
Each row retains source designation, identity/parent status, geometry and
ephemeris status (including open-conic and missing-parent states). The service
loads gzip JSONL shards lazily from the explicit `-inventory-dir` argument, so
the 1,567,193-record audit does not become an unbounded startup allocation.

`GET /v1/bodies/{id}` returns one catalog record. Unknown IDs are a 404; a
known source target without local data is a 200 catalog record with
`availability: "missing"`.

`POST /v1/trajectory` accepts:

```json
{"bodyIds":["earth"],"startJd":2451545,"endJd":2451910,"samples":64,"frame":"ECLIPJ2000"}
```

The request is limited to 64 bodies, 10,000 samples and a 1,000-year window.
Cancellation is honoured between samples and returns a structured `cancelled`
error. Bodies without a supported model remain in the response with an empty
`states` array and an explicit missing reason; they are not silently dropped.

`GET /v1/preview/manifest` is a deterministic, hash-tagged Pages profile
snapshot. It is not the full data host and does not imply that a full Web or
native endpoint has been deployed.

## Errors

Errors are JSON objects with `apiVersion` and `error.code`/`error.message`.
Clients should branch on codes such as `invalid_limit`, `invalid_page_token`,
`body_not_found`, `unsupported_frame`, `state_unavailable`, and `cancelled`.
