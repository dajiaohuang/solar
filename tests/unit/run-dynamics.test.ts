import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { runDynamicsFile } from '../../scripts/run-dynamics.mjs'
import reference from '../fixtures/de440-dynamics-reference.json'
import relativistic from '../fixtures/de440-solar-1pn-reference.json'

test('offline experiment exports exact source/implementation evidence and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-dynamics-'))
  const input = join(directory, 'initial.json'), output = join(directory, 'receipt.json')
  await writeFile(input, JSON.stringify({ schemaVersion: 1, frame: 'J2000', origin: 'SSB', timeScale: 'TDB',
    referenceEpochTdb: reference.referenceEpochTdb, initial: reference.initial,
    initialSource: 'Pinned CSPICE Eros reference', sourceFiles: reference.sources }))
  const options = { durationSeconds: 864000, exclusionKm: 1, compareRefinement: true }
  await runDynamicsFile(input, output, options)
  const bytes = await readFile(output, 'utf8'), receipt = JSON.parse(bytes)
  expect(receipt.forceModel.masses).toHaveLength(11)
  expect(receipt.forceModel.solarRelativity).toBeNull()
  expect(receipt.transitionMatrix.values).toHaveLength(36)
  expect(receipt.trajectory.samples[0].stateKmKmPerSecond).toEqual(reference.initial)
  expect(receipt.trajectory.samples.at(-1).stateKmKmPerSecond).toEqual(receipt.finalStateKmKmPerSecond)
  expect(receipt.trajectory.retainedNodes).toBeLessThanOrEqual(2048)
  expect(receipt.trajectory.samples.every((sample: { osculating: { eccentricity: number } | null }) => sample.osculating && Number.isFinite(sample.osculating.eccentricity))).toBe(true)
  expect(receipt.diagnostics.frame).toBe('J2000')
  expect(receipt.implementationSha256['src/engine/ephemeris/osculating.ts']).toMatch(/^[a-f0-9]{64}$/)
  expect(receipt.refinement.relativeTolerance).toBe(1e-13)
  expect(receipt.refinement.endpointPositionDifferenceKm).toBeLessThan(1e-4)
  expect(receipt.finalEpoch.elapsedTdbSeconds).toBe(options.durationSeconds)
  expect(receipt.initialFile.payload.sourceFiles).toEqual(reference.sources)
  expect(receipt.implementationSha256['src/engine/dynamics/adaptiveIntegrator.ts']).toMatch(/^[a-f0-9]{64}$/)
  const target = reference.cases.find(row => row.duration === options.durationSeconds)!
  expect(Math.hypot(...receipt.finalStateKmKmPerSecond.slice(0, 3).map((value: number, i: number) => value-target.result[i]))).toBeLessThan(1e-4)
  await expect(runDynamicsFile(input, output, options)).rejects.toMatchObject({ outputPublished: false, cause: { code: 'EEXIST' } })
  expect(await readFile(output, 'utf8')).toBe(bytes)
  await expect(runDynamicsFile(input, join(directory, 'cancelled.json'), { ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  const correctedPath = join(directory, 'solar-1pn.json')
  await runDynamicsFile(input, correctedPath, { ...options, solarRelativity: true })
  const corrected = JSON.parse(await readFile(correctedPath, 'utf8'))
  expect(corrected.calculation).toBe('restricted-de440-solar-1pn-experiment')
  expect(corrected.forceModel.solarRelativity.speedOfLightKmPerSecond).toBe(299792.458)
  expect(corrected.implementationSha256['src/engine/dynamics/solarRelativity.ts']).toMatch(/^[a-f0-9]{64}$/)
  const independent = relativistic.cases.find(row => row.duration === options.durationSeconds)!
  expect(Math.hypot(...corrected.finalStateKmKmPerSecond.slice(0, 3).map((value: number, i: number) => value-independent.result[i]))).toBeLessThan(1e-4)
  expect(corrected.refinement.endpointPositionDifferenceKm).toBeLessThan(1e-4)
})

test('SRP requires explicit adoption and exports exact parameters and implementation hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-dynamics-srp-'))
  const input = join(directory, 'initial.json'), output = join(directory, 'receipt.json')
  const solarRadiationPressure = { model: 'constant-radial-srp', illumination: 'unshadowed',
    pressureAt1AuNewtonPerSquareMeter: 4.56e-6, areaSquareMeters: 20, massKg: 1000,
    reflectivityCoefficient: 1.5, source: 'Synthetic properties; no observed spacecraft claim' }
  const source = { schemaVersion: 1, frame: 'J2000', origin: 'SSB', timeScale: 'TDB',
    referenceEpochTdb: reference.referenceEpochTdb, initial: reference.initial,
    initialSource: 'Pinned Eros state with explicitly synthetic radiation pressure properties', solarRadiationPressure }
  await writeFile(input, JSON.stringify(source))
  const options = { durationSeconds: 86400, exclusionKm: 1 }
  await expect(runDynamicsFile(input, output, options)).rejects.toThrow('explicit adoption')
  await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  await runDynamicsFile(input, output, { ...options, adoptSolarRadiationPressure: true, solarRelativity: true, compareRefinement: true })
  const receipt = JSON.parse(await readFile(output, 'utf8'))
  expect(receipt.forceModel.model).toBe('restricted-newtonian-plus-solar-1pn-and-radial-srp')
  expect(receipt.forceModel.solarRadiationPressure.parameters).toEqual(solarRadiationPressure)
  expect(receipt.initialFile.payload).toEqual(source)
  expect(JSON.parse(Buffer.from(receipt.initialFile.originalBase64, 'base64').toString('utf8'))).toEqual(source)
  expect(receipt.refinement.endpointPositionDifferenceKm).toBeLessThan(1e-4)
  expect(receipt.trajectory.acceptedStepIndices[0]).toBe(0)
  expect(receipt.trajectory.acceptedStepIndices.at(-1)).toBe(receipt.numerics.accepted)
  expect(receipt.implementationSha256['src/engine/dynamics/sampleFailure.ts']).toMatch(/^[a-f0-9]{64}$/)
  expect(receipt.implementationSha256['src/engine/dynamics/solarRadiationPressure.ts']).toMatch(/^[a-f0-9]{64}$/)
  for (const [path, hash] of Object.entries(receipt.implementationSha256)) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(hash)
  }
  const unconfigured = { ...source, solarRadiationPressure: undefined }
  await writeFile(input, JSON.stringify(unconfigured))
  await expect(runDynamicsFile(input, join(directory, 'missing-parameters.json'), { ...options, adoptSolarRadiationPressure: true })).rejects.toThrow('explicit adoption')
})
