// Offline, explicit preparation only: split a verified original-record crop
// into lazy-loadable per-target files. This does not select a runtime solution
// family, validate physical accuracy, or publish an application manifest.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { openSource, cropSpk } from './crop-spk.mjs'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { kernelsCoveringInterval } from '../src/engine/ephemeris/kernelPool.ts'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const parse = bytes => new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const MAX_RUNTIME_FILE_BYTES = 128 * 1024 * 1024

export async function splitSpkCrop({ input, output }) {
  const evidenceBytes = await readFile(`${input}.json`)
  const evidence = JSON.parse(evidenceBytes)
  const bytes = await readFile(input)
  if (bytes.length !== evidence.bytes || digest(bytes) !== evidence.sha256) throw new Error('Input crop integrity mismatch')
  let sourceUrl
  try { sourceUrl = new URL(evidence.source?.source) } catch { /* Report one provenance error on every host. */ }
  if (sourceUrl?.protocol !== 'https:') throw new Error('Original HTTPS source provenance required')
  const original = parse(bytes)
  const targets = [...new Set(original.segments.map(segment => segment.target))].sort((a, b) => a - b)
  const from = Math.min(...original.segments.map(segment => segment.startEt))
  const to = Math.max(...original.segments.map(segment => segment.endEt))
  if (!kernelsCoveringInterval([{ id: 'input', kernel: original }], from, to).length) throw new Error('Input targets do not share a complete interval')
  // Never reuse an existing directory or partially overwrite an earlier pack.
  // Failed partial output deliberately has no successful manifest.
  await mkdir(output)
  const source = await openSource(input)
  const files = []
  try {
    for (const target of targets) {
      const result = await cropSpk(source, { startEt: from, endEt: to, targets: [target] })
      if (result.buffer.length > MAX_RUNTIME_FILE_BYTES) throw new Error(`Target ${target} exceeds the 128 MiB runtime file limit; choose a shorter interval`)
      const kernel = parse(result.buffer)
      if (kernel.segments.some(segment => segment.target !== target) || !kernelsCoveringInterval([{ id: String(target), kernel }], from, to).length) throw new Error('Split target coverage mismatch')
      // Verify both position and velocity against the exact input, including
      // every original descriptor boundary. This is crop parity, not an oracle.
      const epochs = new Set([from, to, (from + to) / 2, ...kernel.segments.flatMap(segment => [segment.startEt, segment.endEt])])
      for (const et of epochs) {
        if (JSON.stringify(kernel.evaluate(target, et)) !== JSON.stringify(original.evaluate(target, et))) throw new Error('Split record state parity mismatch')
      }
      const path = `${target}-${result.sha256}.bsp`
      await writeFile(join(output, path), result.buffer, { flag: 'wx' })
      files.push({ path, targets: [target], bytes: result.buffer.length, sha256: result.sha256,
        startEt: from, endEt: to, centers: [...new Set(kernel.segments.map(segment => segment.center))],
        segments: kernel.segments.map(({ target, center, frame, type, startEt, endEt }) => ({ target, center, frame, type, startEt, endEt })),
        source: evidence.source.source, sourceIdentity: evidence.source, cropParityEpochs: [...epochs].sort((a, b) => a - b) })
    }
  } finally { await source.close() }
  const manifest = { schemaVersion: 1,
    contract: 'Prepared original-record per-target crops; input state parity only. Not a runtime manifest, center-chain solution selection, independent physical accuracy validation, or release.',
    inputSha256: evidence.sha256, inputEvidenceSha256: digest(evidenceBytes),
    sourceIdentity: evidence.source, startEt: from, endEt: to, files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), maximumFileBytes: Math.max(...files.map(file => file.bytes)) }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/split-spk-crop.mjs VERIFIED_CROP.bsp NEW_DIRECTORY (adjacent .bsp.json required)')
  const result = await splitSpkCrop({ input, output })
  console.log(JSON.stringify({ targets: result.files.length, bytes: result.totalBytes, maximumFileBytes: result.maximumFileBytes, output }))
}
