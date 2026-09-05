# Satellite source survey

This opt-in build tool surveys authoritative identities and SPK descriptors. It
does **not** add selectable bodies, select a preferred solution, evaluate state
vectors, or certify complete physical coverage. It is never run on app startup.

```sh
node scripts/survey-satellite-ephemerides.mjs --output NEW_DIRECTORY --discovery FROZEN_DISCOVERY_HTML --from 2020-01-01 --to 2031-01-01
node scripts/survey-satellite-ephemerides.mjs --verify NEW_DIRECTORY
```

Inputs are the [JPL ephemeris table](https://ssd.jpl.nasa.gov/sats/ephem/), its
linked original SPKs, and the verified
[public BSP directory](https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/).
The directory's `tnosat_*` files are also inspected, including alternative
versions; inclusion is not source precedence. Other unlisted directory files
are **not** automatically surveyed. The supplied discovery HTML is a frozen
copy of the [JPL discovery table](https://ssd.jpl.nasa.gov/sats/discovery.html).

Every run creates a new directory and retains raw pages, source validators,
header/summary/comment byte ranges, hashes, target/center/frame/type/bounds,
source errors and per-body classifications. Comments are decoded according to
[NAIF DAFEC](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/dafec_c.html).
Embedded name/number pairs must also appear in actual segment descriptors.
Source dynamical GM parameters, including zero, are not asserted measured
physical masses.

Reconciliation compares explicit names/designations/aliases under the same
parent. It normalizes separators and decimal zero-padding in provisional
designations, not Roman numerals into NAIF codes. Raw spellings are retained.
Different matching NAIF numbers remain ambiguous. Multiple published source
assignments are classified individually and marked `source-selection-required`;
table order is not a selection policy. Upstream tables and comments can disagree:
cross-check against the [NAIF ID registry](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html)
before resolving a conflict, and retain both claims.

The descriptor classifier accepts the gap-free union of original segments for a
target, but this does not prove a usable center chain or numerical accuracy.
Runtime whole-window selection likewise keeps a fixed kernel set and retains
original segment precedence. A missing position is not a zero vector: only the
Sun has a heliocentric-origin fallback. Missing reference states suppress the
frame; incomplete trails are omitted rather than connected across gaps.

After a parser correction, reinterpret verified raw evidence offline without
overwriting or silently refetching an older snapshot:

```sh
node scripts/survey-satellite-ephemerides.mjs --rebuild OLD_DIRECTORY --output NEW_DIRECTORY
node scripts/survey-satellite-ephemerides.mjs --verify NEW_DIRECTORY
```

The derived report records the old report's SHA-256. Verification checks current
interpretation as well as archived bytes; an old interpretation can fail after a
parser correction and must be explicitly rebuilt into a new directory.

## Independent join fixture

`tests/fixtures/jup347-himalia-join.bsp` retains original type-2 records on both
sides of JUP347's 2023-12-11 TDB split. Its adjacent descriptors and independent
CSPICE position/velocity references are tested in `kernel-window.test.ts`.
The provenance JSON pins both the crop and the DE440 core used by the numerical
oracle. This is an evaluator/selection regression, not proof of observational
accuracy or a DE442-consistent complete-system solution.

## Supplemental sources and selectable identities

Retain an additional original source only when its exact filename occurs in the
archived JPL directory. The supplemental archive also freezes the NAIF name/ID
registry; the final rebuild replays every archived source before publication:

```sh
node scripts/supplement-satellite-survey.mjs VERIFIED_ARCHIVE SUPPLEMENT_DIRECTORY sat459.bsp,sat480.bsp
node scripts/survey-satellite-ephemerides.mjs --rebuild SUPPLEMENT_DIRECTORY --output FINAL_DIRECTORY
node scripts/survey-satellite-ephemerides.mjs --verify FINAL_DIRECTORY
node scripts/generate-satellite-catalog.mjs FINAL_DIRECTORY NEW_CATALOG.json
```

For an intentional refresh of the generated app catalog, use its existing path
and `--replace-generated`. This flag refuses unrelated files. It does not modify
any original survey archive. The generated catalog pins discovery and survey
hashes. Existing app IDs remain stable; new entries have no orbit, GM or radius.
All identities remain selectable, while defaults still select only the original
19 bodies. Large systems are partitioned into complete, bounded preset groups.

NAIF registry resolutions require both an exact name/parent match and independent
SPK descriptor/comment corroboration. Raw conflicting claims remain in the
survey. ROCKSPK's `***` number field is never interpreted as a number: a name is
associated only when a single included-comment SPKMERGE source explicitly lists
one target, one named ROCKSPK object, and matching parent-centered Type 17
descriptors. This resolves SAT480's S/2009 S2 to 65304 without guessing from the
provisional designation. S/2009 S1 remains unmatched in this snapshot.

## Type 17 independent verification

The runtime and cropper now support the original 12-word equinoctial record.
Only descriptor coverage is narrowed; the elements are retained exactly (with
byte-order normalization). Propagation follows
[NAIF EQNCPV](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/eqncpv_c.html),
including node/periapse rates, reference-pole rotation, and analytic velocity.
No additional generic J2 or relativistic correction is applied to these records.
The implementation rejects non-finite inputs, nonpositive semi-major axes,
eccentricity above 0.9, and zero mean-longitude rate (unsupported by this path).

`spk17-cspice-expanded.json` contains 40 independent CSPICE N0067 states from
five synthetic element sets: nontrivial reference poles, retrograde geometry,
near-0.9 eccentricity, circular limits and epochs up to +/-1e9 seconds away.
Position agreement is checked within 2e-6 km and velocity within 1e-9 km/s.
These are numerical test tolerances, not physical ephemeris uncertainties.
`spk17-oracle.c` contains no application evaluator and can be compiled against
an independently obtained CSPICE toolkit. Reproduce the JSON with:

```sh
cc -I /path/to/cspice/include scripts/reference/spk17-oracle.c /path/to/cspice/lib/cspice.a -lm -o /tmp/spk17-oracle
node scripts/reference/record-spk17-reference.mjs NEW_REFERENCE.json /tmp/spk17-oracle
```

The tests also cover little/big-endian original records, crop endpoint behavior,
invalid records, and current-position-valid/historical-reference-unavailable
spacecraft trails. Identity, format support, independently verified state
evaluation, and delivered source coverage remain distinct acceptance gates.

For real source coverage, `spk17-sat480-cspice.json` retains the original SAT480
record for S/2009 S2 and 65 independent EQNCPV states across 2020–2031, relative
to its declared Saturn center. Regenerate from an integrity-checked source crop
and its adjacent provenance JSON with:

```sh
node scripts/reference/record-spk17-source-reference.mjs SAT480_CROP.bsp NEW_REFERENCE.json /tmp/spk17-oracle
```

## Offline per-target preparation

```sh
node scripts/split-spk-crop.mjs VERIFIED_CROP.bsp NEW_DIRECTORY
```

This explicit, offline command verifies the crop checksum and original HTTPS
provenance, requires a gap-free shared interval, then retains original records
in separate content-addressed target files. Each file is checked at endpoints,
midpoint and descriptor boundaries against the input position and velocity.
The 128 MiB runtime file limit is enforced per target, not by truncating the
identity catalog. Existing output directories are refused. A failed run does
not publish a successful manifest. Generated outputs remain outside Git.

The resulting manifest is preparation evidence, not an app release: source
selection, center-chain solution compatibility and complete source-target
accounting must still pass before integration. Source crops may themselves be
subsets; compare their targets against the frozen source survey. Pages may use
a shorter declared window or subset, while the full distribution keeps its own
coverage target.

## Integrated source pools and profiles

The catalog generator also checks explicit small-body companion selections
against original SATEPHGEN name/number rows and every selected component,
primary and system descriptor in the replayed `tnosat_*` sources. It records
each source metadata hash; it does not infer target semantics from number
prefixes, claim discovery-table membership, or promote source GM to a mass.
The selected eleven TNO companions are additional to the 461 planetary-satellite
identities in the frozen survey reconciliation.

Eight additional primary identities are emitted separately in `primaries`,
requiring the original Horizons target-name/designation line as well as the
primary/system descriptors. `Sat1` labels stay qualified by their parent;
they do not imply formal names. Existing Eris/Haumea scene IDs are preserved.

`sourceSelections` accounts for every frozen `tnosat_*` publication, including
those not selected for runtime delivery. Ten sources are selected; the earlier
Haumea v001 is retained alongside the chosen v001b; Patroclus JPL082 is explicitly
source-only because it omits system target 20000617. The raw `Manoetius` name is
retained, not silently rewritten from another publication. A separate older
Lucy solution 54/DE431 system trajectory does not establish a same-source fit
with JPL082/DE440. Unknown source additions require an explicit reviewed ledger
decision; regeneration fails instead of silently omitting them.

The survey itself does not select sources. The separate offline integrator accepts
a reviewed local JSON plan: `survey` and `surveySha256`, `cores` with `id` and
verified crop `path`, `sources` with `id`, split `directory`, declared `core`,
optional explicit `targets` and selection `reason`, plus `centers` with `id`,
original crop `path`, `target`, `core` and `reason`. Relative paths resolve from
the invocation directory; machine-specific input paths are not published.

A component source can declare `sourceKernelId` to reuse a baseline primary/
system file from the exact same original source and validator identity. The
integrator checks its primary/system targets and coverage before binding it
after the core. `windowLabel: "2020-2030-01-02"` identifies the TNO source
window; it does not extend coefficients. Large component records follow the
explicit Pages 2026/2027 policy while full retains the original longer window.

The optional `systems` plan array names reviewed `id`, `core`, original crop
`path`, `sourceEvidence` and `reason`. It retains all primary/companion/system
records from a single publication, verifies source validators and identity
evidence, and rejects missing/extra targets or incomplete center chains. Full
uses 2020-01-01/2030-01-01 TDB; Pages uses 2026-07-01/2027-01-01 for these eight
new systems to fit the budget without shortening existing published coverage.

```sh
node scripts/integrate-satellite-pack.mjs VERIFIED_PLAN.json
```

For an explicitly reviewed official source absent from the frozen survey, archive
its original header, summary and comment ranges separately:

```sh
node scripts/archive-spk-source.mjs OFFICIAL_HTTPS_SPK_URL NEW_DIRECTORY
```

The command accepts only NAIF/JPL SSD HTTPS BSP URLs, refuses an existing output
directory, and replays the archived ranges before publishing `source.json`.
This metadata archive does not download all coefficients or choose a solution.
Add `sourceEvidence: { directory, id, sha256 }` to the plan's matching source and
core entries, using the printed identity and SHA-256. Integration replays those
bytes and checks the exact source URL and target membership. This supplements,
but does not rewrite, the original survey. Modern NAIF `sat415.bsp` uses this
path; its embedded DE437 center pool is retained with the nine selected moons.

Daphnis's standalone SAT393 Type 17 record also has a separately pinned archive.
The identical file's presence in the official PDS directory establishes the PDS
placement condition in its original comments. Its dependency-only pool retains
SAT393 target 699 and that container's original DE431 targets 6/10. The release
metadata's DE435 fit declaration does not override the generator's explicit
DE431 coefficient provenance. This is an original historical published chain,
not a modern uniform planetary fit; the independent oracle covers it as well.

The integrator replays the frozen survey and verifies crops/checksums, preserving
original records and explicit ordered dependency pools. It produces Pages and
full manifests; existing identical files may be reused, but different bytes at
an existing output path are refused. The legacy `data:ephemerides` generator now
refuses to overwrite an integrated source-pool manifest. Prepare any changed
baseline separately and review its integration rather than losing added targets.

Pages and full each list 510 files and the same target identities. Pages narrows
large satellite files to 2026/2027 TDB; full retains 2020/2031 for planetary
satellites and 2020/2030-01-02 for the Eris/Haumea companions. The eight other
binary systems have the explicit ten-year/full and half-year/Pages windows above. At the modern
test epoch, 508 selectable centers resolve, with the remaining gaps enumerated
in the [physical contract](../../docs/physical-ephemerides.md). The full package
is a delivery profile, not a claim of complete physical coverage of all bodies.

Independent source-pool numerical references can be regenerated without calling
the application evaluator:

```sh
cc -I /path/to/cspice/include scripts/reference/spk-pool-oracle.c /path/to/cspice/lib/cspice.a -lm -o /tmp/spk-pool-oracle
node scripts/reference/record-satellite-pools.mjs NEW_REFERENCE.json /tmp/spk-pool-oracle /absolute/path/to/public/data/ephemerides
```

To intentionally refresh the existing generated reference after a reviewed
manifest change, prepend `--replace-generated`. The recorder requires its own
CSPICE provenance structure and checks that the old file did not change while
the oracle was running. Ordinary invocation still refuses existing files.

The reference pins 444 ordered root pools and 1,380 heliocentric/barycentric
six-vector pairs, including each root's endpoints and midpoint. Tests verify
every source hash, dependency order and numerical agreement. They do not measure
observational uncertainty, certify all dates, or turn different source families
into one globally fitted solution. The build profile is included in build
identity and exported manifest links; the backend full profile does not inherit Pages' cap.

## 中文边界

这只是可重放的身份与数据覆盖调查，不代表新增星体已经上线，也不等于完整物理。
原始目录、网页、星历注释和编号冲突全部保留；不能按网页行序选择解，不能把动力学
模型中的零 GM 当成实测零质量。缺少位置时不绘制天体，参考系无数据时不虚构原点，
轨迹有缺口时不跨越缺口连线。完整数据接入与 Pages 容量选择必须另行明确验证。

补充调查会保留原始文件、独立 NAIF 编号表及冲突证据。当前生成目录有 472 个卫星
身份（不含地球月球），其中 471 个具有核对过的 SPK 编号；S/2009 S1 未匹配。
新增身份没有伪造的轨道或物理量，预设分组不会静默丢弃超出聚焦上限的对象。
Type 17 已加入原始记录读取与裁剪，并通过独立 CSPICE 样本校验；这仍不等于这些
身份全部具有已交付的轨迹，也不等于完整物理或实际观测误差已经评估。
