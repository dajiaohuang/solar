# Optional SPK body seeds

`scripts/generate-ephemeris-bodies.mjs` samples every manifest target that is
not already represented by `majorBodies` at JD 2461290.5 (2026-09-04,
TDB-labelled). It records the direct SPK parent-relative state and derives a
two-body instantaneous osculating ellipse using the corresponding GM from
NAIF's `gm_de440.tpc`.

This artifact is an explicitly labelled fallback seed, not an operational
ephemeris and not a claim that the ellipse remains valid under perturbations.
The generator skips a target if its parent has no GM or the sampled state is
not a bound ellipse; it never substitutes an invented gravitational parameter.

The SPK sources and manifest identity are retained in the JSON metadata. GM
source: [NAIF generic kernels, gm_de440.tpc](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc).
SPK format/evaluation conventions: [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html).
