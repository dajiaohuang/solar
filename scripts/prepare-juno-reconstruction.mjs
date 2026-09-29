// Acquires one pinned Juno reconstruction, then writes an immutable prepared
// crop. It never edits either release manifest or claims numerical accuracy.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { createKernelResolver } from '../src/engine/ephemeris/kernelPool.ts'
import { utcJulianDayToEt } from '../src/engine/ephemeris/timeScales.ts'
import { cropSpk } from './crop-spk.mjs'
import { analyzeKernelWindow } from './lib/kernel-window-coverage.mjs'
import { JUNO_IMPLEMENTATION_PATHS, JUNO_RECONSTRUCTION } from './lib/juno-source-set.mjs'
import { SPACECRAFT_IDENTITIES } from '../src/data/spacecraftIdentities.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_ORIGINAL_BYTES = 160 * 1024 * 1024
const sha256 = value => createHash('sha256').update(value).digest('hex')
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fail = message => { throw new Error(`Juno preparation: ${message}`) }

async function acquire(url, limit) {
  const startedAt = new Date().toISOString()
  const head = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(120_000) })
  if (!head.ok) fail(`source HEAD returned HTTP ${head.status}`)
  const declared = Number(head.headers.get('content-length'))
  const lastModified = head.headers.get('last-modified')
  const etag = head.headers.get('etag')
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > limit || !lastModified) fail('source size or Last-Modified is missing or outside its byte budget')
  const headers = etag ? { 'If-Match': etag } : { 'If-Unmodified-Since': lastModified }
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(180_000) })
  if (!response.ok) { await response.body?.cancel(); fail(`source GET returned HTTP ${response.status}`) }
  if (response.headers.get('last-modified') !== lastModified || response.headers.get('etag') !== etag) {
    await response.body?.cancel(); fail('source identity changed after HEAD')
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength !== declared) { await response.body?.cancel(); fail('source Content-Length changed') }
  const reader = response.body?.getReader()
  if (!reader) fail('source response body is unavailable')
  const buffer = Buffer.alloc(declared)
  let offset = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      if (offset + part.value.length > buffer.length) fail('source exceeded its declared byte count')
      buffer.set(part.value, offset); offset += part.value.length
    }
    if (offset !== declared) fail('source body was truncated')
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  return { bytes: buffer, evidence: { source: url, bytes: offset, sha256: sha256(buffer), startedAt,
    completedAt: new Date().toISOString(), etag, lastModified } }
}

function inspectWindow(kernel, startEt, endEt) {
  const segments = kernel.segments
  if (!segments.length || segments.some(segment => segment.target !== JUNO_RECONSTRUCTION.naifId ||
      segment.center !== JUNO_RECONSTRUCTION.centerNaifId || segment.frame !== 1 || segment.type !== 1)) {
    fail('source or crop contains an unexpected target, center, frame, or SPK type')
  }
  if (Math.min(...segments.map(segment => segment.startEt)) > startEt || Math.max(...segments.map(segment => segment.endEt)) < endEt) {
    fail('source or crop does not span the requested window')
  }
}

export async function prepareJunoReconstruction({ name, reuseDirectory }) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) fail('a new lowercase cache directory name is required')
  const identity = SPACECRAFT_IDENTITIES.find(row => row.id === JUNO_RECONSTRUCTION.id && row.naifId === JUNO_RECONSTRUCTION.naifId)
  if (!identity) fail('reviewed NAIF identity is missing')
  const startEt = utcJulianDayToEt(JUNO_RECONSTRUCTION.startUtcJulianDay)
  const endEt = JUNO_RECONSTRUCTION.endEt
  if (!Number.isFinite(startEt) || startEt >= endEt) fail('invalid TDB window')
  if (reuseDirectory !== undefined && typeof reuseDirectory !== 'string') fail('reused source directory must be a relative cache path')

  const parent = join(ROOT, '.cache', 'spacecraft-packs'), output = join(parent, name)
  await mkdir(parent, { recursive: true })
  await mkdir(output)
  await mkdir(join(output, 'originals'))

  let original, notes, orbitTable
  if (reuseDirectory) {
    const reuseRoot = resolve(ROOT, reuseDirectory), reuseRel = relative(join(ROOT, '.cache', 'spacecraft-packs'), reuseRoot)
    if (!reuseRel || isAbsolute(reuseRel) || reuseRel === '..' || reuseRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) fail('reused source must remain inside .cache/spacecraft-packs')
    const prior = JSON.parse(await readFile(join(reuseRoot, 'prepared-manifest.json'), 'utf8'))
    if (prior.purpose !== 'prepared-juno-reconstructed-source' || prior.source?.id !== identity.id ||
        prior.source?.source !== JUNO_RECONSTRUCTION.sourceUrl || prior.source?.sha256?.length !== 64) fail('reused source receipt does not identify the reviewed Juno source')
    if (prior.source.originalPath !== 'originals/juno_rec_orbit.bsp') fail('reused original path differs from the reviewed source layout')
    const priorOriginal = await readFile(join(reuseRoot, prior.source.originalPath))
    if (priorOriginal.length !== prior.source.bytes || sha256(priorOriginal) !== prior.source.sha256) fail('reused original Juno SPK differs from its receipt')
    const noteFor = path => prior.notes?.find(row => row.path === path)
    const readPriorNote = async path => {
      const evidence = noteFor(path)
      if (!evidence || !/^[a-f0-9]{64}$/.test(evidence.sha256)) fail(`reused source note receipt is missing: ${path}`)
      const bytes = await readFile(join(reuseRoot, path))
      if (bytes.length !== evidence.bytes || sha256(bytes) !== evidence.sha256) fail(`reused source note differs from its receipt: ${path}`)
      return { bytes, evidence }
    }
    const priorOriginalIdentity = { source: prior.source.source, bytes: prior.source.bytes, sha256: prior.source.sha256,
      startedAt: prior.source.startedAt, completedAt: prior.source.completedAt, etag: prior.source.etag, lastModified: prior.source.lastModified }
    original = { bytes: priorOriginal, evidence: priorOriginalIdentity }
    notes = await readPriorNote('originals/aareadme.txt')
    orbitTable = await readPriorNote('originals/juno_rec_orbit.orb')
  } else {
    original = await acquire(JUNO_RECONSTRUCTION.sourceUrl, MAX_ORIGINAL_BYTES)
    notes = await acquire(JUNO_RECONSTRUCTION.readmeUrl, 1024 * 1024)
    orbitTable = await acquire(JUNO_RECONSTRUCTION.orbitTableUrl, 1024 * 1024)
  }
  await writeFile(join(output, 'originals', 'juno_rec_orbit.bsp'), original.bytes, { flag: 'wx' })
  await writeFile(join(output, 'originals', 'aareadme.txt'), notes.bytes, { flag: 'wx' })
  await writeFile(join(output, 'originals', 'juno_rec_orbit.orb'), orbitTable.bytes, { flag: 'wx' })

  const originalKernel = new SpkKernel(original.bytes.buffer.slice(original.bytes.byteOffset, original.bytes.byteOffset + original.bytes.byteLength))
  inspectWindow(originalKernel, startEt, endEt)
  const startEtSource = Math.min(...originalKernel.segments.map(segment => segment.startEt))
  const endEtSource = Math.max(...originalKernel.segments.map(segment => segment.endEt))
  if (startEt < startEtSource || endEt > endEtSource) fail('source descriptor bounds changed')

  const coreManifest = JSON.parse(await readFile(join(ROOT, 'src/data/ephemeris-manifest.json'), 'utf8'))
  const fullManifest = JSON.parse(await readFile(join(ROOT, 'src/data/ephemeris-manifest-full.json'), 'utf8'))
  const core = coreManifest.files.find(file => file.id === JUNO_RECONSTRUCTION.coreKernelId)
  const fullCore = fullManifest.files.find(file => file.id === JUNO_RECONSTRUCTION.coreKernelId)
  if (!core?.core || !fullCore?.core || core.sha256 !== fullCore.sha256 || !core.targets.includes(5) || !core.targets.includes(10) ||
      core.startEt > startEt || core.endEt < endEt || fullCore.startEt > startEt || fullCore.endEt < endEt) {
    fail('the exact declared DE440S center/origin kernel does not cover the requested interval in both profiles')
  }
  const coreBytes = await readFile(join(ROOT, 'public/data/ephemerides', core.path))
  if (coreBytes.length !== core.bytes || sha256(coreBytes) !== core.sha256) fail('local DE440S dependency bytes differ from both manifests')
  const coreKernel = new SpkKernel(coreBytes.buffer.slice(coreBytes.byteOffset, coreBytes.byteOffset + coreBytes.byteLength))

  const windowId = sha256(JSON.stringify([startEt, endEt])).slice(0, 12)
  const rootId = `juno-${original.evidence.sha256.slice(0, 16)}-${windowId}-trajectory`
  const source = { size: original.bytes.length, identity: original.evidence,
    async read(start, length) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 1 || start + length > original.bytes.length) fail('crop requested bytes outside the original source')
      return Buffer.from(original.bytes.subarray(start, start + length))
    } }
  const cropped = await cropSpk(source, { startEt, endEt, targets: [JUNO_RECONSTRUCTION.naifId] })
  const rootKernel = new SpkKernel(cropped.buffer.buffer.slice(cropped.buffer.byteOffset, cropped.buffer.byteOffset + cropped.buffer.byteLength))
  inspectWindow(rootKernel, startEt, endEt)
  const sourceIdentity = { ...original.evidence, notesSha256: notes.evidence.sha256,
    orbitEventsSha256: orbitTable.evidence.sha256 }
  const rootFile = { id: rootId, path: `${rootId}.bsp`, bytes: cropped.buffer.length, sha256: cropped.sha256,
    targets: [...new Set(rootKernel.segments.map(segment => segment.target))],
    startEt: Math.min(...rootKernel.segments.map(segment => segment.startEt)),
    endEt: Math.max(...rootKernel.segments.map(segment => segment.endEt)),
    source: original.evidence.source, sourceIdentity, core: false, dependencyOnly: false,
    solutionKernelIds: [core.id], solution: JUNO_RECONSTRUCTION.solution }
  const coverage = analyzeKernelWindow({ kernels: [
    { id: core.id, dependencyOnly: false, segments: coreKernel.segments },
    { id: rootId, dependencyOnly: false, solutionKernelIds: [core.id], segments: rootKernel.segments },
  ], target: identity.naifId, startEt, endEt })
  if (coverage.gaps.length) fail(`declared source center chain has ${coverage.gaps.length} coverage gaps`)
  const loaded = [
    { id: core.id, sha256: core.sha256, kernel: coreKernel },
    { id: rootId, sha256: cropped.sha256, solutionKernelIds: [core.id], kernel: rootKernel },
  ]
  for (const et of [startEt, (startEt + endEt) / 2, endEt]) {
    const resolver = createKernelResolver(loaded, et), state = resolver.relative(identity.naifId, 10), chain = resolver.sourceChain(identity.naifId)
    const finite = !!state && Object.values(state.position).every(Number.isFinite) && Object.values(state.velocity).every(Number.isFinite)
    if (!finite || !chain || chain.length < 2 || chain[0].kernelId !== rootId || chain[1].kernelId !== core.id || chain[1].target !== JUNO_RECONSTRUCTION.centerNaifId) {
      fail(`finite Sun-relative state and exact two-file source chain are missing at ET ${et}`)
    }
  }
  await writeFile(join(output, rootFile.path), cropped.buffer, { flag: 'wx' })

  const implementation = []
  for (const path of JUNO_IMPLEMENTATION_PATHS) implementation.push({ path, sha256: sha256(await readFile(join(ROOT, path))) })
  const manifestBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1,
    purpose: 'prepared-juno-reconstructed-source', status: 'pending-source-and-numerical-acceptance',
    requestedWindow: { startEt, endEt, startLabel: JUNO_RECONSTRUCTION.startLabel, endLabel: JUNO_RECONSTRUCTION.endLabel, timeScale: 'TDB seconds past J2000' },
    baselineManifests: {
      pages: { path: 'src/data/ephemeris-manifest.json', sha256: sha256(await readFile(join(ROOT, 'src/data/ephemeris-manifest.json'))) },
      full: { path: 'src/data/ephemeris-manifest-full.json', sha256: sha256(await readFile(join(ROOT, 'src/data/ephemeris-manifest-full.json'))) },
    },
    source: { id: identity.id, target: identity.naifId, name: identity.name, originalPath: 'originals/juno_rec_orbit.bsp', ...sourceIdentity,
      reviewedNotes: { source: JUNO_RECONSTRUCTION.readmeUrl, orbitEvents: JUNO_RECONSTRUCTION.orbitTableUrl,
        consultedOn: '2026-09-29', describedUncertainty: 'PDS reports informal ~25 km 1-sigma cruise and ~1 km 1-sigma perijove reconstruction scales; neither is a per-state bound for this crop.' },
      boundary: 'Reconstructed target -61 relative to Jupiter system barycenter 5. The packaged window ends at the latest source descriptor recorded here; coverage is not an accuracy or uncertainty bound.' },
    notes: [
      { ...notes.evidence, path: 'originals/aareadme.txt' },
      { ...orbitTable.evidence, path: 'originals/juno_rec_orbit.orb' },
    ],
    externalDependencies: [{ id: core.id, sha256: core.sha256, bytes: core.bytes }],
    files: [rootFile], coverage: { gaps: 0, meaning: coverage.meaning }, implementation,
    limitations: ['The original navigation source and the DE440S center/origin kernel are separate fits; their composition is identified but not numerically accepted here.',
      'The source documents only broad informal reconstruction uncertainty scales; no covariance or per-epoch residual bound is supplied by this integration.',
      'No numerical comparison or application test is performed during source preparation.'] }, null, 2)}\n`)
  await writeFile(join(output, 'prepared-manifest.json'), manifestBytes, { flag: 'wx' })
  return { output, status: 'pending-source-and-numerical-acceptance', root: rootFile, requestedWindow: { startEt, endEt } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, reuseDirectory, ...extra] = process.argv.slice(2)
  if (!name || extra.length) fail('usage: node --experimental-strip-types scripts/prepare-juno-reconstruction.mjs NEW_CACHE_NAME [REUSED_SOURCE_DIRECTORY]')
  console.log(JSON.stringify(await prepareJunoReconstruction({ name, reuseDirectory })))
}
