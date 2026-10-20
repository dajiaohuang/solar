import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { evaluateApproximation, segmentAt } from '../src/engine/ephemeris/segmentedApproximation.ts'
import { propagateTwoBody } from '../src/engine/ephemeris/twoBodyForecast.ts'
import { verifyApproximationAssets } from './lib/verify-approximation-assets.mjs'

const root = resolve(process.argv[2] ?? 'public/data/approximation')
const { manifest } = await verifyApproximationAssets(root)
const source = JSON.parse(await readFile(manifest.sourceManifestPath ?? 'src/data/ephemeris-manifest-full.json', 'utf8'))
const audit = JSON.parse(await readFile('docs/benchmarks/non-small-coverage-20261012/report.json', 'utf8'))
const parametersRaw = await readFile('src/data/ephemerisBodies.json'), parametersHash = createHash('sha256').update(parametersRaw).digest('hex')
const gm = JSON.parse(parametersRaw).source.gmKm3S2
const startEt = -43200, endEt = 1609416000
const selected = new Set(audit.rows.map(body => body.id))
const byId = new Map(manifest.bodies.map(body => [body.id, body]))
if (audit.rows.some(body => !byId.has(body.id))) throw new Error('Forecast publication requires the full audited body registry; partial pilot archives are not eligible')
// Include otherwise excluded small-body primaries only as selected moon centers.
for (const id of selected) { const body = byId.get(id); if (body && body.parentId !== 'sun') selected.add(body.parentId) }
const sourcesByHash = new Map(source.files.map(file => [file.sha256, file.source]))
const documents = new Map()
async function sourceAt(body, et) {
  let descriptor
  for (const chunk of body.chunks) if (chunk.startEt <= et && chunk.endEt >= et) descriptor = chunk
  if (!descriptor) return null
  if (!documents.has(descriptor.path)) documents.set(descriptor.path, JSON.parse(await readFile(join(root, descriptor.path), 'utf8')))
  const document = documents.get(descriptor.path), segment = segmentAt(document.segments, et)
  return segment ? { state: evaluateApproximation(segment, et), hashes: document.sourceKernelHashes } : null
}
function difference(a, b, key) { return Math.hypot(...['x', 'y', 'z'].map(axis => a[key][axis] - b[key][axis])) }
async function backtest(body, seedEt, seed, mu, direction) {
  let samples = 0, maximumPositionErrorKm = null, maximumVelocityErrorKmS = null, maximumOffsetDays = 0
  for (const days of [.25, .5, 1, 2, 4, 7, 14, 30, 90, 365]) {
    const actual = await sourceAt(body, seedEt + direction * days * 86400)
    if (!actual) continue
    const predicted = propagateTwoBody(seed, mu, direction * days * 86400)
    samples++; maximumOffsetDays = days
    maximumPositionErrorKm = Math.max(maximumPositionErrorKm ?? 0, difference(predicted, actual.state, 'position'))
    maximumVelocityErrorKmS = Math.max(maximumVelocityErrorKmS ?? 0, difference(predicted, actual.state, 'velocity'))
  }
  return { samples, maximumPositionErrorKm, maximumVelocityErrorKmS, maximumOffsetDays }
}
const unavailable = []
for (const id of selected) {
  const body = byId.get(id)
  if (!body || body.origin || id === 'makemake') continue
  body.forecasts = []
  if (!body.chunks.length) { unavailable.push({ id, reason: 'No admitted source state for a forecast anchor; no state invented.' }); continue }
  const parent = byId.get(body.parentId), mu = Number(gm[parent?.target]) + Number(gm[body.target] ?? 0)
  if (!Number.isFinite(mu) || mu <= 0) { unavailable.push({ id, reason: 'No verified source-model GM.' }); continue }
  let cursor = startEt, previous = null
  const gaps = []
  for (const chunk of body.chunks) {
    if (chunk.endEt < startEt || chunk.startEt > endEt) continue
    if (chunk.startEt > cursor) gaps.push({ startEt: cursor, endEt: Math.min(chunk.startEt, endEt), seedEt: previous?.endEt ?? chunk.startEt, direction: previous ? -1 : 1 })
    cursor = Math.max(cursor, chunk.endEt); previous = chunk
  }
  if (cursor < endEt) gaps.push({ startEt: cursor, endEt, seedEt: previous.endEt, direction: -1 })
  for (const gap of gaps) {
    const anchor = await sourceAt(body, gap.seedEt)
    if (!anchor) throw new Error(`Missing verified anchor: ${id}`)
    const forecast = { model: 'two-body-universal', startEt: gap.startEt, endEt: gap.endEt, seedEt: gap.seedEt,
      seed: anchor.state, gmKm3S2: mu, parameterSource: `src/data/ephemerisBodies.json SHA-256 ${parametersHash}; GM(parent)+GM(body)`,
      sourceHashes: [...anchor.hashes, parametersHash], sourceUrls: [...new Set(anchor.hashes.map(hash => sourcesByHash.get(hash)).filter(Boolean))],
      anchorSource: 'source-fit', uncertainty: 'unknown-outside-source-coverage',
      backtest: await backtest(body, gap.seedEt, anchor.state, mu, gap.direction),
      ...(body.target < 0 ? { existenceBoundary: 'Mathematical trajectory outside the source mission arc, including before launch or after termination; not a claim of actual flight or body existence.' } : {}) }
    for (const et of [gap.startEt, (gap.startEt + gap.endEt) / 2, gap.endEt]) propagateTwoBody(forecast.seed, mu, et - forecast.seedEt)
    body.forecasts.push(forecast)
  }
  body.available = Boolean(body.chunks.length || body.forecasts.length)
  documents.clear()
  console.log(`${id}: ${body.forecasts.length} forecast windows`)
}
// Review Makemake's known catalog identity explicitly. A system orbit is never
// silently promoted to a resolved primary/companion-center SPK trajectory.
async function fetchEvidence(url, filename) {
  const destination = `docs/benchmarks/non-small-forecast-20261012/${filename}`
  const raw = await readFile(destination)
  if (raw.length > 8 * 1048576) throw new Error('Forecast evidence exceeds byte budget')
  return { value: JSON.parse(raw), sha256: createHash('sha256').update(raw).digest('hex'), url }
}
const sbdb = await fetchEvidence('https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=136472&full-prec=true', 'makemake-sbdb.json')
if (sbdb.value.object?.des !== '136472' || !/Makemake/i.test(sbdb.value.object.fullname) || sbdb.value.signature?.version !== '1.3') throw new Error('Makemake identity/API review failed')
const epochJd = Number(sbdb.value.orbit?.epoch)
if (!Number.isFinite(epochJd)) throw new Error('Missing Makemake TDB epoch')
const query = new URLSearchParams({ format: 'json', COMMAND: "'136472;'", MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
  CENTER: "'500@10'", TLIST: `'${[epochJd - 30, epochJd, epochJd + 30].join(',')}'`, TIME_TYPE: 'TDB',
  OUT_UNITS: 'KM-S', REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'ICRF', VEC_TABLE: '2', CSV_FORMAT: 'YES', OBJ_DATA: 'YES' })
const vectors = await fetchEvidence(`https://ssd.jpl.nasa.gov/api/horizons.api?${query}`, 'makemake-vectors.json')
const text = vectors.value.result ?? ''
if (vectors.value.signature?.version !== '1.2' || vectors.value.error || !/Makemake/i.test(text) || !/KM-S/.test(text)
  || !/Ecliptic of J2000/i.test(text) || !/Center body name:\s*Sun\s*\(10\)/.test(text)) throw new Error('Makemake vector source/frame/units mismatch')
const rows = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1].trim().split('\n').map(row => row.split(',').map(value => value.trim()))
if (rows?.length !== 3) throw new Error('Expected three Makemake source epochs')
const states = rows.map(row => ({ et: (Number(row[0]) - 2451545) * 86400,
  state: { position: { x: Number(row[2]), y: Number(row[3]), z: Number(row[4]) }, velocity: { x: Number(row[5]), y: Number(row[6]), z: Number(row[7]) } } }))
if (Math.abs(states[1].et / 86400 + 2451545 - epochJd) > 1e-7) throw new Error('Makemake anchor epoch mismatch')
let position = 0, velocity = 0
for (const value of states) {
  const actual = propagateTwoBody(states[1].state, gm['10'], value.et - states[1].et)
  position = Math.max(position, difference(actual, value.state, 'position')); velocity = Math.max(velocity, difference(actual, value.state, 'velocity'))
}
const makemake = byId.get('makemake')
makemake.forecasts = [{ model: 'two-body-universal', startEt, endEt, seedEt: states[1].et, seed: states[1].state, gmKm3S2: gm['10'],
  parameterSource: `Solar GM from src/data/ephemerisBodies.json SHA-256 ${parametersHash}`, sourceHashes: [sbdb.sha256, vectors.sha256, parametersHash],
  sourceUrls: [sbdb.url, vectors.url], anchorSource: 'horizons-vector', uncertainty: 'unknown-outside-source-coverage',
  identityBoundary: `Reviewed JPL catalog identity ${sbdb.value.object.spkid}; unresolved system-orbit proxy, not a resolved primary-center or companion trajectory.`,
  backtest: { samples: 2, maximumPositionErrorKm: position, maximumVelocityErrorKmS: velocity, maximumOffsetDays: 30 } }]
makemake.available = true
manifest.forecastPolicy = { requestedStartEt: startEt, requestedEndEt: endEt, selectedIds: [...selected], unavailable,
  boundary: 'Explicit mathematical two-body forecasts only in source gaps; prediction uncertainty outside source coverage is unknown. No coordinates invented for unidentified/unanchored bodies.' }
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ forecastBodies: manifest.bodies.filter(body => body.forecasts?.length).length, unavailable }))
