import { open, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DE440_DYNAMICS_SOURCE } from '../src/engine/dynamics/de440Dynamics.ts'
import { PCK_RADII_SOURCE } from '../src/data/loaders/pckRadii.ts'
import { runStellarLimbExperiment } from '../src/engine/events/stellarLimbExperiment.ts'

const root = new URL('../', import.meta.url)
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)
async function boundedFile(path, limit, signal) {
  signal?.throwIfAborted()
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || !info.size || info.size > limit) throw new RangeError(`Input must be a nonempty regular file of at most ${limit} bytes`)
    // One extra byte detects growth without an unbounded readFile allocation.
    const bytes = Buffer.alloc(info.size+1)
    let used = 0
    while (used < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(bytes, used, Math.min(65536, bytes.length-used), null)
      if (!bytesRead) break
      used += bytesRead
    }
    if (used !== info.size) throw new Error('Input file size changed while reading')
    return bytes.subarray(0, used)
  } finally { await file.close() }
}

export async function evaluateStellarLimbFiles(input, request, observer, output, signal) {
  const [inputBytes, requestBytes, observerBytes, spk, pck, gm] = await Promise.all([
    boundedFile(input, 65536, signal), boundedFile(request, 26<<20, signal), boundedFile(observer, 14<<20, signal),
    boundedFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root), DE440_DYNAMICS_SOURCE.bytes, signal),
    boundedFile(new URL('src/data/pck00011.tpc', root), PCK_RADII_SOURCE.bytes, signal),
    boundedFile(new URL('src/data/gm_de440.tpc', root), 1<<20, signal),
  ])
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const report = await runStellarLimbExperiment({ inputBytes: buffer(inputBytes), observerResponseBytes: buffer(observerBytes),
    observerRequest: JSON.parse(decoder.decode(requestBytes)), spkBytes: buffer(spk), pckBytes: buffer(pck), gmText: decoder.decode(gm), signal })
  const paths = ['scripts/evaluate-stellar-limb.mjs', 'src/engine/events/stellarLimbExperiment.ts',
    'src/engine/events/ellipsoidLimb.ts', 'src/engine/events/ellipsoidRay.ts', 'src/data/loaders/pckRadii.ts', 'src/data/loaders/pckOrientation.ts',
    'src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/de440Source.ts', 'src/engine/ephemeris/receptionLightTime.ts', 'src/engine/ephemeris/barycentricTime.ts',
    'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts',
    'src/lib/stellarObserver.ts', 'src/lib/stellarMotion.ts', 'src/lib/groundObservation.ts', 'src/lib/gaiaCsvSource.ts',
    'src/lib/stellarCovariance.ts', 'src/lib/gaiaAstrometricCovariance.ts', 'src/lib/stateTiles.ts',
    'src/lib/currentPositions.ts', 'src/engine/units.ts', 'src/engine/dynamics/pointMassGravity.ts', 'src/engine/dynamics/solarRelativity.ts']
  const implementationSha256 = Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')])))
  signal?.throwIfAborted()
  const receipt = { ...report, implementationSha256 }
  await writeFile(output, JSON.stringify(receipt, null, 2)+'\n', { flag: 'wx', signal })
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, request, observer, output, ...extra] = process.argv.slice(2)
  if (!input || !request || !observer || !output || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-stellar-limb.mjs <limb-input.json> <observer-request.json> <observer-response.json> <new-output.json>')
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try {
    const result = await evaluateStellarLimbFiles(input, request, observer, output, controller.signal)
    console.log(JSON.stringify({ output, model: result.model, classification: result.sightline.classification }))
  } finally { process.off('SIGINT', cancel) }
}
