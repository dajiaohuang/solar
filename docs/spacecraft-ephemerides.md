# Spacecraft SPK integration

Status: New Horizons OD164 is present in both Pages and full source manifests
after source-byte and sampled CSPICE-reader agreement checks. Voyager 1 and 2
source packs for TDB ET `[631108800, 978264000]` are now present in both
manifests, with explicit Sun dependencies and tracking-fit-through months
1992-04 and 1992-10. Their current pack bytes and descriptor/center coverage
were checked, but TypeScript/Go/CSPICE numerical comparison was not rerun for
the current preparation fingerprint; numerical acceptance remains pending.
For New Horizons, coverage after the 2025-04-18 tracking-data cutoff is a
published prediction extension, not an observational accuracy or uncertainty
bound. Voyager coverage after each tracking-fit month is likewise a published
extrapolation, not later observation or a quantified error bound. No deployment,
release, current runtime/device acceptance or physical trajectory-residual
acceptance has run. The teaching overlay keeps the explicitly schematic paths
in `src/data/spacecraft.ts`; canonical scientific selections remain separate
and have no interpolation fallback.

Juno target -61 is also present in both manifests for TDB ET
`[694267269.1839212, 840884700]` (2022-01-01 UTC converted to TDB through the
latest source descriptor on 2026-08-24). Its root explicitly depends on the
existing DE440S kernel for Jupiter-barycenter and solar-origin coordinates.
The two sources are identified separately; this is not a claim of one shared
orbit fit. Source/descriptor coverage and finite Sun-relative samples passed a
read-only audit, but independent numerical residual acceptance remains pending.

## Reviewed Voyager candidates

Official sources consulted on 2026-09-23:

- [NAIF Voyager source notes](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/aareadme.txt)
- [Published coverage summary](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/aa_summaries.txt)
- [Voyager 1 kernel](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/vgr1.x2100.bsp)
- [Voyager 2 kernel](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/vgr2.x2100.bsp)

NAIF describes these as Jacobson solutions delivered in August 2022, fitting
tracking through April 1992 for Voyager 1 and October 1992 for Voyager 2, with
extensions to January 2100. DE440 was used and included in the files. Coverage
through 2100 does not mean observations through 2100 or a quantified error bound.
The source also cautions about restoration of pre-SPICE Voyager mission data.

HTTP byte-range inspection of file headers and summary descriptors found:

| File | Total bytes from Content-Range | Summary record | Spacecraft target | Frame | Type |
| --- | ---: | ---: | ---: | ---: | ---: |
| vgr1.x2100.bsp | 16286720 | 204 | -31 | 1 | 1 |
| vgr2.x2100.bsp | 15744000 | 161 | -32 | 1 | 1 |

The spacecraft descriptors contain the following closed ET intervals (TDB
seconds past J2000), in file order:

| Target | Center | Start ET | End ET |
| ---: | ---: | ---: | ---: |
| -31 | 10 | -599572800 | 3155716800 |
| -32 | 10 | -321939125.56859577 | 3155716800 |
| -32 | 8 | -326347200 | -321939125.56859577 |

Both summary records also contain planetary Type 2 segments. These observations
are header metadata only: no full-file hash, coefficient validation, state
evaluation or independent reference comparison was performed. They are not an
immutable source archive or an accepted release manifest. Shared descriptor
endpoints retain last-matching-segment precedence; do not average the two centers.

## Reader and preparation changes

[NAIF's format specification](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html#Type%201:%20Modified%20Difference%20Arrays)
defines Type 1 as fixed 71-word modified-difference records, followed by final
epochs, every hundredth epoch and a one-word record count. Its dimension is 15;
Type 21 instead carries a dimension word before its count. The mathematical
representation is shared, so the existing dimension-aware evaluator is reused.

The TypeScript and Go readers now distinguish these tails while retaining the
original segment type. The cropper copies selected original records and rebuilds
the proper epoch directory and tail; it does not refit or convert Type 1 to
Chebyshev data. Survey, coverage and backend type admission include Type 1.
Go validates ordered finite final epochs, segment-end coverage and directory
entries, with cancellation checks. Coefficients remain checked when evaluated;
the browser checks them during construction as before.

No test suite or build has run under the user's hold. The focused CSPICE
source/crop and reader comparisons are recorded below.

## Preparation and acceptance ledger

### Preparation command (written, not executed)

`scripts/prepare-spacecraft-pack.mjs` accepts a new cache name, explicit start/end
ET seconds and `voyager1`, `voyager2`, `newhorizons`, `both` (the two Voyagers)
or `all`. It writes only to a new directory
under `.cache/spacecraft-packs/`. The command is intentionally not part of a build.
For later use, after the implementation hold permits execution:

```powershell
rtk node --experimental-strip-types scripts/prepare-spacecraft-pack.mjs voyager-2020-2031 631108800 978264000 both
```

The numbers are TDB seconds past J2000, corresponding to nominal TDB calendar
midnights 2020-01-01 and 2031-01-01; they are not UTC conversions.

The command archives complete original SPKs (including their comments) and the
official source notes. Source reads are capped at 64 MiB per kernel and 1 MiB for
notes, with a per-response deadline. A fully hashed owned response supplies both
crops, avoiding mixed source revisions. Root and dependency IDs incorporate
original identity and requested window; different windows do not reuse one ID.
Only reachable center targets overlapping the request are cropped as dependencies;
unrelated planetary and small-body segments remain in the archived original.
Embedded planetary segments are dependency-only, and each spacecraft root names
its own dependency file. Descriptor/center-chain checks cover the requested
window, including point boundaries. No state vector is evaluated.

The final `prepared-manifest.json` is written last, with status
`pending-source-and-numerical-acceptance`. A failure retains partial evidence
without this completion marker. A new name is required on retry. At this
document's initial 2026-09-23 review, the command had not run and original
downloads, crops and prepared manifests were unavailable. The later local
preparation and source-note review are recorded below; they remain preparation
evidence, not numerical acceptance.

### Local Voyager preparation (2026-09-25)

The bounded preparation command completed into the local-only directory
`.cache/spacecraft-packs/solar-audit-20260925-voyagers-j2000-2100/` for ET
`[0, 3155716800]` (TDB seconds past J2000). The receipt status is
`pending-source-and-numerical-acceptance`; it is not referenced by a runtime or
release manifest.

The downloaded original identities recorded in `prepared-manifest.json` are:

| Source | Bytes | SHA-256 | Tracking fit stated by NAIF |
| --- | ---: | --- | --- |
| `vgr1.x2100.bsp` | 16,286,720 | `aa8f37673b5ef60296d210566d01cc49f7b32711f37003393c3327616c9fc6d0` | 1992-04 |
| `vgr2.x2100.bsp` | 15,744,000 | `391f5361773322e2242fb1c81578aeb1fbf9134c3878b2f325e9b8b5f46ad7cb` | 1992-10 |

Both archived copies of `aareadme.txt` are 7,092 bytes with SHA-256
`75289b3fd20846e13e3bc540ef9bf9d8929e1109add11f89d6360a371886b8d3`. The
notes identify the Jacobson/JPL SSD solution, say DE440 is included, and warn
that Voyager predates SPICE and restored data should be used with extreme
caution. The 2100 extension is a published trajectory extrapolation, not
observational coverage or a quantified future-accuracy bound.

Each spacecraft has a cropped Type 1 trajectory and a separate dependency-only
Type 2 target-10 center kernel, with no other planetary targets. All four crop
files were read back and their byte counts and SHA-256 values matched the
receipt. Their descriptors and dependency chains cover both requested endpoint
and interior intervals without gaps. This proves structural availability only;
no coefficients were evaluated, no state vectors or reference residuals were
computed, and physical accuracy is not established. Numerical comparison and
scientific source admission remain pending. The cache pack is local preparation
evidence and has not been added to tracked source, runtime data, or any release.

### Identity and scene wiring

Identity plumbing is now implemented in source: the reviewed NAIF table maps
Voyager 1 to -31, Voyager 2 to -32 and New Horizons to -98. The inventory builder
adds three identity-only records with source references, names and scene aliases;
its mapping requires the reviewed source and fields, rather than accepting any
negative number as a spacecraft. Registry contents enter the mapping digest and
generator hashes. No new inventory has been generated under the execution hold.

The API's built-in identities expose scene and canonical aliases as exact-only,
missing-kernel records until separately admitted kernels supply states. Aliases
are not extra physical spacecraft. No heliocentric parent is assigned to imply
an unchanging dynamical center. The browser identity helper excludes schematic
sources before applying the registry, so the existing educational layer cannot
silently acquire scientific status from these identity additions.

`scientificSpacecraft.ts` supplies canonical `naif:` scene entries with explicit
SPK labels, no seed orbit and no fallback positions. They join the normal body
registry, demand-loading selection, backend state tiles and historical trail
pipeline. Registry and loading maps deduplicate canonical IDs with pinned source
records taking precedence. The original named teaching-overlay IDs remain
separate. The inspector chooses the schematic model by source rather than
spacecraft kind and links the identity reference. The current source manifests
now include bounded Voyager source pools as well as New Horizons; the inspector
also shows each admitted Voyager's tracking-fit-through month and labels later
coverage as extrapolation. This is source integration, not rendered/device
acceptance. Preview availability restrictions still apply.

### Backend dependency semantics

Source inspection found that the Go resolver filtered a global manifest-ordered
list by a set of allowed dependency IDs. It now constructs the same ordered pool
as the browser: declared dependencies in order, followed by the spacecraft root.
Missing declared files make the whole pool unavailable, repeated/self dependencies
are rejected, and an explicitly empty dependency list remains root-only. Legacy
roots cannot use explicitly bound solutions as implicit centers. Loading an
invalid file within an explicit pool no longer silently selects a lower-priority
replacement. These changes are unexecuted.

Dependency-only files remain indexed for center resolution but do not publish
or promote standalone body identities, overwrite public source hashes, or extend
their displayed validity. Manifest file counts still describe the packaged files;
they are not evaluated state counts. Numerical behavior still awaits acceptance.

Operational state tiles and inventory snapshots carry `sourceChainSha256`.
Both resolvers hash the actually selected root segment and recursively selected
centers, rather than every file allowed in a source pool. The SSB seed is SHA-256
of UTF-8 `solar-spk-source-chain-v2:ssb`. Each segment hashes the UTF-8 domain
`solar-spk-source-chain-v2:segment\0`, a little-endian uint32 kernel-ID byte
length, kernel-ID UTF-8 bytes, the raw 32-byte kernel SHA-256, little-endian
int32 target/center/original-frame/SPK-type values, little-endian IEEE-754
Float64 start/end ET values, and the raw 32-byte parent digest. Links are hashed
from SSB outwards. This binary encoding avoids cross-language float-format
ambiguity. Inventory records also retain the selected root descriptor and its
verified kernel checksum; the dataset manifest binds the stored full-chain
digest. This is source identity evidence, not a signature, independent
coefficient verification or numerical error estimate.

Wire and browser budgets include the added text/column. Older tiles may omit the
field; absence is not center-chain certification. Historical transition detection
includes it when present, so a changed center dependency can break a display edge
even when the spacecraft's root file is unchanged. Continuous accuracy between
samples is still not established. This complete path remains unexecuted.

1. Bounded Voyager and New Horizons preparation has captured original bytes,
   hashes and source comments. Keep spacecraft roots separate from their center
   dependencies and bind explicit solution pools; never install embedded planets
   as implicit global overrides. New Horizons' coupled planetary/small-body set
   still needs a supported source-pool representation.
2. Exercise scientific selection and scene wiring after source admission,
   including missing-window reporting and pinned inventory identity ownership;
   never substitute a schematic position under a scientific label.
3. After implementation is complete, compare original/cropped Type 1 states
   against CSPICE at record boundaries, directory boundaries, segment endpoints
   and Voyager 2's center transition. Include malformed layouts and cancellation.
4. Then verify cross-language, source-pool, scene and performance behavior using
   focused checks. New Horizons full-byte source review is complete; its coupled
   source-set admission and numerical acceptance remain pending.

The remaining acceptance steps 2–4 have not run. The preparations above remain
local evidence only: no kernel was added to a release manifest and no deployment
was performed.

## New Horizons OD164 source review (2026-09-23)

The [archive SPK directory](https://naif.jpl.nasa.gov/pub/naif/pds/data/nh-j_p_ss-spice-6-v1.0/nhsp_1000/data/spk/)
contains `nh_pred_alleph_od164.bsp`. The accompanying
[nh_v10 meta-kernel](https://naif.jpl.nasa.gov/pub/naif/pds/data/nh-j_p_ss-spice-6-v1.0/nhsp_1000/extras/mk/nh_v10.tm)
loads it before historical reconstructions. The older `spkinfo.txt` stops at
OD161, so it cannot establish the newer solution's cutoff or coverage.

Read-only HTTP ranges of the OD164 header, summaries and comments found BIG-IEEE
encoding, first summary record 15, and two target -98 / center 10 / frame 1 /
Type 1 descriptors in file order:

| Start ET | End ET | Comment-associated solution |
| ---: | ---: | --- |
| 686318469.1823477 | 1041465600 | OD164 |
| 599592940.7559215 | 686318469.1823477 | OD157A |

The original [binary comments](https://naif.jpl.nasa.gov/pub/naif/pds/data/nh-j_p_ss-spice-6-v1.0/nhsp_1000/data/spk/nh_pred_alleph_od164.bsp)
describe OD164's tracking cutoff as 2025-04-18 08:06:50 ET and require its
spacecraft and natural-body ephemerides together. Embedded planetary records
include the Sun relative to SSB. The external label's 1993–2050 range spans
other targets and is not the spacecraft's range. The 2026-09-23 range reads did
not include a full-file hash and the server supplied no ETag; that historical
limitation is addressed by the separate full-byte capture below, which still
does not make the upstream URL immutable.

The preparation tool now explicitly supports this candidate, archives its
meta-kernel and label, and binds the root to its embedded center dependencies.
For this first integration it requires `startEt > 686318469.1823477` and
`endEt <= 1041465600`. At the shared endpoint the later OD157A segment takes
precedence; accepting it as OD164 would mislabel the solution. Earlier mission
reconstructions are still outstanding and are not replaced with prediction.
Prepared receipts retain the cutoff and descriptor restriction; neither is an
error bound. The later preparation is recorded below. No coefficient evaluation
or test has run.

## New Horizons OD164 full-byte preparation (2026-09-25)

The bounded preparation command completed into the local-only
`.cache/spacecraft-packs/solar-audit-20260925-newhorizons-od164/` for ET
`[686318470, 1041465600]` (TDB seconds past J2000). The one-second-rounded
start is 0.8176523 seconds after the OD157A/OD164 shared endpoint, so the crop
does not rely on precedence at that exact boundary. The receipt remains
`pending-source-and-numerical-acceptance` and is not connected to runtime or
release data.

The downloaded `nh_pred_alleph_od164.bsp` is 13,074,432 bytes with SHA-256
`b676f0053ee02f6e32f7e2b23ca2e865ec9f424caa3f2710e87aa06621adc050` and
HTTP Last-Modified `2026-06-10` (no ETag). Its PDS label is 2,640 bytes with
SHA-256 `c52b3c9d9fb8ca09d0978dda78220e735c1de8407e87580fcc064f67fc515876`;
the archived `nh_v10.tm` is 4,989 bytes with SHA-256
`8c588dd29a5057de348829f324a4486917b22e303e590beed4db73c7d9e51d4c`. Their
HTTP Last-Modified dates are 2026-07-31 for the label and 2026-07-30 for the
meta-kernel. The label says the product was created on 2026-06-10; the
meta-kernel says it was created around June 2026. These hashes bind the fetched
bytes, while absent ETags and a mutable archive do not establish a permanent
upstream version.

Full-file DAF comment and descriptor inspection confirmed a merged kernel: the
OD164 spacecraft trajectory is built alongside OD164 planetary and
2014 MU69 small-body source kernels, and its author says the three ephemerides
are a set and should be used together. The same comments give a tracking cutoff
of 2025-04-18 08:06:50 ET, an RTG acceleration of
`1.268688766328822e-12 km/s^2`, and distinct front/back/cylinder SRP area
factors. The first narrow preparation retained only target -98 plus target-10
Sun; it is superseded by the complete coupled dependency pool below. The
predicted span through 2033 does not extend the tracking-data cutoff or provide
a future-accuracy bound.

The first preparation's two cropped files matched their receipt hashes and
descriptor coverage. Like the expanded pack below, it remains structural
evidence only: no coefficients or state vectors were evaluated and no
reference residuals were computed.

## New Horizons OD164 coupled source-set pack (2026-09-25)

The expanded pack is local-only at
`.cache/spacecraft-packs/solar-audit-20260925-newhorizons-od164-coupled-set-v2/`.
The pack was regenerated after adding generation-code hash verification; the
earlier local pack is retained. It binds source set `newhorizons-od164-de433` to the exact positive target set
`1..10, 199, 299, 301, 399, 499, 2486958` listed by the downloaded merged SPK.
The 16 companion targets are stored in one `dependencyOnly: true` Type 2 file;
the -98 Type 1 spacecraft root explicitly names that file in
`solutionKernelIds`. Thus those records are available inside the New Horizons
source pool and cannot act as implicit global roots for unrelated state queries.

The dependency crop is 1,271,808 bytes, SHA-256
`566b8ce3d02fa85ea01c65681da3c30dfc08745fc5f8c542e978c14365c247ec`, with 145
Type 2 segments. The spacecraft crop is 5,080,064 bytes, SHA-256
`2fea6e7b6739c86a60551c056bbb5f8efaa13690e8a0969a90681a1f5e76f4ff`, with one
Type 1 segment. All 17 target windows, including the 130-segment 2014 MU69
member, pass descriptor and center-chain coverage checks without gaps. The
original, label, meta-kernel and both crops were independently read back; all
five byte counts and SHA-256 values match the receipt.

This makes the reviewed OD164 source set representable in an explicit runtime
pool, including same-solution Sun, Earth, Moon and the other listed members
when used as New Horizons observers. It does not establish numerical accuracy
or authorize source admission: no coefficients or state vectors were evaluated,
no CSPICE/reference residuals were computed, and no runtime manifest or release
data was changed. The scalar RTG acceleration and directional SRP factors in
the comments are not by themselves a reproduced OD164 force model.

## Offline manifest integration path

`scripts/integrate-spacecraft-pack.mjs` accepts an explicit `pages` or `full`
profile, pack directory, prepared-manifest SHA-256 and baseline-manifest SHA-256.
It has no network calls and does not run tests or regenerate derived datasets.
Use it in the later integration phase after the original/cropped source review
and numerical acceptance above; a successful integration is not that acceptance.

The entry point binds original SPKs, per-source notes, optional labels and crop
bytes to the pinned receipt, reparses crop descriptors, and checks full requested
descriptor/center coverage. Each root must use a dependency-only file from the
same source. The receipt pins eight preparation, crop, coverage, source-set,
SPK-reader and identity files; integration verifies the exact inventory and
rehashes each file against the current checkout. It also binds every crop's
complete source-identity fields to the original receipt and records the
integrator's own SHA-256 in selection evidence. It refuses ID/path collisions and retains existing manifest files
and precedence. It does not silently shorten the Pages time window; prepare the
desired profile's pack explicitly. Retained crop bytes are limited to 256 MiB.

The script writes immutable kernel paths first and replaces the selected
manifest last. A profile-specific exclusive lock coordinates this integrator;
baseline hashes are rechecked before writes and immediately before replacement.
Other manifest writers must not run concurrently. A failure can leave unreferenced
kernel files for inspection, but does not require deleting prior source data.
The manifest retains preparation/source evidence and states numerical accuracy
is separate. Full-byte hashes bind inputs, not original-to-crop equivalence or
scientific accuracy. At the time this integration path was documented, no
integration or derived-data regeneration had run; the later source admission is
recorded below.

The integrator validates New Horizons' exact reviewed member list, verifies that
the dependency crop contains only those source-set targets, and checks
descriptor/center coverage for every member. Older narrow New Horizons receipts
without that source-set identity fail closed. Voyager preparation uses the same
identity-bound source checks and preserves the NAIF tracking-fit-through month.
Source integration receipts state that numerical acceptance is separate; only
byte and descriptor/center coverage checks do not establish reader equivalence
or an observation-fit error bound.

## New Horizons OD164 reader comparison and source admission (2026-09-28)

A fresh bounded preparation was written to the local-only
`.cache/spacecraft-packs/solar-audit-20260928-newhorizons-od164-coupled-v3/` for
ET `[686318470, 1041465600]` (TDB seconds past J2000). The receipt SHA-256 is
`48262080b4841b14afbade51bfcc7e25684bdb07d8e9ed1e7f9a32c04be73067`. It pins
the same 13,074,432-byte official merged source SPK and SHA-256
`b676f0053ee02f6e32f7e2b23ca2e865ec9f424caa3f2710e87aa06621adc050`; the
current preparation receipt also binds every crop and the implementation files
used to create it.

Three read-only numerical comparisons evaluated 35,259 states across the
requested interval in J2000 coordinates relative to the Solar System
barycenter, with no aberration correction. CSPICE N0067 through SpiceyPy 8.2.0
returned identical six-component values for the original SPK and the two crops
at every sampled ET. The production TypeScript reader and explicit dependency
pool agreed with CSPICE at zero position-component difference; maximum velocity
component differences were `8.88e-16`, `1.78e-15`, and `8.88e-16 km/s`. The Go
reader and dependency pool produced the same sampled differences (Go 1.26.8).
The reports are hash-bound to the prepared receipt and are retained under
`.cache/spacecraft-packs/` as local audit evidence.

Both runtime source manifests now contain 672 entries. Each adds the same
dependency-only Type 2 pool (1,271,808 bytes) and the New Horizons Type 1 root
(5,080,064 bytes), for 6,351,872 additional source bytes. The root explicitly
binds the pool, which contains the 16 reviewed companion targets; it does not
promote them into global ephemeris precedence. The runtime manifest projection
retains a compact source boundary so the inspector can show the OD164 tracking
cutoff and prediction limitation alongside the scientific spacecraft marker.
The integration path also carries each Voyager's NAIF tracking-fit-through
month; when such a source is admitted, the inspector can label later x2100
coverage as a published extrapolation without suggesting observations or a
future-error bound.

This accepts crop and reader representation parity for the bound official bytes.
It does not compare the OD164 trajectory to independent tracking residuals,
quantify accuracy after the 2025-04-18 cutoff, or validate physical dynamics
through 2033. No local unit/integration test, build, browser/device measurement,
deployment, or release ran. The fixed-epoch fallback body table was regenerated
and its source/runtime hashes are recorded in the next scientific-expansion
checkpoint.

## Juno reconstructed-orbit source integration (2026-09-29)

The [official NAIF Juno SPK directory](https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/)
publishes `juno_rec_orbit.bsp` and its [orbit-event table](https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/juno_rec_orbit.orb).
The [PDS Juno SPICE profile](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=JNO-J%2FE%2FSS-SPICE-6-V1.0)
describes the spacecraft SPKs as navigation-team reconstructions and reports
only broad, informal uncertainty scales (about 25 km 1-sigma during cruise and
about 1 km 1-sigma during perijove passes). Those figures are not a per-state
bound for this crop and are not a covariance product.

The source retrieved on 2026-09-29 was 146,816,000 bytes, SHA-256
`13c8c7c431a67af69485b272ebde740f3135585925a454134eb3b80283a4a487`, with
Last-Modified `2026-09-01 18:17:23 GMT`. Its DAF summaries declare 286 Juno
target (-61), Jupiter-system-barycenter center (5), J2000-frame, Type 1
segments. The source comments record the latest reconstruction merge through
2026-08-24. The packaged crop begins at TDB ET `694267269.1839212` (2022-01-01
UTC converted to TDB) and ends at `840884700`; it retains 176 original Type 1
segments in a 91,458,560-byte kernel with SHA-256
`a35de1849693a31464b86631cdd4d8f2ce5661e17352644b755db83fd9106c43`.

Both Pages and full manifests now contain the same Juno root. Its explicit
`solutionKernelIds` entry selects the existing `de440s-2000-01-01-2051-01-01`
kernel, which supplies target 5 and the Sun (10); Juno source states remain
relative to target 5. This makes the mixed-source center/origin chain explicit
without claiming that DE440S was the navigation fit ephemeris. Selecting Juno
currently loads that root plus seven existing core kernels, about 103.4 MB of
declared kernel bytes in total; the Juno crop remains within the per-file
128-MiB reader limit.

Read-only checks verified both manifest entries and the crop hash, gap-free
descriptor/center coverage over the packaged window, explicit selection of the
root and DE440S dependency, and finite Sun-relative position/velocity with the
expected source chain at the start, midpoint and end. No unit/integration test,
build, benchmark, browser/device run, deployment, or release ran. Comparison to
an independent numerical reference, a fitted covariance, and a per-epoch
accuracy estimate remain pending. The [bounded source preparation script](../scripts/prepare-juno-reconstruction.mjs)
and [manifest integrator](../scripts/integrate-juno-reconstruction.mjs) retain
the full-source receipt in local cache and write only the bounded crop to both
manifests.
