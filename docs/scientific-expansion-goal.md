# Scientific expansion and real-time scale

Current direction, 2026-09-29. The objective is to compute and display more useful,
source-backed bodies in the same observation scene, with explicit epochs, models,
and capacity limits. A higher configured ceiling alone does not meet that objective.

## Current delivery batch

| Direction problem | Delivered change | Acceptance boundary |
| --- | --- | --- |
| Main scene limited to fixed samples | Cancellable retained catalog worker feeds the existing 2D/3D scene; 100k, 500k and full-catalog choices; shared filters, epoch coordination, origin subtraction and on-demand picked-row metadata | Focused session/geometry tests and browser acceptance; see the current receipt |
| Spacecraft preparation used the wrong origin guard | Mission-specific Cassini/Saturn and MESSENGER/Mercury contracts, including required contiguous MESSENGER coverage | Contract regressions; a new full upstream download/preparation is not claimed |
| Computed population conflated with display capacity | Separate computed, primary draw, admitted capacity, snapshot epoch and requested-time lag; reserve scene memory as well as worker memory | Memory admission is an estimate; actual device frame and memory evidence remains distinct |
| Evidence UI and proposed science outgrew integrated use | Optional source evidence is opened on demand; scientific labs are separate lazy chunks; failed receipt and batch-state contracts repaired | A panel or source capture is not a validated physical model |
| Unbounded audit notes and submission backlog | Preserve history, use this finite direction tracker, validate affected paths and submit coherent code/data/docs batches | No local full-suite run; no deployment or release |

Detailed changes and current validation are in
[the direction-correction receipt](direction-correction-20260929.md).
Outstanding evidence is in [pending validation](scientific-expansion-pending-validation.md).

## Rules for the next accepted change

1. Start with a concrete user-visible problem or measured capacity bottleneck.
   State the affected body population, model, epoch and observable outcome.
2. Prefer integrating existing source-backed calculations into the scene or an
   analysis workflow before adding another disconnected data/evidence panel.
3. Keep authoritative SPK queries, MPC two-body propagation, Gaia assumptions,
   and experimental force-model integration explicitly separate. Numerical
   agreement does not establish physical accuracy or calibrated uncertainty.
4. Validate the affected contract and interaction once the batch is coherent.
   Full local suites remain prohibited; scoped tests and regular commits are
   authorized. Stop optimizing when there is no demonstrated useful improvement.
5. Commit directly to main. Deployment and release remain paused. Main currently
   has a push-triggered deployment workflow, so local submission does not by itself
   authorize triggering that workflow.

## Retained research scope

The broader workstreams remain shared analysis ephemerides, ground observation,
orbit uncertainty, occultations/eclipses, dynamics, scientific data, catalog
streaming, rendering/time and capacity evidence. They are not all certified by
this batch. Their detailed requirements and source-only checkpoints are preserved
without alteration in [the historical goal ledger](scientific-expansion-history-20260929.md).
Old unverified statements remain unverified unless an explicit current receipt
supersedes that exact claim. No new task is required solely to extend the ledger.
