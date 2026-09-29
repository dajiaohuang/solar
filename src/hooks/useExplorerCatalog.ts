import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createExplorerCatalogSession, planExplorerCatalog, type ExplorerCatalogSnapshot } from '../lib/explorerCatalogSession'
import type { AsteroidManifest, CatalogFilters } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'

export function useExplorerCatalog(manifest: AsteroidManifest | null, filters: CatalogFilters, mode: '2d' | '3d', rows: number | null, budgetBytes: number, julianDay: number) {
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{ key: object; snapshot: ExplorerCatalogSnapshot | null; error: string | null; loaded: number; capacity: number } | null>(null)
  const session = useRef<ReturnType<typeof createExplorerCatalogSession> | null>(null)
  const epoch = useRef(julianDay)
  useEffect(() => { epoch.current = julianDay }, [julianDay])
  // Identity changes hide old results immediately, before effect cleanup.
  const identity = useMemo(() => ({ manifest, filters, mode, rows, budgetBytes, generation }), [manifest, filters, mode, rows, budgetBytes, generation])
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
      const plan = planExplorerCatalog(manifest, rows, budgetBytes, mode)
      worker = new Worker(new URL('../workers/catalog-stream.worker.ts', import.meta.url), { type: 'module' })
      const send = (message: CatalogStreamRequest, transfer: Transferable[] = []) => worker!.postMessage(message, transfer)
      const current = createExplorerCatalogSession(plan.capacity, mode, epoch.current, send, snapshot => {
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
      send({ type: 'start', manifest, filters, mode, requestedRows: plan.capacity, budgetBytes: plan.workerBudget, retainEpochs: true, julianDay: epoch.current })
    } catch (error) { queueMicrotask(() => fail(error)) }
    return () => { active = false; session.current?.dispose(); session.current = null; worker?.terminate() }
  }, [identity, manifest, filters, mode, rows, budgetBytes])
  const advance = useCallback((targetEpoch: number) => {
    try { session.current?.request(targetEpoch) }
    catch (error) { setState(previous => previous ? { ...previous, snapshot: null, error: String(error) } : previous) }
  }, [])
  const retry = useCallback(() => setGeneration(value => value + 1), [])
  return { ...(state?.key === identity ? state : { snapshot: null, error: null, loaded: 0, capacity: 0 }), advance, retry }
}
