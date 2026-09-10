/// <reference types="vite/client" />

declare const __SOLAR_PRODUCT_PROFILE__: 'full' | 'preview'
declare const __SOLAR_EPHEMERIS_MANIFEST__: ReturnType<typeof import('./engine/ephemeris/runtimeManifest').runtimeEphemerisManifest>
declare const __SOLAR_EPHEMERIS_PROFILE__: 'pages' | 'full'
declare const __SOLAR_DATA_ROOT__: string

declare const __SOLAR_BUILD_INFO__: {
  version: string
  commitSha: string
  buildTime: string
  environment: string
  datasetVersion: string | null
}
