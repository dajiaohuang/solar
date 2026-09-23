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
aberration convention. The current real-source verification uses original
DE440 J2000 geometric (`NONE`) states and [pinned PCK radii](body-shape-sources.md).
Only equal-axis PCK bodies are treated as spheres. No mean-radius substitution
is used for a triaxial body, and no body orientation has yet been evaluated.

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
certification, full apparent-limb modeling, topocentric observers,
triaxial/oriented limbs, topography, refraction, atmospheres/rings, stellar
astrometry and native/browser event consumers remain unfinished. It does not
provide a photometric flux loss, uncertainty distribution, event probability,
ground eclipse path or visibility prediction.

## Bounded contact search

`findOccultationContacts` samples external and internal angular gaps, then bisects
sign-changing brackets to an explicit time tolerance. It retains start/end gap
values, so a window wholly inside an event is not mistaken for no overlap merely
because it contains no contacts. Sampled exact zeros are emitted once and labeled
without inventing a crossing direction. Evaluation/result budgets reject rather
than return incomplete success. The search yields every 64 evaluations, checks
cancellation before and after source evaluation, and does not hide source errors.

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
