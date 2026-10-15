// Offline source integration. This does not perform numerical acceptance or
// regenerate derived datasets. Run only in the later integration phase.
import { writeFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cropSpk, inspectSpk } from './crop-spk.mjs'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { analyzeKernelWindow } from './lib/kernel-window-coverage.mjs'
import { CASSINI_GRAND_FINALE, MESSENGER_FINAL_ORBIT, NEW_HORIZONS_OD164_SOURCE_SET, SPACECRAFT_PACK_IMPLEMENTATION } from './lib/spacecraft-source-sets.mjs'
import { SPACECRAFT_IDENTITIES } from '../src/data/spacecraftIdentities.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const md5 = bytes => createHash('md5').update(bytes).digest('hex')
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fail = message => { throw new Error(`Spacecraft integration: ${message}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const arrayBufferOf = bytes => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const SPACECRAFT_CONTRACT_CLAUSE = 'Added spacecraft use original Type 1 records with explicit center dependencies; tracking cutoffs and source windows do not establish numerical error bounds.'

function appendSpacecraftContractClause(value) {
  if (value !== undefined && typeof value !== 'string') fail('invalid manifest contract')
  let contract = value ?? ''
  const duplicate = `${SPACECRAFT_CONTRACT_CLAUSE} ${SPACECRAFT_CONTRACT_CLAUSE}`
  while (contract.includes(duplicate)) contract = contract.replace(duplicate, SPACECRAFT_CONTRACT_CLAUSE)
  if (!contract.includes(SPACECRAFT_CONTRACT_CLAUSE)) {
    contract = `${contract.trimEnd()}${contract.trim() ? ' ' : ''}${SPACECRAFT_CONTRACT_CLAUSE}`
  }
  return contract
}

async function boundedRead(path, limit) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > limit) fail('invalid input size')
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!result.bytesRead) fail('truncated input')
      offset += result.bytesRead
    }
    if ((await handle.stat()).size !== bytes.length) fail('input changed size')
    return bytes
  } finally { await handle.close() }
}

export async function integrateSpacecraftPack({ directory, preparedSha256, baselineSha256, profile }) {
  if (!['pages', 'full'].includes(profile) || !hash(preparedSha256) || !hash(baselineSha256)) fail('explicit profile and input SHA-256 identities required')
  const manifestPath = join(ROOT, 'src/data', `ephemeris-manifest${profile === 'full' ? '-full' : ''}.json`)
  const packRoot = resolve(directory)
  const receiptBytes = await boundedRead(join(packRoot, 'prepared-manifest.json'), 4 * 1024 * 1024)
  if (sha(receiptBytes) !== preparedSha256) fail('prepared receipt identity mismatch')
  const pack = JSON.parse(receiptBytes)
  if (pack.schemaVersion !== 1 || pack.purpose !== 'prepared-spacecraft-source-pack' || pack.status !== 'pending-source-and-numerical-acceptance') fail('unsupported prepared receipt')
  if (!Array.isArray(pack.implementation) || !same(pack.implementation.map(row => row?.path), SPACECRAFT_PACK_IMPLEMENTATION)) fail('prepared implementation inventory mismatch')
  for (const item of pack.implementation) {
    if (!item || !hash(item.sha256) || typeof item.path !== 'string') fail('invalid implementation source identity')
    const implementationPath = resolve(ROOT, item.path)
    const relativePath = relative(ROOT, implementationPath)
    if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith('..')) fail('implementation path escapes the repository')
    if (sha(await boundedRead(implementationPath, 16 * 1024 * 1024)) !== item.sha256) fail(`implementation source mismatch: ${item.path}`)
  }
  const { startEt, endEt } = pack.requestedWindow ?? {}
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || startEt >= endEt || pack.requestedWindow.timeScale !== 'TDB seconds past J2000') fail('invalid requested window')
  if (!Array.isArray(pack.sources) || pack.sources.length < 1 || pack.sources.length > 3 || !Array.isArray(pack.files) || pack.files.length !== pack.sources.length * 2) fail('invalid source/file count')
  let totalBytes = 0
  for (const file of pack.files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 128 * 1024 * 1024) fail('invalid kernel byte budget')
    totalBytes += file.bytes
  }
  if (totalBytes > 256 * 1024 * 1024) fail('pack exceeds retained byte budget; prepare a narrower window')
  if (!Array.isArray(pack.notes) || pack.notes.length !== pack.sources.length) fail('missing source notes')
  for (const note of pack.notes) {
    if (typeof note.path !== 'string' || !/^originals\/[a-z0-9-]+-source-notes\.txt$/.test(note.path) || !hash(note.sha256)) fail('invalid source note identity')
    const bytes = await boundedRead(join(packRoot, note.path), 1024 * 1024)
    if (bytes.length !== note.bytes || sha(bytes) !== note.sha256) fail('source note mismatch')
  }
  const baselineBytes = await boundedRead(manifestPath, 16 * 1024 * 1024)
  if (sha(baselineBytes) !== baselineSha256) fail('baseline manifest identity mismatch')
  const baseline = JSON.parse(baselineBytes)
  if (baseline.schemaVersion !== 1 || baseline.profile !== profile || !Array.isArray(baseline.files)) fail('unsupported baseline manifest')
  const ids = new Set(baseline.files.map(file => file.id)), paths = new Set(baseline.files.map(file => file.path))
  const pending = [], descriptors = [], sourceTargets = new Set()
  for (const source of pack.sources) {
    const identity = SPACECRAFT_IDENTITIES.find(body => body.id === source.id && body.naifId === source.target && body.name === source.name)
    if (!identity || sourceTargets.has(source.target) || !hash(source.sha256)) fail('invalid or repeated source identity')
    sourceTargets.add(source.target)
    if (source.id === NEW_HORIZONS_OD164_SOURCE_SET.spacecraftId) {
      if (source.sourceSet?.id !== NEW_HORIZONS_OD164_SOURCE_SET.id || !same(source.sourceSet.memberTargets, NEW_HORIZONS_OD164_SOURCE_SET.memberTargets)) fail('New Horizons OD164 coupled source-set membership mismatch')
    } else if (source.sourceSet !== undefined) fail('unreviewed spacecraft source set')
    if (typeof source.originalPath !== 'string' || !/^originals\/[A-Za-z0-9_.-]+\.bsp$/.test(source.originalPath)) fail('unsafe original path')
    const original = await boundedRead(join(packRoot, source.originalPath), source.id === MESSENGER_FINAL_ORBIT.spacecraftId
      ? MESSENGER_FINAL_ORBIT.maxSourceBytes : 64 * 1024 * 1024)
    if (original.length !== source.bytes || sha(original) !== source.sha256) fail('original source mismatch')
    if (source.id === CASSINI_GRAND_FINALE.spacecraftId) {
      if (source.target !== CASSINI_GRAND_FINALE.target || source.source !== CASSINI_GRAND_FINALE.sourceUrl ||
          source.originalPath !== `originals/${CASSINI_GRAND_FINALE.file}` ||
          source.reviewedNotes?.source !== CASSINI_GRAND_FINALE.notesUrl ||
          !same(source.originTargets, [CASSINI_GRAND_FINALE.originTarget])) fail('Cassini source does not match the reviewed Grand Finale NAV contract')
      const originalKernel = new SpkKernel(arrayBufferOf(original))
      if (originalKernel.segments.some(segment => segment.target === CASSINI_GRAND_FINALE.target &&
          (segment.center !== CASSINI_GRAND_FINALE.center || segment.frame !== 1 || segment.type !== 1))) fail('Cassini root descriptors differ from the reviewed Type 1 center/frame')
      for (const target of CASSINI_GRAND_FINALE.dependencyTargets) if (!originalKernel.segments.some(segment => segment.target === target && segment.center === 0 && segment.frame === 1 && segment.type === 2 && segment.startEt <= startEt && segment.endEt >= endEt)) {
        fail(`Cassini original omits barycentric Type 2 dependency ${target}`)
      }
    } else if (source.id === MESSENGER_FINAL_ORBIT.spacecraftId) {
      if (source.target !== MESSENGER_FINAL_ORBIT.target || source.source !== MESSENGER_FINAL_ORBIT.sourceUrl ||
          source.originalPath !== `originals/${MESSENGER_FINAL_ORBIT.file}` || source.bytes !== MESSENGER_FINAL_ORBIT.sourceBytes ||
          md5(original) !== MESSENGER_FINAL_ORBIT.sourceMd5 || !same(source.originTargets, [MESSENGER_FINAL_ORBIT.originTarget]) ||
          source.reviewedNotes?.source !== MESSENGER_FINAL_ORBIT.notesUrl) fail('MESSENGER source does not match the reviewed final reconstruction product')
      const originalSource = { size: original.length, identity: { source: source.source, bytes: original.length }, async read(start, length) {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 1 || start + length > original.length) fail('MESSENGER crop read outside original bytes')
        return Buffer.from(original.subarray(start, start + length))
      } }
      const originalDescriptors = await inspectSpk(originalSource)
      if (originalDescriptors.segments.some(segment => segment.frame !== 1 || (segment.target === MESSENGER_FINAL_ORBIT.target
        ? segment.type !== 1 || !MESSENGER_FINAL_ORBIT.rootCenters.includes(segment.center)
        : segment.target <= 0 || segment.type !== 2))) fail('MESSENGER original descriptors differ from the reviewed J2000 Type 1/2 family')
      for (const target of MESSENGER_FINAL_ORBIT.dependencyTargets) if (!originalDescriptors.segments.some(segment => segment.target === target &&
        segment.center === 0 && segment.frame === 1 && segment.type === 2 &&
        segment.startEt <= startEt && segment.endEt >= endEt)) fail(`MESSENGER original omits barycentric Type 2 dependency ${target}`)
      if (!originalDescriptors.segments.some(segment => segment.target === MESSENGER_FINAL_ORBIT.target && segment.center === MESSENGER_FINAL_ORBIT.center &&
        segment.frame === 1 && segment.type === 1 && segment.startEt <= startEt && segment.endEt >= endEt)) fail('MESSENGER requested interval is outside the reviewed final Mercury-barycenter segment')
      const sourceFiles = pack.files.filter(file => file.sourceIdentity?.sha256 === source.sha256)
      for (const dependencyOnly of [true, false]) {
        const matches = sourceFiles.filter(file => file.dependencyOnly === dependencyOnly)
        if (matches.length !== 1) fail('MESSENGER requires one root and one dependency crop')
        const targets = dependencyOnly ? MESSENGER_FINAL_ORBIT.dependencyTargets : [MESSENGER_FINAL_ORBIT.target]
        const regenerated = await cropSpk(originalSource, { startEt, endEt, targets })
        if (regenerated.buffer.length !== matches[0].bytes || sha(regenerated.buffer) !== matches[0].sha256) {
          fail('MESSENGER prepared crop is not the exact reviewed-window subset of its checksummed original')
        }
      }
    } else if (source.originTargets !== undefined) fail('unreviewed spacecraft origin target set')
    if (source.sourceSet) {
      const originalKernel = new SpkKernel(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength))
      const members = new Set(source.sourceSet.memberTargets)
      const originalTargets = [...new Set(originalKernel.segments.filter(segment => segment.target !== source.target).map(segment => segment.target))].sort((a, b) => a - b)
      if (!same(originalTargets, source.sourceSet.memberTargets) || originalKernel.segments.some(segment =>
        segment.frame !== 1 || (segment.target === source.target
          ? segment.type !== 1 || segment.center !== 10
          : !members.has(segment.target) || segment.type !== 2 || segment.center !== 0 && !members.has(segment.center)))) {
        fail('New Horizons original descriptors differ from the reviewed coupled source set')
      }
    }
    if (!pack.notes.some(note => note.sha256 === source.notesSha256 && note.source === source.reviewedNotes?.source && note.path === `originals/${source.id}-source-notes.txt`)) fail('source note binding mismatch')
    if (source.label) {
      const bytes = await boundedRead(join(packRoot, 'originals', `${source.id}-source-label.txt`), 1024 * 1024)
      if (!hash(source.label.sha256) || bytes.length !== source.label.bytes || sha(bytes) !== source.label.sha256) fail('source label mismatch')
    }
  }
  for (const file of pack.files) {
    if (typeof file.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(file.id) || file.path !== `${file.id}.bsp` || ids.has(file.id) || paths.has(file.path) || !hash(file.sha256)) fail('invalid or colliding kernel identity')
    ids.add(file.id); paths.add(file.path)
    if (file.core !== false || typeof file.dependencyOnly !== 'boolean') fail('invalid kernel role')
    const source = pack.sources.find(row => row.sha256 === file.sourceIdentity?.sha256 && row.source === file.source)
    if (!source) fail('kernel source binding mismatch')
    const expectedSourceIdentity = { source: source.source, bytes: source.bytes, sha256: source.sha256,
      startedAt: source.startedAt, completedAt: source.completedAt, etag: source.etag,
      lastModified: source.lastModified, notesSha256: source.notesSha256,
      ...(source.label ? { label: source.label } : {}) }
    if (!same(file.sourceIdentity, expectedSourceIdentity)) fail('kernel source identity fields differ from the full source receipt')
    const bytes = await boundedRead(join(packRoot, file.path), 128 * 1024 * 1024)
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) fail('prepared kernel mismatch')
    const kernel = new SpkKernel(arrayBufferOf(bytes))
    const targets = [...new Set(kernel.segments.map(segment => segment.target))]
    if (!same(targets, file.targets) || !kernel.segments.length || Math.min(...kernel.segments.map(s => s.startEt)) !== file.startEt || Math.max(...kernel.segments.map(s => s.endEt)) !== file.endEt) fail('kernel descriptors differ from receipt')
    if (kernel.segments.some(s => s.frame !== 1 || s.startEt < startEt || s.endEt > endEt || (file.dependencyOnly ? s.target <= 0 || s.type !== 2 : s.target !== source.target || s.type !== 1))) fail('unexpected cropped segment')
    if (file.dependencyOnly && source.id === CASSINI_GRAND_FINALE.spacecraftId &&
        (!same(targets.slice().sort((a, b) => a - b), CASSINI_GRAND_FINALE.dependencyTargets) ||
         kernel.segments.some(segment => !CASSINI_GRAND_FINALE.dependencyTargets.includes(segment.target) || segment.center !== 0))) fail('Cassini origin pool differs from the reviewed Saturn-system/Sun barycentric dependencies')
    if (file.dependencyOnly && source.id === MESSENGER_FINAL_ORBIT.spacecraftId &&
        (!same(targets.slice().sort((a, b) => a - b), MESSENGER_FINAL_ORBIT.dependencyTargets) ||
         kernel.segments.some(segment => !MESSENGER_FINAL_ORBIT.dependencyTargets.includes(segment.target) || segment.center !== 0 || segment.type !== 2))) fail('MESSENGER center/origin pool differs from the reviewed Mercury-barycenter/Sun dependencies')
    if (file.dependencyOnly && source.sourceSet && !same([...new Set(kernel.segments.map(segment => segment.target))].sort((a, b) => a - b), source.sourceSet.memberTargets)) fail('New Horizons coupled dependency file is incomplete')
    if (file.dependencyOnly ? file.solutionKernelIds !== undefined : !Array.isArray(file.solutionKernelIds) || file.solutionKernelIds.length !== 1) fail('invalid explicit dependency pool')
    descriptors.push({ ...file, segments: kernel.segments })
    pending.push({ file, bytes, source })
  }
  for (const source of pack.sources) {
    const roots = pending.filter(row => !row.file.dependencyOnly && row.source === source)
    if (roots.length !== 1) fail('one root per spacecraft is required')
    const dependency = pending.find(row => row.file.id === roots[0].file.solutionKernelIds[0])
    if (!dependency?.file.dependencyOnly || dependency.source !== source) fail('cross-source dependency binding')
    const coverage = analyzeKernelWindow({ kernels: descriptors, target: source.target, startEt, endEt })
    if (coverage.gaps.length) fail('source dependency coverage gap')
    if (source.sourceSet) {
      const dependencyKernel = descriptors.find(row => row.id === dependency.file.id)
      const boundSourcePool = { ...dependencyKernel, dependencyOnly: false, solutionKernelIds: [] }
      for (const target of source.sourceSet.memberTargets) {
        const memberCoverage = analyzeKernelWindow({ kernels: [boundSourcePool], target, startEt, endEt })
        if (memberCoverage.gaps.length) fail(`New Horizons source-set member ${target} has a descriptor or center dependency gap`)
      }
    }
  }
  const integration = { preparedSha256, baselineSha256, requestedWindow: pack.requestedWindow,
    sources: pack.sources, notes: pack.notes, implementation: pack.implementation,
    integrator: { path: 'scripts/integrate-spacecraft-pack.mjs', sha256: sha(await boundedRead(fileURLToPath(import.meta.url), 8 * 1024 * 1024)) },
    acceptance: 'source-integrated; numerical acceptance and derived-data regeneration remain separate' }
  const next = { ...baseline, contract: appendSpacecraftContractClause(baseline.contract), files: [...baseline.files, ...pending.map(({ file, source }) => ({ ...file,
    ...((source.boundary || source.reviewedNotes?.trackingDataCutoff || source.reviewedNotes?.trackingFitThroughMonth) ? { sourceBoundary: {
      sourceId: source.id,
      ...(source.sourceSet?.id ? { sourceSetId: source.sourceSet.id } : {}),
      ...(source.reviewedNotes?.trackingDataCutoff ? { trackingDataCutoff: source.reviewedNotes.trackingDataCutoff } : {}),
      ...(source.reviewedNotes?.trackingFitThroughMonth ? { trackingFitThroughMonth: source.reviewedNotes.trackingFitThroughMonth } : {}),
      ...(source.boundary ? { description: source.boundary } : {}),
    } } : {}),
    integrationBatch: `spacecraft-${preparedSha256.slice(0, 16)}`, selectionEvidence: integration }))] }
  const output = join(ROOT, 'public/data/ephemerides')
  await mkdir(output, { recursive: true })
  // This lock coordinates this integrator. The hash recheck also catches earlier
  // edits by other tools; external writers must not run concurrently with rename.
  const lockPath = `${manifestPath}.spacecraft.lock`
  const lock = await open(lockPath, 'wx')
  const temporary = `${manifestPath}.${randomUUID()}.tmp`
  try {
    if (sha(await boundedRead(manifestPath, 16 * 1024 * 1024)) !== baselineSha256) fail('baseline changed before integration')
    for (const { file, bytes } of pending) {
      try { await writeFile(join(output, file.path), bytes, { flag: 'wx' }) }
      catch (error) {
        if (error.code !== 'EEXIST' || sha(await boundedRead(join(output, file.path), 128 * 1024 * 1024)) !== file.sha256) throw error
      }
    }
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' })
    if (sha(await boundedRead(manifestPath, 16 * 1024 * 1024)) !== baselineSha256) fail('baseline changed during integration')
    await rename(temporary, manifestPath)
  } finally {
    try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    finally { try { await lock.close() } finally { await unlink(lockPath) } }
  }
  return { profile, addedFiles: pending.length, manifestPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profile, directory, preparedSha256, baselineSha256, ...extra] = process.argv.slice(2)
  if (!directory || extra.length) fail('usage: integrate-spacecraft-pack.mjs pages|full PACK_DIRECTORY PREPARED_SHA256 BASELINE_SHA256')
  console.log(JSON.stringify(await integrateSpacecraftPack({ directory, preparedSha256, baselineSha256, profile })))
}
