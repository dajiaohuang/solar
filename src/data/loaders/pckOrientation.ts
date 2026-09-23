import { PCK_RADII_SOURCE, readPinnedPckData } from './pckRadii.ts'

const DAY = 86400, CENTURY = 36525, RAD = Math.PI / 180
type Model = { id: number; epoch: number; ra: number[]; dec: number[]; pm: number[]; phases: number[][]; raTerms: number[]; decTerms: number[]; pmTerms: number[] }
const polynomial = (coefficients: number[], time: number) => coefficients.reduceRight((value, coefficient) => value * time + coefficient, 0)
const rotate3 = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1] }
const rotate1 = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c] }
function multiply(a: number[], b: number[]) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3), column = index % 3
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6]
  })
}

/** The exact pinned text kernel only, including Mars-system quadratic phases
 * and Tempel 1's non-J2000 reference epoch. No binary-PCK/ITRF equivalence. */
export async function loadPckOrientation(input: ArrayBuffer) {
  const data = await readPinnedPckData(input), pool = new Map<string, number[]>()
  for (const match of data.matchAll(/\b(BODY\d+_(?:POLE_RA|POLE_DEC|PM|NUT_PREC_RA|NUT_PREC_DEC|NUT_PREC_PM|NUT_PREC_ANGLES|MAX_PHASE_DEGREE|CONSTANTS_JED_EPOCH))\s*=\s*(\([^)]*\)|[+\-\d.eEdD]+)/g)) {
    const values = match[2].replace(/[()]/g, '').trim().split(/\s+/).map(token => Number(token.replace(/[dD]/, 'E')))
    if (pool.has(match[1]) || !values.length || values.some(value => !Number.isFinite(value))) throw new RangeError('Invalid pinned PCK orientation assignment')
    pool.set(match[1], values)
  }
  const models = new Map<number, Model>()
  for (const [key, ra] of pool) {
    if (!key.endsWith('_POLE_RA')) continue
    const id = Number(key.slice(4, -8)), prefix = `BODY${id}_`
    const system = id >= 100 && id < 1000 ? Math.floor(id / 100) : id
    const systemPrefix = `BODY${system}_`
    const dec = pool.get(prefix + 'POLE_DEC'), pm = pool.get(prefix + 'PM')
    const phaseDegree = pool.get(systemPrefix + 'MAX_PHASE_DEGREE')?.[0] ?? 1
    const phaseValues = pool.get(systemPrefix + 'NUT_PREC_ANGLES') ?? []
    const phases: number[][] = []
    if (!Number.isInteger(phaseDegree) || phaseDegree < 1 || phaseDegree > 3 || phaseValues.length % (phaseDegree + 1)) throw new RangeError('Unsupported pinned PCK phase polynomial')
    for (let i = 0; i < phaseValues.length; i += phaseDegree + 1) phases.push(phaseValues.slice(i, i + phaseDegree + 1))
    const raTerms = pool.get(prefix + 'NUT_PREC_RA') ?? [], decTerms = pool.get(prefix + 'NUT_PREC_DEC') ?? [], pmTerms = pool.get(prefix + 'NUT_PREC_PM') ?? []
    if (!Number.isSafeInteger(id) || !dec || !pm || [ra, dec, pm].some(coefficients => coefficients.length < 1 || coefficients.length > 3) || Math.max(raTerms.length, decTerms.length, pmTerms.length) > phases.length) throw new RangeError(`Incomplete pinned PCK orientation model: ${id}; polynomial lengths ${ra.length}/${dec?.length}/${pm?.length}; periodic terms ${raTerms.length}/${decTerms.length}/${pmTerms.length}; phases ${phases.length}`)
    const epoch = pool.get(systemPrefix + 'CONSTANTS_JED_EPOCH')?.[0] ?? 2451545
    models.set(id, { id, epoch, ra, dec, pm, phases, raTerms, decTerms, pmTerms })
  }
  if (!models.size) throw new RangeError('Pinned PCK contains no orientation models')
  return {
    source: PCK_RADII_SOURCE,
    ids: () => Array.from(models.keys()).sort((a, b) => a - b),
    evaluate(naifPckId: number, secondsPastJ2000Tdb: number) {
      if (!Number.isSafeInteger(naifPckId) || !Number.isFinite(secondsPastJ2000Tdb) || Math.abs(secondsPastJ2000Tdb) > CENTURY * DAY) throw new RangeError('PCK orientation evaluation requires a body ID and TDB seconds within 100 Julian years of J2000')
      const model = models.get(naifPckId)
      if (!model) return null
      const days = (secondsPastJ2000Tdb - (model.epoch - 2451545) * DAY) / DAY, centuries = days / CENTURY
      const phases = model.phases.map(coefficients => polynomial(coefficients, centuries) * RAD)
      const periodic = (terms: number[], cosine = false) => terms.reduce((sum, coefficient, i) => sum + coefficient * (cosine ? Math.cos(phases[i]) : Math.sin(phases[i])), 0)
      const raDegrees = polynomial(model.ra, centuries) + periodic(model.raTerms)
      const decDegrees = polynomial(model.dec, centuries) + periodic(model.decTerms, true)
      const primeMeridianDegrees = polynomial(model.pm, days) + periodic(model.pmTerms)
      const j2000ToBodyFixed = multiply(rotate3(primeMeridianDegrees * RAD), multiply(rotate1(Math.PI / 2 - decDegrees * RAD), rotate3(Math.PI / 2 + raDegrees * RAD)))
      return { naifPckId, secondsPastJ2000Tdb, constantsEpochTdb: model.epoch,
        poleRightAscensionDegrees: raDegrees, poleDeclinationDegrees: decDegrees,
        primeMeridianDegrees: ((primeMeridianDegrees % 360) + 360) % 360,
        j2000ToBodyFixed, layout: 'row-major; body-fixed vector = matrix * J2000 vector' as const,
        model: 'pck00011-text-IAU' as const, physicalOrientationUncertaintyRadians: null }
    },
    limitations: [
      'Text-PCK IAU orientation only, not binary-PCK, ITRF, Earth SOFA/IERS or high-precision lunar orientation.',
      'The +/-100 Julian-year evaluator limit is a numerical policy, not published physical validity or accuracy coverage.',
      'Uses TDB seconds; callers must supply the appropriate observation/emission epoch for their geometry.',
      'No physical orientation uncertainty, surface topography, atmosphere, ring model or limb correction is provided.',
      'Deprecated LONG_AXIS offsets are not applied, following CSPICE; ellipsoid offsets require separate explicit frame evidence.',
      'PCK body IDs are preserved; absent models return null and no catalog/SPK alias is inferred.',
    ],
  }
}
