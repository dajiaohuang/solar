// Explicit offline integration of verified source crops. The input plan names
// local evidence paths; none of those machine-specific paths enter the release.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'
import { createKernelResolver, kernelsCoveringInterval } from '../src/engine/ephemeris/kernelPool.ts'
import { cropSpk } from './crop-spk.mjs'
import { replaySpkSurvey } from './lib/spk-source-survey.mjs'

const planPath = process.argv[2]
if (!planPath) throw new Error('Usage: node scripts/integrate-satellite-pack.mjs VERIFIED_PLAN.json')
const plan = JSON.parse(await readFile(planPath, 'utf8'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const parsed = bytes => new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const out = 'public/data/ephemerides'
const batch = 'satellite-expansion-20260904'
const baseline = JSON.parse(await readFile('src/data/ephemeris-manifest.json', 'utf8'))
const baseFiles = baseline.files.filter(file => file.integrationBatch !== batch)
const baseCore = baseFiles.find(file => file.id.startsWith('de440s-'))
if (!baseCore) throw new Error('Existing DE440 core is required')
const surveyBytes = await readFile(join(plan.survey, 'survey.json'))
if (digest(surveyBytes) !== plan.surveySha256) throw new Error('Survey identity mismatch')
const replay = spawnSync(process.execPath, [fileURLToPath(new URL('./survey-satellite-ephemerides.mjs', import.meta.url)), '--verify', resolve(plan.survey)], { stdio: 'inherit' })
if (replay.status !== 0) throw new Error('Source survey replay failed')
const identities = JSON.parse(await readFile('src/data/satelliteCatalog.json', 'utf8'))
const knownTargets = new Set(identities.bodies.map(body => body.naifId).filter(Number.isSafeInteger))
const cores = { de440: baseCore.id }
const common = [], additions = []
const supplemental = new Map()
async function sourceEvidence(config, sourceUrl, targets) {
  if (!config.sourceEvidence) return undefined
  const evidence = config.sourceEvidence
  let record = supplemental.get(evidence.sha256)
  if (!record) {
    if (!/^[\w.-]+$/.test(evidence.id)) throw new Error('Invalid supplemental source identity')
    const bytes = await readFile(join(evidence.directory, `${evidence.id}.json`))
    if (digest(bytes) !== evidence.sha256) throw new Error('Supplemental source hash mismatch')
    record = JSON.parse(bytes)
    await replaySpkSurvey(evidence.directory, evidence.id, record)
    supplemental.set(evidence.sha256, record)
  }
  if (record.source.source !== sourceUrl || targets.some(target => !record.targets.includes(target))) throw new Error('Supplemental source/target mismatch')
  return { url: sourceUrl, sha256: evidence.sha256 }
}
await mkdir(out, { recursive: true })

async function publish(bytes, metadata) {
  const sha256 = digest(bytes), path = `${metadata.id}.bsp`
  if (!/^[\w.-]+\.bsp$/.test(path) || bytes.length > 128 * 1024 * 1024) throw new Error('Unsafe kernel output')
  const kernel = parsed(bytes)
  const startEt = Math.min(...kernel.segments.map(segment => segment.startEt))
  const endEt = Math.max(...kernel.segments.map(segment => segment.endEt))
  if (!kernelsCoveringInterval([{ id: path, kernel }], startEt, endEt).length) throw new Error('Incomplete kernel interval')
  try { await writeFile(join(out, path), bytes, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST' || digest(await readFile(join(out, path))) !== sha256) throw error
  }
  return { ...metadata, path, sha256, bytes: bytes.length,
    targets: [...new Set(kernel.segments.map(segment => segment.target))], startEt, endEt, integrationBatch: batch }
}
async function verifiedCrop(path) {
  const bytes = await readFile(path), evidence = JSON.parse(await readFile(`${path}.json`, 'utf8'))
  if (bytes.length !== evidence.bytes || digest(bytes) !== evidence.sha256 || new URL(evidence.source.source).protocol !== 'https:') throw new Error('Invalid source crop provenance')
  return { bytes, evidence }
}
for (const config of plan.cores) {
  if (!['de441', 'de442', 'de437-sat415', 'sat393-embedded'].includes(config.id) || cores[config.id]) throw new Error('Invalid planetary core selection')
  const { bytes, evidence } = await verifiedCrop(config.path)
  const supplementalSource = await sourceEvidence(config, evidence.source.source, parsed(bytes).segments.map(segment => segment.target))
  if (['de437-sat415', 'sat393-embedded'].includes(config.id) && !supplementalSource) throw new Error('Embedded center-pool source evidence required')
  const id = `${config.id}-satellite-2020-2031`
  common.push(await publish(bytes, { id, source: evidence.source.source, sourceIdentity: evidence.source, supplementalSource, dependencyOnly: true, solution: config.id.toUpperCase() }))
  cores[config.id] = id
}
for (const config of plan.sources) {
  if (!cores[config.core]) throw new Error('Unknown declared source core')
  if (config.windowLabel && config.windowLabel !== '2020-2030-01-02') throw new Error('Unsupported explicit source window label')
  const split = JSON.parse(await readFile(join(config.directory, 'manifest.json'), 'utf8'))
  if (config.targets?.some(target => !split.files.some(file => file.targets.length === 1 && file.targets[0] === target))) throw new Error('Selected source target is missing from prepared files')
  for (const file of split.files) {
    const target = file.targets[0]
    if (file.targets.length !== 1) throw new Error('Prepared source is not split per target')
    if (config.targets && !config.targets.includes(target)) continue
    if (!knownTargets.has(target) && ![699, 799, 899].includes(target)) throw new Error(`Unaccounted source target ${target}`)
    const bytes = await readFile(join(config.directory, file.path))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Prepared split checksum mismatch')
    if (config.windowLabel === '2020-2030-01-02' && (file.startEt !== 631108800 || file.endEt !== 946814400)) throw new Error('Explicit component window label mismatch')
    await sourceEvidence(config, file.source, [target])
    if (config.sourceKernelId) {
      const dependency = baseFiles.find(entry => entry.id === config.sourceKernelId)
      const identity = identities.bodies.find(entry => entry.naifId === target)
      if (!dependency || dependency.source !== file.source || JSON.stringify(dependency.sourceIdentity) !== JSON.stringify(file.sourceIdentity)
        || !identity?.primaryNaifId || !dependency.targets.includes(identity.primaryNaifId) || !dependency.targets.includes(identity.systemNaifId)
        || parsed(bytes).segments.some(segment => segment.center !== identity.systemNaifId || segment.startEt < dependency.startEt || segment.endEt > dependency.endEt)) throw new Error('Original component source dependency mismatch')
    }
    additions.push({ config, file, bytes, target })
  }
}
// Explicit planet-center supplements retain the same published source family.
for (const config of plan.centers) {
  const { bytes, evidence } = await verifiedCrop(config.path)
  const kernel = parsed(bytes)
  if (kernel.segments.some(segment => segment.target !== config.target)) throw new Error('Planet-center supplement mismatch')
  additions.push({ config, bytes, target: config.target, file: { source: evidence.source.source, sourceIdentity: evidence.source } })
}
const rootIds = new Map()
if (new Set(additions.map(addition => addition.target)).size !== additions.length) throw new Error('Conflicting selected source solutions for one target')
for (const addition of additions) {
  const key = `${addition.config.id}/${addition.target}`
  if (rootIds.has(key)) throw new Error('Duplicate selected source target')
  rootIds.set(key, `satellite-${addition.config.id}-${addition.target}-${addition.config.windowLabel ?? '2020-2031'}`)
}
for (const profile of ['pages', 'full']) {
  const files = [...baseFiles, ...common]
  for (const { config, file, bytes, target } of additions) {
    let outputBytes = bytes, id = rootIds.get(`${config.id}/${target}`)
    const shortened = profile === 'pages' && bytes.length > 8 * 1024 * 1024
    if (shortened) {
      const source = { identity: file.sourceIdentity, size: bytes.length, read: async (start, length) => bytes.subarray(start, start + length) }
      const result = await cropSpk(source, { startEt: 820497600, endEt: 852033600, targets: [target] }) // 2026-01-01/2027-01-01 TDB
      outputBytes = result.buffer
      id = id.replace(config.windowLabel ?? '2020-2031', '2026-2027')
    }
    const solutionKernelIds = [cores[config.core]]
    if (config.sourceKernelId) solutionKernelIds.push(config.sourceKernelId)
    if (config.id === 'sat480' && target === 65304) solutionKernelIds.push(rootIds.get('sat480/699'))
    if (solutionKernelIds.some(id => !id)) throw new Error('Unresolved center dependency')
    files.push(await publish(outputBytes, { id, source: file.source, sourceIdentity: file.sourceIdentity,
      core: false, dependencyOnly: target === 699, solutionKernelIds,
      solution: `${config.id.toUpperCase()} + ${config.core.toUpperCase()}`,
      selectionEvidence: { surveySha256: plan.surveySha256, supplementalSource: await sourceEvidence(config, file.source, [target]), sourceSelection: config.reason, windowPolicy: shortened ? 'Pages large satellite records: 2026/2027' : `Original prepared ${config.windowLabel ?? '2020/2031'} window` } }))
  }
  if (new Set(files.map(file => file.id)).size !== files.length) throw new Error('Duplicate manifest kernel ID')
  const kernels = []
  for (const file of files) {
    const bytes = await readFile(join(out, file.path))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Manifest kernel integrity mismatch')
    kernels.push({ ...file, kernel: parsed(bytes) })
  }
  for (const file of files.filter(file => file.solutionKernelIds)) {
    for (const id of file.solutionKernelIds) if (!files.some(candidate => candidate.id === id)) throw new Error('Missing dependency file')
    for (const et of [file.startEt, (file.startEt + file.endEt) / 2, file.endEt]) {
      const resolver = createKernelResolver(kernels, et)
      if (!file.dependencyOnly) for (const target of file.targets) {
        const state = resolver.relative(target, 10)
        if (!state || ![...Object.values(state.position), ...Object.values(state.velocity)].every(Number.isFinite)) throw new Error(`Incomplete source center chain: ${file.id}`)
      }
    }
  }
  const manifest = { schemaVersion: 1, id: `jpl-satellite-expansion-20260904-${profile}`, profile,
    contract: 'Original SPK types 2/3/17/21; geometric states in declared frames and TDB windows. Explicit source dependency pools; cross-solution comparisons are not a single global dynamical fit. No refitting or duplicated force corrections.', files }
  const filename = `src/data/ephemeris-manifest${profile === 'full' ? '-full' : ''}.json`
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify({ profile, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }))
}
