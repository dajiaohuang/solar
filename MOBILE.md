# Solar Atlas native applications

> Android and iOS are independent platform-native projects. The current native scope is the first vertical slice for verified current-state tiles; it is not a full-feature or store release milestone. There is no Capacitor Web shell and native builds do not package SPK files.

[中文说明](./MOBILE-CN.md) · [Privacy](./PRIVACY.md) · [Main README](./README.md)

## Current contract

| Item | Current contract |
| --- | --- |
| Runtime | Independent native Android and iOS fronts sharing the versioned backend protocol |
| Native slice | `manifest → plan → binary state tile` loading for exact current states, with typed `Float64` state values |
| View | Native 3D is the default; native 2D is an independent fallback/view, with separate rendering budgets |
| iOS controls | User-supplied HTTPS backend, TDB Julian date, built-in presets, custom body IDs, and reference ID |
| iOS cache | Verified state tiles use a bounded 256 MiB cache; cache reuse requires matching tile identity and hashes |
| Online boundary | Initial manifest and plan loading require the HTTPS backend. Previously verified tiles may be reused; complete offline plan recovery is not implemented |
| Pages | A curated Web preview only; it is not the native full-state backend |
| Validation / release status | Android has local real-SPK HTTPS emulator UI/cache evidence on 2026-09-05. Android/iOS CI builds and cross-runtime protocol checks passed; iOS also passed the real-SPK HTTPS simulator tests linked below. The new Android runtime CI gate requires its own successful run; real-device performance and store release remain unverified |

The native slice preserves scientific provenance, epoch, units, reference frame, validity and missing-state semantics. Missing precise states remain visibly unavailable; they are not replaced by approximate positions. The native slice does not claim all-body coverage, navigation accuracy, complete ephemeris access, or full Web feature parity.

## Prerequisites and checks

Verified on 2026-09-05 at commit `9461362762a9f0366abea6b665554c6dc6c9bf47`: [macOS iOS job](https://github.com/dajiaohuang/solar/actions/runs/33943036884/job/101244140251) passed the Go-to-Swift golden check, malformed-payload/cache/cancellation/projection tests, and an unsigned arm64/x86_64 simulator build with Xcode 26.6. The [Android job](https://github.com/dajiaohuang/solar/actions/runs/33943036884/job/101244140351) passed its build and Java golden checks. These are historical job results for that commit, not a claim that later checkouts or the entire PR are green. Neither job launched a simulator or verified live native HTTPS rendering.

At commit `d4f622495be549e8a29ba228d230fcd92d46086d`, the [real-SPK iOS runtime job](https://github.com/dajiaohuang/solar/actions/runs/33945353295/job/101250378243) passed two XCTest cases with zero failures (50.448 seconds). The retained report records three verified Earth/Moon/Sun states, an explicit missing-ID golden, mode switching, cache reuse and background recovery. Its HTTPS ledger contains two manifests, two plans and one tile, all HTTP 200; the reload reused the verified tile. This proves the tested simulator slice, not physical-device performance, all-body coverage or complete offline operation.

Use Node.js 22+ and npm 10+ for repository checks. `npm run native:check` is the static native-project check; it does not build or sign an application.

Android validation is run directly from the native project with Android SDK API 36 and JDK 21:

```text
android/gradlew -p android lint testDebugUnitTest assembleDebug
```

On Windows use `android/gradlew.bat -p android` with the same tasks. iOS validation requires macOS and Xcode:

```text
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
swiftc ios/App/App/StateTileDecoder.swift ios/App/App/StateTileCache.swift ios/App/App/NativeStateProjection.swift ios/ProtocolTests/ProtocolTests.swift -o <temporary-output>
<temporary-output>
```

These are contributor commands, not evidence that this checkout has passed them. No signing key, certificate, provisioning profile, store credential, or release account belongs in the repository. Real-device behavior, accessibility, memory pressure and store metadata require separate evidence and are not claimed here.

## Native behavior and boundaries

### Cross-runtime numerical verification

The mobile CI jobs generate binary tiles using the actual Go catalog and HTTP
handlers, then run the production Web decoder and the corresponding Java or
Swift decoder against those files. They compare all six Float64 bit patterns,
tile hashes, row ordering, manifest identities and exact/missing counts. The CI
SPK in that first check is explicitly synthetic: this proves wire interoperability, not astronomical
accuracy or live native networking.

The iOS workflow also runs `node scripts/ios-native-smoke.mjs` on macOS. This
runtime gate stages and hashes the real full SPK profile, checks an
Earth/Moon/Sun plus missing-ID golden in Go, Web and Swift, and launches the
native app through XCTest against a loopback HTTPS Go backend. It checks preset
loading, 3D/2D projection counts, online reload with verified tile-cache reuse,
background/foreground recovery, the tutorial and an unconfigured backend. It
creates a dedicated simulator and trusts a temporary CA only inside that device;
production TLS validation stays enabled. The owned device is removed afterward,
and private keys are excluded from artifacts. The owned temporary data directory
is removed after its resolved path is checked. Run from the repository
root with Node, Go, OpenSSL, Xcode and an installed iPhone simulator runtime.

Results, HTTPS request counts, logs and screenshot-bearing XCTest results are
retained under `build/ios-native-smoke/` and in the matching CI artifact. Existing
results are not overwritten. The gate passed at the exact runtime commit linked
above; later commits require their own successful run. It is not a real-device
FPS, complete offline, or full native feature-parity test. Historical evidence
remains tied to its original commit.

To repeat this locally, set `SOLAR_STATE_TILE_FIXTURE_DIR` to an absolute new or
empty directory outside the repository (`$env:SOLAR_STATE_TILE_FIXTURE_DIR` in
PowerShell; `export SOLAR_STATE_TILE_FIXTURE_DIR=...` in a POSIX shell), then run:

```text
go run ./cmd/state-tile-fixture -out <fixture-directory> -tile-size 1
npx vitest run tests/unit/state-tiles-golden.test.ts
```

Keep that environment variable set when running the Gradle or Swift test commands
above. A configured but absent fixture is an error; without the variable the
optional cross-runtime fixture check is skipped. Gradle tracks the directory as
a test input so changing from synthetic to real fixtures reruns the tests.
The generator also accepts `-data-dir`, `-inventory-dir`, `-ids` and `-epoch-jd`
for locally retained, hash-verified scientific profiles. Do not commit generated
fixtures or interpret matching serialization as an independent science oracle.

### Android real-data runtime verification

`node scripts/android-native-smoke.mjs` stages the real full SPK profile and
runs Go-to-Web/Java Float64 goldens before exercising the actual Android UI over
HTTPS. The local API 36 x86_64 run on 2026-09-05 passed Earth-reference states
for Earth/Moon/Sun plus an explicit missing ID, 3D/2D counts, visible point
pixels, tutorial and system-navigation bounds, and background/reload cache reuse.
Two manifests, two plans and one tile (all HTTP 200) prove the cached reload.
Pixel assertions prove rendering, not distinct pixels for overlapping bodies,
fixed size at every camera distance, physical-device performance or full parity.

Set `ANDROID_HOME` to an SDK with command-line tools, emulator and
`system-images;android-36;default;x86_64`, and `JAVA_HOME` to JDK 21. Go, Node
and OpenSSL must be available (`SOLAR_OPENSSL` may specify an executable path).
The script creates only its own temporary AVD and uses loopback port forwarding.
Only the instrumentation process trusts its temporary CA; production TLS and
hostname checks stay enabled, with no host/device-wide root certificate added.
Animations are disabled only on the disposable test device, so this is not a
frame-rate benchmark. Cleanup validates ownership before removing temporary data.

Artifacts default to `build/android-native-smoke/`; set
`SOLAR_ANDROID_SMOKE_OUTPUT` to a new directory for another local run. Existing
evidence is not overwritten. `report.json` records source commit/file hashes,
scientific manifest/golden identity, HTTPS traffic and cleanup errors; screenshots
and logs are retained without private keys. Local success does not establish
hosted CI success for later commits; require the exact Android runtime job.

### Interaction and data boundaries

- The first native screen is an Observation Deck for current-state evidence: selected body IDs, exact values, provenance and explicit gaps.
- iOS starts in native 3D and can switch to native 2D. The 3D and 2D budgets are independent; native 3D does not shrink or fade states solely because of distance.
- A request is bound to its manifest/plan identity and ordered IDs. Tiles are bounded, checksum-verified and published atomically only after the complete plan validates.
- Cancellation and latest-only loading prevent stale plans from replacing a newer selection. Verified tiles can be reused from the iOS cache after a new online plan identifies them.
- Native does not register or depend on a Web service worker, Capacitor bridge, or packaged SPK profile. SPK source files remain a scientific/backend delivery concern; they are not a native offline download.
- Manifest and plan access remains online even when individual tiles are cached. There is no complete offline plan/catalog restoration path yet.

## Privacy and distribution

Native clients have no project account, advertising, analytics, behavioral tracking or telemetry. The iOS state-tile service sends only the user-selected HTTPS endpoint, TDB epoch, preset/custom IDs and protocol request metadata to that endpoint. The bounded tile cache is local application data. See [PRIVACY.md](./PRIVACY.md) and [PRIVACY-CN.md](./PRIVACY-CN.md).

The Android and iOS projects are not represented as published, signed, store-approved or real-device-validated applications. Signing, TestFlight, Play testing tracks, store submissions and publication require separate authorization and evidence.
