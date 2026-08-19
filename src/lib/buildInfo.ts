export type BuildInfo = {
  version: string
  commitSha: string
  buildTime: string
  environment: string
  datasetVersion: string | null
}

declare const __SOLAR_BUILD_INFO__: BuildInfo

export const BUILD_INFO = __SOLAR_BUILD_INFO__
