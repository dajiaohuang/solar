# Changelog

All notable changes to Solar Atlas are documented here. The project follows semantic versioning after the prototype phase.

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
