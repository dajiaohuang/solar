# Shared computation and streamed histories

This update changes execution and delivery around the existing scientific
engine. Source files, manifests, scientific fixtures, SPK coefficient arithmetic,
reference frames and source-selection priority remain unchanged.

## Evaluation and scheduling

`Catalog.EvalBatchContext` returns states and their actual selected kernel,
segment window and center together. Root selection and center-chain resolution
share an epoch-local coefficient cache. Evidence no longer triggers a second
numerical evaluation. Cancellation propagates through both phases.

A Catalog-owned 16 MiB LRU reuses successful state/evidence values by canonical
NAIF target and exact Float64 TDB epoch. Each Catalog is an immutable source
namespace. Alias spelling, selection order and tile layout do not enter the
numerical cache key. Missing, failed and cancelled evaluations are not cached
as scientific results. Concurrent cold requests may still perform duplicate
work; this cache is not a single-flight task coordinator.

HTTP admission remains controlled by `-max-concurrent` (default 8). A separate
`-compute-workers` flag controls evaluation blocks; zero follows `GOMAXPROCS`.
State plans above 1,024 IDs split into independently scheduled blocks, with up
to four blocks in flight per request. Time windows look ahead by at most four
epochs. The existing weighted 4:2:1 interactive/trajectory/bulk policy applies
at block boundaries. Queue capacity and timeout remain bounded. Encoding and
socket writes do not retain a CPU lease. This is cooperative scheduling, not
a hard latency guarantee or a tuned worker-count recommendation.

`GET /v1/catalog/manifest`, `/v1/health/live` and `/v1/health/ready` bypass
expensive-request admission. Readiness means the service has initialized its
configured metadata; it does not certify lazy kernel coverage or prewarming.
During shutdown, readiness and new work return 503 while liveness remains 200.
SIGTERM/interrupt stops admission, gives active HTTP work 30 seconds to drain,
then closes connections if necessary. Shared kernel files close only after
their active handlers return. An OS file read already in progress has no hard
cancellation bound.

## Multi-epoch protocol

Full Web histories use `POST /v1/state/window` with:

```json
{
  "ids": ["naif:10", "naif:399", "naif:301"],
  "epochsJd": [2461287.5, 2461287.51, 2461287.52],
  "timeScale": "TDB",
  "frame": "ECLIPJ2000",
  "precision": "exact",
  "fieldMask": ["position", "velocity"]
}
```

Limits are 1–1,024 unique IDs, 1–1,024 strictly increasing finite epochs, and
262,144 body-epoch pairs. Unsupported precision/frame/field combinations fail
before streaming. Epochs are explicit; the server does not reinterpret UTC or
invent a sampling grid. The current history client converts its existing UTC
grid to TDB with the existing conversion.

The response media type is `application/vnd.solar.state-window+binary`. Every
frame starts with a four-byte unsigned little-endian payload length. Frames are:

1. JSON `kind: "window"`, `version: 1`, `epochCount`, `bodyCount`,
   `requestIdsSha256` and `catalogManifestSha256`.
2. For each epoch in request order: JSON `kind: "epoch"`, zero-based
   `epochIndex` and `plan`, followed by exactly `plan.tileCount` ordinary
   [v1 binary tile](./state-tiles-v1.md) frames.
3. JSON `kind: "complete"`, `epochCount`, `bodyCount`, `exactCount` and
   `missingCount`. Counts cover body-epoch pairs, including explicit missing
   rows. EOF must immediately follow the completion frame.

The per-epoch plan uses a tile size of 1,024. Its request hash, catalog and
inventory identities, epoch, member ranges, status partition and payload
checksums are validated by the existing Web validators. Each verified epoch
is consumed before reading the next. Metadata frames are bounded to 8 MiB;
binary frames to 64 MiB. A missing/invalid completion, changed source identity,
out-of-order epoch, corrupt tile, truncated frame or trailing bytes fails the
whole history. A server-side error can terminate the stream or emit an error
envelope; neither constitutes completion. No fallback browser computation is
started. Cancellation retains page-wide transfer admission until the stream
has actually stopped.

This endpoint progressively delivers verified epochs. Current observations
still publish complete selections atomically; histories still publish only
after their whole requested grid verifies. A gap still suppresses that body's
whole trail. The endpoint is not a durable background job or an offline bundle.

## Display behavior

On a failed time refresh, Web retains the last verified frame and its published
epoch. The requested epoch, update error and actual rendered epoch remain
distinct. Changing backend, selection, references or source pin immediately
hides an incompatible retained frame. No old/new epoch coordinates are mixed.

The 3D renderer coalesces scene mutations into a scheduled animation-frame
draw. Capture explicitly flushes pending changes. Point picking caches a packed
screen-space index for the current geometry/camera/viewport revision instead
of projecting the whole cloud for every mouse move. Candidate distances and
tie order remain deterministic; very dense overlapping cells can still require
linear candidate scanning. This is not a million-point device-performance claim.

## Reproduction and evidence

```text
node scripts/stage-backend-profile.mjs <new-output-directory> full
go run ./cmd/window-bench -data-dir <new-output-directory> -samples 24 -output <report.json>
go test ./cmd/... ./internal/...
go vet ./cmd/... ./internal/...
npx vitest run tests/unit/backend-trajectories.test.ts tests/unit/render-scheduling.test.ts
```

With a separately running loopback backend, set `SOLAR_TEST_BACKEND_URL` and run
`npx vitest run tests/unit/state-window-live.test.ts`, or the real-backend
Playwright test in `tests/e2e/state-tiles-live.spec.ts`.

The [retained local report](./validation/shared-compute-20260910.json) used
619 distinct NAIF targets and 24 hourly epochs: 14,856 exact body-epoch pairs,
zero missing. Sequential delivery made 48 HTTP requests; the window made one
(manifest discovery is excluded from both). Ordered complete tile bytes have
the same SHA-256 in both modes. These counts describe this pinned profile and
window, not all identifiable bodies or general source coverage.

The report includes measured first-tile and total times. It ran sequential
delivery first and streaming second, with new Catalog instances but an
uncontrolled OS file cache. Those times are local observations, not an isolated
parallelism speedup, production load test or hardware guarantee.

Local validation completed with Go package tests and vet, `npm run ci`,
repository and capacity checks, and the native static check. The complete
Playwright suite against the loopback backend passed 188 tests with two skipped.
The live Go-to-TypeScript window validation also passed. Go's race detector
could not run because this environment has CGO disabled and no C compiler;
native compilation and physical-device testing were not performed.

## Remaining architectural work

Selection handles, durable full-snapshot jobs, same-generation partial current
frames, position-only/dictionary wire formats, persisted inventory indexes,
Events/Mission migration and complete native offline recovery remain separate
work. Existing native v1 clients continue to use plan/tile delivery. No native
feature parity, physical-device validation or deployment milestone is claimed
by this change.
