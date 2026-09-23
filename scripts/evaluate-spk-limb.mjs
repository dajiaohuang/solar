import { readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DE440_DYNAMICS_SOURCE } from '../src/engine/dynamics/de440Dynamics.ts'
import { parseSpkLimbInput, runSpkLimbExperiment } from '../src/engine/events/spkLimbExperiment.ts'

const root = new URL('../', import.meta.url)
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)
export async function evaluateSpkLimbFile(input, output, signal) {
  if ((await stat(input)).size > 65536) throw new RangeError('Limb input exceeds 64 KiB')
  const bytes = await readFile(input)
  parseSpkLimbInput(buffer(bytes))
  if (signal?.aborted) throw new DOMException('Limb calculation cancelled', 'AbortError')
  const [spk, pck, gmText] = await Promise.all([readFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root)),
    readFile(new URL('src/data/pck00011.tpc', root)), readFile(new URL('src/data/gm_de440.tpc', root), 'utf8')])
  const report = await runSpkLimbExperiment({ inputBytes: buffer(bytes), spkBytes: buffer(spk), pckBytes: buffer(pck), gmText, signal })
  const paths = ['scripts/evaluate-spk-limb.mjs', 'src/engine/events/spkLimbExperiment.ts', 'src/engine/events/ellipsoidLimb.ts',
    'src/data/loaders/pckOrientation.ts', 'src/data/loaders/pckRadii.ts', 'src/engine/dynamics/de440Dynamics.ts',
    'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts', 'src/engine/ephemeris/receptionLightTime.ts']
  const implementationSha256 = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')])))
  if (signal?.aborted) throw new DOMException('Limb calculation cancelled', 'AbortError')
  const receipt = { ...report, implementationSha256 }
  await writeFile(output, JSON.stringify(receipt, null, 2)+'\n', { flag: 'wx' })
  return receipt
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, ...extra] = process.argv.slice(2)
  if (!input || !output || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-spk-limb.mjs <input.json> <new-output.json>')
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { const result = await evaluateSpkLimbFile(input, output, controller.signal); console.log(JSON.stringify({ output, ephemeris: result.ephemeris, model: result.limb.model })) }
  finally { process.off('SIGINT', cancel) }
}
