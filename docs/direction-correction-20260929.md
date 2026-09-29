# Direction correction and submission receipt — 2026-09-29

This batch fixes the five issues from the direction review. It also collects
the preceding uncommitted scientific, data, Web and native changes into version
control. Collection is not certification of every historical research proposal.

## User-visible changes

1. Full Web can compute a filtered 100k, 500k or memory-admitted full MPC catalog
   in the existing Observation Deck, using the same 2D/3D camera, reference frame
   and time controls. The Catalog workspace has a direct entry into that scene.
   Stopping returns to the immutable display sample. Picking resolves only the
   selected row's metadata instead of materializing a million body objects.
2. Computed rows, primary draw count, capacity, completed UTC epoch and requested
   time lag are reported separately. Missing reference/Sun states suppress the
   cloud and its reported draw count. Adaptive sampling receives the actual
   admitted primary draw count. Memory planning includes scene and worker storage.
3. Cassini and MESSENGER preparation validate their own centers. MESSENGER also
   requires a continuous requested source arc; a Cassini center is not accepted.
4. Optional comet/MESSENGER evidence mounts only when expanded, and scientific
   labs load as separate chunks. This resolved the 600 KiB evidence chunk-budget
   failure discovered by the production build.
5. The 13,041-line goal ledger and 7,360-line pending-validation ledger are retained
   byte for byte in dated historical documents. The active tracker is finite and
   distinguishes implemented behavior, scoped checks and remaining evidence.

## Additional defects found during acceptance

- Real pinned MPC data contains 42 legacy H=99.99 values. The loader normalized
  metadata before checking immutable index identity and rejected that release.
  It now compares raw source bytes/values first and applies the existing unknown-H
  interpretation in filtering. Tests cover acceptance, known/unknown filtering,
  and rejection of a genuine metadata mismatch; the release is unchanged.
- A full-catalog playback attempt did not complete one epoch within 30 seconds.
  Worker receipts showed progress to row 1,496,064, disproving a deadlock. Tiny
  transport batches and unconditional 256-row message yields dominated that path.
  Temporal error blocks remain 1,024 rows; transfer batches are now 8,192 rows,
  with two ownership slots and an explicit memory reserve. Worker scheduling
  yields after roughly 4 ms, while retaining bounded propagation/cancellation
  checks. Browser measurements below must be read independently of this diagnosis.
- TypeScript and Go compilation defects in the accumulated changes were repaired,
  including typed buffer unions, source-field names, receipt metadata, protocol
  offsets and evaluation provenance. The dynamics producer now emits the matrix
  arithmetic identifier required by its verifier.
- Gaia batch UI renders immutable receipt snapshots. The missing-RV assumption
  is explicitly zero radial velocity at the source epoch; target-epoch radial
  velocity can change with perspective. Batch checks compare the same adopted
  initial state with the single-source propagator. See the
  [ERFA source/target epoch contract](https://raw.githubusercontent.com/liberfa/erfa/master/src/starpm.c).

## Scoped checks

No full local test suite was run. Failed checks were repaired and only affected
paths were rerun.

| Check | Result and scope |
| --- | --- |
| Production build | TypeScript, Vite build, artifact finalization and build-budget verification passed through the single-test browser server setup |
| Changed-source lint | 298 changed/new script and frontend files: 0 errors, 7 warnings; warnings are not reported as a clean warning-free run |
| Session, geometry, streaming and scientific receipts | Named unit-file runs cover the new session, spacecraft origin contracts, catalog geometry/streaming, Gaia chunks, stellar motion, dynamics/ensemble receipts, source chains and ellipsoid rays; latest streaming/session run 42/42 and temporal ownership run 10/10 |
| Go scoped regressions | Selected source-chain, evaluation, SPK Type 1/21, ERFA/batch stellar-motion and state-plan/tile HTTP cases passed; dedicated statewire encode/parse/metadata cases passed separately |
| Browser interaction | One desktop Chromium regression passed for stream → existing 3D/2D scene → stop → fixed sample, using a three-row catalog fixture |
| Native source contract | Native source/packaging checker passed; Android/iOS compilation and runtime are separate outstanding gates |
| Data reconciliation | 67 changed JSON files parsed; 889 unique SPK files across both manifests matched declared sizes and SHA-256; all 1,561,171 raw MPC index metadata rows matched their source metadata |

## Real-source scene measurement

The opt-in `tests/e2e/explorer-capacity.spec.ts` uses the pinned 1,561,171-row
release, locally served unmodified files and a real loopback Go backend with
manifest-declared SPKs. It separately checks computation, actual point draw
submissions, epoch advancement, context survival and return to sample.

Results are recorded with the completed run's browser, renderer, dataset and
CPU identity. A local browser check is not mobile, native or sustained thermal
acceptance; RAF intervals are not GPU completion timings. The 1,024 MiB UI
setting is a memory plan, not measured peak RSS. MPC rows remain independent
two-body propagation, not a mutual-gravity million-body integration.

The final opt-in run passed in 52.6 seconds on Chromium 151.0.7922.34,
Intel i9-14900KF, **SwiftShader software graphics**. Both modes computed all
1,561,171 rows, advanced the epoch and survived the check without context loss.

| Mode | Load to computed/display-ready | Primary catalog draw at capture | Largest point draw call during sampling | RAF p50 / p95 / p99 |
| --- | ---: | ---: | ---: | --- |
| 3D | 9.381 s | 280,000 | 375,000 | 50.0 / 66.8 / 83.3 ms |
| 2D | 9.266 s | 280,000 | 280,008 including focus markers | 50.0 / 116.6 / 116.7 ms |

These are deliberately not a smooth-60-FPS claim. The adaptive controller reduced
display work under software rendering while all catalog rows remained computed.
Point submissions are not a count of visually separated pixels. See the
[raw receipt](benchmarks/explorer-scene-20260929/explorer-capacity.json),
[3D capture](benchmarks/explorer-scene-20260929/catalog-3D.png) and
[2D capture](benchmarks/explorer-scene-20260929/catalog-2D.png).

## Submission and remaining limits

Changes are committed directly to local main. No deployment, release or push is
performed: the current main-push workflow automatically deploys Pages and would
conflict with the owner's deployment hold. Prior commits already ahead of the
remote are preserved.

The [current validation inventory](scientific-expansion-pending-validation.md)
retains native/device, independent physical-reference and end-to-end preparation
gaps. A successful build or data hash check does not close those gaps. Further
optimization should start from measured user-visible limitations, not from a
requirement to keep finding changes.
