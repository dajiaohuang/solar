import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const env = { ...process.env, SOLAR_ATLAS_WEB_EXECUTION: 'segmented', SOLAR_ATLAS_PRODUCT_PROFILE: 'full',
  SOLAR_ATLAS_EPHEMERIS_PROFILE: 'full', SOLAR_ATLAS_BUILD_ENV: 'vercel',
  SOLAR_ATLAS_INCLUDE_DATASET: process.env.SOLAR_ATLAS_CATALOG_URL ? '0' : '1' }
if (env.SOLAR_ATLAS_CATALOG_URL && !/^https:\/\//.test(env.SOLAR_ATLAS_CATALOG_URL)) throw new Error('SOLAR_ATLAS_CATALOG_URL must be an HTTPS dataset root')
if (!env.SOLAR_ATLAS_CATALOG_URL && !existsSync('public/data/asteroids/dataset-version.json')) {
  throw new Error('Install the pinned full catalog locally, or set SOLAR_ATLAS_CATALOG_URL to its published HTTPS dataset root (with CORS).')
}
const run = (args) => {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const approximationRoot = env.SOLAR_ATLAS_APPROXIMATION_DIR ?? 'public/data/approximation'
if (!existsSync(`${approximationRoot}/manifest.json`)) run(['--experimental-strip-types', 'scripts/build-segmented-ephemerides.mjs', '--out', approximationRoot])
run(['scripts/build-artifacts.mjs', 'prepare'])
run(['node_modules/typescript/bin/tsc', '-b'])
run(['node_modules/vite/bin/vite.js', 'build'])
run(['scripts/build-artifacts.mjs', 'finalize'])
run(['scripts/verify-build.mjs'])
