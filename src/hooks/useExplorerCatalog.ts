import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createExplorerCatalogSession, planExplorerCatalog, type ExplorerCatalogSnapshot } from '../lib/explorerCatalogSession'
import type { AsteroidManifest, CatalogFilters } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'

const planarSnapshots = new WeakMap<ExplorerCatalogSnapshot, ExplorerCatalogSnapshot>()
export function catalogSnapshotForMode(snapshot: ExplorerCatalogSnapshot | null, mode: '2d' | '3d') {
  if (!snapshot || mode === '3d') return snapshot
  let planar = planarSnapshots.get(snapshot)
  if (!planar) {
    const positions = new Float64Array(snapshot.count * 2)
    for (let row = 0; row < snapshot.count; row++) {
      positions[row * 2] = snapshot.positions[row * 3]
      positions[row * 2 + 1] = snapshot.positions[row * 3 + 1]
    }
    planar = { ...snapshot, positions }
    planarSnapshots.set(snapshot, planar)
  }
  return planar
}

export function useExplorerCatalog(manifest: AsteroidManifest | null, filters: CatalogFilters, mode: '2d' | '3d', rows: number | null, budgetBytes: number, julianDay: number) {
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{ key: object; snapshot: ExplorerCatalogSnapshot | null; error: string | null; loaded: number; capacity: number } | null>(null)
  const session = useRef<ReturnType<typeof createExplorerCatalogSession> | null>(null)
  const epoch = useRef(julianDay)
  useEffect(() => { epoch.current = julianDay }, [julianDay])
  // Identity changes hide old results immediately, before effect cleanup.
  // Both renderers share retained xyz propagation and immutable source ordinals.
  const identity = useMemo(() => ({ manifest, filters, rows, budgetBytes, generation }), [manifest, filters, rows, budgetBytes, generation])
  useEffect(() => {
    if (!manifest || !rows) return
    let active = true, worker: Worker | undefined
    const fail = (error: unknown) => {
      if (!active) return
      active = false
      session.current?.dispose(); session.current = null
      worker?.terminate()
      setState({ key: identity, snapshot: null, error: error instanceof Error ? error.message : String(error), loaded: 0, capacity: 0 })
    }
    try {
      const plan = planExplorerCatalog(manifest, rows, budgetBytes, '3d')
      worker = new Worker(new URL('../workers/catalog-stream.worker.ts', import.meta.url), { type: 'module' })
      const send = (message: CatalogStreamRequest, transfer: Transferable[] = []) => worker!.postMessage(message, transfer)
      const current = createExplorerCatalogSession(plan.capacity, '3d', epoch.current, send, snapshot => {
        if (active) setState({ key: identity, snapshot, error: null, loaded: snapshot.count, capacity: plan.capacity })
      })
      session.current = current
      queueMicrotask(() => { if (active) setState({ key: identity, snapshot: null, error: null, loaded: 0, capacity: plan.capacity }) })
      worker.onmessage = (event: MessageEvent<CatalogStreamResponse>) => {
        if (!active) return
        try {
          current.handle(event.data)
          if (event.data.type === 'tile') setState(previous => ({ key: identity, snapshot: previous?.key === identity ? previous.snapshot : null, error: null, loaded: event.data.type === 'tile' ? event.data.drawnRows : 0, capacity: plan.capacity }))
        } catch (error) { fail(error) }
      }
      worker.onerror = event => fail(new Error(event.message || 'Catalog stream worker failed'))
      worker.onmessageerror = () => fail(new Error('Catalog stream response could not be decoded'))
      send({ type: 'start', manifest, filters, mode: '3d', requestedRows: plan.capacity, budgetBytes: plan.workerBudget, retainEpochs: true, julianDay: epoch.current })
    } catch (error) { queueMicrotask(() => fail(error)) }
    return () => { active = false; session.current?.dispose(); session.current = null; worker?.terminate() }
  }, [identity, manifest, filters, rows, budgetBytes])
  const advance = useCallback((targetEpoch: number) => {
    try { session.current?.request(targetEpoch) }
    catch (error) { setState(previous => previous ? { ...previous, snapshot: null, error: String(error) } : previous) }
  }, [])
  const retry = useCallback(() => setGeneration(value => value + 1), [])
  const current = state?.key === identity ? state : { snapshot: null, error: null, loaded: 0, capacity: 0 }
  const snapshot = useMemo(() => catalogSnapshotForMode(current.snapshot, mode), [current.snapshot, mode])
  return { ...current, snapshot, advance, retry }
}
