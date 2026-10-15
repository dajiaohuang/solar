import {
  RENDER_BUDGET_COOLDOWN_MS,
  RENDER_BUDGET_QUANTUM,
  RENDER_FRAME_P95_PRESSURE_MS,
  RENDER_FRAME_P95_TARGET_MS,
  RENDER_FRAME_SLOW_LIMIT_MS,
  RENDER_FRAME_TAIL_LIMIT_MS,
  estimateMissedFrameRatio,
  RENDER_MISSED_FRAME_EMERGENCY_RATIO,
  RENDER_MISSED_FRAME_PRESSURE_RATIO,
  RENDER_MISSED_FRAME_TARGET_RATIO,
  type RenderBudgetPolicy,
} from './renderBudget'
import { adoptCurrentPositionOrdinals, type CurrentPositions } from './currentPositions'

export type DisplayWindow = { samples: number; p50Ms: number; p95Ms: number; p99Ms: number; missedRatio: number }
export type StateDisplayBudget = { count: number; slow: number; fast: number; adjustedAt: number | null; reason: 'initial' | 'slow' | 'headroom' }
export const resetDisplayEvidence = (state: StateDisplayBudget): StateDisplayBudget => ({ ...state, slow: 0, fast: 0 })

/** Display decisions never alter source states, provenance or request coverage. */
export function advanceStateDisplayBudget(state: StateDisplayBudget, window: DisplayWindow, policy: RenderBudgetPolicy, available: number, now: number): StateDisplayBudget {
  if (!Number.isFinite(now) || !Number.isFinite(available) || available <= 0 || window.samples < 12 ||
    !Number.isFinite(window.p50Ms) || !Number.isFinite(window.p95Ms) || !Number.isFinite(window.p99Ms) || !Number.isFinite(window.missedRatio) ||
    window.p50Ms <= 0 || window.p95Ms < window.p50Ms || window.p99Ms < window.p95Ms || window.missedRatio < 0 || window.missedRatio > 1) return resetDisplayEvidence(state)
  if (state.adjustedAt !== null && now - state.adjustedAt < RENDER_BUDGET_COOLDOWN_MS) return state
  const slow = window.p95Ms > RENDER_FRAME_P95_PRESSURE_MS || window.p99Ms > RENDER_FRAME_TAIL_LIMIT_MS ||
    window.missedRatio > RENDER_MISSED_FRAME_PRESSURE_RATIO
  const fast = available >= state.count && window.p95Ms <= RENDER_FRAME_P95_TARGET_MS &&
    window.p99Ms < RENDER_FRAME_TAIL_LIMIT_MS && window.missedRatio < RENDER_MISSED_FRAME_TARGET_RATIO
  const next = { ...state, slow: slow ? state.slow + 1 : 0, fast: fast ? state.fast + 1 : 0 }
  const change = (count: number, reason: StateDisplayBudget['reason']) => count === state.count
    ? resetDisplayEvidence(next) : { count, slow: 0, fast: 0, adjustedAt: now, reason }
  // Even an explicitly conservative quality selection must react to pressure.
  if (next.slow >= 2 || window.p95Ms > RENDER_FRAME_SLOW_LIMIT_MS || window.missedRatio > RENDER_MISSED_FRAME_EMERGENCY_RATIO) {
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
    const window = { samples, p50Ms: sorted[Math.floor((samples - 1) / 2)], p95Ms: sorted[Math.ceil(samples * .95) - 1],
      p99Ms: sorted[Math.ceil(samples * .99) - 1], missedRatio: estimateMissedFrameRatio(sorted) }
    this.intervals = []; this.elapsed = 0
    return window
  }
}

/** Stable priority IDs followed by source order; references are not invented. */
export function selectStateDisplayPositions(source: CurrentPositions, limit: number, priorityIds: string[]): CurrentPositions {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid state display limit')
  if (source.length <= limit) return source
  if (limit === 0) return adoptCurrentPositionOrdinals(source, new Uint32Array())
  const priority = new Set(priorityIds), ordinals = new Uint32Array(limit)
  let priorityOrdinals = new Uint32Array(Math.min(limit, priority.size))
  let priorityCount = 0, ordinaryCount = 0
  for (let index = 0; index < source.length; index++) {
    const id = source.bodyAt(index).id
    if (priority.has(id)) {
      // Keep duplicate source identities behaviorally compatible too. Normal
      // selected-body rosters are unique, so this remains a tiny side buffer.
      if (priorityCount === priorityOrdinals.length) {
        const next = new Uint32Array(Math.min(limit, Math.max(1, priorityOrdinals.length * 2)))
        next.set(priorityOrdinals)
        priorityOrdinals = next
      }
      priorityOrdinals[priorityCount++] = index
    } else if (ordinaryCount < limit) {
      ordinals[ordinaryCount++] = index
    }

    // Once every requested identity has appeared and enough source-order rows
    // are staged, later rows cannot change the result. Missing priorities
    // require a full scan, but never a second pass over the same roster.
    if (priorityCount >= limit || (priorityCount === priority.size && ordinaryCount >= limit - priorityCount)) break
  }
  const selectedOrdinaryCount = Math.min(ordinaryCount, limit - priorityCount)
  ordinals.copyWithin(priorityCount, 0, selectedOrdinaryCount)
  ordinals.set(priorityOrdinals.subarray(0, priorityCount), 0)
  // This buffer is fresh and local. Transfer its ownership instead of making
  // the generic selector's defensive second copy on every budget change.
  return adoptCurrentPositionOrdinals(source, ordinals.subarray(0, priorityCount + selectedOrdinaryCount))
}
