const TYPES = new Set([2, 3, 17, 21])
const FRAMES = new Set([1, 17])
const MAX_DEPTH = 32
const MAX_KERNELS = 4096
const MAX_SEGMENTS = 100_000
const MAX_BOUNDARIES = 4096

const fail = message => { throw new Error(`Invalid kernel window request: ${message}`) }

function validate(kernels, target, startEt, endEt) {
  if (!Array.isArray(kernels) || (kernels.length === 0 && target !== 0)) fail('kernels are required')
  if (!Number.isFinite(target) || !Number.isSafeInteger(target)) fail('target must be a safe integer')
  if (kernels.length > MAX_KERNELS) fail('too many kernels')
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || endEt < startEt) fail('finite ordered window is required')
  const ids = new Set()
  let totalSegments = 0
  for (const kernel of kernels) {
    if (!kernel || typeof kernel.id !== 'string' || !kernel.id || ids.has(kernel.id)) fail('kernel identities must be unique')
    ids.add(kernel.id)
    if (!Array.isArray(kernel.segments)) fail(`segments missing for ${kernel.id}`)
    if (typeof kernel.dependencyOnly !== 'undefined' && typeof kernel.dependencyOnly !== 'boolean') fail(`invalid dependency flag for ${kernel.id}`)
    if (kernel.solutionKernelIds !== undefined && (!Array.isArray(kernel.solutionKernelIds) || kernel.solutionKernelIds.some(id => typeof id !== 'string') || new Set(kernel.solutionKernelIds).size !== kernel.solutionKernelIds.length || kernel.solutionKernelIds.includes(kernel.id))) fail(`invalid solution pool for ${kernel.id}`)
    for (const segment of kernel.segments) {
      if (++totalSegments > MAX_SEGMENTS) fail('too many segments')
      if (!Number.isSafeInteger(segment.target) || !Number.isSafeInteger(segment.center) || !Number.isSafeInteger(segment.type) || !Number.isSafeInteger(segment.frame) || !Number.isFinite(segment.startEt) || !Number.isFinite(segment.endEt) || segment.startEt > segment.endEt) fail(`invalid segment in ${kernel.id}`)
    }
  }
}

function potentialTargets(kernels, target) {
  const centers = new Map()
  for (const kernel of kernels) for (const segment of kernel.segments) {
    if (!centers.has(segment.target)) centers.set(segment.target, new Set())
    centers.get(segment.target).add(segment.center)
  }
  const targets = new Set([target]), queue = [target]
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current === 0) continue // The resolver never evaluates a segment for SSB.
    for (const center of centers.get(current) ?? []) {
      if (!targets.has(center)) { targets.add(center); queue.push(center) }
    }
  }
  return targets
}

function boundaries(kernels, target, startEt, endEt) {
  const targets = potentialTargets(kernels, target)
  const values = new Set([startEt, endEt])
  for (const kernel of kernels) for (const segment of kernel.segments) {
    if (segment.target !== 0 && targets.has(segment.target) && segment.endEt >= startEt && segment.startEt <= endEt) { values.add(Math.max(startEt, segment.startEt)); values.add(Math.min(endEt, segment.endEt)) }
    if (values.size > MAX_BOUNDARIES) fail('too many boundaries')
  }
  return [...values].sort((a, b) => a - b)
}

function selectedContext(kernels, target, et, endEt = et) {
  for (let i = kernels.length - 1; i >= 0; i--) {
    const root = kernels[i]
    if (root.dependencyOnly || !root.segments.some(s => s.target === target && s.startEt <= et && endEt <= s.endEt)) continue
    if (root.solutionKernelIds === undefined) return { key: 'legacy', pool: kernels.filter(k => !k.dependencyOnly && k.solutionKernelIds === undefined) }
    const pool = root.solutionKernelIds.map(id => kernels.find(k => k.id === id))
    if (pool.some(k => !k)) return { error: 'explicit-solution-pool-missing', root: root.id }
    return { key: `root:${root.id}`, pool: [...pool, root], root: root.id }
  }
  return { key: 'legacy', pool: kernels.filter(k => !k.dependencyOnly && k.solutionKernelIds === undefined) }
}

function resolveTarget(kernels, target, et, endEt = et, seen = [], evidence = [], fixedContext = null) {
  if (target === 0) return { state: 'covered', chain: evidence.concat([{ target, origin: 'naif:0' }]) }
  if (seen.length > MAX_DEPTH || seen.includes(target)) return { state: 'gap', reason: seen.includes(target) ? 'center-chain-cycle' : 'center-chain-depth-exceeded', chain: evidence }
  const context = fixedContext ?? selectedContext(kernels, target, et, endEt)
  if (context.error) return { state: 'gap', reason: context.error, chain: evidence.concat([{ target, root: context.root }]) }
  let selected
  for (let i = context.pool.length - 1; i >= 0; i--) {
    const kernel = context.pool[i]
    for (let j = kernel.segments.length - 1; j >= 0; j--) {
      const segment = kernel.segments[j]
      if (segment.target === target && segment.startEt <= et && endEt <= segment.endEt) { selected = { kernel, segment }; break }
    }
    if (selected) break
  }
  if (!selected) return { state: 'gap', reason: 'target-absent-in-solution-pool', chain: evidence.concat([{ target, context: context.key }]) }
  const { kernel, segment } = selected
  const item = { target, kernelId: kernel.id, center: segment.center, frame: segment.frame, type: segment.type, startEt: segment.startEt, endEt: segment.endEt, context: context.key }
  if (!TYPES.has(segment.type) || !FRAMES.has(segment.frame)) return { state: 'gap', reason: 'unsupported-selected-segment', chain: evidence.concat([item]) }
  return resolveTarget(context.pool, segment.center, et, endEt, [...seen, target], evidence.concat([item]), context)
}

function cell(kernels, target, et, endEt = et) { return resolveTarget(kernels, target, et, endEt) }

/** Descriptor/dependency coverage only; never emits an exact-window claim. */
export function analyzeKernelWindow({ kernels, target, startEt, endEt }) {
  validate(kernels, target, startEt, endEt)
  const cuts = boundaries(kernels, target, startEt, endEt)
  const points = cuts.map(et => ({ et, ...cell(kernels, target, et) }))
  const intervals = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i], to = cuts[i + 1]
    if (from === to) continue
    intervals.push({ startEt: from, endEt: to, openness: '(start,end)', ...cell(kernels, target, from, to) })
  }
  const gaps = [...points.filter(p => p.state === 'gap').map(p => ({ kind: 'point', et: p.et, reason: p.reason, chain: p.chain })), ...intervals.filter(p => p.state === 'gap').map(p => ({ kind: 'interval', startEt: p.startEt, endEt: p.endEt, reason: p.reason, chain: p.chain }))]
  return { target, requested: { startEt, endEt }, dependencyCoverage: { points, intervals }, gaps,
    meaning: 'Descriptor and dependency availability only; does not prove coefficient values, numerical accuracy, or physical exactness throughout the window.' }
}
