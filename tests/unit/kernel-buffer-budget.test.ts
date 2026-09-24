import { expect, it } from 'vitest'
import { reserveKernelBuffers } from '../../src/engine/ephemeris/kernelBufferBudget'

it('enforces the shared raw-kernel reservation ceiling and releases idempotently', () => {
  const release = reserveKernelBuffers(512 * 1024 * 1024)
  expect(() => reserveKernelBuffers(1)).toThrow('512 MiB')
  release()
  release()
  const retry = reserveKernelBuffers(512 * 1024 * 1024)
  retry()
})

it('rejects invalid reservation sizes', () => {
  for (const size of [-1, 0.5, NaN, Infinity]) {
    expect(() => reserveKernelBuffers(size)).toThrow('Invalid ephemeris buffer reservation')
  }
})
