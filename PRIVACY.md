# Solar Atlas privacy notice

Effective date: 2026-09-05

This notice describes the client source in this repository. Web, Android and iOS are separate clients; the native first slice is an independent platform-native current-state tile viewer, not a Web shell. This is not an App Store or Play Store filing, and no signed mobile release is claimed.

[中文说明](./PRIVACY-CN.md) · [Native contract](./MOBILE.md) · [Security policy](./SECURITY.md)

## Summary

Solar Atlas has no user accounts, advertising, analytics, behavioral tracking, telemetry, push notifications or project-operated user-data backend. Simulation, rendering and saved-scene work run on the user's device. Hosting and API providers may receive ordinary network metadata such as IP address, headers, timestamps and requested paths under their own policies.

## Information stored on the device

Clients may store language, onboarding and interface preferences, saved scenes, versioned Web catalog data, and temporary user-initiated exports. The native first slice additionally stores verified binary state tiles in local application storage. iOS bounds this tile cache at 256 MiB and evicts entries as needed. A cached tile is reusable only after an online manifest/plan identifies the same tile and its hashes; there is no complete offline plan/catalog recovery path.

No project account or project server record is created. Users can remove local data through browser site-data controls, operating-system application-data controls, scene controls where available, or by uninstalling the native application.

## Network requests

The Web preview is hosted at `https://dajiaohuang.github.io/solar/`. Native current-state loading uses a user-supplied HTTPS backend and requests a manifest, a bounded plan, and verified binary tiles. On iOS, the request can include the selected TDB Julian date, preset/custom body IDs and reference ID. The service sends protocol metadata needed to validate identity, provenance, ordering, sizes and hashes; it does not send unrelated device telemetry.

Uncached native manifest/plan requests require a network connection even when some tiles are cached. External evidence links and any user-requested JPL SBDB lookup are sent to the selected destination and follow that destination's policy. The Web service worker and native tile cache are separate storage boundaries.

## Device signals and permissions

Viewport, pointer type, frame timing and browser-provided hardware hints may be used locally for conservative Web rendering budgets. They are not sent to a Solar Atlas analytics service. iOS uses UserDefaults for local endpoint/tutorial preferences (declared reason API `CA92.1`) and file timestamps for cache/export bookkeeping (declared reason API `C617.1`). Native clients request only the permissions needed by their platform implementation; exact store disclosures must be reassessed against the final signed binary and dependencies.

## Sharing and exports

Sharing and export are user initiated. Native clients hand the selected text, URL or temporary file to the platform share sheet; the receiving application applies its own privacy practices. Solar Atlas attempts to remove temporary native export files after sharing.

## Children and sensitive use

Solar Atlas is an educational astronomy application and does not intentionally collect personal information. It is not an operational navigation, collision-warning or safety service. Do not submit personal or sensitive information in public issues.

## Changes and questions

Material behavior changes should update this notice and its Chinese counterpart. Privacy questions may be opened as a GitHub issue without personal information. Security-sensitive reports should follow [SECURITY.md](./SECURITY.md).
