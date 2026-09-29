# Gaia DR3 cone data

Run a bounded, explicit query against the ESA TAP service:

```powershell
rtk proxy node scripts/fetch-gaia-cone.mjs --ra 56.75 --dec 24.1167 --radius 0.1 --max-mag 15 --max-rows 1024 --output .cache/gaia-cone-new
```

The output directory must be new. Angles are degrees; the magnitude limit is
Gaia G. Gaia TAP jobs use asynchronous UWS requests with an 85-minute local job
deadline, bounded per-request timeouts and a 64 MiB streamed CSV ceiling. Cone
radius is at most two degrees and the configured row budget at most 100,000.
Spatial chunks remain capped at 30,000 rows each. By default the
script issues one `TOP maxRows+1` row query: seeing the extra sentinel row rejects
an over-budget cone; fewer rows means the bounded CSV includes every match. Add
`--verify-count` for an independent COUNT(*) query when auditing a cone is worth
an additional full archive scan. Rows are sorted locally by decimal `source_id`
after decoding, avoiding a server-side result sort while preserving deterministic
chunk contents. The TAP CSV reader grows one buffer under the 64 MiB byte cap,
avoiding retention of all network fragments plus a second concatenated copy.
After CSV retrieval the CLI requests job deletion. If ESA does not confirm
cleanup, downloaded bytes still proceed through validation and persistence;
the source manifest marks `cleanupPending: true` and the exclusive sidecar job
receipt remains available for reconciliation. The CLI creates a receipt
(`<output>.tap-job.json`, with
`<output>.tap-job-count.json` for an optional count scan) as soon as ESA returns
the UWS job URL. The receipt binds that URL to the exact ADQL, settings, schema
and row limit. On timeout or SIGINT, the script retains the receipt and does not
try to delete the remote job; the service may still expire or remove it. Reusing
the same output target refuses another submission, while `--resume-job` polls
the recorded URL without a new query POST. Repeat the original settings and
schema, and select a fresh output directory:

```powershell
rtk proxy node scripts/fetch-gaia-cone.mjs --ra 56.75 --dec 24.1167 --radius 0.1 --max-mag 15 --max-rows 1024 --resume-job .cache/gaia-cone-new.tap-job.json --output .cache/gaia-cone-recovered
```

The receipt is retained after success as acquisition provenance, and its hash
is bound into the manifest source record. A completed manifest still requires
the original CSV and hashed chunks; an interrupted output without a manifest is
not a completed artifact. No data is published or deployed.

The manifest retains the ADQL query or queries that ran, URLs, retrieval times,
byte lengths, SHA-256 values, original CSV files and implementation identities.
Its `rowCountEvidence` records the `maxRows+1` sentinel limit and returned count;
`queryCountMatched` is present only when `--verify-count` produced an independent
matching count. `source_id` stays a decimal string to preserve its 64-bit
identity. The selected columns
include positions, proper motions, parallax, their errors and correlations,
solution type, RUWE, G magnitude, BP-RP and radial velocity where supplied.
Nulls and negative parallaxes remain unchanged; no distance inference or
quality cut is silently applied.

The coordinates are barycentric ICRS at J2016.0, expressed as a Julian year in
TCB. Gaia's `pmra` and `ra_error` include the cosine of declination. See the
[DR3 source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)
and [ESA programmatic access](https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access).
This importer does not propagate stars, construct a complete six-parameter
covariance model, correct parallax zero points, or certify occultation timing.

Chunks use 5-degree RA/declination bins computed from the returned coordinates.
These are storage partitions of the selected cone, not full-sky tiles, equal-area
HEALPix cells or bounds valid at other epochs. They intentionally do not infer
current positions from source-ID bit fields. Magnitude-limited counts are not a
catalog completeness guarantee. See the [Gaia DR3 release](https://www.cosmos.esa.int/web/gaia/dr3).

The chart now provides eleven real Gaia data regions. The original schema-v1 Pleiades-
area example contains 19 rows; the extended schema-v2 example contains 94 rows
in one chunk, selected to G <= 18, with an independent matching count. A third
one-degree region around ICRS RA 55°, Dec 25° contains 4,460 rows to G <= 17 in
four chunks, also with a matching ESA count. Its original CSV, count receipt,
manifest and four hashed chunks are retained at
[`public/data/gaia/pleiades-ra55-dec25-r1-g17-20260923`](../public/data/gaia/pleiades-ra55-dec25-r1-g17-20260923/manifest.json).
The fourth capture uses the same center, a 1.5-degree cone and G <= 18. Its
manifest records 16,966 rows matching an independent Gaia TAP count; the
TOP 100,001 overflow sentinel is absent, and all four spatial chunks sum to
that row count. The count CSV, row CSV and four chunks are retained with
SHA-256 receipts at
[`public/data/gaia/pleiades-ra55-dec25-r1p5-g18-20260927`](../public/data/gaia/pleiades-ra55-dec25-r1p5-g18-20260927/manifest.json).
The manifest SHA-256 is
`1e8e1959bbfbf70b43f1deb0523effb31b615950c86eaea98135ac8fa21e89ea`.
The fifth packaged capture is a disjoint one-degree cone centered at ICRS RA
130.1°, Dec 19.67° (Praesepe/M44), selected to G <= 18. Its 5,555 returned
rows are below the 100,000-row ceiling; the bounded `TOP 100,001` query therefore
includes the full selected result, without an independent COUNT(*) scan. Its
1,830,790-byte source CSV and four hash-verified spatial chunks are retained at
[`public/data/gaia/praesepe-ra130p1-dec19p67-r1-g18-20260927`](../public/data/gaia/praesepe-ra130p1-dec19p67-r1-g18-20260927/manifest.json).
Its manifest SHA-256 is
`94658fe6ac2cf53b1f2b741d47f0b16bd37d3604e7582d0b5c822b6026668667`.
The source manifests contain 26,981 rows across the two Pleiades cones and
Praesepe; source_id reconciliation found 22,521 unique stars and 4,460 repeated
rows from the nested Pleiades cones. The combined preset loads all three
manifests and deduplicates by source_id. This remains three magnitude-limited
regions at the Gaia catalog epoch, not a completeness claim or current-sky
simulation.
The sixth capture is a one-degree cone centered at ICRS RA 83.8221°, Dec -5.3911°
(Orion), selected to G <= 18. Its 6,890 rows fall below the 100,000-row ceiling;
the `TOP 100,001` sentinel was absent, and the two SHA-256-verified spatial
chunks reconcile to the manifest. The 2,251,401-byte source CSV hash and the
recovered TAP receipt hash also match the manifest. Both are retained at
[`public/data/gaia/orion-ra83p822-dec-5p391-r1-g18-recovered-20260927`](../public/data/gaia/orion-ra83p822-dec-5p391-r1-g18-recovered-20260927/manifest.json).
ESA returned HTTP 500 when deleting the completed TAP job, so the acquisition
receipt records `cleanupPending`; validated local rows and hashes remain intact.
The seventh capture is a 0.35° ICRS cone centered at RA 266.4°, Dec -29° near
the Galactic center, selected to G <= 18. Its 9,686 rows are below the
100,000-row sentinel, and its one SHA-256-verified storage chunk reconciles
exactly to the source CSV. No independent COUNT(*) query was run. The source and
chunk are retained at
[`public/data/gaia/galactic-center-ra266p4-dec-29-r0p35-g18-20260928`](../public/data/gaia/galactic-center-ra266p4-dec-29-r0p35-g18-20260928/manifest.json).
ESA returned HTTP 500 when deleting this completed TAP job; the local row bytes
and hashes remain valid, and the manifest records `cleanupPending: true`.
An attempted 0.8° G <= 18 query near the inner bulge was aborted by ESA at its
7,200-second execution limit; a later lookup no longer found that UWS job. It
produced no manifest. Its receipt is retained at
[`public/data/gaia/galactic-bulge-ra264p8-dec-30p2-r0p8-g18-20260928.tap-job.json`](../public/data/gaia/galactic-bulge-ra264p8-dec-30p2-r0p8-g18-20260928.tap-job.json);
that abandoned query is not included in any row totals.
An attempted 2° G <= 18 expansion around the Pleiades reached `WRITING_RESULT`
but ESA aborted the same UWS job at its two-hour execution limit, including
after resuming it from the retained receipt. It produced no source CSV or
manifest and is not included in any row totals. Its receipt is retained at
[`public/data/gaia/gaia-pleiades-ra55-dec25-r2-g18-20260928.tap-job.json`](../public/data/gaia/gaia-pleiades-ra55-dec25-r2-g18-20260928.tap-job.json).
One narrower 1.75° G <= 18 query around the same center was submitted as a
separate UWS job after that archive timeout. ESA also aborted it at the
7,200-second execution limit. The advertised result link did not yield a
complete CSV, so no rows were accepted; its receipt is retained at
[`public/data/gaia/gaia-pleiades-ra55-dec25-r1p75-g18-20260928.tap-job.json`](../public/data/gaia/gaia-pleiades-ra55-dec25-r1p75-g18-20260928.tap-job.json).
It is not included in any row totals.
The inner-bulge capture is a 0.15° ICRS cone centered at RA 264.8°, Dec -30.2°,
selected to G <= 17. Its 654 rows are below the 20,000-row budget; the
`TOP 20,001` overflow sentinel is absent, and the single SHA-256-verified chunk
reconciles to the 219,038-byte source CSV. No independent COUNT(*) query was
run. The data and job receipt are retained at
[`public/data/gaia/gaia-inner-bulge-r0p15-g17-20260928`](../public/data/gaia/gaia-inner-bulge-r0p15-g17-20260928/manifest.json).
Its manifest SHA-256 is
`925b2fce699f11a583a0af365de49a6b4fa7d7ab2f03abf4d32a2ff8683f64fe`.
The first eastern Galactic-center capture is a 0.25° ICRS cone centered at RA
267.15°, Dec -29°, selected to G <= 18. Its 10,244 rows are below the
`TOP 20,001` sentinel; no independent COUNT(*) query was run. Its schema-v2
CSV, TAP receipt, manifest and hash-verified 9,755,996-byte chunk are retained
at
[`public/data/gaia/galactic-center-ra267p15-dec-29-r0p25-g18-20260928`](../public/data/gaia/galactic-center-ra267p15-dec-29-r0p25-g18-20260928/manifest.json).
The CSV SHA-256 is `f8b6df3f7b3138782546c424099e0ba140f757d055e99599b274a54395a1e02e`,
the chunk SHA-256 is `7864ed73118b3bf0593c6a681d170c650e28563c8db4e6ce83cc246201024961`,
and the manifest SHA-256 is
`9a9cf5e7ecba0a9c480f609659d3f803e004a27fa33c9ab489b4ea5e3a46dd73`.
The next eastern capture is a 0.20° ICRS cone centered at RA 267.7°, Dec -29°,
also selected to G <= 18. Its 12,008 rows are below the same sentinel; no
independent COUNT(*) query was run. Its schema-v2 CSV, TAP receipt, manifest
and hash-verified 11,556,826-byte chunk are retained at
[`public/data/gaia/galactic-center-ra267p7-dec-29-r0p2-g18-20260928`](../public/data/gaia/galactic-center-ra267p7-dec-29-r0p2-g18-20260928/manifest.json).
The CSV SHA-256 is `5cc49eb4ae3618726214f2412ce3cc8dcd552b71950f72dcf1b6bdf32ba0d462`,
the chunk SHA-256 is `32094740a9101d6d0ddc56d01fdca48ba331532512b9bd11e58c49349afb26f8`,
and the manifest SHA-256 is
`37857fd5650cede6540a150fb5860c057c1cd86947895022e1822ced9f1e85d1`.
Both eastern cones are geometrically disjoint from the prior six region
manifests; their closest center separation is 0.48104° against 0.45° summed
radii. Their source-row counts therefore add without overlap. The UI
exposes each cone and a four-region Galactic-center collection.
A separate 0.25° attempt centered at RA 267.75° exceeded the 20,000-row budget.
The `TOP 20,001` sentinel caused ingestion to fail closed; its receipt is
retained at
[`public/data/gaia/galactic-center-ra267p75-dec-29-r0p25-g18-20260928.tap-job.json`](../public/data/gaia/galactic-center-ra267p75-dec-29-r0p25-g18-20260928.tap-job.json),
with no manifest or chart data generated from that result.
Across the first four packaged region manifests, 33,871 input rows reconcile to
29,411 unique source IDs after the 4,460-row nested Pleiades overlap. Their
25,263,040 encoded chunk bytes and conservative 47.802° shared tangent-plane
radius fit the current 200,000-row, 128-MiB and 80° admission limits. The four-
region collection remains loadable; it is source coverage, not a render-capacity
or all-sky completeness result.

Across the original five packaged region manifests, there are 43,557 source rows
and 39,097 unique source IDs; their encoded chunk files total 32,509,689 bytes.
They cannot all be projected in one chart under the current 80° field ceiling:
the conservative shared tangent-plane radius is 163.771°. The inner-bulge
capture adds 654 new IDs, bringing the six region manifests at that checkpoint
to 44,211 source rows and 39,751 unique IDs with 33,001,529 encoded chunk bytes.
The two disjoint eastern captures add 22,252 rows, bringing the eight current
manifests to 66,463 source rows and 62,003 unique IDs with 54,314,351 encoded
chunk bytes. The four-region Galactic-center collection contains 32,592 unique
stars and 29,051,311 encoded chunk bytes, below the current 128-MiB admission
cap; this is input-budget evidence, not measured render performance. At this
eight-manifest checkpoint, a local row-value reconciliation matched all
2,016,728 CSV field values to their decoded chunk records and confirmed
per-region `source_id` parity; the only repeated IDs then were the 4,460 nested
Pleiades rows. The Pleiades/Praesepe/Orion chart collection includes the
validated 1.5° Pleiades capture: its nested 4,460-row 1°/G <= 17 selection
appears once after `source_id` deduplication, leaving 29,411 unique sources.
Magnitude-limited sources are not an all-sky completeness or render-capacity
claim.
A ninth schema-v2 region adds a 0.20° G <= 18 comparison cone centered at ICRS
RA 86.4°, Dec +29°: the exact antipode of the packaged Galactic-center query
center at RA 266.4°, Dec -29°. This geometric pairing is a convenient opposite-
field comparison, not evidence that the stellar populations or extinction are
equivalent. ESA returned 1,155 rows below the `TOP 20,001` sentinel; no separate
COUNT(*) scan was run. Its CSV, immutable TAP receipt, manifest and verified
1,093,632-byte chunk are retained at
[`public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p2-g18-20260928`](../public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p2-g18-20260928/manifest.json).
The CSV SHA-256 is
`3c6b0843c59ed256aa204b0a310efe44429336961fb91d9122261fc237a74776`, the chunk
SHA-256 is `b08606909b133d66071fbd3d11bd8fd8725144e6a6df301d88bc2f114ebf6280`,
the TAP job receipt SHA-256 is
`17cb29c58c353f3cb3c3c766c2f74f9afb8fbbf60e3c88f6f6b2e1550f200632`, and the
manifest SHA-256 is
`7e4002d97f994a7bba8201bf7eca4ba219809d628687f70fbd9c91b17f422543`. Spherical
cone checks found it disjoint from every prior region. A tenth schema-v2 capture
expands this exact opposite-field cone to 0.40°, still centered at ICRS RA 86.4°,
Dec +29° and selected to G <= 18. ESA returned 4,964 rows below the `TOP 20,001`
sentinel; no independent COUNT(*) scan was run. Its 1,674,982-byte CSV and one
4,695,719-byte chunk are retained at
[`public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p4-g18-20260928`](../public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p4-g18-20260928/manifest.json).
The CSV SHA-256 is
`351a1eb59a5379889fba1717909536c6f621a818c9eb5929b31133a2e432c577`, the chunk
SHA-256 is `9b4128a789f16623ad85696dc69b48d2918e479971f591987413ea107b8e50cb`,
the TAP receipt SHA-256 is
`93a20da0fe434aff7d0285c296c6b208ba1d48f92da0a7407aecb8a7f28b1dfb`, and the
manifest SHA-256 is
`1eea04862556de3bcc8adfadb643a8f72a59062720e2954a40bf1c30615ef644`. The prior
0.20° set is fully contained in this cone and contributes 1,155 repeated IDs;
the wider capture adds 3,809 source IDs. An eleventh schema-v2 capture extends
the same field to 0.60°, selected to G <= 18. ESA returned 11,157 rows below the
`TOP 20,001` sentinel; no independent COUNT(*) scan was run. Its 3,773,146-byte
CSV and one 10,560,932-byte chunk are retained at
[`public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p6-g18-20260928`](../public/data/gaia/galactic-anticenter-ra86p4-dec29-r0p6-g18-20260928/manifest.json).
The CSV SHA-256 is
`9677006429a8e2100cb20cebff2f2bd06b4024603f1f8c29de150c7fb94e64f9`, the chunk
SHA-256 is `43d2b0c0c6f01ed31132dc42feb3095c3310eb9b148d64542bfd242ae0e456ed`,
the TAP receipt SHA-256 is
`1ed38ee890c413d21f57545d911450e9c8fe249ff5a869e9279cd77e3bafae77`, and the
manifest SHA-256 is
`0eed47719750e9dfda3b4a464e2babccd70d034a7b7f51f4d823e4cb0dbeb041`. The
0.40° set is fully contained, and the 0.60° capture adds 6,193 source IDs beyond
it. A separate 1° attempt exceeded ESA's
7,200-second execution limit and produced no rows; its acquisition receipt is
retained at
[`public/data/gaia/galactic-anticenter-ra86p4-dec29-r1-g18-20260928.tap-job.json`](../public/data/gaia/galactic-anticenter-ra86p4-dec29-r1-g18-20260928.tap-job.json)
(SHA-256 `dd13267a9e6efdcd20fe23187d79d7f7a8b9f7579cb6dbc61e46a47d1f870a3b`).
Across the eleven manifests, a full source reconciliation found 83,739 input
rows and 73,160 unique source IDs, with 70,664,634 encoded chunk bytes. The only
overlaps are 4,460 nested Pleiades rows and 6,119 repeated rows across the three
nested opposite-field cones. Across the four overlapping region pairs,
379,470 shared-row field values also match exactly, so first-manifest
deduplication preserves the same scientific values for these repeated IDs. All
2,621,388 CSV field values match their decoded chunk records; all
manifest-listed source files and chunks match recorded byte
lengths and SHA-256 values. Every row also passes the manifest's ICRS coordinate,
reference-epoch, magnitude, and spherical-cone bounds. Independent `COUNT(*)`
receipts exist for the two Pleiades manifests (4,460 and 16,966 rows); the other
nine manifests use their recorded `TOP+1` sentinel evidence, which does not
certify catalog completeness. This remains source-coverage and input-budget
evidence, not a completeness or rendering-capacity claim.
Schema v2 includes the published pseudocolour fields when present.
Proper-motion/observer transforms, stellar occultation integration and
sustained capacity measurements remain unfinished.

Production artifacts retain the original `rows.csv` because the Gaia motion
panel imports those source rows for stellar-motion and observer transforms;
the chart worker separately consumes hashed JSON chunks. The optional
`count.csv` remains as an independent source-count receipt. The capacity report
accounts for packaged Gaia sky files separately from the application shell,
asteroid dataset and ephemeris kernels.

## Browser/worker chunk consumer

`src/lib/gaiaChunks.ts` validates an imported manifest, conservatively selects
5-degree bins intersecting an explicit RA/declination rectangle, and streams
hash-verified chunks. The public stream returns Float64 ICRS unit directions by
default; the chart worker can omit this transient column and derive each unit
direction from the same validated source RA/Dec during display packing. Wrapping
RA, the 0/360 seam and polar directions are handled conservatively. Selection is
limited to J2016.0; requesting a later epoch is rejected until motion-aware bounds
exist.

The chart worker also drops the validated decimal `source_id` strings from its
parsed row objects after copying their exact values to the `BigInt64Array` source
column. The public stream retains the original strings by default. The page
reconstructs decimal IDs only for selected or exported rows.

Decode and pack validation compare each row's own enumerable keys against
precomputed schema sets and iterate those keys directly. This avoids per-row
`Object.keys`/`Object.entries` helper collections while preserving exact schema
and numeric-field checks. The allocation shape is source-inspected only; no
runtime heap or throughput change is claimed.

The collection loader admits up to eight chunk jobs, a 96 MiB in-flight
encoded-byte reservation, 90,000 in-flight rows and 128 MiB total selected bytes.
For multiple manifests, it forms ordered groups of up to eight regions, splitting
when the sum of each member's largest chunk would exceed either in-flight limit.
Each stream first reserves its own largest chunk, then receives an equal share of
remaining byte and row capacity. Read-slot counts are distributed by each
manifest's remaining chunk count and sum to at most eight. This lets small shards
from more regions overlap while three maximum-sized 32 MiB/30,000-row chunks
still fit within the unchanged aggregate budget. A single-region load retains
the full budgets. Decoding, duplicate resolution and callbacks remain serialized
in first-manifest order, so later manifests overlap source reads without
increasing concurrent JSON parses or changing first-source precedence. Waiting
for that decode turn pauses the per-chunk deadline; network/hash and active
decode/consume stages keep their 30-second deadline. The completed receipt
reports actual aggregate reservation peaks and the peak number of manifests with
source reads in progress. These are admission limits, not measurements of
JavaScript heap or GPU allocations. The loader does not own retained consumer
storage. A failed/cancelled stream never returns a completed summary; already
emitted chunks remain individually verified and must not be labeled a complete
catalog. Remote imports use the bounded session cache described below. This
cross-manifest overlap is source-inspected only; it does not claim measured
throughput or a larger displayable catalog.

The chart worker's upload acknowledgement window uses the same eight-slot
ceiling and independently sums manifest input rows across unacknowledged chunks,
capped at 90,000. Thus three 30,000-row chunks fill the window, while smaller
chunks can overlap more packing and GPU submission, up to eight slots. Duplicate
rows still count against this reservation. The row window bounds admitted input
work, not total heap or graphics memory, and does not certify a throughput gain.
The completed chart summary reports both configured upload-window limits and
observed peaks for pending chunk slots and their summed input rows. These
high-water marks describe that load only; they do not measure frames, heap,
total GPU memory or sustained capacity.
The opt-in real-capture browser report records aggregate chunk-job/byte/row
limits and peaks, concurrent source-read manifests and upload-window peaks per
sample so separate catalog sizes can be compared later.

Chunk decoding currently needs the complete admitted byte buffer, a complete
UTF-8-decoded JavaScript string for `JSON.parse`, and then the parsed row objects.
The string and object graph overlap during parsing; encoded-byte and row
reservations do not bound this transient heap expansion. The same chunk byte/row
ceilings still cap the input, but total worker heap has not been measured.
For HTTP streams, `readBounded` allocates the declared output length and copies
each yielded transport fragment into it. The fragment being copied can overlap
the output allocation, and an overlong fragment is rejected only after the
reader yields it. This transient transport storage is not separately counted by
the loader reservations; the current reader fragment and browser fetch buffering
are not a measured total-memory bound. The copy path avoids retaining every
fragment and then making another full-size concatenation buffer.

The chart worker checks all three coordinates after storing each row into its
Float32 display array. The page verifies the transferred array type and exact
row-derived length, then trusts this worker-owned payload instead of rescanning
every float on the UI thread. This removes up to three redundant finiteness
callbacks per displayed row from message handling; it is a source-derived pass
reduction, not a measured frame-rate or throughput result.

For each accepted chunk, the chart worker packs source columns and computes the
Float32 tangent-plane display coordinates during the same source-row traversal.
It reuses a single three-value Float64 scratch vector rather than materializing
the full ICRS-direction column; the same RA/Dec-to-unit-vector operations feed the
unchanged projection basis. Decoding and consumption are serialized, so at the
30,000-row chunk ceiling this removes up to 720,000 bytes of transient direction
storage at a time. The default public stream still returns that column.
Cooperative yields, bounded GPU acknowledgements and existing row/byte limits
remain in place. The chart permits up to eight unacknowledged display chunks,
with their manifest input rows summed under 90,000; three maximum-sized chunks
still fill the row window, while smaller chunks may use more slots. This is a
bounded overlap window, not parallel CPU computation or a larger catalog limit.
It is an output-side bound separate from the loader's byte/row reservations and
does not represent a total-memory limit.
These are source-derived allocation and pass counts; throughput and maximum
displayable catalog size have not been measured or changed.

The renderer keeps accepted points in an owned RGBA8 framebuffer texture. Each
new chunk uploads and draws only its new point range. The retained texture is
composited to the browser's default canvas on the next animation frame; chunk
updates arriving before that frame share one full-surface
composite. The chart does not rely on the default drawing buffer surviving
presentation. Zoom or canvas-size changes rebuild the texture from the retained
point buffer and present the rebuilt view immediately. This avoids resubmitting
earlier star primitives on every chunk and bounds routine composition to the
display frame rate. Before its upload acknowledgement, each chunk's point-buffer
upload and persistent-target draw are checked; a view rebuild also composites
and checks before acknowledging that chunk. The maximum 2048-square RGBA8 target
uses 16 MiB of texture storage by format; driver allocation, browser overhead and
total GPU memory are not measured. Point picking is indexed against the last
composited row prefix, so a newly uploaded but not-yet-presented star cannot be
selected before it is visible.

## Catalog-epoch sky chart

Open the Gaia sky chart in the evidence workspace. Load the bundled 19-source
example, select the manifest and chunk JSON files together, or provide a hosted
manifest URL whose server permits browser access. The chart worker verifies
sources and projects their ICRS coordinates onto a north-up, east-left tangent
plane at J2016.0. Bounded source reads may finish out of order, while decode and
source-ID verification follow manifest order. The aggregate admission limits
are 200,000 rows and 128 MiB of selected source bytes. Zoom reuses the existing
buffer. Clicking a star or
choosing a row shows its original values; JSON export includes all accepted rows and
source metadata. Source rows are serialized in bounded stream batches instead of
building one full-catalog JSON string; final Blob storage remains browser-managed.
Worker-to-page source transfer uses BigInt64 IDs, Float64 numeric columns and a
null bitset; the page reconstructs only the selected row and export batches.
Schema v2 at the 100,000-row per-manifest ceiling occupies about 27.1 MiB in
these packed source columns, before active decoding, worker duplicate-ID
validation state, display/GPU buffers, cache or Blob data. The collection can
now admit up to 200,000 rows across manifests: about 54.2 MiB of packed source
columns at that schema, plus 2.29 MiB of retained Float32 display batches and a
separate 2.29 MiB GPU point buffer. These are typed-array sizes, not total heap,
driver memory or a device-capacity guarantee.
Input changes, cancellation and errors clear the current chart.

This view requires WebGL 2. Point sizes encode the Gaia DR3
`phot_g_mean_mag` catalogue value as a bounded visual symbol (Vega magnitude);
they are not stellar radii or angular diameters. Gaia DR3 already includes the
EDR3 millimagnitude-level G-band correction for 2- and 6-parameter solutions,
so the chart applies no second photometric correction; see the official
[Gaia DR3 documentation](https://gea.esac.esa.int/archive/documentation/GDR3/).
It also does not apply
proper motion, observer parallax, aberration, deflection or parallax zero-point
corrections. Chunk hashes establish consistency with the imported manifest, not
independent ESA authentication.

This catalog-epoch view does not propagate stellar positions. The separate
Stellar Motion batch mode applies the bounded target-epoch propagation and
compute-to-render acknowledgement flow described in
[Bounded chunk propagation](#bounded-chunk-propagation). Its response receipts
and working memory differ from this packed-source chart, and neither workflow
has demonstrated 200,000-row device capacity.

Stream cancellation/deadlines do not wait for an outstanding consumer upload
acknowledgement. Late consumer failures remain observed. Consumer-owned effects
still need their own cancellation and cleanup; the sky chart terminates its
worker and clears retained display/source state.

The browser verifies all declared source columns, valid solution codes, the
cone/magnitude selection, query row budget and unique source IDs across selected
chunks in addition to hashes. Importer and browser use one column schema; future
import receipts record that schema hash. These checks establish internal
consistency, not independent authentication of an externally supplied manifest.

## Session source cache

Completed remote loads retain a worker with an LRU content-hash cache limited
to 64 MiB and 128 encoded chunks. This is additional to active decode/GPU
storage, not a bound on total process memory. Each new load fetches its manifest
again and revalidates cached bytes against the current schema and selection.
The verified chunk stream borrows cache-owned bytes for read-only hashing and
decoding, avoiding one `Uint8Array` copy per cache hit; the cache's public `get()`
still returns a defensive copy. Borrowed bytes are never mutated or transferred.
After a fresh chunk passes content and row validation, the stream adopts its
whole owned `ArrayBuffer` view into the cache rather than copying it again;
subviews fall back to an exact-sized copy so a larger backing buffer is not
retained past its byte budget. The structural copy saving is bounded by active
encoded-byte admission (96 MiB by default) on cache hits and one 32 MiB maximum
chunk during cache insertion. These are source-derived limits, not measured heap
reductions.
Exports report cacheHits and cacheRetainedBytes. Local files bypass the cache.
`totalBytes` is the selected descriptors' source-byte sum, including cache hits.
`cacheHitBytes` and `sourceReadBytes` partition that sum; `cacheHits` and
`sourceReadChunks` partition verified chunks. Source reads mean successfully
verified source bytes obtained through HTTP or the direct local-file reader.
They exclude the manifest and transport overhead and are not measured
network traffic. These counters do not measure decoded heap or GPU memory.

Local chunks are read only after reserving their descriptor budget. Their owned
FileReader buffer is viewed directly as bytes for the same size, hash and content
checks used by remote chunks, without wrapping it in a Response and copying it
through the HTTP body reader. The direct reader receives the batch abort signal.
This removes an application-level copy path; it is not a measured total-memory
bound or a claim about browser-internal file storage or digest allocations.

### Display retention bounds from source inspection

The Gaia chart admits at most 200,000 declared source rows per collection. Its retained
Float32 display batches contain three values per row (at most 2,400,000 bytes),
and GaiaPlot allocates a matching point buffer (2,400,000 bytes at that capacity;
an empty chart still allocates 12 bytes). These CPU batches remain available for
picking and effect replay. Source record objects are retained separately for
inspection/export and are not included in those coordinate-byte figures.
The picking grid reuses those batches to recompute screen positions for nearby
click candidates, avoiding a second 3,200,000-byte Float64 coordinate allocation
at 200,000 rows. This source-derived saving does not establish click latency.

Canvas backing dimensions are capped at 2,048 pixels per side and further limited
by the device's texture/renderbuffer/viewport limits. This does not measure
framebuffer, driver, compositor or total GPU memory. The persistent RGBA8 texture
is resized with the canvas and its framebuffer, texture and point buffer are
released on reset/unmount. Cleanup also disconnects the resize observer and
deletes the program and shaders. Component unmount terminates active and cached
idle workers. A completed idle worker intentionally retains the bounded
encoded-source cache described above; resetting the chart alone does not clear it.

These are allocation and lifecycle paths read from source, not runtime release
evidence or sustained frame-rate measurements. No device or browser execution was
performed for this audit.
Active cancellation or failure terminates that worker; page unmount releases
both active and idle workers. No disk persistence or full-catalog caching is
performed.

## Capacity evidence

The optional [`tests/e2e/gaia-capacity.spec.ts`](../tests/e2e/gaia-capacity.spec.ts)
measures three source loads and 120 zoom frames per load. Set
`SOLAR_GAIA_CAPACITY_DIR` to measure a local capture, or set
`SOLAR_GAIA_CAPACITY_COLLECTION=pleiades-praesepe-orion` to measure the bundled
four-region chart preset. The schema-version-4 report records each source
manifest hash, input and unique row counts, upload-window peaks, load time, frame
intervals, buffer size, reallocations, uploads, draws, browser version and host
details; it has no frame-rate acceptance threshold. The earlier 100,000-row
admission profile has a tracked desktop Chromium report for a real 4,460-row
capture at
[`desktop-chromium-4460-budget-expanded.json`](benchmarks/gaia-20260924/desktop-chromium-4460-budget-expanded.json);
the earlier 30,000-row-profile report remains at
[`desktop-chromium-4460.json`](benchmarks/gaia-20260924/desktop-chromium-4460.json).
Both use the source manifest at
[`source-manifest.json`](benchmarks/gaia-20260923/source-manifest.json); all
recorded renderer and capacity-profile hashes match their capture-time files.
The expanded-profile run's three local import times were 538, 69 and 65 ms;
120-step zoom frame intervals had 16.7 ms median, 16.7–16.8 ms P95 and 16.8 ms
maximum. The 53,520-byte GPU point buffer had no reallocations or extra uploads
and rendered 119 draw calls per sample. This is a local 4,460-row desktop
baseline, not a 30,000-, 100,000- or 200,000-row result. Neither the previous
100,000-row nor current 200,000-row admission ceiling is demonstrated device
capacity. The 30,000-row public TAP
query exceeded the local 85-minute job deadline before returning a result;
no large capture was written. Neither that baseline nor this harness establishes
full-sky, sustained real-time, public-network, total-memory or physical mobile
capacity. Both the 4,460-row and 16,966-row source captures and their provenance
files are retained in the application data tree. The larger source has not been
capacity-benchmarked. The original report still describes local-file imports
from its capture-time checkout, not this packaged-asset URL path.

The retained 4,460-row performance receipts were rechecked against the current
worktree on 2026-09-27. The baseline receipt matches 1 of 8 implementation
files and the expanded receipt matches 1 of 9; in both cases the sole match is
`src/data/gaiaColumns.json`. The expanded receipt records `GaiaPlot.tsx` as
`7c58321c5e6a6c4060acb38f4d75df6150e3c6613c6fc6928c2e2b14eae75f67`, while the
current renderer hashes to
`1d1ebfbe0fa63c6c67c38e0af72e487569a4501295a20adbca6f380c1525027b`; its
recorded capacity file also differs from current. These are historical,
source-bound measurements. The only real Gaia performance receipt remains
4,460 rows; the verified 16,966-row data pack has not been benchmarked. Existing
1,561,171-row MPC renderer runs
exercise a different data and rendering path and do not establish Gaia import
or chart capacity. The larger source capture is available for a current-source
capacity measurement, but it does not change the only real performance receipt.
The source-level aggregate chart ceiling is now 200,000 rows, retaining the
100,000-row per-manifest limit, 128 MiB selected-byte limit, 96 MiB/90,000-row
in-flight limits and 2,592-chunk ceiling. Treat this as an implemented bounded
capacity, not accepted device performance: the current renderer still needs
measurements on intended device tiers before any smoothness or throughput claim.
This was a source/hash audit, not a new benchmark or test.

## Multi-region Gaia chart

The chart accepts one to eight remote manifest URLs and reads all listed local
chunks from one local manifest. It validates every manifest first and rejects
mixed source-column schemas. Before requesting chunks, it sums declared input
rows, encoded chunk bytes and chunk descriptors against the current limits:
200,000 rows across the collection (100,000 per manifest), 128 MiB of selected
chunk bytes and 2,592 chunks. Input rows that
overlap still count toward admission, so this gate is conservative. Manifest
JSON has a separate 8 MiB collection ceiling.

Remote regions are grouped in manifest order under the existing aggregate
eight-read, 96 MiB in-flight byte and 90,000 in-flight row limits. Source reads
and hash checks may overlap across regions; JSON decoding, duplicate resolution
and chunk callbacks wait for each earlier manifest to finish. Per-region upload
acknowledgements still apply. This adds a multi-region chart with a 200,000-row
collection ceiling while retaining the per-manifest and in-flight budgets. It
does not raise the aggregate number of active chunk jobs or the byte/row limits,
and no throughput or device capacity is inferred from the configuration.
Per-region streams reject duplicate IDs across their chunks; a second
collection-wide `BigInt` ID set is allocated only when multiple regions need
cross-region deduplication. Single-region loads therefore avoid a redundant
O(row-count) duplicate index of up to 100,000 IDs under the current per-manifest
admission cap.

The chart chooses a common ICRS gnomonic display center from the normalized sum
of region-center unit vectors. Its conservative spherical radius is the largest
center separation plus that region's requested cone radius; unstable centers or
fields wider than 80 degrees are refused. The projection changes display
coordinates only. Source RA/Dec and other catalog columns retain their original
values and precision. Overlapping Gaia DR3 `source_id` values are counted once,
keeping the first occurrence in manifest order. Every manifest and chunk remains
in the export with its original JSON, SHA-256 and source location; summary counts
separate verified input rows from unique displayed rows and duplicates.

The two packaged Pleiades regions contain 4,460 and 16,966 rows. A source-ID
inspection found all 4,460 rows of the smaller cone in the larger set, so their
collection declares 21,426 input rows and 15,969,204 encoded chunk bytes while
displaying 16,966 unique sources. This is a data-overlap check, not a capacity
measurement. The larger capture has not been benchmarked on the current
renderer; the 200,000-row collection ceiling remains an admission limit rather
than a demonstrated device capacity.

中文说明：星图可同时读取 1–8 个远程清单，或读取一个本地清单及其分块。
系统会先校验全部清单，再按集合 200,000 行（每清单最多 100,000 行）、128 MiB
分块源数据和 2,592 个分块的现有限额准入；重叠行仍计入准入预算。远程天区按清单顺序
分组，在原有总计最多八个块读取任务、96 MiB 在途字节和 90,000 行预算内允许源读取及哈希
校验跨天区重叠；JSON 解码、去重和绘图回调仍按清单顺序串行。上传确认预算不变。
共同切平面使用 ICRS 天区中心单位向量的归一化和，并以保守球面半径覆盖所有天区；不稳定中心
或超过 80° 的视场会被拒绝。图表按清单顺序依据 Gaia DR3 `source_id` 去重，原始星表数值和各清单来源随导出保留。

## Catalog position uncertainty

The selected-star inspector reconstructs the 2D positional marginal covariance
using ra_error, dec_error and ra_dec_corr at J2016.0. Coordinates are
delta-alpha*cos(delta) and delta-dec in mas; the Gaia RA standard error already
includes cos(delta). Semiaxes are the square roots of covariance eigenvalues.
The orientation is measured from east toward north, modulo 180 degrees; a
circular contour has no preferred axis. The exported derived result is separate
from original source rows. Missing or invalid errors are not replaced by zeros.

The unit-Mahalanobis contour is not a 68 percent joint confidence region and
does not include systematics, epoch propagation or occultation timing error.
This positional marginal is not the full five/six-parameter astrometric model.
Gaia DR3's per-source correlations are approximate: they are estimated from
individual-source normal matrices while neglecting between-source correlations.
This export therefore contains no covariance between different stars, which
matters for multi-source statistics such as a cluster's mean parallax or
internal kinematics.
The [ESA DR3 processing notes on correlations](https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_quality/ssec_cu3ast_quality_corr.html)
state that archive within-source correlations are estimated from individual-source
normal matrices that neglect between-source correlations, so they approximate
the actual within-source correlations. Field and unit definitions follow the
[ESA DR3 source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).

## Five-parameter astrometric covariance

The selected-star readout/export now includes the J2016.0 TCB five-coordinate
formal marginal in alpha*cos(delta), delta, parallax, pmra, pmdec. Coordinate
units are mas, mas, mas, mas/Julian-year, mas/Julian-year; matrix entries use
products of the corresponding row/column units. ra_error and pmra already use
the tangent-plane cos(delta) convention; no extra factor is applied.

All ten supplied correlations are required. Positive finite formal errors and
a strict positive Cholesky factorization of the correlation matrix are required,
without jitter, clipping or covariance repair. This conservatively reports
singular/non-positive-definite inputs as unavailable; it does not claim such
inputs are all physically impossible. Original source rows remain untouched.

Solution code 31 provides a five-parameter solution; code 95 yields only its
five-coordinate marginal here. Schema 1 lacks pseudocolour fields. Schema 2 can additionally supply the
full six-parameter result described below; this five-coordinate result remains
a marginal and is not conditioned on pseudocolour. Code 3 has no five-parameter
result.

Across the currently packaged regions, 82,547 row instances have all ten
astrometric correlations and positive finite five-coordinate errors. Every
5x5 correlation matrix passes the application's strict Cholesky factorization
without repair. An independent symmetric Jacobi eigenvalue audit, stopping
below a 1e-13 off-diagonal residual, found a smallest eigenvalue of
0.0040191127 and no non-positive matrices. The remaining 1,192 row instances
contain only `ra_dec_corr`; their measured 2x2 blocks have a smallest
eigenvalue of 0.00000143. Missing terms remain missing, so no full-matrix
covariance conclusion is made for those rows. All supplied correlation values
are within [-1,1], and each present `*_error` value is finite and nonnegative.
This audits the packaged rows, not catalog-wide quality or model accuracy.

No epoch propagation, systematics, parallax zero-point correction,
radial-velocity covariance or occultation probability is inferred.

Definitions: [ESA DR3 gaia_source data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html).

## Extended source schema

Add --schema 2 to fetch-gaia-cone.mjs to retain pseudocolour, its standard error
and its five astrometric cross-correlations. The default remains schema 1;
existing original responses/chunk hashes remain unchanged. Browser imports
validate the exact column set selected by schemaVersion (1: 28, 2: 35 fields).
Schema 2 preserves nulls, including absent pseudocolour for five-parameter
solutions. Units for pseudocolour and its error are inverse micrometres.

A real schema-2 capture is retained at tests/fixtures/gaia-six-20260923: the
same Pleiades-area cone with G <= 18 returned 94 rows and a matching count,
including 15 six-parameter, 78 five-parameter and one position-only solution.
Original CSV bytes, query URLs/timestamps and all chunk hashes are retained.
The covariance inspector exports both the five-coordinate marginal and, for
complete valid code-95 records, the full six-parameter covariance. Observer/time
propagation remains pending.

## Full six-parameter covariance

For solution code 95 and complete schema-2 errors/correlations, the inspector
constructs and exports a separate 6-by-6 formal matrix with pseudocolour as the
last coordinate, in inverse micrometres. This is not radial velocity, a 6D
Cartesian phase-space covariance, or a result conditioned on a colour estimate.
The upper-left block is exactly the separately exported five-coordinate marginal.
All 15 correlations must jointly pass the same strict no-repair factorization.
Missing pseudocolour errors/correlations or a non-positive joint factorization
produce an explicit unavailable result; no zero correlations are invented.
The source rows and original five-coordinate result remain available.

Fifteen real six-parameter source records in the original 94-row fixture passed
full matrix construction; a controlled matrix whose five-coordinate block is
valid but whose sixth coordinate makes it indefinite is rejected. The current
packaged schema-2 regions contain 6,865 code-95 row instances, all of which pass
the same strict six-coordinate Cholesky factorization. An independent Jacobi
audit found a smallest six-dimensional correlation eigenvalue of 0.0039482678,
with no non-positive matrices. Four browser profiles verify local schema-2
import, source preservation, selected-star status and both exports. These
checks establish source reconstruction, not physical accuracy, epoch
propagation, pseudocolour correction or occultation uncertainty.

## Epoch propagation prerequisites

The captured 94-source schema-2 cone has 91 positive parallaxes and 16 supplied
radial velocities. Only 16 rows jointly have positive parallax, both proper
motions and radial velocity. All of those happen to be code-31 solutions.
The 15 code-95 solutions do not thereby supply radial velocity: their sixth
fitted coordinate is pseudocolour. These counts describe this capture only.

The existing GoFA Starpm interface documents TDB epochs and angular rates,
whereas Gaia gives a TCB catalog epoch and proper motions. The new
src/engine/ephemeris/barycentricTime.ts implements only the IAU 2006 B3 affine
TCB/TDB coordinate-time conversion, retaining two-part dates and the defining
nonzero offset. It does not change Gaia parameter units or implement propagation.
A separate ERFA execution generated 14 forward/inverse reference cases spanning
the origin, J2000, Gaia J2016 and day boundaries; focused checks compare them
within 0.3 ns numerically. This tolerance is not a stellar-position accuracy.

Reproduce the independent time oracle into a new file:

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 python scripts/reference-barycentric-time.py --output .cache/new-barycentric-time.json

[IAU 2006 Resolution B3](https://www.iau.org/static/resolutions/IAU2006_Resol3.pdf)
defines the time relation. A complete astrometric adapter must also establish
consistent rate/length conventions, perspective and light-time treatment,
explicit treatment of spectroscopic versus astrometric radial velocity, and
independent reference states. Merely replacing dates is insufficient. No
missing radial velocity is currently filled with zero, and no new propagated
star state is exposed by this time-conversion module.

## Single-star computation core

### Source-backed station direction API (unverified implementation)

`POST /v1/stellar/observer` accepts `originalManifestBase64`,
`originalRowsCsvBase64`, `sourceId`, `radialVelocityPolicy`, `utc` and
`station: { longitudeDeg, latitudeDeg, heightMeters }`. All station numbers
are required; UTC uses the existing explicit Z/leap-second parser. No target
year is entered separately. The configured immutable IERS snapshot and SPK
catalog produce the station state, from which a TCB propagation year is
derived. Missing EOP/SPK coverage fails rather than inventing a station state.

The response's `experiment` contains both the original-source stellar receipt
and the ground observation receipt, plus `coordinateDirectionBcrs`, RA/Dec,
two-part TDB epoch and the residual time after rounding the TCB Julian year.
Top-level catalog and EOP identities are retained. Source/request/response
byte bounds, one shared compute lease, batch scheduling, cancellation and the
20-second compute deadline apply as for the existing stellar endpoint.

The core first uses the existing Starpm propagation, then converts its angular
rates and parallax to TDB-compatible parameters. The adopted spectroscopic
radial velocity remains in km/s. GoFA `Pmpx` uses the reception observer's SSB
position and the split-date residual to apply parallax and its approximate
observer Rømer term. See the primary [ERFA Pmpx documentation](https://raw.githubusercontent.com/liberfa/erfa/master/src/pmpx.c).
This is the combined observer state from `Apco`: the source Earth barycentric
state plus the WGS-84 station offset, expressed as `ObserverState.PositionKM`
and converted to AU for `Pmpx`; it is not a raw SPK Earth vector. The path
applies no additional TCB-to-TDB spatial rescaling to that vector, so compatible
ephemeris and station-length scales are an explicit assumption, especially for
custom profiles. The epoch/rate conversion and this observer-length assumption
are separate parts of the model, and numerical parity alone does not validate
the latter.

For the checked-in `pages` ephemeris manifest, the non-dependency root covering
both Earth (`naif:399`) and Sun (`naif:10`) is the pinned JPL `de440s` file
(`8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069`); the
later DE441/DE442 candidates in that profile are marked dependency-only. JPL
documents DE440 positions as integrated in AU with TDB days and the AU fixed
at 149597870.700 km. ERFA's `Apco` contract takes a TDB date and barycentric
Earth PV in AU, and `Pmpx` takes the SSB-to-observer vector in AU in BCRS axes.
Those source contracts support the current no-extra-factor convention for the
source ephemeris component of this pinned packaged observer path. The station
offset is assembled by SOFA `Apco` from geodetic coordinates and height in
metres under its WGS-84 convention. This is a contract-based inference, not a
new numerical accuracy result or an independent proof that the combined
ephemeris/site vector has the ideal TDB-compatible spatial scale. The catalog
loader also accepts replacement data directories whose manifests do not type
their spatial scale, so the assumption is not generally verified for custom
`--data-dir` inputs; the returned kernel identity and hash must be retained
when interpreting such results.

Sources: [ESA Gaia DR3 reference systems](https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_refsystems.html), [JPL DE440 ephemeris conventions](https://ssd.jpl.nasa.gov/planets/eph_export.html), [ERFA Apco](https://raw.githubusercontent.com/liberfa/erfa/master/src/apco.c), [ERFA Pmpx](https://raw.githubusercontent.com/liberfa/erfa/master/src/pmpx.c).

The output is a coordinate direction: no aberration, light deflection,
horizontal transform, refraction or uncertainty propagation is applied to it.
Nested observation fields may include other body-specific corrected values;
those do not change the separately labeled stellar direction.

This adds neither an occultation event search nor a certified physical
accuracy. The method treats the SPK J2000 observer axes as ICRS-aligned under
the existing observer model and assumes its spatial scale is compatible with
the TDB-scaled stellar parameters, as described above. Stellar size, systematic
errors, full iterative observer/star light time and direction covariance remain
unresolved. At that implementation checkpoint, Web/native controls, independent
numeric references and real endpoint execution were still pending. No
build/test/CI execution was performed for that addition.

Web wiring now adds a station mode in the existing stellar panel, with blank
required UTC/longitude/latitude/ellipsoidal-height fields. It reuses the source
file selection and explicit RV assumption. Catalog covariance controls do not
apply in station mode. Edits and mode changes clear/abort pending results.
The response validator reuses original Gaia reconstruction and observation
contracts, requires Earth/Sun source coverage at reception, and checks the
observer model, matching split epochs, TCB-year conversion/residual and the
unit-direction/RA/Dec relationship. These are consistency guards, not a second
independent computation of the stellar direction.

Station direction and underlying barycentric catalog state have separate
readouts. The complete envelope, both nested receipts, SPK/IERS identities and
original Gaia files are exported as `solar-gaia-observer.json`. This Web wiring
has only source/diff inspection; browser, actual endpoint, numeric-reference
and native-control verification remain pending under the testing hold.

A follow-up static source trace confirms the refusal boundary: single-star and
station calculations bind the selected decimal `sourceId` to one manifest-
receipted CSV row, require J2016.0, solution code 31/95, positive parallax, both
proper motions and an explicit spectroscopic-RV adoption. Station requests also
require explicit UTC and complete longitude/latitude/height; missing source,
SPK or IERS inputs do not produce a direction. In chunk mode, incomplete
astrometry is a per-row `missing` outcome, propagation/domain failures are
`rejected`, and only successfully propagated rows are plotted. The browser
checks each returned row against its source ID and retains original request,
manifest and chunk receipts in the corresponding exports. This is static
code-path evidence only, not browser or live-endpoint acceptance.

The implementation now also returns a separate `observed` record, using the
same in-process Apco context: `Ldsun` applies distant-source solar deflection,
`Ab` applies the total observer velocity, and the retained precession/nutation
and Atioq transformation give CIRS and airless horizontal directions. Proper
motion/parallax are not applied again. Apco's Diurab is zero because station
velocity is already included. The record retains GCRS proper direction,
CIRS RA/Dec, airless azimuth/altitude, coordinate solar elongation and the solar
deflection-limiter flag. See [ERFA Atciqz](https://raw.githubusercontent.com/liberfa/erfa/master/src/atciqz.c)
and [Ldsun](https://raw.githubusercontent.com/liberfa/erfa/master/src/ldsun.c)
for the correction sequence and distant-source/limiter assumptions.

The original `coordinateDirectionBcrs` remains unaltered. Coordinate solar
elongation is measured before aberration/deflection, not between apparent
positions. No planetary deflection, terrain, solar-disk visibility
or physical uncertainty is supplied. Web displays separate corrected and
coordinate readouts and checks the added record's shape/model/ranges. This
additional path is also uncompiled/unexecuted; no SOFA parity or live acceptance
is claimed. The retained astrometry context is not serialized and cannot be
recreated by supplying an arbitrary JSON observation receipt.

Optional `atmosphere` now accepts all four explicit fields `pressureHPa`,
`temperatureC`, `relativeHumidity` and `wavelengthMicrometers`, using the
existing ground-request domain. The Web fields start blank. Refco coefficients
are retained in a separate private context, leaving airless calculations
unchanged; non-finite coefficients are rejected. The observed model identifier
is now `sofa-ldsun-ab-cirs-atioq-v1`. Its `refractionStatus` is `not-requested`,
`outside-altitude-domain` or `applied`; `refracted` exists only when requested
and airless altitude is at least 5 degrees. The client checks this relationship
and the matching warning instead of treating a missing correction as zero.

This 5-degree cutoff is an application policy, not a refraction accuracy
certificate. [ERFA Refco](https://raw.githubusercontent.com/liberfa/erfa/master/src/refco.c)
describes the pressure/temperature/humidity/wavelength model and limitations;
local atmospheric structure is not supplied. Airless output, CIRS and the
coordinate ray remain separate from the optional refracted direction. These
changes have not been compiled, executed or tested under the current hold.

Native request construction is now implemented as `StellarObserverRequest`
(Android) and `NativeStellarObserverRequest` (iOS). Both share original-file,
signed-64-bit source identity and explicit RV-policy validation with catalog
propagation, but encode UTC/station instead of a placeholder target year.
Station values must be finite and in the backend's domain. An optional
atmosphere is validated as a complete value; omission preserves airless-only
behavior. File and wire byte budgets and cancellation checks are retained.
Calendar/leap-second validation remains in the authoritative SOFA backend.

These are request types only at this stage. Native response validation,
transport and controls for the observer route remain pending; this is not
native endpoint acceptance. Neither language was compiled or executed.

Android now additionally implements `StellarObserverReport` and
`StellarMotionService.loadObserver`. The report checks original-source nested
stellar receipts using the existing validator without serializing a second
envelope, plus station/weather echoes, SPK/EOP identity, reception source
coverage, matching split epochs, the derived TCB year, vector/RA/Dec coherence,
observed coordinates and refraction status. Exact outer response bytes are
retained for export; returned arrays are defensive copies. These checks do
not independently recompute observer astrometry.

The two stellar routes share the existing HTTPS-only transport and one-active
request guard, including no redirects, bounded exact-length JSON reads,
deadline, cancellation and lifecycle close. The observer method remains a
separate entry point. Android UI and iOS report/transport wiring are pending.
Neither the Java refactor nor the new route has been compiled, exercised or
tested; no live native acceptance is asserted.

Android panel wiring now offers station mode with blank UTC/WGS84 fields and
optional blank weather fields. Catalog year/covariance controls are hidden in
that mode. Every field or mode change uses the existing generation/close path
to invalidate prior requests; source files are preserved. The bounded observer
service feeds separate coordinate, CIRS, airless and optional refracted
readouts, including limiter/domain warnings and source metadata. Export uses
the existing document-provider flow with `solar-stellar-observer.json`, keeping
the exact validated envelope. Added Chinese/English controls and limits.

This completes Android source wiring, not acceptance. No Java/Android build,
emulator, device, endpoint or export execution has run for the new station
mode. iOS observer response/service/view remains pending.

iOS now has `NativeStellarObserverReport` and
`NativeStellarMotionService.loadObserver`. Its decoder keeps scientific numeric
tokens on the existing direct-binary64 JSON path and validates the nested
original Gaia receipt without serializing it again. It checks station/weather,
SPK/EOP identities and reception coverage, split epochs and derived TCB year,
coordinate/angle consistency, apparent ranges and refraction-state invariants.
The immutable report retains exact outer bytes and model warnings. The two
routes share the actor's single-active-call guard and bounded HTTPS transfer;
task cancellation remains checked before and after validation.

`NativeStellarMotionView` now exposes station mode from `NativeObservationDeck`, with explicit UTC/WGS84 inputs, optional all-or-none weather values, cancellation and original-response export through `NativeStellarMotionService.loadObserver`. Static source references confirm the request route is wired to `v1/stellar/observer`; this is not execution evidence. No Swift compile, protocol test, simulator, device or live HTTP request has run for this change.

### Epoch receipt validation update (awaiting verification)

Web, Android and iOS response validators now independently check that source
and target two-part TDB dates correspond to J2016.0 TCB and the requested TCB
Julian year. Previously those arrays were checked only for shape and finite
values. The comparison keeps split dates and allows two microseconds for
binary64 representation/arithmetic; this tolerance is not a physical timing
accuracy. Web reuses the existing barycentric-time module, and native clients
apply the same IAU affine relation. The relation and constants were inspected
against [ERFA tcbtdb](https://raw.githubusercontent.com/liberfa/erfa/master/src/tcbtdb.c)
and its defining constants. These new response guards have not been compiled
or executed under the current user-requested testing hold.

This does not make the propagated ICRS barycentric catalog direction an
observer-relative SPK sightline. Observer parallax, compatible coordinate and
time conventions, light-time treatment and common apparent-place corrections
still need to be resolved before connecting Gaia propagation to ellipsoid
intercepts. No direct automatic connection is currently claimed.

internal/stellarmotion now implements an explicitly adopted catalog model with
gofa v1.19.1 Starpm. Single-source and station requests require J2016.0, valid
five/six-parameter solution identity, positive measured parallax, both proper
motions and a radial velocity. The batch endpoint keeps
`spectroscopic-as-astrometric` as its strict policy and offers a separate,
explicit `gaia-mu-r-zero-when-rv-missing` policy. That option uses a supplied
spectroscopic RV where present and adopts zero radial proper motion
(`mu_r=0`) only where Gaia RV is absent; affected rows are marked
`zeroRadialMotionAssumed`, and the returned 0 km/s is not a measurement. Exact
coordinate poles remain unsupported.
Supported target years are within 100 Julian years of J2016.0; that bound is a
software domain, not a positional-accuracy guarantee. Any nonzero SOFA status
(distance override, excessive-velocity replacement, or failed convergence)
is rejected. The output includes model assumptions and both TDB epoch parts.

For F=1-LB, the adapter uses the derived compatible-coordinate mapping
t*=F t+constant, x*=F x: angular rates divide by F; the formal AU/distance
parallax argument divides by F when using the same defined AU in metres;
velocity is unchanged. Outputs are mapped back to TCB-compatible quantities.
This is an internal computational scaling, not a correction applied to Gaia
source rows. See [Klioner 2008](https://www.aanda.org/articles/aa/pdf/2008/06/aa7786-07.pdf)
for compatible coordinate scaling and the IAU resolution above for time.

A separate pinned ERFA oracle produces 64 states from 16 actual source rows at
J1916, J2016, J2026 and J2116. It also verifies that evaluating the same uniform
model entirely in TCB agrees with joint scaled TDB evaluation. Focused Go tests
compare the output with ERFA and reject missing, invalid and SOFA-modified states.

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 python scripts/reference-gaia-motion.py --output .cache/new-gaia-motion.json
    rtk proxy go test ./internal/stellarmotion -run 'TestIndependentERFAStates|TestRefusesIncompleteOrModifiedModels' -count=1

This incorporates SOFA changing-light-time/special-relativistic treatment for
uniform single-star motion, not binary/Galactic acceleration, observed-station
corrections or uncertainty propagation. Spectroscopic RV contains astrophysical
shifts and is only adopted approximately; inverse measured parallax supplies a
nominal model distance, not a distance inference. Source-bearing CLI and HTTP
access are described below; browser/native integration remains outstanding.

## Source-bearing offline propagation

The offline entry point reads original CSV directly and exports the entire
original manifest and CSV as base64, their SHA-256 hashes, the selected source
row, build identity, explicit adopted RV policy and model result:

    rtk proxy go run ./cmd/gaia-motion --manifest tests/fixtures/gaia-six-20260923/manifest.json --rows tests/fixtures/gaia-six-20260923/rows.csv --source-id 65212004581252736 --epoch-tcb 2026 --rv-policy spectroscopic-as-astrometric --output .cache/new-gaia-motion.json

The manifest is limited to 1 MiB and CSV to 16 MiB / 30,000 rows. Exact schema
columns, frame/epoch, CSV header, ordered unique 64-bit source IDs, declared row
count and original CSV hash/size are checked. The selected source must satisfy
the complete-input propagation contract. The evidence is copied before return;
exports never overwrite an existing file. CSV agreement with the provided
manifest does not independently authenticate ESA or establish completeness.
Other files referenced in the manifest are retained as references, not claimed
to have been loaded or validated. No chunks need to be read for this entry point.

The real local CLI was executed for source 65212004581252736 at J2026 TCB.
Its exported state matches the independent ERFA fixture and both embedded
original files decode byte-for-byte. A second run to the same output path was
refused. Browser/native integration and propagated covariance remain outstanding.

## Source-bearing HTTP propagation

`POST /v1/stellar/motion` accepts one JSON object with these fields:

| Field | Meaning |
| --- | --- |
| `originalManifestBase64` | Base64 of the original manifest file bytes |
| `originalRowsCsvBase64` | Base64 of the original CSV file bytes |
| `sourceId` | Exact decimal source ID string |
| `targetEpochJulianYearTCB` | Explicit target epoch, for example 2026 |
| `radialVelocityPolicy` | Explicit `spectroscopic-as-astrometric` adoption |

The response contains `apiVersion` and the same source-bearing `experiment`
as the offline adapter. It does not imply configured SPK coverage or ESA
authentication. The JSON body is capped at 26 MiB to cover base64 expansion;
decoded source limits remain 1 MiB / 16 MiB / 30,000 rows. Unknown fields and
trailing JSON are rejected. The route uses request admission and the weighted
trajectory compute queue, with a 20-second context budget and cancellation
checks between CSV rows. The production server also limits request reads to
15 seconds. The response is bounded at 14 MiB.

Malformed input returns 400, an oversized initial JSON body 413, invalid source
evidence or unsupported model input 422, cancellation 408, and compute overload
429. A focused test uses actual loopback HTTP and verifies byte-exact original
files plus all six output components against the independent ERFA fixture.
This is local HTTP evidence, not deployed-service or native-client acceptance.

## Browser propagation workspace

The evidence workspace now includes Stellar epoch propagation. Select the two
original files, enter the exact source ID and target TCB Julian year, and
explicitly adopt the spectroscopic RV approximation before computing. A
configured VITE_SOLAR_API_BASE_URL is required; no remote service is silently
selected. The main Gaia sky chart remains at J2016.0; the separate bounded
chunk mode below renders its successfully propagated target-epoch subset.
Changing inputs clears the
previous result and cancels pending work. Exports retain the entire experiment
and frontend build identity through the existing platform export mechanism.

The client checks bounded source/response sizes, exact echoed original bytes,
SHA-256 hashes, source/epoch/model identity, finite state and declared limits.
The retained gaia-motion-experiment.json fixture is the experiment extracted
from the actual Go CLI output described above. Three focused client tests and
one UI scenario across four browser profiles passed. The browser scenario
replays that output over an intercepted transport and covers explicit adoption,
export, stale-result clearing and cancellation. It does not establish live
browser-to-Go or physical native-device acceptance; actual loopback HTTP is
covered separately by the Go test. Propagated covariance remains outstanding.

The browser also parses the retained original CSV and compares every selected
source field, including nulls and the exact decimal identity, with the returned
selectedSource. Correct hashes alone are insufficient to accept a mismatched
selected record. Parsing is bounded to 64 MiB and 100,000 data rows, supports
quoted fields, and rejects duplicate selected identities and malformed numeric
values. These checks preserve the original bytes rather than rewriting them.
The scan keeps only the header, current row and selected row, rather than an
array of every parsed row. It yields after at most roughly 32 KiB of input
characters and checks the request cancellation signal before resuming. Original
bytes and decoded text are still retained; this is not a claim of zero-copy
processing or a measured total-memory budget.

## Formal covariance core and validation

internal/stellarmotion/covariance.go constructs the five-astrometric-coordinate
marginal plus spectroscopic radial-velocity variance only with the explicit
independent-spectroscopic-rv policy. No cross-correlations are represented as
measured. Gaia pseudocolour is marginalized, never substituted for radial
velocity. All six errors and ten astrometric correlations must be present;
the normalized matrix must pass strict Cholesky without repair.

The prototype computes a local first-order covariance pushforward from two
central-difference scales and Richardson extrapolation of the adopted Starpm
model. It retains the strict-Cholesky input factor, propagates that factor
through the numerical Jacobian, and forms the output as K K-transpose with
Neumaier-compensated dot products. This avoids directly summing the more
cancellation-prone J C J-transpose expression; it does not change the adopted
astrometric model or certify physical accuracy.
The `maxScaledDerivativeDifference` diagnostic is the largest rowwise
`sqrt(DeltaJ C DeltaJ-transpose / C_output,ii)`, with `DeltaJ` comparing the
two central-difference scales. This gives the check a dimensionless scale
across mixed input and output units; its `1e-4` gate is a local cross-step
criterion, not a global derivative error bound.
Tangent angular coordinates use mas, proper motions mas/Julian-year, and RV
km/s. The exact same-epoch map uses the identity Jacobian to avoid numerical
subtraction noise. Near-pole coordinate charts and unconverged derivatives are
refused. This follows the general covariance transformation described in
[ESA's astrometric transformation documentation](https://gea.esac.esa.int/archive/documentation/GEDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_tansforms.html),
but uses RV rather than radial proper motion as the sixth numerical coordinate.
It does not copy the documented radial-proper-motion covariance formula into
the different coordinate system.

Two focused Go tests cover 16 real same-epoch sources, malformed matrices,
missing errors, explicit assumptions, cancellation and one future-epoch
variance-growth sanity check. Those tests do not establish cross-epoch accuracy:
independent propagated covariance references and the nonlinear-limit evidence
below provide separate numerical comparisons, not a complete nonlinear-limit
assessment or physical-accuracy guarantee.

Independent numerical evidence is now available in
`gaia-covariance-reference.json`: 64 states from 16 original sources at J1916,
J2016, J2026 and J2116. The pinned Python generator uses five-point differences
at two step scales, and evaluates ERFA entirely in TCB-compatible coordinates
instead of the Go adapter's scaled TDB coordinates. Reference step disagreement
is at most 1.38e-5 after normalization by the output standard-deviation product;
Go/reference disagreement is at most 1.193e-4 under the same normalization.
This is a numerical comparison, not a relative error bound for near-zero entries.

`gaia-covariance-ensemble.json` additionally records six nonlinear ERFA Gaussian
ensembles: three real sources at J1916 and J2116, 32,768 draws per case, PCG64
seed 20260923. No draws are filtered. The largest normalized empirical/linear
covariance difference is 0.013742, including finite-sample error. This checks
only those adopted Gaussian models and sources, not coverage for all possible
parallaxes, large fractional errors, binaries or systematic offsets. Both
generators preserve original source, generator and prerequisite SHA-256 receipts.

    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.3 python scripts/reference-gaia-covariance.py --output .cache/new-gaia-covariance.json
    rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.3 python scripts/reference-gaia-covariance-ensemble.py --output .cache/new-gaia-covariance-ensemble.json

Two focused Go tests validate every retained matrix and receipt.

## Optional formal covariance through CLI and HTTP

The CLI now accepts `--covariance-policy independent-spectroscopic-rv`, and
POST /v1/stellar/motion accepts the optional JSON field `covariancePolicy`
with that exact value. Omission preserves nominal-state-only behavior. Unknown
policies fail; missing covariance inputs do not silently become zero errors.
The two explicit choices remain separate: `radialVelocityPolicy` adopts the
spectroscopic velocity value, while `covariancePolicy` adopts independent RV
formal errors. Neither choice certifies physical accuracy.

## Bounded chunk propagation

`POST /v1/stellar/motion/tile` applies the same SOFA single-star model to one
original Gaia manifest chunk, up to 30,000 rows. Its JSON request contains
`originalManifestBase64`, `chunkPath`, `originalChunkBase64`, an explicit
`targetEpochJulianYearTCB`, and the same explicit `radialVelocityPolicy` used by
the single-source endpoint. The request body is capped at 45 MiB; batch request
admission is isolated to at most two active requests per service instance and
SOFA work still passes through the configured compute queue.

The backend checks the manifest schema and selection evidence, exact chunk
length and SHA-256, sorted Gaia IDs, row columns, reference epoch, spatial bin,
magnitude selection and cone membership before propagation. Each row is
returned as `propagated`, `missing` or `rejected`; parallax and proper motion
are never synthesized. Missing spectroscopic RV remains `missing` under the
strict policy. Under the explicit Gaia `mu_r=0` policy, a row with missing RV
can propagate only when its position, proper motion and positive parallax are
valid; the per-row flag and `zeroRadialMotionRows` count preserve that
assumption in the compact and exported receipts. Gaia documents `mu_r=0` as the
default when radial velocity is unknown in its standard epoch-propagation
model ([Gaia DR3 stellar-motion model](https://gea.esac.esa.int/archive/documentation/GDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_motion.html)).
This is not a zero-RV measurement and does not capture perspective acceleration
from the unknown true radial motion. The response includes common two-part TDB
epoch receipts and limitations. The supplied
manifest and chunk bytes are source-linked transfer evidence; they do not
authenticate ESA or establish Gaia catalog completeness. Rows still missing
required position, proper motion, positive parallax or an adopted radial-motion
policy are omitted. A zero-radial-motion result is identified as a model
assumption, not a measured six-dimensional state.

The batch dispatcher already classifies identity, reference epoch, solution and
missing required fields before calling the SOFA kernel. The former kernel
wrapper repeated those contract checks for every accepted row; validation now
runs once, and the shared propagation kernel only handles validated astrometry
and the existing SOFA calculation. The finite-value and coordinate-domain
checks remain in place, as do per-row missing/rejected outcomes. This removes
duplicate per-source validation work without changing scientific formulas or
the reported model. Its throughput effect is unmeasured; the 30,000-row chunk
limit and two-request admission remain unchanged.

After decoding a Gaia chunk, the target-epoch worker keeps G magnitudes in one
Float64 column and radial-velocity availability in one byte per row. It releases
the validated source-object graph before waiting on network or upload ACKs.
At 30,000 rows these replacement columns occupy 270,000 bytes per chunk; the
removed JavaScript object graph has no portable byte size, so this is a bounded
lifetime reduction, not a measured heap saving. The availability vector lets
the browser check that each `mu_r=0` receipt flag corresponds to an actually
missing source RV. Original chunk bytes and exact source IDs remain available
for backend validation and receipt identity.

The stellar workspace accepts either one local manifest with every original
chunk it declares or one to eight remote manifest URLs. It validates a shared
schema, at most 200,000 aggregate input rows, 128 MiB of selected chunk bytes,
8 MiB of manifest bytes and 2,592 chunks before reading any chunks. Its shared
tangent-plane radius is conservative for each source cone
and may not exceed 80 degrees. Cross-manifest duplicate `source_id` values are
counted once, with the first manifest's row taking precedence. This produces a
bounded combined field; it does not infer full-sky completeness.

Verified chunks stream into the existing WebGL chart. Source reads have two
bounded in-flight slots within each manifest; manifests themselves are handled
sequentially to keep first-manifest duplicate precedence deterministic. Reads
and hashes may overlap, while decoding, source-ID discovery and propagation
request starts follow descriptor order. Up to two backend propagations may run
concurrently; their deduplication, projection and publication commit in
descriptor order. After posting a result, the worker may start the next chunk
while the chart uploads and draws the prior one; it waits for an upload credit
before beginning another backend request.
At most two result chunks and 60,000 declared input rows can await upload ACKs.
The chart allocation is fixed from
the aggregate declared rows, up to 200,000. In-flight source reservations stop
at 64 MiB and 60,000 rows; parsed objects, base64 request strings, browser file
storage, retained export receipts and GPU/driver memory are separate working
costs and have not been measured as a total-heap bound. Non-empty chunks are
acknowledged after the checked GPU upload/draw command; empty-display chunks are
acknowledged after the page queues their verified receipt. This bounds message
handoff, but does not certify that the compositor has physically presented a
frame. Only successfully propagated
stars inside the shared field are plotted. Rows without a complete model are
counted but omitted, so the target-epoch view does not mix J2016 and propagated
positions. The main Gaia sky-chart workflow remains fixed at J2016.0; observer
corrections and throughput/device acceptance remain outstanding. These are
source admission ceilings, not demonstrated simultaneous render capacity. No
deployed-service or throughput result is implied.

For two maximum 32 MiB chunks, the base64 chunk fields carry 89,478,488 ASCII
characters (about 85.3 MiB of request text) while the worker retains up to
64 MiB of raw chunk bytes until the corresponding requests finish. The two
bounded responses can each contain up to 14 MiB. These are distinct payload
limits with partially overlapping lifetimes, not a resident-memory sum:
`JSON.stringify`, Fetch, response decoding, parsed row objects and browser
string representation add implementation-dependent costs.

The Go tile handler decodes each base64 chunk into its own byte slice. The
previous backend parser then unmarshaled the complete `sources` array into
`[]json.RawMessage`, copying the row JSON while retaining the original chunk.
The parser now consumes rows one at a time, validates each row and appends its
compact scientific `Source`; this removes a source-derived copy bounded by one
32 MiB chunk per handler, or 64 MiB across the two admitted handlers. It retains
one raw row during validation. Compact source records, propagated result rows,
the marshaled response (capped at 14 MiB), decoder allocations and Go runtime
overhead still overlap. This is a source-derived allocation bound, not a
measured RSS saving or total-memory ceiling. Duplicate top-level `sources`
fields are rejected as ambiguous input.

For chart selection, the worker transfers one `Uint32` row ordinal per plotted
source and the page resolves it against the retained scientific receipt. This
uses four bytes per plotted star for the mapping (800,000 bytes at 200,000
plotted rows) instead of a second per-star object graph and structured clone.
The worker also compacts each motion receipt's per-source rows into transferred
typed columns: signed 64-bit source IDs, one-byte status codes, two-byte reason
codes and two-byte state indexes. At 200,000 input rows those fixed columns
occupy 2,600,000 bytes; each propagated row adds six `Float64` values (48
bytes), for a 12,200,000-byte ceiling if every input row propagates, plus a
reason dictionary bounded by the response budget. Missing and rejected rows do
not reserve state values. This replaces the retained graph of JavaScript
row/state objects. Selection reconstructs one row;
JSON export reconstructs one chunk at a time through the bounded stream writer.
The six state values remain binary64 and source IDs retain their exact decimal
identity. All schema-v1 receipt fields and provenance remain in the export.
For the all-propagated, all-in-field 200,000-row case, the retained result
columns and six-field states total at most 12,200,000 bytes; adding source-row
ordinals (800,000), CPU display coordinates (2,400,000) and the GPU vertex
buffer (2,400,000) gives a typed-array subtotal of 17,800,000 bytes (about
16.98 MiB). On the first point-pick, `ScreenPointIndex` adds a 4-byte `next`
entry per uploaded row (up to 800,000 bytes) and a viewport-sized cell-head
array; it reads coordinates from the retained display batches instead of
allocating another coordinate cache. At the maximum 2048-square render target,
the RGBA8 texture adds 16 MiB. The source-accounted subtotal is therefore about
32.98 MiB before point-picking, or about 33.74 MiB after the point index's
per-row array, plus its viewport-sized cell-head array. This is an allocation
estimate, not a total-heap or device-capacity guarantee. The reason dictionary
is bounded by its response budget but excluded from this typed-array subtotal;
the source-ID deduplication set, transient requests/responses, decoded objects,
Blob/browser storage and GPU driver overhead remain unmeasured.

Each motion manifest is SHA-256 checked and Base64 prepared once per collection,
then the encoded snapshot is reused for that manifest's chunk requests. The
current HTTP contract still retransmits and server-validates the full manifest
for each chunk. Each backend instance now retains up to four successfully
validated parsed manifests under an 8 MiB conservative admission budget, keyed
by SHA-256 of the exact manifest bytes; least-recently-used entries are evicted
first.
Repeated tile requests can reuse the parsed settings and descriptor map, while
each request still hashes the supplied manifest and chunk and validates all
chunk rows. Invalid manifests are never cached. The client reuse removes repeated
browser hashing/encoding, and the backend cache removes repeated manifest
parsing/descriptor validation for warm entries; neither reduces wire bytes, and
no end-to-end speedup is claimed without workload measurements. The cache exposes
process-local counters for focused follow-up measurement, not a public metrics
endpoint.

The optional `experiment.formalCovariance` contains the input/output matrices,
Jacobian, difference steps and convergence diagnostic, frame/time scale, target
epoch, coordinate labels/units, policy and assumptions. Original manifest/CSV
bytes and the selected source remain in the same experiment. Cancellation,
request/compute admission and source budgets are preserved.

    rtk proxy go run ./cmd/gaia-motion --manifest tests/fixtures/gaia-six-20260923/manifest.json --rows tests/fixtures/gaia-six-20260923/rows.csv --source-id 65212004581252736 --epoch-tcb 2026 --rv-policy spectroscopic-as-astrometric --covariance-policy independent-spectroscopic-rv --output .cache/new-gaia-motion-covariance.json

The actual CLI export for this source and year was checked against original
bytes and the independent ERFA covariance (maximum normalized difference
6.047e-6). A real managed loopback HTTP test verifies the same receipt and
matrix, default omission, and invalid-policy refusal. Browser/native covariance
controls remain to integrate; no deployed-service acceptance is claimed.

## Browser formal covariance

The stellar panel now has a separate unchecked covariance option describing
the independent-RV assumption. Its selected state is sent only when explicitly
enabled. Changing it clears prior results and cancels pending requests. The
result shows all six marginal standard deviations with their own units and
explains that these are not a joint confidence region or timing guarantee.
The full matrices, Jacobian, source bytes and assumptions remain in the export.

The browser reconstructs the five-coordinate input covariance from the verified
CSV row, adds the adopted RV variance, checks symmetric positive matrices and
validates J C J-transpose. Wrong policy/epoch/units, missing or unsolicited
covariance, altered input or output matrices and altered Jacobians are refused.
Six focused client tests and the stellar UI scenario in four browser profiles
passed. A follow-up mobile-only run verified spacing of the two separate
assumption controls after screenshot review. These browser tests replay an
actual CLI covariance export and do not replace live browser-to-Go acceptance.
Physical native covariance UI and device validation remain outstanding.

## Android request contract in progress

StellarMotionRequest owns copies of the original manifest/CSV, preserves source
IDs as decimal strings within signed-64-bit bounds, validates J1916–J2116 TCB,
requires the RV approximation, and adds covariance only with its explicit policy.
Its decoded input budgets match the backend and its wire request is capped at
26 MiB. Two plain-JVM tests verify real fixture bytes, defensive copies, optional
policy omission and invalid identities/epochs/budgets. They passed with javac
--release 17 and cached JUnit. The targeted Android Gradle invocation could not
start because no SDK path is configured on this host. Network response validation,
native controls, Android build/device proof and iOS stellar access remain pending.

The Android response model now verifies original base64 bytes and SHA-256,
parses the selected CSV row without storing every row, binds every returned
source field, validates model/epoch identity and finite state, and checks the
optional covariance input errors, units, positive matrices and J C J-transpose.
Response bytes and returned readout arrays are defensively copied. Validation
observes worker-thread interruption. The response budget is 14 MiB.

Six focused JVM request/report tests passed against real Go output fixtures,
altered scientific contracts, cancellation, bounds and byte retention. The
request encoder avoids java.util.Base64 (added in Android API 26) because this
project also targets API 24/25; its output was checked against the JDK encoder
for 1,025 lengths and varied byte values. These remain plain-JVM tests, not a
claim of Android device acceptance. Native networking/UI integration is pending.

StellarMotionService now implements the Android-side HTTPS POST with one active
request per instance, no redirects or credential-bearing URLs, strict JSON
content type/length and a 14 MiB response cap. It uses the source-bound response
validator, propagates backend error messages, and disconnects on cancellation
or a 25-second deadline. Socket connect/read timeouts also apply. Cancelled or
expired instances cannot be reused and results are checked again before return.
The caller must run it off the UI thread and discard stale UI generations.

Four focused JVM transport tests passed with injected connections, including
exact request bytes and real CLI-output replay, malformed/truncated responses,
redirect/error handling, pre-cancellation, mid-read cancellation and a deadline
that demonstrably disconnects during a stalled header read. This is controlled
transport evidence, not a real TLS exchange or Android lifecycle/device proof.
Native file-picker controls and live service integration remain outstanding.

The Android panel is now wired to separate original-manifest and CSV document
selection, bounded background reads, explicit RV/covariance checkboxes, HTTPS
calculation and result export. Source reads have a 25-second UI deadline and a
provider cancellation signal; late callbacks are suppressed by generation.
Input edits, collapse, detach and activity pause clear results and cancel work.
The selected original file bytes remain available to retry while the activity
lives. Exports retain the snapshot chosen before the destination picker opens.

The native smoke harness now stages only the two pinned original files on its
owned emulator, supplies picker-result callbacks, and requires a real HTTPS
stellar POST plus expected nominal/covariance readouts and stale-result clearing.
This new native scenario has not yet run: local Android SDK compilation/device
execution is unavailable. Eight focused harness/reuse unit tests, script syntax,
targeted lint and English/Chinese resource XML parsing passed. System picker
interaction, export destination writing and physical-device behavior remain
unverified; the callback-driven smoke is not proof of those UI boundaries.

The panel's provider stream reader is separately testable as StellarSourceImport.
It checks cancellation before each read and after EOF, owns/closes the stream,
checks actual byte counts against the manifest/CSV budget, rejects empty input
and handles zero-progress reads without a tight loop. Three targeted JVM tests
passed at exact 1 MiB/8 MiB boundaries, one byte over, pre-read/EOF cancellation,
stream closure and zero-progress input. Provider-specific blocking/cancellation
behavior and system document-picker interaction still require Android execution.

## Cross-platform covariance normalization follow-up

Web and Android receipt checks formerly normalized covariance by the square
root of a product of two variances. That intermediate product can exceed the
Float64 range or underflow even when the intended correlation is representable.
Web, Android and iOS now normalize by each standard deviation separately and
explicitly reject nonfinite correlations, factor entries and scaled residuals.
The source-matrix and Jacobian-consistency tolerance remains 1e-10; no covariance
jitter, repaired eigenvalues or widened tolerance is introduced.

These are client receipt-consistency checks, not an independent propagation or
physical accuracy certificate. The change has only been source/diff reviewed;
no numerical checks, compiler, test, browser or native device run was performed.
Native Gaia covariance already has a service/UI chain. Native SBDB orbital
propagation still lacks its shared backend service and remains separate work.

Browser display backpressure has a 30-second per-chunk acknowledgement limit.
A missing acknowledgement aborts loading; changing the load invalidates old
chart upload, error and selection callbacks. Reported WebGL upload/draw errors
or context loss prevent acknowledgement. This is a resource-lifetime policy,
not measured frame throughput or confirmation of physical screen presentation.
These changes have only been inspected at source level; runtime/device
acceptance remains pending.

Local Gaia imports use cancellable FileReader reads with a 25-second read
limit. Manifests remain capped at 1 MiB; each chunk must match its declared
byte size before reading and may not exceed 32 MiB. Chunk cancellation follows
the scheduler signal. Upload waiters clean up timers/listeners at task exit.
Session source-cache limits cover retained encoded bytes only, separately from
active decoding, transferred records and GPU buffers. Source inspection does
not establish browser-worker behavior or total resident-memory measurements.

The Gaia chart bounds point capacity at 200,000 rows and the drawing surface
at 2048 by 2048 pixels, further limited by device viewport/renderbuffer limits.
It requests no depth, stencil or antialias buffers. The point allocation is
12 bytes per row (with a one-row minimum, 2,400,000 bytes at full capacity); CPU picking retains the transferred
Float32 batches, and source records remain available for export. An RGBA8
2048-square texture alone is 16 MiB, but backing-buffer count, driver overhead
and total resident memory are not measured or bounded by that figure. Normal
chunk appends are composited at most once per animation frame; zoom/size changes
rebuild and present the retained view immediately.
Selected-source covariance summaries are reused across chunk/zoom renders.
These source changes await visual, resource and performance acceptance.

Chunk admission is rolling rather than wave-barrier based: completed consumers
release a slot and its source-byte/row reservation, allowing the next manifest
descriptor to start if all budgets permit. Reads and hashes may complete out
of order, but decoding and callback starts follow descriptor order; bounded
consumer work and backend results may complete out of order. Summary fields
loadingBudget and peakActiveChunks expose configured limits and observed job
reservations. They do not measure memory usage or throughput. This scheduler
change awaits execution-based acceptance.

Streaming summaries preserve the requested rectangle and selected manifest
paths in selection. The method uses conservative closed spatial-bin
intersection at J2016.0 ICRS/TCB, including wrap/seam and polar boundaries.
rowFilterApplied is false: entire selected bins remain available, so returned
rows need not lie inside a smaller requested rectangle. Omitted manifest bins
are uninspected; even allManifestChunksVerified does not certify sky/catalog
completeness. Callback descriptors are independent copies, so consumer edits
cannot change the scheduler reservation accounting. Runtime acceptance remains
pending.
