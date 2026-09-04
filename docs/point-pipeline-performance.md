# Current-state and point-pipeline measurements

These measurements distinguish selected identities, precise SPK states,
approximate fallback positions and actual rendering. They are not a claim that
all known Solar System bodies have precise states or that a memory tier guarantees
smooth rendering. Source identity and valid epochs remain scientific requirements.

## Equal-work current-state CPU comparison

Run `npx vitest run --config vitest.focus-benchmark.config.ts` from the repository.
The reproducible harness loads the original Pages-window SPK files, warms ten
epochs, then alternates the order of baseline and optimized evaluations for 80
epochs starting at UTC JD 2461287.5, stepping 0.001 days. It compares every output
component and missing-body ID at each epoch.

Baseline: separate absolute resolver for each reference, plus the previous
quadratic missing-ID scan. Optimized: one same-epoch resolver shared by Saturn
and Titan reference frames, with linear missing-ID membership. Both variants
process the **same complete selection**, without imposing the old 160-object prefix.

Observed on the development Windows host, 2026-09-05:

| Selection | SPK / fallback / missing | Baseline P50 / P90 (ms) | Shared P50 / P90 (ms) |
|---|---|---|---|
| 160 Saturn-system objects | 160 / 0 / 0 | 1.39 / 1.64 | 0.67 / 0.87 |
| 294 Saturn-system objects | 293 / 0 / 1 | 2.57 / 2.79 | 1.17 / 1.37 |
| 510 built-in objects | 508 / 1 / 1 | 5.72 / 6.43 | 2.18 / 2.48 |

Manifest: `jpl-satellite-expansion-20260904-pages`. This measures Node CPU work
after kernel loading, not React layout, historical trajectories, GPU frames,
network, kernel memory or phone performance. Wall-clock values vary by host/load;
do not make these numbers brittle CI thresholds. Numerical equality is asserted.

## Browser coverage regression

The real desktop/mobile Chromium Saturn test retains all 294 selected IDs and
verifies 293 current SPK positions, one explicit missing state, bounded detailed
meshes, and extra positions in one fixed-pixel GPU point buffer. It also checks
80-row object-list pagination without dropping selection, two reference frames,
and switching both frames to 2D without reducing current-position counts.

Historical trails remain bounded separately (160 in 3D, 320 in 2D); focusing an
object prioritizes its trail. A skipped trail budget is not a missing current
state. Extra current-state points are not the approximate MPC catalog cloud.

## Persistent catalog worker

On the same development host, Chromium 152.0.7977.76 ran 80 epochs at 125 ms
intervals using a production worker bundle. The scheduler was imported through
Vite's development server. Each run used real pinned MPC sample records, one
worker and one initialization, completed all 80 computations and reached final
JD 2461079. The final Float32 output was compared component-by-component with
`propagateCatalogElementPositions` at that epoch, with zero mismatches.

| Objects | Element bytes transferred once | P50 / P90 (ms) | Components compared |
|---|---:|---:|---:|
| 8,000 | 512,000 | 2.6 / 3.0 | 24,000 |
| 20,000 | 1,280,000 | 5.8 / 6.4 | 60,000 |
| 30,000 | 1,920,000 | 8.3 / 9.3 | 90,000 |

The previous per-epoch initialization transferred the same element payload 80
times in the retained 80-epoch baseline. The new protocol transfers it once per
record set and sends scalar epoch requests thereafter. These figures exclude
result-buffer transfers and do not measure React or GPU rendering. Because the
old and new benchmark loading paths differ, their latency difference is not an
isolated causal performance comparison. Catalog propagation remains approximate
MPC-element propagation, not a precision upgrade to SPK.

## Remaining measurement boundaries

Full React/GPU allocation and frame-time comparisons, large catalog selection
stress and actual Android/iOS device tests must be
reported separately. A passing CPU harness or browser correctness test does not
establish those outcomes.
