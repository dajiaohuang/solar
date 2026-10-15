// Integrate the frozen JPL Horizons 67P/K284/1 SPK without resampling or refit.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cropSpk } from './crop-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_COMET_67P_CACHE ?? '.cache/horizons-comet-67p-20260929'
const output = 'public/data/ephemerides'
const batch = 'horizons-comet-67p-k284-1-20260929'
const target = 1000012
const sourceRecord = '90000703'
const profileWindows = {
  pages: ['2026-01-01', '2027-01-01'],
  full: ['2020-01-01', '2031-01-01'],
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const toEt = (date) => (Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5 - 2451545) * 86400
const manifests = {}
for (const profile of Object.keys(profileWindows)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  manifests[profile] = JSON.parse(await readFile(path, 'utf8'))
  if (!manifests[profile].files.some(file => file.id === 'de440s-2000-01-01-2051-01-01')) throw new Error(`Missing DE440 core in ${profile} manifest`)
}
const bytes = await readFile(join(cache, '67p.bsp'))
const evidence = JSON.parse(await readFile(join(cache, '67p.json'), 'utf8'))
const source = evidence.source
if (source.source?.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?') !== true
  || source.target !== target || source.designation !== sourceRecord
  || source.from !== '2020-01-01' || source.to !== '2031-01-01'
  || source.timeScale !== 'TDB' || !/^[a-f0-9]{64}$/.test(source.responseSha256 ?? '')
  || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '') || !source.retrievedAt) {
  throw new Error('Incomplete frozen Horizons source identity for 67P')
}
if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error('Frozen 67P source SPK checksum mismatch')
const solution = source.solution ?? ''
for (const marker of ['Rec #:90000703', 'JPL#K284/1', 'Soln.date: 2026-Sep-04', 'data arc: 2008-06-01 to 2025-06-21', "ID= '1000012'"]) {
  if (!solution.includes(marker)) throw new Error(`Horizons 67P solution does not match required source marker: ${marker}`)
}
const sbdb = JSON.parse(await readFile('tests/fixtures/sbdb-67p-covariance.json', 'utf8'))
if (sbdb.object?.spkid !== String(target) || sbdb.orbit?.orbit_id !== 'K284/1'
  || sbdb.orbit?.soln_date !== '2026-09-04 10:25:07'
  || sbdb.orbit?.first_obs !== '2008-06-01' || sbdb.orbit?.last_obs !== '2025-06-21') {
  throw new Error('Frozen Horizons 67P source no longer matches the pinned SBDB solution identity')
}
const modelParameters = new Map(sbdb.orbit.model_pars.map(parameter => [parameter.name, Number(parameter.value)]))
for (const name of ['A1', 'A2', 'A3', 'DT']) {
  const match = new RegExp(`(?:^|\\s)${name}=\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[Ee][+-]?\\d+)?)`, 'm').exec(solution)
  const horizonsValue = match ? Number(match[1]) : Number.NaN
  const sbdbValue = modelParameters.get(name)
  if (!Number.isFinite(horizonsValue) || !Number.isFinite(sbdbValue)
    || Math.abs(horizonsValue - sbdbValue) / Math.max(Math.abs(sbdbValue), 1e-300) > 1e-6) {
    throw new Error(`Horizons 67P ${name} does not reconcile with pinned SBDB K284/1`)
  }
}
await mkdir(output, { recursive: true })
for (const [profile, [from, to]] of Object.entries(profileWindows)) {
  const manifest = manifests[profile]
  if (manifest.files.some(file => file.targets?.includes(target))) throw new Error(`NAIF target ${target} already exists in ${profile}`)
  const result = await cropSpk({ size: bytes.length, identity: source, read: async (start, length) => bytes.subarray(start, start + length) },
    { startEt: toEt(from), endEt: toEt(to), targets: [target] })
  if (!result.segments.length || result.segments.some(segment => segment.target !== target || segment.center !== 10 || segment.type !== 21)) {
    throw new Error(`67P ${profile} crop is not a heliocentric type-21 target-1000012 source`)
  }
  const id = `horizons-comet-67p-${from}-${to}`
  const path = `${id}.bsp`
  await writeFile(join(output, path), result.buffer)
  manifest.files.push({
    id, path, sha256: result.sha256, bytes: result.buffer.length,
    targets: [...new Set(result.segments.map(segment => segment.target))],
    startEt: Math.min(...result.segments.map(segment => segment.startEt)),
    endEt: Math.max(...result.segments.map(segment => segment.endEt)),
    source: source.source, sourceIdentity: source, core: false,
    solution: `JPL Horizons type-21 heliocentric SPK; 67P K284/1 from record ${sourceRecord}`,
    integrationBatch: batch,
    sourceBoundary: {
      sourceId: `horizons-record-${sourceRecord}`,
      trackingDataCutoff: '2025-06-21',
      description: 'JPL solution K284/1 dated 2026-09-04; observation arc 2008-06-01 to 2025-06-21. SPK interpolation precision does not encode orbital uncertainty or guarantee physical accuracy across the requested interval.',
    },
    selectionEvidence: {
      sourceSelection: '67P/Churyumov-Gerasimenko, uniquely selected Horizons record 90000703; the Horizons solution identifies SBDB K284/1 and target NAIF 1000012. Original type-21 records are cropped without refitting.',
      sourceSnapshot: { responseSha256: source.responseSha256, binarySha256: source.sha256, retrievedAt: source.retrievedAt },
      sbdbSolution: { orbitId: sbdb.orbit.orbit_id, solutionDate: sbdb.orbit.soln_date, sourceModel: sbdb.orbit.sb_used, dataArcStart: sbdb.orbit.first_obs, dataArcEnd: sbdb.orbit.last_obs },
      nongravitationalFit: Object.fromEntries([...modelParameters].map(([name, value]) => [name, value])),
      windowPolicy: `${from} to ${to} TDB`,
    },
  })
  console.log(`${profile}: ${id} ${result.buffer.length} bytes ${result.sha256}; ${result.segments.length} original segments`)
}
for (const [profile, manifest] of Object.entries(manifests)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${profile}: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes`)
}
