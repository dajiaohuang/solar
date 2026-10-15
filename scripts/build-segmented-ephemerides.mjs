import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { createKernelResolver, toEcliptic } from '../src/engine/ephemeris/kernelPool.ts'
import { selectEphemerisFiles } from '../src/data/ephemerisSelection.ts'
import { fitApproximationInterval } from '../src/engine/ephemeris/segmentedApproximation.ts'

const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const output = resolve(option('--out', 'public/data/approximation'))
const sourceManifestPath = option('--source-manifest', 'src/data/ephemeris-manifest-full.json')
const manifestBytes = await readFile(sourceManifestPath)
const manifest = JSON.parse(manifestBytes)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const positionToleranceKm = Number(option('--position-km', '5'))
const velocityToleranceKmS = Number(option('--velocity-km-s', '0.005'))
const requestedIds = option('--bodies', '')?.split(',').filter(Boolean)
const bodyFile = option('--body-file', null)
if (bodyFile) requestedIds.push(...JSON.parse(await readFile(bodyFile, 'utf8')))
const stopBefore = option('--stop-before', null)
const startLimit = option('--start-et', null), endLimit = option('--end-et', null)
const resumeFrom = option('--resume-from', null)
if (![positionToleranceKm, velocityToleranceKmS].every(value => Number.isFinite(value) && value > 0)
  || [startLimit, endLimit].some(value => value !== null && !Number.isFinite(Number(value)))) throw new Error('Invalid fit tolerance or time limit')
if (requestedIds.length && output === resolve('public/data/approximation')) throw new Error('Partial body selections require a separate --out directory')
const loaded = new Map()
const server = await createServer({ configFile: false, cacheDir: '.cache/segmented-generator-vite',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
try {
  const { majorBodies } = await server.ssrLoadModule('/src/data/majorBodies.ts')
  const { SCIENTIFIC_SPACECRAFT } = await server.ssrLoadModule('/src/data/scientificSpacecraft.ts')
  const { bodyNaifId } = await server.ssrLoadModule('/src/data/ephemerisTargets.ts')
  const bodies = [...majorBodies, ...SCIENTIFIC_SPACECRAFT]
  const bodyById = new Map(bodies.map(body => [body.id, body]))
  let selected = requestedIds.length ? bodies.filter(body => requestedIds.includes(body.id)) : bodies
  if (stopBefore !== null) {
    const stop = selected.findIndex(body => body.id === stopBefore)
    if (stop < 0) throw new Error('Unknown stop boundary')
    selected = selected.slice(0, stop)
  }
  const resumeIndex = resumeFrom === null ? 0 : selected.findIndex(body => body.id === resumeFrom)
  if (resumeIndex < 0 || (resumeFrom !== null && requestedIds.length)) throw new Error('Resume requires a known body in the full registry')
  const completedFiles = resumeFrom === null ? [] : await readdir(join(output, 'chunks'))
  const sourceHashesAllowed = new Set(manifest.files.map(file => file.sha256))
  if (requestedIds.some(id => !bodyById.has(id))) throw new Error('Unknown requested approximation body')
  await mkdir(output, { recursive: true })
  const published = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1',
    frame: 'ECLIPJ2000', timeScale: 'TDB', positionUnit: 'km', velocityUnit: 'km/s',
    sourceManifestSha256: digest(manifestBytes), sourceManifestPath, positionToleranceKm, velocityToleranceKmS,
    validation: '66 off-node samples per candidate; measured error, not a continuous bound or physical uncertainty',
    boundaryConvention: 'right-side state at internal SPK switches; endpoint validation uses one-sided limits',
    candidates: [8, 12, 16], bodies: [], totalBytes: 0 }
  if (resumeFrom !== null) published.reusedVerifiedPrefixBefore = resumeFrom
  for (const body of selected) {
    const target = bodyNaifId(body)
    const parent = body.parentId && bodyById.get(body.parentId)
    const center = parent ? bodyNaifId(parent) : 10
    const roots = manifest.files.filter(file => !file.dependencyOnly && file.targets.includes(target))
    const entry = { id: body.id, parentId: parent?.id ?? 'sun', target, center,
      chunks: [], missingIntervals: [], seedModel: false, available: false }
    if (body.id === 'sun') { entry.available = true; entry.origin = true; published.bodies.push(entry); continue }
    if (!roots.length || center === undefined) { published.bodies.push(entry); continue }
    const poolFiles = selectEphemerisFiles(manifest.files, new Set([target, center]))
    const wanted = new Set(poolFiles.map(file => file.id))
    for (const id of loaded.keys()) if (!wanted.has(id)) loaded.delete(id)
    for (const file of poolFiles) {
      if (loaded.has(file.id)) continue
      const raw = await readFile(file.localPath ?? join('public/data/ephemerides', file.path))
      if (raw.byteLength !== file.bytes || digest(raw) !== file.sha256) throw new Error(`Source checksum mismatch: ${file.id}`)
      loaded.set(file.id, { id: file.id, sha256: file.sha256, dependencyOnly: file.dependencyOnly,
        solutionKernelIds: file.solutionKernelIds, kernel: new SpkKernel(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) })
    }
    const kernels = poolFiles.map(file => loaded.get(file.id))
    const start = Math.max(Math.min(...roots.map(file => file.startEt)), startLimit === null ? -Infinity : Number(startLimit))
    const end = Math.min(Math.max(...roots.map(file => file.endEt)), endLimit === null ? Infinity : Number(endLimit))
    if (!(end > start)) { published.bodies.push(entry); continue }
    if (resumeFrom !== null && selected.indexOf(body) < resumeIndex) {
      const prefix = `${encodeURIComponent(body.id)}-`
      for (const name of completedFiles.filter(name => name.startsWith(prefix) && name.endsWith('.json'))) {
        const raw = await readFile(join(output, 'chunks', name)), hash = digest(raw), document = JSON.parse(raw)
        if (!name.endsWith(`-${hash.slice(0, 16)}.json`) || document.id !== body.id || document.parentId !== entry.parentId
          || document.sourceManifestSha256 !== published.sourceManifestSha256 || !document.segments?.length
          || !document.sourceKernelHashes?.length || document.sourceKernelHashes.some(hash => !sourceHashesAllowed.has(hash))) throw new Error(`Invalid completed checkpoint: ${name}`)
        const first = document.segments[0].startEt, last = document.segments.at(-1).endEt
        if (first < start || last > end || document.segments.some(segment => !(segment.sampledPositionErrorKm <= positionToleranceKm)
          || !(segment.sampledVelocityErrorKmS <= velocityToleranceKmS))) throw new Error(`Checkpoint does not meet the requested coverage/tolerances: ${name}`)
        entry.chunks.push({ path: `chunks/${name}`, bytes: raw.byteLength, sha256: hash, startEt: first, endEt: last,
          segmentCount: document.segments.length, sampledPositionErrorKm: Math.max(...document.segments.map(segment => segment.sampledPositionErrorKm)),
          sampledVelocityErrorKmS: Math.max(...document.segments.map(segment => segment.sampledVelocityErrorKmS)) })
        published.totalBytes += raw.byteLength
      }
      entry.chunks.sort((a, b) => a.startEt - b.startEt)
      let cursor = start
      for (const chunk of entry.chunks) {
        if (chunk.startEt < cursor) throw new Error(`Overlapping completed checkpoints: ${body.id}`)
        if (chunk.startEt > cursor) entry.missingIntervals.push([cursor, chunk.startEt])
        cursor = chunk.endEt
      }
      if (cursor < end) entry.missingIntervals.push([cursor, end])
      entry.available = entry.chunks.length > 0
      published.bodies.push(entry)
      continue
    }
    const boundaries = new Set([start, end])
    for (const file of poolFiles) for (const edge of [file.startEt, file.endEt]) if (edge > start && edge < end) boundaries.add(edge)
    // Internal SPK source changes are boundaries too, including center chains.
    for (const kernel of kernels) for (const segment of kernel.kernel.segments) {
      for (const edge of [segment.startEt, segment.endEt]) if (edge > start && edge < end) boundaries.add(edge)
    }
    // Year-sized files bound network/cache use; month-sized initial fits keep
    // candidate validation from aliasing fast satellite periods over years.
    for (let et = start + 32 * 86400; et < end; et += 32 * 86400) boundaries.add(et)
    const edges = [...boundaries].sort((a, b) => a - b)
    let segments = [], chunkStart = start, chunkIndex = 0, sourceHashes = new Set()
    const flush = async () => {
      if (!segments.length) return
      const document = { schemaVersion: 1, id: body.id, parentId: entry.parentId,
        sourceManifestSha256: published.sourceManifestSha256, sourceKernelHashes: [...sourceHashes].sort(), segments }
      const raw = Buffer.from(JSON.stringify(document)), sha256 = digest(raw)
      const path = `chunks/${encodeURIComponent(body.id)}-${chunkIndex++}-${sha256.slice(0, 16)}.json`
      await mkdir(join(output, 'chunks'), { recursive: true }); await writeFile(join(output, path), raw)
      entry.chunks.push({ path, bytes: raw.byteLength, sha256, startEt: segments[0].startEt, endEt: segments.at(-1).endEt,
        segmentCount: segments.length, sampledPositionErrorKm: Math.max(...segments.map(segment => segment.sampledPositionErrorKm)),
        sampledVelocityErrorKmS: Math.max(...segments.map(segment => segment.sampledVelocityErrorKmS)) })
      published.totalBytes += raw.byteLength; segments = []; sourceHashes = new Set()
    }
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i], b = edges[i + 1]
      const midpoint = createKernelResolver(kernels, (a + b) / 2)
      const { target: lineage, observer: centerLineage } = midpoint.relativeSourceChains(target, center)
      if (!midpoint.relative(target, center) || !lineage || !centerLineage) {
        await flush(); entry.missingIntervals.push([a, b]); continue
      }
      // Freeze root precedence inside a segment, including shared endpoints.
      // A source change starts the next segment; fitting must not cross it.
      // All segment/center switches are interval boundaries. Evaluate the
      // exact midpoint-selected chains directly instead of copying hundreds
      // of unrelated kernel descriptors for every candidate sample.
      const stateAlong = (chain, et) => {
        const sum = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
        for (const item of [...chain].reverse()) {
          const state = loaded.get(item.kernelId).kernel.evaluate(item.target, et)
          if (!state || state.center !== item.center || state.frame !== item.frame) throw new Error(`Frozen source chain changed: ${body.id} ET ${et}`)
          for (const key of ['position', 'velocity']) {
            const vector = toEcliptic(state[key], state.frame)
            for (const axis of ['x', 'y', 'z']) sum[key][axis] += vector[axis]
          }
        }
        return sum
      }
      const source = et => {
        // A closed SPK segment boundary may select its successor. Fit the
        // left-hand limit here; runtime lookup chooses the right-hand fitted
        // segment at shared boundaries. This prevents a maneuver endpoint
        // from contaminating every subdivision of its preceding interval.
        const sourceEt = et === a && a > start ? Math.min(b, a + Math.max(1, Math.abs(a)) * Number.EPSILON)
          : et === b && b < end ? Math.max(a, b - Math.max(1, Math.abs(b)) * Number.EPSILON) : et
        const targetState = stateAlong(lineage, sourceEt), centerState = stateAlong(centerLineage, sourceEt)
        return Object.fromEntries(['position', 'velocity'].map(key => [key, Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, targetState[key][axis] - centerState[key][axis]]))]))
      }
      for (const et of [a + .01 * (b - a), (a + b) / 2, b - .01 * (b - a)]) {
        const actual = source(et), expected = createKernelResolver(kernels, et).relative(target, center)
        if (!expected || ['position', 'velocity'].some(key => ['x', 'y', 'z'].some(axis => actual[key][axis] !== expected[key][axis]))) throw new Error(`Frozen chain differs from source resolver: ${body.id}`)
      }
      // Smallest declared period prevents an apparently constant, undersampled
      // fit from accepting a short-period moon over a long initial interval.
      const period = body.orbit?.model === 'keplerian' ? 360 / Math.abs(body.orbit.meanMotionDegPerDay) * 86400 : Infinity
      const width = Math.min(b - a, period * 4)
      if (!(width > 0)) throw new Error(`Invalid source period ${body.id}`)
      for (let left = a; left < b;) {
        const right = Math.min(b, left + width)
        segments.push(...fitApproximationInterval(source, left, right, positionToleranceKm, velocityToleranceKmS))
        for (const item of [...lineage, ...centerLineage]) sourceHashes.add(item.kernelSha256)
        left = right
      }
      if (b - chunkStart >= 366 * 86400) { await flush(); chunkStart = b }
    }
    await flush(); entry.available = entry.chunks.length > 0
    published.bodies.push(entry)
    console.log(`${body.id}: ${entry.chunks.length} chunks, ${entry.chunks.reduce((sum, chunk) => sum + chunk.segmentCount, 0)} segments`)
  }
  const raw = JSON.stringify(published, null, 2)
  await writeFile(join(output, 'manifest.json'), raw)
  console.log(`Published ${published.bodies.filter(body => body.available).length}/${published.bodies.length} bodies, ${(published.totalBytes / 1048576).toFixed(1)} MiB, ${digest(raw)}`)
  await stat(join(output, 'manifest.json'))
} finally { await server.close() }
