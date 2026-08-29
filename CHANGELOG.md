# Changelog

All notable changes to Solar Atlas are documented here. The project follows semantic versioning after the prototype phase.

## Unreleased

### Added

- An optional worker-propagated asteroid catalog cloud in the Observation Deck, rendered as one GPU point buffer instead of one mesh or trajectory per catalog object.
- Auto, Balanced, and Maximum 3D performance profiles with separate mobile/desktop budgets, conservative capability hints, frame-time adaptation, and deterministic unit coverage.
- Reproducible v4 scene fields for catalog-cloud intent and quality profile, plus browser coverage for the default no-download path and 2D/3D replay.
- Capacitor 8 Android and iOS local-shell source projects using application ID `io.github.dajiaohuang.solaratlas`, with Android API 24–36 and iOS 16.4+ platform contracts.
- Native lifecycle, Android Back, custom-scheme scene import, canonical scene sharing, external-browser handoff, and user-initiated file export integrations.
- A deterministic native-shell verifier and mobile workflow configuration for an unsigned Android debug APK and unsigned iOS Simulator app. These are validation paths, not signed or published releases.

### Changed

- The application now opens directly in the 3D Observation Deck; advanced controls remain collapsed, first-time visitors choose between the tutorial and immediate exploration, and WebGL failure still falls back to 2D.
- Focus trajectories are capped independently at 160 bodies in 3D and 320 in 2D, while catalog points use larger view- and device-specific budgets and share their total across split views.
- Paused 3D scenes render on demand. Continuous animation is limited to a playing simulation with the catalog cloud enabled, and the renderer no longer preserves its drawing buffer.
- The untouched first-visit choice uses a lightweight spatial preview and defers downloading and initializing the interactive Three.js renderer until the visitor starts the tutorial or chooses independent exploration; returning visitors still enter 3D directly.
- The Moon remains derived from JPL mean elements and DE440 Earth–Moon mass partitioning; Io, Europa, Ganymede, Callisto, and Titan now use reproducible parent-centered JPL Horizons osculating-element queries at JD 2451545.0 TDB with explicit fixed-ellipse limitations.
- Native builds now use relative local assets without Service Worker registration. The curated core remains installed and offline-capable, while catalog data is loaded on demand over HTTPS and live JPL requests remain online-only.

### Documentation

- Rebuilt the English and Chinese README as mirrored product, science, data, performance, validation, deployment, and contribution references, with a current runtime screenshot and explicit guarantee boundaries.
- Expanded the performance guide to distinguish immutable sample size, catalog-point budget, and focus-trajectory budget without making hardware-specific smoothness guarantees.
- Added mirrored Android/iOS delivery guides and source-level privacy notices, and linked their contribution, offline, permission, validation, and release boundaries from the main documentation.
- Documented that iOS builds require macOS and Xcode, and that signing, store submission, publication, and completed real-device validation are not currently claimed.

## 0.11.0 — 2026-08-20

### Added

- A bilingual six-stage core course, “From geocentrism to the geocentric frame,” covering the historical model’s predictive power, heliocentric evidence, the model/frame distinction, and modern GCRS use with Library of Congress, NASA, IAU, and JPL sources.
- A dedicated core-course badge, static bilingual knowledge pages, independent social cards, and regression coverage for course structure and both guided-learning entry points.

### Changed

- The visitor Learn path, default Stories selection, and final first-run onboarding action now begin with the geocentrism course before learners continue to retrograde motion, resonances, small-body structure, and missions.
- Deployment Lighthouse coverage now audits the core geocentrism knowledge page.

## 0.10.0 — 2026-08-20

### Added

- Seven six-stage guided courses that remain open across workspaces, highlight the relevant view or controls, reveal explanations on demand, expose terms and primary sources, and close with a knowledge checkpoint.
- Global keyboard search across workspaces, curated bodies, featured catalog records, stories, and glossary terms; a local versioned scene library with JSON import/export; and full five-section body profiles.
- Local event-refinement curves, keyboard-accessible element-space inspection and distribution summaries, and a click/keyboard-selectable porkchop opportunity card that applies its dates to the mission solver.
- A public machine-readable scientific-validation report backed by JPL Horizons fixtures, Lambert benchmarks, and ephemeris contracts, plus bilingual crawlable validation pages.
- Per-story and per-object 1200×630 social cards, complete static object knowledge pages, Lighthouse CI budgets, and dedicated guided-story and usability issue forms.

### Changed

- Story links now preserve an active guide outside the Stories workspace, so “open this scene” begins a continuous question → observation → operation → evidence → boundary → follow-up flow instead of dropping the lesson context.
- Deployments publish scientific-validation evidence and run Lighthouse against the visitor home and a static exhibit in addition to lint, unit, browser, capacity, and production-smoke gates.
- Evidence, the README, the bilingual documentation, and the roadmap now describe model validation separately from dataset validation.

### Fixed

- WebGL creation or context loss now falls back to a usable 2D Explorer, worker exceptions surface recovery state, and lazy workspaces have route-local retry/home error boundaries.
- Story-guide, command-palette, element-chart, porkchop, and profile interactions preserve keyboard and automated accessibility coverage.
- Windows asset generation reads UTF-8 story data explicitly and fails on errors, preventing corrupted Chinese social-card labels.
- The application shell no longer depends on cross-origin web fonts, keeping the first-install offline experience and zero-third-party Lighthouse budget deterministic.

## 0.9.1 — 2026-08-20

### Added

- A bilingual visitor home, three intent-based starting paths, a one-time guide, four-item mobile navigation, keyboard scene controls, route focus restoration, and dynamic object/story/mission titles.
- URL schema v3 with browser Back/Forward semantics, shareable story steps and mission setups, legacy v2 replay, and build identity in Evidence and exports.
- Seven four-step observation-first stories with primary sources and explicit limits for two-body, coordinate-frame, resonance, Trojan, NEO, Pluto, and spacecraft claims.
- Bilingual crawlable story/object/model/data/about pages, sitemap, hreflang, canonical/OG metadata, JSON-LD, generated raster icons, and social preview.
- First-install offline regression coverage, an update-ready prompt, axe checks, a scheduled Chromium/Firefox/WebKit matrix, community templates, and an audited rollback workflow.

### Changed

- Production builds copy only the pinned active asteroid release and gzip large JSON shards, keeping the full GitHub Pages artifact under an enforced 700 MiB ceiling.
- The deployment gate reuses the exact tested build, archives build/capacity evidence, and creates a deduplicated incident when the production smoke test fails.
- User-facing workspace labels, scientific contracts, result states, and accessibility names now share the English/Chinese translation system.

### Fixed

- Discrete route, story, focus, and mission changes now create history entries while continuous camera/time/filter updates replace the current entry.
- Service Worker activation removes only Solar Atlas caches, preserves unrelated same-origin projects, and keeps the application shell usable on the first offline reload.
- Runtime failures now preserve the scene URL and provide safe reload/home recovery actions.

## 0.9.0-beta.2 — 2026-08-20

### Added

- Cross-platform deterministic dataset archives with byte-for-byte repeatability tests and immutable Release asset verification.
- Bounded exact-result hydration pages, worker reset/retry controls, event sampling adequacy diagnostics, and browser-based production smoke coverage.
- Full search/lookup locator-to-metadata validation, including semantic bucket membership and duplicate detection.
- Lambert residual, bracket width, convergence status, and extreme-geometry regression tests.

### Changed

- Exact compact-index scans materialize at most 480 records from 32 unique shards per page; broad-filter point clouds keep using the precomputed sample.
- English name search requires two letters under prefix-v2, while permanent and provisional designations remain available immediately.
- Dataset release identity now includes parser version, and parser provenance uses a stable script-content digest.

### Fixed

- Re-running an existing dataset release can no longer pin a locally computed SHA for different Release bytes.
- Failed compact-index requests are evicted so retries work, and completed/cancelled worker request IDs are cleaned up.
- Lambert solutions that exhaust the iteration limit no longer appear feasible.
- Long event windows now warn when the 720-sample ceiling cannot resolve the selected fast bodies.

## 0.9.0-beta.1 — 2026-08-20

### Added

- Exact compact-index result hydration through deterministic locator sampling and bounded shard reads.
- Schema-v3 dataset capabilities, row locators, two-character search prefixes, summary statistics, and full semantic validation.
- JPL Horizons event fixtures, a classical Lambert benchmark, adaptive event sampling, and classified Lambert failure modes.
- Structured dataset pin with archive SHA-256 verification and post-deployment production smoke tests.

### Changed

- Catalog samples load only in Catalog and Element Space; Explorer, Mission, and Stories no longer pay the catalog startup cost.
- Catalog scans reuse a persistent worker and compact-index cache, while search candidates apply exact numeric filters through locators.
- Event exports distinguish numerical refinement half-width from unestimated physical prediction uncertainty and identify each apsis central body.
- Data publication runs lint, unit, build, E2E, and catalog benchmark gates before publishing or pinning a release.

### Fixed

- Exact filtered totals and visible records now come from the same full-data match set.
- Filter changes immediately discard stale exact records and fall back to the immutable base sample.
- Flat sampled extrema are collapsed so a sampling plateau cannot create duplicate physical events.

## 0.8.0-beta.1 — 2026-08-19

### Added

- Compact catalog index for exact numeric counts without downloading every metadata and orbital shard.
- Precomputed 30,000-record desktop and 8,000-record mobile stratified samples plus a catalog summary.
- Explicit Loaded, Text matches, and Exact filtered total result metrics.
- JPL approximate-element validity warnings outside 1800–2050.
- Event exports with dataset version, algorithm version, inputs, sample interval, and estimated timing error.
- Enforced performance budgets and a repeatable compact-index benchmark.

### Changed

- Dataset publication now commits the immutable release pin directly to `main` and explicitly dispatches production deployment.
- `deploy.yml` is the sole production quality gate; the duplicate CI workflow was removed.
- Event analysis now uses coarse candidate detection followed by local refinement and fresh propagation at each refined Julian Day.
- Scene URLs preserve a requested dataset version when that version is unavailable in the current deployment.

### Fixed

- Stale catalog scans can no longer overwrite state after filters, sample budget, or dataset version changes.
- Search result counts are no longer presented as exact post-filter totals.
