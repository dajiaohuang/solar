# Occultation geometry and validation boundary

The first calculation layer determines whether the angular cones of two opaque
spheres overlap at one observer epoch. It returns `none`, `partial`, `annular`
or `total`, angular separation/radii, external/internal contact gaps and distances.
`asin(radius / distance)` is used rather than a small-angle radius approximation;
separation uses the cross/dot `atan2` form to retain very small angular offsets.

Positions and radii use km. The observer must be outside both spheres, and the
foreground radial interval must lie entirely before the background interval.
Ambiguous/intersecting/reversed depth configurations are rejected rather than
classified by center-distance alone. Nonfinite/unrepresentable scales fail.
There is no hidden tolerance treating a small positive gap as physical contact.
The contact flags identify exact floating-point zero gaps only.

The caller must supply directions from the same observer, epoch, frame and
aberration convention. The sphere-pair contact path uses original DE440 J2000
states and [pinned PCK radii](body-shape-sources.md); it accepts only equal-axis
PCK bodies. No mean-radius substitution is used for a triaxial body. A separate
point-source ray search now evaluates exact-ID PCK orientation for one body.

The ray-search JSON contract uses `schemaVersion: 1`, exact `targetId` and a
distinct DE440 `observerId`, a nonzero three-component `directionJ2000` pointing
from observer toward the point source,
`referenceEpochTdb` (JD TDB), `startSeconds`/`endSeconds` (relative TDB seconds),
`maxStepSeconds`, `toleranceSeconds` and `aberration` (`NONE` or `CN`). The
direction is normalized and held fixed; the experiment does not select or
identify a catalog star. `CN` optionally accepts `maxLightTimeSeconds` (default
36,000, maximum one day). Inputs are limited to 64 KiB, one year, 20,000 scan
evaluations and the existing 30-second worker deadline.

[CSPICE occult](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/occult_c.html)
independently classifies the two source ellipsoids. The
[reference generator](../scripts/reference-spherical-occultation.py) retains
21 explicit TDB epochs around the 2012 Venus transit and 2017/2024 Sun-Moon
alignments, viewed from Earth's center. It records original kernel hashes,
relative vectors, radii, separation, CSPICE codes and generator/software identity.
These cases cover no overlap, partial and annular classes; total containment is
additionally covered by an analytic constructed case, not mislabeled as a real
geocentric total-eclipse observation.

The application independently evaluates the original verified SPK center chains
and PCK assignments, then compares all 21 classifications exactly and angular
separation within `2e-13` radians. Twenty-four focused checks passed, also covering
tiny angles, concentric containment, source identity and invalid domains. This
is numerical/source-contract validation, not a physical prediction error bound.
No full local tests ran.

```sh
rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-spherical-occultation.py --output .cache/spherical-occultation-reference-new.json
```

This is a geometry foundation, not completed event analysis. Complete-window
certification, full apparent-limb modeling, topocentric observers, finite-body
to finite-body triaxial contacts, topography, refraction, atmospheres/rings,
catalog-sourced stellar astrometry and native ground-event consumers remain
unfinished. It does not provide a photometric flux loss, uncertainty
distribution, event probability, ground eclipse path or visibility prediction.

## Ground-station geometry core

The Go `observation.EvaluateOccultation` entry point now combines the actual
SOFA/IERS station reception vectors with a once-parsed, immutable PCK radius
table. It requires explicit CN, distinct target NAIF IDs and sourced equal-axis
spheres. It preserves the complete observation's station, EOP and SPK evidence,
the original PCK identity, gap angles and classification. It is currently an
internal single-epoch entry point, not an HTTP/native/browser contact search.
Below-horizon geometry is not reported as verified visibility. Apparent center
aberration/deflection is not substituted for a properly corrected limb model.

The Go PCK loader independently matches all 95 CSPICE-extracted radius triples
and excludes commented assignments; non-spherical bodies have no mean-radius
fallback. The Go angular-cone implementation matches the 21 existing independent
CSPICE geometry cases. A real SPK/IERS Singapore Sun-Moon calculation checks the
composition and complete provenance, with cancellation, missing-EOP and shape/
model rejection cases. This composition check is not an independent measured
ground-eclipse reference; event-time references and consumers remain pending.

## Ground contact searches and offline export

`observation.SearchGroundContacts` now searches up to 86401 elapsed TAI seconds
with 30-second scans and 0.05-second root brackets. UTC output preserves a real
leap second. One source-identity session spans all reception, emission and
refinement evaluations; source changes, missing states/EOP, cancellation and
evaluation/result budgets fail the whole job. It returns contacts, start/end
geometry, EOP/PCK/SPK identities and explicit incomplete-search coverage.
There are at most 8192 geometry evaluations and 512 contacts. Sampled zeros
remain distinct from inferred enter/exit crossings. Short events and grazing
contacts can still be missed; this is not continuous-coverage certification.

The offline command accepts an existing local SPK catalog and immutable IERS
snapshot. It requires all station coordinates explicitly and refuses existing
output files. A 20-second search deadline and interrupt cancellation apply.

```sh
rtk proxy go run ./cmd/ground-contacts --data-dir <source-catalog-directory> --iers <iers-manifest.json> --pck src/data/pck00011.tpc --input src/data/dallas-ground-contacts-example.json --output <new-receipt.json>
```

The Dallas 2024-04-08 case uses a declared example station at -96.797° longitude,
32.7767° latitude and 130 m WGS84 ellipsoidal height, not a surveyed observing
site. Four selected original IERS rows have their own byte hash and a receipt
identifying the full upstream snapshot. The
[independent ERFA/jplephem generator](../scripts/reference-ground-contacts.py)
uses 60-second scans and 0.001-second refinement on the same source/model
contract. Its four CN sphere contacts agree with Go within 0.03 seconds; actual
residuals are about 0.00046–0.00961 seconds. The real CLI used 521 geometry
evaluations. This is agreement between numerical models, not observed eclipse
contact timings or physical timing accuracy. Terrain, limb profile, exact
apparent limb transformations, physical uncertainty and visibility remain absent.
The backend now exposes `POST /v1/observation/contacts` when configured with
both immutable IERS and PCK sources; see [ground observation setup](ground-observation.md).
Browser/native access to this ground search remains unfinished.

## Browser experiment

**Evidence → Occultation laboratory** runs the same experiment engine as the
offline CLI in a dedicated worker. Load the Venus example or import a bounded
64-KiB experiment JSON, inspect its IDs/epoch/window, select NONE or CN, and set
scan spacing and root tolerance. The preparation record retains imported bytes
separately from the effective serialized `inputFile` after UI edits; neither
filename nor source declaration authenticates the file. All displayed times
are relative TDB seconds, not UTC. The browser export includes source hashes,
model, settings, numerical brackets/windows and build identity. CLI exports
add individual implementation hashes.

Source loading is bounded to the pinned DE440 byte size; oversized/truncated
or checksum-mismatched sources fail. A 30-second deadline covers download and
search. Cancel, parameter edits, replacement imports and unmount terminate the
worker and invalidate prior results. No state from an old worker can publish
after replacement. The actual SPK and PCK are checked again in the shared engine.

Twelve focused checks passed across desktop Chromium, mobile Chromium, Firefox
and WebKit: real CN calculation/export against the independent reference,
parameter invalidation, cancellation during held source loading, invalid import
and corrupted SPK rejection. The mobile screenshot was inspected without
horizontal overflow. The shared CLI retains exactly the previous contacts,
windows, state-request count and source receipt. This is browser model evidence;
native event UI, topocentric contacts and the other precision limits remain open.

## Oriented ellipsoid point-source contacts

The second panel in the Occultation laboratory accepts an explicit bounded JSON
request with one PCK target ID, one distinct DE440 observer ID, a fixed nonzero
J2000 direction, TDB reference epoch and search interval, scan step, root
tolerance and either `NONE` or `CN`. It does not infer a star identity or
substitute an SPK/catalog ID for a PCK ID. The source direction is normalized
and treated as a fixed inertial forward half-ray for the whole search.

At each reception sample the engine resolves the observer and target from the
same pinned DE440 J2000 center states. `CN` keeps the observer at reception and
solves target-center Newtonian reception light time; `NONE` uses the same
geometric epoch for both centers. Unequal-axis targets use pinned text-PCK
orientation at emission (`CN`) or reception (`NONE`); exact equal-axis spheres
are rotation-invariant and do not substitute a mean radius or require an
orientation model. The ray/ellipsoid intersection supplies the signed clearance
of the forward half-ray in scaled unit-sphere coordinates. When the supporting
line's closest point is forward of the observer, the gap is scaled impact
parameter minus one. When that point is behind the observer, the nearest point
on the forward ray is its origin and the gap is observer scaled distance minus
one. Thus a backward ray stays outside even when its infinite supporting line
passes through the body. The gap is dimensionless, not radians or kilometers;
negative samples indicate forward-ray interception. The receipt identifies this
definition with `gapModel: "scaled-forward-ray-ellipsoid-clearance-v1"` and
`gapUnits: "dimensionless-scaled-unit-sphere-clearance"`.
The observer must remain outside the ellipsoid; scaled observer distance is
restricted to `(1 + 1e-10, 1e12]`, with a minimum-to-maximum axis ratio of at
least `1e-12`. The ray helper also reports its `128 * epsilon * max(1, distance)`
near-limb screening margin; it is a numerical classification policy, not an
error bound.

The search is bounded by the shared 20,000 geometry-evaluation ceiling, 512
contacts, the 365-day input interval and the 30-second worker deadline. It
refines sampled sign changes only when both endpoint signs lie outside the
ray helper's numerical screening margin. A refinement sample inside that margin
is retained as a numerically screened candidate, not reported as a localized
contact; such an interval contributes no inferred intercept window. The receipt
retains each indeterminate sample and candidate crossing. Tangencies and
multiple crossings entirely inside one scan interval can be missed; an empty
result is not proof of no event. CN residuals and time brackets are numerical
evidence, not physical accuracy or timing uncertainty.

This is a browser/offline-worker point-source slice, not a complete occultation
solution. It omits catalog astrometry, source parallax/motion, stellar aberration,
gravitational deflection, differential surface light time, finite background
disks, body-to-body ellipse overlap, terrain, atmosphere, rings and topocentric
station contact timing. The Go ground-contact API and native consumers remain
sphere-only or unavailable for this ray-event mode. The new engine and receipt
binding have received source review only; runtime verification and independent
CSPICE comparison remain pending. Static follow-up audits aligned the search
with its near-limb indeterminate classification and corrected backward-ray gap
signs, so an intersecting infinite supporting line cannot create a false
forward-ray window. Receipt checks also reject multiple localized crossings in
one scan interval, bracketed roots adjacent to sampled zeros, and window edges
whose crossing direction contradicts ingress or egress. The receipt names the
revised clearance model. No tests, build, browser run or independent numerical
comparison was run for these audits.

## Bounded contact search

`findOccultationContacts` samples external and internal angular gaps, then bisects
sign-changing brackets to an explicit time tolerance. It retains start/end gap
values, so a window wholly inside an event is not mistaken for no overlap merely
because it contains no contacts. Sampled exact zeros are emitted once and labeled
without inventing a crossing direction. Evaluation/result budgets reject rather
than return incomplete success. The search yields every 64 evaluations, checks
cancellation before and after source evaluation, and does not hide source errors.

`sampledOverlapWindows` adds inferred positive-duration negative-gap spans for
each boundary. External spans mean disc overlap; internal spans mean one angular
disc contains the other, not necessarily a total eclipse. Edges distinguish
bracketed contacts, sampled zero gaps, negative-gap samples inside an inferred
overlap, and clipping at the requested search boundary. A negative-gap sample
is not itself a contact.
Durations retain numerical lower/upper bounds from both endpoint brackets. These
are not physical uncertainty intervals. Adjacent negative samples may conceal
an unsampled interruption; the spans inherit the search's missed-event warning.
Zero-only samples do not establish an event duration, and an instantaneous
search can report contacts/gaps but produces no positive-duration windows.
Each contact retains its original scan bracket separately from its localized
root bracket: sampled-zero contacts point to one exact grid sample, while
crossings point to the adjacent grid samples that triggered refinement.
Occultation contact receipts use schema version 2 for this provenance and the
explicit negative-sample edge kind.

Three original-SPK cases independently reproduce the CSPICE GF window durations
within 0.04 second. Analytic checks cover clipped windows, separate events,
sampled zeros and duration brackets. The real Venus CN export gives overlap
23975.473 seconds and containment 21838.797 seconds, each with a numerical
duration interval about 0.0184 second wide. Window assembly reuses existing
samples and roots: this case still uses 349 geometry evaluations. These values
are geocentric model results, not surface-observer visibility or measured timing.

**Completeness is not certified.** Grazing events or two crossings inside one scan
interval may be missed. This is tested with a deliberately missed short synthetic
event, whose result still reports `possibleMissedEvents: true`. Empty contact
output must not be interpreted as proof of no events. Root tolerance and bracket
width concern numerical localization only; physical timing uncertainty is unknown.
The [NAIF GF documentation](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/gfoclt_c.html)
also distinguishes detection step size from convergence precision.

The [independent contact generator](../scripts/reference-occultation-contacts.py)
uses CSPICE `gfoclt` with 60-second scan spacing and 1-microsecond convergence
tolerance. It produces four geocentric geometric contacts for the Venus case and
two each for the two Moon cases. The application uses 300-second scans and
0.01-second numerical brackets; all eight contact times agree within 0.02 seconds.
This verifies these cases, not detection completeness or topocentric accuracy.

The offline CLI uses original SPK states without dynamical integration and accepts
only explicitly sourced equal-axis PCK spheres. It exports input/source and
implementation hashes, split TDB epoch, brackets, settings and limitations;
missing/triaxial shapes are rejected. Outputs are exclusive and cancellation
publishes no partial result. The input selects J2000/NONE/TDB explicitly:

```sh
rtk proxy node --experimental-strip-types scripts/find-occultation-contacts.mjs src/data/venus-transit-contact-example.json .cache/venus-contacts-new.json
```

The real CLI example found four contacts in 349 geometry evaluations. Nine
focused search/export checks passed, including limits, cancellation, ownership
of existing output, source hashes and deliberate missed-event reporting. Types
and changed-file lint passed; no full local tests ran. The prototype is offline;
browser/native event access, full apparent/topocentric directions, oriented shapes,
robust grazing-event detection and all remaining event requirements stay open.

## Converged reception light time

The CLI also accepts explicit `aberration: "CN"`. It holds the barycentric
observer at reception and iterates each target's emission epoch in **relative
TDB seconds**, avoiding repeated conversion through a large Julian date. The
fixed-point equation is range divided by 299792.458 km/s. The returned direction
and emission epoch refer to the same evaluated target state. Residuals, iteration
counts and the configured source margin are retained in the export.

The emission interval is covered before searching. The default source margin is
36,000 seconds, configurable up to one day; a target outside that margin fails
without geometric fallback or partial output. Each solve permits at most 12
iterations at a `1e-9`-second residual threshold. Nonconvergence, unrepresentable
emission epochs and missing source coverage are explicit errors. This is center
Newtonian reception light time, not stellar aberration, gravitational deflection
or different light times across an extended body's limb.

The Web result inspector separates scan interval count and realized maximum
spacing from the requested maximum step and root-localization tolerance. For CN
results it also shows observed maximum iterations, equation residual/tolerance,
and light-time/source-margin values. These residuals are numerical convergence
evidence only; the receipt retains `physicalTimingUncertaintySeconds: null`.
Receipt validation binds the declared CN solver model and checks each retained
contact's scan and localization brackets against the requested grid.

```sh
rtk proxy node --experimental-strip-types scripts/find-occultation-contacts.mjs src/data/venus-transit-reception-example.json .cache/venus-reception-new.json
```

The [independent reception generator](../scripts/reference-reception-contacts.py)
uses CSPICE `spkpos` and `gfoclt` with `CN` on the same original source kernels.
Six target directions across the three cases agree within `2e-5` km per component;
all eight contacts agree within 0.02 seconds. A closed-form moving-target case
also verifies iteration, with separate rejection cases for margin, convergence
and time-resolution failures. Seven focused core/export checks passed including
the existing geometric export; types and changed-file lint passed. No full local
tests ran.

The actual Venus CN example required 349 geometry evaluations and 2,478 state
requests (including cache hits), with at most four iterations per target. Its
contacts shifted approximately 333–382 seconds from the geometric model and
differed from the independent CN reference by about 1–4 milliseconds. These are
specific model/numerical comparisons, not a measured physical timing accuracy.
The observer is still Earth's center; ground visibility, full apparent limbs,
non-spherical shapes and event probabilities remain unfinished.
