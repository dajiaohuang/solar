import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest } from './lib/inventory-snapshot.mjs'
import { makeSatelliteCatalog } from './lib/satellite-catalog.mjs'

const [archive, output, mode] = process.argv.slice(2)
if (!archive || !output || (mode && mode !== '--replace-generated')) throw new Error('Usage: node scripts/generate-satellite-catalog.mjs VERIFIED_SURVEY OUTPUT.json [--replace-generated]')
if (mode) {
  const existing = JSON.parse(await readFile(output, 'utf8'))
  if (existing.schemaVersion !== 1 || !existing.source?.surveySha256 || !Array.isArray(existing.bodies) || !existing.contract?.startsWith('Auditable satellite identities;')) throw new Error('Refusing to replace an unrelated file')
}
const verification = spawnSync(process.execPath, [fileURLToPath(new URL('./survey-satellite-ephemerides.mjs', import.meta.url)), '--verify', resolve(archive)], { stdio: 'inherit' })
if (verification.status !== 0) throw new Error('Source survey replay failed')
const bytes = await readFile(join(archive, 'survey.json'))
const report = JSON.parse(bytes)
const bodies = makeSatelliteCatalog(report)
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  contract: 'Auditable satellite identities; no generated orbit, GM, phase, physical radius or claim of available ephemeris states.',
  source: { surveySha256: digest(bytes), discovery: { url: 'https://ssd.jpl.nasa.gov/sats/discovery.html', bytes: report.discovery.bytes, sha256: report.discovery.sha256 }, sourcePages: report.pageEvidence.map(({ url, sha256 }) => ({ url, sha256 })) }, bodies }
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: mode ? 'w' : 'wx' })
console.log(JSON.stringify({ identities: bodies.length, mapped: bodies.filter(body => body.naifId !== undefined).length, unresolved: bodies.filter(body => body.naifId === undefined).length }))
