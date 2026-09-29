// Verifies a prepared Juno SPK crop and atomically adds it to both manifests.
// This integrates source bytes only; numerical acceptance remains separate.
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { createKernelResolver } from '../src/engine/ephemeris/kernelPool.ts'
import { utcJulianDayToEt } from '../src/engine/ephemeris/timeScales.ts'
import { analyzeKernelWindow } from './lib/kernel-window-coverage.mjs'
import { JUNO_IMPLEMENTATION_PATHS, JUNO_RECONSTRUCTION } from './lib/juno-source-set.mjs'
import { SPACECRAFT_IDENTITIES } from '../src/data/spacecraftIdentities.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFESTS = [
  { profile: 'pages', path: 'src/data/ephemeris-manifest.json' },
  { profile: 'full', path: 'src/data/ephemeris-manifest-full.json' },
]
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
const MAX_ORIGINAL_BYTES = 160 * 1024 * 1024
const MAX_KERNEL_BYTES = 128 * 1024 * 1024
const JUNO_CONTRACT = 'Juno SPK crops retain original Type 1 records and explicitly pin the DE440S center/origin kernel; source coverage is not a numerical accuracy or uncertainty bound.'
const sha256 = value => createHash('sha256').update(value).digest('hex')
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fail = message => { throw new Error(`Juno integration: ${message}`) }

async function boundedRead(path, limit) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > limit) fail(`invalid input size: ${path}`)
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const part = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!part.bytesRead) fail(`truncated input: ${path}`)
      offset += part.bytesRead
    }
    if ((await handle.stat()).size !== bytes.length) fail(`input changed size: ${path}`)
    return bytes
  } finally { await handle.close() }
}

function safePackPath(packRoot, value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) fail('invalid pack path')
  const absolute = resolve(packRoot, value), rel = relative(packRoot, absolute)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) fail('pack path escapes the prepared directory')
  return absolute
}

function inspectKernel(kernel, expectedTargets, startEt, endEt) {
  if (!kernel.segments.length || JSON.stringify([...new Set(kernel.segments.map(s => s.target))]) !== JSON.stringify(expectedTargets)) fail('SPK target set differs from its receipt')
  if (kernel.segments.some(s => s.target !== JUNO_RECONSTRUCTION.naifId || s.center !== JUNO_RECONSTRUCTION.centerNaifId || s.frame !== 1 || s.type !== 1)) fail('SPK is not original Juno Type 1 data relative to NAIF 5 in J2000')
  const segments = kernel.segments.filter(s => s.target === JUNO_RECONSTRUCTION.naifId).sort((a, b) => a.startEt - b.startEt)
  let cursor = startEt
  for (const segment of segments) {
    if (segment.endEt < cursor - 1e-6) continue
    if (segment.startEt > cursor + 1e-6) break
    cursor = Math.max(cursor, segment.endEt)
    if (cursor >= endEt - 1e-6) break
  }
  if (cursor < endEt - 1e-6) fail(`Juno target coverage ends at ${cursor}, before requested ${endEt}`)
}

function addContract(value) {
  if (value !== undefined && typeof value !== 'string') fail('invalid manifest contract')
  const contract = value ?? ''
  return contract.includes(JUNO_CONTRACT) ? contract : `${contract.trimEnd()}${contract.trim() ? ' ' : ''}${JUNO_CONTRACT}`
}

export async function integrateJunoReconstruction({ directory, preparedSha256 }) {
  if (!isSha(preparedSha256) || typeof directory !== 'string' || !directory.trim()) fail('prepared directory and SHA-256 receipt are required')
  const packRoot = resolve(directory)
  const receiptBytes = await boundedRead(join(packRoot, 'prepared-manifest.json'), MAX_MANIFEST_BYTES)
  if (sha256(receiptBytes) !== preparedSha256) fail('prepared receipt SHA-256 mismatch')
  const pack = JSON.parse(receiptBytes)
  if (pack.schemaVersion !== 1 || pack.purpose !== 'prepared-juno-reconstructed-source' || pack.status !== 'pending-source-and-numerical-acceptance') fail('unsupported prepared receipt')
  const startEt = utcJulianDayToEt(JUNO_RECONSTRUCTION.startUtcJulianDay), endEt = JUNO_RECONSTRUCTION.endEt
  if (pack.requestedWindow?.startEt !== startEt || pack.requestedWindow?.endEt !== endEt || pack.requestedWindow?.timeScale !== 'TDB seconds past J2000') fail('requested source window changed')
  if (pack.source?.id !== JUNO_RECONSTRUCTION.id || pack.source?.target !== JUNO_RECONSTRUCTION.naifId || pack.source?.name !== JUNO_RECONSTRUCTION.name ||
      pack.source?.source !== JUNO_RECONSTRUCTION.sourceUrl || !isSha(pack.source?.sha256) || !isSha(pack.source?.notesSha256)) fail('invalid reviewed Juno source identity')
  const identity = SPACECRAFT_IDENTITIES.find(row => row.id === pack.source.id && row.naifId === pack.source.target && row.name === pack.source.name)
  if (!identity) fail('spacecraft identity no longer matches the prepared source')
  if (!Array.isArray(pack.implementation) || JSON.stringify(pack.implementation.map(row => row?.path)) !== JSON.stringify(JUNO_IMPLEMENTATION_PATHS)) fail('implementation inventory differs from the reviewed set')
  for (const item of pack.implementation) {
    if (!item || !isSha(item.sha256) || typeof item.path !== 'string') fail('invalid implementation source digest')
    const path = resolve(ROOT, item.path), rel = relative(ROOT, path)
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) fail('implementation path escapes the repository')
    if (sha256(await boundedRead(path, 16 * 1024 * 1024)) !== item.sha256) fail(`implementation source changed: ${item.path}`)
  }
  if (!Array.isArray(pack.notes) || pack.notes.length !== 2) fail('Juno readme and orbit-event table receipts are required')
  for (const note of pack.notes) {
    if (!note || !isSha(note.sha256) || !Number.isSafeInteger(note.bytes) || note.bytes < 1) fail('invalid source note receipt')
    const bytes = await boundedRead(safePackPath(packRoot, note.path), 1024 * 1024)
    if (bytes.length !== note.bytes || sha256(bytes) !== note.sha256) fail('source note bytes differ from their receipt')
  }
  const originalPath = safePackPath(packRoot, pack.source.originalPath)
  const originalBytes = await boundedRead(originalPath, MAX_ORIGINAL_BYTES)
  if (originalBytes.length !== pack.source.bytes || sha256(originalBytes) !== pack.source.sha256) fail('original Juno SPK differs from its source receipt')
  const originalKernel = new SpkKernel(originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength))

  if (!Array.isArray(pack.files) || pack.files.length !== 1) fail('exactly one cropped Juno trajectory kernel is required')
  const file = pack.files[0]
  if (!file || typeof file.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(file.id) || file.path !== `${file.id}.bsp` ||
      file.core !== false || file.dependencyOnly !== false || !Array.isArray(file.solutionKernelIds) ||
      JSON.stringify(file.solutionKernelIds) !== JSON.stringify([JUNO_RECONSTRUCTION.coreKernelId]) || !isSha(file.sha256) ||
      file.source !== pack.source.source || file.sourceIdentity?.source !== pack.source.source ||
      file.sourceIdentity?.sha256 !== pack.source.sha256 || file.sourceIdentity?.bytes !== pack.source.bytes ||
      file.sourceIdentity?.notesSha256 !== pack.source.notesSha256 || file.sourceIdentity?.orbitEventsSha256 !== pack.source.orbitEventsSha256) fail('invalid cropped trajectory metadata')
  if (!Array.isArray(file.targets) || JSON.stringify(file.targets) !== JSON.stringify([JUNO_RECONSTRUCTION.naifId]) ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_KERNEL_BYTES ||
      !Number.isFinite(file.startEt) || !Number.isFinite(file.endEt) || file.startEt > startEt || file.endEt < endEt) fail('cropped Juno kernel exceeds its target, time, or byte contract')
  const cropBytes = await boundedRead(safePackPath(packRoot, file.path), MAX_KERNEL_BYTES)
  if (cropBytes.length !== file.bytes || sha256(cropBytes) !== file.sha256) fail('cropped Juno SPK differs from its receipt')
  const cropKernel = new SpkKernel(cropBytes.buffer.slice(cropBytes.byteOffset, cropBytes.byteOffset + cropBytes.byteLength))
  inspectKernel(cropKernel, file.targets, startEt, endEt)
  inspectKernel(originalKernel, [JUNO_RECONSTRUCTION.naifId], startEt, endEt)

  const baselineRecords = new Map()
  for (const item of MANIFESTS) {
    const expected = pack.baselineManifests?.[item.profile]
    if (expected?.path !== item.path || !isSha(expected.sha256)) fail(`missing frozen ${item.profile} baseline digest`)
    const bytes = await boundedRead(join(ROOT, item.path), MAX_MANIFEST_BYTES)
    const manifest = JSON.parse(bytes)
    if (manifest.schemaVersion !== 1 || manifest.profile !== item.profile || !Array.isArray(manifest.files)) fail(`invalid ${item.profile} baseline manifest`)
    const core = manifest.files.find(row => row.id === JUNO_RECONSTRUCTION.coreKernelId)
    if (!core?.core || !core.targets.includes(5) || !core.targets.includes(10) || core.startEt > startEt || core.endEt < endEt ||
        core.sha256 !== pack.externalDependencies?.[0]?.sha256 || core.bytes !== pack.externalDependencies?.[0]?.bytes) fail(`${item.profile} has no identical covered DE440S center/origin dependency`)
    const existing = manifest.files.find(row => row.id === file.id || row.path === file.path)
    const alreadyIntegrated = !!existing && existing.sha256 === file.sha256 && existing.integrationBatch === `juno-rec-${preparedSha256.slice(0, 16)}`
    if (existing && !alreadyIntegrated) fail(`${item.profile} Juno kernel identity collides with existing manifest content`)
    if (!alreadyIntegrated && sha256(bytes) !== expected.sha256) fail(`${item.profile} manifest changed after Juno preparation`)
    baselineRecords.set(item.profile, { item, bytes, manifest, core, alreadyIntegrated })
  }
  if (pack.externalDependencies?.length !== 1 || pack.externalDependencies[0].id !== JUNO_RECONSTRUCTION.coreKernelId) fail('explicit external DE440S dependency receipt is missing')
  const coreRecord = baselineRecords.get('pages')
  const coreBytes = await boundedRead(join(ROOT, 'public/data/ephemerides', coreRecord.core.path), MAX_KERNEL_BYTES)
  if (coreBytes.length !== coreRecord.core.bytes || sha256(coreBytes) !== coreRecord.core.sha256) fail('packaged DE440S bytes differ from the declared dependency')
  const coreKernel = new SpkKernel(coreBytes.buffer.slice(coreBytes.byteOffset, coreBytes.byteOffset + coreBytes.byteLength))
  const coverage = analyzeKernelWindow({ kernels: [
    { id: coreRecord.core.id, dependencyOnly: false, segments: coreKernel.segments },
    { id: file.id, dependencyOnly: false, solutionKernelIds: file.solutionKernelIds, segments: cropKernel.segments },
  ], target: identity.naifId, startEt, endEt })
  if (coverage.gaps.length) fail(`explicit Juno-to-DE440S center chain has ${coverage.gaps.length} descriptor gaps`)
  const loaded = [
    { id: coreRecord.core.id, sha256: coreRecord.core.sha256, kernel: coreKernel },
    { id: file.id, sha256: file.sha256, solutionKernelIds: file.solutionKernelIds, kernel: cropKernel },
  ]
  for (const et of [startEt, (startEt + endEt) / 2, endEt]) {
    const resolver = createKernelResolver(loaded, et), state = resolver.relative(identity.naifId, 10), chain = resolver.sourceChain(identity.naifId)
    const finite = !!state && Object.values(state.position).every(Number.isFinite) && Object.values(state.velocity).every(Number.isFinite)
    if (!finite || !chain || chain.length < 2 || chain[0].kernelId !== file.id || chain[1].kernelId !== coreRecord.core.id || chain[1].target !== JUNO_RECONSTRUCTION.centerNaifId) {
      fail(`finite Sun-relative state and exact two-file source chain are missing at ET ${et}`)
    }
  }

  const integrationEvidence = { preparedSha256, originalSha256: pack.source.sha256, coreKernelId: coreRecord.core.id,
    coreKernelSha256: coreRecord.core.sha256, coverageGaps: 0,
    acceptance: 'source-integrated; numerical acceptance and derived-data regeneration remain separate' }
  const nextManifests = []
  for (const item of MANIFESTS) {
    const row = baselineRecords.get(item.profile)
    if (row.alreadyIntegrated) { nextManifests.push({ ...row, nextBytes: row.bytes }); continue }
    const entry = { ...file, solution: JUNO_RECONSTRUCTION.solution,
      sourceBoundary: { sourceId: identity.id, description: pack.source.boundary },
      integrationBatch: `juno-rec-${preparedSha256.slice(0, 16)}`, selectionEvidence: integrationEvidence }
    const manifest = { ...row.manifest, contract: addContract(row.manifest.contract), files: [...row.manifest.files, entry] }
    nextManifests.push({ ...row, nextBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) })
  }

  const locks = [], lockedPaths = [], temporaries = []
  try {
    for (const item of [...MANIFESTS].sort((a, b) => a.path.localeCompare(b.path))) {
      const lockPath = join(ROOT, `${item.path}.juno.lock`)
      locks.push(await open(lockPath, 'wx'))
      lockedPaths.push(lockPath)
    }
    for (const row of nextManifests) {
      if (row.alreadyIntegrated) continue
      if (sha256(await boundedRead(join(ROOT, row.item.path), MAX_MANIFEST_BYTES)) !== pack.baselineManifests[row.item.profile].sha256) fail(`${row.item.profile} manifest changed while acquiring integration lock`)
    }
    const outputRoot = join(ROOT, 'public/data/ephemerides')
    await mkdir(outputRoot, { recursive: true })
    const outputPath = join(outputRoot, file.path)
    try { await writeFile(outputPath, cropBytes, { flag: 'wx' }) }
    catch (error) {
      if (error.code !== 'EEXIST' || sha256(await boundedRead(outputPath, MAX_KERNEL_BYTES)) !== file.sha256) throw error
    }
    for (const row of nextManifests) {
      if (row.alreadyIntegrated) continue
      const temporary = join(ROOT, `${row.item.path}.${randomUUID()}.tmp`)
      temporaries.push(temporary)
      await writeFile(temporary, row.nextBytes, { flag: 'wx' })
    }
    for (const row of nextManifests) {
      if (row.alreadyIntegrated) continue
      await rename(temporaries.shift(), join(ROOT, row.item.path))
    }
  } finally {
    for (const temporary of temporaries) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    for (const lock of locks.reverse()) await lock.close()
    for (const lockPath of lockedPaths) await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  return { profiles: MANIFESTS.map(item => item.profile), id: file.id, bytes: file.bytes, sha256: file.sha256, integrationEvidence }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, preparedSha256, ...extra] = process.argv.slice(2)
  if (!directory || !preparedSha256 || extra.length) fail('usage: node --experimental-strip-types scripts/integrate-juno-reconstruction.mjs PACK_DIRECTORY PREPARED_MANIFEST_SHA256')
  console.log(JSON.stringify(await integrateJunoReconstruction({ directory, preparedSha256 })))
}
