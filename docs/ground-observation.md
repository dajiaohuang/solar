# Ground observations

The full Web body inspector's **Orbit → Ground observer** form submits a single
UTC/station snapshot to the Go backend. It is explicit, cancellable work; moving
the simulation clock does not continuously query the backend. Editing the form
invalidates the previous result. JSON exports retain the original request,
catalog identity, actual SPK hashes, IERS snapshot and model limitations.

This first slice provides directions at a requested instant. Rise/set searches,
visibility windows, native UI and propagated physical uncertainty remain pending.
No deployment or data publication is performed by the following local commands.

## Local data and service

1. Download a content-addressed snapshot from the official IERS endpoint:
   `rtk proxy node scripts/fetch-earth-orientation.mjs`.
2. Validate the returned manifest and optionally inspect an epoch:
   `rtk proxy go run ./cmd/eop-audit --manifest <manifest-path> --jd 2461306.5`.
3. Start the service with an existing staged SPK profile:
   `rtk proxy go run ./cmd/solar-backend --data-dir <profile-directory> --earth-orientation <manifest-path>`.
4. Set `VITE_SOLAR_API_BASE_URL` for a full Web build. Preview builds cannot submit
   ground-observation requests, even when an API URL is present.

The IERS loader verifies source URL, retrieval timestamp, byte count, SHA-256,
filename and dated fixed-width records before startup. It uses Bulletin A
columns and preserves I/P flags and published errors for xp, yp, UT1, dX and dY.
The larger endpoint error accompanies interpolation; this is not a propagated
statistical confidence interval. Missing celestial-pole corrections stay absent.
UT1-TAI interpolation preserves UTC leap-second discontinuities. There is no
extrapolation, no zero-EOP fallback and no interpolation across a missing day.
The outer coverage endpoints are not proof of continuous internal coverage.

## Calculation and boundaries

Input is an explicit ISO UTC instant with `Z`, including a valid `23:59:60` leap
second. SOFA-style quasi-JD is internal only. UTC → TAI → TT, UTC → UT1 and the
Fairhead-Bretagnon topocentric TDB model are distinct conversions. Future UTC
uses the pinned library's last known leap second (effective 2017-01-01), and the
result discloses that assumption. A dubious-year library flag is retained.

WGS84 geodetic stations use east-positive longitude, latitude and ellipsoidal
height. The calculation uses exact available SPK states, IAU 2006/2000A
precession-nutation with available IERS dX/dY, Earth rotation and polar motion.
Reception Earth/Sun states, retarded target states and solar deflector states
share the catalog's numerical/provenance path. A target changing SPK solution
within light-time iteration fails explicitly.

Results distinguish simultaneous geometric directions, apparent airless
directions with light time, finite-distance solar monopole deflection and
annual/diurnal aberration, and optional weather-dependent refraction. Azimuth
starts at north and increases toward east. The refraction estimate is returned
only at airless altitude >= 5 degrees; below that its absence is explicit.
Directions refer to the target center and the ellipsoid's local horizon.

No terrain, finite target limb, station tectonics/tides, planetary light
deflection or Shapiro light-time correction is included. A target below the
horizon can have a valid mathematical direction; it is not declared visible.
The 50-microsecond light-time iteration tolerance reflects the catalog's scalar
Float64 JD resolution and is **not** a physical uncertainty estimate. SPK center
chains and different source solution sets retain their existing limitations.
Library attribution and license notices are in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Independent evidence, 2026-09-23

The local full snapshot contains 19,990 complete records, MJD 41684–61673;
SHA-256 `c672540e026d3cd4840c0858d4ce2bc4a18c3bc9751f9636c3285e11950d58a1`.
The September 23 sample is **predicted**, not measured. The seven-row test
excerpt has its own checksum and does not represent full operational coverage.

Six cases cover Moon/Sun at Singapore and Venus at Greenwich. The pinned
[Horizons responses](../tests/fixtures/observer-moon-singapore.json) retain
request parameters, original response bytes and response SHA-256. Direct
Horizons angular separations are 0.36–0.51 arcseconds; range residuals are below
0.3 meters in these cases. Azimuth alone differs by up to 1.54 arcseconds near
the zenith, where azimuth is ill-conditioned. Do not call this sub-arcsecond
physical accuracy: Horizons uses DE441 and its EOP/horizon chain, while this
implementation uses DE440, finals2000A and an ITRS-aligned WGS84 local basis.
The residual has **not been fully attributed**. Disabling the final horizon
polar rotation nearly removes it at Singapore but not Greenwich; that diagnostic
is not a reason to alter the declared ITRS convention. No empirical offset is
applied to force agreement. The Horizons comparison is a one-arcsecond angular
regression envelope, not a matching-input numerical oracle or error bar.

The separate [ERFA reference](../tests/fixtures/observer-erfa-reference.json)
uses ERFA's C implementation, jplephem's independent SPK reader, the same pinned
inputs, and a direct celestial-to-terrestrial matrix followed by east/north/up
projection (without `Atioq`). All six Go results agree to below 0.000001
arcsecond locally. The portable regression bound is 0.00036 arcsecond per
coordinate. Reproduce with [verify-observer-erfa.py](../scripts/verify-observer-erfa.py);
its docstring pins the optional Python packages. Fixture generation is explicit
and requires no network after the packages and scientific sources are present.

Primary references: [SOFA cookbooks](https://www.iausofa.org/cookbooks),
[IERS field specification](https://maia.usno.navy.mil/ser7/readme.finals2000A),
[Horizons observer quantities](https://ssd.jpl.nasa.gov/horizons/manual.html),
[ERFA source](https://github.com/liberfa/erfa).
