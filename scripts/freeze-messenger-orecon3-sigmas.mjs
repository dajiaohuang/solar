// Freeze the NASA/JPL MESSENGER ORECON3 sampled formal position sigmas.
// Values remain discrete RTN-like marginals; no interpolation or covariance is inferred.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MESSENGER_FINAL_ORBIT } from './lib/spacecraft-source-sets.mjs'

const SOURCE_URL = 'https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/document/spkrecon/orecon3_sigmas_m.asc'
const EXPECTED_MD5 = 'd37c47050f4c0ebe971a35e67422b63d'
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/evidence/messenger-orecon3-sigmas.json')
const AUDIT_COPY = resolve(dirname(fileURLToPath(import.meta.url)), '../.cache/science-audits/messenger-source-review/orecon3_sigmas_m.asc')
const digest = (algorithm, value) => createHash(algorithm).update(value).digest('hex')

export async function freezeMessengerOrecon3Sigmas() {
  const response = await fetch(SOURCE_URL, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`ORECON3 sigma source HTTP ${response.status}`) }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('ORECON3 sigma source exceeds the reviewed size bound')
  const sourceMd5 = digest('md5', bytes)
  if (sourceMd5 !== EXPECTED_MD5) throw new Error('ORECON3 sigma source differs from the PDS archive checksum')
  await mkdir(dirname(AUDIT_COPY), { recursive: true })
  await writeFile(AUDIT_COPY, bytes)
  const text = bytes.toString('utf8')
  const requiredHeader = ['DCO_TIME', 'MAP_TIME', 'SIG(R)', 'SIG(HxR)', 'SIG(H)']
  if (!requiredHeader.every(field => text.includes(field)) || !text.includes('[SCET, TDB]')) throw new Error('ORECON3 sigma source columns or time scale changed')

  let sigmaScaleFactor = null
  const samples = []
  const solutionGroups = new Map()
  for (const line of text.split(/\r?\n/)) {
    const scale = line.match(/Sigma scale factor\s*=\s*([0-9]+(?:\.[0-9]+)?)/i)
    if (scale) sigmaScaleFactor = Number(scale[1])
    if (!/^\s*[+-]?\d/.test(line)) continue
    const [numeric, comment = ''] = line.split('%', 2)
    const values = numeric.trim().split(/\s+/).map(Number)
    if (values.length !== 7 || !values.every(Number.isFinite)) throw new Error('Malformed ORECON3 sigma row')
    const [dataCutoffTdb, epochTdb, radiusMercuryKm, transverseVelocityKmPerSecond, sigmaRKm, sigmaHxRKm, sigmaHKm] = values
    const epochLabelTdb = comment.match(/\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+TDB/)?.[0]
    const group = solutionGroups.get(dataCutoffTdb) ?? { count: 0, firstEpochTdb: epochTdb, lastEpochTdb: -Infinity, scaleFactors: new Set() }
    if (!epochLabelTdb || epochTdb <= group.lastEpochTdb ||
        Math.min(sigmaRKm, sigmaHxRKm, sigmaHKm) < 0 || radiusMercuryKm <= 0 || sigmaScaleFactor === null) {
      throw new Error(`ORECON3 row ${samples.length + 1} invalid within DCO ${dataCutoffTdb}: ${JSON.stringify({ values, epochLabelTdb, previousEpochTdb: group.lastEpochTdb, sigmaScaleFactor })}`)
    }
    group.count++
    group.lastEpochTdb = epochTdb
    group.scaleFactors.add(sigmaScaleFactor)
    solutionGroups.set(dataCutoffTdb, group)
    samples.push({ dataCutoffTdb, epochTdb, epochLabelTdb, radiusMercuryKm, transverseVelocityKmPerSecond,
      sigmaRtnPositionKm: [sigmaRKm, sigmaHxRKm, sigmaHKm], sigmaScaleFactor })
  }
  if (!samples.length) throw new Error('ORECON3 sigma source contains no samples')
  const dataset = {
    schemaVersion: 1,
    source: { url: SOURCE_URL, md5: sourceMd5, sha256: digest('sha256', bytes), bytes: bytes.length,
      publication: 'MESSENGER Navigation Orbit Reconstruction 3 (ORECON3), 20-May-2015' },
    frame: { center: 'Mercury', state: 'MESSENGER', coordinateSystem: 'inertial Cartesian', timeScale: 'TDB seconds past J2000',
      positionSigmaAxes: ['R', 'HxR', 'H'], positionSigmaUnit: 'km' },
    sampling: { count: samples.length, dataCutoffCount: solutionGroups.size,
      firstEpochTdb: Math.min(...samples.map(sample => sample.epochTdb)), lastEpochTdb: Math.max(...samples.map(sample => sample.epochTdb)),
      displayEndTdb: MESSENGER_FINAL_ORBIT.coverageEndEt,
      displayedCount: samples.filter(sample => sample.epochTdb <= MESSENGER_FINAL_ORBIT.coverageEndEt).length,
      interpolation: 'none; rows are discrete source samples grouped by their own data cutoff' },
    solutionGroups: [...solutionGroups.entries()].map(([dataCutoffTdb, group]) => ({ dataCutoffTdb,
      count: group.count, firstEpochTdb: group.firstEpochTdb, lastEpochTdb: group.lastEpochTdb,
      sigmaScaleFactors: [...group.scaleFactors].sort((a, b) => a - b) })),
    limitations: ['Formal single-epoch marginal position sigmas only; no cross-axis or cross-epoch covariance is supplied.',
      'The source report says scaling was subjective and that scale factors of 2 to 3 would likely be appropriate for real sigmas.',
      'This ORECON3 uncertainty product is separate from the MESSENGER final-arc SPK source under review; it is not that SPK’s covariance.'],
    samples,
  }
  await mkdir(dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify(dataset)}\n`)
  return { path: OUTPUT, sourceMd5, sourceSha256: dataset.source.sha256, rows: samples.length,
    firstEpochTdb: dataset.sampling.firstEpochTdb, lastEpochTdb: dataset.sampling.lastEpochTdb }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await freezeMessengerOrecon3Sigmas()))
}
