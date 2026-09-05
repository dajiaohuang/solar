import { RENDER_BUDGET_COOLDOWN_MS, RENDER_BUDGET_QUANTUM, type RenderBudgetPolicy } from './renderBudget'
import { selectCurrentPositions, type CurrentPositions } from './currentPositions'

export type DisplayWindow = { samples: number; p50Ms: number; p95Ms: number; missedRatio: number }
export type StateDisplayBudget = { count: number; slow: number; fast: number; adjustedAt: number | null; reason: 'initial' | 'slow' | 'headroom' }
export const resetDisplayEvidence = (state: StateDisplayBudget): StateDisplayBudget => ({ ...state, slow: 0, fast: 0 })

/** Display decisions never alter source states, provenance or request coverage. */
export function advanceStateDisplayBudget(state: StateDisplayBudget, window: DisplayWindow, policy: RenderBudgetPolicy, available: number, now: number): StateDisplayBudget {
  if (!Number.isFinite(now) || !Number.isFinite(available) || available <= 0 || window.samples < 12 ||
    !Number.isFinite(window.p50Ms) || !Number.isFinite(window.p95Ms) || !Number.isFinite(window.missedRatio) ||
    window.p50Ms <= 0 || window.p95Ms < window.p50Ms || window.missedRatio < 0 || window.missedRatio > 1) return resetDisplayEvidence(state)
  if (state.adjustedAt !== null && now - state.adjustedAt < RENDER_BUDGET_COOLDOWN_MS) return state
  const slow = window.p95Ms > 18.5 || window.missedRatio > .05
  const fast = available >= state.count && window.p95Ms <= 16.7 && window.missedRatio < .02
  const next = { ...state, slow: slow ? state.slow + 1 : 0, fast: fast ? state.fast + 1 : 0 }
  const change = (count: number, reason: StateDisplayBudget['reason']) => count === state.count
    ? resetDisplayEvidence(next) : { count, slow: 0, fast: 0, adjustedAt: now, reason }
  // Even an explicitly conservative quality selection must react to pressure.
  if (next.slow >= 2 || window.p95Ms > 33.3 || window.missedRatio > .2) {
    return change(Math.max(policy.minimum, Math.floor(state.count * .75 / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM), 'slow')
  }
  if (next.fast >= 4 && policy.adaptive) return change(Math.min(policy.maximum, Math.ceil(state.count * 1.125 / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM), 'headroom')
  return next
}

/** Bounded actual renderer callback intervals, not GPU/compositor timestamps. */
export class StateDisplaySampler {
  private intervals: number[] = []
  private elapsed = 0
  private warmup = 0
  reset() { this.intervals = []; this.elapsed = 0; this.warmup = 0 }
  sample(duration: number): DisplayWindow | null {
    if (!Number.isFinite(duration) || duration <= 0) { this.reset(); return null }
    if (this.warmup < 2) { this.warmup++; return null }
    this.intervals.push(duration); this.elapsed += duration
    if (this.intervals.length < 120 && (this.intervals.length < 12 || this.elapsed < 1000)) return null
    const sorted = this.intervals.sort((a, b) => a - b), samples = sorted.length
    const missed = sorted.reduce((sum, value) => sum + Math.max(0, Math.round(value / (1000 / 60)) - 1), 0)
    const window = { samples, p50Ms: sorted[Math.floor((samples - 1) / 2)], p95Ms: sorted[Math.ceil(samples * .95) - 1], missedRatio: missed / (samples + missed) }
    this.intervals = []; this.elapsed = 0
    return window
  }
}

/** Stable priority IDs followed by source order; references are not invented. */
export function selectStateDisplayPositions(source: CurrentPositions, limit: number, priorityIds: string[]): CurrentPositions {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid state display limit')
  if (source.length <= limit) return source
  const priority = new Set(priorityIds), selected = new Set<string>(), ordinals = new Uint32Array(limit)
  let count = 0
  for (let index = 0; index < source.length && count < limit; index++) {
    const id = source.bodyAt(index).id
    if (priority.has(id)) { ordinals[count++] = index; selected.add(id) }
  }
  for (let index = 0; index < source.length && count < limit; index++) {
    if (!selected.has(source.bodyAt(index).id)) ordinals[count++] = index
  }
  return selectCurrentPositions(source, ordinals.subarray(0, count))
}
