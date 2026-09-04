# Solar Atlas mobile applications

Solar Atlas includes **Capacitor 8 local-shell projects** for Android and iOS. They are buildable source projects, not published store products. CI may produce an Android debug APK signed with the standard disposable debug key, but the repository does not claim a release-signed APK, AAB, or IPA, a Play Store or App Store listing, TestFlight distribution, or completed real-device validation.

[中文说明](./MOBILE-CN.md) · [Privacy](./PRIVACY.md) · [Main README](./README.md)

## Current contract

| Item | Current implementation |
| --- | --- |
| Runtime | Capacitor 8 wrapping the locally built web application |
| Application ID | `io.github.dajiaohuang.solaratlas` |
| Node.js | 22+; npm 10+ |
| Android | Minimum API 24; compile and target API 36 |
| iOS | 16.4 or later |
| Core experience | Curated bodies, presets, stories, Evidence, and the local application shell remain available offline after installation |
| Catalog data | Version/provenance metadata is checked at startup; samples, indexes, and shards load on demand over HTTPS from `https://dajiaohuang.github.io/solar/data/asteroids` |
| Physical ephemerides | Native defaults to the full profile: 510 SHA-pinned SPK files (1094.7 MiB), offline and loaded on demand. Web and native share type 2/3/17/21 evaluation and explicit source-specific center pools. Full satellite additions span 2020–2031 TDB; Pages shortens large satellite files to 2026–2027 without dropping target identities. Tests resolve 508 selectable centers at UTC JD 2461287.5, not all bodies. Eris/Haumea primary centers and their moons end at 2030-01-02 TDB; Makemake retains an approximate fallback. UTC→TT→TDB is supported from 1972; future leap seconds are uncertain. |
| Release status | Source and non-release validation paths only; release signing and store publication are not authorized or included |

Quaoar/Weywot, Orcus/Vanth, Salacia/Actaea, 1998 WW31/Sat1, 2001 QW322/Sat1,
Kagara/Haunu, 1999 OJ4/Sat1 and 2003 UN284/Sat1
retain ten-year original system files (2020-01-01/2030-01-01 TDB) in the native
full profile. Pages uses 2026-07-01/2027-01-01 for these eight systems. Neither
profile invents a fallback for these new primaries or companions.

The native build uses relative local assets and does not register the web Service Worker. Offline native operation therefore comes from the installed local shell, not from the PWA cache. The full MPCORB catalog is intentionally not bundled: catalog samples, detail shards, and live JPL SBDB lookups require a network connection unless a previously fetched response remains in the WebView cache.

SPK focus ephemerides and the geometric/light-time/stellar-aberration observation readouts follow the bundled manifest when those kernel assets are present. They do not turn the app into an all-body precision or navigation product; no gravity deflection, atmosphere, surface observer, or covariance model is included. The GPU catalog cloud remains Keplerian.

The [all-body source inventory](./docs/all-body-inventory.md) is an explicit developer audit, not an installed mobile catalog. Native sync neither downloads nor copies those generated shards; the current offline/online boundary is unchanged. Inventory coverage and usable mobile ephemeris coverage must be reported separately.

## Prerequisites

The shared web shell includes satellite-scale 3D framing, portrait-resize handling and km/hour orbital readouts. After changing these shared features, run `npm run mobile:sync` to refresh both native asset bundles and validate Android/iOS CI. Browser viewport tests are not a substitute for real-device touch, rotation or performance testing.

Install Node.js 22+, npm 10+, and the platform toolchain:

- Android: Android Studio, Android SDK API 36, and JDK 21. Android builds can run on Windows, macOS, or Linux when that toolchain is installed.
- iOS: macOS and Xcode are required. Windows cannot build, run, sign, or archive the iOS application.

No signing key, certificate, provisioning profile, store credential, or release account belongs in the repository.

The generated iOS package graph pins Capacitor to 8.5.0 and `ion-ios-filesystem` to the Xcode-verified 1.1.2 release. The post-sync normalizer reapplies those paths and pins after every Capacitor sync so a fresh checkout resolves the same native dependency versions.

## Build and sync

Build the local native shell first:

```bash
npm ci
npm run build:native
```

For Android:

```bash
npm run mobile:sync:android
npm run mobile:open:android
```

The Android project can also run its local validation tasks from `android/`:

```powershell
.\gradlew.bat lint testDebugUnitTest assembleDebug
```

On macOS, for iOS:

```bash
npm run mobile:sync:ios
npm run mobile:open:ios
```

`npm run mobile:sync` synchronizes both platforms and is therefore intended for a macOS environment with both toolchains. These commands create or refresh local platform builds; they do not create a signed store release.

The mobile workflow is configured to build an **Android debug APK signed with Gradle's standard disposable debug key** and an **unsigned iOS Simulator app** as short-lived validation artifacts. Neither is a release artifact. A configured workflow is not evidence that a particular commit has passed until its run and artifacts have been inspected.

## Native behavior

- Scene links shared from the app use the canonical public HTTPS URL so they remain usable outside the native shell.
- The custom `solaratlas://scene?...` URL scheme can open a scene in the installed app. Verified Android App Links and iOS Universal Links are not currently claimed.
- User-initiated scene sharing and exports use the platform share sheet. Export files are written to the application cache and deletion is attempted after sharing.
- Ordinary external HTTPS links open in the platform browser.
- Backgrounding pauses a running simulation and foregrounding resumes it only when it was previously playing.
- Android Back first dismisses the tutorial or an active in-app layer, then follows application/browser history, and finally minimizes the app.
- The interface supports portrait and landscape layouts, safe-area insets, touch input, the adaptive 3D renderer, and automatic 2D fallback when WebGL creation or context recovery fails.

## Permissions and privacy

Android declares only network access through `INTERNET`; cleartext traffic and application backup are disabled. The iOS project has no camera, microphone, location, contacts, photos, tracking, or notification usage request. Its privacy manifest declares no collected data and records the required-reason file-timestamp API used by the local export path.

See [PRIVACY.md](./PRIVACY.md) for the current source-level privacy notice. Store privacy labels must be reviewed again against the exact signed release, bundled dependencies, and store configuration before publication.

## Acceptance checklist

Before calling a mobile release complete, verify on representative physical devices as well as emulators/simulators:

- first-run tutorial choice, direct Observation Deck entry, safe areas, status-bar contrast, rotation, keyboard/accessibility services, and reduced motion;
- touch camera controls, selection, drawers, four-item navigation, 3D/2D switching, WebGL context loss, and memory-pressure recovery;
- core offline launch after installation, with honest unavailable/retry states for catalog and JPL requests;
- custom-scheme scene import, canonical HTTPS sharing, JSON/CSV/image export, external-browser handoff, lifecycle pause/resume, and Android Back behavior;
- Android API 24 and 36 behavior, and iOS 16.4 plus a current iOS version;
- privacy manifests, permissions, signing identities, icons, screenshots, store metadata, accessibility declarations, and data-safety/privacy answers for the exact release binary.

This checklist has not yet been represented as completed real-device evidence. Do not describe the mobile applications as published or device-validated until that evidence and the relevant store records exist.

## Distribution boundary

Signing, notarization, TestFlight, Play testing tracks, store submissions, paid developer accounts, production certificates, release keys, and publication are external state changes. They require explicit repository-owner authorization and controlled credentials. The current implementation stops before those steps.
