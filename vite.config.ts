import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ephemerisProfile } from './src/data/ephemerisProfile.ts'

type BuildInfo = {
  version: string
  commitSha: string
  buildTime: string
  environment: string
  datasetVersion: string | null
}

function loadBuildInfo(): BuildInfo {
  const cachePath = resolve('.cache/solar-build-info.json')
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8')) as BuildInfo
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
  let commitSha = 'unknown'
  try { commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* Git is optional in packaged builds. */ }
  return {
    version: packageJson.version,
    commitSha,
    buildTime: new Date().toISOString(),
    environment: 'development',
    datasetVersion: null,
  }
}

export default defineConfig(({ command }) => {
  const isNative = process.env.SOLAR_ATLAS_BUILD_TARGET === 'native'
  const nativeDataRoot = (process.env.SOLAR_ATLAS_DATA_BASE_URL ?? 'https://dajiaohuang.github.io/solar/data/asteroids').replace(/\/+$/, '')
  if (isNative && !nativeDataRoot.startsWith('https://')) {
    throw new Error('Native catalog data must use an HTTPS origin')
  }

  return {
    plugins: [react()],
    base: isNative ? './' : '/solar/',
    publicDir: command === 'serve' ? 'public' : false,
    define: {
      __SOLAR_BUILD_INFO__: JSON.stringify(loadBuildInfo()),
      __SOLAR_NATIVE__: JSON.stringify(isNative),
      __SOLAR_EPHEMERIS_PROFILE__: JSON.stringify(ephemerisProfile(process.env.SOLAR_ATLAS_BUILD_TARGET, process.env.SOLAR_ATLAS_EPHEMERIS_PROFILE)),
      __SOLAR_DATA_ROOT__: JSON.stringify(isNative ? nativeDataRoot : ''),
    },
    // Three.js is isolated in a lazy renderer chunk; 600 kB keeps the build
    // warning meaningful without flagging that deliberate route boundary.
    build: { chunkSizeWarningLimit: 600 },
  }
})
