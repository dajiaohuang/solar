// Offline geometric contact experiment. No data retrieval, deployment or publication.
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DE440_DYNAMICS_SOURCE } from '../src/engine/dynamics/de440Dynamics.ts'
import { parseOccultationInput, runOccultationExperiment } from '../src/engine/events/occultationExperiment.ts'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)

export async function findOccultationFile(sourcePath, outputPath, signal) {
  if ((await stat(sourcePath)).size > 65536) throw new RangeError('Contact experiment input exceeds 64 KiB')
  const bytes = await readFile(sourcePath)
  if (bytes.length > 65536) throw new RangeError('Contact experiment input exceeds 64 KiB')
  parseOccultationInput(buffer(bytes))
  if (signal?.aborted) throw new DOMException('Contact search cancelled', 'AbortError')
  const [spk, pck, gmText] = await Promise.all([readFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root)),
    readFile(new URL('src/data/pck00011.tpc', root)), readFile(new URL('src/data/gm_de440.tpc', root), 'utf8')])
  const result = await runOccultationExperiment({ inputBytes: buffer(bytes), spkBytes: buffer(spk), pckBytes: buffer(pck), gmText, signal })
  const implementationSha256 = {}
  for (const path of ['scripts/find-occultation-contacts.mjs', 'src/engine/events/occultationExperiment.ts', 'src/engine/events/occultationContacts.ts', 'src/engine/events/sphericalOccultation.ts',
    'src/data/loaders/pckRadii.ts', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts', 'src/engine/ephemeris/receptionLightTime.ts']) {
    implementationSha256[path] = sha(await readFile(new URL(path, root)))
  }
  const receipt = { ...result, implementationSha256 }
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
