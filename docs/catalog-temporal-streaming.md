# Retained catalog epochs: implementation status

The full streaming canvas supports an opt-in retained-orbit time-following
path. The source layer, worker protocol, GPU replacement, canvas orchestration
and UI controls are implemented but have not been executed under the user's
test hold. Static full-catalog evidence does not validate this temporal path
or establish continuous real-time animation.

## Source ownership and admission

`planCatalogStream` accepts an explicit `retainEpochs` flag, false by default.
It adds 80 bytes per admitted row for ten prepared Float64 coefficients and
2 MiB of bounded temporal buffer turnover space plus 128 bytes per source shard
for block metadata and a bounded planning snapshot, on top
of existing fixed/index/transfer/rendering allocations. It can therefore admit
fewer rows for the same budget. This is an explicit array/GPU allocation model,
not a bound on browser RSS or JavaScript runtime overhead.

`streamCatalogPoints` requires both this flag and an `onPrepared` receiver when
retention is enabled. It sends each prepared source block with its starting
uploaded-row ordinal, after exact source filtering and initial position
propagation but before tile publication. Source priority determines this order once; later time changes
must not reorder appearances, source identities or retained rows.

The worker creates a `createCatalogEpochStore` using the admitted capacity.
For each nonempty source block, the store takes ownership of the exact-sized
prepared Float64 slab after `onPrepared`; it does not allocate a second
capacity-sized coefficient array or copy the block into one. The stream producer
does not mutate or transfer that slab after the callback. A view with an oversized
backing buffer is copied to an exact-sized slab before retention. The store
accepts only contiguous appends and seals only after all initial GPU-upload ACKs
have drained and the counts agree. Appended coefficient slabs are independent of
the positions and appearance buffers transferred for GPU upload. `retainedBytes`
accounts retained coefficient bytes plus 32 bytes per reserved source-block slot
(24 bytes of epoch metadata arrays and one 8-byte slab reference); this is an
array-allocation estimate, not total JavaScript heap or browser RSS. The planner
still charges 80 bytes per admitted row because every retained coefficient stays
resident for later epochs. Cancellation/error releases the retained source
references. No raw element shards or object metadata are retained by this store.

Before reading per-shard metadata or orbital elements, the stream screens the
compact index using exact semi-major axis and orbit class plus conservative
outward intervals for its quantized eccentricity, inclination and absolute
magnitude fields. It propagates the eccentricity interval through `q = a(1-e)`
to screen perihelion ranges. A chunk is admitted when at least one eligible row
can match; source-precision binary values and metadata remain authoritative for
final filtering. This can avoid metadata and element-shard reads for chunks that
cannot match, but the compact index is still loaded and scanned. No throughput or
capacity gain has been measured from this prefilter.

## Bounded computation and ownership return

`propagatePreparedCatalogTile` shares the existing Float64 Kepler propagation
implementation but writes a selected source range starting at output row zero.
It does not allocate an output proportional to the full catalog. The original
whole-frame/range entry point retains its output indexing convention.

The store allows one epoch computation at a time. UTC is converted to TT through
the existing conversion; source epochs and mean motion keep their existing
two-body model. The store API and catalog worker use 1,024 rows per tile; API
callers can choose larger tiles up to 16,384 rows. Work yields after at most
256 rows and checks abort/supersession before publication.
The worker and renderer share a two-slot temporal tile window. While the main
thread uploads one Float64 tile, the worker may compute and transfer the next;
the renderer queues no more than two and applies them in source-row order. At
the worker's 1,024-row setting, two 3D transfer buffers total 48 KiB, 24 KiB
more than a single tile. The API's 16,384-row maximum would use 768 KiB for two
3D buffers; the worker does not request that size. Reuse receipts wait until
all prior tiles in their source block have been acknowledged, and a block
epoch is committed only after its complete tile range drains. A shorter final
tile may allocate a smaller buffer. The consumer must settle every callback on
cancellation so ownership cannot stall.

The repository's MPCORB publisher defaults to 5,000 records per binary shard,
so a full retained shard emits five 1,024-row tiles. If an upload remains
unacknowledged while the next tile is computed, both slots can be occupied. A
smaller shard may finish before filling the window. This makes overlap possible
in the default source profile; it is not evidence of a throughput increase.

This is not interpolation and introduces no new accuracy claim. A superseded
calculation can already have published earlier tiles, so the future consumer
must hide/invalidate a partial frame until one epoch is completely installed.
It must also invalidate spatial selections and context-restoration data for
that epoch. Neither mixed-time display nor a nominal target-date label on an
older frame is acceptable.

## Worker and GPU update contracts

An `epoch` request requires sealed retained sources, a valid UTC epoch and a
strictly increasing request ID. The worker keeps only the newest pending epoch
and serializes computation. It emits `epoch-start`, then `epoch-tile` messages,
and `epoch-done` only when all row uploads are acknowledged. Each `epoch-ack`
returns one transferred Float64 buffer with its matching request ID and start
row; wrong-sized or non-owned views fail that update. The ACK deadline is
30 seconds. Consumers must return even stale tiles without displaying them,
allowing a superseded compute to relinquish its lease. Cancel aborts the ACK
and discards pending work. Partial worker culling coordinates are ineligible
for selection until an entire latest epoch completes.

Completed `epoch-done` receipts also report worker timing diagnostics:
`propagation` covers the bounded Float64 row propagation and source-block traversal;
`cooperativeYield` covers time from each propagation slice ending until the worker
resumes after its cooperative message yield; `computeAndYield` retains their
combined interval for compatibility and accounts for surrounding slice bookkeeping,
`tileOwnershipWait` sums each transferred tile's time through main-thread upload
and buffer ACK, `tileRows` records the configured transfer size,
`peakUnacknowledgedTiles` records the actual concurrent tile high watermark
against the two-slot limit, `reuseAckWait` covers retained-position
acknowledgements, and `total` covers the worker update including planning and
evidence assembly. Ownership waits overlap, so their sum can exceed `total`.
These are diagnostic intervals, not GPU execution timers, physical-device FPS,
or an accuracy measure. The catalog tier benchmark remains fixed-epoch by default.
Its opt-in `--retain-epochs --epoch-seconds N` mode starts the real simulation
clock before opening the catalog, then records Worker start/tile/reuse/done/error
messages for a bounded `N`-second window. Completed, superseded, failed and
unfinished requests remain separate; it also records animation callback
intervals and upload-byte deltas during that window. This instrumentation has
not been run yet and makes no speedup, smoothness, or hardware-capacity claim.
It samples canvas phase, pending-selection state and renderer-selected point
rows at 100 ms intervals. A settled sample means the catalog phase is complete
or limited and no spatial selection is pending; it is not a physical-pixel or
device-presentation count. In all-points mode the submitted count can include
offscreen rows. Each sample also records the latest Julian-day target sent by
the workspace and the currently published uniform computed epoch, when
available. Their signed difference is simulation-time separation, not wall-clock
latency or orbital error. The workspace samples the live clock every five
seconds while playing, and a configured displacement-reuse budget may make a
nonzero separation intentional. The same sample captures the computed minimum
and maximum Julian days reported by block evidence, so mixed-epoch retained
blocks produce a target-to-range interval instead of disappearing from the
comparison. That interval remains simulation-time separation; the receipt keeps
the associated maximum displacement in AU as a separate quantity.

The fixed-capacity renderer now uses dynamic usage for its position buffer.
`beginPositionUpdate` clears the canvas, invalidates prior spatial selection
and starts a contiguous row replacement. `replacePositions` uploads only the
Float32 display positions into their existing GPU range; appearance attributes
are untouched. Draws remain blank until `finishPositionUpdate` confirms every
row and checks the GL error state. `invalidatePositions` leaves an interrupted
frame hidden; a new update can restart at row zero. No rollback or second full
GPU frame is implied. Context restoration still needs the consumer to refuse
replay of a partially replaced CPU snapshot.

## Canvas publication and user controls

The workspace offers a separate retention switch and an explicit 64–512 MiB
array/GPU budget. Changing either invalidates the source-load request and
recomputes admitted capacity. Static mode remains available. Retained mode
passes a changing target epoch separately from the fixed initial source epoch,
so a clock update does not recreate the worker or reload source shards.
Playback requests use the existing five-second clock sampling interval.

The canvas keeps only the latest desired time while one update is running.
Worker updates use 1,024-row transfer tiles, which split a full 5,000-row
MPCORB source block into five messages and let the two ACK slots overlap
compute with a slower upload. Computation still yields in 256-row slices. Each
main-thread callback converts a bounded slice directly from the transferred
Float64 tile into its existing Float32 CPU restoration range, then uploads that
same view. The frame-budget loop can consume multiple tiles in one animation
frame; the 1,024-row tile size is not a per-frame row limit. This removes the
intermediate Float32 scratch-to-cache copy; the tile's Float64 buffer is
returned only after the complete tile upload and GL check. Color categories,
size categories and row order are preserved. In
the streaming renderer, color channels use normalized 8-bit values (at most
0.5/255 absolute rounding per channel) and the three point sizes use exact
tenths in 8-bit values. Together they use 4 bytes per row on CPU and GPU instead
of 16, saving 24 planned bytes per admitted body; Float32 display positions and
Float64 orbital calculations are unchanged. No full new CPU output snapshot is
allocated.

During replacement the canvas hides both mixed coordinates and the computed
date label. Completion requires matching request/epoch/row counts and all
uploads; only then does it restore the date, invalidate spatial selections and
request new indices. The next desired epoch waits for matching selection and
two animation-frame callbacks, preventing a rapidly changing target from
superseding every complete frame before it can be presented. This is an event-
loop presentation opportunity, not proof of a physically displayed frame.

Cancellation or context loss during a partial epoch leaves the frame hidden;
recreating the GL context does not make the partial CPU snapshot coherent.
A new source load is required after that cancellation. Complete snapshots can
be restored using the retained CPU attributes. Stale transferred tiles are
returned without display. Temporal errors terminate the worker and keep a
partial frame hidden. These behaviors have received source inspection only.

This implementation publishes complete discrete epochs and deliberately blanks
during in-place replacement. It is not interpolated continuous animation. A
budgeted hierarchy/interpolation strategy, native integration, actual memory,
latency, throughput and device acceptance remain outstanding.

## Optional whole-snapshot temporal reuse

The initial stream computes the existing source-mean-motion periapsis speed
cap over exactly the selected, retained rows. It uses the original Float64
`a`, `e` and mean motion, before source shards are released, and aggregates the
maximum over accepted blocks. Empty or unsupported/overflowing bounds are null,
which disables reuse. The calculation is the same one used by the sample map:
`a * n * sqrt((1+e)/(1-e))`, with `n` converted to radians per TT day and its
existing floating-point padding. That padding is not a certified error bound.

The optional full-stream displacement budget defaults to zero. With a positive
budget, the canvas may keep an already complete snapshot only when the maximum
speed times the absolute TT interval to the requested UTC date fits the budget.
It keeps the original computed-date label and reports the model displacement
cap separately. Unknown bounds force computation. Changing the budget rechecks
the latest target without reloading source data. Cancellation or an outstanding
computation does not promise that the requested epoch is within budget.

This bound concerns temporal displacement within the unchanged two-body model;
it excludes physical orbit error, solver roundoff and Float32/GPU conversion.
It is a whole-snapshot policy: the fastest retained orbit sets the cadence for
all rows. If that inexpensive whole-frame check fails, a positive budget now
enables the source-block scheduling path below. Neither path interpolates
coordinates or has independent validation for this full-stream integration.

## Source-block scheduling metadata

The retained store now records one block for each nonempty selected source
shard: start/count (two Uint32 values), source speed cap and actual computed UTC
epoch (two Float64 values). The typed metadata consumes 24 bytes per admitted
source-block slot; the ordered slab-reference array adds 8 bytes per slot.
Empty shards do not consume a slot. Block speed caps use only that
block's original Float64 source rows and remain independent if another block's
cap is unknown. The original global cap remains available for whole-frame reuse.

`planEpoch` returns owned, bounded typed-array copies of row ranges, actual
epochs, displacement caps and reuse decisions, plus reused/recomputed row
counts. Its arrays consume 25 bytes per nonempty block; the 128-byte-per-shard
reservation covers resident metadata plus this planning snapshot. Unknown
epochs/caps use NaN internally and require computation, except an exactly
matching known epoch needs no displacement. This internal planning structure
is not yet a JSON evidence format and is not a GPU update command.

The existing full-epoch update invalidates all block epoch records before it
can publish a partial position prefix. Only complete acknowledged computation
marks every block with the new date. Cancellation/failure therefore cannot
leave mixed positions labeled with a reusable old block epoch. Plans are refused
during computation and cannot mutate the private metadata.

## Sparse source-block delivery

With a positive budget, the worker uses the block plan to either recompute a
source block or emit an `epoch-reuse` receipt containing its row range, actual
computed date and target-relative displacement cap. Reuse requires a matching
`epoch-reuse-ack`; it does not transfer positions. Position tiles may use both
bounded upload slots; reuse is sent only after that source block's position
ACKs drain. The reuse ACK has the same 30-second deadline and abort cleanup as
uploads.

A recomputed block's epoch is invalidated before its first output and committed
only after all its position tiles are acknowledged. An interrupted or superseded
block remains unknown; stale ownership-return ACKs do not establish publication.
Completed earlier blocks can retain their own actual dates. Zero-budget mode
keeps the original full-frame path with larger cross-block transfer tiles.

The canvas checks ordered contiguous coverage of both message kinds. Reuse
advances the GPU update cursor and CPU restoration cursor without writing
positions. It verifies the completed summary against observed recompute/reuse
counts, maximum reuse displacement and actual date range before enabling draw.
Mixed-date frames show the evaluated target separately from the actual computed
date range; they never receive a single computed-date label. Tightening a budget
can trigger refinement even when the requested target date has not changed.

This is a source-shard hierarchy, so the fastest object in a shard still sets
that block's cadence. It is not an object-wise motion hierarchy or interpolation.
All frames remain hidden during the in-place transaction. No execution,
cancellation, GPU, numerical or performance evidence has been collected for
this sparse path under the current test hold.

## Cached spatial block rejection

The worker now keeps a lazy AABB index over blocks of 1,024 rows in its existing
Float32 visual coordinates. Cached bounds use Float64, with a cached end-row
and dirty flag per block; the plan reserves `ceil(totalCount/1024) *
(dimensions*16 + 5)` bytes. This reservation uses the whole source count and
therefore also covers any smaller admitted capacity.

Camera selection first projects a complete block's bounds into the same
orthographic basis as the existing point selector. It can skip a block entirely
only when its outward-padded interval is outside one viewport axis. Boundary
and unusual normalization cases fall through to point selection. Retained
representative hashing, cell assignments, source-order output and visible-row
counting remain on the original point path. Padding is a visual arithmetic
policy, not a bound on physical orbit uncertainty.

Bounds are built only when queried and invalidated for initial appended rows
or recomputed epoch ranges. A reused temporal block does not invalidate its
unchanged coordinates. Partial visible prefixes use their exact end-row cache
key. The selector checks that its index belongs to the same position array and
dimension. Each changed spatial view is posted immediately, including while a
selection is active. The worker invalidates the active generation at the next
cooperative yield and retains only the newest pending view. Switching to the
all-points view sends an explicit cancellation. A stale completed selection is
not published.

Selection receipts report point-screened and block-skipped row counts, whose
sum must match the considered rows. The UI shows them only after the matching
selection completes. They are work counters, not FPS or speedup measurements:
building a cold bound still visits its source rows, and broad overlapping bounds
can provide little benefit. No reference equivalence or performance execution
has been done under the testing hold. This index does not justify skipping or
prioritizing uncomputed downloads from the source catalog.

When a spatial snapshot exceeds its individual-point limit, a second, bounded
screen-cell layer now counts every source row inside the mathematical viewport.
It uses at most 65,536 equal-area cells in the same orthographic projected view;
each in-view row, including a focused or selected row, increments exactly one
cell. Rows admitted only by the numerical clip margin are excluded. A translucent
log-count color overlay sits above the unchanged exact-position representatives,
so dense cells carry population information while isolated points remain
uncovered by the overlay. The receipt reconciles the count sum to
`visible - edgeCandidates` and reports occupied cells and grid dimensions.

These are projected screen-bin counts, not depth-normalized 3D physical density,
a statistical sample, probability or event rate. The stream plan reserves up to
12 bytes per cell for the worker `Uint32` grid, main-thread image data and bounded
canvas backing; the 65,536-cell ceiling keeps this independent of source-row
count. The stream benchmark now samples overlay rows, occupied cells, maximum
bin count and the exact in-viewport denominator during playback, so later
measurement can check count coverage alongside selected GPU rows. This is a
representation change, not a claim that more individual coordinates became
pixel-resolvable or that rendering became faster. No tests, builds, benchmarks
or device runs were performed for this change.

## Cooperative selection output

Temporal displacement uses the larger of two TT intervals: the direct UTC
difference plus the frozen leap-table difference, and the difference between
rounded absolute TT dates consumed by propagation. This avoids relying solely
on subtraction after adding small offsets to large Julian dates. A small outward
arithmetic allowance is applied; nonrepresentable positive displacement disables
reuse, and even equal dates must lie in the supported UTC domain. The model
still holds the last known leap value for unknown future leaps and cannot encode
a leap-second UTC label. These are model-time assumptions, not a physical orbit
error bound; no numerical boundary checks have run under the testing hold.

The two-frame pause before following the latest target epoch now captures both
view and epoch identities. Camera/viewport changes and WebGL context loss cancel
the pending presentation callback while preserving the requirement to present
the replacement view. Both animation-frame callbacks check current identity,
coherent coordinates and an available renderer. If drawing a completed selection
discovers a newer view, that old response cannot clear the newer pending status
or schedule the next epoch. These race-handling changes remain unexecuted.

The final representative collection no longer performs a synchronous sort of
up to 500,000 indices. It marks winners in a Uint32 membership bitmap, then
enumerates set bits in source order. The planner explicitly reserves
`ceil(totalCount/32) * 4` additional bytes; actual scratch uses the considered
prefix. Representatives, tie-breaking and blending order are unchanged by the
intended algorithm, but equivalence has not been exercised yet.

Collection yields every 16,384 cells and enumeration every 512 words (at most
16,384 source rows). Both check cancellation, including before publication.
Point-screening slices now align with sixteen 1,024-row spatial blocks, avoiding
the former 20,000-row boundary's repeated fallback to individual screening.
Radius, aspect and cell budget are captured once so a yielding selection cannot
mix different caller views. No latency or throughput improvement is claimed
without deferred execution evidence.

## Upload liveness and decoding failures

The prefetch queue is now replenished when a completed shard becomes the single
compute input, so the next download can overlap cooperative validation and orbit
work. It still holds at most four prefetched shards; upload backpressure retains
its separate four-credit limit. If the remaining row capacity could fit in the
current shard, replenishment waits until exact filtering proves another shard is
needed. Duplicate enqueue attempts are ignored and queue capacity is checked.
The plan spells out read/hash, current-compute and transferred-tile allocations
and keeps the older, larger per-shard scratch reservation as headroom. This is
bounded prefetch, not four simultaneous orbit solvers or measured throughput.

Initial worker computation now cooperates before upload as well. Complete source
validation runs in 4,096-row ranges, exact filtering yields every 2,048 rows, and
preparation, speed-cap accumulation and Float64 Kepler propagation share 256-row
ranges. Cancellation is checked around every yield. The worker supplies its
existing MessageChannel scheduler; callers without one use a task-queue fallback.
Prepared retention and the upload callback receive only a fully computed shard.
The same validation/preparation/propagation kernels are used, with unchanged
source order and one per-shard output allocation. Scheduling overhead, numerical
equivalence and cancellation responsiveness have not been measured.

Temporal replacement tiles also use the shared 4,096-row upload slice and 3 ms
between-slice budget. A received Float64 tile (at most 16,384 rows) remains owned
by the canvas across animation frames; each slice updates GPU positions and its
matching CPU restoration range. The original Float64 buffer is returned only
after the last slice. Reuse/done messages cannot pass a still-pending tile, and
cancellation clears the slice cursor while keeping the incomplete epoch hidden.
Initial loading, temporal updates and context restoration share their scheduling
constants. These changes do not alter scientific Float64 propagation or increase
the existing one-tile temporal transfer window; runtime behavior is unverified.

Initial source tiles are now converted and appended in at most 4,096-row
slices, with a 3 ms between-slice scheduling budget. The active source tile
stays at the head of the existing four-credit queue until its final slice is
uploaded; only then is its ACK emitted after GPU error checks and drawing.
The displayed row prefix advances as slices arrive. Cancellation drops the
unuploaded remainder and leaves only the completed CPU/GPU prefix. CPU recovery
attributes are stored per uploaded slice, while temporal updates keep their
existing contiguous row cursor across those slices. This does not create a
second full position snapshot. One driver call or conversion slice may exceed
the scheduling budget; throughput and cancellation latency remain unmeasured.

Context restoration uploads the existing CPU snapshot through zero-copy
subarray views in chunks of at most 4,096 rows. Each animation frame checks a
3 ms budget between chunks, reports progress and permits cancellation. Drawing,
spatial-result installation and new temporal requests are suspended until the
entire GPU attribute snapshot has been reconstructed. Completed reconstruction
invalidates the old view and requests fresh spatial representatives. An
incoherent CPU snapshot remains hidden after reconstruction.

Cancellation, a second context loss, failure and component teardown invalidate
the restoration generation and cancel its scheduled frame. Partial GPU resources
are disposed; callbacks also require their original renderer identity. No second
full CPU snapshot is allocated. Shader setup, full-capacity GPU allocation and
individual driver calls are still synchronous; 3 ms is a between-chunk budget,
not a worst-case frame bound. Restoration has not been exercised under the
current testing hold.

Initial snapshot tiles now have a 30-second upload-ACK deadline as well as the
existing four-credit bound. Expiry records one terminal error and resolves all
credit waiters so publish/drain can throw it without unobserved rejected tile
promises. ACK, abort and disposal clear timers. This is a fail-closed deadline,
not a throughput guarantee; suspended/background consumers can time out.

The worker rechecks cancellation after the final initial ACK before sealing
retained epochs. Message-decoding failures abort admitted work, settle epoch
ACK listeners and invalidate pending selections. The canvas handles such
errors even after initial loading, while late general errors do not replace
an explicit cancellation. These lifecycle changes remain source-reviewed only.

No numerical, capacity, latency, FPS, cancellation or browser claims are made
for these changes. All final-stage testing and submission remain deferred.

## Exported per-block epoch evidence

Streaming owns a copy of its manifest and filters and captures option scalars
and callback identities before its first await. Search locators are consumed
into the existing private candidate bitset before yielding, avoiding a second
catalog-sized locator copy. Each temporal computation similarly captures its
epoch, budget and callbacks once. Abort signals and supersession callbacks stay
live, but replacing caller option fields cannot change the source selection or
relabel output during asynchronous work. Mutation behavior has not been executed
under the validation hold.

Completed temporal updates include packed Float64 records with four columns:
uploaded start row, row count, actual UTC computation epoch and model displacement
to the evaluated target. The array transfers once to the canvas, which verifies
contiguous coverage, count, date range and maximum drift against the upload
receipts before publishing it. The per-source-shard reservation is now 128 bytes
to cover retained metadata, planning and result arrays.

The schema-3 export encodes this table as little-endian Float64 Base64 and includes
the evaluated target/budget, source manifest and
filters, load priority, admitted capacity and current requested/view settings.
Uploaded row ranges are not object IDs or an exported scientific position table.
Current requested time remains distinct from the completed evaluated target;
no current-view completion or physical accuracy is inferred. Export and receipt
validation have not been executed under the testing hold.

Static and retained streams preserve source shard IDs and the hashes checked
against their downloaded bytes, plus an LSB-first bitmask of admitted original
rows in each shard. Shards stay in upload order, with selected rows ascending
within each shard, so this mapping accounts for priority scheduling, filters and
capacity truncation. The canvas checks mask lengths/padding, shard uniqueness,
selected counts and their correspondence to each temporal block. Export includes
the compact-index hash and these masks. Bounded source metadata is now read for
exact magnitude and name filtering; names are not retained in the epoch store
or exported as an object catalog. The checksum descriptor is bound to the
manifest content hash; this consistency does not authenticate the publisher.
The stream plan adds space for three simultaneous bitmap copies (including
per-shard rounding), and a 2048-byte per-source-shard evidence allowance on top
of the 128-byte temporal reservation. These are allocation estimates, not RSS
measurements. Mapping and export behavior remain unexecuted.

## Focused source-row retention

The catalog workspace forwards a focused record only when it has an explicit
source chunk/row locator from the current records. After a completed load, the
canvas resolves that locator through checked source masks in actual upload order.
Focus changes invalidate only spatial selection, without reloading the source or
recomputing orbital positions. A visible focused row gets the first reserved draw slot; visible mapped selections
follow in selection order. Ordinary representatives use the remaining cell budget
with their previous hashing. Multiple selected bodies may share a projected cell
without displacing one another.
This works for static and temporally retained streams, with source-map storage
now admitted in both budgets. Exports preserve focused source/row context.

The UI distinguishes a confirmed uploaded row from an unavailable mapping. It
does not move an offscreen body into the viewport, bypass source filters/capacity,
or load an absent focus. Records without source locators cannot be mapped by
name guessing. The workspace admits at most 256 explicitly located selections from its current
records. Batch mapping scans source masks once per group, rather than once per
selected body. UI/export state shows located versus loaded selections and the
budget ordering. Full-source selection scopes, absent-body priority admission
and selections without current record locators remain unfinished. The new
focus/multi-selection path has not been run under the test hold.

## Explicit focused/selected shard priority

An opt-in workspace control snapshots up to 256 current-source locators when
loading or refreshing, focus first and then selection order. The loader validates
and owns this list, promotes its already-admitted shards in stable first-seen
order, and preserves the chosen source/NEO/PHA ordering for other shards. Exact
filters, in-shard source order, capacity and fetch/upload budgets still apply.
Changing focus during a run changes representatives only; another refresh is
needed to adopt a different loading priority list. Exports retain that fixed list.

Before ordinary loading, priority shards are read sequentially to resolve exact
priority-row eligibility against checksum-bound metadata and Float64 elements.
The same index/source binding and source filters apply to preflight and loading.
Only one metadata/element shard is held during preflight, before binary prefetch
starts; at most 256 eligible row identities survive it. Matching priority rows
reserve slots globally, following the fixed list with duplicate rows removed.
When eligible priority rows exceed capacity, the first capacity entries win.
Preflight stops early once a fully resolved prefix of that list fills capacity.
It does not stop merely because grouped shard reads have found enough matches:
an unresolved earlier locator may outrank a match in an already-read shard.
The main scan still validates and emits selected rows in ascending source order,
so existing masks, uploaded-row lookup and temporal block identity remain valid.
Skipped ordinary matches keep the result incomplete even when the final shard
fits exactly. Earlier ordinary rows cannot consume later reserved slots.
Preflight does not populate upload/coverage counters: its priority shards are
read again during loading, with the same hashes required. This adds network and
decode work and can delay first-visible time; it is not a throughput claim.
A selected body excluded by filters, beyond priority capacity, without
a known locator, or outside the bounded list is not guaranteed admission. Automatic incremental loading of
new selections and complete source-scope retention remain unfinished. No runtime
ordering, coverage or performance evidence has been collected for this path.

## GPU allocation failures

The shared renderer checks context loss and GPU error state after initialization.
Ordinary snapshot uploads reject nonfinite Float32 attributes and check GPU error
state once after changed attributes upload, before caching their array identities.
The ordinary canvas already catches these failures, disposes its renderer and
shows its unavailable message while the catalog table remains accessible. Existing
streaming batch checks still cover sliced uploads; no additional per-slice GPU
error query was introduced. Unchanged snapshot camera redraws reuse the checked
attributes without new scans or upload checks. These paths have not been run;
this is not a demonstrated fallback, recovery or performance result.

Ordinary snapshot failures now expose a localized manual retry. A retry disposes
any previous renderer, rebuilds GPU resources and uploads the latest frame ref;
it does not trigger source loading or silently retry in a loop. Context-restored
events use the same path. The unavailable overlay clears only after the current
frame upload/draw call returns successfully. Failed canvases are hidden visually
and from the accessibility tree while retaining layout dimensions for recovery.
Unmount clears the retry callback and suppresses queued state reports. This
recovery path remains source-reviewed only.

Stream refresh remounts the canvas and disposes the prior worker/resources; late
messages are guarded by the prior effect lifetime. Synchronous worker creation
and start-message failures now enter the terminal handler without preventing
effect cleanup registration. If an explicit cancel message cannot be posted,
the channel is terminated and local cancellation still completes. These failure
paths remain unexecuted under the implementation-only hold.

## Detail hydration lifetime (implementation awaiting verification)

Search-page and ID-based detail hydration now use the same four-consumer
bounded queue as source-locator hydration. Network acquisition limits alone
did not prevent Promise.all from retaining every decoded shard until the entire
request finished. Each consumer now extracts only requested records before
advancing; output ordering is reconstructed from the original requested IDs,
search entries or locator offsets. Existing decoded LRU bounds remain in force.
Lookup-bucket hydration uses the same queue and no longer expands filtered
entries into a potentially large function argument list.

Cancellation and first failure abort sibling consumers and stop queue admission.
A task yield between items lets cancellation/input events run even when every
read hits a resolved cache entry. These are per-call concurrency and retention
bounds, not process-wide byte/RSS guarantees; requested output size, concurrent
callers and decoded object sizes still matter. No benchmark, test or runtime
acceptance has been performed for these changes.

## Failed GPU generations

A failed stream generation now terminates its worker, releases the renderer and
its CPU restoration attributes, drops scratch/epoch/source-selection state and
reports no displayed rows. Uploads can fail after partially replacing GPU
attributes, so failure no longer keeps that frame available for redraw. A later
context-restored event cannot revive a failed generation. The explicit reload
control starts a new effect generation using the same selected source/filter
and resource budget; normal effect cleanup releases the previous listeners and
callbacks first. User cancellation still retains a coherent partial snapshot.
Renderer disposal drops the active selection count and releases its GPU element
buffer; selection indices are not retained on the CPU after upload.
These ownership paths are source-reviewed only, without device, context-loss or
GPU-allocation-failure execution under the current test hold.

## Initial source-tile buffer return

After every initial tile slice is converted and uploaded successfully, the main
thread transfers its Float64 coordinate buffer back with that tile ACK. The
worker binds returned length/whole-buffer ownership to a pending tile ID before
returning its upload credit. Unknown or duplicate IDs cannot populate the pool;
malformed matching returns fail the stream. Bare ACKs remain accepted without
recycling. Appearance bytes are not pooled.

The worker keeps at most one returned coordinate buffer. The next shard consumes
it only at the same element count; a mismatched size is dropped. Every retained
coordinate is overwritten before reuse/publication. Completion, cancellation,
decode failure and stream failure clear the pool and outstanding identities.
The capacity formula explicitly reserves one additional worst-case Float64 xyz
shard; existing larger pipeline headroom still covers that reservation. This
reduces potential allocation churn, but no runtime or allocation measurement has
been performed under the current testing hold.

## Viewport edge screening

Spatial selection now uses one outward Float32 display margin for both pinned
and ordinary rows. The margin includes absolute projected term magnitudes so
rotation cancellation does not suppress the allowance. Block rejection uses
the same policy with additional outward headroom. Previously its allowance
only covered double-precision CPU rounding, while shader uniforms and display
operations use Float32. The screen helper reuses scalar scratch instead of
allocating an object for every candidate.

Admitted points just outside the mathematical viewport occupy an edge cell;
their actual uploaded coordinates remain unchanged and are clipped by the GPU.
The reported visible count includes this display-screening allowance. This
64-times-Float32-epsilon policy is not a certified device error bound, scientific
position uncertainty or angular precision claim. No GPU/device or boundary
reference run has been performed for this change.

The streamed body's coordinates are heliocentric ecliptic AU, and the 2D/3D
catalog camera currently only zooms and rotates around the Sun; it has no
translated camera origin. Orbital propagation remains Float64 until these
coordinates are rounded into the Float32 culling and vertex buffers. The 3D
projection then rotates those Float32 values, so large depth-axis terms that
cancel in the screen plane retain Float32 input error. The outward margin
covers conservative viewport arithmetic around the coordinates actually
stored; it does not restore Float64-to-Float32 coordinate detail or certify a
physical position/angle bound. Camera-relative rebasing would only have a
defined new target if the view gains translation or an explicit non-Sun center,
and would need its own admission and error evidence.

## Selection count semantics

The spatial result now separates edgeCandidates (admitted only by the numerical
margin) from the existing total viewport-candidate count. Worker replies carry
both; the main thread rejects noninteger, negative or inconsistent values.
UI text calls the draw count submitted points, rather than actual visible
points, and labels candidate counts as including the edge allowance. Pinned
focus/selection priority is stated separately from grid representatives.

Temporal/source exports retain selectionPending, suppress current counts while
a newer selection is pending, and record submitted/candidate/edge/work counts
with the viewport policy. These are selection and submission evidence, not GPU
pixel visibility, object density or a physical error estimate. Source and
format checks only; UI, protocol and export execution remain unverified.

Within an unpinned screen cell, a point inside the mathematical viewport now
takes priority over a point admitted only by the edge allowance. The stable
source-row hash breaks ties within each tier. Explicit focus/selection pins
retain their separate priority. This prevents an allowance-only point that the
GPU may clip from displacing an interior representative. A byte per cell records
the winning tier; capacity planning reserves one extra byte per admitted row.
The grid budget is capped by both the requested display limit and loaded row
count before subtracting distinct visible pins. Thus a large display limit
cannot allocate more grid scratch than the admitted snapshot supports. This
can change the visual grid resolution for small snapshots; it does not promise
one representative for every body, including bodies sharing a projected cell.
The temporal/source export records this representative policy. No boundary or
GPU execution has yet established rendered behavior.

### Cooperative spatial-selection scheduling

Spatial selection retains its fixed maximum batch yields and additionally
checks a 4 ms elapsed-work policy at bounded checkpoints: 1024 source rows or
representative cells, and 32 membership words during source-order assembly.
Slow projection or bound rebuilding can therefore yield before a full 16k-row
batch. Cancellation is rechecked immediately after each yield. Selection rules
and scientific state arrays are unchanged, and no catalog-sized storage was
added. The policy is not a measured latency guarantee: a checkpoint includes
bounded synchronous work and task scheduling can add delay. Benchmarks and
result-equivalence execution have not run for this change.

### Optional persistence backpressure

Validated immutable artifact caching uses one active write and at most four
waiting writes, with a combined 64 MiB retained-buffer limit per JavaScript
realm. A URL already active or waiting does not enqueue another write. The
reservation spans quota checks and transaction completion. Saturation skips
optional persistence while continuing normal validated delivery; it does not
drop requested rows. This budget excludes IndexedDB internal copies, decoded
consumer objects and other realms, and is not a whole-browser memory bound.
These source changes have not been exercised with IndexedDB or benchmarks.

Catalog acquisition admission now caps waiting requests at 32 per realm with
a 15-second wait deadline, in addition to four active acquisitions. The FIFO
queue rejects overload before retaining a waiter, removes cancelled/expired
entries, and rechecks deadlines at grant time. A delayed timer cannot grant
an expired request, although a suspended event loop can delay notification.
These limits do not bound active request completion or aggregate multiple
workers/tabs. Active cancellation and release still belong to the caller.
The new admission paths have been source-reviewed only.

Decoded catalog search/lookup/chunk/sample caches freeze record arrays and
their scalar-field records once before publication. Summary objects also
freeze category counts and nested numeric-range arrays/maps. Consumers share
these read-only runtime objects and must copy before editing. This avoids
per-hit shard cloning; it does not bound total process memory or authenticate
source values. Runtime compatibility and throughput have not been verified
for this source-only change.

Catalog-loader operations capture a manifest snapshot before asynchronous
reads. Explicit release paths are retained; absent paths use the legacy data
root, never another active release. Decoded cache keys include declared version,
source/content hash and transport format/capabilities. These keys isolate
interpretations but do not verify payload authenticity or replace transport
cache identity. Manifest results and paging cursors have separate ownership.
This source-only change awaits compatibility/race acceptance.

Transport format validators receive a private buffer before validation, keeping
shared in-flight and deferred-persistence bytes isolated from callback writes
or transfer. Detachment/resizing rejects the result. Persisted records must
match the release identity derived from their URL and fit the artifact size
limit; unversioned raw-buffer records are reacquired instead of relabelled.
This is ownership/identity checking, not source authentication or proof that
a mutable URL still serves the same content. Runtime acceptance is pending.

Optional persistence phases (open, quota estimate, transaction) use 1500 ms
event-loop deadlines. Timeout/abort attempts to abort unfinished transactions,
closes connections and suppresses late read/cursor callbacks. A cancelled
acquisition stops waiting for shared preparation, which retains its own
phase limits for other callers. This does not prove browser-internal abort
completion, total memory release or hard wall-clock limits under suspension.
These changes await runtime acceptance.

Acquisition has a 60-second deadline after admission; consumer validation has
a separate 30-second deadline. Acquisition abort keeps its lease until the
transport settles. Validation timeout stops waiting and cancels cooperative
gzip expansion without evicting a shared artifact as corrupt. Public validators
still receive exactly one buffer argument. Custom validators that ignore
cancellation and synchronous parsing cannot be forcibly preempted. These
source-level policies await runtime acceptance.

## Evidence JSON schema 3

Schema 3 keeps source-screening and temporal calculation identifiers but
encodes selectedRows and blockEpochs as objects containing encoding: base64,
elementType, length, byteLength and data. Epoch objects additionally declare
byteOrder: little-endian. Decode selectedRows as uint8 bitmap bytes, keeping
the existing least-significant-bit-first row convention. Decode blockEpochs
as little-endian Float64 and group four elements per documented blockLayout.
The length is an element count; byteLength is the decoded byte count. Empty
arrays use an empty data string. A null epoch still means no temporal receipt.

Encoding uses 24 KiB blocks and rejects individual evidence arrays above
8 MiB. Only the last Base64 block may carry padding. These are serialization
limits, not a browser heap guarantee: final strings, receipt objects and Blob
storage coexist outside the rendering allocation estimate. Consumers of the
older numeric-array schemas must explicitly handle schema 3.

The repository currently has no importer for these two exported calculation
identifiers. Internal worker messages still use typed arrays; they do not parse
the exported Base64 objects. The schema change applies at the JSON export boundary.
No compatibility with external readers has been exercised.

A reader must select the representation using schemaVersion, not the calculation
identifier: the computation identifier remains unchanged when only serialization
changes. Schemas 1 and 2 used numeric arrays; schema 3 uses the encoding objects.
Reject unknown schema versions and inconsistent elementType, byteOrder, element
counts or decoded byte counts before interpreting values. Epoch byte counts must
equal eight times the element count, and element counts must be divisible by four.
Bitmap padding and population must agree with shard rows and uploaded selection;
decoding alone is not source-hash verification or scientific acceptance.

## Native tile working-space admission

Android and iOS preserve ordinal result order while loading up to two adjacent
state tiles concurrently when their combined transient allowance fits the
remaining 1536 MiB native-state budget; otherwise they fall back to one tile at
a time. Before reading a cache entry or downloading a tile, each requires an
allowance of four times the 64 MiB tile ceiling, 1024 bytes per declared row and
8 MiB of scratch. A failed check stops the load without publishing a partial
frame. Transient allowance is checked against retained storage for the current
batch, not accumulated as permanent resident storage.

These factors are conservative admission policy, not measured peak allocations
or a proven heap upper bound. They can reject a small actual response when the
remaining budget cannot accommodate the permitted tile ceiling. Input IDs,
runtime overhead, renderer memory and concurrent application work are not covered
by a process-wide cap. No hardware capacity, cancellation latency or performance
acceptance follows from this source-level policy; runtime measurement is pending.
