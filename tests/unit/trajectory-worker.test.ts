import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrajectoryWorkerRequest, TrajectoryWorkerResponse, TrajectoryWorkerCancelRequest } from '../../src/types'

vi.mock('../../src/engine/ephemeris/kernelStore', () => ({ ensureKernelFiles: vi.fn(async () => {}), kernelsForWindow: () => [] }))
vi.mock('../../src/lib/ephemeris', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/lib/ephemeris')>(),
  createBodyPositionResolver: (_bodies: unknown, epoch: number) => (id: string) => ({ x: id === 'sun' ? 0 : epoch, y: -0, z: 1 / 3 }),
}))

const request: TrajectoryWorkerRequest = {
  type: 'compute', requestId: 1, bodies: [{ id: 'test', name: 'test', kind: 'planet', color: '#fff', size: 1, source: 'custom' }],
  resolutionBodies: [], referenceId: 'sun', centerJulianDay: 2451545, historyDays: 1, sampleCount: 13,
}

afterEach(() => vi.unstubAllGlobals())

async function worker(cancelOnFinalProgress = false) {
  vi.resetModules()
  const messages: TrajectoryWorkerResponse[] = [], transfers: Transferable[][] = []
  const scope = {
    onmessage: null as ((event: MessageEvent<TrajectoryWorkerRequest | TrajectoryWorkerCancelRequest>) => void) | null,
    postMessage(message: TrajectoryWorkerResponse, transfer?: Transferable[]) {
      transfers.push(transfer ?? [])
      messages.push(structuredClone(message, { transfer }))
      if (cancelOnFinalProgress && message.type === 'progress' && message.progress === 1) {
        scope.onmessage!({ data: { type: 'cancel', requestId: message.requestId } } as MessageEvent<TrajectoryWorkerCancelRequest>)
      }
    },
  }
  vi.stubGlobal('self', scope)
  await import('../../src/workers/trajectory.worker')
  return { messages, transfers, send: (data: TrajectoryWorkerRequest) => scope.onmessage!({ data } as MessageEvent<TrajectoryWorkerRequest>) }
}

describe('trajectory worker packed transport', () => {
  it('transfers only offsets and one Float64 coordinate buffer from the real worker entry point', async () => {
    const runtime = await worker()
    runtime.send(request)
    await vi.waitFor(() => expect(runtime.messages.at(-1)?.type).toBe('result'))
    const packed = runtime.messages.at(-1)!.packed!
    expect(packed.bodyIds).toEqual(['test'])
    expect(packed.coordinates).toBeInstanceOf(Float64Array)
    expect(packed.coordinates.length).toBe(13 * 3)
    for (let index = 0; index < 13; index++) {
      expect(packed.coordinates[index * 3]).toBe(2451544 + index / 12)
      expect(packed.coordinates[index * 3 + 1]).toBe(0)
      expect(packed.coordinates[index * 3 + 2]).toBe(0)
    }
    expect(runtime.transfers.at(-1)).toHaveLength(2)
    expect((runtime.transfers.at(-1)![1] as ArrayBuffer).byteLength).toBe(0)
  })

  it('does not publish a completed buffer after cancellation at the final sampling yield', async () => {
    const runtime = await worker(true)
    runtime.send(request)
    await vi.waitFor(() => expect(runtime.messages.at(-1)?.type).toBe('cancelled'))
    expect(runtime.messages.some(message => message.type === 'result')).toBe(false)
    expect(runtime.transfers.every(transfer => transfer.length === 0)).toBe(true)
  })

  it('reports an over-budget sampling request before allocating its historical buffer', async () => {
    const runtime = await worker()
    runtime.send({ ...request, sampleCount: 601 })
    await vi.waitFor(() => expect(runtime.messages.at(-1)?.type).toBe('error'))
    expect(runtime.messages.at(-1)?.error).toMatch(/budget/)
    expect(runtime.messages).toHaveLength(1)
  })
})
