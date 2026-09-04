# Physical ephemeris contract

Solar Atlas uses immutable SPK files for focus-body geometry. They load on demand after the explorer's first-visit choice (or directly on analysis routes). Both delivery profiles contain 497 SHA-256-pinned files: Pages totals 236,654,592 bytes (225.7 MiB); full/native totals 589,323,264 bytes (562.0 MiB). Requesting a body may load its file outside its interval; calculation still uses only covered epochs. A documented existing approximation may be used outside coverage; bodies without one remain unavailable.

## Coverage

- `de440s` covers 2000-01-01 through 2051-01-01 for the planetary system and Earth/Moon centers.
- Added satellite and selected small-body kernels cover 2020-01-01 through 2031-01-01 TDB in the full profile; the bundle includes 16 selected small-body targets. Pages narrows large inner-moon files to **2026-01-01 through 2027-01-01 TDB**, preserving original records and the same target identities. Per-file manifest bounds are authoritative.
- Separately, Eris and Haumea primary centers cover 2020-01-01 through **2030-01-02 TDB**. Each file retains the published type 21 system trajectory and type 2 primary offset together. The 920136199/920136108 primary IDs must not be replaced with 20136199/20136108 system IDs. These two files are lazy, not core startup files.
- At UTC JD 2461287.5, the integration test resolves **488 selectable centers**. Three registry entries lack SPK states: Makemake, Daphnis (635), and S/2009 S1. Makemake's Horizons fixture does not establish a resolved primary center. Daphnis still lacks a verified modern delivery in this pack; S/2009 S1 has no corroborated target number. Nine other Saturn moons now use the distinct modern NAIF SAT415 delivery with its original DE437 dependencies, not the historical SSD container. These are explicit gaps, not absent observed objects.
- The satellite identity catalog contains 461 entries in addition to Earth's Moon, with 460 corroborated SPK IDs. Identity inclusion is not state coverage, a physical-property measurement, or formal discovery confirmation. This is not yet all known Solar System bodies.
- If a kernel, center chain, or epoch is unavailable, only an existing documented approximate fallback may be used. Otherwise no position/trail is drawn; an unavailable reference suppresses the frame. No orbit is invented to fill a gap.

The files preserve original NAIF SPK type 2/3/17/21 records. Chebyshev, equinoctial and extended modified-difference records are evaluated directly: they are not refit or resampled. Each file is checked for its declared byte length and SHA-256 digest. See [type 21 validation](./spk21-validation.md) and the [satellite source workflow](../scripts/reference/SATELLITE-SURVEY.md).

## Source-specific center chains

The standalone Daphnis SAT393 Type 17 source is under separate integration
review. Its original comments condition scientific use on PDS placement or
Imaging Team publication. The [official PDS copy](https://naif.jpl.nasa.gov/pub/naif/pds/wgc/kernels/spk/sat393_daphnis.bsp)
matches the generic copy byte-for-byte (9,216 bytes; SHA-256
`8b21b3b68e5603006b67cb02197d789afa2e04925c3495363ac16fe180be2e08`),
establishing PDS placement. Its historical SAT393/DE435 center chain still
requires numerical and delivery verification; no substitute orbit is generated.

Every added root declares an ordered `solutionKernelIds` pool, with the root last. JUP347/348/349, URA182, the selected new URA184 inner-moon records, and NEP098 use DE442. SAT456/459 use DE441; SAT455/457/480, URA117 and NEP104 use DE440. SAT480's S/2009 S2 additionally uses its own published Saturn-center record. The modern NAIF SAT415 roots use their original container's DE437 Sun/system-barycenter and Saturn-center records; target 6 is the system barycenter, not Saturn center 699. Nested old source comments are not authority to assign one planetary core to every record in a merged container.

The Sun and parent center are resolved within the target's declared pool. Missing dependencies fail closed; unrelated files loaded for another body cannot alter that pool or an existing unbound solution. When an arbitrary observer is absent from the target pool, its independently resolved state is used: this cross-solution comparison is **not one globally fitted dynamical solution**.

The independent CSPICE N0067 oracle checks all 432 added non-dependency roots at three epochs each: 1,296 heliocentric/barycentric six-vector pairs. Tests pin the manifest, source file hashes and oracle source. Position agreement within 2e-6 km and velocity within 1e-9 km/s are numerical regression tolerances, not observational uncertainty or proof of accuracy at all dates.

## Coordinates and time

SPK records are geometric states relative to their declared body centers. The resolver follows those center links to a barycentric state and transforms supported J2000 equatorial records into the fixed ECLIPJ2000 frame. Returned kernel states remain km and km/s until an application boundary converts them.

Civil UTC dates are converted to seconds of TDB past J2000 using the NAIF leap-second table and periodic `TDB−TT` approximation: UTC → TAI → TT (`TT = TAI + 32.184 s`) → TDB. Numeric UTC Julian days are supported from 1972-01-01. Dates beyond the known leap-second/IERS confirmation window are labeled `future-uncertain` and hold the latest known offset; this is an explicit assumption, not a prediction.

## Observation and model boundaries

The application keeps three readouts distinct:

1. geometric state at the observation epoch;
2. reception light-time state at the emission epoch;
3. light-time plus stellar aberration direction.

No gravitational light deflection, atmospheric refraction, surface-observer correction, or covariance propagation is included. Precomputed SPK physics is not corrected again with a general-relativistic or J2 force term. Focus trajectories may use these SPK states, while the GPU catalog point cloud remains a bounded Keplerian visualization model.

Parent-relative osculating elements are instantaneous two-body diagnostics derived from a state snapshot. They are not a promise of future N-body propagation accuracy, even when the source state came from an SPK kernel.

Trajectory, event, and porkchop scans conservatively require each kernel to cover the whole requested window. A partially covered kernel is excluded for that scan, avoiding spurious extrema caused by an SPK/fallback discontinuity. Current-position markers may therefore be more accurate than a long trail. The status and export distinguish current coverage from full-window availability. Event uncertainty remains unestimated; numerical refinement is not physical prediction uncertainty.

The DE440 planetary solution and each satellite/asteroid solution have different fitted force models, observations, and errors. Their coefficients include the effects incorporated upstream (such as perturbations and, where modeled, relativistic/tidal terms). This implementation neither claims every such term for every body nor adds another GR/J2 precession term on top. It is an ephemeris reader, not a general-purpose full-physics simulator.

## Reproduce or expand a data pack

`npm run data:ephemerides` regenerates the legacy baseline, not the expanded satellite profiles. Do not use it as a one-command full-pack refresh. The [satellite workflow](../scripts/reference/SATELLITE-SURVEY.md) surveys, verifies and splits source crops, then `node scripts/integrate-satellite-pack.mjs VERIFIED_PLAN.json` integrates explicit source selections and their planetary dependencies into both profiles. The plan must name retained local evidence paths and source-selection reasons. It is an explicit developer operation, never an app startup request.

`SOLAR_EPHEMERIS_FROM` and `SOLAR_EPHEMERIS_TO` control source-supported baseline crop bounds, interpreted as TDB dates; they do not extend the added satellite plan automatically. Source bounds and per-file limits remain authoritative. Wider dates do not authorize extrapolation. Normal builds copy only the selected manifest's files, never stale extra files in `public/data/ephemerides`.

The generator reuses published files only after byte/hash, target, source and interval validation. `SOLAR_EPHEMERIS_CACHE` selects a developer cache; `SOLAR_EPHEMERIS_REFRESH=1` explicitly bypasses reusable published and cached crops. The TNO interval is capped at its published primary endpoint even when a wider interval is requested. The Eris source assumes zero Dysnomia mass; that source-model assumption is not an observational measurement that Dysnomia is massless. Haumea uses the corrected `v001b` delivery and its own bundled JPL#110 system trajectory, not an independently refreshed Horizons solution.

## Delivery and offline behavior

Ordinary `npm run build` selects Pages and does not download kernels. `npm run build:native` selects full; `SOLAR_ATLAS_EPHEMERIS_PROFILE=full` also selects full for a non-Pages Web distribution. The build identity records the selected profile. Pages has a 700 MiB deployment budget; full does not inherit that hosting cap, while every runtime kernel retains a 128 MiB file limit. The package byte total is not its initial download or resident-memory requirement.

Native kernel assets work offline when included in the installed package. Catalog samples, detail shards and live SBDB queries retain their separate online boundary. The first-visit gate and body-specific loading remain shared across Web and native. Missing or invalid data stays visibly approximate or unavailable, never disguised as physical ephemerides.

The expanded Pages build with the pinned 1,561,171-object asteroid dataset
measures 665.5 MiB (433.5 MiB catalog data, 225.7 MiB SPK assets and about
6.3 MiB application shell). It passes the 700 MiB budget but exceeds the
600 MiB warning threshold. Further source additions require a fresh deployment
measurement; the full/native profile must not silently inherit Pages reductions.

## Primary sources

- [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
- [NAIF DAF Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html)
- [NAIF Time Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html)
- [NAIF `naif0012.tls` leap-second kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls)
- [JPL DE440 SPK source](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp)
