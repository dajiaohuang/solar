#!/usr/bin/env node
/**
 * Compare Solar's TypeScript SPK reader/source-chain evaluation to an
 * independently generated CSPICE reference report.
 *
 * Usage:
 *   rtk proxy node --experimental-strip-types scripts/compare-spk-cspice-reference.mjs PACK CSPICE_REPORT OUTPUT
 *
 * The output is created exclusively. This is numerical source-reader evidence,
 * not a physical accuracy bound or runtime-manifest admission.
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

const [packArg, referenceArg, outputArg] = process.argv.slice(2)
if (!packArg || !referenceArg || !outputArg || process.argv.length !== 5) {
  throw new Error('Usage: compare-spk-cspice-reference.mjs PACK CSPICE_REPORT OUTPUT')
}

const packPath = path.resolve(packArg)
const referencePath = path.resolve(referenceArg)
const outputPath = path.resolve(outputArg)
const scriptPath = fileURLToPath(import.meta.url)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const ownedPath = (root, relative) => {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid source path in spacecraft receipt')
  const full = path.resolve(root, relative)
  const rel = path.relative(root, full)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Spacecraft receipt path escapes its pack')
  return full
}
const verifyFile = async (root, relative, expectedHash) => {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Invalid SHA-256 in spacecraft receipt')
  const filePath = ownedPath(root, relative)
  const bytes = await readFile(filePath)
  if (sha256(bytes) !== expectedHash) throw new Error(`Spacecraft source hash mismatch: ${relative}`)
  return bytes
}

const manifestBytes = await readFile(path.join(packPath, 'prepared-manifest.json'))
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const reference = await readJson(referencePath)
const sourceReceipts = Array.isArray(manifest.sources)
  ? manifest.sources
  : manifest.source && typeof manifest.source === 'object' ? [manifest.source] : []
const pythonReferencePath = path.resolve(path.dirname(scriptPath), 'reference-spacecraft-pack.py')
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..')
const runtimeEphemerisRoot = await realpath(path.join(repositoryRoot, 'public/data/ephemerides'))
const pythonReferenceHash = sha256(await readFile(pythonReferencePath))
if (sha256(manifestBytes) !== reference.manifestSha256 || reference.generatorSha256 !== pythonReferenceHash ||
    reference.frame !== 'J2000' || reference.origin !== 'SSB' || reference.aberration !== 'NONE' ||
    !sourceReceipts.length || !Array.isArray(manifest.files) || !Array.isArray(reference.sources)) {
  throw new Error('CSPICE reference does not bind this prepared manifest, reference generator, or state convention')
}

const externalEntries = []
if (Array.isArray(manifest.externalDependencies) && manifest.externalDependencies.length) {
  const runtimeManifest = await readJson(path.join(repositoryRoot, 'src/data/ephemeris-manifest-full.json'))
  for (const dependency of manifest.externalDependencies) {
    if (!dependency || typeof dependency.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(dependency.id) ||
        !/^[a-f0-9]{64}$/.test(dependency.sha256) || !Number.isSafeInteger(dependency.bytes) || dependency.bytes < 1) {
      throw new Error('Invalid external dependency receipt')
    }
    const productEntry = runtimeManifest.files.find(entry => entry.id === dependency.id)
    if (!productEntry || productEntry.sha256 !== dependency.sha256 || productEntry.bytes !== dependency.bytes ||
        typeof productEntry.path !== 'string' || path.isAbsolute(productEntry.path)) {
      throw new Error(`Runtime manifest dependency differs: ${dependency.id}`)
    }
    const externalPath = path.resolve(repositoryRoot, 'public/data/ephemerides', productEntry.path)
    const canonicalExternalPath = await realpath(externalPath)
    const relativePath = path.relative(runtimeEphemerisRoot, canonicalExternalPath)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error('External dependency path escapes the ephemeris directory')
    }
    const bytes = await readFile(canonicalExternalPath)
    if (bytes.length !== dependency.bytes || sha256(bytes) !== dependency.sha256) {
      throw new Error(`External dependency bytes differ: ${dependency.id}`)
    }
    externalEntries.push({ ...productEntry, externalPath: canonicalExternalPath, dependencyOnly: true })
  }
}
const expectedExternalDependencies = (manifest.externalDependencies ?? []).map(({ id, sha256 }) => ({ id, sha256 }))
if (JSON.stringify(reference.externalDependencies ?? []) !== JSON.stringify(expectedExternalDependencies)) {
  throw new Error('CSPICE reference external dependencies differ from the prepared receipt')
}

const sourceResults = []
for (const source of reference.sources) {
  const receiptSource = sourceReceipts.find(candidate => candidate.id === source.id)
  if (!receiptSource || receiptSource.target !== source.target || receiptSource.sha256 !== source.sourceSha256) {
    throw new Error(`CSPICE reference source identity differs: ${source.id}`)
  }
  await verifyFile(packPath, receiptSource.originalPath, receiptSource.sha256)
  const entries = manifest.files.filter(entry => entry.sourceIdentity?.sha256 === receiptSource.sha256)
  const roots = entries.filter(entry => entry.dependencyOnly !== true && entry.targets?.includes(receiptSource.target))
  if (roots.length !== 1 || !Array.isArray(roots[0].solutionKernelIds) || roots[0].solutionKernelIds.length < 1) {
    throw new Error(`Expected one explicitly pooled spacecraft root for ${source.id}`)
  }
  const rootEntry = roots[0]
  const dependencyEntries = rootEntry.solutionKernelIds.map(id =>
    entries.find(entry => entry.id === id && entry.dependencyOnly === true) ??
    externalEntries.find(entry => entry.id === id))
  if (dependencyEntries.some(entry => !entry || entry.dependencyOnly !== true) ||
      new Set(rootEntry.solutionKernelIds).size !== rootEntry.solutionKernelIds.length) {
    throw new Error(`Invalid explicit dependency pool for ${source.id}`)
  }

  const loadKernel = async entry => {
    const bytes = entry.externalPath
      ? await readFile(entry.externalPath)
      : await verifyFile(packPath, entry.path, entry.sha256)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Kernel bytes differ: ${entry.id}`)
    const owned = Uint8Array.from(bytes)
    const kernel = new SpkKernel(owned.buffer)
    for (const target of entry.targets ?? []) {
      if (!kernel.segments.some(segment => segment.target === target)) throw new Error(`SPK target inventory differs: ${entry.path} / ${target}`)
    }
    return { entry, kernel }
  }
  const dependencies = await Promise.all(dependencyEntries.map(loadKernel))
  const root = await loadKernel(rootEntry)
  const pool = [...dependencies, root]
  const maxDifference = Array(6).fill(0)
  const maxDifferenceEpoch = Array(6).fill(null)
  if (!Array.isArray(source.samples) || source.samples.length < 1) throw new Error(`CSPICE reference has no samples for ${source.id}`)

  for (const sample of source.samples) {
    const et = sample.et
    if (!Number.isFinite(et) || et < manifest.requestedWindow.startEt || et > manifest.requestedWindow.endEt ||
        !Array.isArray(sample.state) || sample.state.length !== 6 || !sample.state.every(Number.isFinite)) {
      throw new Error(`Invalid CSPICE sample for ${source.id}`)
    }
    const cache = new Map(), visiting = new Set()
    const barycentric = target => {
      if (target === 0) return [0, 0, 0, 0, 0, 0]
      if (cache.has(target)) return cache.get(target)
      if (visiting.has(target) || visiting.size >= 32) throw new Error(`Cyclic or deep source center chain at ${target}`)
      visiting.add(target)
      try {
        for (let index = pool.length - 1; index >= 0; index--) {
          const state = pool[index].kernel.evaluate(target, et)
          if (!state) continue
          const center = barycentric(state.center)
          if (!center) throw new Error(`Missing source center ${state.center} for target ${target} at ET ${et}`)
          let relative = [state.position.x, state.position.y, state.position.z,
            state.velocity.x, state.velocity.y, state.velocity.z]
          if (state.frame === 17) {
            const angle = 84381.448 / 3600 * Math.PI / 180
            const c = Math.cos(angle), s = Math.sin(angle)
            relative = [relative[0], c*relative[1]-s*relative[2], s*relative[1]+c*relative[2],
              relative[3], c*relative[4]-s*relative[5], s*relative[4]+c*relative[5]]
          } else if (state.frame !== 1) throw new Error(`Unsupported SPK reference frame ${state.frame}`)
          const resolved = relative.map((value, component) => value + center[component])
          cache.set(target, resolved)
          return resolved
        }
        cache.set(target, null)
        return null
      } finally { visiting.delete(target) }
    }

    const actual = barycentric(source.target)
    if (!actual || actual.some(value => !Number.isFinite(value))) throw new Error(`Project SPK reader has no finite state for ${source.id} at ET ${et}`)
    for (let component = 0; component < 6; component++) {
      const difference = Math.abs(actual[component] - sample.state[component])
      if (difference > maxDifference[component]) {
        maxDifference[component] = difference
        maxDifferenceEpoch[component] = et
      }
    }
  }
  sourceResults.push({
    id: source.id,
    target: source.target,
    originalSha256: receiptSource.sha256,
    dependencyKernelIds: rootEntry.solutionKernelIds,
    samples: source.samples.length,
    projectType1Segments: root.kernel.segments.filter(segment => segment.target === source.target && segment.type === 1).length,
    maximumAbsoluteComponentDifference: maxDifference,
    maximumDifferenceEt: maxDifferenceEpoch,
    componentUnits: ['km', 'km', 'km', 'km/s', 'km/s', 'km/s'],
  })
}

const report = {
  schemaVersion: 1,
  comparison: 'Solar TypeScript SPK reader and explicit source-chain sum versus CSPICE SPK state reference',
  frame: 'J2000',
  origin: 'SSB',
  aberration: 'NONE',
  manifestSha256: reference.manifestSha256,
  cspiceReferenceSha256: sha256(await readFile(referencePath)),
  projectReaderSha256: sha256(await readFile(path.join(path.dirname(scriptPath), '../src/engine/ephemeris/spk.ts'))),
  sourceChainSha256: sha256(await readFile(path.join(path.dirname(scriptPath), '../src/engine/ephemeris/kernelPool.ts'))),
  sources: sourceResults,
  limitation: 'Sampled implementation agreement with CSPICE for the bound source bytes only; this is not an observation-fit accuracy bound or runtime-manifest admission.',
}
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify(sourceResults.map(({ id, samples, maximumAbsoluteComponentDifference }) => ({ id, samples, maximumAbsoluteComponentDifference }))))
