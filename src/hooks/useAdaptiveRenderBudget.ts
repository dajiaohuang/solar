import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceAdaptiveRenderBudget,
  classifyRenderDevice,
  createAdaptiveRenderBudgetState,
  estimateMissedFrameRatio,
  resolveRenderBudgetPolicy,
  splitRenderBudget,
} from '../lib/renderBudget'
import type { RenderQuality } from '../types'

type Options = {
  viewMode: '2d' | '3d'
  quality: RenderQuality
  comparisonEnabled: boolean
  availableCount: number
  sampleTotal: number
  samplingActive: boolean
  initialCount?: number
}

const MIN_RENDER_SAMPLES_PER_WINDOW = 8

function createBudgetState(policy: ReturnType<typeof resolveRenderBudgetPolicy>, hints: ReturnType<typeof deviceHints>, initialCount?: number) {
  const state = createAdaptiveRenderBudgetState(policy, hints)
  if (initialCount === undefined) return state
  return { ...state, count: Math.max(policy.minimum, Math.min(policy.maximum, initialCount)) }
}

function deviceClass() {
  const coarseLandscape = window.matchMedia('(pointer: coarse) and (max-width: 1180px)')
  return classifyRenderDevice(window.innerWidth, coarseLandscape.matches)
}

function deviceHints() {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
  return {
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  }
}

export function useAdaptiveRenderBudget(options: Options) {
  if (options.initialCount !== undefined && (!Number.isSafeInteger(options.initialCount) || options.initialCount < 1)) {
    throw new RangeError('Initial adaptive render count must be a positive integer')
  }
  const [device, setDevice] = useState(deviceClass)
  useEffect(() => {
    const narrowViewport = window.matchMedia('(max-width: 800px)')
    const coarseLandscape = window.matchMedia('(pointer: coarse) and (max-width: 1180px)')
    const updateDevice = () => setDevice(deviceClass())
    narrowViewport.addEventListener('change', updateDevice)
    coarseLandscape.addEventListener('change', updateDevice)
    return () => {
      narrowViewport.removeEventListener('change', updateDevice)
      coarseLandscape.removeEventListener('change', updateDevice)
    }
  }, [])
  const hints = useMemo(() => deviceHints(), [])
  const policy = useMemo(
    () => {
      const resolved = resolveRenderBudgetPolicy(device, options.viewMode, options.quality, hints)
      if (options.initialCount === undefined) return resolved
      // Keep an existing, user-visible baseline on devices whose generic
      // policy ceiling is lower. Such a device can stay at the known baseline
      // or reduce it from observed slow frames, but cannot grow past it.
      return {
        ...resolved,
        minimum: Math.min(resolved.minimum, options.initialCount),
        initial: options.initialCount,
        maximum: Math.max(resolved.maximum, options.initialCount),
      }
    },
    [device, hints, options.initialCount, options.quality, options.viewMode],
  )
  const policyKey = `${device}:${options.viewMode}:${options.quality}:${options.initialCount ?? 'policy'}`
  const [budget, setBudget] = useState(() => ({
    policyKey,
    state: createBudgetState(policy, hints, options.initialCount),
  }))
  const frameTimes = useRef<number[]>([])
  // Growth and opted-in catalog adjustments use the minimum point count over
  // the whole frame window, not just its last frame.
  const frameCounts = useRef<number[]>([])
  const startedAt = useRef(0)
  const windowStartedAt = useRef(0)

  useEffect(() => {
    const resetWindow = () => {
      const now = performance.now()
      frameTimes.current = []
      frameCounts.current = []
      startedAt.current = now
      windowStartedAt.current = now
    }
    resetWindow()
    document.addEventListener('visibilitychange', resetWindow)
    return () => document.removeEventListener('visibilitychange', resetWindow)
  }, [options.samplingActive, policyKey])

  const onFrameDuration = useCallback((durationMs: number, renderedCount?: number) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return
    const now = performance.now()
    if (startedAt.current === 0) {
      startedAt.current = now
      windowStartedAt.current = now
    }
    const measuredAvailableCount = typeof renderedCount === 'number' && Number.isSafeInteger(renderedCount) && renderedCount >= 0
      ? renderedCount
      : options.availableCount
    frameTimes.current.push(durationMs)
    frameCounts.current.push(measuredAvailableCount)
    if (now - windowStartedAt.current < 2_000) return
    if (frameTimes.current.length < MIN_RENDER_SAMPLES_PER_WINDOW) {
      // Sparse event-driven canvases must not grow their draw cap from one or
      // two cheap submissions. The active view has to provide a real sample
      // window before the controller changes its budget.
      frameTimes.current = []
      frameCounts.current = []
      windowStartedAt.current = now
      return
    }
    const sorted = [...frameTimes.current].sort((a, b) => a - b)
    const p50Index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.5))
    const p50FrameTimeMs = sorted[p50Index] ?? 0
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
    const p95FrameTimeMs = sorted[p95Index] ?? 0
    const p99Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)
    const p99FrameTimeMs = sorted[p99Index] ?? 0
    const missedFrameRatio = estimateMissedFrameRatio(sorted)
    const minimumAvailableCount = frameCounts.current.reduce(
      (minimum, count) => Math.min(minimum, count),
      Number.MAX_SAFE_INTEGER,
    )
    frameTimes.current = []
    frameCounts.current = []
    windowStartedAt.current = now
    setBudget((current) => {
      const currentState = current.policyKey === policyKey
        ? current.state
        : createBudgetState(policy, hints, options.initialCount)
      return {
        policyKey,
        state: advanceAdaptiveRenderBudget(currentState, {
          nowMs: now,
          p50FrameTimeMs,
          p95FrameTimeMs,
          p99FrameTimeMs,
          missedFrameRatio,
          visible: !document.hidden,
          warmedUp: now - startedAt.current >= 2_000,
          samplingActive: options.samplingActive,
          availableCount: minimumAvailableCount,
        }, policy),
      }
    })
  }, [hints, options.availableCount, options.initialCount, options.samplingActive, policy, policyKey])

  const activeState = budget.policyKey === policyKey
    ? budget.state
    : createBudgetState(policy, hints, options.initialCount)
  const total = Math.min(activeState.count, options.availableCount)
  const split = splitRenderBudget(total, options.comparisonEnabled)
  const pixelRatioLimit = device === 'mobile' ? 1.5 : options.quality === 'max' ? 2 : 1.75
  const onActiveRenderFrameDuration = useCallback((durationMs: number, renderedCount?: number) => {
    onFrameDuration(durationMs, renderedCount)
  }, [onFrameDuration])

  return {
    cap: activeState.count,
    total,
    primary: options.comparisonEnabled ? split.primary : total,
    secondary: options.comparisonEnabled ? split.secondary : 0,
    sampleTotal: options.sampleTotal,
    adaptive: policy.adaptive,
    pixelRatioLimit,
    onFrameDuration,
    // Demand-driven catalog canvases publish frame intervals only around
    // active draws; no callback means no idle-page headroom is inferred.
    onActiveRenderFrameDuration,
  }
}
