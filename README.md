# Solar Atlas

> **Development direction:** three independent Web, Android and iOS frontend projects sharing one backend. GitHub Pages will use the same Web frontend with curated core features enabled; full-only entries remain visible with an explanation and an invitation to use the full version. The current release is still client-side Web plus Capacitor shells; this migration is not complete. See [product direction and acceptance criteria](./docs/product-direction.md).

**A browser-native Solar System dynamics and small-body atlas with reproducible scenes, traceable data, and explicit model boundaries.**

[![Production deployment](https://github.com/dajiaohuang/solar/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/dajiaohuang/solar/actions/workflows/deploy.yml) [![Android and iOS](https://github.com/dajiaohuang/solar/actions/workflows/mobile.yml/badge.svg?branch=main)](https://github.com/dajiaohuang/solar/actions/workflows/mobile.yml)

[Open Solar Atlas](https://dajiaohuang.github.io/solar/) · [中文文档](./README-CN.md) · [Mobile builds](./MOBILE.md) · [Privacy](./PRIVACY.md) · [Scientific contract](#scientific-contract) · [Contributing](#contributing)

Application version: **v0.11.0** · [Live build identity](https://dajiaohuang.github.io/solar/health.json) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md) · [Performance budgets](./PERFORMANCE.md)

> **Start here:** [open the Observation Deck](https://dajiaohuang.github.io/solar/). The root URL is the application—there is no marketing page or account gate in front of it.

![The Solar Atlas Observation Deck with its 3D scene and preset switchboard](./docs/screenshots/observation-deck.png)

Solar Atlas connects a spatial workbench, orbital-element space, event analysis, mission geometry, guided stories, and data evidence in one client-side application. It is built for exploration and teaching. It is **not** an operational ephemeris, a collision-warning service, an N-body integrator, or a navigation product.

## Start in seconds

| Goal | Fastest path |
| --- | --- |
| Explore immediately | [Open the Observation Deck](https://dajiaohuang.github.io/solar/) and choose **Explore independently** |
| Learn the controls | Open the same URL and choose **Start tutorial**; the four-tip guide can be reopened from the preset panel |
| Try a reproducible lesson | [Explain Mars retrograde motion](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=retrograde-mars&step=2&view=3d&lang=en) or choose another link under [Reproducible scenes](#reproducible-scenes) |
| Run the web app locally | Use `npm ci`, then `npm run dev`; no asteroid dataset is required for the curated core |
| Inspect native validation | Open the [Android/iOS workflow](https://github.com/dajiaohuang/solar/actions/workflows/mobile.yml) or follow the platform commands in [MOBILE.md](./MOBILE.md) |

The root URL opens directly into the **Observation Deck**. There is no marketing page between the visitor and the visualization.

1. A first-time visitor chooses **Start tutorial** or **Explore independently** over a lightweight preview of the ready Observation Deck. The interactive Three.js renderer chunk is downloaded and initialized immediately after that choice, avoiding expensive hidden work behind an untouched prompt.
2. The four-tip tutorial introduces camera movement, reference frames, object selection, and preset scenes. It is shown once and can be reopened from the preset panel.
3. The preset switchboard is open by default. Reference-frame, rendering, body, saved-scene, and export controls remain collapsed under **Advanced controls** until requested.

The initial spatial view is **3D**. Visitors can switch to the batched 2D ecliptic view at any time. If 3D WebGL creation fails or its context is lost, the same scene remains usable through the automatic 2D fallback.

The default deck loads only the curated major-body model and does **not** download an asteroid display sample. Catalog data is requested only after the visitor opens Catalog or Element Space, selects a dataset-backed preset, restores a catalog scene, or explicitly enables the Catalog point cloud.

## Built-in scene presets

Solar Atlas currently ships thirty one-click presets, including seventeen groups covering the satellite identity catalog around sixteen parent bodies, and a 16-large-asteroid scene. Every preset defines an epoch, reference frame, focus set, view, zoom, and trajectory window; dataset-backed presets additionally pin a complete dataset/sample/filter tuple.

The frozen satellite catalog contains 472 identities (460 discovery-list entries, one additional planetary-satellite source identity and eleven TNO companions), in addition to Earth's Moon. Of these, 471 have corroborated SPK target numbers; S/2009 S1 remains unmatched. Catalog inclusion does **not** promise a position, a physical radius, or formal discovery confirmation. New entries have no invented fallback ellipse. Missing positions and incomplete historical trails are reported separately; an unavailable reference suppresses the frame. Saturn's 293 catalog identities are split into two preset groups to respect the 160-object 3D focus limit. See the [replayable satellite evidence workflow](./scripts/reference/SATELLITE-SURVEY.md).

| Preset | Reference and epoch | Default view | What it shows and what it does not claim |
| --- | --- | --- | --- |
| Solar System today | Sun · current date | 3D | Major planets, Moon, Ceres, and Pluto at the current approximate epoch |
| Earth–Moon system | Earth · 2026-07-01 | 3D | DE440s Earth/Moon body centers when loaded; documented mean-ellipse fallback otherwise |
| Inner Solar System | Sun · 2026-07-01 | 3D | Mercury through Mars and the Moon across a 180-day trajectory window |
| Outer Solar System | Sun · 2026-07-01 | 3D | Jupiter through Neptune across a twelve-year window |
| Dwarf-planet orbits | Sun · 2026-07-01 | 3D | Ceres, Pluto, Eris, Haumea, and Makemake across a 33-year window |
| Mars opposition 2027 | Sun · 2027-02-19 | 3D | Heliocentric Earth–Mars–Jupiter geometry near the February 2027 opposition |
| Jupiter and its modeled Galilean moons | Jupiter · 2026-07-01 | 3D | Jupiter, Io, Europa, Ganymede, and Callisto; JUP365 when loaded, fixed-ellipse fallback otherwise |
| Saturn–Titan system | Saturn · 2026-07-01 | 3D | Saturn and Titan using the same bounded satellite-model contract |
| Mars–main belt–Jupiter | Sun · 2026-07-01 | Element Space / `a–e` | The MBA subset of a pinned 8,000-object display sample, with Mars, Ceres, and Jupiter as heliocentric landmarks; not the complete main belt |
| Main-belt element comparison | Sun · 2026-07-01 | Element Space / `a–i` | The MBA subset of the same pinned sample, comparing semi-major axis and inclination; not the complete main belt |
| Near-Earth region | Sun · 2026-07-01 | 3D | An inner-system focus set ready for explicitly loaded NEOs |
| Voyager era | Sun · 1980-01-01 | 3D | The approximate outer-planet arrangement during the 1977–1989 flyby era; spacecraft overlays remain schematic |

The list is intentionally extensible. New presets should remain one-click, bilingual, URL-replayable, honest about sample versus complete data, and explicit about the model used for every included body.

Close moon systems use a scene-sized 3D camera fit, clipping range and schematic marker scale, including portrait resizing. Positions remain in AU; enlarged body markers and rings are **not physical sizes**. Expanded moon presets use shorter windows based on the fastest existing seed period (at least about 24 points per revolution for those seed orbits with the default 180 samples). This sampling bound does not establish periods for newly cataloged bodies without seed elements. Slower moons may show partial arcs. Manually choosing a long window or fewer samples can still undersample fast orbits; a trail is a sampled history, not a fitted closed ellipse.

The inspector and hover readouts use kilometers below 0.01 AU and hours for periods shorter than one day. Moon orbit extrema are labelled **periapsis/apoapsis**, relative to their parent; inclinations use the J2000 ecliptic, not the planet's equator. Display digits are formatting, not an uncertainty estimate. Direct SPK Earth-center positions are distinguished from the retained EMB-derived fallback.

## Workspaces

- **Observation Deck** — 2D/3D spatial views, bounded simulation clock, arbitrary loaded-body reference frames, split-frame comparison, searchable focus selection, trajectories, camera controls, distance measurement, Lagrange points, Hill spheres, Laplace SOIs, and optional catalog point clouds.
- **Small-Body Catalog** — immutable MPCORB releases, name/number/designation search, exact compact-index filters, NEO/PHA and orbit-class filters, bounded locator hydration, and IndexedDB caches isolated by dataset version.
- **Orbital Element Space** — linked `a–e`, `a–i`, `a–H`, `q–Q`, and `a–period` plots with resonances, Kirkwood gaps, brushing, keyboard point inspection, histograms, and linked heliocentric 3D focus.
- **Events Lab** — explicit, cancellable close-approach, conjunction, opposition, periapsis, and apoapsis jobs with adaptive sampling, local refinement curves, and sampling-adequacy warnings.
- **Mission Lab** — directionally correct Hohmann baselines, phase-angle guidance, a residual-checked universal-variable Lambert solver, departure/arrival `v∞`, C3, and an interactive porkchop map.
- **Guided Stories** — eight six-stage, observation-first courses. The core course separates historical geocentrism from the modern use of a geocentric reference frame.
- **Object atlas and Evidence** — five-section body profiles, source links, model validity, dataset provenance, build identity, scientific validation, and release evidence.

Global object/story/term search is available with `Ctrl/⌘ K` or `/`. Browser Back/Forward, bilingual route titles, keyboard scene controls, a four-button mobile navigation surface, and reduced-motion behavior are part of the supported interface.

## Reproducible scenes

Scene URL schema **v4** carries the scientific and interaction state needed to replay a workspace: route, immutable dataset version, dataset mode, epoch, reference and comparison frames, focus set, filters, trajectory sampling, view mode, catalog-cloud choice, 3D quality profile, plot, guided-story step, mission endpoints/dates, language, and view settings.

Catalog workspaces and dataset-backed presets pin `catalogSample=mobile|desktop` together with the manifest-declared `catalogSampleCount`. Incomplete, unavailable, unsupported, or count-mismatched tuples fail closed where the sample is loaded. v2 and v3 links remain readable and upgrade to v4 after their responsive sample resolves. Scenes can also be saved locally and exported or imported as versioned JSON libraries.

| Reproducibility guarantee | Explicit non-guarantee |
| --- | --- |
| Dataset release, sample profile/count, filters, selection order, epoch, frame, view, and analysis inputs are encoded or content-addressed | A shared scene does not promise identical FPS, GPU throughput, or network latency |
| Catalog filters and exact totals are independent of the locally visible point budget | Auto/Maximum may draw a deterministic prefix of different length on different devices or at different times |
| The selected 3D quality profile is shareable | The current adaptive point count is runtime state and is deliberately not serialized |
| 3D scene fit and the configured zoom replay from a canonical starting camera | Free orbit, pan, wheel, and pinch gestures remain session-local; Reset view restores the reproducible fit |
| Model identity, validity warnings, and build evidence remain visible | External JPL SBDB availability and uncached remote data are not controlled by the scene URL |

Try a reproducible entry point:

- [Core course: geocentrism vs. the geocentric frame](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=geocentric-model&view=3d&lang=en)
- [Explain Mars retrograde motion](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=retrograde-mars&step=2&view=3d&lang=en)
- [Read the Kirkwood gaps in element space](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=kirkwood-gaps&step=1&view=3d&lang=en)
- [Compare the four NEO orbit classes](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=neo-types&view=3d&lang=en)
- [Inspect Pluto and Neptune's 3:2 geometry](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=pluto-resonance&step=1&view=3d&lang=en)
- [Open an Earth-to-Mars mission setup](https://dajiaohuang.github.io/solar/?v=4&page=mission&from=earth&to=mars&depart=2026-11-15&arrive=2027-08-01&view=3d&lang=en)

## Rendering and device policy

Solar Atlas separates three limits that answer different questions:

1. **Catalog sample size** — immutable data available to a catalog scene: currently 8,000 mobile or 30,000 desktop records.
2. **Visible catalog-point budget** — the prefix drawn in the Observation Deck when Catalog point cloud is explicitly enabled.
3. **Focus-body limit** — bodies with individual trajectories, interaction, and detail: 160 in 3D or 320 in the batched 2D view.

The initial device class comes from viewport width, while coarse-pointer landscape devices up to 1,180 px remain on the mobile policy. Optional browser memory and concurrency hints can only make an adaptive first frame more conservative; they never promote a device beyond its class. Runtime frame measurements are authoritative after startup, and both renderers cap device pixel ratio. Split-frame comparison gives both frames the same deterministic prefix within one shared total budget.

| View and profile | Mobile visible points | Desktop visible points | Runtime behavior |
| --- | ---: | ---: | --- |
| 2D, any profile | 8,000 | 30,000 | Fixed; batched WebGL points |
| 3D Auto | nominal start 4,000; range 2,000–6,000 | nominal start 12,000; range 6,000–20,000 | Reduces after repeated slow frame windows and increases only after sustained headroom |
| 3D Balanced | 4,000 | 12,000 | Fixed, conservative budget |
| 3D Maximum | nominal start 6,000; range 2,000–8,000 | nominal start 20,000; range 8,000–30,000 | Higher adaptive target; still allowed to protect responsiveness |

Adaptive changes occur in 500-point steps with hysteresis and cooldown while the 3D catalog cloud is actively animating. The current `visible / sample` count is shown in the frame label. Turning the cloud off releases the catalog workload from the deck.

These are bounded policies, not RAM-based performance promises. A device with 12, 16, or 32 GB of system memory can still differ substantially in browser limits, GPU, thermal state, display resolution, extensions, and background load. See [PERFORMANCE.md](./PERFORMANCE.md) for measured byte, request, artifact, and browser budgets.

## Scientific contract

| Capability | Model and scope |
| --- | --- |
| Major planets | JPL Table 1 fitted Keplerian elements and secular rates in the mean ecliptic/equinox of J2000, valid for 1800–2050. The Earth entry seeds the internal Earth–Moon barycenter; the rendered Earth point is a derived geocenter. Out-of-range dates show an extrapolation warning. SPK-backed states use UTC→TT→TDB (NAIF leap table from 1972; future dates are explicitly uncertain); the approximate fallback retains its numeric-JD contract |
| SPK ephemerides | Original NAIF/JPL SPK type 2/3/17/21 records, geometric body-center states through source-specific ECLIPJ2000 center chains. `de440s`: 2000–2051; full satellite/asteroid kernels: 2020–2031; large Pages satellite files: 2026–2027; Eris/Haumea primary centers and their moons end at 2030-01-02 TDB. No refitting, resampling, extrapolation or repeated force corrections |
| Moons and dwarfs | The Moon and fixed-ellipse satellite entries remain auditable fallback approximations when SPK coverage is unavailable; they are not continuous ephemerides. Earth and Moon centers are partitioned around the EMB seed using checksum-pinned [NAIF/JPL DE440 gravitational parameters](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc). Dwarf planets use rounded `curated-approx` elements |
| MPCORB and SBDB bodies | Elliptic (`0 ≤ e < 1`, `a > 0`) osculating elements only; parabolic and hyperbolic records are rejected explicitly |
| Moon phase | Sun–Earth–Moon phase angle plus signed geocentric elongation |
| Hill sphere | `a(1-e)(m/3M)^(1/3)` |
| Laplace SOI | `a(m/M)^(2/5)`; never labeled as a Hill sphere |
| Hohmann | Coplanar circular endpoints, impulsive solar two-body model; signed burns and km/s conversion |
| Lambert | Zero-revolution universal-variable solar two-body solution using approximate endpoint positions; only residual-converged solutions are returned |
| Event search | Adaptive non-endpoint candidates followed by bounded local refinement and fresh two-body propagation. The exported numerical refinement half-width is not physical uncertainty, which is not estimated |
| Spacecraft overlays | Milestone-dated schematic tracks labeled separately from Horizons and propagated ephemerides |

JPL SBDB values are read from the documented `orbit.elements[]` records (`name`, `value`, and `units`), not invented flat properties. The object-level `orbit.condition_code` is exposed as an orbit condition code; per-element sigma and covariance are not currently modeled. Absolute-magnitude filters have explicit all/known/unknown states; an unknown H is never fabricated as a number and is excluded from numeric `a–H` plots.

Primary sources:

- [Minor Planet Center MPCORB](https://www.minorplanetcenter.net/iau/MPCORB.html)
- [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
- [JPL approximate planetary positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
- [JPL planetary satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/)
- [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [NAIF/JPL DE440 gravitational parameters](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc)
- [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html) · [NAIF time system](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html)

### Physical ephemeris coverage and observation boundary

The SHA-256-pinned, on-demand SPK pack has two profiles, each with 510 files: Pages is **258.4 MiB** (270,908,416 bytes); full/native is **1094.7 MiB** (1,147,897,856 bytes). At UTC JD 2461287.5, tests resolve **508 selectable body centers**. Full planetary-satellite additions cover 2020–2031 TDB; Pages narrows large satellite files to 2026–2027. Eight new small-body binary systems span 2020-01-01/2030-01-01 in full and 2026-07-01/2027-01-01 in Pages, retaining the same target identities. Original type 2/3/17/21 records retain explicit source-specific center dependencies. Independent CSPICE tests check 444 added source pools with 1,380 position/velocity sample pairs; numerical agreement is not physical uncertainty.

This is not universal coverage: S/2009 S1 has no corroborated SPK target or state in this pack. Daphnis uses original historical SAT393 records with that publication's embedded DE431 center chain, not a current globally fitted solution. Makemake retains an approximate fallback because its Horizons solution does not establish a resolved primary center. Eris/Haumea use published primary offsets through 2030-01-02 TDB. Missing states never receive invented orbits. Ordinary builds do not fetch kernels: Web defaults to Pages, native to full; `SOLAR_ATLAS_EPHEMERIS_PROFILE=full` selects a full Web distribution. Native SPK files work offline; catalogs and live SBDB queries retain their online boundary. The legacy `data:ephemerides` command is not a full satellite refresh; see the [profile and regeneration contract](./docs/physical-ephemerides.md) and [satellite evidence workflow](./scripts/reference/SATELLITE-SURVEY.md).

SPK output is geometric, center-resolved state in its declared frame. It is not an N-body client, and the app does not add a second general-relativistic or J2 correction. Focus trajectories may use SPK states while the GPU catalog cloud remains Keplerian. Geometric, reception light-time, and stellar-aberration readouts are separate; no gravitational light deflection, atmosphere, surface-observer model, or covariance is provided.

## Data and publication

The curated major-body atlas works without a local MPCORB release. The production dataset is a separately versioned, immutable artifact pinned by [`.github/asteroid-dataset.json`](./.github/asteroid-dataset.json). Application version, Git commit, dataset version, parser identity, validation report, and delivery hashes remain separate in Evidence and build artifacts. The MPC snapshot timestamp records the source file modification time (or HTTP `Last-Modified` value), while the distinct generation timestamp records when the publisher built the release. The automatic release identity covers the content and full provenance descriptor; setting `MPCORB_GENERATED_AT` makes an independent rebuild byte-for-byte reproducible.

Each schema-v3 release contains:

```text
manifest.json            provenance.json          checksums.json
validation-report.json  binary/*.bin             meta/*.json
search/*.json           lookup/*.json            catalog-index.bin
catalog-sample-*.bin    catalog-sample-*.json    catalog-summary.json
```

- Binary shards contain eight Float64 orbital values per record.
- Search indexes use two-character normalized prefixes, 10,000-number permanent ranges, and provisional-designation year shards.
- The compact index supports exact numeric scans without materializing the whole catalog as JavaScript objects.
- Display samples are precomputed and stratified: 30,000 desktop and 8,000 mobile records.
- Exact-result hydration is paged and bounded to 480 records from at most 32 unique shards; decoded detail shards use an eight-entry LRU.
- The validator binds every search/lookup locator back to the exact metadata row and semantic bucket.

Application deployment and data publication are independent workflows:

```text
application: validate pin → lint → unit + scientific tests → build
             → E2E + Lighthouse + capacity → deploy → production smoke

dataset: source snapshot + SHA-256 → parse + semantic validation
         → binary/meta/search/lookup/index/sample artifacts
         → tests + benchmark → immutable GitHub Release → audited pin → deploy
```

The publisher refuses to overwrite an immutable version, verifies a reused Release asset against the expected SHA-256, and switches the active pointer only after all artifacts and validation reports exist. Lite membership is a permanent-number cutoff plus required curated targets—not the first N records in mutable upstream order.

## Local development

Requirements: Node.js 22+ and npm 10+.

```bash
npm ci
npm run dev
```

The application runs with curated bodies when no local asteroid release is installed. To generate Lite data from the current source snapshot:

```bash
npm run data:lite
npm run validate:data
```

`MPCORB_LITE_MAX_NUMBER=30000` is a permanent-number cutoff, not a promise of exactly 30,000 output records. For a reproducible generation run, provide the exact pinned source archive with `MPCORB_SOURCE_FILE=/path/to/MPCORB.DAT.gz` and retain its SHA-256. `npm run data:full` parses all valid elliptic MPCORB records and requires several GB of available memory.

Local application builds omit generated catalog data by default. To reproduce the deployable Pages artifact containing only the audited active release:

```bash
npm run build:deploy
npm run check:capacity
```

Useful pipeline variables:

| Variable | Meaning |
| --- | --- |
| `MPCORB_SOURCE_FILE` | Existing pinned `.gz` or plain MPCORB source |
| `MPCORB_SOURCE_URL` | Alternate source URL |
| `MPCORB_DATASET_VERSION` | Explicit immutable version string |
| `MPCORB_CHUNK_SIZE` | Records per binary shard; default 5,000 |
| `MPCORB_LITE_MAX_NUMBER` | Stable Lite cutoff by permanent number; featured targets are added |
| `MPCORB_REQUIRE_FEATURED=0` | Disable required-featured validation for isolated fixtures only |
| `MPCORB_MODE` | `lite` or `full` |
| `MPCORB_REFRESH=1` | Replace the cached raw snapshot |

### All-body coverage inventory

The all-known-body goal is broader than the built-in registry and the elliptic MPCORB catalog. An opt-in [source inventory pipeline](./docs/all-body-inventory.md) accounts for individual JPL asteroid/comet records, planetary moons and small-body satellites, including candidates and missing/unsupported orbital data. It produces reproducible, hashed shards and a coverage-gap ledger. Inventory counts are **not** a claim that every record is already selectable, rendered or covered by physical ephemerides. Ordinary Web/Android/iOS builds do not bundle this developer inventory. Type 21 evaluation is implemented; its full target integration, open trajectories and all-body runtime delivery remain follow-up work.

## Android and iOS

The repository contains Capacitor 8 local-shell projects for Android and iOS under the application ID `io.github.dajiaohuang.solaratlas`. Android supports API 24 and targets API 36; iOS requires 16.4 or later. Both use the installed local shell for the curated core experience while loading catalog data on demand over HTTPS.

The v0.11.0 reference validation for [commit `e9e7897`](https://github.com/dajiaohuang/solar/commit/e9e789705711bf2946f6b432cd53e9b820a554ec) passed both native jobs on 2026-08-29 in [workflow run 33269424582](https://github.com/dajiaohuang/solar/actions/runs/33269424582):

| Target | Verified CI output | Boundary |
| --- | --- | --- |
| Android | API contract, lint, unit tests, and `assembleDebug`; artifact `solar-atlas-android-debug` | Debug-key-signed APK for validation, not a release APK or AAB |
| iOS | Xcode build of the synced shell for `iphonesimulator`; artifact `solar-atlas-ios-simulator` | Unsigned Simulator `.app`, not a device archive or IPA |

Artifacts are retained for 14 days; the workflow result remains the durable evidence after downloads expire. These projects are source and non-release validation paths, not published store products. Windows can build Android when its toolchain is installed, but iOS builds require macOS and Xcode. No release signing, store submission, TestFlight/Play track, or real-device validation is claimed. See [MOBILE.md](./MOBILE.md) for prerequisites, commands, native behavior, and the acceptance checklist, and [PRIVACY.md](./PRIVACY.md) for the current source-level privacy notice.

## Architecture

```text
src/
  app/                 shell, route loading, providers, body registry
  components/          batched WebGL 2D and persistent Three.js 3D renderers
  features/
    explorer/          Observation Deck and adaptive catalog cloud
    catalog/           small-body discovery and exact-result hydration
    element-space/     linked quantitative plots and brushing
    events/            explicit analysis jobs and timeline
    mission/           Hohmann, Lambert, porkchop, model ladder
    stories/           JSON-guided scenes
    body-inspector/    elements, phase, influence radii, provenance
    about/             dataset evidence and scientific contract
  engine/              clock, ephemeris, units, event and mission math
  hooks/               workers, catalog loading, adaptive render budget
  state/               independent simulation, selection, catalog, UI stores
  data/                curated bodies, loaders, IndexedDB cache
  workers/             cancellable catalog, trajectory, event, porkchop jobs
  i18n/                one English/Chinese translation system
scripts/               dataset, build-evidence, benchmark, capacity tooling
```

The simulation clock is external to React and publishes throttled snapshots. Trajectory, catalog-point, event, and porkchop work runs in cancellable workers; large numeric payloads use transferable typed arrays. The 3D renderer keeps a persistent scene graph and renders on state/control changes unless active catalog animation requires continuous frames.

## Verification and deployment

Run the focused and release-relevant checks:

```bash
npm run lint
npm run test:unit
npm run test:scientific
npm run build
npm run test:e2e
npm run benchmark:catalog
npm run check:capacity
```

`npm run ci` combines lint, unit, scientific, and build checks. Unit coverage includes Julian dates, Kepler propagation, reference frames, render-budget hysteresis, Hohmann/Lambert math, Moon phase, Hill/SOI definitions, satellite evidence, v2/v3 compatibility, v4 scene round trips, MPCORB parsing, cache isolation, and bounded million-row scans. Playwright covers first-run UX, default 3D and 2D fallback, explicit catalog-cloud loading, desktop/mobile samples, URL recovery, browser history, stories, missions, offline shell behavior, WebGL/Worker failures, and serious/critical automated accessibility findings.

`.github/workflows/pull-request-quality.yml` is the pre-merge gate. Every pull request receives a read-only repository parser/link/identity check; code, configuration, workflow, and production-asset changes also receive lint, unit/scientific, production build/capacity, Chromium interaction/accessibility, and Lighthouse checks. Documentation-only changes skip the expensive browser job, not the repository contract. Branch protection requires the stable `Pull request quality gate` summary from GitHub Actions for every merge, including administrator merges; it succeeds only when the repository contract and every applicable full-quality job succeed.

`.github/workflows/deploy.yml` remains the single production gate after merge: it validates the pin, builds compressed delivery assets, enforces Pages/browser budgets, runs tests and Lighthouse, archives evidence, deploys, and executes a production smoke test. `.github/workflows/data-refresh.yml` publishes monthly/manual immutable datasets. `.github/workflows/rollback.yml` restores the exact tested Pages artifact from a successful retained run.

The [health endpoint](https://dajiaohuang.github.io/solar/health.json) reports the currently deployed commit, build time, dataset, delivery manifest, and scientific-validation status. The workflow badges at the top report the current `main` deployment and native-build state; the dated native run above is the v0.11.0 reference record rather than a claim that short-lived artifacts remain downloadable forever.

## Installable app and offline boundary

Solar Atlas provides a Web App Manifest, installable application shell, update-ready prompt, sitemap, JSON-LD, Open Graph metadata, bilingual static knowledge pages, and route-level code splitting.

After one successful online load, the service worker can reopen the cached application shell offline. This is not a promise that the complete MPCORB release, an uncached sample/detail shard, a newly visited route asset, or a live JPL SBDB request is available offline. Dataset/version errors remain visible instead of silently substituting different data.

The Android and iOS projects use a separate Capacitor local-shell build without Service Worker registration. Their curated core is installed locally, while catalog shards and live JPL requests retain the same online boundary. Mobile build status and release limits are documented in [MOBILE.md](./MOBILE.md); privacy behavior is documented in [PRIVACY.md](./PRIVACY.md).

## Contributing

Focused scientific corrections, accessibility improvements, performance work, and reproducible teaching stories are welcome. Open an issue before a large architecture or data-format change.

Before a pull request:

- start from `npm ci` and run the relevant checks above;
- accompany scientific changes with a primary source, model/validity statement, and deterministic regression fixture;
- preserve v4 URL compatibility or provide an explicit migration path;
- keep English and Chinese copy in sync;
- verify keyboard access, desktop/mobile behavior, reduced motion, and the 2D/WebGL fallback for UI changes; and
- do not label two-body or schematic output as an operational ephemeris, N-body result, risk assessment, or navigation product.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the complete workflow, [MOBILE.md](./MOBILE.md) for native contribution and release boundaries, and [SECURITY.md](./SECURITY.md) for private vulnerability reporting.

## Citation and license

Source code is available under the [MIT License](./LICENSE). Astronomical source data remains subject to its originating institution's terms and attribution. Cite the project using [CITATION.cff](./CITATION.cff).
