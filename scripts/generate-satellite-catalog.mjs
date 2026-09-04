import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest } from './lib/inventory-snapshot.mjs'
import { makeSatelliteCatalog } from './lib/satellite-catalog.mjs'
import { SMALL_BODY_SATELLITE_SOURCES, smallBodySatelliteIdentities, smallBodyPrimaryIdentity, smallBodySourceLedger } from './lib/small-body-satellites.mjs'

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
const primaries = []
const sourceRecords = await Promise.all(report.sources.filter(source => source.id.startsWith('tnosat_')).map(async ({ id }) => {
  const bytes = await readFile(join(archive, `${id}.json`))
  return { id, record: JSON.parse(bytes), sha256: digest(bytes) }
}))
const sourceSelections = smallBodySourceLedger(sourceRecords)
for (const selection of SMALL_BODY_SATELLITE_SOURCES) {
  if (!report.sources.some(source => source.id === selection.id)) throw new Error('Selected component source is absent from the replayed survey')
  const sourceBytes = await readFile(join(archive, `${selection.id}.json`))
  bodies.push(...smallBodySatelliteIdentities(selection, JSON.parse(sourceBytes), digest(sourceBytes)))
  const primary = smallBodyPrimaryIdentity(selection, JSON.parse(sourceBytes), digest(sourceBytes))
  if (primary) primaries.push(primary)
}
if (new Set(bodies.map(body => body.id)).size !== bodies.length || new Set(bodies.filter(body => body.naifId !== undefined).map(body => body.naifId)).size !== bodies.filter(body => body.naifId !== undefined).length) throw new Error('Duplicate selected satellite identity')
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), primaries, sourceSelections,
  contract: 'Auditable satellite identities; no generated orbit, GM, phase, physical radius or claim of available ephemeris states.',
  source: { surveySha256: digest(bytes), discovery: { url: 'https://ssd.jpl.nasa.gov/sats/discovery.html', bytes: report.discovery.bytes, sha256: report.discovery.sha256 }, sourcePages: report.pageEvidence.map(({ url, sha256 }) => ({ url, sha256 })) }, bodies }
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: mode ? 'w' : 'wx' })
console.log(JSON.stringify({ identities: bodies.length, mapped: bodies.filter(body => body.naifId !== undefined).length, unresolved: bodies.filter(body => body.naifId === undefined).length }))
