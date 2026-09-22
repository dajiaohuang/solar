# Solar Atlas roadmap

The roadmap records intent, not a promise of dates. Scientific correctness, reproducibility, and bounded browser performance take priority over feature count.

## Active product direction — three clients and one backend

- Build independent Web, Android and iOS frontend projects with platform-appropriate interaction and independent build/test/release paths, backed by one Go scientific/data backend developed in its own workstream. Optimize backend performance with reproducible benchmarks without reducing scientific correctness. The native source projects currently cover only a first exact-current-state tile vertical slice prototype; do not add a Web shell or package native SPK files.
- Keep GitHub Pages as a curated availability profile of the same Web frontend: immediate 3D Observation Deck, preset list, optional tutorial, representative systems and the strongest guided lessons. Keep full-only entries visible but unselectable, with accessible explanations and verified full-version destinations; do not silently execute unavailable actions through a direct URL.
- Preserve the all-known-Solar-System-body goal in the full backend/clients; preview package limits do not constrain it. Share identities, source versions, time/frame contracts and validated scientific results, not a compulsory shared UI.
- Deliver versioned API contracts and bounded backend data access, independent native clients, and a separately verified preview profile. Preserve the current scene schema, explicit offline/cache boundaries and rollback; old scene/API compatibility is not a requirement.

See the bilingual [product direction and acceptance criteria](./docs/product-direction.md). This is the accepted development target, not a claim that a backend or independent native interfaces already ship.

## Current status (2026-09-22)

- **Live:** GitHub Pages publishes the curated Web preview. The audited deployment at commit `6525dfc6babf4f0e6d1c650fa84028dd4104a88a` contains 41 SPK files / 92,071,936 SPK bytes and 98,532,265 total bytes. Its scientific report passes 158/158 cases. These are dated deployment measurements, not limits on the full product.
- **In development:** the Go backend serves exact current states and sampled histories from staged original SPKs, with live loopback HTTP checks against the Web decoder. There is no public full-Web backend endpoint. Android and iOS remain first-slice prototypes; both have CI simulator/emulator evidence for rendering responses from a real SPK-backed Go HTTPS server. Physical devices, full feature parity and signed releases remain unverified.
- **Audit improvements:** startup rejects invalid configured catalogs/inventories; concurrent browser cache writes obey the global byte budget; narrow viewports fit their actual available width. Patched JavaScript and Go dependencies and the Chromium/Firefox/WebKit matrix are enforced by the pull-request gate. See [the September 22 audit](./docs/audit-20260922.md) for evidence and limits.

## Next delivery priorities

Actual deployment and release are paused by owner direction on 2026-09-22. The application deployment and asteroid dataset publication workflows are manually disabled; PR quality, security, browser and native checks remain active. Resume publication only after a new explicit owner instruction. The [follow-up audit](./docs/deep-audit-20260922.md) records non-deployment correctness and performance work.

Owner changes can go directly to `main` without a new PR. Push the candidate commit to a `codex/*` staging branch, let the required quality gate validate that exact commit, then fast-forward `main` to the same SHA. Keep branch protection, required checks and the prohibition on force pushes intact. Use focused regressions during successive review passes and consolidate full validation at the final candidate.

1. Continue local/CI audits of full-backend source inventory, operating limits, cold startup, memory and concurrent client load. Public HTTPS deployment and production-readiness acceptance stay deferred.
2. Move the remaining expensive client analyses behind bounded, cancellable backend contracts, retaining the current scientific tolerances and source evidence.
3. Extend independent native clients beyond the current-state slice and verify offline/reconnect behavior. Physical-device acceptance remains outstanding; signed releases are deferred.
4. Expand original-source body coverage with explicit identity, dependency and validity evidence. Preserve missing-state diagnostics wherever an exact source is unavailable; N-body integration remains outside scope.

## 0.11.0 — geocentrism as the core guide

- A dedicated six-stage course now connects the predictive power of historical geocentrism, the evidence for a moving Earth, and the continuing scientific value of modern geocentric coordinates.
- The course is the default Learn path and first-run handoff, with an explicit distinction between a physical theory, a translated teaching frame, and the relativistic IAU GCRS.

## 0.10.0 — guided atlas and public validation

- Persistent six-stage guided stories, checkpoints, highlighted controls, global search, local scene libraries, and five-section object profiles.
- Event refinement curves, interactive porkchop opportunity selection, and keyboard-accessible element distributions.
- Bilingual static exhibits and object profiles with independent social cards, structured metadata, primary sources, and explicit model boundaries.
- Machine-readable scientific benchmark evidence, bilingual validation pages, workspace/WebGL/Worker recovery, and Lighthouse CI budgets.

## Next analysis and validation layer

- Expand checked JPL Horizons position fixtures across planets, close approaches, and mission endpoints, with comparison charts and tolerances.
- Add richer event comparison views, saved/pinned analysis results, and downloadable mission trade-study tables.
- Add uncertainty-aware SBDB displays and observation/covariance context without implying a collision probability.
- Continue reducing first-interaction cost, add monitored Lighthouse history, and test assistive-technology behavior manually.
- Accept community-authored courses through a documented story schema and editorial validation path.

## Completed foundations

- Visitor home, native/mobile navigation, bilingual titles, browser history, and the current URL scene schema.
- Immutable MPCORB releases, compressed bounded delivery, build identity, Pages capacity evidence, smoke incidents, rollback, offline shell, and scheduled Chromium/Firefox/WebKit accessibility checks.
- Eight observation-first stories with primary sources and explicit limits for geocentrism, two-body propagation, coordinate frames, resonance, Trojans, NEOs, Pluto, and spacecraft claims.

## Longer-term investigations

- Expand source-backed physical coverage and explicit uncertainty/validity evidence; N-body integration is outside the current scope.
- More object knowledge pages and community-authored stories.
- Backend/full-client data delivery independent of the curated GitHub Pages preview.
