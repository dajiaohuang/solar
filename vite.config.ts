import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ephemerisProfile } from './src/data/ephemerisProfile.ts'
import { productProfile } from './src/data/productProfile.ts'
import { productDelivery } from './scripts/lib/product-delivery.ts'
import { runtimeEphemerisManifest } from './src/engine/ephemeris/runtimeManifest.ts'

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
  const delivery = productDelivery(process.env.SOLAR_ATLAS_PRODUCT_PROFILE, process.env.SOLAR_ATLAS_EPHEMERIS_PROFILE)
  const manifestModule = resolve('src/data/selectedEphemerisManifest.ts').replace(/\\/g, '/')
  const manifestPlugin = () => ({
    name: 'solar-selected-runtime-manifest',
    load(id: string) {
      // Replace before import traversal: eager fallback initialization cannot
      // be eliminated by substituting a conditional constant alone.
      if (id.replace(/\\/g, '/') === manifestModule) {
        return 'export const selectedEphemerisManifest = __SOLAR_EPHEMERIS_MANIFEST__'
      }
    },
  })

  return {
    plugins: [manifestPlugin(), react()],
    worker: { plugins: () => [manifestPlugin()] },
    base: '/solar/',
    publicDir: command === 'serve' ? 'public' : false,
    // Dataset pipeline tests publish temporary directories atomically. Watching
    // those generated files can hold Windows handles across their rename.
    server: { watch: { ignored: ['**/.dataset-test-*/**', '**/test-results/**', '**/test-results-preview/**'] } },
    define: {
      __SOLAR_BUILD_INFO__: JSON.stringify(loadBuildInfo()),
      __SOLAR_PRODUCT_PROFILE__: JSON.stringify(productProfile(process.env.SOLAR_ATLAS_PRODUCT_PROFILE)),
      __SOLAR_EPHEMERIS_MANIFEST__: JSON.stringify(runtimeEphemerisManifest(delivery.manifest)),
      __SOLAR_EPHEMERIS_PROFILE__: JSON.stringify(ephemerisProfile(process.env.SOLAR_ATLAS_EPHEMERIS_PROFILE)),
      __SOLAR_DATA_ROOT__: JSON.stringify(delivery.product === 'preview' ? `/solar/${delivery.catalogDirectory}` : ''),
    },
    // Three.js is isolated in a lazy renderer chunk; 600 kB keeps the build
    // warning meaningful without flagging that deliberate route boundary.
    build: { chunkSizeWarningLimit: 600 },
  }
})
