import { expect, test } from 'vitest'
import { createTrajectoryRecorder } from '../../src/engine/dynamics/trajectorySamples'

const sample = (time: number) => ({ elapsedTdbSeconds: time, stateKmKmPerSecond: [time, 0, 0, 1, 0, 0], heliocentricPositionKm: [time, 0, 0] })
for (const sign of [1, -1]) test(`bounded actual-node selection preserves endpoints in direction ${sign}`, () => {
  const recorder = createTrajectoryRecorder(sample(0), 64)
  for (let i = 1; i <= 10003; i++) recorder.accept(() => sample(sign*i))
  const result = recorder.finish(sample(sign*10003))
  expect(result.samples.length).toBeLessThanOrEqual(64)
  expect(result.samples[0].elapsedTdbSeconds).toBe(0)
  expect(result.samples[result.samples.length-1].elapsedTdbSeconds).toBe(sign*10003)
  expect(result.acceptedSteps).toBe(10003)
  expect(result.acceptedStepIndices).toEqual(result.samples.map(point => Math.abs(point.elapsedTdbSeconds)))
  expect(result.samples.slice(0, -1).every(point => Math.abs(point.elapsedTdbSeconds) % result.stride === 0)).toBe(true)
  expect(result.samples.every((point, i) => i === 0 || sign*(point.elapsedTdbSeconds-result.samples[i-1].elapsedTdbSeconds) > 0)).toBe(true)
})
test('zero-duration sampling is not duplicated and invalid capacity is rejected', () => {
  expect(createTrajectoryRecorder(sample(0)).finish(sample(0)).samples).toHaveLength(1)
  expect(() => createTrajectoryRecorder(sample(0), 3)).toThrow()
})
