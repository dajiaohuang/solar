# Real MPC catalog in the Observation Deck

Completed on 2026-09-29 with the real pinned MPC release and a local Go backend.
This is a bounded desktop-browser integration measurement, not a synthetic point
cloud, production-network measurement or hardware smoothness certification.

- [Raw measurements](explorer-capacity.json): dataset/manifest identity, CPU,
  browser/software renderer, computed population, point submissions, epoch
  advancement and individual RAF intervals.
- [Source fingerprints](implementation.json): relevant source/configuration bytes.
- Captures: [3D](catalog-3D.png), [2D](catalog-2D.png).
- Interpretation and limits: [direction receipt](../../direction-correction-20260929.md).

The observed renderer was SwiftShader. Both modes computed 1,561,171 bodies;
the adaptive display budget settled at 280,000 catalog points at capture time.
The largest 2D point call includes eight focus markers. Different viewports,
drivers, devices and camera positions can change both visible density and cost.

## Reproduction

Prepare a local backend data directory containing the current manifests and
their declared SPK paths, plus ephemerisBodies.json/sourceOnlyBodies.json. The
measurement used .cache/explorer-capacity-backend-20260929 with hard links to
unmodified local SPKs; all 685 full-profile kernel paths were present. Start
the backend on loopback, then run this single opt-in browser case:

```powershell
rtk proxy go run ./cmd/solar-backend -data-dir .cache/explorer-capacity-backend-20260929 -listen 127.0.0.1:8790
```

In another terminal, with the pinned dataset under public/data/asteroids:

```powershell
rtk proxy npm.cmd exec -- cross-env SOLAR_REAL_CATALOG_CHECK=1 SOLAR_AUDIT_BACKEND_URL=http://127.0.0.1:8790 playwright test tests/e2e/explorer-capacity.spec.ts --project=desktop-chromium --workers=1
```

The test serves source bytes locally, builds a test-only backend URL into the
frontend, advances time, captures up to 120 intervals or six seconds per mode,
and returns to the fixed sample. Normal E2E runs skip this opt-in case. Do not
publish its test-only build as a deployed application.
