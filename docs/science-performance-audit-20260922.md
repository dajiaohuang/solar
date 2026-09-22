# Scientific and compute audit — 2026-09-22

Scope: shipped orbital data, time scales, frames and centers, numerical engines,
event analysis, data validation, and measured SPK evaluation cost. Baseline:
`53ed53ea20f6a17f4c4686ece97bea1cd24a7bbc`. Deployment and dataset publication
remain paused. This report distinguishes numerical contracts, source integrity,
model approximations, and physical accuracy.

## Findings repaired

| Area | Defect | Result and regression evidence |
| --- | --- | --- |
| Source time scales | SBDB TDB and MPCORB TT epochs were subtracted from UTC dates; JPL secular fits and six named satellite ellipses also lacked the conversion | Source time scales now reach the propagator. MPC point workers convert once per job while responses retain the request UTC epoch. Source-epoch and Horizons-vector tests exercise the actual instants. |
| Go planetary fallback | Several initial angles were wrong; a model labeled secular used fixed elements. Earth used the EMB directly; the Sun attempted an invalid zero-size ellipse | Eight planets use the published Table 1 coefficients and rates. Analytic velocity differentiates all six elements and their rotation. Earth uses the same lunar mean ellipse and DE440 GM partition as Web. The heliocentric Sun is zero. Trajectories identify their center and reject approximate dates outside 1800–2050. |
| Unsupported fallback provenance | A rounded Pluto seed was attributed to the current JPL Table 1, which has no Pluto row | Its identity remains; an unsourced builtin state is missing. Packaged SPK and independently sourced epoch elements retain their existing paths. Exact requests still cannot use approximate fallback. |
| Lambert | A fixed negative bracket rejected valid hyperbolic transfers; absolute residual tolerance admitted inaccurate small-scale solutions; Stumpff evaluation lost precision near zero | Adaptive negative bracketing, stable series and scale-aware tolerance. Three independent analytic hyperbola cases failed before the repair and pass afterward, including an arc requiring z below −4π² and its scaled counterpart. |
| Osculating elements | A dimensionful angular-momentum cutoff discarded valid small-system ellipses | Relative degeneracy checks and normalized node geometry preserve conics under length/GM scaling; regression spans factors 1, 10⁻⁴, 10⁻⁶. Singular/parabolic states remain explicitly unsupported. |
| L3 | The first-order coefficient mixed heliocentric and barycentric origins | Heliocentric L3 uses −R(1−7q/12). An independent rotating-frame force balance verifies an O(q²) residual for Earth and Jupiter. These remain circular restricted three-body illustrations. |
| SPK types 2/3 | Every state copied coefficient arrays and allocated coefficient subarrays | Direct byte-buffer Clenshaw evaluation preserves arithmetic order and endianness, retains the public record inspection API, and rejects nonfinite output. Analytic quadratic and derivative tests supplement existing CSPICE fixtures. |
| Event analysis | Apsides-only work still evaluated all pairs; non-angular jobs unnecessarily required an observer | Only requested distances, angles, parents and pairs are evaluated. Apsides-only sampling avoids the O(B²S) pair stage. Cancellation is checked through apsides and before publication. Four worker regressions cover selective work and cancellation. |
| MPCORB validation | Checksums and compact-index agreement did not validate every orbital field | Every row now checks all eight numeric fields and the supported elliptic domain. A corruption test updates the checksum and still detects nonfinite angles or nonpositive mean motion. Sample grouping no longer repeatedly copies growing arrays. |
| Benchmark meaning | Go trajectory benchmarks could time error or missing-state responses | An untimed preflight verifies numeric state counts. The 64-body benchmark selects 64 computable ellipses instead of arbitrary catalog identities. |

## Data inspected

The immutable asteroid release `mpcorb-26bbcb75e45b7cbb-full` passed the full
validator: **1,561,171 objects and 2,345 artifacts**, including the new semantic
checks on all orbit rows. No source snapshots, kernels or released assets were
rewritten.

Both checked-in ephemeris profiles contain 670 entries; their union has
**872 unique files, 1,253,200,896 bytes and 1,188 descriptors**. Every file passed
size, SHA-256 and target-identity verification and SPK parsing. Descriptor types:
799 type 2, 23 type 3, 2 type 17, 364 type 21; all raw frames are J2000 (frame 1).

Five epochs per descriptor produced **5,940 finite six-component states** using
the reader's normal target/segment precedence. Running the baseline and revised
readers against those same files produced identical Float64 bytes, including
center/frame identity. This does not assert that overlapping older segments
were selected, or certify physical accuracy continuously between samples.

| Identity | SHA-256 |
| --- | --- |
| Preview manifest | `93e3733dd2d4b673e85bae5f55c1aa4eb8d4af3e95ccc3cc1cc8a3a54d064d1c` |
| Full manifest | `4d600f46c1b0d35ee440d416b19489e3de145058c3aa7f5744d64c480251a1c2` |
| Before/after sampled states | `207850ad9ffb4ce74a8fce0847a5744c629ecaf06f7e00ed88832c40a27b96a8` |

Reproduce the read-only audit with `rtk npm run audit:scientific-assets`. An
optional output JSON path and optional reader module path can be passed directly
to `scripts/audit-scientific-assets.mjs` to compare implementations.

## Performance measured

Windows x64, Node v24.14.1, Intel Core i9-14900KF. Pinned DE440s crop SHA-256
`8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069`.
Each row is the median of seven runs of 100,000 states, after 5,000 warm-up
evaluations. Baseline and final measurements ran separately from tests.

| Target | Baseline | Revised | Ratio |
| --- | ---: | ---: | ---: |
| Earth, 399 | 46.2359 ms | 8.2851 ms | 5.58× |
| Moon, 301 | 49.1510 ms | 8.8388 ms | 5.56× |

Aggregate checksums match exactly for both targets. `rtk npm run benchmark:spk`
records runtime, pinned source hash, implementation hash, each run and checksum.
This measures the JavaScript SPK evaluator, not app FPS, network latency, Go
service throughput or a physical mobile device. The single-iteration Go
benchmark invocation was only a workload smoke check; no throughput improvement
is inferred from it.

## Verification and retained boundaries

1. Local verification used a combined science sweep (23 files / 173 tests at
   that stage), then focused regressions after the event, satellite and backend
   changes. Go science/catalog/HTTP tests pass; independent source-table
   evaluation checks all eight planets at four epochs and finite differences
   check the analytic velocity. Existing numerical tolerances were not relaxed.
   Final CI runs the complete required gate on the delivery commit. Local
   full-unit and browser suites were not repeatedly rerun.
2. SPK centers, solution-pool precedence, type 17/21 readers, source-only
   withholding, bounded compute caches, light time/aberration, Earth–Moon GM,
   Hohmann transfers and sampled-event refinement were reviewed alongside their
   existing regressions. This audit found no additional evidenced change needed
   in those paths. Finite-difference fallback velocities, fixed satellite
   ellipses and sampled event searches retain their approximation limits.
3. The original historical MPCORB text snapshot and the complete external
   source-inventory staging set are absent locally. Generated-release integrity
   and orbital semantics passed; this run does **not** claim a fresh row-by-row
   replay against the missing raw snapshot or a new audit of unstaged inventory.
4. Web dates before 1972 retain an explicitly exploratory numeric-JD fallback;
   historical UTC corrections are not fabricated. Future leap-second uncertainty
   remains visible. JPL fits and lunar mean elements are not precision
   ephemerides or an N-body integrator. Go approximate trajectories enforce the
   fitted interval; Web retains its existing extrapolation warning.
5. Real-device frame rate, production HTTPS, deployment and release acceptance
   were not performed. Integrity and model-parity tests do not replace physical
   ephemeris accuracy evidence from CSPICE/Horizons reference fixtures.

## Primary references

- [MPC minor-planet orbit format](https://docs.minorplanetcenter.net/mpc-ops-docs/orbits/minor-planet-orbit-format/): packed epoch TT, angles and mean-motion units.
- [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html): osculating epochs in TDB.
- [JPL approximate planetary positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html): Table 1, JDTDB, element rates, EMB and validity.
- [NAIF SPK specification](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html): polynomial types, centers, frames and segment priority.
- [NAIF time conversion](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/deltet_c.html) and [IERS Bulletin C 72](https://datacenter.iers.org/data/html/bulletinc-072.html): dynamical/civil time and the announced leap-second boundary.
- [JPL astronomical parameters](https://ssd.jpl.nasa.gov/astro_par.html): units and physical constants; the fixed NAIF frame definition is retained.
- [NAIF conics](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html) and [osculating elements](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/oscltx.html): conic state reconstruction and singularity boundaries.
- [NASA Lagrange points](https://science.nasa.gov/solar-system/resources/faq/what-are-lagrange-points/): restricted-problem interpretation. The corrected L3 coefficient is independently derived and tested from the heliocentric force equation.
