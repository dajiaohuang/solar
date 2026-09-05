const TYPES = new Set([2, 3, 17, 21])
const FRAMES = new Set([1, 17])
const MAX_DEPTH = 32

const fail = message => { throw new Error(`Invalid kernel window request: ${message}`) }

function validate(kernels, target, startEt, endEt) {
  if (!Array.isArray(kernels) || (kernels.length === 0 && target !== 0)) fail('kernels are required')
  if (!Number.isFinite(target) || !Number.isInteger(target)) fail('target must be an integer')
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || endEt < startEt) fail('finite ordered window is required')
  const ids = new Set()
  for (const kernel of kernels) {
    if (!kernel || typeof kernel.id !== 'string' || !kernel.id || ids.has(kernel.id)) fail('kernel identities must be unique')
    ids.add(kernel.id)
    if (!Array.isArray(kernel.segments)) fail(`segments missing for ${kernel.id}`)
    if (kernel.solutionKernelIds !== undefined && (!Array.isArray(kernel.solutionKernelIds) || new Set(kernel.solutionKernelIds).size !== kernel.solutionKernelIds.length || kernel.solutionKernelIds.includes(kernel.id))) fail(`invalid solution pool for ${kernel.id}`)
    for (const segment of kernel.segments) {
      if (!Number.isInteger(segment.target) || !Number.isInteger(segment.center) || !Number.isInteger(segment.type) || !Number.isInteger(segment.frame) || !Number.isFinite(segment.startEt) || !Number.isFinite(segment.endEt) || segment.startEt > segment.endEt) fail(`invalid segment in ${kernel.id}`)
    }
  }
  return ids
}

function boundaries(kernels, startEt, endEt) {
  const values = new Set([startEt, endEt])
  for (const kernel of kernels) for (const segment of kernel.segments) {
    if (segment.endEt >= startEt && segment.startEt <= endEt) { values.add(Math.max(startEt, segment.startEt)); values.add(Math.min(endEt, segment.endEt)) }
  }
  return [...values].sort((a, b) => a - b)
}

function selectedContext(kernels, ids, target, et) {
  for (let i = kernels.length - 1; i >= 0; i--) {
    const root = kernels[i]
    if (root.dependencyOnly || !root.segments.some(s => s.target === target && s.startEt <= et && et <= s.endEt)) continue
    if (root.solutionKernelIds === undefined) return { key: 'legacy', pool: kernels.filter(k => !k.dependencyOnly && k.solutionKernelIds === undefined) }
    const pool = root.solutionKernelIds.map(id => kernels.find(k => k.id === id))
    if (pool.some(k => !k)) return { error: 'explicit-solution-pool-missing', root: root.id }
    return { key: `root:${root.id}`, pool: [...pool, root], root: root.id }
  }
  return { key: 'legacy', pool: kernels.filter(k => !k.dependencyOnly && k.solutionKernelIds === undefined) }
}

function resolveTarget(kernels, ids, target, et, seen = [], evidence = [], fixedContext = null) {
  if (target === 0) return { state: 'covered', chain: evidence.concat([{ target, origin: 'naif:0' }]) }
  if (seen.length >= MAX_DEPTH || seen.includes(target)) return { state: 'gap', reason: seen.includes(target) ? 'center-chain-cycle' : 'center-chain-depth-exceeded', chain: evidence }
  const context = fixedContext ?? selectedContext(kernels, ids, target, et)
  if (context.error) return { state: 'gap', reason: context.error, chain: evidence.concat([{ target, root: context.root }]) }
  let selected
  for (let i = context.pool.length - 1; i >= 0; i--) {
    const kernel = context.pool[i]
    for (let j = kernel.segments.length - 1; j >= 0; j--) {
      const segment = kernel.segments[j]
      if (segment.target === target && segment.startEt <= et && et <= segment.endEt) { selected = { kernel, segment }; break }
    }
    if (selected) break
  }
  if (!selected) return { state: 'gap', reason: 'target-absent-in-solution-pool', chain: evidence.concat([{ target, context: context.key }]) }
  const { kernel, segment } = selected
  const item = { target, kernelId: kernel.id, center: segment.center, frame: segment.frame, type: segment.type, startEt: segment.startEt, endEt: segment.endEt, context: context.key }
  if (!TYPES.has(segment.type) || !FRAMES.has(segment.frame)) return { state: 'gap', reason: 'unsupported-selected-segment', chain: evidence.concat([item]) }
  const center = resolveTarget(context.pool, ids, segment.center, et, [...seen, target], evidence.concat([item]), context)
  return center.state === 'covered' ? center : center
}

function cell(kernels, ids, target, et) { return resolveTarget(kernels, ids, target, et) }

/** Descriptor/dependency coverage only; never emits an exact-window claim. */
export function analyzeKernelWindow({ kernels, target, startEt, endEt }) {
  const ids = validate(kernels, target, startEt, endEt)
  const cuts = boundaries(kernels, startEt, endEt)
  const points = cuts.map(et => ({ et, ...cell(kernels, ids, target, et) }))
  const intervals = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i], to = cuts[i + 1]
    if (from === to) continue
    intervals.push({ startEt: from, endEt: to, openness: '(start,end)', ...cell(kernels, ids, target, from + (to - from) / 2) })
  }
  const gaps = [...points.filter(p => p.state === 'gap').map(p => ({ kind: 'point', et: p.et, reason: p.reason, chain: p.chain })), ...intervals.filter(p => p.state === 'gap').map(p => ({ kind: 'interval', startEt: p.startEt, endEt: p.endEt, reason: p.reason, chain: p.chain }))]
  return { target, requested: { startEt, endEt }, descriptorCoverage: { points, intervals }, dependencyCoverage: { points, intervals }, gaps,
    meaning: 'Descriptor and dependency availability only; does not prove coefficient values, numerical accuracy, or physical exactness throughout the window.' }
}
