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
npm run test:unit
npm run test:scientific
npm run build
npm run test:e2e
npm run check:capacity
```

Scientific changes should add a unit fixture or a reproducible scene, cite a primary source, state the model and validity range, and distinguish numerical precision from physical uncertainty. UI changes must preserve English and Chinese coverage, keyboard access, mobile behavior, and reduced-motion preferences.

## Data and release boundaries

- Never commit generated MPCORB releases or raw source snapshots.
- Do not mutate an immutable release. Publish a new content-addressed dataset and update `.github/asteroid-dataset.json` only after validation.
- Application builds and datasets have separate identities. Keep both visible in Evidence and exports.
- Do not label two-body or schematic output as an operational ephemeris, N-body result, risk assessment, or navigation product.

Use the issue templates for scientific correctness, data, browser compatibility, usability, or a guided-story proposal. A story proposal must define a learner question, reproducible observation sequence, primary sources, and the boundary between what the current model shows and what it cannot prove. Pull requests should be small enough to review and should explain any model, URL-schema, storage, or artifact-size change.
