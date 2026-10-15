# Source-backed body orientation

The science page's **Body orientation** panel evaluates all 75 orientation
models in the pinned, unmodified `src/data/pck00011.tpc`. Input is an exact PCK
body ID and TDB seconds past J2000, not UTC or a catalog alias. The default is
Mars (499) at J2000. Missing models remain unavailable.

Outputs retain the pole right ascension/declination, prime meridian angle,
constant-reference epoch and row-major J2000-to-body-fixed matrix. For a column
vector, `bodyFixed = matrix * j2000`. The Web export includes the source URL,
size/hash, evaluation input, limitations and application build identity.

The parser shares the existing byte/hash check and only reads active data blocks
of the pinned kernel. It evaluates actual polynomial degrees, planetary-system
nutation/precession terms, Mars-system quadratic phases and Tempel 1's specific
reference epoch. Deprecated LONG_AXIS values are not applied. The equations and
frame convention follow [NAIF PCK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html).

This is the text-PCK IAU model. It does not replace SOFA/IERS Earth orientation,
high-precision lunar/binary-PCK orientation, topography, atmosphere or ring
geometry. Physical orientation uncertainty is explicitly unknown. The evaluator
accepts ±100 Julian years around J2000 as a numerical policy; this is not a
published physical-validity interval. Callers performing reception geometry
must choose the appropriate emission/orientation epoch explicitly. Integration
with ellipsoidal occultation contacts is still incomplete.

## Offline use

Use an unused destination path:

```powershell
rtk proxy node --experimental-strip-types scripts/evaluate-pck-orientation.mjs 401 843523200 --output .cache/new-phobos-orientation.json
```

The command verifies the original local kernel, hashes its implementation and
creates the output exclusively. It neither downloads sources nor overwrites
existing outputs. An actual Phobos invocation completed locally; the focused
CLI test verifies JSON identity and existing-output preservation.

## Independent numerical comparison

`scripts/reference-pck-orientation.py` uses SpiceyPy 8.2.0 / CSPICE to enumerate
the original kernel pool and call `tipbod('J2000', id, et)` for every model at
four epochs, including ±100 Julian years, J2000 and a 2026 epoch. It imports no
application code. The 300 matrices, kernel and generator hashes, and toolkit
version are retained in `tests/fixtures/pck-orientation-reference.json`.

All comparisons passed a 2e-10 matrix-component threshold. The observed maximum
was 7.863124040774494e-11 for body 515 at -3155760000 TDB seconds. Orthonormality,
handedness, the comet-specific epoch, missing IDs and source mutation were also
checked. This is agreement between implementations of the same source model,
not physical accuracy or a certified error bound between the sampled epochs.

Regenerate to a new output:

```powershell
rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-pck-orientation.py --output .cache/new-orientation-reference.json
```

Named desktop/mobile Chromium cases verified the actual downloaded JSON against
the independent Phobos matrix, the source hash, input invalidation and explicit
missing-model errors. The narrow-screen result was inspected. No full local
test suite was run.
