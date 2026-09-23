import { expect, test } from 'vitest'
import { tcbToTdb, tdbToTcb } from '../../src/engine/ephemeris/barycentricTime'
import reference from '../fixtures/barycentric-time-reference.json'

test.each(reference.cases)('$direction at $input.day + $input.fraction agrees with ERFA', sample => {
  const convert = sample.direction === 'tcbtdb' ? tcbToTdb : tdbToTcb
  const inverse = sample.direction === 'tcbtdb' ? tdbToTcb : tcbToTdb
  const result=convert(sample.input), expected=sample.expectedParts
  expect(Math.abs((result.day-expected[0])+(result.fraction-expected[1]))*86400).toBeLessThan(3e-10)
  expect(result.fraction).toBeGreaterThanOrEqual(0)
  expect(result.fraction).toBeLessThan(1)
  const restored=inverse(result)
  expect(Math.abs((restored.day-sample.input.day)+(restored.fraction-sample.input.fraction))*86400).toBeLessThan(3e-10)
})
test('retains the defining nonzero offset and rejects noncanonical input', () => {
  const origin={day:2443144,fraction:.5003725}, result=tcbToTdb(origin)
  expect(((result.day-origin.day)+(result.fraction-origin.fraction))*86400).toBeCloseTo(-.0000655,10)
  for (const date of [{day:NaN,fraction:0},{day:2457389.5,fraction:0},{day:2457389,fraction:1},{day:2457389,fraction:-.1}]) {
    expect(()=>tcbToTdb(date)).toThrow(); expect(()=>tdbToTcb(date)).toThrow()
  }
})
