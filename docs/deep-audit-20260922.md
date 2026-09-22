# Solar Atlas follow-up audit — 2026-09-22

This pass follows the [initial audit](./audit-20260922.md), based on main commit `6c1635d48f1c1497372802c4c207f196832f1a5f`. The owner explicitly paused actual deployment and release. Both **Deploy application** and **Publish asteroid dataset** were manually disabled and verified as `disabled_manually`. Quality checks remain active. This work changes source and tests; it does not publish an application or dataset release.

The owner subsequently requested direct main updates without new PRs, and focused validation during repeated review passes. The existing main rule requires the quality status but does not require a PR. The quality workflow now also runs on `codex/*` staging pushes against their merge base with main; a passing exact commit can fast-forward main without removing protection. Existing PR and dataset-automation paths keep their checks.

## Repairs

| Area | Observed problem | Result |
| --- | --- | --- |
| Dataset identity | A search or provenance request could begin on one release and use another release after an awaited fetch. Explicit locator/page manifests did not control all shard loads. | Bind roots, compression capabilities, provenance fallback and all dependent shard loads to the captured manifest. Test a real interleaving of two manifest requests. Empty reverse pagination performs no shard fetch. |
| Lookup recovery and memory | Failed ID lookups were cached as empty results; lookup promises and worker compact indexes had no entry limit. Group construction repeatedly copied growing arrays. | Evict failed promises, preserve requested ID order, bound lookup buckets to eight and worker indexes to two, and append to groups in linear time. |
| Catalog transport | Whole response and gzip expansion allocations were unbounded; the gzip path accepted malformed UTF-8. | Stream and bound wire/decompressed artifacts at 64 MiB, cancel overflows, require valid UTF-8, and permit retry after rejection. |
| Catalog worker | Fallback scans requested plain metadata even for gzip-only releases; invalid binary orbital elements could become apparent zero matches. Downloads could finish after cancellation and still emit progress. | Honor the pinned manifest's gzip capability, share orbital validation, reject malformed compact-index contracts, and stop after cancellation. Remove the growing set of historical cancel IDs. |
| Runtime registries | The shared scientific-data JavaScript chunk was larger than the build warning threshold. | Build-time lossless key/string dictionaries for three repetitive registries. Complete round-trip equality tests preserve source fields, order, numeric values and identity. Original JSON, SPKs, source hashes and scientific tolerances are untouched. Enforce a 600 KiB emitted JavaScript chunk limit; scientific workers retain their tighter 512 KiB limit. |
| Event sampling | Pairwise absolute-rate differences could never exceed the already computed maximum, but were evaluated on every plan construction. Large array spreading could overflow the argument stack. | One linear pass with identical valid-input sampling semantics; a 150,000-body regression. Reject non-finite windows/rates and invalid sample counts. |
| Mission and trajectory helpers | NaN/fractional grid dimensions could produce empty or extrapolated "completed" grids. A synchronous trajectory helper cached mutable transferable data by rounded epoch and body IDs only. | Validate grid inputs before computation; remove the helper's unsafe cache. Test exact epoch differences, replacement metadata, body order and detached buffers. Production worker sampling retains its existing source/time contracts. |
| Android transport | Geometrically grown download buffers were copied again; declared Content-Length was not required to match actual bytes; weak/unquoted ETags were accepted. | Allocate one exact-length raw buffer, reject truncation/overflow, require a strong quoted payload ETag, and check cancellation during transfer and before returning a frame. Optional disk-read failure can fall back to verified network data. Bound cached reads using the opened file's size and avoid writing entries larger than the configured cache budget. |
| Go inventory | Repeated IDs repeatedly normalized, indexed and copied the same source record. Cancelled misses could return success before reaching a disk-read cancellation check. | Deduplicate normalized query IDs before index resolution, preserve original returned row bytes/ordinals, skip alias-only postings for direct lookup, and check cancellation at entry and during batches. |
| Validation tooling | ESLint traversed generated browser/data outputs and could fail when Playwright replaced a directory concurrently. The cache browser harness assumed a module without imports. | Ignore only generated output directories and load the real bounded-stream dependency in the IndexedDB harness; preserve all storage assertions. |

## Measurements and reproduction

Measurements below are local Windows / Intel Core i9-14900KF results, not device frame-rate or public-service throughput claims.

| Measurement | Before | After |
| --- | ---: | ---: |
| Shared scientific registry chunk, minified bytes | 872,664 | 478,097 (45.2% smaller) |
| Largest emitted JS chunk after compaction | 872,664 | 559,335 (Three.js renderer) |
| `GetMany`: 32,768 repeated IDs, median of three final benchmark runs | 7,511,600 ns/op | 209,630 ns/op |
| Same repeated-ID benchmark allocation | 7,886,534 B/op; 65,704 allocations | 1,120 B/op; 20 allocations |
| 32,768 distinct IDs, grouped query allocation | 35,773,075 B/op; 396,105 allocations | 33,499,329 B/op; 363,338 allocations |

Run `npm run benchmark:runtime-json` and `go test ./internal/inventory -run '^$' -bench 'BenchmarkGetManyRepeatedIDs|BenchmarkGetManyVsIndividualGet/32768/grouped' -benchmem -count 3`. The baseline used the original main inventory implementation through Go's file overlay, without replacing workspace code. Duplicate-input timing varied from 3.2–10 ms before and 0.204–0.243 ms after with desktop load; allocation counts are more stable than these wall-clock timings. The distinct-ID grouped workload retained original bytes/ordinals, reduced allocations, and measured 33–34 ms/op in the final run; this is not a production-throughput claim.

The registry representation has a measured decoding tradeoff: median JSON parse plus unpack was 0.915 ms for body seeds, 0.666 ms for satellite identities and 0.526 ms for the full runtime manifest, versus 0.569, 0.388 and 0.312 ms for plain JSON parse. Gzip savings are much smaller than minified-JavaScript savings; the standalone full manifest grows by 87 compressed bytes. The benefit is smaller source/parse input and worker bundles, not an asserted universal speedup. Full-document round trips are checked before benchmarking.

## Verification

- Web CI: lint, 652 passing unit tests with 9 conditional skips, 161/161 scientific tests, TypeScript and production artifact validation passed. Live/golden fixtures are separately enabled below rather than treating conditional skips as evidence.
- Go: all `cmd`/`internal` tests and `go vet` passed; npm audit and pinned govulncheck found zero vulnerabilities.
- Android JVM protocol suite: 43 cases ran with the Go-generated tile fixture configured (one separate optional coverage fixture was not configured). Web decoded the same fixture and matched its Float64 evidence. Platform compilation, lint and simulator/emulator checks are separate CI gates.
- Original-SPK backend: three live Go-to-Web tile/history tests passed against the preserved 670-file staging profile. Three inventory/coverage-dependent cases were skipped because this local backend has no staged inventory; this is not inventory acceptance evidence.
- Browser matrix: 375 passed with 9 explicit conditional skips across desktop/mobile Chromium, Firefox and WebKit. The curated real-data preview passed all 18 tests. Two further desktop/mobile tests rendered real Go SPK responses. An intermittent WebKit fixture counted cancelled delayed requests as active backend work; its cancellation lifetime now matches the request and the same two-response peak assertion remains unchanged.
- Focused repository/dataset-automation checks: 32 passed, including staging-push classification and preservation of the required summary graph. Exact-head remote CI is checked before the protected direct push; no new PR is required.
- Historical queue: all 47 issues and 133 PRs were inventoried; 130 merge commits are on main and all three unmerged closed PRs have verified superseding changes. The [contribution audit](./contribution-audit-20260922.md) records current scope and deliberately unfinished acceptance instead of equating closed status with full delivery.

Local bundle inventories, logs and the generated protocol fixture are retained under ignored `.cache/deep-audit-20260922/`. Existing original-SPK staging and immutable data under `.cache/audit-20260922/` are preserved.

## Audit coverage and boundaries

The pass inspected catalog generation/loading/search, worker lifecycle, IndexedDB delivery, scientific sampling and mission helpers, Vite main/worker artifacts, native tile/cache/plan contracts, Go inventory and shared computation/scheduling, repository/security gates, browser accessibility and product-direction documentation. Existing source provenance, missing-state semantics, exact/approximate separation, bounded current-state/trail display and native independence remain requirements.

The iOS transfer already bounds Content-Length, rejects redirects and validates strong ETags; its retry comment was corrected to describe transport-only retries. This pass does not claim a new iOS checksum-retry feature. Existing backend queue/single-flight/state-window safeguards remain covered by their cancellation and race tests.

Public deployment, production recovery/load acceptance, signed/store releases, physical devices, complete offline recovery and full native feature parity are not completed by this audit. Heavy analysis migration to Go and broader original-source coverage remain substantial future work. The prior oversized shared-chunk finding is resolved here; future delivery milestones are not silently closed.
