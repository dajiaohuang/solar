// Explicit opt-in, serial, metadata-only survey. Never loads kernels at app startup.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openSource } from './crop-spk.mjs'
import { digest } from './lib/inventory-snapshot.mjs'
import { parsePlanetarySatellites } from './lib/satellite-inventory.mjs'
import { parseSatelliteEphemerisIndex, parseSatelliteKernelIdentities, reconcileSatelliteIdentities } from './lib/satellite-ephemeris-index.mjs'
import { classifySatelliteAssignments, classifySatelliteSource, locateSatelliteSource, replaySpkSurvey, satelliteDirectoryUrls, surveySpkSource } from './lib/spk-source-survey.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
function toEt(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Invalid TDB calendar date')
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('Invalid TDB calendar date')
  return (ms / 86400000 + 2440587.5 - 2451545) * 86400
}
const verify = option('--verify')
const rebuild = option('--rebuild')
function deriveReport(report, index, surveys, discoveryRecords) {
  const startEt = toEt(report.from), endEt = toEt(report.to)
  if (startEt >= endEt) throw new Error('Reversed survey time window')
  const bodies = index.bodies.map(body => classifySatelliteAssignments(body, surveys, startEt, endEt))
  const commentBodies = [...surveys].flatMap(([id, survey]) => parseSatelliteKernelIdentities(survey.comments, survey.segments, id))
  const commentClassifications = commentBodies.map(body => classifySatelliteSource(body, surveys.get(body.ephemeris), startEt, endEt))
  const reconciliation = reconcileSatelliteIdentities(discoveryRecords, [...index.bodies, ...commentBodies])
  const statuses = Object.fromEntries([...new Set(bodies.map(body => body.status))].map(status => [status, bodies.filter(body => body.status === status).length]))
  return { schemaVersion: 2, bodies, commentBodies, commentClassifications, reconciliation,
    summary: { listedBodies: bodies.length, sourceCount: report.sources.length, inspectedSources: surveys.size, errors: report.errors.length, statuses,
      commentIdentityRecords: commentBodies.length,
      uniqueIdentifiedTargets: new Set([...index.bodies, ...commentBodies].map(body => body.naifId)).size,
      discoveryMatched: reconciliation.matched.length, discoveryUnmatched: reconciliation.unmatched.length, discoveryAmbiguous: reconciliation.ambiguous.length } }
}
if (verify || rebuild) {
  if (verify && rebuild) throw new Error('Choose either --verify or --rebuild')
  const archive = verify ?? rebuild
  const reportBytes = await readFile(join(archive, 'survey.json'))
  const report = JSON.parse(reportBytes)
  const retained = new Set(['discovery-input.html'])
  for (const page of report.pageEvidence) {
    if (!/^[\w.-]+$/.test(page.filename)) throw new Error('Unsafe archived page path')
    const bytes = await readFile(join(archive, page.filename))
    if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw new Error('Archived source page integrity mismatch')
    retained.add(page.filename)
  }
  const discovery = await readFile(join(archive, 'discovery-input.html'))
  if (discovery.length !== report.discovery.bytes || digest(discovery) !== report.discovery.sha256) throw new Error('Archived discovery integrity mismatch')
  if (!retained.has('planetary-ephemerides.html') || !retained.has('satellite-directory.html')) throw new Error('Missing source page evidence')
  const index = parseSatelliteEphemerisIndex(await readFile(join(archive, 'planetary-ephemerides.html'), 'utf8'))
  const surveys = new Map()
  for (const evidence of report.evidenceFiles) {
    if (!/^[\w.-]+$/.test(evidence.id) || evidence.filename !== `${evidence.id}.json`) throw new Error('Unsafe archived survey path')
    if (surveys.has(evidence.id)) throw new Error('Duplicate archived survey identifier')
    const bytes = await readFile(join(archive, evidence.filename))
    if (bytes.length !== evidence.bytes || digest(bytes) !== evidence.sha256) throw new Error('Archived survey integrity mismatch')
    const record = JSON.parse(bytes)
    surveys.set(evidence.id, await replaySpkSurvey(archive, evidence.id, record))
    retained.add(evidence.filename)
    for (const range of record.reads) {
      if (!Number.isSafeInteger(range.start) || range.start < 0) throw new Error('Unsafe archived range offset')
      retained.add(`${evidence.id}-range-${range.start}.bin`)
    }
  }
  const derived = deriveReport(report, index, surveys, parsePlanetarySatellites(discovery.toString('utf8')).records)
  if (rebuild) {
    const output = option('--output')
    if (!output) throw new Error('--rebuild requires a new --output directory')
    // Reinterpret verified immutable raw evidence; never alter an earlier result
    // or fetch a different live source while repairing the parser.
    await mkdir(output)
    for (const filename of retained) await writeFile(join(output, filename), await readFile(join(archive, filename)), { flag: 'wx' })
    const result = { ...report, ...derived, generatedAt: new Date().toISOString(),
      derivedFrom: { path: resolve(archive), reportSha256: digest(reportBytes), rawEvidenceReplayed: true } }
    await writeFile(join(output, 'survey.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
    console.log(JSON.stringify(result.summary))
    process.exit(0)
  }
  for (const field of Object.keys(derived)) if (JSON.stringify(derived[field]) !== JSON.stringify(report[field])) throw new Error(`Satellite ${field} replay mismatch; use --rebuild to reinterpret historical raw evidence in a new directory`)
  console.log(`Offline source/descriptor/identity replay passed: ${report.evidenceFiles.length} sources. Source errors retained: ${report.errors.length}. Not a state-vector validation.`)
  process.exit(0)
}
const output = option('--output')
const discoveryPath = option('--discovery')
if (!output || !discoveryPath) throw new Error('Usage: node scripts/survey-satellite-ephemerides.mjs --output NEW_DIRECTORY --discovery FROZEN_DISCOVERY_HTML [--from YYYY-MM-DD --to YYYY-MM-DD]')
const from = option('--from', '2020-01-01'), to = option('--to', '2031-01-01')
const startEt = toEt(from), endEt = toEt(to)
if (startEt >= endEt) throw new Error('Reversed survey time window')
const root = resolve(output)
// Keep every survey immutable, including failed or partial runs.
await mkdir(root)
const pageEvidence = []
async function page(url, filename) {
  const startedAt = new Date().toISOString()
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok || !response.body) throw new Error(`Source HTTP ${response.status}: ${url}`)
  const chunks = []; let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 8 * 1024 * 1024) throw new Error('Source page exceeds 8 MiB limit')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel(); throw error }
  const bytes = Buffer.concat(chunks)
  await writeFile(join(root, filename), bytes, { flag: 'wx' })
  pageEvidence.push({ url, filename, startedAt, retrievedAt: new Date().toISOString(), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), bytes: bytes.length, sha256: digest(bytes) })
  return bytes.toString('utf8')
}
const index = parseSatelliteEphemerisIndex(await page('https://ssd.jpl.nasa.gov/sats/ephem/', 'planetary-ephemerides.html'))
const directoryUrls = satelliteDirectoryUrls(await page('https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/', 'satellite-directory.html'))
const discoveryBytes = await readFile(discoveryPath)
const discovery = parsePlanetarySatellites(discoveryBytes.toString('utf8'))
await writeFile(join(root, 'discovery-input.html'), discoveryBytes, { flag: 'wx' })
const sources = index.sources.map(source => ({ ...source, ...locateSatelliteSource(source.url, directoryUrls) }))
// Keep all published small-body satellite deliveries, including superseded
// versions; later selection must explicitly choose a consistent source model.
for (const url of directoryUrls.filter(url => /\/tnosat_[\w.-]+\.bsp$/.test(url))) {
  sources.push({ id: url.split('/').at(-1).slice(0, -4), declaredUrl: url, url, reason: 'published-small-body-satellite-directory' })
}
const surveys = [], errors = [], evidenceFiles = []
for (const config of sources) {
  if (!config.url) { errors.push({ id: config.id, reason: config.reason, declaredUrl: config.declaredUrl }); continue }
  if (!/^[\w.-]+$/.test(config.id)) throw new Error('Unsafe source identifier')
  try {
    const source = await openSource(config.url)
    let survey
    try {
      survey = await surveySpkSource(source, (start, bytes) => writeFile(join(root, `${config.id}-range-${start}.bin`), bytes, { flag: 'wx' }))
    } finally { await source.close() }
    const record = { ...config, ...survey }
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
    await writeFile(join(root, `${config.id}.json`), bytes, { flag: 'wx' })
    evidenceFiles.push({ id: config.id, filename: `${config.id}.json`, bytes: bytes.length, sha256: digest(bytes) })
    surveys.push(record)
    console.log(`${config.id}: ${survey.targets.length} targets, ${survey.segments.length} segments, ${survey.reads.reduce((sum, read) => sum + read.length, 0)} metadata bytes`)
  } catch (error) {
    errors.push({ id: config.id, url: config.url, reason: String(error) })
    console.error(`${config.id}: ${error}`)
  }
}
const result = {
  generatedAt: new Date().toISOString(), from, to, timeScale: 'TDB',
  contract: 'Source identity and SPK descriptor survey only; not evaluated states, numerical validation, runtime selection, or full physical coverage.',
  pageEvidence, discovery: { sourcePath: resolve(discoveryPath), bytes: discoveryBytes.length, sha256: digest(discoveryBytes), count: discovery.records.length },
  sources, evidenceFiles, errors,
  ...deriveReport({ from, to, sources, errors }, index, new Map(surveys.map(survey => [survey.id, survey])), discovery.records),
}
await writeFile(join(root, 'survey.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify(result.summary))
if (errors.length) process.exitCode = 2
