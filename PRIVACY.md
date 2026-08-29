# Solar Atlas privacy notice

Effective date: 2026-08-30

This notice describes the current Solar Atlas web source and the Capacitor 8 Android and iOS local-shell source projects. It does not represent an App Store or Play Store filing, and no signed mobile store release is currently claimed.

[中文说明](./PRIVACY-CN.md) · [Mobile builds](./MOBILE.md) · [Security policy](./SECURITY.md)

## Summary

Solar Atlas does not provide user accounts, advertising, analytics, behavioral tracking, telemetry, push notifications, or a project-operated data backend. The application is designed to perform simulation, rendering, search, and saved-scene work on the user's device.

Normal hosting and API providers can still receive network metadata such as IP addresses, request headers, timestamps, and requested paths under their own policies. Solar Atlas does not control or claim the absence of those provider logs.

## Information stored on the device

The application may store the following locally in browser or native WebView storage:

- language, onboarding completion, interface preferences, and saved scene libraries;
- versioned catalog manifests, samples, indexes, or detail responses fetched by the user, with bounded version-aware caches;
- temporary user-initiated export files in the native application cache. Deletion is attempted after the platform share flow completes.

No Solar Atlas account is required. Users can remove local data through the application's available scene controls, browser site-data controls, operating-system application-data controls, or by uninstalling the native application. There is no project account or project server record to delete.

## Network requests

The core curated-body experience and installed native application shell do not need catalog bodies to render. On startup, Solar Atlas requests the current catalog version pointer, manifest, and provenance metadata when available. Larger catalog samples, indexes, and detail shards are requested only when a catalog feature or restored scene needs them. Other network requests include:

- the hosted web application and published data at `https://dajiaohuang.github.io/solar/`;
- native catalog metadata, samples, indexes, and detail shards below `https://dajiaohuang.github.io/solar/data/asteroids`;
- a user-requested JPL Small-Body Database lookup at `https://ssd-api.jpl.nasa.gov/sbdb.api`, which sends the selected name, number, or designation needed for the query;
- external evidence or source links, which open in the platform browser and are governed by the destination's terms and privacy notice.

Uncached catalog data and live JPL requests are not available offline. A fetched response may remain in local cache, but Solar Atlas does not promise a complete offline catalog.

## Device signals and rendering

Viewport size, pointer type, frame timing, hardware concurrency, and browser-provided device-memory hints may be used locally to choose conservative rendering limits and adapt the 3D catalog-point budget. These signals are not sent to a Solar Atlas analytics or telemetry service.

## Platform permissions

- Android declares the `INTERNET` permission only. Cleartext network traffic and application backup are disabled.
- iOS does not request camera, microphone, location, contacts, photos, tracking, or notification access. Its privacy manifest declares no collected data and no tracking, and records the `FileTimestamp` required-reason API category used for application-private export files.

The exact store data-safety and privacy disclosures must be reassessed against the final signed binary and all release-time dependencies before any publication.

## Sharing and exports

Sharing or exporting is initiated by the user. On native platforms, Solar Atlas hands the chosen text, URL, or temporary file to the operating-system share sheet. The recipient application or service selected by the user applies its own privacy practices. Solar Atlas attempts to remove native temporary export files after sharing, but operating-system or share-sheet behavior can affect when the handoff completes.

## Children and sensitive use

Solar Atlas is an educational and exploratory astronomy application and does not intentionally collect personal information from children or adults. It is not an operational navigation, collision-warning, or safety service. Users should not submit personal or sensitive information in public issue reports.

## Changes and questions

Material behavior changes should update this notice and its Chinese counterpart. Privacy questions may be opened as a GitHub issue without personal information. Security-sensitive reports should follow [SECURITY.md](./SECURITY.md) rather than use a public issue.
