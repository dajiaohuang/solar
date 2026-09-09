import { describe, expect, it, vi } from 'vitest'
import { createBackendTrajectoryQueue, type BackendTrajectoryJob } from '../../src/lib/backendTrajectoryQueue'
import type { BackendTrajectoryResult } from '../../src/lib/backendTrajectories'

const job = (requestId: number) => ({ requestId, centerUtcJd: requestId }) as BackendTrajectoryJob
const result = {} as BackendTrajectoryResult
function harness() {
  const runs: { id: number; signal: AbortSignal; resolve: (result: BackendTrajectoryResult) => void; reject: (error: Error) => void; progress: (value: number) => void }[] = []
  const callbacks = { progress: vi.fn(), result: vi.fn(), error: vi.fn() }
  const queue = createBackendTrajectoryQueue((job, signal, progress) => new Promise((resolve, reject) => runs.push({ id: job.requestId, signal, resolve, reject, progress })), callbacks)
  return { runs, callbacks, queue }
}

describe('latest desired backend history queue', () => {
  it('finishes the active epoch and coalesces a thousand clock updates into one latest job', async () => {
    const { runs, callbacks, queue } = harness()
    queue.submit(job(1))
    for (let index = 2; index <= 1000; index++) queue.submit(job(index))
    expect(runs.map(run => run.id)).toEqual([1]); expect(runs[0].signal.aborted).toBe(false)
    runs[0].progress(.5); expect(callbacks.progress).toHaveBeenCalledWith(1, .5)
    runs[0].resolve(result)
    await vi.waitFor(() => expect(runs.map(run => run.id)).toEqual([1, 1000]))
    expect(callbacks.result).toHaveBeenCalledWith(1, result)
    runs[1].resolve(result)
    await vi.waitFor(() => expect(callbacks.result).toHaveBeenCalledWith(1000, result))
  })
  it('disposes the active transport and pending job, suppressing all late callbacks', async () => {
    const { runs, callbacks, queue } = harness()
    queue.submit(job(1)); queue.submit(job(2)); queue.dispose(); queue.submit(job(3))
    expect(runs[0].signal.aborted).toBe(true)
    runs[0].progress(1); runs[0].resolve(result); await Promise.resolve()
    expect(callbacks.result).not.toHaveBeenCalled(); expect(callbacks.progress).not.toHaveBeenCalled()
    expect(callbacks.error).not.toHaveBeenCalled(); expect(runs).toHaveLength(1)
  })
  it('reports a failed window without losing the latest pending epoch', async () => {
    const { runs, callbacks, queue } = harness()
    queue.submit(job(1)); queue.submit(job(2)); runs[0].reject(new Error('network failure'))
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    expect(callbacks.error).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'network failure' }))
    expect(callbacks.result).not.toHaveBeenCalled()
    runs[1].resolve(result); await vi.waitFor(() => expect(callbacks.result).toHaveBeenCalledWith(2, result))
  })
})
