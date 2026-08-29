import type { RenderQuality } from '../types'

export type RenderViewMode = '2d' | '3d'
export type RenderDeviceClass = 'mobile' | 'desktop'

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
  p90FrameTimeMs: number
  longFrameRatio: number
  visible: boolean
  warmedUp: boolean
  samplingActive: boolean
}

export type SplitRenderBudget = {
  primary: number
  secondary: number
}

export const RENDER_BUDGET_QUANTUM = 500
export const RENDER_BUDGET_COOLDOWN_MS = 5_000

export function classifyRenderDevice(viewportWidth: number, coarsePointer: boolean): RenderDeviceClass {
  return viewportWidth <= 800 || (coarsePointer && viewportWidth <= 1_180) ? 'mobile' : 'desktop'
}

const TWO_DIMENSIONAL_BUDGETS: Record<RenderDeviceClass, RenderBudgetPolicy> = {
  mobile: { minimum: 8_000, initial: 8_000, maximum: 8_000, adaptive: false },
  desktop: { minimum: 30_000, initial: 30_000, maximum: 30_000, adaptive: false },
}

const THREE_DIMENSIONAL_BUDGETS: Record<RenderDeviceClass, Record<RenderQuality, RenderBudgetPolicy>> = {
  mobile: {
    auto: { minimum: 2_000, initial: 4_000, maximum: 6_000, adaptive: true },
    balanced: { minimum: 4_000, initial: 4_000, maximum: 4_000, adaptive: false },
    max: { minimum: 2_000, initial: 6_000, maximum: 8_000, adaptive: true },
  },
  desktop: {
    auto: { minimum: 6_000, initial: 12_000, maximum: 20_000, adaptive: true },
    balanced: { minimum: 12_000, initial: 12_000, maximum: 12_000, adaptive: false },
    max: { minimum: 8_000, initial: 20_000, maximum: 30_000, adaptive: true },
  },
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function quantizeDown(value: number) {
  return Math.floor(value / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM
}

function quantizeUp(value: number) {
  return Math.ceil(value / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM
}

export function resolveRenderBudgetPolicy(
  deviceClass: RenderDeviceClass,
  viewMode: RenderViewMode,
  quality: RenderQuality,
): RenderBudgetPolicy {
  const policy = viewMode === '2d'
    ? TWO_DIMENSIONAL_BUDGETS[deviceClass]
    : THREE_DIMENSIONAL_BUDGETS[deviceClass][quality]
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
  if (
    state.lastAdjustmentAtMs !== null
    && window.nowMs - state.lastAdjustmentAtMs < RENDER_BUDGET_COOLDOWN_MS
  ) return state

  const slow = window.p90FrameTimeMs > 28 || window.longFrameRatio > 0.15
  const fast = window.p90FrameTimeMs < 18.5 && window.longFrameRatio < 0.05
  const consecutiveSlowWindows = slow ? state.consecutiveSlowWindows + 1 : 0
  const consecutiveFastWindows = fast ? state.consecutiveFastWindows + 1 : 0

  if (consecutiveSlowWindows >= 2 && state.count > policy.minimum) {
    return {
      count: clamp(quantizeDown(state.count * 0.75), policy.minimum, policy.maximum),
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: window.nowMs,
    }
  }

  if (consecutiveFastWindows >= 4 && state.count < policy.maximum) {
    return {
      count: clamp(quantizeUp(state.count * 1.125), policy.minimum, policy.maximum),
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
  if (!comparisonEnabled) return { primary: quantizeDown(available), secondary: 0 }
  if (available < RENDER_BUDGET_QUANTUM * 2) {
    const sharedSmallSample = Math.floor(available / 2)
    return { primary: sharedSmallSample, secondary: sharedSmallSample }
  }
  const sharedPrefix = quantizeDown(available / 2)
  return { primary: sharedPrefix, secondary: sharedPrefix }
}
