import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachStateTileAdmission, createStateTileAdmissionPool, createWorkerTileAdmission, serveStateTileAdmission, stateTileAdmissionSnapshot } from '../../src/lib/stateTileAdmission'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0)) close() })
const signal = () => new AbortController().signal
function endpoint(pool: ReturnType<typeof createStateTileAdmissionPool>) {
  const channel = new MessageChannel(), detach = serveStateTileAdmission(channel.port1, pool)
  const worker = createWorkerTileAdmission(channel.port2)
  cleanup.push(() => { worker.dispose(); detach() })
  return { worker, detach }
}

describe('page-wide state-tile admission', () => {
  it('has two FIFO permits, rejects a full queue before work and releases each lease only once', async () => {
    const pool = createStateTileAdmissionPool(2, 2)
    const first = await pool.acquire(signal()), second = await pool.acquire(signal())
    const order: number[] = []
    const third = pool.acquire(signal()).then(release => { order.push(3); return release })
    const fourth = pool.acquire(signal()).then(release => { order.push(4); return release })
    await expect(pool.acquire(signal())).rejects.toThrow(/queue is full/)
    expect(pool.snapshot()).toEqual({ capacity: 2, maxQueued: 2, active: 2, queued: 2, peakActive: 2, admitted: 2, rejected: 1 })
    first(); first()
    const releaseThird = await third
    expect(order).toEqual([3]); expect(pool.snapshot().active).toBe(2)
    second(); const releaseFourth = await fourth
    expect(order).toEqual([3, 4]); expect(pool.snapshot().queued).toBe(0)
    releaseThird(); releaseFourth(); expect(pool.snapshot().active).toBe(0)
  })

  it('cancels queued work without releasing a permit held by an active transport', async () => {
    const pool = createStateTileAdmissionPool(1, 1), active = new AbortController(), queued = new AbortController()
    const release = await pool.acquire(active.signal)
    const pending = pool.acquire(queued.signal), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    queued.abort(); await rejected
    active.abort() // The transport must finish its own finally block before releasing.
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 0 })
    release(); expect(pool.snapshot().active).toBe(0)
    await expect(pool.acquire(queued.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(pool.snapshot().admitted).toBe(1)
  })

  it('coordinates independent worker MessagePorts and preserves FIFO fairness across their tile streams', async () => {
    const pool = createStateTileAdmissionPool(), current = endpoint(pool), history = endpoint(pool)
    const currentFirst = await current.worker.acquire(signal()), currentSecond = await current.worker.acquire(signal())
    const historyFirst = history.worker.acquire(signal()), historySecond = history.worker.acquire(signal())
    await vi.waitFor(() => expect(pool.snapshot().queued).toBe(2))
    const currentNext = current.worker.acquire(signal())
    await vi.waitFor(() => expect(pool.snapshot().queued).toBe(3))
    currentFirst(); currentSecond()
    const releases = await Promise.all([historyFirst, historySecond])
    expect(pool.snapshot()).toMatchObject({ active: 2, queued: 1, peakActive: 2, admitted: 4 })
    releases.forEach(release => release())
    const finish = await currentNext; finish()
    await vi.waitFor(() => expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, peakActive: 2, admitted: 5 }))
  })

  it('reclaims active and queued permits from a terminated worker without touching the surviving worker', async () => {
    const pool = createStateTileAdmissionPool(), retired = endpoint(pool), live = endpoint(pool)
    await retired.worker.acquire(signal()); await retired.worker.acquire(signal())
    const obsolete = retired.worker.acquire(signal()), rejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    const surviving = live.worker.acquire(signal())
    await vi.waitFor(() => expect(pool.snapshot().queued).toBe(2))
    retired.worker.dispose(); retired.detach(); retired.detach()
    await rejected
    const release = await surviving
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 0, peakActive: 2 })
    release(); await vi.waitFor(() => expect(pool.snapshot().active).toBe(0))
    await expect(retired.worker.acquire(signal())).rejects.toThrow(/closed/)
  })

  it('returns a late grant after cancellation instead of starting work or leaking capacity', async () => {
    const channel = new MessageChannel(), requests: { type: string; id: number }[] = []
    channel.port1.onmessage = event => requests.push(event.data)
    const worker = createWorkerTileAdmission(channel.port2)
    cleanup.push(() => { worker.dispose(); channel.port1.close() })
    const controller = new AbortController(), pending = worker.acquire(controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(requests).toEqual([{ type: 'acquire', id: 1 }]))
    controller.abort(); await rejected
    channel.port1.postMessage({ type: 'granted', id: 1 })
    await vi.waitFor(() => expect(requests.map(request => request.type)).toEqual(['acquire', 'cancel', 'release']))
  })

  it('reports backpressure to a worker without admitting its request', async () => {
    const pool = createStateTileAdmissionPool(1, 0), first = endpoint(pool), second = endpoint(pool)
    const release = await first.worker.acquire(signal())
    await expect(second.worker.acquire(signal())).rejects.toThrow(/queue is full/)
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 0, admitted: 1, rejected: 1 })
    release(); await vi.waitFor(() => expect(pool.snapshot().active).toBe(0))
  })

  it('attaches production workers to the same page pool, transfers only their port and detaches cleanly', async () => {
    const ports: MessagePort[] = []
    const postMessage = vi.fn((message: { type: string; port: MessagePort }, transfer: Transferable[]) => {
      expect(message.type).toBe('init-tile-admission')
      expect(transfer).toEqual([message.port])
      ports.push(structuredClone(message, { transfer }).port)
    })
    const first = attachStateTileAdmission({ postMessage } as Pick<Worker, 'postMessage'>)
    const second = attachStateTileAdmission({ postMessage } as Pick<Worker, 'postMessage'>)
    const current = createWorkerTileAdmission(ports[0]), history = createWorkerTileAdmission(ports[1])
    cleanup.push(() => { current.dispose(); history.dispose(); first(); second() })
    const a = await current.acquire(signal()), b = await history.acquire(signal())
    const pending = history.acquire(signal())
    await vi.waitFor(() => expect(stateTileAdmissionSnapshot()).toMatchObject({ active: 2, queued: 1 }))
    a(); const c = await pending; b(); c()
    await vi.waitFor(() => expect(stateTileAdmissionSnapshot()).toMatchObject({ active: 0, queued: 0, peakActive: 2 }))
  })
})
