# Gaia DR3 cone data

Run a bounded, explicit query against the ESA TAP service:

```powershell
rtk proxy node scripts/fetch-gaia-cone.mjs --ra 56.75 --dec 24.1167 --radius 0.1 --max-mag 15 --max-rows 1024 --output .cache/gaia-cone-new
```

The output directory must be new. Angles are degrees; the magnitude limit is
Gaia G. Each query has a 45-second deadline and an 8 MiB response ceiling. Cone
radius is at most two degrees and the row budget at most 10,000. The script first
requests COUNT, rejects oversized selections, then requests rows sequentially.
The returned count must match exactly; a truncated CSV is not accepted as a
complete selection. SIGINT aborts the current request. The manifest is written
last, after the original CSV and hashed chunks; an interrupted output without
a manifest is not a completed artifact. No data is published or deployed.

The manifest retains both ADQL queries, URLs, retrieval times, byte lengths,
SHA-256 values, original CSV files and implementation identities. `source_id`
stays a decimal string to preserve its 64-bit identity. The selected columns
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

The checked-in Pleiades-area example contains 19 real ESA rows in one storage
chunk. Its separate count query also returned 19. This is ingestion and byte
provenance evidence, not a capacity benchmark. Proper-motion/observer transforms, stellar occultation integration and
sustained capacity measurements remain unfinished.

## Browser/worker chunk consumer

`src/lib/gaiaChunks.ts` validates an imported manifest, conservatively selects
5-degree bins intersecting an explicit RA/declination rectangle, and streams
hash-verified chunks with Float64 ICRS unit directions. Wrapping RA, the 0/360
seam and polar directions are handled conservatively. Selection is limited to
J2016.0; requesting a later epoch is rejected until motion-aware bounds exist.

The loader defaults to two parallel requests, a 16 MiB in-flight encoded-byte
reservation, 20,000 in-flight rows and 64 MiB total selected bytes. Each request
has a 30-second deadline. One wave waits for its asynchronous consumer callbacks
before admitting more data. The consumer must resolve after accepting/uploading
a chunk and clear its own retained state on cancellation. These counters are
admission limits, not measurements of JavaScript heap or GPU allocations. The
loader does not own retained consumer storage. A failed/cancelled stream never
returns a completed summary; already emitted chunks remain individually verified
and must not be labeled a complete catalog. Cache integration and sustained capacity measurements are still pending.

## Catalog-epoch sky chart

Open the Gaia sky chart in the evidence workspace. Load the bundled 19-source
example, select the manifest and chunk JSON files together, or provide a hosted
manifest URL whose server permits browser access. A worker verifies sources and
projects onto a north-up, east-left tangent plane at J2016.0. GPU upload ACKs
provide backpressure; zoom reuses the existing buffer. Clicking a star or choosing
a row shows its original values; JSON export includes all accepted rows and
source metadata. Input changes, cancellation and errors clear the current chart.

This view requires WebGL 2. Point sizes distinguish G magnitudes visually and
are not angular diameters. It does not apply proper motion, observer parallax,
aberration, deflection or parallax zero-point corrections. Chunk hashes establish
consistency with the imported manifest, not independent ESA authentication.

Stream cancellation/deadlines do not wait for an outstanding consumer upload
acknowledgement. Late consumer failures remain observed. Consumer-owned effects
still need their own cancellation and cleanup; the sky chart terminates its
worker and clears retained display/source state.

The browser verifies all declared source columns, valid solution codes, the
cone/magnitude selection, query row budget and unique source IDs across selected
chunks in addition to hashes. Importer and browser use one column schema; future
import receipts record that schema hash. These checks establish internal
consistency, not independent authentication of an externally supplied manifest.
