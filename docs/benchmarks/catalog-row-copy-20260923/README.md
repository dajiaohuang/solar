# Catalog row-copy allocation comparison

The production stream now copies eight original Float64 values directly,
instead of creating one subarray view per retained body. It preserves input
order, filters, preparation, bounded transfers and the resource plan.

`row-copy.json` records two warmed methods, ten alternating samples each,
against all 313 original shards (1,561,171 rows). Retention strides are
synthetic microbenchmark masks, not scientific selections. Every variant's
output bytes have identical SHA-256 for each mask. Destination-buffer
allocation and output hashing are outside timers; per-row views are inside.
GC runs before each sample. Source manifest and harness hashes are recorded.

| Retained rows | Subarray/set median | Direct copy median |
| --- | ---: | ---: |
| 1,561,171 | 39.8034 ms | 12.1543 ms |
| 780,586 | 20.24235 ms | 8.8409 ms |
| 15,612 | 1.1731 ms | 1.1403 ms |

`before.json` and `after.json` are one built-browser/local-HTTP full-source
3D spatial-detail run each, on Chromium/ANGLE D3D11 with RTX 5070 Ti:

| Measurement | Before | After |
| --- | ---: | ---: |
| Load | 1616.8 ms | 1585.3 ms |
| First nonempty draw | 237.6 ms | 223.9 ms |
| Uploaded source rows | 1,561,171 | 1,561,171 |
| Final spatial representatives | 33,119 | 33,119 |
| Attribute bytes | 43,712,788 | 43,712,788 |
| Long tasks observed | 0 | 0 |
| Additional attribute uploads across 12 rotations | 0 | 0 |

The single end-to-end pair is a regression observation, not evidence of a
statistically stable whole-pipeline speedup. No physical FPS, total RSS, native
or mobile hardware claim follows. This remains a fixed-epoch snapshot.

The original benchmark scripts are retained beside their reports. Reproduce
with new output paths from the repository root:

```powershell
rtk proxy node --expose-gc scripts/benchmark-catalog-row-copy.mjs new-copy-report.json
rtk npm run build
rtk proxy node scripts/benchmark-catalog-stream.mjs --graphics d3d11 --mode 3d --detail spatial --output new-stream-report.json
```

Twenty-three named streaming tests, targeted lint and production build passed.
No full local test suite was run.
