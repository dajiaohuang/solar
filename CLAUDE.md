# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands

```bash
npm install
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript check + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint across the project
npm run preprocess:asteroids   # Download MPCORB.DAT.gz, generate chunked asteroid JSON
```

Optional env vars for asteroid preprocessing: `MPCORB_CHUNK_SIZE` (default 5000), `MPCORB_LIMIT` (debug: process only N records).

## Architecture

This is a single-page React 19 + TypeScript 6 + Vite 8 app that visualizes Solar System trajectories on a 2D plane. The UI is Chinese-localized. No router, no state management library — all state lives in `App.tsx`.

### Rendering pipeline

1. **Orbit computation** (`src/lib/ephemeris.ts`) — Two orbit models: `planetaryApprox` (JPL approximate elements with century-rate tables for major planets) and `keplerian` (Keplerian elements at epoch for moons, dwarf planets, asteroids). Both resolve to heliocentric 3D positions via Kepler's equation. Parent-body chaining supports moons.

2. **Reference frames** (`src/lib/referenceFrame.ts`) — Converts absolute 3D positions to relative positions centered on the selected reference body. Projects 3D → 2D by dropping Z. Also computes suggested view radius from aphelion estimates.

3. **Trajectory building** (`src/lib/trajectory.ts`) — Samples positions over a time window to produce trajectory line strips. Maintains an in-memory LRU cache (max 40 entries) keyed by body IDs + parameters. `getRecommendedSampleCount()` scales sample count inversely with number of displayed bodies to keep computation bounded.

4. **Web Worker** (`src/workers/trajectory.worker.ts`, `src/hooks/useTrajectoryWorker.ts`) — Trajectory computation runs off the main thread. The hook spawns a worker, posts compute requests with a monotonically increasing request ID, and ignores stale responses. Worker termination lags out-of-date computations.

5. **WebGL rendering** (`src/components/TrajectoryCanvas.tsx`) — Raw WebGL 1.0 (no library) with inline GLSL shaders. Trajectories drawn as `LINES`, body positions as round `POINTS` (discard outside radius in fragment shader). HTML overlay labels for a subset of bodies (max 18 major + 6 asteroid labels). ResizeObserver keeps canvas dimensions in sync with container.

6. **View projection** (`src/lib/viewProjection.ts`) — AU → pixel coordinate mapping with configurable zoom and pan offset. Mouse-wheel zoom centers on cursor position by unprojecting/reprojecting.

### Asteroid catalog system

- **Preprocessing**: `scripts/preprocess-asteroids.mjs` downloads MPCORB.DAT.gz from the Minor Planet Center, decodes packed-date epochs, parses orbital elements, classifies by orbit type (MBA, NEO subtypes, TNO, Trojans, etc.), and outputs chunked JSON files under `public/data/asteroids/` — `chunks/` (full records), `search/` (index entries bucketed by first character), and `manifest.json`.

- **Frontend loading** (`src/lib/catalogLoader.ts`) — Bidirectional lazy window: scrolling near bottom loads the next page forward; scrolling near top restores previously evicted pages backward. Window capped at 108 records; unselected asteroids outside the window are evicted. Selected asteroids persist in `loadedCatalogBodies` even when evicted from the window. Search uses bucketed index files keyed by first alphanumeric character + digit bucket.

- **Key behavior**: Loading an asteroid partition/chunk does NOT auto-render those asteroids — they must be manually selected. This prevents overwhelming the WebGL renderer.

### Major body data

`src/data/majorBodies.ts` — Hardcoded orbital elements for Sun, 8 planets, Moon, Ceres, Pluto, Eris, Haumea, Makemake. Planets use JPL `planetaryApprox` model; moons and dwarfs use `keplerian`.

### App.tsx state structure

- `referenceId` — central reference body (default: sun)
- `selectedMajorBodyIds` / `selectedCatalogIds` — which bodies are drawn
- `simOffsetDays` — time offset from today, driven by `requestAnimationFrame` playback loop
- `zoomLevel` / `viewOffsetAU` — camera transform
- `loadedCatalogBodies` — asteroid records converted to CelestialBody objects
- `sectionPages` — current bidirectional window of catalog records (with cursors for prev/next pagination)

The drawer (left sidebar) has 5 sections: Overview, Controls, Major Bodies, Asteroids, Loaded.

### TypeScript configuration

Strict mode with `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`. Types are in `src/types.ts` — no separate types package.
