// Explicit preparation only. Writes a new cache directory; never edits a release
// manifest. Numerical reference acceptance is a separate, later operation.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cropSpk, inspectSpk } from './crop-spk.mjs'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { analyzeKernelWindow } from './lib/kernel-window-coverage.mjs'
import { CASSINI_GRAND_FINALE, MESSENGER_FINAL_ORBIT, NEW_HORIZONS_OD164_SOURCE_SET, SPACECRAFT_PACK_IMPLEMENTATION, validateSpacecraftOriginArc } from './lib/spacecraft-source-sets.mjs'
import { SPACECRAFT_IDENTITIES } from '../src/data/spacecraftIdentities.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOT = 'https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/'
const NOTES_URL = `${SOURCE_ROOT}aareadme.txt`
const NH_ROOT = "https://naif.jpl.nasa.gov/pub/naif/pds/data/nh-j_p_ss-spice-6-v1.0/nhsp_1000/"
const SOURCES = {
  voyager1: { file: 'vgr1.x2100.bsp', target: -31, fitThrough: '1992-04', centers: [10], solution: 'x2100-with-embedded-de440' },
  voyager2: { file: 'vgr2.x2100.bsp', target: -32, fitThrough: '1992-10', centers: [10, 8], solution: 'x2100-with-embedded-de440' },
  newhorizons: { file: "nh_pred_alleph_od164.bsp", target: -98, centers: [10],
    root: NH_ROOT, spkDirectory: "data/spk/", notesUrl: NH_ROOT + "extras/mk/nh_v10.tm",
    solution: "od164-with-embedded-de433", startEt: 686318469.1823477, endEt: 1041465600,
    trackingDataCutoff: "2025-04-18 08:06:50 ET", labelUrl: NH_ROOT + "data/spk/nh_pred_alleph_od164.lbl",
    sourceSet: NEW_HORIZONS_OD164_SOURCE_SET },
  cassini: { file: CASSINI_GRAND_FINALE.file, target: CASSINI_GRAND_FINALE.target,
    centers: [CASSINI_GRAND_FINALE.center], root: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/',
    spkDirectory: 'data/spk/', notesUrl: CASSINI_GRAND_FINALE.notesUrl,
    originTargets: [CASSINI_GRAND_FINALE.originTarget], solution: '171214r-grand-finale-nav-reconstruction',
    coverageStartEt: CASSINI_GRAND_FINALE.coverageStartEt, coverageEndEt: CASSINI_GRAND_FINALE.coverageEndEt,
    boundary: 'Cassini operations-era NAV reconstruction for the 2017 Grand Finale; source coverage is not an accuracy or uncertainty bound.' },
  messenger: { file: MESSENGER_FINAL_ORBIT.file, target: MESSENGER_FINAL_ORBIT.target,
    centers: [...MESSENGER_FINAL_ORBIT.rootCenters], originTargets: [MESSENGER_FINAL_ORBIT.originTarget],
    root: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/',
    spkDirectory: 'data/spk/', notesUrl: MESSENGER_FINAL_ORBIT.notesUrl, labelUrl: MESSENGER_FINAL_ORBIT.labelUrl,
    maxSourceBytes: MESSENGER_FINAL_ORBIT.maxSourceBytes, expectedSourceBytes: MESSENGER_FINAL_ORBIT.sourceBytes,
    expectedSourceMd5: MESSENGER_FINAL_ORBIT.sourceMd5, sourceTimeoutMs: 15 * 60 * 1000,
    solution: 'od431-final-reconstruction-last-arc',
    coverageStartEt: MESSENGER_FINAL_ORBIT.coverageStartEt, coverageEndEt: MESSENGER_FINAL_ORBIT.coverageEndEt,
    consultedOn: MESSENGER_FINAL_ORBIT.consultedOn, boundary: MESSENGER_FINAL_ORBIT.boundary },
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const arrayBufferOf = bytes => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const parsed = bytes => new SpkKernel(arrayBufferOf(bytes))

async function acquire(url, limit, timeoutMs = 120_000) {
  const startedAt = new Date().toISOString()
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Source HTTP ${response.status}`) }
  const header = response.headers.get('content-length')
  const declared = header === null ? null : Number(header)
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > limit)) {
    await response.body?.cancel(); throw new Error('Source length exceeds admission budget')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Source body unavailable')
  // One bounded allocation; do not retain a second list of transport chunks.
  const buffer = Buffer.alloc(declared ?? limit)
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (size + chunk.value.length > buffer.length) throw new Error('Oversized source body')
      buffer.set(chunk.value, size); size += chunk.value.length
    }
    if (!size || declared !== null && size !== declared) throw new Error('Truncated source body')
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const bytes = buffer.subarray(0, size)
  return { bytes, evidence: { source: url, bytes: size, sha256: sha(bytes), startedAt,
    completedAt: new Date().toISOString(), etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified') } }
}

export async function prepareSpacecraftPack({ name, startEt, endEt, spacecraft = 'both' }) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('A new lowercase cache directory name is required')
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || startEt >= endEt) throw new Error('Explicit finite increasing TDB ET bounds required')
  if (!["both", "all", ...Object.keys(SOURCES)].includes(spacecraft)) throw new Error("Expected voyager1, voyager2, newhorizons, cassini, messenger, both (Voyagers), or all")
  const selected = Object.entries(SOURCES).filter(([id]) => spacecraft === "all" || spacecraft === "both" && id.startsWith("voyager") || spacecraft === id)
  for (const [id, config] of selected) {
    // At the shared endpoint the later, older OD157A segment wins SPK
    // precedence. This pack deliberately admits only the OD164 portion.
    if (config.startEt !== undefined && (startEt <= config.startEt || endEt > config.endEt)) throw new Error(id + ": requested window must start strictly after the reviewed solution transition and remain within its end")
    if (config.coverageStartEt !== undefined && (startEt < config.coverageStartEt || endEt > config.coverageEndEt)) throw new Error(id + ': requested window exceeds the reviewed source descriptor coverage')
  }
  const parent = join(ROOT, '.cache', 'spacecraft-packs'), output = join(parent, name)
  await mkdir(parent, { recursive: true })
  await mkdir(output) // Exclusive: partial or completed evidence is never overwritten.
  await mkdir(join(output, 'originals'))
  const files = [], sources = [], windows = [], notesRecords = []
  for (const [id, config] of selected) {
    const notes = await acquire(config.notesUrl ?? NOTES_URL, 1024 * 1024)
    const notesPath = "originals/" + id + "-source-notes.txt"
    await writeFile(join(output, notesPath), notes.bytes, { flag: "wx" })
    notesRecords.push({ ...notes.evidence, path: notesPath })
    let label
    if (config.labelUrl) {
      label = await acquire(config.labelUrl, 1024 * 1024)
      await writeFile(join(output, "originals", id + "-source-label.txt"), label.bytes, { flag: "wx" })
    }
    const identity = SPACECRAFT_IDENTITIES.find(body => body.id === id && body.naifId === config.target)
    if (!identity) throw new Error('Reviewed spacecraft identity mismatch')
    const sourceSetTargets = config.sourceSet?.memberTargets ?? []
    if (config.sourceSet && (config.sourceSet.spacecraftId !== id || config.sourceSet.spacecraftTarget !== config.target ||
        new Set(sourceSetTargets).size !== sourceSetTargets.length || sourceSetTargets.some(target => !Number.isSafeInteger(target) || target <= 0))) {
      throw new Error('Invalid reviewed spacecraft companion set')
    }
    const original = await acquire(`${config.root ?? SOURCE_ROOT}${config.spkDirectory ?? 'spk/'}${config.file}`, config.maxSourceBytes ?? 64 * 1024 * 1024, config.sourceTimeoutMs)
    if (config.expectedSourceBytes !== undefined && original.bytes.length !== config.expectedSourceBytes) throw new Error('Source byte length differs from the reviewed PDS product')
    if (config.expectedSourceMd5 !== undefined && createHash('md5').update(original.bytes).digest('hex') !== config.expectedSourceMd5) throw new Error('Source MD5 differs from the reviewed PDS archive checksum')
    await writeFile(join(output, 'originals', config.file), original.bytes, { flag: 'wx' })
    const source = { size: original.bytes.length, identity: original.evidence, async read(start, length) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 1 || start + length > original.bytes.length) throw new Error('Source read outside original bytes')
      return Buffer.from(original.bytes.subarray(start, start + length))
    } }
    // The MESSENGER archive contains malformed Type 1 epoch pairs in three
    // historical segments. Inspect its DAF descriptors archive-wide, then
    // strictly crop only the reviewed final window before parsing records.
    const sourceDescriptors = await inspectSpk(source)
    const sourceKernel = id === MESSENGER_FINAL_ORBIT.spacecraftId
      ? parsed((await cropSpk(source, { startEt, endEt, targets: [config.target, ...MESSENGER_FINAL_ORBIT.dependencyTargets] })).buffer)
      : parsed(original.bytes)
    const reviewedSegments = id === MESSENGER_FINAL_ORBIT.spacecraftId ? sourceDescriptors.segments : sourceKernel.segments
    const reviewedAuxiliaryTypes = id === CASSINI_GRAND_FINALE.spacecraftId ? [2, 3] : [2]
    if (!reviewedSegments.some(segment => segment.target === config.target) || reviewedSegments.some(segment =>
      segment.frame !== 1 || (segment.target === config.target
        ? segment.type !== 1 || !config.centers.includes(segment.center)
        : segment.target <= 0 || !reviewedAuxiliaryTypes.includes(segment.type)))) throw new Error('Source descriptors differ from the reviewed spacecraft family')
    if (config.sourceSet) {
      const observedTargets = [...new Set(sourceKernel.segments.filter(segment => segment.target !== config.target).map(segment => segment.target))].sort((a, b) => a - b)
      const expectedTargets = [...sourceSetTargets].sort((a, b) => a - b)
      if (JSON.stringify(observedTargets) !== JSON.stringify(expectedTargets)) throw new Error('New Horizons coupled source-set target membership changed')
      for (const target of sourceSetTargets) if (!sourceKernel.segments.some(segment => segment.target === target && segment.startEt <= endEt && segment.endEt >= startEt)) {
        throw new Error(`Missing New Horizons source-set member ${target} in requested window`)
      }
    }
    if (config.originTargets) {
      const originContract = id === CASSINI_GRAND_FINALE.spacecraftId ? CASSINI_GRAND_FINALE
        : id === MESSENGER_FINAL_ORBIT.spacecraftId ? MESSENGER_FINAL_ORBIT : undefined
      if (!originContract || config.file !== originContract.file || original.evidence.source !== originContract.sourceUrl ||
          JSON.stringify(config.originTargets) !== JSON.stringify([originContract.originTarget])) throw new Error('Unreviewed spacecraft origin target set')
      for (const target of config.originTargets) if (!sourceKernel.segments.some(segment => segment.target === target && segment.center === 0 && segment.frame === 1 && segment.type === 2 && segment.startEt <= startEt && segment.endEt >= endEt)) {
        throw new Error(`${id} source omits the reviewed barycentric origin target ${target}`)
      }
      validateSpacecraftOriginArc(sourceKernel.segments, originContract, startEt, endEt)
    }
    // Preserve all overlapping alternatives for each reachable center, while
    // keeping an explicitly reviewed mission source set inside its bound pool.
    const centerSet = new Set(), pending = [config.target, ...sourceSetTargets]
    for (let index = 0; index < pending.length; index++) {
      for (const segment of sourceKernel.segments) {
        if (segment.target !== pending[index] || segment.endEt < startEt || segment.startEt > endEt || segment.center === 0) continue
        if (segment.center === config.target) throw new Error('Source dependency returns to spacecraft root')
        if (!centerSet.has(segment.center)) { centerSet.add(segment.center); pending.push(segment.center) }
      }
    }
    const centerTargets = [...centerSet]
    for (const target of config.originTargets ?? []) if (!centerSet.has(target)) centerTargets.push(target)
    if (!centerTargets.includes(10)) throw new Error('Embedded Sun dependency is absent')
    if (config.sourceSet && centerTargets.some(target => !sourceSetTargets.includes(target))) throw new Error('New Horizons source set omits a transitive center target')
    const dependencyTargets = [...new Set([...centerTargets, ...sourceSetTargets])].sort((a, b) => a - b)
    const sourceIdentity = { ...original.evidence, notesSha256: notes.evidence.sha256, ...(label ? { label: label.evidence } : {}) }
    // All crop reads come from one owned, fully hashed response; no remote
    // refresh or local-file mutation can mix versions between the two crops.
    const pool = [], prepared = []
    const windowId = sha(JSON.stringify([startEt, endEt])).slice(0, 12)
    const prefix = `${id}-${original.evidence.sha256.slice(0, 16)}-${windowId}`
    const dependencyId = `${prefix}-dependencies`
    for (const dependencyOnly of [true, false]) {
      const result = await cropSpk(source, { startEt, endEt, targets: dependencyOnly ? dependencyTargets : [config.target] })
      if (result.buffer.length > 128 * 1024 * 1024) throw new Error('Crop exceeds runtime file budget')
      const kernel = parsed(result.buffer)
      const kernelId = dependencyOnly ? dependencyId : `${prefix}-trajectory`
      const solutionKernelIds = dependencyOnly ? undefined : [dependencyId]
      const path = `${kernelId}.bsp`
      const file = { id: kernelId, path, bytes: result.buffer.length, sha256: result.sha256,
        targets: [...new Set(kernel.segments.map(segment => segment.target))],
        startEt: Math.min(...kernel.segments.map(segment => segment.startEt)),
        endEt: Math.max(...kernel.segments.map(segment => segment.endEt)),
        source: original.evidence.source, sourceIdentity, core: false, dependencyOnly,
        ...(solutionKernelIds ? { solutionKernelIds } : {}), solution: `${id}-${config.solution}` }
      await writeFile(join(output, path), result.buffer, { flag: 'wx' })
      prepared.push(file)
      pool.push({ id: kernelId, dependencyOnly, solutionKernelIds, segments: kernel.segments })
    }
    const window = analyzeKernelWindow({ kernels: pool, target: config.target, startEt, endEt })
    if (window.gaps.length) throw new Error(`${id}: requested window has a source or center dependency gap`)
    const sourceSetWindows = []
    if (config.sourceSet) {
      const dependency = prepared.find(file => file.dependencyOnly)
      const sourcePoolRoot = { ...pool.find(kernel => kernel.id === dependency.id), dependencyOnly: false, solutionKernelIds: [] }
      for (const target of sourceSetTargets) {
        const memberWindow = analyzeKernelWindow({ kernels: [sourcePoolRoot], target, startEt, endEt })
        if (memberWindow.gaps.length) throw new Error(`${id}: source-set member ${target} has a descriptor or center dependency gap`)
        sourceSetWindows.push(memberWindow)
      }
    }
    const originWindows = []
    if (config.originTargets) {
      const dependency = prepared.find(file => file.dependencyOnly)
      const sourcePoolRoot = { ...pool.find(kernel => kernel.id === dependency.id), dependencyOnly: false, solutionKernelIds: [] }
      for (const target of config.originTargets) {
        const originWindow = analyzeKernelWindow({ kernels: [sourcePoolRoot], target, startEt, endEt })
        if (originWindow.gaps.length) throw new Error(`${id}: origin target ${target} has a descriptor or center dependency gap`)
        originWindows.push(originWindow)
      }
    }
    files.push(...prepared); windows.push(window, ...sourceSetWindows, ...originWindows)
    sources.push({ id, target: config.target, name: identity.name, originalPath: `originals/${config.file}`,
      ...sourceIdentity, reviewedNotes: { source: config.notesUrl ?? NOTES_URL, consultedOn: config.consultedOn ?? '2026-09-23', ...(config.fitThrough ? { trackingFitThroughMonth: config.fitThrough } : {}), ...(config.trackingDataCutoff ? { trackingDataCutoff: config.trackingDataCutoff, reviewedDescriptorWindow: { startEt: config.startEt, endEt: config.endEt, openness: '(start,end]' } } : {}) },
      ...(config.sourceSet ? { sourceSet: { id: config.sourceSet.id, memberTargets: [...sourceSetTargets] } } : {}),
      ...(config.originTargets ? { originTargets: [...config.originTargets] } : {}),
      boundary: config.boundary ?? 'Published trajectory extension; coverage is not an observational accuracy or uncertainty bound.' })
  }
  const implementation = []
  for (const path of SPACECRAFT_PACK_IMPLEMENTATION) {
    implementation.push({ path, sha256: sha(await readFile(join(ROOT, path))) })
  }
  const manifest = { schemaVersion: 1, purpose: 'prepared-spacecraft-source-pack', status: 'pending-source-and-numerical-acceptance',
    requestedWindow: { startEt, endEt, timeScale: 'TDB seconds past J2000' }, notes: notesRecords,
    sources, files, windows, implementation,
    limitations: ['No state vector or reference residual is evaluated during preparation.',
      'Downloaded originals and notes require review against the previously reviewed source family; metadata shape is not scientific approval.',
      'Crops preserve original records; center dependencies are explicit and never global root overrides.',
      'No release manifest, runtime index, inventory or deployment is changed.'] }
  // The completion marker is last. A failed preparation leaves inspectable
  // partial originals/crops but no successful manifest; use a new name on retry.
  await writeFile(join(output, 'prepared-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return { output, manifest }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, from, to, spacecraft = 'both', ...extra] = process.argv.slice(2)
  if (!name || from === undefined || to === undefined || !from.trim() || !to.trim() || extra.length) {
    throw new Error('Usage: node --experimental-strip-types scripts/prepare-spacecraft-pack.mjs NEW_CACHE_NAME START_ET END_ET [voyager1|voyager2|newhorizons|both|all]')
  }
  const result = await prepareSpacecraftPack({ name, startEt: Number(from), endEt: Number(to), spacecraft })
  console.log(JSON.stringify({ output: result.output, status: result.manifest.status, files: result.manifest.files.length }))
}
