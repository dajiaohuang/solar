# Vercel segmented edition

This edition serves the existing full Web interface at `/`. Current positions and trails use one retained Chebyshev candidate per interval, evaluated locally. 2D/3D, camera controls, arbitrary available reference bodies, split comparison, date seeking, playback and positive/negative speeds remain available. It does not require the Go service. The Pages preview and exact backend edition retain their existing build paths.

## Time and accuracy

The default precomputation uses each body's full pinned source coverage rather than a 2026–2031 cutoff. The archive's overall time extent is approximately 2000–2051, **not a promise that every object covers that entire interval**. Many satellite/planet-center sources cover only approximately 2020–2031, and spacecraft cover their own mission intervals. Parent states must also exist. Outside those windows the scene reports no coverage and omits unavailable states; it never extends a built-in epoch ellipse to fill a gap.

Each fit compares degrees 8, 12 and 16, retains the lowest normalized sampled error, and subdivides if needed. Sources use pinned SPK precedence and center chains in ECLIPJ2000, with TDB seconds, local positions in km and velocities in km/s. Acceptance thresholds are 5 km and 0.005 km/s **per local body-to-parent fit** at 66 off-node validation samples. These are measured errors relative to source states, not continuous bounds, physical uncertainty, or a navigation guarantee. Composed heliocentric states include parent fitting errors. Independent verification samples additional epochs.

Internal SPK solution boundaries are split before fitting. The approximation uses the right-side state at shared boundaries and validates the one-sided endpoints, avoiding a discontinuous solution change inside a polynomial. This convention can differ from original SPK segment precedence at the exact shared endpoint; the archive is an approximation, not an exact SPK receipt.

MPCORB's 1,561,171 elliptic catalog records retain their existing two-body approximation. They are not millions of precise SPK trajectories. Scientific analyses that require exact SPK receipts remain subject to their existing exact-source requirements. Dates after 2027-07-01 retain the application's explicit warning about unknown future leap seconds.

## Local build

1. Install dependencies with `npm ci` and install the pinned full dataset described in `.github/asteroid-dataset.json` into `public/data/asteroids`, verifying its archive checksum first. Alternatively set `SOLAR_ATLAS_CATALOG_URL` to the HTTPS root of that published full dataset; its server must permit browser CORS, including dataset/manifest/chunk requests.
2. Run `npm run precompute:vercel`. This verifies original kernel sizes and SHA-256 values before fitting, writes immutable content-addressed chunks, and publishes `public/data/approximation/manifest.json` last. Generated files are ignored by Git. Use `--bodies ... --out .cache/fit-pilot` only for development; production uses the complete registry.
3. Run `npm run verify:vercel-data`, then `npm run build:vercel`. The build automatically precomputes if the manifest is absent, packages only manifest-referenced chunks as bounded gzip files, verifies their decoded checksums, and excludes raw SPK binaries. The default build includes the compressed full catalog; a configured external catalog URL avoids copying it into `dist`.
4. Run `npm run test:vercel` against the completed artifact. For a manual preview, run `npx cross-env SOLAR_ATLAS_WEB_EXECUTION=segmented npm run preview -- --host 127.0.0.1 --port 4173` and open `http://127.0.0.1:4173/`.

An interrupted run can reuse a known completed prefix with `npm run precompute:vercel -- --resume-from <first-unfinished-body-id>`, provided the registry, sources and tolerances are unchanged. It checks completed chunk identities, content hashes, source hashes, coverage and recorded tolerances, and fails on overlapping checkpoints. Run independent verification again before packaging. Unreferenced chunks remain on disk and are excluded from the delivery.

`capacity-report.json` reports actual archive, catalog and total bytes. The Vercel edition enforces a 950,000,000-byte artifact budget, leaving margin below the documented 1 GB Pro CLI source-upload limit when publishing a prepared static artifact; the Pages edition retains its 700 MiB budget. This is a packaging budget, not a guarantee for Hobby CLI uploads. Main and worker realms retain at most 128 MiB of coefficient source bytes each; trajectories load sampled epochs rather than retaining the complete archive. This byte limit is not a measurement of total JavaScript/GPU memory.

## Vercel configuration

The checked-in `vercel.json` selects `npm run build:vercel`, `dist`, and immutable chunk caching. Set `SOLAR_ATLAS_SITE_URL` to your deployment's canonical origin. On Vercel it otherwise uses `VERCEL_PROJECT_PRODUCTION_URL`; local builds default to `http://localhost:4173/`. Builds explicitly clear `VITE_SOLAR_API_BASE_URL`, including inherited `.env` values.

For a Git-connected deployment, set `SOLAR_ATLAS_CATALOG_URL`: the ignored local full dataset is not present in the remote checkout. Original pinned kernels are checked in, so the missing approximation archive can be generated during that build. Precompute locally when preparing a prebuilt deployment instead of regenerating for every preview. Consult [Vercel limits](https://vercel.com/docs/limits) for your deployment method and plan: CLI source upload limits differ from build output, and neither is a supported simulation time range. Do not upload the entire repository's raw scientific data through the CLI as an application bundle.

No hosted Vercel deployment or physical-device acceptance is implied by a successful local build.

## Local verification, 2026-10-11

The completed archive contains 664 available bodies among 669 registered identities, 7,409 chunks and 424,016 fitted segments. Its extent is `2000-01-01/2051-01-01` TDB; Mercury, Venus, Earth and Moon span that interval. Mars, Jupiter, Saturn, Uranus, Neptune and Pluto span `2020-01-01/2031-01-01`. Makemake, S/2009 S1, the two Patroclus/Manoetius source-only component identities, and MESSENGER have no delivered approximation in this source/profile.

Independent verification passed at 44,454 additional epochs: maximum observed local position error 4.371864 km, velocity error 0.000290398 km/s. This sampling is not a continuous error bound. Unit validation passed 1,286 tests, with 9 pre-existing skips. Two production-artifact Chromium tests passed: rendering/frames/time/speeds/coverage/inspector, and real full-catalog name search; both used static data without scientific backend requests.

The packaged artifact is approximately 754.2 MiB, including 454,522,570 bytes of full catalog, 225,072,515 bytes of compressed approximation data and 98,963,915 bytes of Gaia sky data. It has 9,976 files and no raw SPK binaries. Generated precomputations and `dist` remain local ignored artifacts; source code and reproducible build instructions are committed.
