# Physical ephemeris contract

Solar Atlas uses immutable SPK files for Web/backend focus-body geometry. The two source profiles each contain 510 SHA-256-pinned files: the short-window `pages` source profile totals 270,908,416 bytes (258.4 MiB), and the full Web/backend source profile totals 1,147,897,856 bytes (1094.7 MiB). These source-profile totals are not deployed preview totals: the current curated Pages product selects a dependency closure of 36 files / 90,800,128 SPK bytes, as described in [preview delivery](./preview-delivery.md). Static Web files load on demand after the explorer's first-visit choice (or directly on analysis routes); native clients do not package SPK files, and the full-Web backend current-state path requests binary state tiles instead. Requesting a static body may load its file outside its interval, while calculation still uses only covered epochs. A documented existing static-Web approximation may be used outside coverage; bodies without one remain unavailable. Exact backend state requests never substitute an approximate fallback.

## Coverage

- `de440s` covers 2000-01-01 through 2051-01-01 for the planetary system and Earth/Moon centers.
- Added planetary-satellite and selected asteroid kernels cover 2020-01-01 through 2031-01-01 TDB in the full profile; the bundle includes 16 selected asteroid targets. The Eris/Haumea systems have the shorter window described below. Pages narrows large satellite files to **2026-01-01 through 2027-01-01 TDB**, preserving original records and the same target identities. Per-file manifest bounds are authoritative.
- Separately, Eris and Haumea primary centers cover 2020-01-01 through **2030-01-02 TDB**. Each file retains the published type 21 system trajectory and type 2 primary offset together. The 920136199/920136108 primary IDs must not be replaced with 20136199/20136108 system IDs. These two files are lazy, not core startup files.
- At UTC JD 2461287.5, the integration test resolves **508 selectable centers**. Two registry entries lack SPK states: Makemake and S/2009 S1. Makemake's Horizons fixture does not establish a resolved primary center; S/2009 S1 has no corroborated target number. Daphnis uses the original historical SAT393 Type 17 record. Nine other Saturn moons use the distinct modern NAIF SAT415 delivery with its original DE437 dependencies, not the historical SSD container. These are explicit source and coverage boundaries, not absent observed objects.
- The satellite identity catalog contains 472 entries in addition to Earth's Moon, with 471 corroborated SPK IDs. Identity inclusion is not state coverage, a physical-property measurement, or formal discovery confirmation. This is not yet all known Solar System bodies.
- If a kernel, center chain, or epoch is unavailable, only an existing documented approximate fallback may be used. Otherwise no position/trail is drawn; an unavailable reference suppresses the frame. No orbit is invented to fill a gap.

The files preserve original NAIF SPK type 2/3/17/21 records. Chebyshev, equinoctial and extended modified-difference records are evaluated directly: they are not refit or resampled. Each file is checked for its declared byte length and SHA-256 digest. See [type 21 validation](./spk21-validation.md) and the [satellite source workflow](../scripts/reference/SATELLITE-SURVEY.md).

## Source-specific center chains

Quaoar/Weywot, Orcus/Vanth, Salacia/Actaea, 1998 WW31/Sat1 and
2001 QW322/Sat1, Kagara/Haunu, 1999 OJ4/Sat1 and 2003 UN284/Sat1 each retain
the original publication's primary, companion and
system trajectory in one file. The full window is **2020-01-01/2030-01-01 TDB**;
Pages uses **2026-07-01/2027-01-01 TDB** to preserve existing coverage within
its capacity budget. `Sat1` is a source label qualified by the parent name,
not an invented formal satellite name. These eight primaries have no fallback
orbit or inferred radius/mass. Each published solution mixes DE440 satellite
fit and DE441/SB441-N16 heliocentric provenance; DE440 provides the Sun conversion.

The source-selection ledger accounts for all twelve frozen `tnosat_*`
publications: ten selected, the earlier Haumea v001 retained but not selected,
and Patroclus source-only. The Patroclus JPL082/DE440 file has primary/companion
offsets but no system trajectory. The separately archived Lucy solution 54/DE431
barycenter is older and is not silently composed into a claimed same-source fit.
Its raw companion label `Manoetius` is preserved in the ledger; this is not a
formal-name adjudication or delivered heliocentric state. This ledger covers
the frozen survey, not every publicly known satellite or every public source.

Dysnomia, Hiʻiaka and Namaka use the original published component offsets,
not new Keplerian seed orbits. Their full windows end at **2030-01-02 TDB**;
Pages narrows these large satellite records to 2026/2027. Each root reuses the
same publication's existing primary/system file plus the DE440 Sun conversion
dependency. `120136199 → 20136199`, `120136108/220136108 → 20136108` are
system-relative offsets; the named parent centers are `920136199/920136108`.
Parent-relative displays subtract those primary offsets inside the same pool.
The published solutions already mix satellite-fit DE440 and heliocentric
DE441/SB441-N16 provenance; the common-frame conversion is not a claim of a
uniform global fit. Source GM values, including Dysnomia's zero, are not used
as measured component masses. The primary/system coefficients are not duplicated
for each moon or independently refreshed from Horizons.

The standalone Daphnis SAT393 Type 17 source retains its original 2016 fitted
precessing ellipse. Its original comments condition scientific use on PDS placement or
Imaging Team publication. The [official PDS copy](https://naif.jpl.nasa.gov/pub/naif/pds/wgc/kernels/spk/sat393_daphnis.bsp)
matches the generic copy byte-for-byte (9,216 bytes; SHA-256
`8b21b3b68e5603006b67cb02197d789afa2e04925c3495363ac16fe180be2e08`),
establishing PDS placement. The source's Saturn-center record and embedded DE431
Sun/system-barycenter records are retained as published. The satellite release
metadata says DE435, but the actual container generator explicitly loaded DE431
for targets 3, 399, 10 and 6; we do not replace those original coefficients with
a newly fetched DE435 core. This historical mixed-source delivery is disclosed,
not represented as a new globally fitted solution or an uncertainty guarantee.

Every added root declares an ordered `solutionKernelIds` pool, with the root last. JUP347/348/349, URA182, the selected new URA184 inner-moon records, and NEP098 use DE442. SAT456/459 use DE441; SAT455/457/480, URA117 and NEP104 use DE440. SAT480's S/2009 S2 additionally uses its own published Saturn-center record. The modern NAIF SAT415 roots use their original container's DE437 Sun/system-barycenter and Saturn-center records; target 6 is the system barycenter, not Saturn center 699. Nested old source comments are not authority to assign one planetary core to every record in a merged container.

The Sun and parent center are resolved within the target's declared pool. Missing dependencies fail closed; unrelated files loaded for another body cannot alter that pool or an existing unbound solution. When an arbitrary observer is absent from the target pool, its independently resolved state is used: this cross-solution comparison is **not one globally fitted dynamical solution**.

The independent CSPICE N0067 oracle checks all targets in 444 added non-dependency roots at three epochs per target: 1,380 heliocentric/barycentric six-vector pairs. Tests pin the manifest, source file hashes and oracle source. Position agreement within 2e-6 km and velocity within 1e-9 km/s are numerical regression tolerances, not observational uncertainty or proof of accuracy at all dates.

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

The Web build and Pages preview publish their selected, validated SPK assets according to the delivery profile. Native source prototypes do not package an SPK profile: their planned first vertical slice requests exact current states through the versioned `manifest → plan → binary state tile` protocol. Native manifest and plan loading requires the user-selected HTTPS backend; a previously verified tile may be reused only when a new online plan identifies the same tile and hashes. This cache is not a complete offline ephemeris or plan/catalog restoration mechanism. Missing or invalid data stays visibly unavailable or approximate, never disguised as a physical ephemeris.

An earlier expanded Pages candidate with the pinned 1,561,171-object asteroid dataset
measured approximately 698.2 MiB (433.5 MiB catalog data, 258.4 MiB SPK assets and about
6.4 MiB application shell). That is historical candidate evidence, not the current
published preview. The live Pages build at commit `2d2b99ca17b9a287024cb661a658c5922127e9fc`
reports a curated closure of 36 SPK files totaling 90,800,128 bytes and 93.2 MiB total
capacity. Further source additions require a fresh deployment measurement; Web delivery
profiles must not silently change their validated source selection.

## Primary sources

- [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
- [NAIF DAF Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html)
- [NAIF Time Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html)
- [NAIF `naif0012.tls` leap-second kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls)
- [JPL DE440 SPK source](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp)
