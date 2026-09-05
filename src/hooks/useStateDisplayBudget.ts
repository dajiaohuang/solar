import { useCallback, useEffect, useMemo, useState } from 'react'
import { classifyRenderDevice, resolveRenderBudgetPolicy, selectInitialRenderBudget } from '../lib/renderBudget'
import { advanceStateDisplayBudget, resetDisplayEvidence, StateDisplaySampler, type DisplayWindow, type StateDisplayBudget } from '../lib/stateDisplayBudget'
import type { RenderQuality } from '../types'

function deviceClass() { return classifyRenderDevice(window.innerWidth, window.matchMedia('(pointer: coarse)').matches) }

export function useStateDisplayBudget(options: { viewMode: '2d' | '3d'; quality: RenderQuality; comparison: boolean; availablePerPane: number; active: boolean }) {
  const [device, setDevice] = useState(deviceClass)
  useEffect(() => {
    const update = () => setDevice(deviceClass())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const hints = useMemo(() => ({ deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency }), [])
  const policy = useMemo(() => {
    const chosen = resolveRenderBudgetPolicy(device, options.viewMode, options.quality, hints)
    const pressure = resolveRenderBudgetPolicy(device, options.viewMode, 'auto', hints)
    return { ...chosen, minimum: pressure.minimum }
  }, [device, options.viewMode, options.quality, hints])
  const key = `${device}:${options.viewMode}:${options.quality}`
  const panes = options.comparison ? 2 : 1
  const session = useMemo(() => ({ key, active: options.active, panes, sampler: new StateDisplaySampler() }), [key, options.active, panes])
  const sampler = session.sampler
  const [budgets, setBudgets] = useState<Record<string, { state: StateDisplayBudget; sampler: StateDisplaySampler; metrics: DisplayWindow | null }>>({})
  const initial = useMemo<StateDisplayBudget>(() => ({ count: selectInitialRenderBudget(policy, hints), fast: 0, slow: 0, adjustedAt: null, reason: 'initial' }), [policy, hints])
  const onFrameDuration = useCallback((duration: number) => {
    if (!options.active || document.hidden || options.availablePerPane <= 0) { sampler.reset(); return }
    const metrics = sampler.sample(duration)
    if (!metrics) return
    const now = performance.now()
    setBudgets(current => {
      const previous = current[key]
      const state = previous?.sampler === sampler ? previous.state : resetDisplayEvidence(previous?.state ?? initial)
      return { ...current, [key]: { state: advanceStateDisplayBudget(state, metrics, policy, options.availablePerPane * panes, now), sampler, metrics } }
    })
  }, [initial, key, options.active, options.availablePerPane, panes, policy, sampler])
  useEffect(() => {
    const reset = () => {
      sampler.reset()
      setBudgets(current => Object.fromEntries(Object.entries(current).map(([name, entry]) => [name, { ...entry, state: resetDisplayEvidence(entry.state), metrics: null }])))
    }
    document.addEventListener('visibilitychange', reset)
    return () => document.removeEventListener('visibilitychange', reset)
  }, [sampler])
  const entry = budgets[key], state = entry?.state ?? initial
  return { limitPerPane: Math.floor(state.count / panes), reason: state.reason,
    metrics: entry?.sampler === sampler ? entry.metrics : null, onFrameDuration }
}
