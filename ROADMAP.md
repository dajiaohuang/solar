# Solar Atlas roadmap

The roadmap records intent, not a promise of dates. Scientific correctness, reproducibility, and bounded browser performance take priority over feature count.

## Active product direction — three clients and one backend

- Build independent Web, Android and iOS frontend projects with platform-appropriate interaction and independent build/test/release paths, backed by one Go scientific/data backend developed in its own workstream. Optimize backend performance with reproducible benchmarks without reducing scientific correctness. Existing Capacitor shells are a migration baseline, not the final native experience.
- Keep GitHub Pages as a curated availability profile of the same Web frontend: immediate 3D Observation Deck, preset list, optional tutorial, representative systems and the strongest guided lessons. Keep full-only entries visible but unselectable, with accessible explanations and verified full-version destinations; do not silently execute unavailable actions through a direct URL.
- Preserve the all-known-Solar-System-body goal in the full backend/clients; preview package limits do not constrain it. Share identities, source versions, time/frame contracts and validated scientific results, not a compulsory shared UI.
- Deliver versioned API contracts and bounded backend data access, independent native clients, and a separately verified preview profile. Preserve scene compatibility, offline/cache boundaries and rollback during migration.

See the bilingual [product direction and acceptance criteria](./docs/product-direction.md). This is the accepted development target, not a claim that a backend or independent native interfaces already ship.

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

- Visitor home, mobile navigation, bilingual titles, browser history, URL schema v3, and legacy v2 replay.
- Immutable MPCORB releases, compressed bounded delivery, build identity, Pages capacity evidence, smoke incidents, rollback, offline shell, and scheduled Chromium/Firefox/WebKit accessibility checks.
- Eight observation-first stories with primary sources and explicit limits for geocentrism, two-body propagation, coordinate frames, resonance, Trojans, NEOs, Pluto, and spacecraft claims.

## Longer-term investigations

- Expand source-backed physical coverage and explicit uncertainty/validity evidence; N-body integration is outside the current scope.
- More object knowledge pages and community-authored stories.
- Backend/full-client data delivery independent of the curated GitHub Pages preview.
