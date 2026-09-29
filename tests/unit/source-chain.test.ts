import { expect, it } from 'vitest'
import { sourceChainSha256 } from '../../scripts/lib/source-chain.mjs'

it('uses the shared byte layout and binds every selected segment field', () => {
  const segment = { kernelId: 'fixture', kernelSha256: '0123456789abcdef'.repeat(4),
    target: -1, center: 0, frame: 17, type: 2, startEt: -0.5, endEt: 1.25 }
  const digest = sourceChainSha256([segment])
  expect(digest).toBe('8d54a3ecfe026612be307e8bb4926acaeb9ccf22ebb2e8f0fc6553a02d2df338')
  expect(sourceChainSha256([{ ...segment, type: 3 }])).not.toBe(digest)
  expect(sourceChainSha256([])).toMatch(/^[a-f0-9]{64}$/)
})

it('rejects malformed identities, hashes, and intervals', () => {
  const segment = { kernelId: 'fixture', kernelSha256: '0123456789abcdef'.repeat(4),
    target: -1, center: 0, frame: 17, type: 2, startEt: -0.5, endEt: 1.25 }
  expect(() => sourceChainSha256([{ ...segment, kernelSha256: 'bad' }])).toThrow('Invalid')
  expect(() => sourceChainSha256([{ ...segment, kernelSha256: `${segment.kernelSha256}0` }])).toThrow('Invalid')
  expect(() => sourceChainSha256([{ ...segment, endEt: -1 }])).toThrow('Invalid')
})
