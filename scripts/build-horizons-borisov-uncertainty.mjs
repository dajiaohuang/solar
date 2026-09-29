// Normalize the immutable JPL Horizons vector-and-uncertainty response.
// Samples are kept at source epochs; this script performs no interpolation.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileBorisovFit } from './lib/borisov-fit-reconciliation.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = 'tests/fixtures/horizons-borisov-uncertainty-20260929'
const responsePath = join(root, fixture, 'response.json')
const receiptPath = join(root, fixture, 'receipt.json')
const orbitReceiptPath = join(root, 'tests/fixtures/horizons-borisov-spk-20260929/receipt.json')
const sbdbPath = join(root, 'tests/fixtures/sbdb-borisov-covariance-20260929/c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987.json')
const outputPath = join(root, 'src/data/borisovHorizonsUncertainty.json')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const orbitBinarySha256 = '8e2931d03595c01ab5c50d9d268376ee0024ebf881846dc1def6f2c1559e1705'
const orbitResponseSha256 = '6e77026ca9792963aa3298b977485a9abcbf0bfcb0b96958cbf75aeb3f72c8b2'
const numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/g
const responseBytes = await readFile(responsePath)
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
const payload = JSON.parse(responseBytes.toString('utf8'))
const orbitReceipt = JSON.parse(await readFile(orbitReceiptPath, 'utf8'))
const sbdbBytes = await readFile(sbdbPath)
const sbdbSourceSha256 = 'c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987'
if (digest(sbdbBytes) !== sbdbSourceSha256) throw new Error('Frozen SBDB Borisov covariance response hash mismatch')
const sbdb = JSON.parse(sbdbBytes.toString('utf8'))
const text = payload.result ?? ''
if (receipt.schemaVersion !== 1 || receipt.responseBytes !== responseBytes.length || digest(responseBytes) !== receipt.responseSha256) {
  throw new Error('Frozen Horizons response does not match its receipt')
}
if (receipt.source?.includes('&VEC_CORR=')) throw new Error('Frozen query unexpectedly supplies a vector correction override')
for (const marker of ['Borisov (C/2019 Q4)', 'JPL#54', 'Center body name: Sun (10)', 'Output format   : 2r', 'Reference frame : Ecliptic of J2000', '$$SOE', '$$EOE']) {
  if (!text.includes(marker)) throw new Error(`Frozen Horizons response is missing ${marker}`)
}

const section = text.match(/\$\$SOE\s*\r?\n([\s\S]*?)\r?\n\$\$EOE/)
if (!section) throw new Error('Horizons uncertainty samples are missing their explicit data block')
const epochs = [...section[1].matchAll(/^\s*(\d+\.\d+)\s*=\s*([^\r\n]*?)\s+TDB\s*\r?\n\s*XYZ\s*:\s*([^\r\n]+)\s*\r?\n\s*sigmas\s*:\s*\r?\n\s*RTN\(1-sigma\)\s*:\s*([^\r\n]+)/gm)]
const values = line => [...line.matchAll(numberPattern)].map(match => Number(match[0]))
let previousEpoch = null
const samples = epochs.map((match, index) => {
  const state = values(match[3]), sigmas = values(match[4]), epochTdb = Number(match[1])
  if (state.length !== 6 || sigmas.length !== 6 || ![epochTdb, ...state, ...sigmas].every(Number.isFinite) || sigmas.some(value => value < 0)) {
    throw new Error(`Malformed Horizons state or uncertainty row ${index}`)
  }
  if (previousEpoch !== null && Math.abs(epochTdb - previousEpoch - 30) > 1e-9) throw new Error(`Unexpected source sampling interval at row ${index}`)
  previousEpoch = epochTdb
  return {
    epochTdb,
    sourceDateTdb: match[2].trim(),
    positionAu: state.slice(0, 3),
    velocityAuPerDay: state.slice(3),
    sigmaRtnPositionAu: sigmas.slice(0, 3),
    sigmaRtnVelocityAuPerDay: sigmas.slice(3),
  }
})
if (samples.length !== 147 || samples[0].epochTdb !== 2458484.5 || samples.at(-1).epochTdb !== 2462864.5) {
  throw new Error(`Expected the pinned 147-epoch 2019–2030 TDB record; received ${samples.length}`)
}
if (sbdb.orbit?.orbit_id !== '54' || sbdb.orbit?.soln_date !== '2024-06-24 15:49:04'
  || orbitReceipt.schemaVersion !== 1 || orbitReceipt.source?.target !== 1003639
  || orbitReceipt.source?.sha256 !== orbitBinarySha256 || orbitReceipt.source?.responseSha256 !== orbitResponseSha256
  || !orbitReceipt.source?.solution?.includes('Rec #:90004568 (+COV)')
  || !orbitReceipt.source.solution.includes('JPL#54, data arc: 2019-02-24 to 2020-09-30')) {
  throw new Error('Frozen SBDB covariance and Horizons orbit snapshots do not identify Borisov solution 54')
}
const fitReconciliation = reconcileBorisovFit(orbitReceipt.source.solution, sbdb.orbit)

const generated = {
  schemaVersion: 1,
  body: { designation: '2I/Borisov', name: 'Borisov (C/2019 Q4)', horizonsTarget: 1003639 },
  source: {
    provider: 'NASA/JPL Horizons',
    url: receipt.source,
    retrievedAt: receipt.retrievedAt,
    responseSha256: receipt.responseSha256,
    solutionRecord: '90004568',
    solutionId: '54',
    solutionDate: '2024-06-24 15:49:04',
    observationCount: 964,
    observationArc: ['2019-02-24', '2020-09-30'],
    centerEphemeris: 'DE441',
    smallPerturberModel: 'SB441-N16',
    sbdbCovariance: {
      responseSha256: sbdbSourceSha256,
      solutionId: sbdb.orbit.orbit_id,
      covarianceEpochTdb: Number(sbdb.orbit.covariance.epoch),
      labels: sbdb.orbit.covariance.labels,
      nominalFitReconciliation: fitReconciliation.parameters,
      maxStandardizedDifference: fitReconciliation.maxStandardizedDifference,
      maxDifferenceParameter: fitReconciliation.maxDifferenceParameter,
      boundary: 'Horizons and SBDB nominal fit values reconcile within one SBDB formal marginal sigma. This is not bitwise equality, proof of a shared covariance propagation, or a bound on systematic/model error.',
    },
  },
  model: {
    target: 'Borisov (C/2019 Q4)',
    frame: 'ECLIPJ2000',
    origin: 'Sun (NAIF 10)',
    timeScale: 'TDB',
    stateUnits: ['AU', 'AU/day'],
    vectorCorrection: { value: 'NONE', selection: 'JPL Horizons API default; VEC_CORR was omitted from the frozen request' },
    uncertainty: 'JPL Horizons formal statistical state uncertainty; reported marginal one-sigma components in instantaneous RTN coordinates',
    uncertaintyPositionUnits: 'AU',
    uncertaintyVelocityUnits: 'AU/day',
    correlation: 'The 2r vector response reports marginal sigmas but does not return cross-axis or cross-epoch covariance.',
    interpolation: 'Samples are source epochs only. Connecting or selecting samples does not define a continuous uncertainty envelope.',
    physicalBoundary: 'SPK/vector numerical interpolation precision is not orbit-solution accuracy; model error and uncertainty outside sampled epochs are not inferred.',
  },
  sampling: { startTdb: samples[0].epochTdb, stopTdbExclusive: 2462866.5, stepDays: 30, count: samples.length },
  samples,
}
await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ outputPath, responseSha256: generated.source.responseSha256, samples: samples.length, firstTdb: samples[0].epochTdb, lastTdb: samples.at(-1).epochTdb }))
