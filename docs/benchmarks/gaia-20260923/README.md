# Gaia real-capture loading measurement

Measured on 2026-09-23 with Windows x64, Intel i9-14900KF (32 logical CPUs),
Playwright Chromium desktop and Pixel 7 emulation on the same desktop host.
The source query centered on ICRS RA 55 deg, Dec 25 deg, radius 1 deg, G <= 17
returned 4,460 rows in four spatial bins; the separate ESA count agreed.

| Profile | Import ms, three successive runs | Frame interval P95 ms | GPU star buffer bytes | Zoom reallocations/uploads |
| --- | --- | --- | --- | --- |
| Desktop Chromium | 489.38 / 119.42 / 64.88 | 16.8 / 16.7 / 16.8 | 53,520 | 0 / 0 |
| Mobile Chromium emulation | 510.41 / 63.55 / 123.98 | 16.8 / 16.8 / 16.7 | 53,520 | 0 / 0 |

Each run imports local files and then drives 120 zoom steps via animation frames.
The first zoom value is unchanged, so 119 draws were observed per run. Reports
retain every frame interval, browser/host information, source query receipts,
manifest hash and implementation hashes. BUFFER_SIZE describes the star buffer,
not total driver/GPU memory. Import timings include Playwright file transfer and
completion polling; they are not isolated parser measurements. The first run is
not certified cold-cache. The frame measurements are short (about two seconds
per run), instrumented and vsync-limited; they are not GPU timer queries or
sustained full-sky FPS. No heap, real-device or network-throughput claim is made.

Original CSV and chunk bytes are retained locally in
.cache/gaia-scale-20260923. source-manifest.json here is a receipt only, not a
loadable dataset: it does not include its chunks. To obtain a new independent
capture, run the documented importer with the settings above and a new output
directory. Queries can change upstream; compare the recorded hashes before
claiming exact reproduction.

Run only this opt-in measurement with an existing captured directory:

~~~powershell
rtk proxy npx cross-env SOLAR_GAIA_CAPACITY_DIR=.cache/gaia-scale-20260923 npx playwright test tests/e2e/gaia-capacity.spec.ts --workers=1
~~~

The two profile cases run three samples each. Without the environment variable
they are skipped. JSON and screenshots are written under test-results; preserve
them before a later Playwright run replaces that directory. No full local test
suite, dataset publication or deployment is required.
