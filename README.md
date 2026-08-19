# Solar Atlas

**A browser-native Solar System dynamics and small-body atlas.**

[Live demo](https://dajiaohuang.github.io/solar/) · [中文文档](./README-CN.md) · [Scientific contract](#scientific-contract)

![Solar Atlas overview](./public/og-image.svg)

Solar Atlas connects spatial views, orbital-element space, time events, and data evidence in one reproducible browser workspace. It is built for exploration and teaching—not operational navigation or certified ephemerides.

## What is implemented

- **Solar Explorer:** heliocentric, geocentric, and arbitrary body-centered frames; linked 2D/3D views; bounded simulation clock; split-frame comparison; distance measurement; time travel; Lagrange points; Hill spheres and Laplace SOIs.
- **Small-Body Catalog:** MPCORB binary shards, name/number/designation search, NEO/PHA and orbit-class filters, numerical filters for `a`, `e`, `i`, `H`, and `q`, Lite/Full display budgets, immutable dataset versions, and IndexedDB caching.
- **Orbital Element Space:** linked `a–e`, `a–i`, `a–H`, `q–Q`, and `a–period` plots, Kirkwood/resonance markers, brush selection, and synchronized 3D highlighting.
- **Events Lab:** explicit, cancellable close-approach, conjunction, opposition, perihelion, and aphelion jobs with progress, cached results, timeline navigation, and CSV/JSON export. Playback never restarts an analysis.
- **Mission Lab:** directionally correct Hohmann baselines in km/s, phase-angle guidance, a universal-variable Lambert solver, departure/arrival `v∞`, C3, and a worker-generated porkchop map.
- **Guided Stories:** reproducible JSON stories for retrograde motion, reference frames, Kirkwood gaps, Trojans, NEO types, Pluto’s resonance, and Voyager-era trajectories.
- **Reproducibility:** scene URLs include dataset version, epoch, reference frames, focus set, filters, language, and view settings.
- **Installable web app:** responsive/mobile Lite layout, runtime offline cache, Web App Manifest, Open Graph metadata, and code-split workspaces.

## Quick start

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

The app works without a local asteroid dataset using the curated major-body model. To add a reproducible Lite dataset:

```bash
npm run data:lite
npm run validate:data
npm run dev
```

To build all valid elliptic MPCORB records:

```bash
npm run data:full
```

The full pipeline needs several GB of free memory and downloads the current MPCORB source snapshot once. You can supply a pinned source file with `MPCORB_SOURCE_FILE=/path/to/MPCORB.DAT.gz`.

## Data publication v2

Application deployment and data publication are separate workflows.

```text
application: lint → unit tests → build → deploy pinned dataset tag

dataset: download source snapshot → SHA-256 → parse → validate
       → Float64 binary shards + metadata/search/lookup indexes
       → immutable GitHub release → pin release tag → deploy
```

Each release lives under `public/data/asteroids/releases/<version>/` and contains:

```text
manifest.json
provenance.json
checksums.json
validation-report.json
binary/*.bin         # eight Float64 orbital values per record
meta/*.json          # names, classifications, H, NEO/PHA flags
search/*.json        # token initials, 10k-number ranges, provisional-year indexes
lookup/*.json        # stable-ID buckets for deep-link hydration
```

`dataset-version.json` is the small mutable pointer inside the downloaded data package. The GitHub Pages workflow never downloads a changing MPCORB file; it deploys the exact immutable release committed in `.github/asteroid-dataset-tag` and fails closed when that audited pin is missing or invalid.
The publisher refuses to overwrite an existing release version and swaps the active pointer only after every artifact and validation report has been written.
The default release identity includes the final data-artifact content SHA-256. Lite membership is a stable permanent-number cutoff plus a required curated target set, never the first N records in a mutable upstream ordering.
Permanent-number search shards contain at most a 10,000-number range; provisional designations use year shards, and every normalized name/designation token is indexed by its own initial.

Optional pipeline variables:

| Variable | Meaning |
| --- | --- |
| `MPCORB_SOURCE_FILE` | Existing pinned `.gz` or plain MPCORB source |
| `MPCORB_SOURCE_URL` | Alternate source URL |
| `MPCORB_DATASET_VERSION` | Explicit immutable version string |
| `MPCORB_CHUNK_SIZE` | Records per binary shard; default 5,000 |
| `MPCORB_LITE_MAX_NUMBER` | Stable Lite cutoff by permanent number; featured targets are always added |
| `MPCORB_REQUIRE_FEATURED=0` | Disable required-featured validation for isolated fixtures only |
| `MPCORB_MODE` | `lite` or `full` |
| `MPCORB_REFRESH=1` | Replace the cached raw snapshot |

## Architecture

```text
src/
  app/                 shell, route loading, providers, body registry
  features/
    explorer/          2D/3D spatial workbench and controls
    catalog/           small-body discovery and GPU catalog mode
    element-space/     linked quantitative plots and brushing
    events/            explicit analysis jobs and timeline
    mission/           Hohmann, Lambert, porkchop, model ladder
    stories/           JSON-guided scenes
    body-inspector/    elements, phase, influence radii, provenance
    about/             dataset evidence and scientific contract
  engine/
    clock/             external simulation clock (8 Hz UI publication)
    ephemeris/         phase, spacecraft, influence definitions
    mission/           unit-safe Hohmann and Lambert calculations
  state/               independent simulation/selection/catalog/UI stores
  data/                curated bodies, loaders, IndexedDB cache
  workers/             cancellable catalog scan, trajectory, event, porkchop workers
  i18n/                one English/Chinese translation system
pipeline data lives in scripts/preprocess-asteroids.mjs
```

The render paths are intentionally different:

- **Catalog Mode** scans binary columns in a dedicated worker, returns an exact filtered count, and sends only a bounded stratified LOD sample to the main thread (30,000 desktop / 8,000 mobile) for GPU points and tables. Decoded shard objects are retained in an eight-entry LRU only.
- **Focus Mode** renders the first 160 selected objects with full trajectories, labels, details, and bounded analysis. Catalog-wide selection stores the dataset version plus filter expression and count instead of enumerating every ID.

Absolute-magnitude filtering has an explicit known/unknown/all state. Unknown H values are never fabricated as a numeric value and are excluded from the numeric `a–H` scatter plot.

The simulation clock is not React state updated every animation frame. React receives a throttled snapshot, while trajectory history runs independently in a cancellable worker. Worker payloads use transferable typed arrays.

## Scientific contract

| Capability | Model and scope |
| --- | --- |
| Major planets | JPL approximate mean elements and secular rates; broad visualization accuracy |
| Moons/dwarfs | Rounded curated educational elements, explicitly labeled `curated-approx`, with parent-body recursion |
| MPCORB/SBDB bodies | Elliptic (`0 ≤ e < 1`) osculating elements only; parabolic/hyperbolic records are rejected explicitly |
| Moon phase | Sun–Earth–Moon phase angle plus signed geocentric elongation |
| Hill sphere | `a(1-e)(m/3M)^(1/3)` |
| Laplace SOI | `a(m/M)^(2/5)`; never labeled as a Hill sphere |
| Hohmann | Coplanar circular endpoints, impulsive solar two-body model; signed burns and km/s conversion |
| Lambert | Zero-revolution universal-variable solar two-body solution using approximate endpoint positions |
| Event search | Non-endpoint local distance/alignment extrema on a bounded grid, refined by three-point parabolic interpolation; exploratory, not a certified prediction |
| Spacecraft overlays | Milestone-dated schematic tracks labeled separately from Horizons and propagated ephemerides |

JPL SBDB values are parsed from the documented `orbit.elements[]` records (`name`, `value`, `units`, and uncertainty fields), not from invented object properties.

Primary sources:

- [Minor Planet Center MPCORB](https://www.minorplanetcenter.net/iau/MPCORB.html)
- [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
- [JPL approximate planetary positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html)

## Quality gates

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run build
npm run ci
```

Unit coverage includes Julian dates, Kepler propagation, parent/reference frames, Hohmann units/direction, Moon phase geometry, Hill/SOI definitions, strict JPL SBDB fixtures, local event-extremum detection, Lambert circular-arc recovery, versioned deep-link round trips, MPCORB parsing, scoped persistence, manifest/cache isolation, and a one-million-row bounded catalog scan. Playwright runs the core routes, reproducible stories, catalog filtering/recovery, mission workers, Service Worker cache isolation, and 2D/3D renderers on desktop and mobile Chromium.

## Deployment

- `.github/workflows/ci.yml` validates every pull request and push.
- `.github/workflows/data-refresh.yml` publishes a monthly/manual immutable dataset release.
- `.github/workflows/deploy.yml` deploys the app plus the repository’s pinned dataset release with official GitHub Pages actions.

## License

Source code is available under the [MIT License](./LICENSE). Astronomical source data remains subject to its originating institution’s terms and attribution.
