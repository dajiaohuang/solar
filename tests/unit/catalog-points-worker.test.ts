import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../../src/workers/catalog-points.protocol'
import { utcJulianDayToTt } from '../../src/engine/ephemeris/timeScales'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => vi.resetModules())

describe('catalog point worker mode transport', () => {
  it('transfers only the requested dimension and keeps elements available until reset', async () => {
    const messages: CatalogPointWorkerResponse[] = [], transfers: Transferable[][] = []
    const scope = {
      onmessage: null as ((event: MessageEvent<CatalogPointWorkerRequest>) => void) | null,
      postMessage(message: CatalogPointWorkerResponse, transfer?: Transferable[]) {
        messages.push(structuredClone(message, { transfer }))
        transfers.push(transfer ?? [])
      },
    }
    vi.stubGlobal('self', scope)
    await import('../../src/workers/catalog-points.worker')
    const send = (data: CatalogPointWorkerRequest) => scope.onmessage!({ data } as MessageEvent<CatalogPointWorkerRequest>)
    send({ type: 'initialize', requestId: 1, elements: new Float64Array([2451545, 1, 0, 0, 0, 0, 0, 1]) })
    await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('initialized'))
    for (const [index, mode] of (['3d', '2d', '3d'] as const).entries()) {
      send({ type: 'compute', requestId: index + 2, julianDay: 2451545, mode })
      await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: index+2 }))
      const result = messages.at(-1)!
      expect(result.type).toBe('result')
      if (result.type !== 'result') throw new Error('Expected a computed point cloud')
      expect(result.mode).toBe(mode)
      // The fixture is a 1-degree/day circle with a TT element epoch; the
      // request and echoed observation date remain UTC.
      const angle = (utcJulianDayToTt(2451545) - 2451545) * Math.PI / 180
      const xy = [Math.cos(angle), Math.sin(angle)]
      expect(result.positions).toBeInstanceOf(Float64Array)
      const expected = mode === '2d' ? xy : [...xy, 0]
      expected.forEach((value, component) => expect(result.positions[component]).toBeCloseTo(value, 15))
      expect(result.positions.byteLength).toBe(expected.length * 8)
      expect(result.julianDay).toBe(2451545)
      expect(Object.keys(result)).not.toContain('positions3D')
      expect(transfers.at(-1)).toHaveLength(1)
      expect((transfers.at(-1)![0] as ArrayBuffer).byteLength).toBe(0)
    }
    send({ type: 'reset', requestId: 5 })
    send({ type: 'compute', requestId: 6, julianDay: 2451545, mode: '3d' })
    await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: 6 }))
    const result = messages.at(-1)!
    if (result.type !== 'result') throw new Error('Expected an empty point cloud after reset')
    expect(result.positions).toHaveLength(0)
  })

  it('yields during large initialization and computation so a reset cannot publish stale work', async () => {
    vi.spyOn(performance,'now').mockReturnValue(0) // Exercise the deterministic row-limit checkpoint.
    const continuations: (() => void)[] = [], messages: CatalogPointWorkerResponse[] = []
    class YieldChannel {
      port1 = { onmessage: null as (() => void) | null }
      port2 = { postMessage: () => { continuations.push(() => this.port1.onmessage?.()) } }
    }
    const scope = { onmessage: null as ((event: MessageEvent<CatalogPointWorkerRequest>) => Promise<void>) | null,
      postMessage: (message: CatalogPointWorkerResponse) => messages.push(message) }
    vi.stubGlobal('self', scope); vi.stubGlobal('MessageChannel', YieldChannel)
    await import('../../src/workers/catalog-points.worker')
    const send = (data: CatalogPointWorkerRequest) => scope.onmessage!({ data } as MessageEvent<CatalogPointWorkerRequest>)
    const elements = new Float64Array(30_000 * 8)
    for (let i = 0; i < 30_000; i++) elements.set([2451545, 1, .2, 0, 0, 0, 0, 1], i * 8)
    const first = send({ type: 'initialize', requestId: 1, elements })
    expect(continuations).toHaveLength(1)
    await send({ type: 'reset', requestId: 2 })
    continuations.shift()!(); await first
    expect(messages).toHaveLength(0)
    const second = send({ type: 'initialize', requestId: 3, elements })
    await vi.waitFor(() => expect(continuations).toHaveLength(1))
    continuations.shift()!(); await second
    await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'initialized', requestId: 3 }))
    expect(messages.at(-1)).toEqual({ type: 'initialized', requestId: 3 })
    const compute = send({ type: 'compute', requestId: 4, julianDay: 2451545, mode: '3d' })
    expect(messages.at(-1)).toMatchObject({ type: 'progress', requestId: 4 })
    await send({ type: 'reset', requestId: 5 })
    continuations.shift()!(); await compute
    expect(messages.some(message => message.type === 'result' && message.requestId === 4)).toBe(false)
    await send({ type: 'compute', requestId: 6, julianDay: 2451545, mode: '3d' })
    await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: 6 }))
    expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: 6, positions: new Float64Array() })
  })
})
