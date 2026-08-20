# Solar Atlas

**A browser-native Solar System dynamics and small-body atlas.**

[Live demo](https://dajiaohuang.github.io/solar/) · [中文文档](./README-CN.md) · [Scientific contract](#scientific-contract)

Current release: **v0.10.0** · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md) · [Performance budgets](./PERFORMANCE.md)

![Solar Atlas overview](./public/readme-screenshot.png)

Solar Atlas connects spatial views, orbital-element space, time events, and data evidence in one reproducible browser workspace. It is built for exploration and teaching—not operational navigation or certified ephemerides.

## What is implemented

- **Visitor layer:** a bilingual first-visit home, three clear starting paths, global object/story/term search (`Ctrl/⌘ K` or `/`), browser-history navigation, descriptive route titles, and a four-item mobile navigation model.
- **Solar Explorer:** heliocentric, geocentric, and arbitrary body-centered frames; linked 2D/3D views; bounded simulation clock; split-frame comparison; distance measurement; time travel; Lagrange points; Hill spheres and Laplace SOIs.
- **Small-Body Catalog:** MPCORB binary shards, two-character prefix search, exact compact-index filters with bounded locator hydration pages, NEO/PHA and orbit-class filters, Lite/Full display budgets, immutable dataset versions, and IndexedDB caching.
- **Orbital Element Space:** linked `a–e`, `a–i`, `a–H`, `q–Q`, and `a–period` plots, Kirkwood/resonance markers, brush selection, keyboard point inspection, distribution histograms, and synchronized 3D highlighting.
- **Events Lab:** adaptive, cancellable close-approach, conjunction, opposition, and central-body apsis jobs with local refinement curves, sampling-adequacy warnings, explicit uncertainty semantics, timeline navigation, and CSV/JSON export.
- **Mission Lab:** directionally correct Hohmann baselines in km/s, phase-angle guidance, a residual-checked universal-variable Lambert solver, departure/arrival `v∞`, C3, and a keyboard/click-selectable porkchop map that can apply an opportunity’s dates.
- **Guided Stories:** seven six-stage, observation-first courses that persist across workspaces, highlight relevant controls, reveal explanations on demand, state model boundaries, and finish with a checkpoint.
- **Object atlas:** tabbed Overview, Orbit, Physical, Context, and Sources profiles for major and catalog bodies, with provenance-aware deep links and explicit NEO risk wording.
- **Reproducibility:** v3 scene URLs record dataset version, epoch, reference frames, focus set, filters, active guided-story step, mission endpoints/dates, language, and view settings. Complete scenes can also be saved locally and exported/imported as versioned JSON.
- **Installable and discoverable web app:** first-install offline shell, update prompt, Web App Manifest, Open Graph image, JSON-LD, bilingual static knowledge/object pages, sitemap, and code-split workspaces.
- **Release evidence:** every build exposes application version, commit SHA, build time, pinned dataset, parser identity, machine-readable scientific benchmark results, asset hashes, and a Pages capacity report. Deployment also preserves Lighthouse reports and enforces stable byte, accessibility, and responsiveness budgets.

## Explore a reproducible scene

- [Explain Mars retrograde motion](https://dajiaohuang.github.io/solar/?v=3&page=stories&story=retrograde-mars&step=2&lang=en)
- [Read the Kirkwood gaps in element space](https://dajiaohuang.github.io/solar/?v=3&page=stories&story=kirkwood-gaps&step=1&lang=en)
- [Compare the four NEO orbit classes](https://dajiaohuang.github.io/solar/?v=3&page=stories&story=neo-types&lang=en)
- [Inspect Pluto and Neptune's 3:2 geometry](https://dajiaohuang.github.io/solar/?v=3&page=stories&story=pluto-resonance&step=1&lang=en)
- [Open an Earth-to-Mars mission setup](https://dajiaohuang.github.io/solar/?v=3&page=mission&from=earth&to=mars&depart=2026-11-15&arrive=2027-08-01&lang=en)

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

Local application builds omit the generated catalog by default. To reproduce the deployable GitHub Pages artifact, including only the pinned active release with large JSON shards delivered as `.json.gz`, run:

```bash
npm run build:deploy
npm run check:capacity
```

## Data publication v3

Application deployment and data publication are separate workflows.

```text
application: validate pinned data → lint → unit + scientific tests → build → E2E + Lighthouse → deploy

dataset: download source snapshot → SHA-256 → parse → semantic validation
       → lint + unit + build + E2E + benchmark → immutable GitHub release → commit pin directly to main
       → explicitly dispatch the production deployment
```

Each release lives under `public/data/asteroids/releases/<version>/` and contains:

```text
manifest.json
provenance.json
checksums.json
validation-report.json
binary/*.bin         # eight Float64 orbital values per record
meta/*.json          # names, classifications, H, NEO/PHA flags
search/*.json        # two-character prefixes, 10k-number ranges, provisional-year indexes
lookup/*.json        # stable-ID buckets for deep-link hydration
catalog-index.bin    # compact numeric filter/count index; no name metadata
catalog-sample-*.bin # precomputed 30k desktop / 8k mobile orbital samples
catalog-sample-*.json
catalog-summary.json
```

`dataset-version.json` is the small mutable pointer inside the downloaded data package. GitHub Pages deploys the exact immutable release described by `.github/asteroid-dataset.json`, verifies the archive SHA-256 before extraction, validates internal data, and fails closed when the audited pin is missing or invalid.
The publisher creates a deterministic tar/gzip archive, refuses to overwrite an existing release version, verifies any reused Release asset against the locally expected SHA-256, and swaps the active pointer only after every artifact and validation report has been written.
The default release identity includes the final data-artifact content SHA-256 and parser version. Lite membership is a stable permanent-number cutoff plus a required curated target set, never the first N records in a mutable upstream ordering.
Permanent-number search shards contain at most a 10,000-number range; provisional designations use year shards, and normalized name/designation tokens use two-character prefixes with row locators. The validator binds every search and lookup locator back to its exact source metadata row and semantic bucket.

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

- **Catalog Mode** loads its precomputed 30,000 desktop / 8,000 mobile stratified sample only after Catalog or Element Space opens. A persistent worker scans the compact index, then each explicit exact-result page hydrates at most 480 records from 32 unique shards. Broad-filter point clouds keep using the precomputed sample; text search uses two-character locator indexes, and decoded detail shards remain in an eight-entry LRU.
- **Focus Mode** renders the first 160 selected objects with full trajectories, labels, details, and bounded analysis. Catalog-wide selection stores the dataset version plus filter expression and count instead of enumerating every ID.

Absolute-magnitude filtering has an explicit known/unknown/all state. Unknown H values are never fabricated as a numeric value and are excluded from the numeric `a–H` scatter plot.

The simulation clock is not React state updated every animation frame. React receives a throttled snapshot, while trajectory history runs independently in a cancellable worker. Worker payloads use transferable typed arrays.

## Scientific contract

| Capability | Model and scope |
| --- | --- |
| Major planets | JPL approximate mean elements and secular rates for 1800–2050; out-of-range dates show an extrapolation warning |
| Moons/dwarfs | Rounded curated educational elements, explicitly labeled `curated-approx`, with parent-body recursion |
| MPCORB/SBDB bodies | Elliptic (`0 ≤ e < 1`) osculating elements only; parabolic/hyperbolic records are rejected explicitly |
| Moon phase | Sun–Earth–Moon phase angle plus signed geocentric elongation |
| Hill sphere | `a(1-e)(m/3M)^(1/3)` |
| Laplace SOI | `a(m/M)^(2/5)`; never labeled as a Hill sphere |
| Hohmann | Coplanar circular endpoints, impulsive solar two-body model; signed burns and km/s conversion |
| Lambert | Zero-revolution universal-variable solar two-body solution using approximate endpoint positions; only residual-converged solutions are returned |
| Event search | Adaptive non-endpoint candidates followed by bounded local refinement and fresh two-body propagation; reports capped/insufficient sampling and exports numerical refinement half-width separately from physical uncertainty, which is not estimated |
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
npm run test:scientific
npm run test:e2e
npm run build
npm run ci
npm run benchmark:catalog
npm run check:capacity
```

Unit coverage includes Julian dates, Kepler propagation, parent/reference frames, Hohmann units/direction, Moon phase geometry, Hill/SOI definitions, strict JPL SBDB fixtures, local event-extremum detection, Lambert circular-arc recovery, v2/v3 deep-link round trips, versioned scene-library persistence, MPCORB parsing, scoped persistence, manifest/cache isolation, and a one-million-row bounded catalog scan. The scientific subset publishes its exact JPL Horizons, Lambert, and ephemeris status into the build. Playwright covers browser history, persistent guided stories, global search, saved scenes, story/mission URLs, interactive porkchop selection, catalog filtering/recovery, worker and WebGL fallback, first-install offline behavior, cache isolation, and serious/critical axe violations. A scheduled matrix repeats the suite in Firefox and WebKit; the deploy gate additionally audits the home and a static exhibit with Lighthouse CI.

## Deployment

- The project is maintained directly on `main`; local changes should pass `npm run ci` before they are pushed.
- `.github/workflows/data-refresh.yml` publishes a monthly/manual immutable dataset release, commits its pin directly to `main`, and explicitly dispatches deployment.
- `.github/workflows/deploy.yml` is the single production gate. It validates the pinned data, builds its compressed delivery form, enforces Pages and browser budgets, runs lint/unit/scientific/E2E/Lighthouse checks, archives release evidence, deploys, and opens a deduplicated incident if production smoke fails.
- `.github/workflows/rollback.yml` restores the exact tested `github-pages` artifact from a successful deployment run ID; deployment artifacts are retained for 30 days.
- `main` allows normal and Actions pushes, rejects force pushes and deletion, and does not require pull requests or pre-merge status checks.

## License

Source code is available under the [MIT License](./LICENSE). Astronomical source data remains subject to its originating institution’s terms and attribution.

See [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and [CITATION.cff](./CITATION.cff) for contribution, disclosure, and citation guidance.
