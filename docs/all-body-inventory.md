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

Ordinary builds, tests and native synchronization do not run the download
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

Each source file has its own retrieval time, size, SHA-256 and available HTTP
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
as gzip JSONL shards of at most 5000 records (internal maximum 10000); the output
`manifest.json` is written only after parsing and source-count reconciliation.
On failure, keep the incomplete directory for diagnosis or remove that exact
generated directory after inspection; do not mistake it for a successful pack.

The verifier decompresses every shard with a bounded output size, recomputes
hashes, counts and record identity uniqueness, validates finite claimed kernel
states and reconciles the missing-parent ledger. Passing it demonstrates source
record accounting, not all-body scientific accuracy. With identical source
bytes, application/kernel inputs and audit epoch, offline replay produces
identical shards and manifest; no current timestamp is injected into replayed
inventory artifacts.

Remaining work includes runtime catalog integration, general SPK type 21,
non-elliptic trajectories, additional satellite kernels, alias reconciliation
and full-source delivery. Pages may use a declared subset without reducing the
complete web/native coverage goal. Unknown or undiscovered objects and missing
public observations cannot be filled by invented data.
