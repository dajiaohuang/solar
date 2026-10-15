import { expect, it } from 'vitest'
import { CASSINI_GRAND_FINALE, MESSENGER_FINAL_ORBIT, validateSpacecraftOriginArc } from '../../scripts/lib/spacecraft-source-sets.mjs'

it('accepts each mission at its reviewed center and rejects cross-mission centers', () => {
  for (const contract of [CASSINI_GRAND_FINALE, MESSENGER_FINAL_ORBIT]) {
    const segment = { target: contract.target, center: contract.center, frame: 1, type: 1, startEt: 0, endEt: 100 }
    expect(() => validateSpacecraftOriginArc([segment], contract, 1, 99)).not.toThrow()
    expect(() => validateSpacecraftOriginArc([{ ...segment, center: contract.center === 1 ? 6 : 1 }], contract, 1, 99)).toThrow('center')
    expect(() => validateSpacecraftOriginArc([{ ...segment, frame: 17 }], contract, 1, 99)).toThrow('J2000')
    expect(() => validateSpacecraftOriginArc([], contract, 1, 99)).toThrow('reconstruction')
  }
})

it('requires one continuous final MESSENGER arc for the requested interval', () => {
  const segment = { target: -236, center: 1, frame: 1, type: 1, startEt: 0, endEt: 50 }
  expect(() => validateSpacecraftOriginArc([segment, { ...segment, startEt: 50, endEt: 100 }], MESSENGER_FINAL_ORBIT, 1, 99)).toThrow('final')
})
