import { spawnSync } from 'node:child_process'
const root = process.env.SOLAR_ATLAS_APPROXIMATION_DIR ?? 'public/data/approximation'
const run = args => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['scripts/prepare-vercel-wide-sources.mjs'])
run(['scripts/build-segmented-ephemerides.mjs', '--source-manifest', 'src/data/ephemeris-manifest-vercel-wide.json', '--out', root, ...process.argv.slice(2)])
run(['scripts/build-vercel-forecasts.mjs', root])
run(['scripts/verify-vercel-coverage.mjs', root])
