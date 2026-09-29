// Integrate the frozen JPL Horizons Borisov solution without resampling/refit.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cropSpk } from './crop-spk.mjs'
import { reconcileBorisovFit } from './lib/borisov-fit-reconciliation.mjs'

const output = 'public/data/ephemerides'
const fixture = 'tests/fixtures/horizons-borisov-spk-20260929'
const batch = 'horizons-comet-borisov-jpl54-20260929'
const target = 1003639
const sourceRecord = '90004568'
const sourceBinarySha256 = '8e2931d03595c01ab5c50d9d268376ee0024ebf881846dc1def6f2c1559e1705'
const sourceResponseSha256 = '6e77026ca9792963aa3298b977485a9abcbf0bfcb0b96958cbf75aeb3f72c8b2'
const profileWindows = { pages: ['2026-01-01', '2027-01-01'], full: ['2019-01-01', '2031-01-01'] }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
// The calendar fields in these product bounds are TDB labels. Convert the same
// fields to a Julian date; do not interpret them as UTC instants and add TDB-UTC.
const toEt = date => (Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5 - 2451545) * 86400
const manifests = {}
for (const profile of Object.keys(profileWindows)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  manifests[profile] = JSON.parse(await readFile(path, 'utf8'))
  if (!manifests[profile].files.some(file => file.id === 'de440s-2000-01-01-2051-01-01')) throw new Error(`Missing DE440 core in ${profile} manifest`)
}
const bytes = await readFile(join(fixture, 'original.bsp'))
const evidence = JSON.parse(await readFile(join(fixture, 'receipt.json'), 'utf8'))
if (evidence.schemaVersion !== 1) throw new Error('Unsupported frozen Horizons Borisov source receipt')
const source = evidence.source
if (!source.source?.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')
  || source.target !== target || source.designation !== 'DES=1003639'
  || source.from !== '2019-01-01' || source.to !== '2031-01-01' || source.timeScale !== 'TDB'
  || source.responseSha256 !== sourceResponseSha256 || source.sha256 !== sourceBinarySha256 || !source.retrievedAt) {
  throw new Error('Incomplete frozen Horizons source identity for Borisov')
}
if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error('Frozen Borisov source SPK checksum mismatch')
const solution = source.solution ?? ''
for (const marker of [
  'Rec #:90004568', 'Soln.date: 2024-Jun-24_15:49:04', '# obs: 964 (2019-2020)',
  'JPL#54, data arc: 2019-02-24 to 2020-09-30', "ID= '1003639'",
]) if (!solution.includes(marker)) throw new Error(`Horizons solution does not match pinned Borisov source: ${marker}`)

const sbdbBytes = await readFile('tests/fixtures/sbdb-borisov-covariance-20260929/c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987.json')
const sbdbSourceSha256 = 'c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987'
if (digest(sbdbBytes) !== sbdbSourceSha256) throw new Error('Frozen SBDB Borisov covariance response hash mismatch')
const sbdb = JSON.parse(sbdbBytes.toString('utf8'))
if (sbdb.signature?.source !== 'NASA/JPL Small-Body Database (SBDB) API' || sbdb.signature?.version !== '1.3'
  || sbdb.object?.spkid !== String(target) || sbdb.object?.fullname !== 'C/2019 Q4 (Borisov)'
  || sbdb.orbit?.orbit_id !== '54' || sbdb.orbit?.soln_date !== '2024-06-24 15:49:04'
  || sbdb.orbit?.first_obs !== '2019-02-24' || sbdb.orbit?.last_obs !== '2020-09-30'
  || sbdb.orbit?.n_obs_used !== 964 || sbdb.orbit?.pe_used !== 'DE441' || sbdb.orbit?.sb_used !== 'SB441-N16'
  || sbdb.orbit?.covariance?.epoch !== '2458853.5'
  || JSON.stringify(sbdb.orbit?.covariance?.labels) !== JSON.stringify(['e', 'q', 'tp', 'node', 'peri', 'i', 'A1', 'A2', 'A3', 'DT'])
  || sbdb.orbit?.covariance?.data?.length !== 10 || sbdb.orbit.covariance.data.some(row => row.length !== 10)) {
  throw new Error('Horizons Borisov solution no longer reconciles with the pinned SBDB solution identity')
}
const fitReconciliation = reconcileBorisovFit(solution, sbdb.orbit)
const modelParameters = new Map(sbdb.orbit.model_pars.map(parameter => [parameter.name, Number(parameter.value)]))

await mkdir(output, { recursive: true })
for (const [profile, [from, to]] of Object.entries(profileWindows)) {
  const manifest = manifests[profile]
  if (manifest.files.some(file => file.targets?.includes(target))) throw new Error(`NAIF target ${target} already exists in ${profile}`)
  const result = await cropSpk({ size: bytes.length, identity: source, read: async (start, length) => bytes.subarray(start, start + length) },
    { startEt: toEt(from), endEt: toEt(to), targets: [target] })
  if (!result.segments.length || result.segments.some(segment => segment.target !== target || segment.center !== 10 || segment.type !== 21)) {
    throw new Error(`Borisov ${profile} crop is not a heliocentric type-21 target-1003639 source`)
  }
  const id = `horizons-comet-borisov-${from}-${to}`
  const path = `${id}.bsp`
  await writeFile(join(output, path), result.buffer)
  manifest.files.push({
    id, path, sha256: result.sha256, bytes: result.buffer.length,
    targets: [...new Set(result.segments.map(segment => segment.target))],
    startEt: Math.min(...result.segments.map(segment => segment.startEt)),
    endEt: Math.max(...result.segments.map(segment => segment.endEt)),
    source: source.source, sourceIdentity: source, core: false,
    solution: `JPL Horizons type-21 heliocentric SPK; Borisov JPL #54 from record ${sourceRecord}`,
    integrationBatch: batch,
    sourceBoundary: {
      sourceId: `horizons-record-${sourceRecord}`,
      trackingDataCutoff: '2020-09-30',
      description: 'JPL solution 54 dated 2024-06-24; observation arc 2019-02-24 to 2020-09-30. Numerical integration outside this arc is model-based extrapolation; SPK interpolation precision does not encode orbit uncertainty or guarantee physical accuracy.',
    },
    selectionEvidence: {
      sourceSelection: 'C/2019 Q4 (Borisov), explicitly selected by DES=1003639; Horizons record 90004568 identifies JPL orbit solution 54 and target NAIF 1003639. Original type-21 records are cropped without refitting.',
      sourceSnapshot: { responseSha256: source.responseSha256, binarySha256: source.sha256, retrievedAt: source.retrievedAt },
      sbdbSolution: { orbitId: sbdb.orbit.orbit_id, solutionDate: sbdb.orbit.soln_date, covarianceSourceSha256: sbdbSourceSha256,
        covarianceLabels: sbdb.orbit.covariance.labels,
        parameterReconciliation: fitReconciliation.parameters,
        maxStandardizedParameterDifference: fitReconciliation.maxStandardizedDifference,
        maxDifferenceParameter: fitReconciliation.maxDifferenceParameter,
        parameterReconciliationBoundary: 'Horizons and SBDB nominal fit values are reconciled within one SBDB formal marginal sigma. This is not bitwise equality, proof of a shared covariance propagation, or a bound on systematic/model error.',
        covarianceBoundary: 'Full joint solution-epoch matrix is retained as source data; this SPK package does not propagate that covariance.',
        planetaryEphemeris: sbdb.orbit.pe_used,
        smallBodyEphemeris: sbdb.orbit.sb_used, dataArcStart: sbdb.orbit.first_obs,
        dataArcEnd: sbdb.orbit.last_obs, observationsUsed: sbdb.orbit.n_obs_used,
      },
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
