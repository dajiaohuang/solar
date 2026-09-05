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

Every pull request must pass the read-only `Repository contract` check, which parses repository metadata, verifies local Markdown links and anchors, and keeps the Web, Android, iOS, citation, and bilingual README identities synchronized. Pull requests that change code, configuration, workflows, or production assets must also pass `Web quality`: lint, unit and scientific validation, a production build and capacity check, Chromium interaction/accessibility coverage, and Lighthouse budgets. Documentation-only changes intentionally skip the expensive browser job, but never skip the repository contract. Branch protection requires only the stable `Pull request quality gate` summary from GitHub Actions, including for administrators; the summary fails unless every applicable job succeeds. The workflow has read-only repository access and does not deploy.

Scientific changes should add a unit fixture or a reproducible scene, cite a primary source, state the model and validity range, and distinguish numerical precision from physical uncertainty. UI changes must preserve English and Chinese coverage, keyboard access, mobile behavior, and reduced-motion preferences.

Renderer changes must keep the focus layer and catalog cloud separate. Named focus bodies may carry trajectories, labels, picking, and analysis; bulk catalog objects belong in shared typed arrays and a bounded GPU point buffer. Preserve the default zero-sample-request Observation Deck, the 3D-to-2D fallback, and both mobile and desktop Playwright coverage. Treat memory and CPU APIs as conservative hints only; require measured real-device evidence before claiming that a hardware tier is guaranteed smooth.

## Native applications

Android and iOS are independent platform-native projects. The current scope is the first vertical slice for exact current-state binary tiles (`manifest → plan → tile`), not a full-feature app. There is no Capacitor Web shell or native SPK packaging. Native 3D is the default, native 2D is independent, and the iOS slice accepts an HTTPS backend, TDB Julian date, preset/custom IDs and a reference ID. iOS keeps a bounded 256 MiB verified-tile cache; manifest and plan loading remains online, so complete offline plan recovery is not implemented.

Run the static project check after ordinary Web checks:

```bash
npm run native:check
```

Android validation runs directly from the native project with Android SDK API 36 and JDK 21:

```text
android/gradlew -p android lint testDebugUnitTest assembleDebug
```

On Windows use `android/gradlew.bat -p android`. iOS validation requires macOS and Xcode:

```text
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
swiftc ios/App/App/StateTileDecoder.swift ios/App/App/StateTileCache.swift ios/App/App/NativeStateProjection.swift ios/App/App/NativeCoverageReport.swift ios/ProtocolTests/ProtocolTests.swift -o <temporary-output>
<temporary-output>
```

These commands are validation instructions, not evidence that a build or test has passed. Do not claim full feature coverage, real-device validation, signed binaries, store milestones or release readiness without explicit evidence. Keep [MOBILE.md](./MOBILE.md), [MOBILE-CN.md](./MOBILE-CN.md), [PRIVACY.md](./PRIVACY.md), and [PRIVACY-CN.md](./PRIVACY-CN.md) synchronized with observable native behavior.

## Data and release boundaries

- Never commit generated MPCORB releases or raw source snapshots.
- Do not mutate an immutable release. Publish a new content-addressed dataset and update `.github/asteroid-dataset.json` only after validation.
- Application builds and datasets have separate identities. Keep both visible in Evidence and exports.
- Keep immutable catalog-sample identity separate from the locally effective point count. Share URLs may record sample and quality intent, but adaptive frame-time decisions are device-local.
- Do not label two-body or schematic output as an operational ephemeris, N-body result, risk assessment, or navigation product.

Use the issue templates for scientific correctness, data, browser compatibility, usability, or a guided-story proposal. A story proposal must define a learner question, reproducible observation sequence, primary sources, and the boundary between what the current model shows and what it cannot prove. Pull requests should be small enough to review and should explain any model, URL-schema, storage, or artifact-size change.
