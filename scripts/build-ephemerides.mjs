import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { cropSpk, openSource } from './crop-spk.mjs'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { kernelsCoveringInterval } from '../src/engine/ephemeris/kernelPool.ts'

// Explicit opt-in data-generation command; normal builds never contact NAIF.
// Override bounds for local/profile distributions without changing app code.
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
  // Keep each primary with its own published system trajectory. Do not splice
  // a newer independent Horizons solution into this satellite solution.
  { id: 'tnosat-eris-v001', url: 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/tnosat_v001_20136199_jpl080_20220908.bsp', targets: [920136199, 20136199], bundled: true, maximumTo: '2030-01-02' },
  { id: 'tnosat-haumea-v001b', url: 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/tnosat_v001b_20136108_jpl110_20221014.bsp', targets: [920136108, 20136108], bundled: true, maximumTo: '2030-01-02' },
]
const cache = process.env.SOLAR_EPHEMERIS_CACHE ?? '.cache/ephemerides'
const output = 'public/data/ephemerides'
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true })
const files = []
let existingFiles = []
try { existingFiles = JSON.parse(await readFile('src/data/ephemeris-manifest.json', 'utf8')).files }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (existingFiles.some(file => file.solutionKernelIds || file.integrationBatch)) {
  throw new Error('Refusing to overwrite an expanded source-pool manifest. Prepare a separate baseline and use integrate-satellite-pack.mjs for explicit integration.')
}
for (const config of sources) {
  const sourceFrom = config.core ? (process.env.SOLAR_EPHEMERIS_FROM ?? '2000-01-01') : from
  const requestedTo = config.core ? (process.env.SOLAR_EPHEMERIS_TO ?? '2051-01-01') : to
  const sourceTo = config.maximumTo && requestedTo > config.maximumTo ? config.maximumTo : requestedTo
  const bounds = { startEt: toEt(sourceFrom), endEt: toEt(sourceTo) }
  // A verified immutable published crop is already sufficient for this exact
  // request. Expansion must not silently refresh unrelated solution kernels.
  const groups = config.bundled ? [config.targets] : config.targets ? config.targets.map(target => [target]) : [null]
  const groupId = targets => `${config.id}${targets && !config.bundled ? `-${targets[0]}` : ''}-${sourceFrom}-${sourceTo}`
  const coreGroup = targets => Boolean(config.core || (targets && targets[0] < 1000 && targets[0] % 100 === 99))
  const ids = groups.map(groupId)
  const reusable = ids.map(id => existingFiles.find(file => file.id === id))
  if (process.env.SOLAR_EPHEMERIS_REFRESH !== '1' && reusable.every(Boolean)) {
    let verified = true
    for (const file of reusable) {
      try {
        if (!/^[\w.-]+\.bsp$/.test(file.path)) throw new Error('Invalid existing kernel path')
        const bytes = await readFile(join(output, file.path))
        if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Existing kernel checksum mismatch')
        const parsed = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        if (!kernelsCoveringInterval([{ id: file.id, kernel: parsed }], bounds.startEt, bounds.endEt).length) throw new Error('Existing kernel does not cover request')
        const expectedTargets = groups[ids.indexOf(file.id)]
        if (expectedTargets && (expectedTargets.some(target => !parsed.segments.some(s => s.target === target)) || parsed.segments.some(s => !expectedTargets.includes(s.target)))) throw new Error('Existing kernel target mismatch')
        if (new URL(file.source).origin !== new URL(config.url).origin || new URL(file.source).pathname !== new URL(config.url).pathname) throw new Error('Existing kernel source mismatch')
      } catch { verified = false; break }
    }
    if (verified) { files.push(...reusable.map((file, index) => ({ ...file, core: coreGroup(groups[index]) }))); console.log(`Reused ${config.id}: ${reusable.length} verified file(s)`); continue }
  }
  const cachedPath = join(cache, `${config.id}-${sourceFrom}-${sourceTo}.bsp`)
  let combined, evidence
  try {
    if (process.env.SOLAR_EPHEMERIS_REFRESH === '1') throw new Error('Explicit source refresh')
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
      if (process.env.SOLAR_EPHEMERIS_REFRESH === '1') throw new Error('Explicit source refresh')
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
    for (const targets of groups) {
      const result = await cropSpk(source, { ...bounds, targets: targets ?? undefined })
      new SpkKernel(result.buffer.buffer.slice(result.buffer.byteOffset, result.buffer.byteOffset + result.buffer.byteLength))
      const id = groupId(targets)
      const path = `${id}.bsp`
      await writeFile(join(output, path), result.buffer)
      files.push({
        id, path, sha256: result.sha256, bytes: result.buffer.length,
        targets: [...new Set(result.segments.map((s) => s.target))],
        startEt: Math.min(...result.segments.map((s) => s.startEt)), endEt: Math.max(...result.segments.map((s) => s.endEt)),
        source: evidence.source.source ?? config.url, sourceIdentity: evidence.source,
        core: coreGroup(targets),
      })
      console.log(`${id}: ${result.buffer.length} bytes`)
    }
  } finally { await source.close() }
}
const manifest = {
  schemaVersion: 1, id: `jpl-spk-${from}-${to}-v1`,
  contract: 'Original SPK type 2/3/21 records; no refitting; geometric states; body-center IDs; TDB seconds; source model effects are not applied twice.',
  files,
}
await writeFile('src/data/ephemeris-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Pack total: ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes; ${files.length} files`)
