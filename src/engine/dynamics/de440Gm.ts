import type { PointMass } from './pointMassGravity.ts'
import { DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from './de440Source.ts'

/** Read the fixed DE440 GM table after its caller authenticates the bytes. */
export function parseDe440MassPlan(gmText: string, exclusions: Readonly<Record<number, number>>): PointMass[] {
  const allowedIds = new Set(DE440_FORCE_IDS.map(String)), suppliedIds = Object.keys(exclusions)
  if (suppliedIds.length !== allowedIds.size || suppliedIds.some(id => !allowedIds.has(id))) {
    throw new RangeError('Invalid DE440 exclusion contract: name each pinned force ID exactly once')
  }
  return DE440_FORCE_IDS.map(naifId => {
    const assignments = Array.from(gmText.matchAll(new RegExp(`^[ \\t]*BODY${naifId}_GM[ \\t]*=[ \\t]*\\([ \\t]*([\\d.EeDd+-]+)[ \\t]*\\)[ \\t]*$`, 'gm')))
    const value = assignments.length === 1 ? assignments[0][1] : undefined
    const gmKm3PerSecond2 = Number(value?.replace(/[dD]/, 'E'))
    const exclusionKm = exclusions[naifId]
    if (!Number.isFinite(gmKm3PerSecond2) || gmKm3PerSecond2 <= 0 || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
      throw new RangeError(`Invalid DE440 mass or exclusion contract for NAIF ${naifId}`)
    }
    return { naifId, gmKm3PerSecond2, gmSource: `${DE440_DYNAMICS_SOURCE.gmSource} SHA-256 ${DE440_DYNAMICS_SOURCE.gmSha256}`, exclusionKm }
  })
}
