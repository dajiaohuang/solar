import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/sbdb-eros-covariance.json'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'

const clone = () => structuredClone(fixture)
const identity = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => String(i === j ? 1 : 0)))

describe('SBDB solution-epoch covariance', () => {
  it('retains the real Bennu density and radiation-pressure axes in covariance label order', () => {
    const bytes = readFileSync(new URL('../fixtures/sbdb-bennu-covariance.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('8cc7ff03d7fec9e15016d7ab0e78edc7a0e4d69227a322cde7190518a24ccb90')
    const result = parseSbdbCovariance(bennu)
    expect(result).toMatchObject({ designation: '101955', solutionId: '118', solutionEpochTdb: 2455562.5,
      additionalParameters: ['RHO', 'AMRAT'], positiveDefinite: true })
    // Source model_pars is ordered AMRAT, RHO; matrix labels say RHO, AMRAT.
    expect(result.nominal.slice(6)).toEqual([1191.534909615045, 2.635943157e-6])
    expect(result.units.slice(6)).toEqual(['kg/m^3', 'm^2/kg'])
    const reference = [0.00037979939641585424, 0.004625266334356518, 0.06429749689020275,
      0.29700898943633025, 0.6702390826376546, 1.021045063767839, 1.7852505347521974, 4.157153766785008]
    result.correlationEigenvalues.forEach((value, i) => expect(Math.abs(value - reference[i])).toBeLessThan(2e-14))
    result.matrix.forEach((row, i) => row.forEach((value, j) => expect(value).toBe(Number(bennu.orbit.covariance.data[i][j]))))
  })

  it('retains the pinned response and agrees with independent NumPy correlation eigenvalues', () => {
    const bytes = readFileSync(new URL('../fixtures/sbdb-eros-covariance.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('2557ca13a0942cdeab300a7268b9ba41fd9f2980c20b66e78cf49f36794c6590')
    const before = JSON.stringify(fixture), result = parseSbdbCovariance(fixture)
    expect(JSON.stringify(fixture)).toBe(before)
    expect(result).toMatchObject({ designation: '433', spkId: '20000433', solutionId: '659',
      solutionEpochTdb: 2453311.5, standardElementEpochTdb: 2461200.5,
      frame: 'heliocentric-IAU76/80-ecliptic-J2000', positiveDefinite: true,
      labels: ['e', 'q', 'tp', 'node', 'peri', 'i'], units: [null, 'au', 'd', 'deg', 'deg', 'deg'],
      planetaryEphemeris: 'DE441', smallBodyEphemeris: 'SB441-N16' })
    expect(result.nominal[0]).toBe(0.2228078944584026)
    expect(result.nominal[2]).toBe(Number('2453371.585994305078'))
    // NumPy 2.4.2 eigvalsh(C / sqrt(diag(C))[:,None] / sqrt(diag(C))[None,:]).
    const reference = [0.00003032523369826969, 0.012648358279915064, 0.520686805562325,
      1.065462290998513, 1.6271347576840387, 2.77403746224151]
    result.correlationEigenvalues.forEach((value, index) => expect(Math.abs(value - reference[index])).toBeLessThan(2e-14))
    result.matrix.forEach((row, i) => row.forEach((value, j) => expect(value).toBe(Number(fixture.orbit.covariance.data[i][j]))))
  })

  it('cannot pair covariance with ordinary elements from a different epoch', () => {
    const source = clone()
    Reflect.deleteProperty(source.orbit.covariance, 'elements')
    expect(() => parseSbdbCovariance(source)).toThrow(/standard-epoch elements cannot be substituted/)
    source.orbit.epoch = source.orbit.covariance.epoch
    expect(parseSbdbCovariance(source).nominal[0]).toBe(Number(source.orbit.elements.find(element => element.name === 'e')!.value))
  })

  it('uses labels rather than assuming a matrix axis order', () => {
    const source = clone(), order = [5, 3, 1, 0, 2, 4]
    source.orbit.covariance.labels = order.map(i => fixture.orbit.covariance.labels[i])
    source.orbit.covariance.data = order.map(i => order.map(j => fixture.orbit.covariance.data[i][j]))
    const reference = parseSbdbCovariance(fixture), result = parseSbdbCovariance(source)
    expect(result.nominal).toEqual(order.map(i => reference.nominal[i]))
    expect(result.units).toEqual(order.map(i => reference.units[i]))
    result.correlationEigenvalues.forEach((value, i) => expect(Math.abs(value - reference.correlationEigenvalues[i])).toBeLessThan(2e-14))
  })

  it('retains additional estimated parameters and their correlations', () => {
    const source = clone()
    source.orbit.covariance.labels.push('A2')
    source.orbit.covariance.data = identity(7)
    source.orbit.covariance.data[1][6] = source.orbit.covariance.data[6][1] = '0.25'
    Reflect.set(source.orbit, 'model_pars', [{ name: 'A2', kind: 'EST', value: '-2e-14', units: 'au/d^2' }])
    const result = parseSbdbCovariance(source)
    expect(result.additionalParameters).toEqual(['A2'])
    expect(result.nominal[6]).toBe(-2e-14)
    expect(result.units[6]).toBe('au/d^2')
    expect(result.matrix[1][6]).toBe(0.25)
    Reflect.set(source.orbit, 'model_pars', [{ name: 'A2', kind: 'SET', value: '-2e-14', units: 'au/d^2' }])
    expect(() => parseSbdbCovariance(source)).toThrow(/not estimated or considered/)
  })

  it('accepts decimal covariance syntax without JavaScript radix or suffix coercions', () => {
    const source = clone()
    source.orbit.covariance.elements.find(element => element.name === 'e')!.value = ' +2.228078944584026e-1 '
    source.orbit.covariance.data[0][0] = '.00000000000000008824897647015303'
    expect(parseSbdbCovariance(source).nominal[0]).toBe(0.2228078944584026)
    for (const value of ['0x1', '0b1', '1_000', '5 au', 'Infinity', 'NaN', '--1', '.', '1e', '']) {
      const invalid = clone()
      invalid.orbit.covariance.elements.find(element => element.name === 'e')!.value = value
      expect(() => parseSbdbCovariance(invalid), `accepted non-decimal value ${JSON.stringify(value)}`).toThrow(/Nonfinite or missing/)
    }
  })

  it('rejects a globally indefinite matrix even when all pairwise correlations are allowed', () => {
    const source = clone()
    source.orbit.covariance.data = identity(6)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) source.orbit.covariance.data[i][j] = '-0.75'
    expect(() => parseSbdbCovariance(source)).toThrow(/not positive semidefinite/)
  })

  it('reports rank deficiency without adding noise or modifying source values', () => {
    const source = clone()
    source.orbit.covariance.data = identity(6)
    source.orbit.covariance.data[0][1] = source.orbit.covariance.data[1][0] = '1'
    const result = parseSbdbCovariance(source)
    expect(result.positiveDefinite).toBe(false)
    expect(result.correlationEigenvalues[0]).toBe(0)
    expect(result.matrix[0][1]).toBe(1)
  })

  it.each([
    ['unknown signature', (source: typeof fixture) => { source.signature.version = '2.0' }, /signature/],
    ['conflicting solution', (source: typeof fixture) => { source.object.orbit_id = 'wrong' }, /solution identifiers/],
    ['conflicting epoch', (source: typeof fixture) => { source.orbit.cov_epoch = '2453312.5' }, /epochs/],
    ['wrong equinox', (source: typeof fixture) => { source.orbit.equinox = 'B1950' }, /equinox/],
    ['duplicate label', (source: typeof fixture) => { source.orbit.covariance.labels[1] = 'e' }, /uniquely label/],
    ['unknown label', (source: typeof fixture) => { source.orbit.covariance.labels[0] = 'a' }, /uniquely label/],
    ['wrong units', (source: typeof fixture) => { source.orbit.covariance.elements.find(element => element.name === 'om')!.units = 'rad' }, /units/],
    ['missing covariance', (source: typeof fixture) => { Reflect.set(source.orbit, 'covariance', null) }, /covariance object/],
    ['nonfinite element', (source: typeof fixture) => { source.orbit.covariance.elements[0].value = 'Infinity' }, /Nonfinite/],
    ['negative eccentricity', (source: typeof fixture) => { source.orbit.covariance.elements.find(element => element.name === 'e')!.value = '-0.1' }, /invalid conic/],
    ['zero variance', (source: typeof fixture) => { source.orbit.covariance.data[0][0] = '0' }, /positive marginal/],
    ['nonnumeric covariance', (source: typeof fixture) => { Reflect.set(source.orbit.covariance.data[0], 0, null) }, /Nonfinite/],
    ['asymmetric covariance', (source: typeof fixture) => { source.orbit.covariance.data[0][1] = '1' }, /asymmetric/],
    ['incorrect dimensions', (source: typeof fixture) => { source.orbit.covariance.data[0].pop() }, /dimensions/],
    ['vector format', (source: typeof fixture) => { Reflect.set(source.orbit.covariance, 'data', ['1', '0', '1']) }, /full square/],
  ] as const)('rejects %s', (_name, mutate, expected) => {
    const source = clone()
    mutate(source)
    expect(() => parseSbdbCovariance(source)).toThrow(expected)
  })
})
