import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Read-only audit of both checked-in SPK profiles. Sampling a descriptor is
// integrity/evaluation evidence, not a continuous accuracy certification.
const output = process.argv[2]
const readerPath = resolve(process.argv[3] ?? 'src/engine/ephemeris/spk.ts')
const { SpkKernel } = await import(pathToFileURL(readerPath).href)
const files = new Map(), profiles = []
for (const name of ['ephemeris-manifest.json', 'ephemeris-manifest-full.json']) {
  const raw = await readFile(resolve('src/data', name))
  const manifest = JSON.parse(raw)
  profiles.push({ name, sha256: createHash('sha256').update(raw).digest('hex'), files: manifest.files.length })
  for (const entry of manifest.files) {
    if (!/^[\w.-]+\.bsp$/.test(entry.path)) throw new Error(`Invalid SPK path: ${entry.path}`)
    const existing = files.get(entry.path)
    if (existing && (existing.sha256 !== entry.sha256 || existing.bytes !== entry.bytes)) throw new Error(`Conflicting profiles: ${entry.path}`)
    files.set(entry.path, entry)
  }
}
const types = {}, frames = {}, samples = createHash('sha256')
let bytesTotal = 0, segmentsTotal = 0, statesTotal = 0
for (const entry of [...files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
  const bytes = await readFile(resolve('public/data/ephemerides', entry.path))
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`SPK integrity mismatch: ${entry.path}`)
  const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const actualTargets = [...new Set(kernel.segments.map(s => s.target))].sort((a, b) => a - b)
  if (JSON.stringify(actualTargets) !== JSON.stringify([...new Set(entry.targets)].sort((a, b) => a - b))) throw new Error(`SPK target identity mismatch: ${entry.path}`)
  bytesTotal += bytes.length
  segmentsTotal += kernel.segments.length
  for (const s of kernel.segments) {
    types[s.type] = (types[s.type] ?? 0) + 1
    frames[s.frame] = (frames[s.frame] ?? 0) + 1
    for (const fraction of [0, .25, .5, .75, 1]) {
      const et = s.startEt + (s.endEt - s.startEt) * fraction
      const state = kernel.evaluate(s.target, et)
      if (!state) throw new Error(`Missing in-descriptor state: ${entry.path}/${s.target}/${et}`)
      const vector = [...Object.values(state.position), ...Object.values(state.velocity)]
      if (!vector.every(Number.isFinite)) throw new Error(`Nonfinite SPK state: ${entry.path}/${s.target}/${et}`)
      const numeric = Buffer.alloc(6 * 8)
      vector.forEach((value, index) => numeric.writeDoubleLE(value, index * 8))
      samples.update(JSON.stringify([entry.path, s.target, et, state.center, state.frame])).update(numeric)
      statesTotal++
    }
  }
}
const result = { profiles, uniqueFiles: files.size, bytesTotal, segmentsTotal, statesTotal, types, frames,
  readerSha256: createHash('sha256').update(await readFile(readerPath)).digest('hex'),
  sampledStateSha256: samples.digest('hex'),
  boundary: 'Five evaluations per descriptor; source hashes and finite states do not certify whole-window physical accuracy.' }
if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify(result, null, 2))
