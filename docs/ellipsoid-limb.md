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
atmosphere, rings, binary PCK, light time, stellar aberration or gravitational
deflection is included. Callers must supply an appropriate epoch and geometry.
Overlap/contact searches, probability calculations, complete event detection
and native limb workflows remain separate unfinished work.
