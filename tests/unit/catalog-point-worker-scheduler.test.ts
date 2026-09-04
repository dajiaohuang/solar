import { describe, expect, it } from 'vitest'
import { createCatalogPointWorkerScheduler } from '../../src/lib/catalogPointWorkerScheduler'
import type { CatalogPointWorkerRequest } from '../../src/workers/catalog-points.protocol'

function harness() {
  const sent: CatalogPointWorkerRequest[] = []
  const results: number[] = []
  const errors: string[] = []
  const scheduler = createCatalogPointWorkerScheduler((request) => sent.push(request), {
    onProgress: () => undefined,
    onResult: ({ julianDay }) => results.push(julianDay),
    onError: (message) => errors.push(message),
  })
  return { sent, results, errors, scheduler }
}

describe('catalog point worker scheduler', () => {
  it('initializes once and coalesces busy clock updates to the latest epoch', () => {
    const { sent, results, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(1)
    expect(sent.map(request => request.type)).toEqual(['initialize'])
    scheduler.handle({ type: 'initialized', requestId: sent[0].requestId })
    expect(sent[1]).toMatchObject({ type: 'compute', julianDay: 1 })
    scheduler.requestJulianDay(2)
    scheduler.requestJulianDay(3)
    expect(sent).toHaveLength(2)
    scheduler.handle({ type: 'result', requestId: sent[1].requestId, julianDay: 1, positions: new Float32Array([1]), positions3D: new Float32Array([1]) })
    expect(sent[2]).toMatchObject({ type: 'compute', julianDay: 3 })
    expect(results).toEqual([1])
  })

  it('ignores stale result after a record-set switch', () => {
    const { sent, results, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(1)
    scheduler.handle({ type: 'initialized', requestId: sent[0].requestId })
    const firstCompute = sent[1].requestId
    scheduler.setElements(new Float64Array(16))
    scheduler.handle({ type: 'result', requestId: firstCompute, julianDay: 1, positions: new Float32Array([1]), positions3D: new Float32Array([1]) })
    expect(results).toEqual([])
  })

  it('keeps a result numeric and ignores a late error for a completed request', () => {
    const { sent, errors, results, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(2451545)
    scheduler.handle({ type: 'initialized', requestId: sent[0].requestId })
    const request = sent[1]
    scheduler.handle({ type: 'result', requestId: request.requestId, julianDay: 2451545, positions: new Float32Array([1, 2]), positions3D: new Float32Array([1, 2, 3]) })
    scheduler.handle({ type: 'error', requestId: request.requestId, error: 'bad orbit' })
    expect(results).toEqual([2451545])
    expect(errors).toEqual([])
  })

  it('continues making progress through many epochs without retaining request history', () => {
    const { sent, results, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(0)
    scheduler.handle({ type: 'initialized', requestId: sent[0].requestId })
    for (let epoch = 0; epoch < 10_000; epoch += 1) {
      scheduler.requestJulianDay(epoch)
      const request = sent[sent.length - 1]
      scheduler.handle({ type: 'result', requestId: request.requestId, julianDay: epoch, positions: new Float32Array([epoch]), positions3D: new Float32Array([epoch]) })
    }
    expect(results).toHaveLength(10_000)
    expect(results.at(-1)).toBe(9_999)
  })

  it('publishes each completed epoch while busy and catches up to the latest queued epoch', () => {
    const { sent, results, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(1)
    scheduler.handle({ type: 'initialized', requestId: sent[0].requestId })
    const first = sent[1]
    scheduler.requestJulianDay(2)
    scheduler.requestJulianDay(3)
    scheduler.handle({ type: 'result', requestId: first.requestId, julianDay: 1, positions: new Float32Array([1]), positions3D: new Float32Array([1]) })
    expect(results).toEqual([1])
    const second = sent[2]
    scheduler.handle({ type: 'result', requestId: second.requestId, julianDay: 3, positions: new Float32Array([3]), positions3D: new Float32Array([3]) })
    expect(results).toEqual([1, 3])
  })

  it('recovers from a send failure instead of staying busy', () => {
    const errors: string[] = []
    const scheduler = createCatalogPointWorkerScheduler(() => { throw new Error('worker closed') }, {
      onProgress: () => undefined, onResult: () => undefined, onError: (message) => errors.push(message),
    })
    scheduler.setElements(new Float64Array(8))
    scheduler.requestJulianDay(1)
    expect(errors).toEqual(['worker closed'])
  })

  it('resets the worker dataset before a later record set is initialized', () => {
    const { sent, scheduler } = harness()
    scheduler.setElements(new Float64Array(8))
    scheduler.reset()
    expect(sent.map(request => request.type)).toEqual(['initialize', 'reset'])
    scheduler.setElements(new Float64Array(16))
    expect(sent.map(request => request.type)).toEqual(['initialize', 'reset', 'initialize'])
  })
})
