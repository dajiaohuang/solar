# Real MPC 3D snapshot capacity

One fresh-browser desktop run loaded and propagated all 1,561,171 real source
rows from 313 immutable MPC shards. The three-dimensional heliocentric positions
are displayed orthographically at fixed UTC JD 2461306.5. This is a two-body
approximation, not high-precision SPK propagation or continuous-time animation.

On Windows Chromium 151.0.7922.34 / RTX 5070 Ti / verified Direct3D11, load time
was 1563.7 ms and first nonempty draw 234.4 ms. The final pre-rotation selection
displayed 33,119 representatives at 8 AU. Three attribute buffers held 43,712,788
bytes; the final index buffer held 132,476 bytes. Download concurrency and
unacknowledged transfers each peaked at four. No page/GL errors or main-thread
long tasks were recorded; callback interval P95 was 16.8 ms.

Twelve subsequent one-degree azimuth changes completed through browser automation
in 308.5 ms, with zero extra catalog requests, attribute allocations or attribute
upload bytes. This automation duration is not an input-latency or FPS measurement.
Selection indices may change and be uploaded; the original attributes remain.

The report retains source and implementation hashes. receipt.json identifies
the exact report and harness bytes. This single local-HTTP measurement is not
a tail-latency estimate, total process/driver memory measurement, public-network
throughput, simultaneous display of every point, or native/mobile device proof.
The source-count benchmark is independent of the synthetic 8,000-row browser
regression used to verify rotation and its changed pixels.

Reproduce after building with an unused output path:

    rtk proxy node scripts/benchmark-catalog-stream.mjs --mode 3d --detail spatial --graphics d3d11 --output .cache/new-3d-report.json

The allocation plan reserves 84 bytes per 3D point (56 CPU/GPU attributes,
12 worker visual coordinates, 16 spatial-selection reserve), versus 72 in 2D,
plus the shared index, bounded shard scratch and fixed headroom. It is an explicit
array budget, not a bound on total browser memory.
