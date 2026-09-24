import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'

let dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>
beforeAll(async () => {
  const bytes = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
  dynamics = await createDe440Dynamics({ spkBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    gmText: readFileSync('src/data/gm_de440.tpc', 'utf8'), referenceEpochTdb: 2460000,
    elapsedRangeSeconds: [-1, 1], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
})

test('equivalent cancelling elapsed-time pairs preserve the reference epoch', () => {
  expect(dynamics.epochParts(1e20, -1e20)).toEqual(dynamics.epochParts(0))
  expect(dynamics.stateAtOffset(399, 1e20, -1e20)).toEqual(dynamics.state(399, 0))
})

test('low parts participate in cache identity and source-window checks', () => {
  const low = 1e-8, parts = dynamics.epochParts(0, low)
  expect(parts[0] + low).toBe(parts[0])
  expect(parts[1]).toBe(low)
  const plain = dynamics.state(399), shifted = dynamics.stateAtOffset(399, 0, low)
  expect(shifted).not.toEqual(plain)
  expect(dynamics.state(399)).toEqual(plain)
  expect(dynamics.stateAtOffset(399, 0, low)).toEqual(shifted)
  expect(() => dynamics.stateAtOffset(399, 1, low)).toThrow('window')
  expect(() => dynamics.stateAtOffset(399, -1, -low)).toThrow('window')
  expect(() => dynamics.stateAtOffset(399, 1, -low)).not.toThrow()
})
