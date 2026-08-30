# Contributing to Solar Atlas

Solar Atlas welcomes focused fixes, scientific corrections, accessibility improvements, and reproducible teaching stories. Open an issue before a large architectural or data-format change so the scientific and delivery contracts can be agreed first.

## Local setup

Use Node.js 22+ and npm 10+.

```bash
npm ci
npm run dev
```

The application works with its curated major bodies when no local MPCORB release is present. Use `npm run data:lite` only when the change needs catalog data; generated releases are intentionally ignored by Git.

## Required checks

Before submitting a change, run:

```bash
npm run lint
npm run check:repository
npm run test:unit
npm run test:scientific
npm run build
npm run test:e2e
npm run check:capacity
```

Every pull request must pass the read-only `Repository contract` check, which parses repository metadata, verifies local Markdown links and anchors, and keeps the Web, Android, iOS, citation, and bilingual README identities synchronized. Pull requests that change code, configuration, workflows, or production assets must also pass `Web quality`: lint, unit and scientific validation, a production build and capacity check, Chromium interaction/accessibility coverage, and Lighthouse budgets. Documentation-only changes intentionally skip the expensive browser job, but never skip the repository contract. Branch protection should require only the stable `Pull request quality gate` summary, which fails unless every applicable job succeeds. The workflow has read-only repository access and does not deploy.

Scientific changes should add a unit fixture or a reproducible scene, cite a primary source, state the model and validity range, and distinguish numerical precision from physical uncertainty. UI changes must preserve English and Chinese coverage, keyboard access, mobile behavior, and reduced-motion preferences.

Renderer changes must keep the focus layer and catalog cloud separate. Named focus bodies may carry trajectories, labels, picking, and analysis; bulk catalog objects belong in shared typed arrays and a bounded GPU point buffer. Preserve the default zero-sample-request Observation Deck, the 3D-to-2D fallback, and both mobile and desktop Playwright coverage. Treat memory and CPU APIs as conservative hints only; require measured real-device evidence before claiming that a hardware tier is guaranteed smooth.

## Mobile applications

The Android and iOS projects are Capacitor 8 local shells with application ID `io.github.dajiaohuang.solaratlas`. Use Node.js 22+. Android has minimum API 24 and compile/target API 36; iOS requires 16.4 or later. The native core is installed locally, while catalog data remains an on-demand HTTPS dependency.

Run the relevant native preparation commands after web checks:

```bash
npm run build:native
npm run mobile:sync:android
```

On macOS with Xcode, iOS contributors can run:

```bash
npm run mobile:sync:ios
```

Android may be built on Windows, macOS, or Linux with Android SDK API 36 and JDK 21. iOS builds require macOS and Xcode and cannot be produced on Windows. From `android/`, validate Android changes with `gradlew lint testDebugUnitTest assembleDebug` using the host-appropriate wrapper. On macOS, validate iOS changes with an unsigned Simulator build before requesting review.

Native changes must preserve relative local assets, the no-Service-Worker native build, the core-offline/catalog-online boundary, canonical HTTPS scene sharing, safe-area and touch behavior, lifecycle and Android Back handling, and the minimal permission set. Keep [MOBILE.md](./MOBILE.md), [MOBILE-CN.md](./MOBILE-CN.md), [PRIVACY.md](./PRIVACY.md), and [PRIVACY-CN.md](./PRIVACY-CN.md) synchronized with observable behavior.

Do not commit credentials or claim a store or device milestone without evidence. Signing, release keys, certificates, provisioning profiles, TestFlight or Play tracks, store submissions, and publication require explicit owner authorization. The repository currently documents unsigned validation builds only and does not claim completed physical-device validation.

## Data and release boundaries

- Never commit generated MPCORB releases or raw source snapshots.
- Do not mutate an immutable release. Publish a new content-addressed dataset and update `.github/asteroid-dataset.json` only after validation.
- Application builds and datasets have separate identities. Keep both visible in Evidence and exports.
- Keep immutable catalog-sample identity separate from the locally effective point count. Share URLs may record sample and quality intent, but adaptive frame-time decisions are device-local.
- Do not label two-body or schematic output as an operational ephemeris, N-body result, risk assessment, or navigation product.

Use the issue templates for scientific correctness, data, browser compatibility, usability, or a guided-story proposal. A story proposal must define a learner question, reproducible observation sequence, primary sources, and the boundary between what the current model shows and what it cannot prove. Pull requests should be small enough to review and should explain any model, URL-schema, storage, or artifact-size change.
