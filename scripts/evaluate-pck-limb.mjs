import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadPckOrientation } from '../src/data/loaders/pckOrientation.ts'
import { loadPckRadii } from '../src/data/loaders/pckRadii.ts'
import { ellipsoidLimb } from '../src/engine/events/ellipsoidLimb.ts'

export async function evaluatePckLimb(body, secondsPastJ2000Tdb, observerJ2000Km, output) {
  const root = fileURLToPath(new URL('../', import.meta.url)), source = await readFile(resolve(root, 'src/data/pck00011.tpc'))
  const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  const [orientations, shapes] = await Promise.all([loadPckOrientation(bytes), loadPckRadii(bytes)])
  const orientation = orientations.evaluate(body, secondsPastJ2000Tdb), shape = shapes.get(body)
  if (!orientation || !shape) throw new Error('Exact PCK ID must have both source axes and orientation; no alias is inferred')
  const limb = ellipsoidLimb(shape.radiiKm, orientation.j2000ToBodyFixed, observerJ2000Km)
  const files = ['src/data/loaders/pckOrientation.ts', 'src/data/loaders/pckRadii.ts', 'src/engine/events/ellipsoidLimb.ts']
  const implementationSha256 = Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])))
  const report = { schemaVersion: 1, source: shapes.source, shape, orientation, observerJ2000Km, limb,
    limitations: [...orientations.limitations, ...shapes.limitations, ...limb.limitations], implementationSha256 }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [body, seconds, x, y, z, flag, output, ...extra] = process.argv.slice(2)
  if ([body, seconds, x, y, z].some(value => !value?.trim()) || flag !== '--output' || !output || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-pck-limb.mjs <PCK ID> <TDB seconds> <observer x km> <y km> <z km> --output <new.json>')
  const result = await evaluatePckLimb(Number(body), Number(seconds), [x, y, z].map(Number), output)
  console.log(JSON.stringify({ output, body, model: result.limb.model }))
}
