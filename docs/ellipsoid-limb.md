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
