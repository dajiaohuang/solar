# Finite-distance ellipsoid limbs

`scripts/evaluate-pck-limb.mjs` combines the exact original PCK axes and its
IAU orientation for one explicit body ID. The observer vector is relative to
the body's center, in J2000 coordinates and km. Time is seconds past J2000 TDB.
For example, an explicitly constructed Phobos viewpoint:

```powershell
rtk proxy node --experimental-strip-types scripts/evaluate-pck-limb.mjs 401 843523200 100 200 300 --output new-phobos-limb.json
```

The command validates the original source hash and writes a new report with
axes, orientation, observer, limb and implementation hashes. Existing files
are refused. The example is numerical geometry, not an observed occultation.
In the Web About page, enable **Include finite-distance ellipsoid limb** in
the Body orientation panel and enter the three observer coordinates. The
panel displays the source axes, limb center and generating vectors. Its JSON
export includes the exact input, source axes, orientation and limb limitations.
The default viewpoint is explicitly illustrative; it does not load an actual
observer ephemeris. Changing any input clears the previous result, and turning
the option off returns to orientation-only calculation. No contour drawing or
overlapping-body contact search is implied by this readout.

## Original SPK observer geometry

For an actual source-derived observer/target vector, use the separate offline
experiment instead of manually entering coordinates:

```powershell
rtk proxy node --experimental-strip-types scripts/evaluate-spk-limb.mjs src/data/moon-limb-example.json new-moon-limb.json
```

The JSON input specifies exact `targetId` and `observerId`, `referenceEpochTdb`
(TDB Julian date), `elapsedTdbSeconds`, `J2000` / `TDB` and `NONE` or `CN`.
`CN` requires an explicit `maxLightTimeSeconds` source margin. All evaluated
epochs, including that margin, must lie in the pinned DE440 kernel. An exact
PCK body identity is required; a planetary-system barycenter is never silently
substituted for its planet. Missing axes, orientation or SPK coverage fail.

`NONE` uses simultaneous observer and target positions. `CN` holds the observer
at reception, iterates target-center reception light time and evaluates PCK
orientation at the target-center emission epoch. Both epochs and the iteration
residual are exported. This still excludes differential light time across the
limb, stellar aberration, deflection and topocentric station transforms. The
Moon's text-PCK orientation is not high-precision lunar binary-PCK orientation.
GM is verified by the reused frozen DE440 state provider; this workflow does
not integrate a trajectory or apply its point-mass force model to the limb.

Twelve independent CSPICE `spkpos` / `tipbod` / `edlimb` reference cases cover
Moon-from-Earth, Earth-from-Moon and Venus-from-Earth, at two epochs under both
correction modes. Observer-vector component differences pass 2e-6 km;
orientation and normalized limb comparisons pass 2e-10. These are numerical
parity thresholds, not physical uncertainty estimates. CLI receipt, frozen
input bytes, cancellation and source-failure behavior have targeted coverage.
The actual supplied Moon example evaluates its orientation about 1.2373 seconds
before reception.

The Web About page also provides **SPK ellipsoid limb** with exact target and
observer IDs, reference TDB JD, elapsed seconds, correction mode and source
margin. It uses the same bounded source fetch and dedicated worker as contact
analysis, with a separate calculation discriminator. The worker verifies the
original source before computing; cancellation, input changes and unmount
terminate it and invalidate pending results. Missing data is an explicit error.
Export includes the input receipt, kernel/PCK hashes, center-emission epoch,
limb and model limits. Native access remains unfinished.

### Observer-view contour (implementation awaiting verification)

The Web source-SPK result now includes a 256-segment perspective contour with
equal horizontal and vertical scale. With `forward = -observer / |observer|`
and `ray = point(theta) - observer`, the plotted coordinates are
`(ray dot east / ray dot forward, ray dot north / ray dot forward)`.
They are dimensionless tangent-plane coordinates, not angular offsets in
radians. Positive east is drawn right and positive north up; the dot at the
origin marks the body-center direction, not the ellipse center or photocenter.
The view does not depict surface lighting, topography or occultation risk.

East follows the J2000 equatorial direction except within 1e-12 of the pole,
where a labeled deterministic fallback basis is used. The whole model contour
must remain in front of the projection plane: its minimum depth is evaluated
as the center depth minus the hypot of the two generator depths. A display
failure preserves the original scientific result and export. Web JSON adds
`displayProjection`, including basis vectors, sampled coordinates, segment
count, display extent and limitations. These are display derivatives; source
geometry, correction mode and uncertainty are unchanged.

No contour interpolation error, sky area or contact precision is certified.
This addition has only received source/diff inspection: the user has deferred
all tests and submission until implementation of the full goal is complete.
The earlier numerical results below do not verify this new projection/UI.

### Optional geometric sightline (implementation awaiting verification)

Web and offline SPK-limb inputs accept an optional `sightlineJ2000` three-vector
pointing outward from the observer. It must be finite and nonzero; its length
is ignored. The direction must already use the same observer/frame/correction
convention as the supplied geometry. This does not fetch or transform a Gaia
star. The Web's +X default is explicitly illustrative.

`intersectEllipsoidRay` transforms the observer and direction using the exact
PCK orientation and scales each body-fixed axis by its semi-axis. In this
unit-sphere space the supporting line's impact parameter is the norm of the
cross product of scaled observer and unit scaled direction. A forward
intersection uses a product-of-roots expression for the first positive
distance. The receipt adds `sightline`: classification, normalized input
direction, first distance, both coordinate-frame intercepts, forward-ray
clearance and surface residual. When the closest point on the supporting line
is behind the observer, clearance is measured from the observer to the unit
sphere, so a backward ray remains outside even if its supporting line crosses
the body.

The body-fixed, body-center origin and first-forward-intercept conventions
follow [NAIF surfpt](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/surfpt_c.html).
This implementation has **not** been compared with CSPICE. Near-limb values
within `128 * Number.EPSILON * max(1, scaledObserverDistance)` return
`near-limb-indeterminate`, without an asserted intersection. This screening
policy is not a certified rounding bound, positional uncertainty or physical
error model. The modeled sightline is an infinite forward half-ray; no finite
background distance, stellar diameter, terrain, surface-point light time,
probability or contact timing is modeled. Existing shape/orientation limitations
remain applicable.
All runtime/numerical/browser checks are deferred under the user's test hold.

### Source-backed station stellar ray (implementation awaiting verification)

`runStellarLimbExperiment` composes an original `/v1/stellar/observer` response
with its original request and pinned SPK/PCK bytes. It validates the observer
receipt and original Gaia sources before using the station barycentric position,
two-part TDB reception epoch and coordinate BCRS stellar direction. CIRS,
aberrated and refracted directions are not passed to the geometric ray solver.
Earth/Sun receipt kernel hashes must match the exact pinned DE440 file. This
is source consistency checking, not authentication or independent recomputation.

The new limb input has only `schemaVersion: 1`, exact non-Earth `targetId`,
`aberration: "NONE" | "CN"` and (for CN) explicit `maxLightTimeSeconds`.
Unknown fields are rejected, so a second epoch, observer or manual direction
cannot silently override the receipt. An Earth target is excluded because a
terrestrial station is not an external observer of this text-PCK ellipsoid.
Missing exact body-center states, shape or orientation fail closed.

The offline entry point is `scripts/evaluate-stellar-limb.mjs`, taking four
positional file paths: limb input, original observer request, original observer
response and a new output. It uses Node's TypeScript stripping like the other
scientific scripts. File reads are bounded, SIGINT is cooperative cancellation,
and output creation refuses to replace existing files. The output retains the
observer response JSON text and its byte hash, source identities, implementation
hashes, reception/emission geometry, limb and ray classification. The script
has not been executed under the current no-test/no-execution hold.

This is a single-epoch point-star coordinate screening model. CN freezes the
shape at center emission; it omits differential surface light time and curved
light propagation. SPK J2000 is treated as ICRS-aligned. No source angular disk,
contact timing, terrain, rings, visibility, probability or physical accuracy
certificate is supplied. UI/worker integration and numerical/reference/runtime
validation remain unfinished; earlier limb evidence does not validate this path.

The Gaia station result now exposes this calculation through a dedicated Web
panel using the original request and retained response JSON. Input edits or
replacement of the parent station result invalidate its worker. The worker
uses a distinct `stellar-limb` protocol discriminator, checks byte budgets
before fetching the kernel, and transfers the input buffers. A main-thread
30-second timer terminates the worker even during synchronous computation;
manual cancellation and unmount also terminate it. Existing limb/contact
consumers now check their own response discriminator.

The panel separately shows ray classification and the existing equal-axis
contour. Export includes the retained
observer receipt; separate original station response and request exports support
the offline entry point. Web layout, worker delivery, cancellation, source
round-trip and numerical behavior remain unexecuted under the testing hold.

### Coordinate sightline marker (implementation awaiting verification)

Station and manually supplied sightlines use `projectDirectionForLimbDisplay`
with the exact exported limb basis and unchanged plot extent. A normalized ray
is mapped by horizontal/forward and vertical/forward ratios. A cross is drawn
only for `inside-plot`; `outside-plot` directions are reported without clamping,
and `behind-view` directions have no projected point. Forward components within
`128 * Number.EPSILON` of zero return `near-horizon`, also without a point.
This horizon screen is a numerical policy, not an angular/physical error bound.

The cross has fixed drawing size and is not a stellar disk. The body-center
dot remains distinct. Accessible descriptions and captions identify the marker
state. `displaySightline` exports the normalized ray, projection state, point
when defined, forward component and screen policy alongside `displayProjection`.
No projected point or sampled contour is used to decide the separate 3D ray
intersection. Source inspection only; numerical and rendered behavior are not
yet verified under the current test hold.

## Geometry and conventions

For diagonal semi-axis matrix `A`, map the body-fixed observer to
`q = A^-1 observer`. On the unit sphere a limb point satisfies both
`|x| = 1` and `q dot x = 1`. Its circle has center `q / |q|²` and radius
`sqrt(1 - 1 / |q|²)`. Two orthonormal vectors perpendicular to `q` parameterize
that circle. Applying `A` gives the finite-distance ellipsoid limb. Applying
the transpose of the J2000-to-body-fixed rotation gives J2000 coordinates.
This follows the geometric limb definition in
[NAIF edlimb](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/edlimb_c.html).

Both output coordinate systems use the body's center as origin. The reported
generators are conjugate generators, **not necessarily principal axes**:

```text
point(theta) = center + generators[0] * cos(theta) + generators[1] * sin(theta)
```

Subtract the supplied observer vector to form observer-relative directions.
There is no angular-radius or small-angle approximation in this geometric
ellipse. Ill-conditioned inputs are explicitly rejected: scaled observer
distance must be in `(1 + 1e-10, 1e12]`, axis ratio at least `1e-12`, and the
rotation must be right-handed and orthonormal within `1e-10`.

## Independent checks and limits

`scripts/reference-pck-limb.py` uses SpiceyPy 8.2.0 / CSPICE `tipbod`, `edlimb`
and `el2cgv` for seven original bodies, two epochs and three viewpoints each.
The 42 fixtures include near-surface, oblique and distant observers. Tests
compare centers and invariant generator tensors, avoiding arbitrary ellipse
axis signs. Normalized limb-only comparisons pass `1e-12`; the composed PCK
orientation/limb comparison passes `2e-10`, retaining the independently
measured orientation roundoff. Surface and line-of-sight tangency equations,
analytic spheres, rotations, invalid inputs and exclusive CLI exports are
checked separately. Only these named tests were run locally.

This is same-model implementation evidence. Physical uncertainty remains
unknown. Orientation and axes are text-PCK approximations: no topography,
atmosphere, rings or binary PCK is included. Manual geometry does not apply
light time; the SPK experiment supports only the center-CN approximation above.
Neither workflow includes stellar aberration or gravitational deflection.
Callers must supply an appropriate epoch and geometry.
Overlap/contact searches, probability calculations, complete event detection
and native limb workflows remain separate unfinished work.

## Browser job lifetime

Contact search, SPK limb and station stellar-limb panels share one owned-worker
job helper. A main-thread 30-second timer covers startup, source loading and
computation, including synchronous work that cannot service a worker timer.
Expiry, worker/decode errors, cancellation and component teardown terminate the
worker and detach handlers; startup postMessage failures release it before being
reported. Browser timer suspension can delay expiry; this is not a hard real-time
guarantee. Panels guard publication by their current job identity.

The helper checks the requested calculation discriminator and schema-1 receipt
envelope, rejecting an unexpected response branch. Before transfer it also owns
the original input bytes, parses their payload and independently hashes them.
Publication requires matching input hash, byte count and preserved payload.
Station stellar-limb publication additionally matches the exact original observer
JSON/hash/byte count and the submitted star ID, UTC and station fields.
The timeout and cancellation remain active while hashing/binding completes; a
cancelled or superseded job cannot publish after a late digest. This binds the
report to submitted sources, but does not validate full geometry, authenticate
external sources or establish numerical/physical correctness.
No new scientific calculation was introduced. These lifetime paths remain
unexecuted under the implementation-only hold.

## Asynchronous source ownership

Contact experiments invoke PCK and DE440 loaders together before their first
await. Each loader snapshots its input synchronously, so caller mutation during
PCK hashing cannot change the SPK later used by the experiment. This reuses the
loaders existing copies rather than adding another full kernel snapshot. Both
promises are observed even if one fails. Cancellation is checked immediately
after loading. SPK and station stellar-limb experiments capture the original
AbortSignal once; its abort state remains live, but replacing options.signal
cannot switch the cancellation channel. These guarantees are source-reviewed
only and have not been exercised during the testing hold.

Contact and limb receipts explicitly include ephemeris.elapsedRangeSeconds from
the frozen provider. This window includes the reference epoch and the adopted
center light-time source margin, so it differs from a contact search interval or
a single reception instant. It records allowed source evaluation, not event
completeness or physical error.

The three browser experiment panels expose a shared expandable time-window view.
Contact results show the submitted search bounds, whereas single-epoch limbs
show reception and center-emission instants. All show the reference TDB Julian
date and frozen elapsed source window separately. Display checks reject
nonfinite, reversed or out-of-window times. No UTC conversion or absolute-date
rounding is introduced. The source window is explicitly distinguished from
whole-kernel coverage and event completeness; UI behavior is not yet exercised.

## Station ray provenance and sky context

Station limb receipts now retain the original BCRS coordinate direction,
reception observer barycentric position and split TDB epoch in coordinateRay.
The main-thread binding matches these fields to the captured observer response
and requires the intersection ray to be its normalized coordinate direction.
The SPK J2000/ICRS alignment convention and already-applied observer parallax
are explicit. A CIRS or aberrated direction cannot substitute for that source
field merely because it is another unit vector. These are receipt consistency
checks, not an independent recomputation of the stellar direction.

This follows the distinction between Pmpx coordinate direction and the later
Ldsun/Ab/CIRS transforms in the [GoFA astrometry source](https://raw.githubusercontent.com/hebl/gofa/master/astrometry.go).
The original apparent-airless altitude, azimuth and coordinate solar elongation
are retained separately as stationSkyContext. The panel flags a negative
airless altitude as below the mathematical horizon, without turning a positive
altitude into a visibility claim. Sky context never changes the coordinate-ray
intersection or supplies atmospheric, terrain or daylight acceptance. The
complete receipt/export retains both stages. Source inspection only; worker,
UI, numerical and reference acceptance remain unexecuted.

Contact, SPK-limb and stellar-limb inputFile receipts now include originalBase64
for the exact owned submitted JSON bytes alongside the hash and parsed payload.
Browser result binding compares that field with the pre-transfer input copy.
This is reproducibility/source consistency, not source authentication or
independent geometry validation. The new export path has not been executed.

Contact-panel exports distinguish preparation.source (exact imported Base64,
byte count, file name and imported-file/bundled-example kind) from inputFile
(the actual submitted JSON, with its worker-bound bytes and SHA-256).
preparation.originalSettings, submittedSettings and changedFields record
light-time model, maximum scan step and contact tolerance overrides. Bundled
example bytes are serialized from the imported object. Preparation metadata
is a local provenance record, not independent source authentication. This
source-only addition awaits runtime/export acceptance.
