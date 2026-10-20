import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { downloadApproximationArchive, installApproximationArchive } from './lib/approximation-archive.mjs'
import { installBuildDataset } from './lib/install-build-dataset.mjs'

const env = { ...process.env, SOLAR_ATLAS_WEB_EXECUTION: 'segmented', SOLAR_ATLAS_PRODUCT_PROFILE: 'full',
  SOLAR_ATLAS_EPHEMERIS_PROFILE: 'full', SOLAR_ATLAS_BUILD_ENV: 'vercel',
  SOLAR_ATLAS_INCLUDE_DATASET: process.env.SOLAR_ATLAS_CATALOG_URL ? '0' : '1' }
if (env.SOLAR_ATLAS_CATALOG_URL && !/^https:\/\//.test(env.SOLAR_ATLAS_CATALOG_URL)) throw new Error('SOLAR_ATLAS_CATALOG_URL must be an HTTPS dataset root')
if (!env.SOLAR_ATLAS_CATALOG_URL && !existsSync('public/data/asteroids/dataset-version.json')) {
  const pin = JSON.parse(readFileSync('.github/asteroid-dataset.json', 'utf8'))
  await installBuildDataset(pin)
}
const run = (args) => {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
let approximationRoot = env.SOLAR_ATLAS_APPROXIMATION_DIR ?? 'public/data/approximation'
if (env.SOLAR_ATLAS_APPROXIMATION_ARCHIVE_URL || env.SOLAR_ATLAS_APPROXIMATION_ARCHIVE_SHA256) {
  const sha256 = env.SOLAR_ATLAS_APPROXIMATION_ARCHIVE_SHA256 ?? ''
  const archive = await downloadApproximationArchive(env.SOLAR_ATLAS_APPROXIMATION_ARCHIVE_URL ?? '', sha256, '.cache/vercel-archives')
  approximationRoot = `.cache/vercel-archives/${sha256}`
  await installApproximationArchive(archive, sha256, approximationRoot)
  env.SOLAR_ATLAS_APPROXIMATION_DIR = approximationRoot
}
if (!existsSync(`${approximationRoot}/manifest.json`)) throw new Error('Precompute the unified 2000–2051 archive locally with npm run precompute:vercel before packaging; raw wide sources are not shipped in a Git checkout.')
const approximation = JSON.parse(readFileSync(`${approximationRoot}/manifest.json`, 'utf8'))
if (approximation.sourceManifestPath !== 'src/data/ephemeris-manifest-vercel-wide.json'
  || approximation.forecastPolicy?.requestedStartEt !== -43200 || approximation.forecastPolicy?.requestedEndEt !== 1609416000) throw new Error('Vercel requires the unified wide-source archive with explicit forecast publication; older/partial archives are not eligible.')
run(['--experimental-strip-types', 'scripts/verify-vercel-coverage.mjs', approximationRoot])
run(['scripts/build-artifacts.mjs', 'prepare'])
run(['node_modules/typescript/bin/tsc', '-b'])
run(['node_modules/vite/bin/vite.js', 'build'])
run(['scripts/build-artifacts.mjs', 'finalize'])
run(['scripts/verify-build.mjs'])
