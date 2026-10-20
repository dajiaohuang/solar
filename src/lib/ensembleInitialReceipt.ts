import type { SbdbCovariance } from '../data/loaders/sbdbCovariance.ts'
import { cartesianStatesFromSourceOffsets } from '../engine/ephemeris/covarianceStateSamples.ts'
import type { AdoptedSolarGM } from '../engine/ephemeris/orbitCovariance.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed ensemble initial-state receipt')
  return value as Record<string, unknown>
}

function sameFloat64(actual: unknown, expected: Float64Array, name: string) {
  if (!(actual instanceof Float64Array) || actual.length !== expected.length) throw new Error(`Ensemble ${name} shape differs from source reconstruction`)
  for (let index = 0; index < expected.length; index++) {
    if (!Object.is(actual[index], expected[index])) throw new Error(`Ensemble ${name} differs from source reconstruction`)
  }
}

/** Rebind every initial draw to the submitted source parameters and sampled offsets.
 * This is same-runtime source consistency, not an independent orbit oracle. */
export async function checkEnsembleInitialReceipt(source: SbdbCovariance, value: unknown, offsets: Float64Array, adopted: AdoptedSolarGM, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const actual = record(value)
  const expected = await cartesianStatesFromSourceOffsets(source, adopted, offsets, signal)
  signal?.throwIfAborted()
  if (actual.count !== expected.count || actual.dimension !== expected.dimension) throw new Error('Ensemble initial draw shape differs from source reconstruction')
  const gm = record(actual.adoptedSolarGM)
  if (Object.keys(gm).length !== 2 || gm.au3PerDay2 !== expected.adoptedSolarGM.au3PerDay2 || gm.source !== expected.adoptedSolarGM.source) {
    throw new Error('Ensemble adopted solar GM differs from source reconstruction')
  }
  sameFloat64(actual.offsets, expected.offsets, 'initial offsets')
  sameFloat64(actual.states, expected.states, 'initial states')
  sameFloat64(actual.additionalValues, expected.additionalValues, 'additional values')
  if (!(actual.valid instanceof Uint8Array) || actual.valid.length !== expected.valid.length ||
      actual.valid.some((valid, index) => valid !== expected.valid[index])) throw new Error('Ensemble initial validity differs from source reconstruction')
  if (JSON.stringify(actual.failures) !== JSON.stringify(expected.failures)) throw new Error('Ensemble initial failures differ from source reconstruction')
}
