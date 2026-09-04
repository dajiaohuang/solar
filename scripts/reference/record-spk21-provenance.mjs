// Developer-only provenance capture after running the independent C oracle.
// Usage: node scripts/reference/record-spk21-provenance.mjs EXTERNAL_CACHE NEW_JSON
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const [cache, output] = process.argv.slice(2)
if (!cache || !output) throw new Error('External source cache and new output path required')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = []
for (const path of ['cspice.tar.Z', 'cspice/lib/cspice.a', 'cspice/src/cspice/spke21.c', 'cspice/src/cspice/spkr21.c', 'cspice/src/cspice/spkw21.c', 'tnosat_v001_20136199_jpl080_20220908.bsp', 'tnosat_v001b_20136108_jpl110_20221014.bsp']) {
  const bytes = await readFile(join(cache, path))
  sources.push({ path, bytes: bytes.length, sha256: digest(bytes) })
}
const horizons = []
for (const name of ['eris', 'haumea', 'makemake']) {
  const path = join(cache, `kernels/horizons-${name}-2020-01-01-2031-01-01.bsp`)
  const evidence = JSON.parse(await readFile(`${path}.json`, 'utf8'))
  const raw = await readFile(`${path}.source.bsp`), response = await readFile(`${path}.response.json`)
  if (digest(raw) !== evidence.source.sha256 || digest(response) !== evidence.source.responseSha256) throw new Error('Horizons source identity mismatch')
  horizons.push({ name, ...evidence.source })
}
const fixtures = []
for (const path of (await readdir('tests/fixtures')).filter(name => /^spk21-.*\.(bsp|json)$/.test(name) && !name.includes('provenance')).sort()) {
  const bytes = await readFile(join('tests/fixtures', path))
  fixtures.push({ path, bytes: bytes.length, sha256: digest(bytes) })
}
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, oracle: 'NAIF CSPICE N0067', sources, horizons, fixtures }, null, 2)}\n`, { flag: 'wx' })
