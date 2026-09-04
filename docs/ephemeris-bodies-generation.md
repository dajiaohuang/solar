# Optional SPK body seeds

`scripts/generate-ephemeris-bodies.mjs` samples every manifest target that is
not already represented by the original `majorBodies` at JD 2461287.5 (2026-09-04,
TDB-labelled). It resolves the actual parent body center, rotates into ECLIPJ2000, and derives a
two-body instantaneous osculating ellipse using the corresponding GM from
NAIF's `gm_de440.tpc`.

Run `node --experimental-strip-types scripts/generate-ephemeris-bodies.mjs --gm path/to/gm_de440.tpc` after generating the SPK manifest. GM and manifest digests are recorded in the output. Missing satellite GM uses a clearly labelled parent-only mass approximation; parent GM is never invented. The generated ellipse has a TDB epoch and the application converts modern UTC input before propagating it.

This artifact is an explicitly labelled fallback seed, not an operational
ephemeris and not a claim that the ellipse remains valid under perturbations.
The generator skips a target if its parent has no GM or the sampled state is
not a bound ellipse; it never substitutes an invented gravitational parameter.

The SPK sources and manifest identity are retained in the JSON metadata. GM
source: [NAIF generic kernels, gm_de440.tpc](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc).
SPK format/evaluation conventions: [NAIF SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html).
