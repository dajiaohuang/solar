import { describe, expect, it } from 'vitest'
import { evaluateType17 } from '../../src/engine/ephemeris/spkType17'
import oracle from '../fixtures/spk17-cspice.json'

describe('SPK Type 17 CSPICE oracle', () => {
  it('matches EQNCPV for nonzero inclination and precession', () => {
    for (const sample of oracle.samples) {
      const s = evaluateType17(address => oracle.elements[address - 1], 1, sample.et)
      const actual = [...Object.values(s.position), ...Object.values(s.velocity)]
      // The ±1e9 s samples intentionally exercise many revolutions; trig
      // argument reduction limits absolute agreement to sub-micro precision.
      sample.state.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6))
    }
  })
})
