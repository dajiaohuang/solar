# Vercel segmented edition

The full Web interface runs at `/` without the Go service. It retains one best sampled-error Chebyshev candidate per source interval and uses explicitly labeled two-body forecasts in declared gaps. 2D/3D, camera controls, available reference bodies, split comparison, seeking, trails and positive/negative playback remain available. Pages and the exact backend keep their existing build paths.

## Coverage and scientific limits

The unified window is **2000-01-01–2051-01-01 TDB**. Of the 493 audited objects (Sun, eight planets, five dwarf planets, 473 moons and six spacecraft), **492 have complete composed model coverage**. 463 have complete source-fit/origin coverage; 29 use forecasts somewhere. Eight otherwise excluded small-body primaries also need forecasts as moon-center dependencies. Independent asteroids/comets retain their previous windows and catalog models.

**S/2009 S1 remains unavailable:** no admitted identity/state anchor exists. No coordinates were invented. Makemake uses reviewed JPL identity `20136472`, explicitly labeled an **unresolved system-orbit proxy**, not a resolved primary/companion-center SPK solution.

Each two-body forecast records source URLs and SHA-256 values, GM/parameter provenance, anchor epoch, maximum backtest position/velocity residual, sample count and tested offset. Anchors come from admitted source-fit boundaries; Makemake uses a pinned NASA/JPL Horizons vector and two nearby independent vector comparisons. Units are ECLIPJ2000 km/km/s and TDB seconds. Backtests measure samples **inside source coverage**; errors outside it are **unknown**. Perturbations, maneuvers and collisions are omitted. Spacecraft before launch or after termination are mathematical counterfactuals, not claims of real flight or existence. Published Voyager/New Horizons extensions likewise do not establish observational uncertainty.

Source fits compare degrees 8, 12 and 16, then subdivide when needed. Thresholds are 5 km and 0.005 km/s per local body-to-parent fit at 66 off-node samples. These are source-relative sampled errors, not continuous bounds or physical uncertainty; parent errors contribute to composed states. Internal source switches have separate intervals and one-sided endpoint validation; shared fitted endpoints select the right side. Outside the published window, unavailable built-in states are omitted. Future UTC conversions retain the unknown-leap-second warning. Exact scientific analyses retain their existing exact-source requirements.

Committed evidence: [composed coverage](./benchmarks/non-small-forecast-20261012/coverage-verification.json), [independent source verification](./benchmarks/non-small-forecast-20261012/source-fit-verification.json), [forecast parameters, sources and errors](./benchmarks/non-small-forecast-20261012/forecast-models.json), including dependency-only parents, and [complete archive restoration](./benchmarks/non-small-forecast-20261012/archive-restoration.json).

## Hobby downloads

Visitors load a small immutable root manifest, then descriptor indices and coefficients **only for selected bodies and their parents**. Only the mutable `index.json` is revalidated. Byte-shuffled binary encoding plus gzip preserves every Float64 coefficient exactly; groups target approximately 128 KiB of original JSON, without refitting or changing intervals. Identity, decoded length and SHA-256 are checked before publication. Manifests, indices and coefficients share the optional 256 MiB IndexedDB LRU cache with catalog releases; eviction/cache failure falls back to network.

History defaults to 30 days, the default catalog sample is 8,000 rows, and catalog clouds stay off. Explicit controls still permit larger histories, samples and populations. Name search uses buckets rather than the full filter index. Large scenes, full scans and Gaia layers can consume substantial traffic. Stored archive size is not a first-visit transfer.

The artifact budget is **1,500,000,000 bytes**, an engineering guard rather than a Vercel plan allowance. Main/worker realms each retain at most 128 MiB of decoded coefficient source bytes; this does not measure total JS/GPU memory. [Vercel limits](https://vercel.com/docs/limits) distinguish Hobby's 100 MB CLI source upload limit from files produced during a Git-connected build. Do not upload this complete scientific repository/artifact as Hobby CLI source.

## Local preparation

1. Install dependencies. `npm run build:vercel` restores the full catalog from the GitHub Release pinned in `.github/asteroid-dataset.json` when no local catalog or external catalog URL is present. It verifies the archive SHA-256, rejects unsafe archive entries and validates dataset contents before installation. Existing local data is preserved. Alternatively, set `SOLAR_ATLAS_CATALOG_URL` to a published HTTPS dataset root with browser CORS.
2. For fresh source preparation, extract `docs/benchmarks/non-small-coverage-20261012/evidence.zip` into `.cache/non-small-coverage-20261012-b` (or set `SOLAR_ATLAS_SOURCE_EVIDENCE_DIR`). Install the official MESSENGER source from the pinned wide manifest at `.cache/spacecraft-packs/messenger-final-impact-20260929-r1/originals/msgr_040803_150430_150430_od431sc_2.bsp`: 684,620,800 bytes, SHA-256 `2f0b08f3d45ec21f11ccc2286d538d714367c04710bdf391d5c48909d5f22125`. Other wider crops are fetched from audited sources with HTTP validators. Cached pinned files are hash-verified and reused.
3. Run `rtk npm run precompute:vercel`: prepare sources, fit the full registry, publish forecasts, verify composed coverage. Generated crops/coefficients are ignored by Git; source manifests and small evidence are committed. Precompute outside repeated deployments. Partial development pilots use `scripts/build-segmented-ephemerides.mjs --bodies ... --out .cache/fit-pilot`; they cannot publish forecasts or a Vercel build.
4. Run `rtk npm run verify:vercel-data`, `rtk npm run build:vercel`, then `rtk npm run test:vercel`. `SOLAR_ATLAS_APPROXIMATION_DIR` can select another complete archive. Old/partial profiles are rejected. Unreferenced scientific chunks remain on disk and are excluded from delivery; raw SPK is excluded.
5. Preview with `rtk npx cross-env SOLAR_ATLAS_WEB_EXECUTION=segmented npm run preview -- --host 127.0.0.1 --port 4173` and open `http://127.0.0.1:4173/`.

An unchanged validated prefix can resume with `--resume-from <first-unfinished-body-id>` in a dedicated output directory. Source/configuration mismatches fail closed. Optional `--body-file` shards merge through `scripts/merge-segmented-archives.mjs`, which checks bytes, source identity, duplicate identities and the full registry. No CI jobs were added.

## Git-connected deployment

`vercel.json` selects `npm run build:vercel`, `dist` and immutable caching. Set `SOLAR_ATLAS_SITE_URL` to the canonical origin; otherwise `VERCEL_PROJECT_PRODUCTION_URL` is used. Inherited backend URLs are cleared.

Ignored fits are absent from remote checkouts. Package the verified original JSON fit archive:

```powershell
rtk proxy node scripts/package-vercel-archive.mjs public/data/approximation .cache/vercel-2000-2051.ndjson.gz
```

Publish the archive to HTTPS and set **both** `SOLAR_ATLAS_APPROXIMATION_ARCHIVE_URL` and `SOLAR_ATLAS_APPROXIMATION_ARCHIVE_SHA256`. Without `SOLAR_ATLAS_CATALOG_URL`, the build restores and packages the pinned full catalog from its existing GitHub Release; an external catalog root remains optional. The build downloads and checks the pinned approximation archive, restores only whitelisted coefficient records with bounded decompression, checks record digests and verifies coverage before packaging. It does not recompute wide SPK fits. Only the browser-facing external catalog needs CORS. Actual network/build time must fit the plan's build limits.

Published build input (2026-10-20): [verified 2000–2051 archive](https://github.com/dajiaohuang/solar/releases/download/vercel-build-data-2000-2051-9eb21d8a3b4b/vercel-2000-2051.ndjson.gz), 1,196,137,025 bytes, SHA-256 `9eb21d8a3b4b3c8ffce7807f2151fecdcd1209004398180284ef11d99e65d2bf`. Both the local file and GitHub's asset digest match this pin. It is a build input, not visitor data. The archive URL and SHA-256 are configured for this project's Vercel Preview and Production environments. Asset publication and configuration do not themselves establish successful hosted deployment.

## Verification, 2026-10-12

The archive has 669 identities, 665 source/origin-backed identities, 25,629 chunks and 1,871,606 fitted segments (2066.1 MiB JSON). Forecasts make 666 identities available somewhere; the two source-only Patroclus/Manoetius identities and S/2009 S1 remain unavailable. Audited coverage is 492/493 full windows, sampled at 2,266 composed epochs. Independent source verification passed 153,774 additional samples: maximum local position residual 4.929628 km and velocity residual 0.000296732 km/s.

The package is approximately 1215.5 MiB, including 433.5 MiB of compressed catalog and 94.4 MiB of Gaia assets. Five-body/30-day approximation payload measured **274,527 bytes cold**, **424 bytes after cached reload**, without repeated immutable manifest/index/chunk transfers. Local HTTP Content-Length measurements exclude headers, app JS and catalog assets; they are not hosted Vercel traffic receipts. The complete audited population rendered 492 available positions in a cold 2049 scene and switched to 3D. Cache writes maintain an atomic byte total below the quota instead of rescanning every buffer for each small file; browser checks also compare that total with actual stored payload bytes.

Local validation does not imply hosted Vercel or physical-device acceptance.

Unit validation passed 1,303 tests with nine existing skips; five production-artifact Chromium checks cover both views, reference changes, time controls, forecast provenance, all audited bodies, catalog search and cold/cached delivery. TypeScript, repository checks and lint passed (six existing lint warnings).
