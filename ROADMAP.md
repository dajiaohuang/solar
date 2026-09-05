# Solar Atlas roadmap

The roadmap records intent, not a promise of dates. Scientific correctness, reproducibility, and bounded browser performance take priority over feature count.

## Active product direction — three clients and one backend

- Build independent Web, Android and iOS frontend projects with platform-appropriate interaction and independent build/test/release paths, backed by one Go scientific/data backend developed in its own workstream. Optimize backend performance with reproducible benchmarks without reducing scientific correctness. The native source projects currently cover only a first exact-current-state tile vertical slice prototype; do not add a Web shell or package native SPK files.
- Keep GitHub Pages as a curated availability profile of the same Web frontend: immediate 3D Observation Deck, preset list, optional tutorial, representative systems and the strongest guided lessons. Keep full-only entries visible but unselectable, with accessible explanations and verified full-version destinations; do not silently execute unavailable actions through a direct URL.
- Preserve the all-known-Solar-System-body goal in the full backend/clients; preview package limits do not constrain it. Share identities, source versions, time/frame contracts and validated scientific results, not a compulsory shared UI.
- Deliver versioned API contracts and bounded backend data access, independent native clients, and a separately verified preview profile. Preserve the current scene schema, explicit offline/cache boundaries and rollback; old scene/API compatibility is not a requirement.

See the bilingual [product direction and acceptance criteria](./docs/product-direction.md). This is the accepted development target, not a claim that a backend or independent native interfaces already ship.

## Current status (2026-09-05)

- **Live:** GitHub Pages publishes the curated Web preview. Its health/capacity evidence reports commit `2d2b99ca17b9a287024cb661a658c5922127e9fc`, 36 SPK files / 90,800,128 SPK bytes and 93.2 MiB total capacity.
- **In development:** the Go backend, full-Web state-tile path and source-profile delivery are locally runnable and contract-tested, but there is no public full-Web backend endpoint. The native projects are first-slice prototypes; Android now uses a GLES point renderer validated in an empty-scene emulator smoke test and iOS has not yet been compiled on macOS.
- **Planned:** measured backend/full-client throughput, multi-plan memory/render limits, broader all-body runtime delivery, and native build/device/release evidence. None of these is implied by the Pages publication.

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
