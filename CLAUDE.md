# Solar Atlas contributor guide

Solar Atlas is a React 19 + TypeScript 6 + Vite 8 scientific visualization application. It is a client-side, route-level code-split app with no server runtime.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run test:unit
npm run test:e2e
npm run build
npm run ci

npm run data:lite
npm run data:full
npm run validate:data
```

The Vite base path is `/solar/`. Playwright starts its own development server. The asteroid commands download or consume MPCORB, validate it, and publish versioned artifacts under `public/data/asteroids/releases/` plus an atomic `dataset-version.json` pointer.

Useful pipeline environment variables are `MPCORB_SOURCE_FILE`, `MPCORB_SOURCE_URL`, `MPCORB_OUTPUT_DIR`, `MPCORB_DATASET_VERSION`, `MPCORB_CHUNK_SIZE`, `MPCORB_LITE_MAX_NUMBER`, and `MPCORB_REFRESH=1`.

## Architecture

- `src/app/` — providers, route shell, lazy workspaces, and the shared body registry.
- `src/features/` — Explorer, Catalog, Element Space, Events, Mission Lab, Stories, and Evidence/About workspaces.
- `src/engine/` — simulation clock, ephemerides, units, spheres of influence, Hohmann, and Lambert calculations.
- `src/workers/` — cancellable trajectory, event-analysis, and porkchop workers. Large trajectory results use transferable typed arrays.
- `src/state/` — small external stores for simulation, selection, catalog, and UI state.
- `src/data/` — curated major-body/spacecraft data, physical properties, catalog loaders, and IndexedDB cache support.
- `src/components/TrajectoryCanvas.tsx` — raw WebGL 2D renderer and GPU point-catalog view.
- `src/components/TrajectoryCanvas3D.tsx` — persistent Three.js scene graph; do not recreate the renderer or scene on each clock tick.
- `src/lib/renderBudget.ts` — pure mobile/desktop and 2D/3D point-budget policies plus the frame-window adaptation state machine.
- `src/i18n/` — the single bilingual translation source. Add keys to both `en.ts` and `zh.ts`.
- `scripts/preprocess-asteroids.mjs` — strict fixed-width MPCORB parser and immutable binary-shard publisher.

## Scientific and state contracts

- Internal distances are AU, dates are Julian days, and mission velocity outputs are km/s. Convert only through `src/engine/units.ts`.
- MPCORB and SBDB production paths accept bound elliptic solutions only (`0 <= e < 1`, `a > 0`). Unsupported conics must fail visibly.
- Position resolution is heliocentric first, including parent-body chaining, then transformed into the chosen reference frame. Do not mix frame-relative and absolute coordinates.
- The simulation clock lives outside React and publishes throttled snapshots. Do not drive orbital recomputation with a component-level `requestAnimationFrame` loop.
- Keep current-state coverage independent from historical trail/detail budgets (160 in 3D, 320 in 2D). All selected resolvable positions remain visible; extra 3D positions share a fixed-pixel point buffer, while catalog points stay a separately identified approximate layer. Labels and individual meshes must stay bounded. The default Explorer must not fetch a catalog sample until the cloud is explicitly enabled.
- Browser memory and CPU values may only lower an initial adaptive budget. Frame timing is authoritative, and hardware-specific smoothness claims require measured evidence.
- Preserve the first-visit renderer gate: the untouched onboarding choice uses the lightweight spatial preview, while tutorial/explore/dismiss actions and completed onboarding activate the real 3D renderer.
- Heavy analyses are explicit, cancellable worker jobs. UI parameter changes must not silently rerun them.
- Results and exports must state their model, epoch/window, units, and approximation limits.
- Validate the current scene contract in `src/lib/urlState.ts`. Old-client/API/scene compatibility is not required (owner direction, 2026-09-05); retain scientific source identities and explicit unsupported-state errors, not compatibility-only layers.

## Verification

Every behavior change should at least pass `npm run ci`. Add deterministic unit tests for scientific formulas and parsers, and update `tests/e2e/app.spec.ts` for user-visible route or workflow changes. For renderer/UI changes, inspect both desktop and mobile breakpoints in a real browser and ensure console errors remain empty.
