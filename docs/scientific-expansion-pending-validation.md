# Pending validation of current scientific changes

Current inventory, 2026-09-29. Scoped checks are authorized; the full local test
suite is prohibited. Deployment and release remain paused.

The current accepted direction and checks are recorded in
[the direction-correction receipt](direction-correction-20260929.md).
The prior 7,360-line inventory is retained byte for byte in
[the historical validation ledger](scientific-validation-history-20260929.md).
Its gaps are not silently closed by compilation, a small fixture, or a source review.

## Remaining evidence boundaries

| Area | What is still required before making a broader claim |
| --- | --- |
| Device capacity | Sustained representative-device runs, peak process/GPU memory, context recovery and thermal behavior; local browser frame intervals do not certify mobile/native capacity |
| Scientific accuracy | Independent physical reference cases and fit-model assumptions for each experiment; covariance propagation, ensembles and event timing are conditional on the declared force/initial-state models |
| Source preparation | Full end-to-end replay of revised spacecraft preparation against pinned upstream bytes; source contracts alone do not certify fresh downloads or all crop windows |
| Native consumers | Current Android runtime/build and iOS Xcode/device validation; source changes and shared Go/Web results do not establish native acceptance |
| Deployment/release | Owner has deferred both. Main's push-triggered deployment must remain untriggered while that instruction stands |

## Completion discipline

Current checks close only the named paths in the receipt. Before new work, choose
one concrete remaining outcome and its smallest useful check. Do not rerun the
entire project or keep adding speculative optimizations to manufacture progress.
