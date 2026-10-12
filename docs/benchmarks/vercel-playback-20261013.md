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
