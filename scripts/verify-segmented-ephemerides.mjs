import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyApproximationAssets } from './lib/verify-approximation-assets.mjs'
import { selectEphemerisFiles } from '../src/data/ephemerisSelection.ts'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { createKernelResolver } from '../src/engine/ephemeris/kernelPool.ts'
import { evaluateApproximation } from '../src/engine/ephemeris/segmentedApproximation.ts'

const root = 'public/data/approximation'
const { manifest } = await verifyApproximationAssets(root)
const source = JSON.parse(await readFile('src/data/ephemeris-manifest-full.json', 'utf8'))
const loaded = new Map()
let tested = 0, maximumPositionErrorKm = 0, maximumVelocityErrorKmS = 0
for (const body of manifest.bodies) {
  if (!body.chunks.length) continue
  const files = selectEphemerisFiles(source.files, new Set([body.target, body.center]))
  const wanted = new Set(files.map(file => file.id))
  for (const id of loaded.keys()) if (!wanted.has(id)) loaded.delete(id)
  for (const file of files) {
    if (loaded.has(file.id)) continue
    const bytes = await readFile(join('public/data/ephemerides', file.path))
    if (bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Source bytes changed: ${file.id}`)
    loaded.set(file.id, { id: file.id, sha256: file.sha256, dependencyOnly: file.dependencyOnly, solutionKernelIds: file.solutionKernelIds,
      kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) })
  }
  const kernels = files.map(file => loaded.get(file.id))
  for (const chunk of body.chunks) {
    const document = JSON.parse(await readFile(join(root, chunk.path), 'utf8'))
    // Additional fractions do not coincide with the generator's fit or
    // validation nodes. Exercise both ends and the middle of every chunk.
    for (const index of new Set([0, Math.floor(document.segments.length / 2), document.segments.length - 1])) {
      const segment = document.segments[index]
      for (const fraction of [.2718281828, .6180339887]) {
        const et = segment.startEt + fraction * (segment.endEt - segment.startEt)
        const actual = evaluateApproximation(segment, et), expected = createKernelResolver(kernels, et).relative(body.target, body.center)
        if (!expected) throw new Error(`Independent source coverage missing: ${body.id}`)
        const error = key => Math.hypot(...['x', 'y', 'z'].map(axis => actual[key][axis] - expected[key][axis]))
        const position = error('position'), velocity = error('velocity')
        if (position > manifest.positionToleranceKm || velocity > manifest.velocityToleranceKmS) throw new Error(`Independent validation failed: ${body.id}, ${position} km, ${velocity} km/s`)
        maximumPositionErrorKm = Math.max(maximumPositionErrorKm, position)
        maximumVelocityErrorKmS = Math.max(maximumVelocityErrorKmS, velocity)
        tested++
      }
    }
  }
}
console.log(JSON.stringify({ tested, maximumPositionErrorKm, maximumVelocityErrorKmS, boundary: 'Independent sampled fit error relative to each local source state; not a continuous bound or physical uncertainty.' }, null, 2))
