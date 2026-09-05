# All-body source inventory

The long-term coverage target is all identifiable known Solar System bodies,
not only the curated focus registry. This opt-in developer pipeline accounts
for individual records in authoritative source snapshots before adding runtime
support. **Inventory membership is not selectability, renderability, unique-body
reconciliation, or high-precision ephemeris coverage.**

## Generate and verify

Use Node.js 22.18+ (or a newer supported Node version with TypeScript stripping).
Run from the repository root. Create the parent cache directory if it does not
exist; the two leaf directories below must not already exist.

```bash
node --experimental-strip-types scripts/build-body-inventory.mjs --download --sources .cache/body-sources-1 --output .cache/body-inventory-1
node scripts/validate-body-inventory.mjs .cache/body-inventory-1 .cache/body-sources-1
```

For an offline replay, omit `--download`, reuse the exact source snapshot and
choose a new output directory:

```bash
node --experimental-strip-types scripts/build-body-inventory.mjs --sources .cache/body-sources-1 --output .cache/body-inventory-2
```

The default audit epoch is 2026-09-04 00:00:00 **TDB**, or 841752000 seconds
past J2000. `--audit-et` accepts a finite TDB second value; it is not a civil UTC
timestamp. Kernel availability is evaluated at that epoch only, with full
position/velocity center-chain resolution. Segment intervals are also retained;
this does not certify accuracy throughout a time window.

Ordinary builds, tests and native project checks do not run the download
command. No new runtime service or dependency is required. Raw snapshots and
generated inventory shards are not committed to Git or shipped in Pages,
Android or iOS by this command. Store source snapshots outside disposable build
directories when retaining them for long-term audit; do not treat unique source
downloads as regenerable cache during cleanup.

## Sources and completeness

| Source | Records and boundary |
| --- | --- |
| [JPL element tables](https://ssd.jpl.nasa.gov/sb/elem_tables.html) | Every numbered/unnumbered asteroid and comet table row, including fragments and non-elliptic elements; counts checked against the captured `elem_files.json` |
| [Planetary satellite discovery table](https://ssd.jpl.nasa.gov/sats/discovery.html) | All listed planetary/Pluto satellites; overall and per-system counts checked; discovery metadata is not an orbit |
| [Small-body satellite API](https://ssd-api.jpl.nasa.gov/doc/sb_sat.html) | All returned confirmed and candidate records; optional raw orbit and physical evidence retained without inventing absent fields |
| Bundled NAIF/JPL body centers | Sun, eight planets, Earth’s Moon and Pluto; Pluto uses the small-body identity when it is already in the element table |

The bulk asteroid/comet tables are rounded element products, not full-precision
SPKs. Their epochs are MJD TDB, converted to JD by adding 2400000.5. Comets use
perihelion distance and a calendar-formatted perihelion time instead of asteroid
semimajor axis and mean anomaly. No propagation is performed by this pipeline.

The manifest pins the five generator source files and the effective identity
mapping as well as the kernel manifest. Each source file has its own retrieval time, size, SHA-256 and available HTTP
validators. Static metadata and validators are rechecked after serial downloads.
JPL [API fair use](https://ssd-api.jpl.nasa.gov/doc/index.php) requires one request
at a time. A failed request stops the command without a success marker; retry
later using a new directory. The API response and daily element files are
different snapshots: this process cannot claim an atomic cross-service database
transaction or equality with a later live SBDB count.

## Record identity and gaps

Asteroids/comets use source designations in separate namespaces. Planetary
satellites retain parent plus IAU/provisional identity. For small-body moons,
IAU component number takes priority over a complete provisional designation.
If neither exists, retain a snapshot-row identity and mark
`unresolved-component`. Several real multi-satellite systems have indistinguishable
discovery metadata for different members. Do not merge those rows, fabricate a
component number, or count them as verified unique bodies. Resolved identity
collisions fail generation and need explicit reconciliation.

Cross-source asteroid/comet aliases, unnamed components, and some parent
designations still need reconciliation. The manifest lists missing parents and
separates confirmation, identity, geometry, and kernel-status counts. A null
phase, epoch, frame or orbital parameter remains unknown; a raw satellite
`orbit` object alone is not proof that it can be propagated.

Existing explicit application/NAIF mappings are linked to integrity-checked
bundled kernels. Successful center-chain evaluation is labeled
`state-available-at-audit-epoch`, not universal physics. Unmapped records are
not assigned guessed SPK IDs. No new SPK data is downloaded by this inventory
command and no runtime N-body, extrapolation or extra GR/J2 correction is added.

## Artifacts and reproducibility

`snapshot.json` is the source completion marker. Inventory records are written
as deterministic gzip JSONL blocks, concatenated into addressable
`records-00000.jsonl.bgz` shards of at most 5000 records (internal maximum
10000). Each block contains at most 128 rows and is independently addressable;
manifest v2 records its `rowStart`, `count`, `offset`, compressed `bytes`,
`uncompressedBytes` and SHA-256. Each shard also records its complete-file byte
count and SHA-256. The output `manifest.json` is written only after parsing and
source-count reconciliation. v2 is intentionally incompatible with the old
single-stream v1 artifact format.

The verifier decompresses and hashes every block with a bounded output size,
requires contiguous row and byte coverage, then recomputes counts and record
identity uniqueness, validates finite claimed kernel states and reconciles the
missing-parent ledger. Passing it demonstrates source record accounting, not
all-body scientific accuracy. With identical source bytes, application/kernel
inputs and audit epoch, offline replay produces identical blocks, shards and
manifest; no current timestamp is injected into replayed inventory artifacts.

Remaining work includes complete runtime catalog discovery, expanded
non-elliptic trajectories, additional satellite kernels, alias reconciliation
and full-source delivery. Pages may use a declared subset without reducing the
complete web/native coverage goal. Unknown or undiscovered objects and missing
public observations cannot be filled by invented data.

## Dated full-source validation

### Explicit identity and dependency-window ledger

`scripts/audit-body-coverage.mjs` now produces a separate developer audit from
the validated addressable inventory. It defaults to the **full** SPK profile;
the inventory generator's older Pages audit is not reused as full-profile
evidence. Supply a requested TDB window explicitly:

```bash
node --experimental-strip-types scripts/audit-body-coverage.mjs --inventory .cache/body-inventory-1 --sources .cache/body-sources-1 --output .cache/body-coverage-1 --profile full --start-et 631108800 --end-et 978264000
```

The example requests 2020-01-01 through 2031-01-01 TDB. The independent audit
epoch defaults to 841752000 TDB seconds past J2000 (`--audit-et` overrides it).
Output must be a new directory; `report.json` is published last. Source bytes
are revalidated when `--sources` is supplied; otherwise the report explicitly
sets `sourceBytesVerified=false` and pins the inventory's source-snapshot
metadata without claiming to have re-read the original downloads.

The audit verifies every compressed inventory block in one streaming pass,
reattaches only current explicit identities and retains source ordinals for
each mapped NAIF group. Previous input state/mapping claims are discarded.
Unmapped, unresolved-component and unconfirmed rows remain individually
addressable in the pinned input; their counts are not promoted to physical-body
counts. The report pins the input manifest, snapshot metadata, generator code,
kernel profile and identity mapping, and retains each evaluated six-vector.

Window evaluation preserves reverse kernel/segment priority and each root's
fixed solution pool. It follows all possible center dependencies and partitions
the window into closed boundary points and open intervals. Unsupported winning
segments, missing centers and internal or endpoint gaps remain visible. No
midpoint sampling, extrapolation or min/max envelope can hide a gap. Kernel,
segment and boundary limits fail closed instead of emitting a partial success.

The 2026-09-05 full-source run accounted for all **1,567,193** input rows:
**507** mapped source rows represent **502** explicit NAIF target groups with
states at the audit epoch; **1,566,686** rows remain unresolved for this mapping.
Of those 502 mapped targets, **486**
had descriptor/center dependency availability throughout the requested window;
**16** had explicit gaps. These counts cover the inventory's
mapped groups, not every bundled kernel target or every known physical body.
Two full-source offline replays against the reconciled inventory manifest
`bef21e3bc5820db0b70c24ad464262cb67df279f8d0a3e2b8731ca5ca9c39583`
produced byte-identical 2,454,580-byte reports with SHA-256
`3727d40c161bf2c4aab17a36e7c4ac54b7e1bfac7a8803fc5500c79ee0ab6ba8`.
This is deterministic replay evidence for the pinned code/data, not an
independent astronomical accuracy oracle.

The reconciliation adds Weywot, Vanth, Actaea, Hiʻiaka, Namaka and Dysnomia
through confirmed JPL small-body satellite names and numbered primary IDs
matched to the pinned, explicit SPK aliases. Each join retains the source
record, IAU name/number, primary, target and satellite-catalog hash. Five Pluto
satellite source rows join the existing planetary-source targets; they add no
unique targets. Unnamed components, candidates, conflicting primary IDs and
uncorroborated names are not guessed from display names or SPK-ID arithmetic.

The reconciled addressable inventory was also rebuilt twice from the retained
source snapshot. Both complete source/block validations passed: 314 shards,
12,538 independently compressed blocks, 97,111,820 compressed bytes and equal
manifest SHA-256 `bef21e3bc5820db0b70c24ad464262cb67df279f8d0a3e2b8731ca5ca9c39583`.
Its 507 available states are source rows at one epoch, not 507 unique bodies.

**Dependency coverage is not continuous numerical-accuracy certification.**
`numericallyCertifiedWholeWindowTargets` is `null`, not zero or 486. Whole-window
coefficient/oracle validation, further identity reconciliation, new authoritative
solutions and integration of this ledger into user-facing clients remain work.
No raw source or audit output is automatically included in Pages or native apps.

Before this named-moon reconciliation, on 2026-09-05 the addressable v2
generator replayed the retained 2026-09-04
source snapshot against the current audited Pages kernel profile. Both outputs
passed the complete block/shard validator against the source snapshot:

| v2 artifact field | Verified value |
| --- | --- |
| Source records | 1,567,193 |
| Shards / independently compressed blocks | 314 / 12,538 |
| Compressed shard bytes | 97,110,144 |
| Manifest SHA-256 (both replays) | `2c0aca1e6412c6e7785acd901bb987ce0f57c5353e2a8ff87aed032b291377b7` |
| Kernel manifest SHA-256 | `5c390d7bb8e02a28ebe45d32979c2f5db12983f8ec6044e4206750c5c89c29e0` |
| Identity mapping SHA-256 | `6d36c44543bc7f28e2f1696ec8c7e18c7a5ddedc58b51aec25826ad08395188e` |
| TDB audit seconds past J2000 | 841752000 |
| States available at that audit epoch | 496 |
| Records not mapped to a bundled kernel | 1,566,697 |
| Missing parents | 0 |

Equal manifest hashes include equal ordered shard and block digests; both
complete outputs were independently rehashed and decompressed. The 496 states
are source-record coverage at one epoch, not an all-epoch unique-body count.
The separate full backend SPK profile has a different manifest and remains
distinct from this inventory's Pages-based audit evidence.

The following numbers are historical evidence for the pre-v2 single-stream
artifact and are retained to document the source snapshot; they are not v2
shard byte/hash claims. Regenerate the inventory to obtain the v2 block and
complete-file digests.

On 2026-09-04, the table metadata dated 2026-09-03 and the separately fetched
satellite responses produced 1,567,193 source records in 314 gzip shards
(89,588,299 compressed bytes). All shard hashes and row counts passed validation;
offline replay produced byte-identical shards and manifest. The manifest SHA-256
was `e859e463c12323eff3f8318cea3b2640382c32010f7e7137cb924cc06294a8b9`.

The backend PR94 workload used a separate point-in-time output,
`inventory-pr94-20260904`: it also has 1,567,193 records in 314 shards but
declares 89,626,020 compressed bytes and manifest SHA-256
`99312497b037caae4097b3e663283d1e8fc63799bd5e546e52a2ae3489e1e9c1`.
Its kernel manifest and effective identity mapping are different. These
snapshots are both valid, but their counts, hashes and byte totals must not be
merged into one evidence claim.

| Source | Accounted records |
| --- | ---: |
| Numbered asteroid table | 895910 |
| Unnumbered asteroid table | 666207 |
| Comet table, including fragments | 4075 |
| Sun, eight planets and Earth's Moon | 10 |
| Planetary/Pluto satellite discovery table | 460 |
| Small-body satellite API | 531 |

The five dwarf planets are categorized within the asteroid source records, not
added again. The satellite API contributes 495 confirmed and 36 candidate
records; 467 rows lack a complete component designation. The resulting ledger
contains 2288 open-conic element records, 903 records without elements and 88
with unvalidated raw satellite elements. Only 63 records resolve bundled SPK
states at the audit epoch. None of these counts is an all-sources deduplicated
or runtime high-precision completion claim.

A separate audit derived numeric field boundaries from the raw source header
separators and compared all 10,963,344 stored orbital fields across the three
element tables without importing the parser. All comparisons passed. This
guards field truncation and row alignment; it does not independently validate
the upstream orbital solutions themselves.
