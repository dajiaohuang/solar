// Explicit supplement of an immutable survey. No arbitrary URL or source
// refresh: new BSP names must occur in its already archived JPL directory.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSource } from './crop-spk.mjs'
import { digest } from './lib/inventory-snapshot.mjs'
import { satelliteDirectoryUrls, surveySpkSource, replaySpkSurvey } from './lib/spk-source-survey.mjs'
import { parseSatelliteKernelIdentities, parseSatelliteEphemerisIndex, reconcileSatelliteIdentities } from './lib/satellite-ephemeris-index.mjs'
import { parsePlanetarySatellites } from './lib/satellite-inventory.mjs'
import { parseNaifSatelliteRegistry, resolveSatelliteRegistryClaims } from './lib/satellite-registry.mjs'

const [input, destination, names] = process.argv.slice(2)
if (!input || !destination || !names) throw new Error('Usage: node scripts/supplement-satellite-survey.mjs VERIFIED_ARCHIVE NEW_DIRECTORY FILE1.bsp,FILE2.bsp')
const directory = satelliteDirectoryUrls(await readFile(join(input, 'satellite-directory.html'), 'utf8'))
const filenames = names.split(',')
if (new Set(filenames).size !== filenames.length) throw new Error('Duplicate supplemental source')
const configurations = filenames.map(filename => {
  if (!/^[\w.-]+\.bsp$/.test(filename)) throw new Error('Unsafe source filename')
  const url = directory.find(url => url.endsWith(`/${filename}`))
  if (!url) throw new Error(`Source is not in the archived public directory: ${filename}`)
  return { id: filename.slice(0, -4), url, declaredUrl: url, reason: 'explicit-archived-directory-supplement' }
})
const verify = spawnSync(process.execPath, [fileURLToPath(new URL('./survey-satellite-ephemerides.mjs', import.meta.url)), '--verify', resolve(input)], { stdio: 'inherit' })
if (verify.status !== 0) throw new Error('Input survey did not pass offline replay')
const rawReport = await readFile(join(input, 'survey.json'))
const report = JSON.parse(rawReport)
if (configurations.some(config => report.sources.some(source => source.id.toLowerCase() === config.id.toLowerCase() || source.url === config.url))) throw new Error('Supplement cannot overwrite an existing source')
await mkdir(destination)
const retained = new Set(['discovery-input.html', ...report.pageEvidence.map(page => page.filename)])
const surveys = []
for (const evidence of report.evidenceFiles) {
  const record = JSON.parse(await readFile(join(input, evidence.filename)))
  retained.add(evidence.filename)
  record.reads.forEach(range => retained.add(`${evidence.id}-range-${range.start}.bin`))
  surveys.push(record)
}
for (const filename of retained) {
  if (!/^[\w.-]+$/.test(filename)) throw new Error('Unsafe archive path')
  await writeFile(join(destination, filename), await readFile(join(input, filename)), { flag: 'wx' })
}
for (const config of configurations) {
  const source = await openSource(config.url)
  try {
    const survey = await surveySpkSource(source, (start, bytes) => writeFile(join(destination, `${config.id}-range-${start}.bin`), bytes, { flag: 'wx' }))
    const record = { ...config, ...survey }
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
    await writeFile(join(destination, `${config.id}.json`), bytes, { flag: 'wx' })
    await replaySpkSurvey(destination, config.id, record)
    report.evidenceFiles.push({ id: config.id, filename: `${config.id}.json`, bytes: bytes.length, sha256: digest(bytes) })
    report.sources.push(config)
    surveys.push(record)
    console.log(`${config.id}: ${survey.targets.length} targets, ${survey.segments.length} segments`)
  } finally { await source.close() }
}
// A supplement does not silently refresh the registry already pinned by its
// input snapshot. It was replayed above and copied byte-for-byte.
let registryBytes
if (retained.has('naif-ids.html')) {
  registryBytes = await readFile(join(destination, 'naif-ids.html'))
} else {
const url = 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html'
const startedAt = new Date().toISOString()
const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
if (!response.ok || !response.body) throw new Error(`NAIF registry HTTP ${response.status}`)
const reader = response.body.getReader(), chunks = []
let length = 0
try {
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.length
    if (length > 1024 * 1024) throw new Error('Registry exceeds 1 MiB limit')
    chunks.push(chunk.value)
  }
} catch (error) { await reader.cancel(); throw error }
registryBytes = Buffer.concat(chunks)
await writeFile(join(destination, 'naif-ids.html'), registryBytes, { flag: 'wx' })
report.pageEvidence.push({ url, filename: 'naif-ids.html', startedAt, retrievedAt: new Date().toISOString(), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), bytes: registryBytes.length, sha256: digest(registryBytes) })
}
const registry = parseNaifSatelliteRegistry(registryBytes.toString('utf8'))
const index = parseSatelliteEphemerisIndex(await readFile(join(destination, 'planetary-ephemerides.html'), 'utf8'))
const discovery = parsePlanetarySatellites(await readFile(join(destination, 'discovery-input.html'), 'utf8')).records
const commentBodies = surveys.flatMap(survey => parseSatelliteKernelIdentities(survey.comments, survey.segments, survey.id))
const reconciliation = reconcileSatelliteIdentities(discovery, [...index.bodies, ...commentBodies])
const resolvedIdentities = resolveSatelliteRegistryClaims(discovery, reconciliation, commentBodies, registry)
const result = { ...report, generatedAt: new Date().toISOString(),
  supplementedFrom: { path: resolve(input), reportSha256: digest(rawReport) },
  commentBodies, reconciliation, resolvedIdentities, registry,
  supplementContract: 'Explicit new metadata sources and NAIF identity corroboration; not runtime selection or evaluated state coverage.' }
// The main survey verifier recomputes derived fields from raw evidence. Rebuild
// this intermediate report in another new directory before treating it as final.
await writeFile(join(destination, 'survey.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ resolved: resolvedIdentities.matched.length, unmatched: resolvedIdentities.unmatched.length, ambiguous: resolvedIdentities.ambiguous.length }))
