# solar

solar is a React + TypeScript + Vite app for visualizing realistic Solar System trajectories on a 2D plane with selectable reference bodies.

- Realistic major-planet and dwarf-planet orbital parameters
- Large asteroid catalog workflow (MPCORB preprocessing + chunked loading)
- Web Worker trajectory computation + WebGL rendering
- Full-screen visualization stage with left-side drawer controls
- Asteroid bidirectional lazy window loading (scroll down for next, scroll up for previous)
- "Loaded but not rendered" asteroid behavior (manual selection required for drawing)

For Chinese documentation, see `README-CN.md`.

---

## Requirements

- Node.js 18+ (20+ recommended)
- npm 9+

---

## Quick Start

```bash
npm install
npm run dev
```

Then open the local URL from terminal output (typically `http://localhost:5173`).

---

## Build Asteroid Dataset (First Time)

To enable the full asteroid catalog, run:

```bash
npm run preprocess:asteroids
```

The script will:

1. Download `MPCORB.DAT.gz` from Minor Planet Center
2. Parse orbital elements and classification flags
3. Generate frontend-ready chunked files under:
   - `public/data/asteroids/chunks/*.json`
   - `public/data/asteroids/search/*.json`
   - `public/data/asteroids/manifest.json`

Optional environment variables:

- `MPCORB_CHUNK_SIZE`: records per chunk (default `5000`)
- `MPCORB_LIMIT`: process only first N records (debug usage)

Example:

```bash
MPCORB_LIMIT=30000 npm run preprocess:asteroids
```

---

## Interaction Model

### Full-screen stage

- The app is locked to single-screen layout (no page-level vertical scrolling)
- Mouse wheel over the main canvas zooms around cursor position
- Use `Menu` button to open the left-side control drawer

### Drawer sections

- `Overview`: reference body, simulation time/date, max relative distance
- `Controls`: reference body, history range, playback speed, zoom, play/pause
- `Major Bodies`: preset groups + manual selection
- `Asteroids`: search, class filter, lazy catalog browsing
- `Loaded`: currently loaded and pinned asteroid bodies

### Asteroid loading behavior

- Loading a partition does **not** auto-render those asteroids
- Asteroids are rendered only after manual selection
- Scrolling near bottom loads later entries
- Scrolling near top restores earlier unloaded entries
- Window overflow evicts unselected out-of-window asteroids
- Previously selected asteroids are preserved

---

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run preprocess:asteroids
```

---

## Project Structure (Core)

```text
src/
  components/
    TrajectoryCanvas.tsx    # WebGL rendering layer
    CatalogPanel.tsx        # Asteroid panel + bidirectional lazy list
  hooks/
    useTrajectoryWorker.ts  # Worker request/response orchestration
  workers/
    trajectory.worker.ts    # Background orbit/trajectory calculations
  lib/
    ephemeris.ts            # Orbital mechanics and solvers
    trajectory.ts           # Sampling and frame-building logic
    referenceFrame.ts       # Relative frame transforms
    viewProjection.ts       # Projection/unprojection with view offset
    catalogLoader.ts        # Chunk/search/cursor-based loading
  data/
    majorBodies.ts          # Major planets + dwarf planets
  App.tsx                   # Full-screen stage + drawer app shell

scripts/
  preprocess-asteroids.mjs  # MPCORB preprocessing pipeline
```

---

## Data Sources

- JPL approximate planetary elements
- JPL SBDB-derived Keplerian elements
- MPCORB (Minor Planet Center asteroid catalog)

> This project is for visualization and educational exploration, not high-precision ephemeris integration.
