# MPCORB streaming and rendering measurements

These sequential fresh-browser observations were captured on 2026-09-24 UTC
(2026-09-25 Singapore time) from the current working build: Windows Chromium
153.0.8010.12, NVIDIA RTX 5070 Ti through verified Direct3D11, a 1600 by 1000
viewport, and an explicit 512 MiB catalog admission budget. The source is
`mpcorb-26bbcb75e45b7cbb-full` (1,561,171 rows, 313 shards; content SHA-256
`6befc193f2a6bd35fa04f4e83e339784a3c988dbdd974afcdd0f871cb07f9b61`). Every
JSON receipt records source, implementation and built-asset hashes. The harness
does not establish source-to-build equivalence, so these identify measured
inputs without claiming a clean-build attestation.

| Source rows loaded | Displayed representatives | Load ms | First visible ms | Frame interval P95 ms | Observed JS heap peak MiB | Binary bytes served |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30,000 | 29,965 | 308.8 | 213.3 | 16.8 | 65.0 | 2,880,000 |
| 100,000 | 99,881 | 532.1 | 201.7 | 16.8 | 70.9 | 7,360,000 |
| 300,000 | 21,590 | 1,239.3 | 225.0 | 16.8 | 63.9 | 20,160,000 |
| 1,000,000 | 30,466 | 3,286.7 | 224.8 | 16.8 | 68.7 | 64,960,000 |
| 1,561,171 | 34,505 | 4,993.9 | 222.7 | 16.8 | 86.8 | 99,914,944 |

The first four tiers are source-order prefixes and report `limited`; they are
not complete inventories or scientifically representative samples. Only the
last tier read and validated all 313 source shards and all 1,561,171 rows.
Spatial representatives are a visual reduction, not a density estimate: the
full 2D inventory uploaded 37,468,104 attribute bytes while drawing 34,505
points. Binary request concurrency peaked at four. All five runs reported zero
page and WebGL errors. The 1,000,000-row run's maximum loading frame interval
was 33.3 ms; the full 2D run's was 66.6 ms, although both had 16.8 ms P95.

The worker now coalesces catalog-stream MessageChannel yields into approximately
4 ms cooperative slices. This reduces scheduling overhead while retaining
regular opportunities to handle messages; camera spatial-selection work keeps
its separate immediate yield path. On the same host, browser, source and
instrumented schema-v5 path, a full-load observation fell from 8,282 ms before
the change to 4,973 ms after it (about 40%); first visible output stayed near
0.23 s. The tier receipts show 4,994 ms for the final 2D run. These are local
single-machine timings, not a cross-device guarantee.

The optional benchmark-only worker receipt helps locate the remaining load
cost. In the full 2D run it recorded 4,772 ms total worker time, including
2,440 ms summed metadata artifact reads and hashes, 1,340 ms summed binary
reads and hashes, 950 ms metadata decoding and validation, 289 ms Kepler
propagation, 139 ms orbital preparation, 55 ms exact source filtering and
35 ms selected-attribute packing. The stage receipt is enabled only by the
benchmark request. Artifact read-and-hash category durations overlap because
reads run concurrently; tile delivery includes visual-coordinate installation
and transfer-window waits; the worker total encloses its stages. These values
are not additive and should be used to prioritize profiling, not as a CPU-time
accounting identity.

The full 3D run loaded all rows in 5.05 s and then observed 60.286 s of steady
rendering with 12 camera azimuth changes. Across 3,616 animation callbacks,
steady frame intervals had 16.8 ms P95 and P99, 16.9 ms maximum and no
intervals above 25 ms; the browser reported no long tasks. Sampled JS heap
peaked at 89.4 MiB during that steady window. Twelve spatial selections took
37.7 ms median and 41.2 ms P95/max. Camera changes caused no additional
artifact requests, allocations or attribute uploads and uploaded 1,464,012
bytes of spatial indices. This steady-state window is distinct from loading;
the 3D load's maximum callback interval was 100.2 ms.

The separate 300,000-row cancellation probe measured a 2.5 ms UI state change
and a 5.4 ms worker terminal response. During the following one-second quiet
observation it found no pending browser requests, active server responses,
late tiles or additional attribute uploads. The worker was not terminated:
the receipt establishes source-load settlement for one warm-page local-HTTP
initial-load scenario, not worker termination or memory reclamation.

Frame intervals are headless Chromium callback measurements, not physical
display FPS or GPU execution timers. Heap readings are browser-reported JS
heap, not total process, worker, GPU or driver memory; sampled peaks can miss
short-lived allocations. Local HTTP does not establish public-network
throughput. These runs use a fixed epoch and do not measure continuous orbital
propagation or Android/iOS capacity.

The same MPCORB content hash had a 1.55 s full-load observation in a
2026-09-23 historical receipt. That build, Chromium version and implementation
hash differ, so it is a regression lead rather than a controlled comparison.
The current full load near 5 s remains slower than that historical observation;
this change reduces measured scheduling overhead but does not resolve the
entire historical regression.

Reproduce after building, using a new output name for each run and keeping
tiers sequential:

```powershell
rtk npm run build
rtk proxy node scripts/benchmark-catalog-stream.mjs --rows 30000 --detail spatial --graphics d3d11 --budget-mib 512 --output .cache/catalog-30000.json
```

Repeat with `100000`, `300000`, `1000000` and the current manifest total. For
3D sustained interaction use `--mode 3d --steady-seconds 60`; for bounded
initial-load cancellation add `--cancel-probe`. These are targeted local
benchmarks, not deployment acceptance or proof of physical-display cadence.
