import { describe, expect, it } from 'vitest'
import { CatalogAdmission } from '../../src/data/cache/catalogAdmission'

describe('catalog artifact admission', () => {
  it('bounds a burst, keeps FIFO order and makes each release idempotent', async () => {
    const admission = new CatalogAdmission(2)
    const releaseA = await admission.acquire(), releaseB = await admission.acquire(), order: string[] = []
    const pendingC = admission.acquire().then(release => { order.push('C'); return release })
    const pendingD = admission.acquire().then(release => { order.push('D'); return release })
    await Promise.resolve()
    expect(order).toEqual([])
    releaseA()
    releaseA()
    const releaseC = await pendingC
    expect(order).toEqual(['C'])
    releaseB()
    const releaseD = await pendingD
    expect(order).toEqual(['C', 'D'])
    releaseC(); releaseD()
  })

  it('removes a cancelled waiter immediately without consuming a later slot', async () => {
    const admission = new CatalogAdmission(1), release = await admission.acquire(), controller = new AbortController()
    const cancelled = expect(admission.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const later = admission.acquire()
    controller.abort()
    await cancelled
    release()
    ;(await later)()
    await expect(admission.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps an already admitted lease until its owner releases it after cancellation', async () => {
    const admission = new CatalogAdmission(1), controller = new AbortController()
    const release = await admission.acquire(controller.signal)
    controller.abort()
    let started = false
    const later = admission.acquire().then(next => { started = true; return next })
    await Promise.resolve()
    expect(started).toBe(false)
    release()
    ;(await later)()
    expect(started).toBe(true)
  })
})
