import { expect, it } from 'vitest'
import { MAX_KERNEL_BUFFER_BYTES, reserveKernelBuffers } from '../../src/engine/ephemeris/kernelBufferBudget'

it('enforces the shared raw-kernel reservation ceiling and releases idempotently', () => {
  const release = reserveKernelBuffers(MAX_KERNEL_BUFFER_BYTES)
  expect(() => reserveKernelBuffers(1)).toThrow('768 MiB')
  release()
  release()
  const retry = reserveKernelBuffers(MAX_KERNEL_BUFFER_BYTES)
  retry()
})

it('rejects invalid reservation sizes', () => {
  for (const size of [-1, 0.5, NaN, Infinity]) {
    expect(() => reserveKernelBuffers(size)).toThrow('Invalid ephemeris buffer reservation')
  }
})
