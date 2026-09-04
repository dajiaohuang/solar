import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { cropSpk, openSource } from './crop-spk.mjs'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

// Explicit opt-in data-generation command; normal builds never contact NAIF.
// Override bounds for local/native distributions without changing app code.
const from = process.env.SOLAR_EPHEMERIS_FROM ?? '2020-01-01'
const to = process.env.SOLAR_EPHEMERIS_TO ?? '2031-01-01'
const toEt = (date) => (Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5 - 2451545) * 86400
const root = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/'
const sources = [
  { id: 'de440s', url: `${root}planets/de440s.bsp`, targets: null, core: true },
  { id: 'mar099s', url: `${root}satellites/mar099s.bsp`, targets: [401, 402, 499] },
  { id: 'jup365', url: `${root}satellites/jup365.bsp`, targets: [501, 502, 503, 504, 505, 514, 515, 516, 599] },
  { id: 'sat441', url: `${root}satellites/sat441.bsp`, targets: [601, 602, 603, 604, 605, 606, 607, 608, 609, 612, 613, 614, 632, 634, 699] },
  { id: 'ura111', url: `${root}satellites/a_old_versions/ura111.bsp`, targets: [701, 702, 703, 704, 705, 799] },
  { id: 'nep097', url: `${root}satellites/nep097.bsp`, targets: [801, 899] },
  { id: 'nep105', url: `${root}satellites/nep105.bsp`, targets: [802] },
  { id: 'plu060', url: `${root}satellites/plu060.bsp`, targets: [901, 902, 903, 904, 905, 999] },
  { id: 'sb441-n16', url: 'https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/sb441-n16.bsp', targets: [2000001, 2000002, 2000003, 2000004, 2000007, 2000010, 2000015, 2000016, 2000031, 2000052, 2000065, 2000087, 2000088, 2000107, 2000511, 2000704] },
]
const cache = '.cache/ephemerides'
const output = 'public/data/ephemerides'
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true })
const files = []
for (const config of sources) {
  const sourceFrom = config.core ? (process.env.SOLAR_EPHEMERIS_FROM ?? '2000-01-01') : from
  const sourceTo = config.core ? (process.env.SOLAR_EPHEMERIS_TO ?? '2051-01-01') : to
  const bounds = { startEt: toEt(sourceFrom), endEt: toEt(sourceTo) }
  const cachedPath = join(cache, `${config.id}-${sourceFrom}-${sourceTo}.bsp`)
  let combined, evidence
  try {
    combined = await readFile(cachedPath)
    evidence = JSON.parse(await readFile(`${cachedPath}.json`, 'utf8'))
    if (createHash('sha256').update(combined).digest('hex') !== evidence.sha256) throw new Error('Cached kernel checksum mismatch')
  } catch {
    console.log(`Extracting ${config.id} ${from}/${to}`)
    // A previously verified broader local crop is sufficient input for a
    // narrower distribution; preserve the original source provenance.
    const broadPath = join(cache, `${config.id}-2000-01-01-2051-01-01.bsp`)
    let broadEvidence = null
    try {
      const raw = await readFile(broadPath)
      const record = JSON.parse(await readFile(`${broadPath}.json`, 'utf8'))
      if (createHash('sha256').update(raw).digest('hex') === record.sha256 && bounds.startEt >= -43200 && bounds.endEt <= toEt('2051-01-01')) broadEvidence = record
    } catch { /* Download only when no verified local source covers the request. */ }
    const source = await openSource(broadEvidence ? broadPath : config.url)
    try {
      const result = await cropSpk(source, { ...bounds, targets: config.targets ?? undefined })
      combined = result.buffer
      const { buffer: _buffer, ...record } = result
      evidence = record
      if (broadEvidence) evidence.source = broadEvidence.source
      await writeFile(cachedPath, combined)
      await writeFile(`${cachedPath}.json`, JSON.stringify(evidence, null, 2))
    } finally { await source.close() }
  }
  new SpkKernel(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength))
  const source = await openSource(cachedPath)
  try {
    const groups = config.targets ? config.targets.map((target) => [target]) : [null]
    for (const targets of groups) {
      const result = await cropSpk(source, { ...bounds, targets: targets ?? undefined })
      new SpkKernel(result.buffer.buffer.slice(result.buffer.byteOffset, result.buffer.byteOffset + result.buffer.byteLength))
      const id = `${config.id}${targets ? `-${targets[0]}` : ''}-${sourceFrom}-${sourceTo}`
      const path = `${id}.bsp`
      await writeFile(join(output, path), result.buffer)
      files.push({
        id, path, sha256: result.sha256, bytes: result.buffer.length,
        targets: [...new Set(result.segments.map((s) => s.target))],
        startEt: Math.min(...result.segments.map((s) => s.startEt)), endEt: Math.max(...result.segments.map((s) => s.endEt)),
        source: config.url, sourceIdentity: evidence.source,
        core: Boolean(config.core || (targets && targets[0] % 100 === 99)),
      })
      console.log(`${id}: ${result.buffer.length} bytes`)
    }
  } finally { await source.close() }
}
const manifest = {
  schemaVersion: 1, id: `jpl-spk-${from}-${to}-v1`,
  contract: 'Original SPK type 2/3 records; no refitting; geometric states; body-center IDs; TDB seconds; source model effects are not applied twice.',
  files,
}
await writeFile('src/data/ephemeris-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Pack total: ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes; ${files.length} files`)
