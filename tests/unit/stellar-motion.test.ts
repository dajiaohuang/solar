import { describe, expect, it, vi } from 'vitest'
import experiment from '../fixtures/gaia-motion-experiment.json'
import covarianceExperiment from '../fixtures/gaia-motion-covariance-experiment.json'
import { loadStellarMotion, stellarSourceBase64, validateStellarMotion, type StellarMotionRequest } from '../../src/lib/stellarMotion'
import { STATE_TILE_API_VERSION } from '../../src/lib/stateTiles'
import { selectedGaiaCsvSource } from '../../src/lib/gaiaCsvSource'
const request: StellarMotionRequest = { originalManifestBase64: experiment.originalManifestBase64, originalRowsCsvBase64: experiment.originalRowsCsvBase64, sourceId: experiment.result.sourceId, targetEpochJulianYearTCB: 2026, radialVelocityPolicy: 'spectroscopic-as-astrometric' }
const envelope = () => ({ apiVersion: STATE_TILE_API_VERSION, experiment: structuredClone(experiment) })
describe('original-source stellar client', () => {
  it('validates optional covariance against source errors and the Jacobian transform', async () => {
    const covarianceRequest: StellarMotionRequest = { ...request, covariancePolicy:'independent-spectroscopic-rv' }
    const wire = () => ({ apiVersion:STATE_TILE_API_VERSION, experiment:structuredClone(covarianceExperiment) })
    expect(await validateStellarMotion(wire(), covarianceRequest)).toEqual(covarianceExperiment)
    await expect(validateStellarMotion(envelope(), covarianceRequest)).rejects.toThrow()
    await expect(validateStellarMotion(wire(), request)).rejects.toThrow()
    const changes = [
      (c: typeof covarianceExperiment.formalCovariance) => { c.inputMatrix[0][0] *= 2 },
      (c: typeof covarianceExperiment.formalCovariance) => { c.outputMatrix[0][0] *= 2 },
      (c: typeof covarianceExperiment.formalCovariance) => { c.jacobian[0][3] += 1 },
      (c: typeof covarianceExperiment.formalCovariance) => { c.coordinateLabels[5] = 'pseudocolour' },
      (c: typeof covarianceExperiment.formalCovariance) => { c.policy = 'unknown' },
      (c: typeof covarianceExperiment.formalCovariance) => { c.targetEpochJulianYearTCB++ },
      (c: typeof covarianceExperiment.formalCovariance) => { c.outputMatrix[0][1] += 1 },
      (c: typeof covarianceExperiment.formalCovariance) => { c.maxScaledDerivativeDifference = 1 },
    ]
    for (const change of changes) { const value = wire(); change(value.experiment.formalCovariance); await expect(validateStellarMotion(value,covarianceRequest)).rejects.toThrow() }
  })
  it('accepts the real Go experiment and preserves byte encoding', async () => {
    expect(await validateStellarMotion(envelope(), request)).toEqual(experiment)
    const bytes = Uint8Array.from(atob(request.originalRowsCsvBase64), v => v.charCodeAt(0))
    expect(stellarSourceBase64(bytes, 8 << 20)).toBe(request.originalRowsCsvBase64)
    expect(() => stellarSourceBase64(bytes, 1)).toThrow('budget')
  })
  it('rejects wrong source, epoch, hashes, model, nonfinite states and missing limits', async () => {
    const mutations = [
      (e: typeof experiment) => { e.result.sourceId = '1' },
      (e: typeof experiment) => { e.result.targetEpochJulianYearTCB = 2027 },
      (e: typeof experiment) => { e.rowsSha256 = '0'.repeat(64) },
      (e: typeof experiment) => { e.originalRowsCsvBase64 += 'AAAA' },
      (e: typeof experiment) => { e.result.model = 'unknown' },
      (e: typeof experiment) => { e.result.stateTCBCompatible.raDeg = NaN },
      (e: typeof experiment) => { e.result.limitations = [] },
      (e: typeof experiment) => { e.selectedSource.pmra += 1 },
      (e: typeof experiment) => { e.selectedSource.radial_velocity = 0 },
    ]
    for (const mutate of mutations) { const wire = envelope(); mutate(wire.experiment); await expect(validateStellarMotion(wire, request)).rejects.toThrow() }
  })
  it('reads quoted original values and rejects ambiguous or missing identities', async () => {
    const parse = (csv: string) => selectedGaiaCsvSource(new TextEncoder().encode(csv), '65212004581252736')
    expect(await parse('source_id,ra,pmra\r\n"65212004581252736","56.2",\r\n')).toEqual({ source_id:'65212004581252736', ra:56.2, pmra:null })
    for (const csv of ['source_id,ra\n1,5\n', 'source_id,ra\n65212004581252736,5\n65212004581252736,6\n', 'source_id,ra\n65212004581252736,"5"x\n', 'source_id,ra\n65212004581252736,"5\n', 'source_id,ra\n65212004581252736,0x10\n']) await expect(parse(csv)).rejects.toThrow()
  })
  it('yields during a long source scan and cancels before publishing', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const csv = new TextEncoder().encode('source_id,ra\n65212004581252736,1\n2,' + '0'.repeat(100000) + '\n')
      let settled = false
      const pending = selectedGaiaCsvSource(csv, '65212004581252736', controller.signal)
      const rejected = expect(pending).rejects.toThrow('stop scan')
      void pending.then(() => { settled = true }, () => { settled = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      controller.abort(new Error('stop scan'))
      await vi.runAllTimersAsync()
      await rejected
      expect(settled).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('bounds HTTP, checks response identity and refuses pre-cancelled work', async () => {
    const body = JSON.stringify(envelope())
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type':'application/json', 'Content-Length': String(new TextEncoder().encode(body).length) } }))
    expect(await loadStellarMotion('/api', request, new AbortController().signal, fetcher)).toEqual(experiment)
    expect(fetcher.mock.calls).toHaveLength(1)
    const controller = new AbortController(); controller.abort()
    await expect(loadStellarMotion('/api', request, controller.signal, fetcher)).rejects.toThrow()
    expect(fetcher.mock.calls).toHaveLength(1)
    await expect(loadStellarMotion('/api', { ...request, targetEpochJulianYearTCB: 2117 }, new AbortController().signal, fetcher)).rejects.toThrow()
  })
})
