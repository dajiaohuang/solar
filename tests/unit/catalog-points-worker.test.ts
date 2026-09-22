import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../../src/workers/catalog-points.protocol'
import { utcJulianDayToTt } from '../../src/engine/ephemeris/timeScales'

afterEach(() => vi.unstubAllGlobals())

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
    for (const [index, mode] of (['3d', '2d', '3d'] as const).entries()) {
      send({ type: 'compute', requestId: index + 2, julianDay: 2451545, mode })
      const result = messages.at(-1)!
      expect(result.type).toBe('result')
      if (result.type !== 'result') throw new Error('Expected a computed point cloud')
      expect(result.mode).toBe(mode)
      // The fixture is a 1-degree/day circle with a TT element epoch; the
      // request and echoed observation date remain UTC.
      const angle = (utcJulianDayToTt(2451545) - 2451545) * Math.PI / 180
      const xy = [Math.cos(angle), Math.sin(angle)]
      expect(result.positions).toEqual(new Float32Array(mode === '2d' ? xy : [...xy, 0]))
      expect(result.julianDay).toBe(2451545)
      expect(Object.keys(result)).not.toContain('positions3D')
      expect(transfers.at(-1)).toHaveLength(1)
      expect((transfers.at(-1)![0] as ArrayBuffer).byteLength).toBe(0)
    }
    send({ type: 'reset', requestId: 5 })
    send({ type: 'compute', requestId: 6, julianDay: 2451545, mode: '3d' })
    const result = messages.at(-1)!
    if (result.type !== 'result') throw new Error('Expected an empty point cloud after reset')
    expect(result.positions).toHaveLength(0)
  })
})
