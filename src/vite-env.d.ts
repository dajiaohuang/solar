/// <reference types="vite/client" />

declare const __SOLAR_NATIVE__: boolean
declare const __SOLAR_EPHEMERIS_PROFILE__: 'pages' | 'full'
declare const __SOLAR_DATA_ROOT__: string

declare const __SOLAR_BUILD_INFO__: {
  version: string
  commitSha: string
  buildTime: string
  environment: string
  datasetVersion: string | null
}
