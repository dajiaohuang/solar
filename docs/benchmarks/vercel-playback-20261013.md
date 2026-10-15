# Vercel playback optimization

## Scope

Vercel Hobby static segmented build, 2000–2051 scientific coverage. Current
positions, reference transforms, 2D/3D, seeking and playback remain supported.
No source fits, coverage intervals or forecast uncertainty claims were changed.

## Changes

- Stable scene identity prevents coefficient downloads from resetting a dragged
  camera. Clock frames update marker positions independently of React UI ticks.
- Playback retains a coherent sampled history and admits another history job
  only after the previous job settles. Its sampled epoch is visible in the UI.
- Vercel uses one instanced marker batch and two colored trail opacity groups.
  Picking uses the original body proxies. Float64 coordinates are translated
  before GPU conversion; disconnected edges and body boundaries are preserved.
- Immutable cache reads use readonly transactions. LRU access times live in a
  separate metadata store; cached ArrayBuffers are not rewritten on each hit.
  Existing version-2 payloads survive the version-3 upgrade. The global payload
  budget remains 256 MiB with atomic pruning and cross-tab byte accounting.

## Local evidence

Collaborative Chromium preview, 1280×800, ANGLE SwiftShader software GPU.
Full population loaded: 492 valid positions, 160 sampled trails, 332 state points.
Ten-second playback after complete loading: median 10 GPU draw calls, median
33.4 ms frame interval, 95th percentile 50.1 ms, 255 frames, zero camera resets.
The preceding marker-only run with 160 separate trail objects had median 162
draw calls. This proves batching, not a hardware-GPU frame-rate guarantee.

The pre-cache-change six-test Vercel suite passed in 47.7 seconds. Full-population
load took 28.6 seconds. Five-body/30-day coefficient delivery was 312381 bytes
cold and 424 bytes on reload. Payload timings vary with history requests and
local scheduling; they are not hosted billing measurements.

## Publication boundary

The attempted `d2d7869` release was blocked by Vercel commit-author access checks.
Its deployment ID is `dpl_G8YnRbw3fz8oZ8mxBebVYm8FKFzK`. The production alias
still serves the original release until a later deployment is verified.

## First optimized release

`ecce355` was subsequently deployed successfully as
`dpl_EDBk6TkU8HrWL7ZQvP4C5bKaie8b`, using the authenticated owner's actual
commit email. Production build-info, health and approximation pointer matched
the verified local artifact byte for byte. Five hosted interaction/download
checks and two Chromium phone-viewport checks passed. Full-population cold
loading passed separately with an extended observation timeout, taking about
84 seconds; the local 45-second load check passed in 24.7 seconds.

This exposed a remaining network round-trip cost. Large selections with at
least 128 unresolved body indices now request one content-addressed complete
index; small selections retain individual indices. Both paths validate the
same identities, descriptor windows and source authority before coefficients
are admitted. Coefficients remain selected by epoch and requested history.

## Actual default-scene regression

The user identified the default seven selections as the worst scene: Mercury,
Venus, Earth, Moon, Mars, Jupiter and Saturn, with the Sun as reference origin.
The earlier five-body check missed two playback failures in this scene:
main-thread chunk acquisition terminated the independent history worker, and
temporary current-state misses hid otherwise verified historical trails.

Segmented workers now finish independently of main-thread downloads, and
playback retains the previous coherent historical samples with their displayed
sample epoch. Current markers still use the current epoch; unavailable states
are not invented. The Sun reference origin remains visible during acquisition.
The permanent cold-load/365-days-per-second camera test now uses the actual
default seven bodies. It passed locally in 6.1 seconds with 1.2-second delayed
coefficient responses; the old hosted code failed this same scenario.

Final local default-scene playback profile after loading, 1280×800 SwiftShader:
459 frames in 10 seconds, median interval 16.7 ms, p95 33.4 ms, maximum 33.5 ms,
median nine draw calls, zero long tasks and zero camera resets. This is software
GPU evidence, not physical-device certification. The final local six-test suite
passed in 32.6 seconds: default cold-load camera check 5.2 seconds, complete
population 17.0 seconds, five-body cold coefficient payload 274589 bytes and
cached reload 424 bytes. Two phone-viewport checks passed in 8.5 seconds.

## Verified final production release

The `14c8aef` runtime artifact is live at https://solar-five-woad.vercel.app/ as
`dpl_3YXLk6MDPaf1Kr2M7JTEWLpstykj` on the existing Hobby basic machine.
Build-info, health and approximation pointer matched local bytes and hashes.
The later asset-verification and receipt commits modify build checks, tests and
documentation only; the served runtime identity remains `14c8aef`.

Five ordinary hosted checks passed in 19.6 seconds. The actual default seven-body
cold-load drag/365-days-per-second check passed in 8.8 seconds, correcting the
previous hosted failure. The complete population passed separately in 41.9
seconds, with 492 valid positions and one unique bulk index path. Its observation
timeout was 300 seconds; the repository's local test retains its 45-second limit.
Three hosted Chromium iPhone-13 viewport checks passed in 11.6 seconds, including
the default-scene playback test. No physical-device validation was performed.

The source/runtime full CI passed 1309 tests with nine explicit skips; the new
verification-only fixture separately passed, including a checksum-valid mutated
bulk index rejection. Final typecheck, scoped lint and production artifact
verification passed. See `vercel-playback-20261013/deployment.json` for the receipt.
