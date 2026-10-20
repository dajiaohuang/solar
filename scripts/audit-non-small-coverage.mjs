// Read-only scientific audit: descriptor availability is not numerical acceptance.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { openSource } from './crop-spk.mjs'
import { surveySpkSource, satelliteDirectoryUrls, locateSatelliteSource } from './lib/spk-source-survey.mjs'
import { parseSatelliteEphemerisIndex } from './lib/satellite-ephemeris-index.mjs'

const args = process.argv.slice(2), outputIndex = args.indexOf('--output')
const verifyIndex = args.indexOf('--verify')
if (verifyIndex >= 0) {
  const root = resolve(args[verifyIndex + 1])
  const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'))
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  if (digest(await readFile('src/data/ephemeris-manifest-full.json')) !== report.sourceManifestSha256
    || digest(await readFile('public/data/approximation/manifest.json')) !== report.approximationManifestSha256) throw new Error('Current manifests differ from the audited baseline')
  for (const page of report.pages) {
    if (!/^[\w.-]+$/.test(page.filename)) throw new Error('Unsafe archived page path')
    const bytes = await readFile(join(root, page.filename))
    if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw new Error('Archived page checksum mismatch')
  }
  for (const receipt of report.inspectedSources) {
    if (!/^[a-f0-9]{16}$/.test(receipt.id)) throw new Error('Unsafe archived source path')
    const directory = join(root, 'sources', receipt.id)
    const record = JSON.parse(await readFile(join(directory, 'survey.json'), 'utf8'))
    // This receipt hashes the canonical JSON object, not pretty-print bytes.
    if (digest(JSON.stringify(record)) !== receipt.sha256OfSurvey) throw new Error('Archived survey object checksum mismatch')
    const source = { size: record.source.bytes, identity: record.source, async read(start, length) {
      const range = record.reads.find(range => range.start === start && range.length === length)
      if (!range) throw new Error('Missing archived SPK descriptor range')
      const bytes = await readFile(join(directory, `range-${start}.bin`))
      if (bytes.length !== length || digest(bytes) !== range.sha256) throw new Error('Archived SPK range checksum mismatch')
      return bytes
    } }
    const replay = await surveySpkSource(source)
    for (const field of ['reads', 'segments', 'targets', 'comments']) {
      if (JSON.stringify(replay[field]) !== JSON.stringify(record[field])) throw new Error(`SPK descriptor replay differs: ${receipt.id}, ${field}`)
    }
  }
  console.log(`Source evidence replayed for a report containing ${report.rows.length} rows: ${report.pages.length} pages and ${report.inspectedSources.length} archived SPK descriptor surveys; no network or state-vector evaluation.`)
  process.exit(0)
}
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('Use --output NEW_DIRECTORY; only source pages and SPK metadata are fetched')
const output = resolve(args[outputIndex + 1])
await mkdir(output) // Preserve previous runs; never overwrite a completed audit.
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const from = -43200, to = 1609416000
const date = et => new Date((et / 86400 + 2451545 - 2440587.5) * 86400000).toISOString().replace('Z', ' TDB')
const rawManifest = await readFile('src/data/ephemeris-manifest-full.json')
const sourceManifest = JSON.parse(rawManifest)
const rawApproximation = await readFile('public/data/approximation/manifest.json')
const approximation = JSON.parse(rawApproximation)
if (approximation.sourceManifestSha256 !== hash(rawManifest)) throw new Error('Approximation and source manifest identities differ')
const provenance = { generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceManifestSha256: hash(rawManifest), approximationManifestSha256: hash(rawApproximation),
  requestedWindow: { from: '2000-01-01', to: '2051-01-01', startEt: from, endEt: to, timeScale: 'TDB' } }
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
let registry
try {
  const { majorBodies } = await server.ssrLoadModule('/src/data/majorBodies.ts')
  const { SCIENTIFIC_SPACECRAFT } = await server.ssrLoadModule('/src/data/scientificSpacecraft.ts')
  const { bodyNaifId } = await server.ssrLoadModule('/src/data/ephemerisTargets.ts')
  registry = [...majorBodies, ...SCIENTIFIC_SPACECRAFT].map(body => ({ id: body.id, name: body.shortName ?? body.name,
    kind: body.kind, parentId: body.parentId ?? 'sun', target: bodyNaifId(body) ?? null }))
} finally { await server.close() }
const selected = registry.filter(body => ['star', 'planet', 'dwarfPlanet', 'moon', 'spacecraft'].includes(body.kind))
const byId = new Map(registry.map(body => [body.id, body]))
const approximationById = new Map(approximation.bodies.map(body => [body.id, body]))
function gaps(ranges, start = from, end = to) {
  let cursor = start
  const missing = []
  for (const [a, b] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (b < cursor || a > end) continue
    if (a > cursor) missing.push([cursor, Math.min(a, end)])
    cursor = Math.max(cursor, b)
  }
  if (cursor < end) missing.push([cursor, end])
  return missing
}
const pages = [], errors = []
async function page(url, filename) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 8 * 1048576) throw new Error('Source page exceeds metadata budget')
  await writeFile(join(output, filename), bytes, { flag: 'wx' })
  pages.push({ url, filename, bytes: bytes.length, sha256: hash(bytes), retrievedAt: new Date().toISOString(), lastModified: response.headers.get('last-modified') })
  return bytes.toString('utf8')
}
const index = parseSatelliteEphemerisIndex(await page('https://ssd.jpl.nasa.gov/sats/ephem/', 'satellite-ephemerides.html'))
const directory = satelliteDirectoryUrls(await page('https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/', 'satellite-directory.html'))
const wanted = new Set(selected.map(body => body.target).filter(Number.isSafeInteger))
// Small-body primaries stay out of the audited population, but their center
// trajectories are required dependencies of the selected satellite states.
for (const body of selected) { const parent = byId.get(body.parentId); if (parent?.target !== null && parent?.target !== undefined) wanted.add(parent.target) }
const rootFiles = sourceManifest.files.filter(file => !file.dependencyOnly && file.targets.some(target => wanted.has(target)))
const urls = new Set(rootFiles.map(file => file.source).filter(url => /^https:.*\.bsp$/.test(url)))
for (const source of index.sources) {
  const located = locateSatelliteSource(source.url, directory)
  if (located.url) urls.add(located.url)
  else errors.push({ stage: 'published-satellite-link', id: source.id, ...located })
}
// Inspect current full originals, not just the admitted cropped mission spans.
urls.add('https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/juno_pred_orbit.bsp')
urls.add('https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/data/spk/msgr_040803_150430_150430_od431sc_2.bsp')
const surveys = []
await mkdir(join(output, 'sources'))
for (const url of urls) {
  const id = hash(url).slice(0, 16), directoryPath = join(output, 'sources', id)
  await mkdir(directoryPath)
  try {
    const source = await openSource(url)
    let survey
    try { survey = await surveySpkSource(source, (start, bytes) => writeFile(join(directoryPath, `range-${start}.bin`), bytes, { flag: 'wx' })) }
    finally { await source.close() }
    const record = { id, url, retrievedAt: new Date().toISOString(), ...survey }
    await writeFile(join(directoryPath, 'survey.json'), JSON.stringify(record, null, 2), { flag: 'wx' })
    surveys.push(record)
    console.log(`${surveys.length}/${urls.size}: ${url.split('/').at(-1)}; ${survey.segments.length} descriptors`)
  } catch (error) { errors.push({ stage: 'SPK-metadata', url, reason: String(error) }); console.error(`${url}: ${error}`) }
}
const rows = selected.map(body => {
  const current = approximationById.get(body.id)
  const currentRanges = body.id === 'sun' ? [[from, to]] : (current?.chunks ?? []).map(chunk => [chunk.startEt, chunk.endEt])
  const candidates = surveys.flatMap(survey => {
    const segments = survey.segments.filter(segment => segment.target === body.target)
    if (!segments.length) return []
    const supported = segments.filter(segment => [1, 2, 3, 17, 21].includes(segment.type) && [1, 17].includes(segment.frame))
    return [{ sourceId: survey.id, url: survey.url, sourceBytes: survey.source.bytes,
      target: body.target, descriptorFrom: date(Math.min(...segments.map(segment => segment.startEt))),
      descriptorTo: date(Math.max(...segments.map(segment => segment.endEt))),
      gaps: gaps(supported.map(segment => [segment.startEt, segment.endEt])),
      types: [...new Set(segments.map(segment => segment.type))], centers: [...new Set(segments.map(segment => segment.center))],
      status: gaps(supported.map(segment => [segment.startEt, segment.endEt])).length ? 'partial-or-unsupported-descriptors' : 'full-window-supported-descriptors',
      boundary: 'Descriptor availability only; correct solution/center dependency chain, coefficient evaluation, physical uncertainty and fit acceptance still required.' }]
  })
  const assigned = index.bodies.find(entry => entry.naifId === body.target)
  return { ...body, currentAvailable: current?.available ?? false, currentRanges, currentGaps: gaps(currentRanges), candidates,
    publishedAssignments: assigned?.sourceAssignments ?? (assigned ? [{ ephemeris: assigned.ephemeris, reference: assigned.reference }] : []),
    pinnedRoots: rootFiles.filter(file => file.targets.includes(body.target)).map(file => ({ id: file.id, source: file.source, startEt: file.startEt, endEt: file.endEt })),
    action: body.id === 'sun' ? 'origin-convention' : body.target === null ? 'identity-review-required'
      : !gaps(currentRanges).length ? 'already-covered-current-window'
        : candidates.some(candidate => candidate.status === 'full-window-supported-descriptors') ? 'prepare-source-chain-and-fit'
          : candidates.length ? body.kind === 'spacecraft' ? 'mission-window-only' : 'partial-source-review'
            : 'no-inspected-direct-target-source' }
})
const counts = Object.fromEntries([...new Set(rows.map(row => row.kind))].map(kind => [kind, rows.filter(row => row.kind === kind).length]))
const report = { schemaVersion: 1, ...provenance, scope: 'Registered Sun, eight planets, dwarf planets, all moons including small-body moons, and scientific spacecraft; independent asteroids/comets excluded.',
  counts, rows, pages, errors,
  inspectedSources: surveys.map(survey => ({ id: survey.id, url: survey.url, descriptors: survey.segments.length, sourceBytes: survey.source.bytes,
    retainedMetadataBytes: survey.reads.reduce((sum, read) => sum + read.length, 0), sha256OfSurvey: hash(JSON.stringify(survey)) })),
  publishedPlanetarySatelliteTargetsNotInRegistry: index.bodies.filter(body => !wanted.has(body.naifId)),
  limitations: ['No new trajectories, extrapolations, production manifests or Vercel coefficients were published.',
    'Current coverage comes from the hash-bound local precomputation manifest; no continuous physical-accuracy certification.',
    'Remote SPK ranges are retained with HTTP validators and per-range SHA-256, not whole-file hashes.',
    'Full-window candidate status applies only to the target descriptor union, not compatible center dependencies or scientific integration approval.',
    'Spacecraft reconstructed and predicted files remain separate candidates; inactive mission endpoints must not be extended as operating spacecraft.'] }
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
const summary = { counts, total: rows.length, currentFullWindow: rows.filter(row => !row.currentGaps.length).length,
  fullWindowDescriptorCandidates: rows.filter(row => row.candidates.some(candidate => candidate.status === 'full-window-supported-descriptors')).length,
  actions: Object.fromEntries([...new Set(rows.map(row => row.action))].map(action => [action, rows.filter(row => row.action === action).length])),
  inspectedSources: surveys.length, errors: errors.length, publishedTargetsNotInRegistry: report.publishedPlanetarySatelliteTargetsNotInRegistry.length }
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' })
console.log(JSON.stringify(summary))
