# Real MPC source capacity tiers

One sequential fresh-browser run per tier, Windows Chromium 151.0.7922.34,
NVIDIA RTX 5070 Ti via verified Direct3D11. The unchanged build contains
the artifact deadline correction at 1cbc0a5. Each report retains the actual
source and implementation hashes; receipt.json identifies the harness and
original report bytes. No generated or replicated source rows were used.

| Loaded rows | Displayed representatives | Load ms | First draw ms | Attribute bytes | Final index bytes | Fetched shards |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30000 | 5416 | 242.3 | 212.0 | 720000 | 21664 | 9 |
| 100000 | 16956 | 298.5 | 206.2 | 2400000 | 67824 | 23 |
| 300000 | 21590 | 468.5 | 209.5 | 7200000 | 86360 | 63 |
| 1000000 | 30466 | 1067.3 | 222.0 | 24000000 | 121864 | 203 |
| 1561171 | 34505 | 1553.1 | 211.9 | 37468104 | 138020 | 313 |

All five runs verified exact uploaded/source counts, zero page/GL errors, visible
pixels, bounded upload credits and attribute allocation. Download concurrency
peaked at four. Callback interval P95 was 16.8 ms with no recorded long tasks.
The sample count is small and the runs are instrumented: these are observations,
not a reliable tail-latency estimate or physical display FPS.

The first four results are explicitly limited source-order prefixes. They do
not represent complete inventories or scientifically representative samples.
Four-way lookahead fetched up to three unused shards before cancellation.
Only the last tier checked all 313 shards and 1,561,171 rows. The visual selection
retains all uploaded attributes but draws one representative per occupied cell;
its 34,505-point final display is not simultaneous display of 1.56 million stars.

The canvas was 545 by 698 pixels within a 1600 by 1000 viewport, at fixed UTC
JD 2461306.5, 8 AU radius and 100k display limit (bounded by loaded capacity).
This uses local HTTP and one fixed epoch, not public-network performance,
continuous 3D propagation, total process/driver memory, or native/mobile devices.

Reproduce after building, using a new output path for each report:

    rtk npm run build
    rtk proxy node scripts/benchmark-catalog-stream.mjs --rows 30000 --detail spatial --graphics d3d11 --output .cache/new-tier-30000.json

Repeat sequentially with 100000, 300000, 1000000 and the current manifest total.
The full-inventory run is a targeted benchmark, not the full local test suite.
