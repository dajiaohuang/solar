// Offline geometric contact experiment. No data retrieval, deployment or publication.
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { loadPckRadii } from '../src/data/loaders/pckRadii.ts'
import { sphericalOccultation } from '../src/engine/events/sphericalOccultation.ts'
import { findOccultationContacts } from '../src/engine/events/occultationContacts.ts'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)

export async function findOccultationFile(sourcePath, outputPath, signal) {
  if ((await stat(sourcePath)).size > 65536) throw new RangeError('Contact experiment input exceeds 64 KiB')
  const bytes = await readFile(sourcePath)
  if (bytes.length > 65536) throw new RangeError('Contact experiment input exceeds 64 KiB')
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const { foregroundId, backgroundId, observerId, referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds } = input ?? {}
  if (input?.schemaVersion !== 1 || input.aberration !== 'NONE' || input.frame !== 'J2000' || input.timeScale !== 'TDB' ||
      ![foregroundId, backgroundId, observerId].every(id => Number.isSafeInteger(id) && id >= 0) || new Set([foregroundId, backgroundId, observerId]).size !== 3 ||
      ![referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || endSeconds < startSeconds ||
      endSeconds-startSeconds > 365*86400 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds) throw new RangeError('Expected explicit distinct NAIF IDs, J2000/NONE/TDB and a finite bounded contact window within 365 days')
  if (signal?.aborted) throw new DOMException('Contact search cancelled', 'AbortError')
  const [spk, pck, gmText] = await Promise.all([readFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root)),
    readFile(new URL('src/data/pck00011.tpc', root)), readFile(new URL('src/data/gm_de440.tpc', root), 'utf8')])
  const shapes = await loadPckRadii(buffer(pck))
  const front = shapes.get(foregroundId), back = shapes.get(backgroundId)
  if (!front || !back || front.representation !== 'sphere' || back.representation !== 'sphere') throw new RangeError('Both targets require sourced equal-axis spheres; missing or triaxial shapes are not replaced by mean radii')
  // Reuse the verified original state accessor only. No force integration or
  // restricted-dynamics approximation is used to predict these source states.
  const states = await createDe440Dynamics({ spkBytes: buffer(spk), gmText, referenceEpochTdb,
    elapsedRangeSeconds: [Math.min(0, startSeconds), Math.max(0, endSeconds)], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
  const result = await findOccultationContacts({ startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, signal,
    evaluate(elapsed) {
      const observer = states.state(observerId, elapsed)
      const body = shape => {
        const state = states.state(shape.naifPckId, elapsed)
        return { positionKm: [state[0]-observer[0], state[1]-observer[1], state[2]-observer[2]], radiusKm: shape.radiiKm[0] }
      }
      return sphericalOccultation(body(front), body(back))
    } })
  const implementationSha256 = {}
  for (const path of ['scripts/find-occultation-contacts.mjs', 'src/engine/events/occultationContacts.ts', 'src/engine/events/sphericalOccultation.ts',
    'src/data/loaders/pckRadii.ts', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts']) {
    implementationSha256[path] = sha(await readFile(new URL(path, root)))
  }
  const receipt = { schemaVersion: 1, calculation: 'geometric-spherical-occultation-contacts', inputFile: { sha256: sha(bytes), bytes: bytes.length, payload: input },
    ephemeris: { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', aberration: 'NONE', referenceEpochTdb, kernel: states.evidence.kernel },
    shapes: { source: shapes.source, foreground: front, background: back, limitations: shapes.limitations }, implementationSha256, ...result,
    physicalTimingUncertaintySeconds: null }
  if (signal?.aborted) throw new DOMException('Contact search cancelled', 'AbortError')
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return { outputPath: resolve(outputPath), contacts: result.contacts.length, evaluations: result.evaluations, possibleMissedEvents: result.possibleMissedEvents }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, ...extra] = process.argv.slice(2)
  if (!input || !output || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/find-occultation-contacts.mjs <experiment.json> <new-output.json>')
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await findOccultationFile(input, output, controller.signal), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
