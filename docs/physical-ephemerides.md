# Physical ephemeris contract

Solar Atlas uses an immutable SPK bundle for focus-body geometry. It loads on demand after the explorer's first-visit choice (or directly on analysis routes). The manifest currently contains 59 SHA-256-pinned files totaling 68,818,944 bytes (about 65.6 MiB). Requesting a body may download its file even outside the file's time interval; calculation still falls back explicitly outside coverage.

## Coverage

- `de440s` covers 2000-01-01 through 2051-01-01 for the planetary system and Earth/Moon centers.
- Satellite and selected small-body kernels cover 2020-01-01 through 2031-01-01; the bundle includes 16 selected small-body targets.
- The selectable registry adds 31 moons and 15 large asteroids to the existing bodies. Together with Ceres, all 16 `sb441-n16` asteroids are covered. Seed reconstruction, named parent centers, and frame rotation are checked; this is not all known Solar System bodies.
- If a kernel, center chain, or epoch is unavailable, the application uses the documented approximate fallback. It never silently substitutes another kernel.

The files preserve original NAIF SPK type 2/3 records. Coefficients are evaluated in place: they are not refit, resampled, or converted into a new approximation. Each file is checked for its declared byte length and SHA-256 digest.

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

Run `npm run data:ephemerides` to retrieve verified HTTP ranges from the official sources. The generator retains original records and writes the manifest. Set `SOLAR_EPHEMERIS_FROM` and `SOLAR_EPHEMERIS_TO` (ISO calendar dates interpreted as TDB bounds) before this command to generate a wider local/native interval, then regenerate the body seeds and run scientific tests. Source coverage and the cropper's size limits remain authoritative; wider dates do not authorize extrapolation. Normal web/native builds use only the current manifest files, never stale extra files in `public/data/ephemerides`.

## Delivery and offline behavior

Ordinary `npm run build` does not download kernels or require network access. Native builds use the same manifest and can use kernel assets only when those assets are actually included in the installed package. Catalog samples, detail shards, and live SBDB requests remain separate online dependencies. Missing or invalid kernel data remains visible as an approximate fallback rather than being disguised as a physical ephemeris.

## Primary sources

- [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
- [NAIF DAF Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html)
- [NAIF Time Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html)
- [NAIF `naif0012.tls` leap-second kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls)
- [JPL DE440 SPK source](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp)
