import type { AsteroidRecord } from '../types'

const STRATUM_SAMPLE_SIZE = 2

function hashText(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function numericBin(value: number, boundaries: number[]) {
  const index = boundaries.findIndex((boundary) => value < boundary)
  return index < 0 ? boundaries.length : index
}

function catalogStratumFromFields(
  orbitClassCode: string,
  semiMajorAxisAU: number,
  eccentricityValue: number,
  inclinationDeg: number,
  absoluteMagnitude: number | undefined,
) {
  const semiMajorAxis = numericBin(semiMajorAxisAU, [1, 2, 3, 5, 10, 20, 40])
  const eccentricity = numericBin(eccentricityValue, [0.1, 0.25, 0.5, 0.75])
  const inclination = numericBin(inclinationDeg, [5, 15, 30, 60])
  const magnitude = absoluteMagnitude === undefined
    ? 'unknown'
    : numericBin(absoluteMagnitude, [5, 10, 15, 20, 25, 30])
  return `${orbitClassCode}|${semiMajorAxis}|${eccentricity}|${inclination}|${magnitude}`
}

export function catalogStratum(record: AsteroidRecord) {
  return catalogStratumFromFields(
    record.orbitClassCode,
    record.semiMajorAxisAU,
    record.eccentricity,
    record.inclinationDeg,
    record.absoluteMagnitude,
  )
}

type Stratum = { seen: number; records: AsteroidRecord[] }
export type CatalogSampleDecision = {
  globalIndex: number | null
  classKey: string | null
  stratumKey: string
  stratumIndex: number | null
}

export class StratifiedCatalogSampler {
  private readonly global: AsteroidRecord[] = []
  private readonly strata = new Map<string, Stratum>()
  private readonly classes = new Map<string, AsteroidRecord>()
  private seen = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  add(record: AsteroidRecord) {
    const decision = this.consider(
      record.id,
      record.orbitClassCode,
      record.semiMajorAxisAU,
      record.eccentricity,
      record.inclinationDeg,
      record.absoluteMagnitude,
    )
    if (decision) this.commit(decision, record)
  }

  consider(
    id: string,
    orbitClassCode: string,
    semiMajorAxisAU: number,
    eccentricity: number,
    inclinationDeg: number,
    absoluteMagnitude: number | undefined,
  ): CatalogSampleDecision | null {
    this.seen += 1
    const classKey = this.classes.has(orbitClassCode) ? null : orbitClassCode
    let globalIndex: number | null = null
    if (this.global.length < this.limit) {
      globalIndex = this.global.length
    } else {
      const replacement = hashText(`${id}:${this.seen}`) % this.seen
      if (replacement < this.limit) globalIndex = replacement
    }

    const key = catalogStratumFromFields(orbitClassCode, semiMajorAxisAU, eccentricity, inclinationDeg, absoluteMagnitude)
    const stratum = this.strata.get(key) ?? { seen: 0, records: [] }
    stratum.seen += 1
    let stratumIndex: number | null = null
    if (stratum.records.length < STRATUM_SAMPLE_SIZE) {
      stratumIndex = stratum.records.length
    } else {
      const replacement = hashText(`${id}:${stratum.seen}`) % stratum.seen
      if (replacement < STRATUM_SAMPLE_SIZE) stratumIndex = replacement
    }
    this.strata.set(key, stratum)
    return globalIndex === null && classKey === null && stratumIndex === null
      ? null
      : { globalIndex, classKey, stratumKey: key, stratumIndex }
  }

  commit(decision: CatalogSampleDecision, record: AsteroidRecord) {
    if (decision.globalIndex !== null) this.global[decision.globalIndex] = record
    if (decision.classKey !== null) this.classes.set(decision.classKey, record)
    if (decision.stratumIndex !== null) {
      const stratum = this.strata.get(decision.stratumKey)
      if (stratum) stratum.records[decision.stratumIndex] = record
    }
  }

  values() {
    if (this.seen <= this.limit) return this.global.slice(0, this.seen)
    const result: AsteroidRecord[] = []
    const included = new Set<string>()
    for (const [, record] of [...this.classes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      result.push(record)
      included.add(record.id)
      if (result.length >= this.limit) return result
    }
    const strata = [...this.strata.entries()].sort(([left], [right]) => left.localeCompare(right))
    for (let sampleIndex = 0; sampleIndex < STRATUM_SAMPLE_SIZE && result.length < this.limit; sampleIndex += 1) {
      for (const [, stratum] of strata) {
        const record = stratum.records[sampleIndex]
        if (!record || included.has(record.id)) continue
        result.push(record)
        included.add(record.id)
        if (result.length >= this.limit) break
      }
    }
    for (const record of this.global) {
      if (result.length >= this.limit) break
      if (included.has(record.id)) continue
      result.push(record)
      included.add(record.id)
    }
    return result
  }
}
