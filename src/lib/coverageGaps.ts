type RecordValue = Record<string, unknown>
// Matches scripts/lib/kernel-window-coverage.mjs MAX_BOUNDARIES; a gap may
// occur at every boundary and in every intervening open interval.
const MAX_WINDOW_POINTS = 4096
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid coverage dependency record')
  return value as RecordValue
}
const finite = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid coverage dependency time')
  return value
}
const text = (value: unknown): string => {
  // Reject control characters in external evidence text.
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid coverage dependency text')
  return value
}
function chain(raw: unknown, reason = '') {
  if (raw === null) raw = []
  if (!Array.isArray(raw) || raw.length > 64) throw new Error('Invalid coverage dependency chain')
  const entries = raw
  let unsupported = false
  const steps = entries.map((value, index) => {
    const step = record(value)
    for (const key of ['target', 'center', 'frame', 'type']) {
      if (step[key] !== undefined && !Number.isSafeInteger(step[key])) throw new Error('Invalid dependency identity')
    }
    for (const key of ['origin', 'context', 'kernelId', 'root']) if (step[key] !== undefined) text(step[key])
    if (step.target === undefined && !step.origin || !step.context && !step.origin && !step.root) throw new Error('Incomplete dependency identity')
    if (step.root && (step.target === undefined || step.kernelId || step.context || step.origin)) throw new Error('Invalid missing solution pool root step')
    if (step.origin && !/^naif:-?(0|[1-9]\d*)$/.test(String(step.origin))) throw new Error('Invalid dependency origin')
    if (step.kernelId) {
      if (step.target === undefined || step.center === undefined || step.frame === undefined || step.type === undefined || step.origin ||
          finite(step.startEt) > finite(step.endEt)) throw new Error('Invalid dependency kernel interval')
      if (![1, 17].includes(Number(step.frame)) || ![1, 2, 3, 17, 21].includes(Number(step.type))) {
        if (reason !== 'unsupported-selected-segment' || index !== entries.length-1) throw new Error('Unsupported segment cannot establish dependency coverage')
        unsupported = true
      }
    } else if (['startEt', 'endEt', 'frame', 'type'].some(key => step[key] !== undefined)) throw new Error('Unexpected kernel fields')
    return { ...step }
  })
  if ((reason === 'unsupported-selected-segment') !== unsupported) throw new Error('Unsupported segment reason lacks matching terminal evidence')
  return steps
}

/** Reconcile reported gaps against the declared window partition, without
 * evaluating kernels or independently certifying the dependency chains. */
export function validateCoverageGaps(raw: unknown, start: number, end: number, target?: number) {
  if (finite(start) > finite(end)) throw new Error('Invalid requested dependency window')
  if (target !== undefined && !Number.isSafeInteger(target)) throw new Error('Invalid dependency target')
  const dependency = record(raw), points = dependency.points, intervals = dependency.intervals, gaps = dependency.gaps
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_WINDOW_POINTS || !Array.isArray(intervals) || intervals.length !== points.length-1 ||
      !Array.isArray(gaps) || gaps.length > 2*points.length-1) throw new Error('Invalid dependency window partition')
  const expected = new Map<string, string>()
  const chainKey = (steps: ReturnType<typeof chain>) => JSON.stringify(steps.map(step => Object.keys(step).sort().map(key => [key, step[key]])))
  const key = (kind: string, start: number, end: number, reason: string) => JSON.stringify([kind, start, end, reason])
  const atom = (raw: unknown, kind: string, start: number, end: number) => {
    const value = record(raw)
    if (value.state !== 'covered' && value.state !== 'gap') throw new Error('Invalid dependency atom state')
    const steps = chain(value.chain, value.state === 'gap' ? text(value.reason) : '')
    let nextTarget = target
    let context: string | undefined
    const visited = new Set<number>()
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]
      if (step.context) {
        const current = text(step.context)
        if (current !== 'legacy' && (!current.startsWith('root:') || current.length === 5)) throw new Error('Invalid dependency solution context')
        if (context !== undefined && current !== context) throw new Error('Dependency chain switches solution pools')
        context = current
      }
      if (visited.has(step.target as number)) throw new Error('Dependency chain continues after a repeated target')
      visited.add(step.target as number)
      // The generator checks SSB before its seen.length > 32 depth guard.
      if (index > 32 && step.target !== 0 || step.target === 0 && step.origin !== 'naif:0') throw new Error('Dependency chain exceeds resolver stopping rules')
      if (nextTarget !== undefined && step.target !== nextTarget) throw new Error('Dependency target/center chain is discontinuous')
      if (step.kernelId) {
        if (finite(step.startEt) > start || finite(step.endEt) < end) throw new Error('Dependency kernel does not cover its window atom')
        nextTarget = step.center as number
      } else {
        if (index !== steps.length-1) throw new Error('Dependency terminal step is not last')
        if (step.origin && (step.origin !== 'naif:0' || step.target !== 0 || step.center !== undefined || step.root || step.context)) throw new Error('Invalid dependency SSB terminal')
      }
      if (step.root && value.reason !== 'explicit-solution-pool-missing') throw new Error('Dependency root does not match gap reason')
    }
    const terminal = steps[steps.length-1]
    if (value.reason === 'center-chain-cycle' && (!terminal?.kernelId || nextTarget === 0 || !visited.has(nextTarget as number))) throw new Error('Cycle gap lacks a closing center link')
    if (value.reason === 'center-chain-depth-exceeded' && (!terminal?.kernelId || steps.length !== 33 || nextTarget === 0 || visited.has(nextTarget as number))) throw new Error('Depth gap differs from resolver stopping rules')
    if ((value.state === 'covered') !== (terminal?.origin === 'naif:0')) throw new Error('Dependency coverage must terminate at SSB')
    if (value.reason === 'explicit-solution-pool-missing' && (steps.length !== 1 || !terminal?.root)) throw new Error('Missing solution pool reason lacks root evidence')
    if (value.reason === 'target-absent-in-solution-pool' && (!terminal?.context || terminal.kernelId || terminal.origin || terminal.root || terminal.center !== undefined)) throw new Error('Missing target reason lacks terminal context evidence')
    if (terminal?.context && !terminal.kernelId && value.reason !== 'target-absent-in-solution-pool') throw new Error('Unresolved dependency target has a different gap reason')
    if (value.state === 'gap') expected.set(key(kind, start, end, text(value.reason)), chainKey(steps))
    else if (value.reason !== undefined && value.reason !== '') throw new Error('Covered dependency has a gap reason')
  }
  const boundaries = points.map((raw, index) => {
    const point = record(raw), time = finite(point.et)
    if (time < start || time > end || index === 0 && time !== start || index === points.length-1 && time !== end) throw new Error('Dependency boundaries mismatch')
    atom(point, 'point', time, time)
    return time
  })
  intervals.forEach((raw, index) => {
    const interval = record(raw)
    if (boundaries[index] >= boundaries[index+1] || interval.startEt !== boundaries[index] || interval.endEt !== boundaries[index+1] ||
        interval.openness !== '(start,end)') throw new Error('Dependency intervals do not partition the window')
    atom(interval, 'interval', boundaries[index], boundaries[index+1])
  })
  const result = gaps.map(raw => {
    const gap = record(raw), reason = text(gap.reason)
    if (gap.kind !== 'point' && gap.kind !== 'interval') throw new Error('Invalid dependency gap kind')
    const first = finite(gap.kind === 'point' ? gap.et : gap.startEt), last = gap.kind === 'point' ? first : finite(gap.endEt)
    if (gap.kind === 'point' ? gap.startEt !== undefined || gap.endEt !== undefined : gap.et !== undefined || first >= last) throw new Error('Invalid dependency gap coordinates')
    const identity = key(gap.kind, first, last, reason), steps = chain(gap.chain, reason)
    if (!expected.has(identity)) throw new Error('Reported gap has no matching dependency atom')
    if (expected.get(identity) !== chainKey(steps)) throw new Error('Reported gap dependency chain differs from its atom')
    expected.delete(identity)
    return { kind: gap.kind, start: first, end: last, reason, chain: steps }
  })
  if (expected.size) throw new Error('Dependency gaps are missing from the report')
  return result
}
