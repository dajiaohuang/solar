# Ground observations

The full Web body inspector's **Orbit → Ground observer** form submits a single
UTC/station snapshot to the Go backend. It is explicit, cancellable work; moving
the simulation clock does not continuously query the backend. Editing the form
invalidates the previous result. JSON exports retain the original request,
catalog identity, actual SPK hashes, IERS snapshot and model limitations.

The form provides directions at one instant and bounded rise/set/visibility
searches. Native UI and propagated physical uncertainty remain pending.
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

For ground sphere contacts, also pass `--body-radii src/data/pck00011.tpc` to
the backend. Configured PCK bytes must match the pinned original; validation
failure stops startup. `POST /v1/observation/contacts` accepts the explicit
station, UTC interval, foreground/background NAIF IDs and `aberration: "CN"`
from [the Dallas example](../src/data/dallas-ground-contacts-example.json).
The endpoint uses the existing long-computation admission class and shared
compute queue, with a 20-second deadline and request cancellation. Missing
PCK/IERS returns 503, invalid input 400, unsupported shape/source coverage 422.
`GET /v1/observation/metadata` describes contact availability and numerical
limits. Availability means configuration is installed, not that every requested
target/date has coverage. The contact response retains catalog, SPK, PCK and
IERS identity and keeps missed-event/physical-uncertainty limits explicit.

The actual route was checked through a test-managed loopback HTTP server using
original SPK/PCK/IERS data and all four independent Dallas contact references.
Input, missing-configuration, unsupported-shape, cancellation and queue-class
checks are targeted integration evidence, not deployment or native acceptance.
Browser/native ground-contact forms remain pending.

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
within light-time iteration or across an entire window fails explicitly.

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

The result also exports `observerState`: the reception station's barycentric
position (km), velocity (km/s), J2000 axes and two-part TDB epoch. These are the
same SOFA-derived Apco values already used by the direction calculation, not a
separate Earth-rotation approximation. Available targets include simultaneous
`geometricPositionKm` and `receptionPositionKm` from that reception station.
The reception vector uses the evaluated emission target before aberration,
solar deflection, horizon rotation or refraction. Missing targets have no vectors.
These inputs can support event geometry; they do not themselves calculate a
ground contact, apparent limb or surface eclipse path.

`lightTimeSeconds` now retains the iterate actually used for `emissionJdTdb`;
`lightTimeResidualSeconds` separately reports its difference from range/c.
Previously the exported light time was the next fixed-point estimate, even
though the target was evaluated at the preceding iterate. The retained stopping
threshold remains 50 microseconds. The scalar SPK JD still limits resolution;
exporting the station's split epoch does not increase the source evaluator's
resolution or establish physical accuracy.

Six [independent vector cases](../tests/fixtures/ground-vectors-reference.json)
use ERFA's terrestrial PV rotated by the transpose CIRS matrix plus the original
jplephem Earth state, without reading Apco's stored observer position/velocity.
They verify station components within 1e-6 km and 1e-10 km/s, simultaneous target
vectors within 1e-6 km and reception vectors within 0.001 km. Tests also enforce
vector/range consistency and exact association of the reported light time with
the scalar emission JD. These are numerical thresholds for the pinned cases,
not physical uncertainties. The [generator](../scripts/reference-ground-vectors.py)
retains source and implementation hashes and refuses to overwrite an output.
The model follows [ERFA Apco](https://github.com/liberfa/erfa/blob/master/src/apco.c)
and excludes station motion/tides and an exact relativistic terrestrial/BCRS
transformation. Older API replies without the additive vector bundle remain
readable; a partial, nonfinite or mismatched-frame bundle is rejected.

## Rise, set and visibility windows

**Orbit → Ground observer → Rise, set and visibility windows** reuses the
station and UTC start above. Enter an explicit UTC end (1–86401 SI seconds
later), target-center minimum altitude and an optional maximum Sun altitude.
The model intersects target altitude >= minimum with Sun altitude <= maximum.
Changing the station, start, thresholds or target invalidates and cancels the
old request. Export retains the completed request, crossings, windows, gaps,
source hashes, IERS manifest and numerical/physical limitations.

This is **apparent airless center** altitude. A zero-degree solar crossing is
not conventional upper-limb refracted sunrise/sunset. The weather option for
single-instant observations does not apply to window searches. Terrain,
extinction and finite target size are excluded. A qualifying window is not a
claim that an object can be seen through clouds or with a particular instrument.

The backend searches along elapsed TAI seconds, preserving UTC leap seconds
and an 86401-second UTC day. Output UTC epochs have microsecond formatting;
the bracketed boundary tolerance is 0.25 seconds. A 30-second grid detects
sign changes; extra midpoint checks conservatively mark unresolved intervals
when they reveal sub-step variation. Bisection refines bracketed crossings.
Sub-step pairs of events, tangent contacts and unsampled source gaps can still
be missed. `sampled-complete` means that all queried points were available,
**not** proven continuous coverage or exhaustive event detection. Short-period
spacecraft passes need a separately validated search cadence.

Missing Earth/Sun/target states or EOP intervals remain explicit gaps, never
zero altitude or a window bridged across missing data. Searches share one
source-identity session. A kernel change aborts the job. Work has a limit of
8192 direction evaluations, a 20-second server deadline, normal admission and
the trajectory compute class. Cancellation, budget exhaustion and source
changes return errors instead of a partially completed success.

The [independent window fixture](../tests/fixtures/visibility-erfa-reference.json)
uses ERFA/jplephem with a separate 120-second grid and 0.001-second root
brackets. Five 24-hour cases cover Singapore Sun crossings, Moon altitude plus
darkness, Greenwich Venus, an Arctic empty window and contradictory solar
constraints. All returned boundaries lie within the Go numerical brackets
(plus the oracle's 0.001-second tolerance). Reproduce with
[verify-visibility-erfa.py](../scripts/verify-visibility-erfa.py). This comparison
does not propagate physical uncertainty or resolve the Horizons model-chain
difference below. Additional tests exercise leap seconds, gaps, source changes,
unresolved short events, cancellation and evaluation budgets.

The [SPICE geometry-finder guide](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html)
explains the distinction between search cadence, root convergence and events
that a sampled search can miss. This implementation uses its own bounded
search, not the SPICE GF runtime.

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

The reproducible `--diagnose-horizons` mode in `verify-observer-erfa.py`
substitutes only each response's printed UT1-UTC into the unchanged ERFA
calculation. Across the six pinned samples, local versus Horizons DUT1 differs
by 19–38 microseconds. The direction changes by 0.000269–0.000544 arcsecond;
the remaining Horizons separation is 0.3612–0.5046 arcsecond. Thus the published
DUT1 difference does not explain the observed residual in these samples.
Horizons prints DUT1 to 0.00001 second; this is a sensitivity experiment with
rounded input, not an exact matching-EOP comparison or physical error budget.
The command refuses `--write-fixture` when diagnostics are enabled, so the
substitution cannot overwrite the independent baseline. Production calculations
still use their original IERS snapshot. Horizons documents corrected IAU76/80
and ITRF93 conventions in its [manual](https://ssd.jpl.nasa.gov/horizons/manual.html);
attribution of the remaining full model-chain difference is still open.

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

## Browser ground-contact access

In a configured full profile, open a body's Orbit tab, expand Ground observer,
set the station and UTC start, then open Ground occultation and transit contacts.
Set the end UTC and foreground/background NAIF IDs and submit. Input changes
invalidate earlier results; cancellation discards late responses. The default
pair is Moon (301) in front of Sun (10). Export preserves the full validated
response and its source hashes.

The displayed brackets are numerical root intervals, not physical timing error
bars. The fixed 30-second scan can miss short or grazing events. A contact can
occur below the horizon; this form does not certify visibility. Missing PCK,
IERS or SPK coverage remains an error, and non-spherical PCK bodies are rejected.

Ground contact responses also include sampledOverlapWindows for external disk
overlap and internal disk containment. Each edge retains UTC, elapsed TAI, a
numerical bracket and its kind (clipped search boundary, sampled zero or
bracketed contact). Durations use elapsed TAI, including UTC leap seconds.
Numerical duration bounds combine the endpoint brackets; they are not physical
uncertainty. Windows infer negative-gap spans from existing samples without
extra ephemeris calls. Unsampled gaps may split them, and zero-only samples do
not establish a positive-duration event. Older backends can omit this field;
the browser does not manufacture windows from contact lists.

## Native Android contact form

The Android deck includes an on-demand ground-contact disclosure using its
configured HTTPS backend. Enter explicit UTC bounds, WGS84 station coordinates
and two NAIF IDs; the initial fields show the Dallas 2024 eclipse example.
Edits, cancellation and backgrounding clear results. The form displays checked
contact UTC/brackets, edge geometry, IERS identity and scientific limits.
The form also displays validated sampled overlap windows and duration bounds.
Save JSON opens the system document picker and writes the original response
snapshot, retaining source evidence even while the live form clears on pause.
Device acceptance, including the document picker, is tracked separately from
plain-JVM response/transport tests.
