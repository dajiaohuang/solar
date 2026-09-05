import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceAdaptiveRenderBudget,
  classifyRenderDevice,
  createAdaptiveRenderBudgetState,
  resolveRenderBudgetPolicy,
  splitRenderBudget,
} from '../lib/renderBudget'
import type { RenderQuality } from '../types'

type Options = {
  viewMode: '2d' | '3d'
  quality: RenderQuality
  comparisonEnabled: boolean
  availableCount: number
  samplingActive: boolean
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
    () => resolveRenderBudgetPolicy(device, options.viewMode, options.quality, hints),
    [device, hints, options.quality, options.viewMode],
  )
  const policyKey = `${device}:${options.viewMode}:${options.quality}`
  const [budget, setBudget] = useState(() => ({
    policyKey,
    state: createAdaptiveRenderBudgetState(policy, hints),
  }))
  const frameTimes = useRef<number[]>([])
  const startedAt = useRef(0)
  const windowStartedAt = useRef(0)

  useEffect(() => {
    const now = performance.now()
    frameTimes.current = []
    startedAt.current = now
    windowStartedAt.current = now
  }, [policyKey])

  const onFrameDuration = useCallback((durationMs: number) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return
    const now = performance.now()
    if (startedAt.current === 0) {
      startedAt.current = now
      windowStartedAt.current = now
    }
    frameTimes.current.push(durationMs)
    if (now - windowStartedAt.current < 2_000) return
    const sorted = [...frameTimes.current].sort((a, b) => a - b)
    const p90Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))
    const p90FrameTimeMs = sorted[p90Index] ?? 0
    const longFrameRatio = sorted.length
      ? sorted.filter((value) => value > 33).length / sorted.length
      : 0
    frameTimes.current = []
    windowStartedAt.current = now
    setBudget((current) => {
      const currentState = current.policyKey === policyKey
        ? current.state
        : createAdaptiveRenderBudgetState(policy, hints)
      return {
        policyKey,
        state: advanceAdaptiveRenderBudget(currentState, {
          nowMs: now,
          p90FrameTimeMs,
          longFrameRatio,
          visible: !document.hidden,
          warmedUp: now - startedAt.current >= 2_000,
          samplingActive: options.samplingActive,
        }, policy),
      }
    })
  }, [hints, options.samplingActive, policy, policyKey])

  const activeState = budget.policyKey === policyKey
    ? budget.state
    : createAdaptiveRenderBudgetState(policy, hints)
  const total = Math.min(activeState.count, options.availableCount)
  const split = splitRenderBudget(total, options.comparisonEnabled)
  const pixelRatioLimit = device === 'mobile' ? 1.5 : options.quality === 'max' ? 2 : 1.75

  return {
    total,
    primary: options.comparisonEnabled ? split.primary : total,
    secondary: options.comparisonEnabled ? split.secondary : 0,
    sampleTotal: options.availableCount,
    adaptive: policy.adaptive,
    pixelRatioLimit,
    onFrameDuration,
  }
}
