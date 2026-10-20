import { expect, test } from 'vitest'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { cartesianStatesFromSourceOffsets } from '../../src/engine/ephemeris/covarianceStateSamples'
import { checkEnsembleInitialReceipt } from '../../src/lib/ensembleInitialReceipt'
import eros from '../fixtures/sbdb-eros-covariance.json'

const source = parseSbdbCovariance(eros)
const adopted = { au3PerDay2: 0.00029591220828411956, source: 'Fixed receipt test GM' }
const offsets = new Float64Array(12)

test('binds ensemble initial states, validity and GM to the source conversion', async () => {
  const initial = await cartesianStatesFromSourceOffsets(source, adopted, offsets)
  await expect(checkEnsembleInitialReceipt(source, initial, offsets, adopted)).resolves.toBeUndefined()

  const changedState = { ...initial, states: initial.states.slice() }
  changedState.states[0] += 1e-9
  await expect(checkEnsembleInitialReceipt(source, changedState, offsets, adopted)).rejects.toThrow('initial states')

  const changedGm = { ...initial, adoptedSolarGM: { ...initial.adoptedSolarGM, au3PerDay2: adopted.au3PerDay2 * 2 } }
  await expect(checkEnsembleInitialReceipt(source, changedGm, offsets, adopted)).rejects.toThrow('adopted solar GM')

  const changedValidity = { ...initial, valid: initial.valid.slice() }
  changedValidity.valid[0] = 0
  await expect(checkEnsembleInitialReceipt(source, changedValidity, offsets, adopted)).rejects.toThrow('validity')
})

test('cancels source reconstruction between bounded draw batches', async () => {
  const manyOffsets = new Float64Array(128*6)
  const initial = await cartesianStatesFromSourceOffsets(source, adopted, manyOffsets)
  const controller = new AbortController(), reason = new DOMException('cancel validation','AbortError')
  const pending = checkEnsembleInitialReceipt(source, initial, manyOffsets, adopted, controller.signal)
  setTimeout(() => controller.abort(reason),0)
  await expect(pending).rejects.toBe(reason)
})
