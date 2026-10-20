# Backend snapshot diagnostics

The Full inspector's orbit tab now derives relative geometric quantities from
the same backend frame used for its distance and source readout. No local SPK
pool or approximate orbit is substituted. This source change is unexecuted.

Both objects must have exact six-component states at the snapshot's TDB epoch.
Source Float64 positions (km) and velocities (km/s) are subtracted in ECLIPJ2000.
The geometric range rate is the dot product of relative velocity with the unit
relative position; positive values mean increasing separation. It is not an
observed Doppler measurement and includes no signal light time or aberration.

The existing `stateToConicDiagnostics` function supplies instantaneous Newtonian
eccentricity, periapsis, signed semimajor axis, energy and plane inclination.
Hyperbolic states are retained; near-parabolic axes and degenerate planes remain
undefined. See [NAIF OSCELT's state, frame and degeneracy requirements](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscelt_c.html).
The function is not a CSPICE implementation or a numerical equivalence claim.

The explicitly adopted GM table is the bundled DE440 table already recorded in
`ephemerisBodies.json`; its source URL and SHA-256 accompany exports. Where both
GM values are available their sum is used. Missing target GM is labeled as a
primary-only approximation. Without reference GM, geometric readouts remain
available and the conic is absent. Selecting an arbitrary reference does not
establish it as the target's physical primary or a useful propagation model.

The two SPK states may belong to different solutions. The UI does not infer a
joint fit or infer the solution's GM from a filename. Exported JSON retains both
absolute six-vectors, the relative state, epoch, adopted GM, two source receipts,
manifest hashes and any center-chain digests. These hashes identify sources;
they do not establish observational precision or propagated uncertainty.

The snapshot accessor exposes existing retained numbers only; no extra request,
state cache, worker or kernel download is introduced. A single selected pair is
materialized on the orbit tab. Missing rows, unavailable components or coincident
positions produce no diagnostic. Light-time diagnostics require emission-epoch
states and remain a separate integration task; independent ground-observation
tools retain their own explicit request epochs and receipts.

No test, numerical calculation, browser acceptance or build has been run for
this change. Reference comparisons and UI checks remain pending until the user's
implementation-only phase ends.

## Light-time numerical residual audit

Source review found the older one-part-JD apparent-position loop accepted equal
rounded timestamps as nanosecond convergence. It now checks both successive
delays and the light-time equation at the actual representable emission epoch.
The default is 50 microseconds for this one-part-JD path; explicitly stricter
requests are not silently relaxed. The returned vector, emission epoch and
range-derived delay belong to the same final evaluation. Residual and tolerance
are retained in parent-relative observation results and the preview readout.

The Go station observer and relative-TDB-seconds reception helper now apply the
same two residual conditions. The relative-seconds helper keeps its requested
tolerance and may reject poorly resolved large offsets; callers must rebase
time instead of treating floating-point stagnation as physical precision.
[NAIF reception geometry](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/abcorr.html)
defines the target at emission and observer at reception; none of these changes
adds relativistic signal delay or establishes observational accuracy. Changes
remain unexecuted under the test hold.

## Split ET in the DE440 event paths

DE440 state reads now retain a compensated high/low ET pair through Type 2/3
segment selection and record-relative polynomial evaluation. The one-epoch
center-chain cache keys both parts. The ordinary SPK evaluator is retained;
other SPK types do not silently claim split-time support. A split-time matching
segment of another type is rejected rather than replaced with an earlier one.

Contact search, SPK ellipsoid limbs and stellar station limbs solve reception
light time about each reception epoch as zero, passing the emission offset
separately into the DE440 accessor. Limb receipts preserve that origin and offset
in addition to their rounded compatibility epoch. Initial reference-JD precision,
polynomial rounding and original source accuracy still limit the full calculation. No end-to-end nanosecond accuracy is claimed.
These changes have not been executed or compared against reference results.

## Shared translation/orientation epoch

Text-PCK orientation now accepts a separate ET offset. Polynomial contributions
from that offset are evaluated as a translation through degree three, with the
large base angles reduced before adding small angular corrections. Periodic
phases use the same split time. Both limb pipelines obtain their orientation
epoch pair directly from the DE440 state source used for translation. Receipts
retain that pair alongside a rounded compatibility scalar. This does not turn
the text IAU model into binary-PCK or SOFA/IERS orientation, nor remove Float64
polynomial/phase errors or the precision limit of the supplied reference JD.
The source change remains unexecuted and numerically unverified.
