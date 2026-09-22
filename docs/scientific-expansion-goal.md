# Scientific expansion and real-time scale

Owner-authorized goal, 2026-09-22 (Asia/Singapore). Implementation tracker, not a
claim that the proposed capabilities already exist. Deployment and publication
remain paused. Changes may go directly to main after the required checks.

## Acceptance ledger

| Workstream | Required observable outcome | Status |
| --- | --- | --- |
| Shared analysis ephemeris | Events, curves and mission endpoints use a frozen source contract, expose actual per-body models, offer strict SPK coverage, and export time/frame/source evidence; shared backend integration follows | In progress |
| Ground observer | Geodetic station, SOFA-compatible celestial/terrestrial transforms, versioned IERS EOP, vacuum/apparent altitude-azimuth, rise/set and visibility windows; source expiry and uncertainty remain visible | Pending |
| Orbit uncertainty | Pinned SBDB covariance with labels, units and solution epoch; validated covariance propagation and sampling; uncertainty ellipsoids and event distributions, independent of numerical tolerance | Pending |
| Occultations and eclipses | Source-backed radii/orientation and stellar astrometry; bounded contact/window search, missed-event and physical-error reporting, independent reference cases | Pending |
| Dynamics laboratory | Explicit initial conditions, force models and parameters; validated selected-target integration, non-gravitational terms where sourced, resonance/stability diagnostics and reproducible exports | Pending |
| Scientific data | Audit and extend useful SPK windows, genuine spacecraft trajectories, non-elliptic comet support, physical parameters and spatially chunked Gaia data; never fabricate missing states or mutate immutable releases | Pending |
| Catalog streaming | Replace the fixed 8k/30k-only cloud path with cancellable binary chunk loading, priority scheduling and independent byte/decode/compute/upload limits | Pending |
| Rendering and time | Moving spatial bounds, visibility/LOD, selected-body retention, time/error-budgeted updates, reusable buffers and Float64-relative GPU coordinates; WebGL fallback and native contracts retained | Pending |
| Capacity evidence | Real catalog runs at 30k/100k/300k/1m/full inventory, real SPK coverage and separately labeled synthetic GPU stress; P95/P99 frames, memory, first-visible time, upload and cancellation measurements | Pending |

Full completion requires implementation, user-facing access, source ingestion,
scientific references and appropriate integration evidence for each row. A model
module, design document, fixture-only test or configurable point ceiling is not
completion. Hardware that has not been exercised remains an explicit evidence
gap. Do not claim physical accuracy from numerical agreement.

## Starting evidence and corrections

- Baseline: `e2272c2a2fef96253c6d990039a20068b3751d62`.
- The audited MPC release has 1,561,171 records. Immutable display samples are
  8,000 mobile / 30,000 desktop. Higher display budgets are not delivery proof.
- Event and Lambert code already consults loaded SPK kernels. The next change
  must improve explicit source policy, consistency and evidence rather than
  duplicate that capability. Existing README model descriptions understate it.
- Source-backed states and provenance already share backend evaluation caches;
  bounded tile admission, persistent point workers and GPU point buffers exist.
- Current GPU cloud buffers are drawn by prefix and not spatially culled.
- N-body research is now an explicitly requested extension to the earlier
  no-N-body product scope; it must remain distinct from authoritative SPK queries.

## Validation and delivery

Develop coherent slices, run relevant numerical/contract/interaction tests while
iterating, and run the required broad checks once for a completed staging head.
Keep production/data release workflows paused. Record completion evidence and
remaining work here; never mark the overall goal complete with pending rows.

### Checkpoint 1: explicit analysis source contract (2026-09-23)

Implemented the shared Web analysis provider, strict/labeled fallback policy,
frozen whole-window kernel selection, actual per-body model evidence, mission
position/velocity reuse, bounded epoch caching, TDB elapsed flight time and
source-bearing event/transfer exports. Curves use the event's original policy.
Porkchop selections retain their original endpoints rather than whichever
endpoints the user subsequently selected.

Targeted checks: 27 numerical/cache/worker tests across seven files, TypeScript
and changed-file ESLint, production build, and six desktop/mobile Chromium
checks covering strict missing-state errors, approximate exports and the existing
Earth-to-Mars mission flow. The SPK contract test reads the checksum-pinned real
DE440 core; it checks resolver consistency, not independent physical accuracy.
No new capacity/FPS claim is made. Broad CI is required before main promotion.

Still outstanding in this workstream: backend-owned analysis jobs, automatic
bounded source preflight instead of relying on the loaded browser pool, native
consumption, and independent event-oracle validation. The other ledger rows
remain pending; this checkpoint does not complete the overall goal.

Primary design references: [SOFA](https://www.iausofa.org/cookbooks),
[IERS EOP](https://data.iers.org/eop.php),
[JPL SBDB](https://ssd-api.jpl.nasa.gov/doc/sbdb.html),
[SPICE Geometry Finder](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html),
[ASSIST](https://assist.readthedocs.io/en/latest/),
[Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3).
JPL SSD ingestion must obey its
[single-request fair-use policy](https://ssd-api.jpl.nasa.gov/doc/index.php).
