import seedData from '../data/ephemerisBodies.json'
import { bodyNaifId } from '../data/ephemerisTargets'
import { stateToConicDiagnostics } from '../engine/ephemeris/osculating'
import type { CelestialBody } from '../types'
import type { BackendFrame } from './backendFrames'

/** Same-epoch geometric diagnostics of the displayed snapshot. The two rows
 * can come from different solutions: retain both receipts, never infer one fit. */
export function backendSnapshotDiagnostics(frame: BackendFrame, target: CelestialBody, reference: CelestialBody) {
  const evidence = frame.evidence
  if (!evidence.stateValueAt || target.id === reference.id) return null
  let targetIndex = -1, referenceIndex = -1
  for (let index = 0; index < evidence.length; index++) {
    const id = evidence.bodyIdAt(index)
    if (id === target.id) targetIndex = index
    if (id === reference.id) referenceIndex = index
    if (targetIndex >= 0 && referenceIndex >= 0) break
  }
  if (targetIndex < 0 || referenceIndex < 0 || evidence.statusAt(targetIndex) !== 'exact' || evidence.statusAt(referenceIndex) !== 'exact') return null
  const targetState = Array.from({ length: 6 }, (_, component) => evidence.stateValueAt!(targetIndex, component))
  const referenceState = Array.from({ length: 6 }, (_, component) => evidence.stateValueAt!(referenceIndex, component))
  const relative = targetState.map((value, component) => value - referenceState[component])
  if (![...targetState, ...referenceState, ...relative, frame.epochTdbJd].every(Number.isFinite)) return null
  const distanceKm = Math.hypot(...relative.slice(0, 3)), speedKmPerSecond = Math.hypot(...relative.slice(3))
  if (!(distanceKm > 0) || !Number.isFinite(distanceKm) || !Number.isFinite(speedKmPerSecond)) return null
  const rangeRateKmPerSecond = relative[0]/distanceKm*relative[3] + relative[1]/distanceKm*relative[4] + relative[2]/distanceKm*relative[5]
  if (!Number.isFinite(rangeRateKmPerSecond)) return null
  const gmTable = seedData.source.gmKm3S2 as Record<string, number>
  const referenceNaifId = bodyNaifId(reference), targetNaifId = bodyNaifId(target)
  const primaryGm = referenceNaifId === undefined ? undefined : gmTable[String(referenceNaifId)]
  const secondaryGm = targetNaifId === undefined ? undefined : gmTable[String(targetNaifId)]
  const hasSecondaryGm = typeof secondaryGm === 'number' && Number.isFinite(secondaryGm) && secondaryGm >= 0
  const gm = typeof primaryGm === 'number' && Number.isFinite(primaryGm) && primaryGm > 0
    ? { valueKm3PerSecond2: primaryGm + (hasSecondaryGm ? secondaryGm : 0), primaryGm,
      secondaryGm: hasSecondaryGm ? secondaryGm : null,
      approximation: hasSecondaryGm ? 'primary-plus-target' : 'primary-only-target-GM-unavailable',
      source: seedData.source.gmUrl, sha256: seedData.source.gmSha256 } : null
  const conic = gm ? stateToConicDiagnostics({ x: relative[0], y: relative[1], z: relative[2] },
    { x: relative[3], y: relative[4], z: relative[5] }, gm.valueKm3PerSecond2) : null
  return { schemaVersion: 1, purpose: 'backend-snapshot-relative-diagnostics',
    epochTdbJd: frame.epochTdbJd, frame: 'ECLIPJ2000', positionUnit: 'km', velocityUnit: 'km/s',
    targetId: target.id, referenceId: reference.id, targetState, referenceState,
    relativeState: relative, distanceKm, speedKmPerSecond, rangeRateKmPerSecond, gm, conic,
    catalogManifestSha256: frame.catalogManifestSha256, inventoryManifestSha256: frame.inventoryManifestSha256,
    targetEvidence: evidence.rowAt(targetIndex), referenceEvidence: evidence.rowAt(referenceIndex),
    limitations: ['Simultaneous geometric states; no light-time, aberration or observed Doppler correction.',
      'Independent source rows are not a jointly fitted dynamical solution. Adopted DE440 GM is not inferred from the SPK solution.',
      'Instantaneous Newtonian conic relative to the selected reference; not a propagated orbit, error bound or long-term stability result.',
      'Missing target GM uses a declared primary-only approximation; absent reference GM leaves conic diagnostics unavailable.'] }
}
