# Source-backed body shapes

The unmodified [NAIF generic PCK pck00011.tpc](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)
is pinned at `src/data/pck00011.tpc`, with retrieval time, URL, size and SHA-256
in `src/data/pck00011.source.json`. Original body-specific references, historical
values and limitations remain intact. The source is 131,226 bytes with SHA-256
`3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1`.

`loadPckRadii` accepts only those exact source bytes and returns 95 sets of three
positive ellipsoid semiaxes in km. It reads only actual `begindata` blocks,
excluding historical/example/commented assignments. For example, Charon's active
value is 606 km rather than the historical 605 km in comments; Hartley 2's
commented axes are not treated as available data. The original source is owned
before asynchronous hashing, and returned arrays cannot mutate the catalog.

The loader retains triaxial axes rather than replacing them with mean radii.
Equal axes label the source's spherical approximation; they do not establish
that the physical body is spherical. Radius uncertainty is `null` (unknown),
never an invented zero. There is no limb topography, atmosphere or ring model.
PCK object IDs are retained exactly. In particular, small-body SPK aliases must
be mapped explicitly; a barycenter does not acquire a shape through its parent
planet. Existing educational/rendering mean radii are not substituted into this
scientific source contract.

The [independent reference generator](../scripts/reference-pck-radii.py) loads the
original kernel with CSPICE N0067 / SpiceyPy 8.2.0 and enumerates actual pool
variables through `gnpool` / `gdpool`. All 95 extracted triples agree within
`2e-15` relative arithmetic tolerance. Three focused checks cover complete
extraction, commented values, triaxial preservation, IDs, hashes and ownership.
This verifies data extraction, not physical accuracy of the adopted shapes.

```sh
rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-pck-radii.py --output .cache/pck-radii-reference-new.json
```

Orientation is not evaluated by this loader. NAIF specifically warns against
high-accuracy use of the generic Earth orientation model and points to more
accurate Earth and lunar orientation products in the original kernel. Ground
observations must retain their SOFA/IERS path. Apparent limbs, light-time effects,
occultation/transit/eclipse contact search, catalog alias integration, independent
event cases and user-facing event analysis remain unfinished. The loader does
not claim that acquiring radii completes these requirements.
