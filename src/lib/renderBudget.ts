import type { RenderQuality } from '../types'

export type RenderViewMode = '2d' | '3d'
export type RenderDeviceClass = 'mobile' | 'desktop'
export type RenderCapacityTier = 'mobile-conservative' | 'mobile12' | 'desktop16' | 'desktop32'

export type RenderDeviceHints = {
  deviceMemoryGb?: number
  hardwareConcurrency?: number
}

export type RenderBudgetPolicy = {
  minimum: number
  initial: number
  maximum: number
  adaptive: boolean
}

export type AdaptiveRenderBudgetState = {
  count: number
  consecutiveSlowWindows: number
  consecutiveFastWindows: number
  lastAdjustmentAtMs: number | null
}

export type RenderPerformanceWindow = {
  nowMs: number
  p50FrameTimeMs: number
  p95FrameTimeMs: number
  p99FrameTimeMs: number
  missedFrameRatio: number
  visible: boolean
  warmedUp: boolean
  samplingActive: boolean
  availableCount?: number
}

export type SplitRenderBudget = {
  primary: number
  secondary: number
}

export const RENDER_BUDGET_QUANTUM = 5_000
export const RENDER_BUDGET_COOLDOWN_MS = 5_000
export const RENDER_FRAME_TARGET_MS = 1000 / 60
export const RENDER_FRAME_P95_TARGET_MS = 16.7
export const RENDER_FRAME_P95_PRESSURE_MS = 18.5
export const RENDER_FRAME_TAIL_LIMIT_MS = 28
export const RENDER_FRAME_SLOW_LIMIT_MS = 33.3
export const RENDER_MISSED_FRAME_TARGET_RATIO = 0.02
export const RENDER_MISSED_FRAME_PRESSURE_RATIO = 0.05
export const RENDER_MISSED_FRAME_EMERGENCY_RATIO = 0.2
export const MAX_SOURCE_INVENTORY_ROWS = 1_567_193
const UNDERSIZED_SAMPLE_MINIMUM = 2_000

/** Estimate missed 60 Hz slots from window throughput, not rounded per-sample intervals. */
export function estimateMissedFrameRatio(intervalsMs: readonly number[]): number {
  if (intervalsMs.length === 0) return 0
  let elapsedMs = 0
  for (const intervalMs of intervalsMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0
    elapsedMs += intervalMs
  }
  if (!Number.isFinite(elapsedMs)) return 1
  const expectedSlots = elapsedMs / RENDER_FRAME_TARGET_MS
  if (!Number.isFinite(expectedSlots)) return 1
  const missedSlots = Math.max(0, expectedSlots - intervalsMs.length)
  return expectedSlots > 0 ? missedSlots / expectedSlots : 0
}

export function classifyRenderDevice(viewportWidth: number, coarsePointer: boolean): RenderDeviceClass {
  return viewportWidth <= 800 || (coarsePointer && viewportWidth <= 1_180) ? 'mobile' : 'desktop'
}

export function classifyRenderCapacity(deviceClass: RenderDeviceClass, hints: RenderDeviceHints = {}): RenderCapacityTier {
  if (deviceClass === 'mobile') return hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb <= 4 ? 'mobile-conservative' : 'mobile12'
  // CPU parallelism says nothing about RAM. Memory hints only select a
  // candidate ceiling; they must never promote the initial workload.
  if (hints.deviceMemoryGb !== undefined && Number.isFinite(hints.deviceMemoryGb) && hints.deviceMemoryGb >= 24) return 'desktop32'
  return 'desktop16'
}

const TWO_DIMENSIONAL_BUDGETS: Record<RenderCapacityTier, Record<RenderQuality, RenderBudgetPolicy>> = {
  'mobile-conservative': {
    auto: { minimum: 2_000, initial: 8_000, maximum: 8_000, adaptive: true },
    balanced: { minimum: 8_000, initial: 8_000, maximum: 8_000, adaptive: false },
    max: { minimum: 2_000, initial: 8_000, maximum: 10_000, adaptive: true },
  },
  mobile12: {
    auto: { minimum: 25_000, initial: 100_000, maximum: 500_000, adaptive: true },
    balanced: { minimum: 100_000, initial: 100_000, maximum: 100_000, adaptive: false },
    max: { minimum: 25_000, initial: 150_000, maximum: 500_000, adaptive: true },
  },
  desktop16: {
    auto: { minimum: 50_000, initial: 250_000, maximum: 1_250_000, adaptive: true },
    balanced: { minimum: 500_000, initial: 500_000, maximum: 500_000, adaptive: false },
    max: { minimum: 50_000, initial: 500_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
  },
  desktop32: {
    auto: { minimum: 50_000, initial: 250_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
    balanced: { minimum: 500_000, initial: 500_000, maximum: 500_000, adaptive: false },
    max: { minimum: 50_000, initial: 500_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
  },
}

const THREE_DIMENSIONAL_BUDGETS: Record<RenderCapacityTier, Record<RenderQuality, RenderBudgetPolicy>> = {
  'mobile-conservative': {
    auto: { minimum: 2_000, initial: 4_000, maximum: 8_000, adaptive: true },
    balanced: { minimum: 4_000, initial: 4_000, maximum: 4_000, adaptive: false },
    max: { minimum: 2_000, initial: 6_000, maximum: 10_000, adaptive: true },
  },
  mobile12: {
    auto: { minimum: 25_000, initial: 100_000, maximum: 250_000, adaptive: true },
    balanced: { minimum: 75_000, initial: 75_000, maximum: 75_000, adaptive: false },
    max: { minimum: 25_000, initial: 150_000, maximum: 250_000, adaptive: true },
  },
  desktop16: {
    auto: { minimum: 50_000, initial: 250_000, maximum: 750_000, adaptive: true },
    balanced: { minimum: 250_000, initial: 250_000, maximum: 250_000, adaptive: false },
    max: { minimum: 50_000, initial: 500_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
  },
  desktop32: {
    auto: { minimum: 50_000, initial: 250_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
    balanced: { minimum: 250_000, initial: 250_000, maximum: 250_000, adaptive: false },
    max: { minimum: 50_000, initial: 500_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
  },
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function quantizeDown(value: number, quantum = RENDER_BUDGET_QUANTUM) {
  return Math.floor(value / quantum) * quantum
}

function quantizeUp(value: number, quantum = RENDER_BUDGET_QUANTUM) {
  return Math.ceil(value / quantum) * quantum
}

export function resolveRenderBudgetPolicy(
  deviceClass: RenderDeviceClass,
  viewMode: RenderViewMode,
  quality: RenderQuality,
  hints: RenderDeviceHints = {},
): RenderBudgetPolicy {
  const tier = classifyRenderCapacity(deviceClass, hints)
  const policy = viewMode === '2d'
    ? TWO_DIMENSIONAL_BUDGETS[tier][quality]
    : THREE_DIMENSIONAL_BUDGETS[tier][quality]
  return { ...policy }
}

/**
 * Capability hints may make the first frame more conservative, but never
 * promote a device above the policy chosen by the viewport/sample profile.
 * Runtime measurements remain authoritative after that first choice.
 */
export function selectInitialRenderBudget(policy: RenderBudgetPolicy, hints: RenderDeviceHints = {}) {
  const lowMemoryHint = hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb <= 4
  const lowConcurrencyHint = hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 4
  if (!policy.adaptive || (!lowMemoryHint && !lowConcurrencyHint)) return policy.initial
  return clamp(quantizeDown(policy.initial * 0.75), policy.minimum, policy.maximum)
}

export function createAdaptiveRenderBudgetState(
  policy: RenderBudgetPolicy,
  hints: RenderDeviceHints = {},
): AdaptiveRenderBudgetState {
  return {
    count: selectInitialRenderBudget(policy, hints),
    consecutiveSlowWindows: 0,
    consecutiveFastWindows: 0,
    lastAdjustmentAtMs: null,
  }
}

export function advanceAdaptiveRenderBudget(
  state: AdaptiveRenderBudgetState,
  window: RenderPerformanceWindow,
  policy: RenderBudgetPolicy,
): AdaptiveRenderBudgetState {
  if (!policy.adaptive || !window.visible || !window.warmedUp || !window.samplingActive) return state
  if (!Number.isFinite(window.p50FrameTimeMs) || !Number.isFinite(window.p95FrameTimeMs) ||
      !Number.isFinite(window.p99FrameTimeMs) || !Number.isFinite(window.missedFrameRatio) ||
      window.p50FrameTimeMs <= 0 || window.p95FrameTimeMs < window.p50FrameTimeMs ||
      window.p99FrameTimeMs < window.p95FrameTimeMs || window.missedFrameRatio < 0 || window.missedFrameRatio > 1) return state
  if (
    state.lastAdjustmentAtMs !== null
    && window.nowMs - state.lastAdjustmentAtMs < RENDER_BUDGET_COOLDOWN_MS
  ) return state

  const slow = window.p95FrameTimeMs > RENDER_FRAME_P95_PRESSURE_MS || window.p99FrameTimeMs > RENDER_FRAME_TAIL_LIMIT_MS ||
    window.missedFrameRatio > RENDER_MISSED_FRAME_PRESSURE_RATIO
  const rawAvailableCount = window.availableCount
  const availableCount = typeof rawAvailableCount === 'number' && Number.isSafeInteger(rawAvailableCount) && rawAvailableCount >= 0
    ? rawAvailableCount
    : undefined
  // The policy floor assumes its candidate workload is loaded. If the source
  // sample is smaller, slow frames must be able to reduce the actual draw count
  // instead of lowering an invisible ceiling above every available point.
  const sampleBelowPolicyFloor = availableCount !== undefined && availableCount < policy.minimum
  const recoveringBelowPolicyFloor = state.count < policy.minimum
  const minimumCount = sampleBelowPolicyFloor
    ? Math.min(availableCount, UNDERSIZED_SAMPLE_MINIMUM)
    : recoveringBelowPolicyFloor
      ? Math.min(state.count, UNDERSIZED_SAMPLE_MINIMUM)
      : policy.minimum
  const adjustmentQuantum = sampleBelowPolicyFloor || recoveringBelowPolicyFloor ? 1_000 : RENDER_BUDGET_QUANTUM
  // A tiny loaded sample cannot prove that the unexercised budget is fast.
  const budgetExercised = availableCount === undefined || availableCount >= state.count
  const fast = budgetExercised && window.p95FrameTimeMs <= RENDER_FRAME_P95_TARGET_MS &&
    window.p99FrameTimeMs < RENDER_FRAME_TAIL_LIMIT_MS && window.missedFrameRatio < RENDER_MISSED_FRAME_TARGET_RATIO
  const consecutiveSlowWindows = slow ? state.consecutiveSlowWindows + 1 : 0
  const consecutiveFastWindows = fast ? state.consecutiveFastWindows + 1 : 0

  const exercisedCount = Math.min(state.count, availableCount ?? state.count)
  // Reduce the workload that was actually drawn, even while streaming has not
  // filled the current cap. Fast frames still require the full cap above.
  if ((consecutiveSlowWindows >= 2 || window.p95FrameTimeMs > RENDER_FRAME_SLOW_LIMIT_MS ||
       window.missedFrameRatio > RENDER_MISSED_FRAME_EMERGENCY_RATIO) && exercisedCount > minimumCount) {
    return {
      count: clamp(quantizeDown(exercisedCount * 0.75, adjustmentQuantum), minimumCount, policy.maximum),
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: window.nowMs,
    }
  }

  if (consecutiveFastWindows >= 4 && state.count < policy.maximum) {
    return {
      count: clamp(quantizeUp(state.count * 1.125, adjustmentQuantum), minimumCount, policy.maximum),
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: window.nowMs,
    }
  }

  return {
    ...state,
    consecutiveSlowWindows,
    consecutiveFastWindows,
  }
}

export function splitRenderBudget(total: number, comparisonEnabled: boolean): SplitRenderBudget {
  const available = Math.max(0, Math.floor(total))
  if (!comparisonEnabled) return { primary: available, secondary: 0 }
  // Policy budgets are already quantized. Preserve the available rows here;
  // comparison panes share a prefix, so at most one odd row remains unused.
  const sharedPrefix = Math.floor(available / 2)
  return { primary: sharedPrefix, secondary: sharedPrefix }
}
