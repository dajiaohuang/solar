// Offline source-backed orientation evaluation. No source acquisition or publication.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadPckOrientation } from '../src/data/loaders/pckOrientation.ts'

export async function evaluatePckOrientation(body, secondsPastJ2000Tdb, output) {
  const root = fileURLToPath(new URL('../', import.meta.url)), source = await readFile(resolve(root, 'src/data/pck00011.tpc'))
  const loaded = await loadPckOrientation(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
  const state = loaded.evaluate(body, secondsPastJ2000Tdb)
  if (!state) throw new Error('No orientation model for this exact PCK body ID')
  const files = ['src/data/loaders/pckOrientation.ts', 'src/data/loaders/pckRadii.ts']
  const implementationSha256 = Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])))
  const report = { schemaVersion: 1, source: loaded.source, orientation: state, limitations: loaded.limitations, implementationSha256 }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [body, seconds, flag, output, ...extra] = process.argv.slice(2)
  if (!body || !seconds || flag !== '--output' || !output || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-pck-orientation.mjs <PCK body ID> <TDB seconds past J2000> --output <new.json>')
  const result = await evaluatePckOrientation(Number(body), Number(seconds), output)
  console.log(JSON.stringify({ output, body: result.orientation.naifPckId, secondsPastJ2000Tdb: result.orientation.secondsPastJ2000Tdb, model: result.orientation.model }))
}
