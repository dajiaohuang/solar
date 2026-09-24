# Current MPCORB stream and render observations

These sequential, fresh-browser observations were captured on 2026-09-24 UTC
from the current working build: Windows Chromium 153.0.8010.12, NVIDIA RTX
5070 Ti through verified Direct3D11, 1600 by 1000 viewport, and an explicit
512 MiB catalog admission budget. The source is release
`mpcorb-26bbcb75e45b7cbb-full` (1,561,171 rows, 313 shards;
content SHA-256 `6befc193f2a6bd35fa04f4e83e339784a3c988dbdd974afcdd0f871cb07f9b61`).
Every JSON report records the source, implementation and built-asset hashes.
The harness explicitly says source-to-build equivalence is not established, so
these receipts identify the measured inputs without claiming a clean-build
attestation.

| Source rows loaded | Displayed representatives | Load ms | First visible ms | Frame interval P95 ms | Observed JS heap peak MiB | Binary bytes served |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30,000 | 29,965 | 299.1 | 197.0 | 16.8 | 63.6 | 2,880,000 |
| 100,000 | 99,881 | 551.4 | 200.4 | 16.8 | 64.2 | 7,360,000 |
| 300,000 | 21,590 | 1,309.3 | 213.5 | 16.8 | 63.8 | 20,160,000 |
| 1,000,000 | 30,466 | 4,881.8 | 211.8 | 16.8 | 74.4 | 64,960,000 |
| 1,561,171 | 34,505 | 8,687.4 | 228.4 | 16.8 | 92.2 | 99,914,944 |

The first four tiers are source-order prefixes and report `limited`; they are
not complete inventories or scientifically representative samples. The final
tier read and uploaded all 313 source shards and all 1,561,171 rows. Spatial
representatives are a visual reduction, not a density estimate: the full
inventory uploaded 37,468,104 attribute bytes while drawing 34,505 points.
Binary request concurrency peaked at four, as configured. Every tier had zero
observed page and WebGL errors. The one-million-row run had a 49.9 ms P99 frame
interval outlier during loading; the full 2D run had a 50 ms maximum.

The full 3D run loaded all rows in 8.81 s and then observed 60.29 s of steady
rendering with 12 camera azimuth changes. Its 3,616 animation callbacks had
16.8 ms P95 and P99 intervals, no interval above 25 ms, and no long tasks.
Sampled JS heap ranged from 79.7 MiB at the start to 77.8 MiB at the end, with
an 83.9 MiB sampled peak. The 12 spatial selections measured 65.7 ms median
and 73.3 ms P95/max. Camera changes triggered no new artifact requests, point
attribute uploads or buffer allocations; they uploaded 1,464,012 bytes of
spatial indices. The separate 300k cancellation probe showed a 2.3 ms UI state
change and 5.5 ms worker terminal response, then a one-second quiet interval
with no pending requests, active server responses, late tiles or extra attribute
uploads.

The intervals above are headless Chromium callback measurements, not physical
display FPS or GPU execution timers. Heap readings are browser-reported JS heap,
not total process, worker, GPU or driver memory. Local HTTP does not establish
public-network throughput. The run uses one fixed epoch and does not measure
continuous orbital propagation. It does not establish Android/iOS capacity.
Cancellation evidence covers one warm-page initial-load scenario; it does not
measure worker termination or memory reclamation.

The identical MPCORB content hash had a 1.55 s full-load observation in the
2026-09-23 historical receipt. That build, Chromium version and implementation
hash differ, so this is a regression lead rather than a controlled comparison.
The current first-visible time remains near 0.2 s, but full completion is much
slower. A one-million-row main-thread CPU profile sampled about 819 ms in
WebGL `getError` calls; it did not profile the catalog worker, so the dominant
full-load cost remains unresolved. The metadata-validation and projection
arithmetic cleanups in this working build passed focused checks, but repeated
timings did not establish a reliable end-to-end speedup.

Reproduce after building, using a new output name for each run and keeping
tiers sequential:

```powershell
rtk npm run build
rtk proxy node scripts/benchmark-catalog-stream.mjs --rows 30000 --detail spatial --graphics d3d11 --budget-mib 512 --output .cache/catalog-30000.json
```

Repeat with `100000`, `300000`, `1000000` and the current manifest total. For
3D sustained interaction use `--mode 3d --steady-seconds 60`; for bounded
initial-load cancellation add `--cancel-probe`. These are targeted local
benchmarks, not the full local test suite or deployment acceptance.
