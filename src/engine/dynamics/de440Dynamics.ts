import { SpkKernel } from '../ephemeris/spk.ts'
import { createPointMassGravity, type PrescribedEphemeris } from './pointMassGravity.ts'
import { SOLAR_1PN, withSolarRelativity } from './solarRelativity.ts'
import { SOLAR_RADIATION_PRESSURE, parseSolarRadiationPressure, withSolarRadiationPressure, type SolarRadiationPressure } from './solarRadiationPressure.ts'

export const DE440_DYNAMICS_SOURCE = Object.freeze({
  id: 'de440s-2000-01-01-2051-01-01',
  path: 'de440s-2000-01-01-2051-01-01.bsp',
  sha256: '8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069',
  bytes: 5558272, startEt: -43200, endEt: 1609416000,
  source: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
  gmSha256: '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140',
  gmSource: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc',
})
// Earth and Moon are separated; their system barycenter is never another mass.
// Other systems are represented by their total GM at the system barycenter.
export const DE440_FORCE_IDS = Object.freeze([10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9])
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')

/** Owns verified bytes for one immutable DE440 snapshot. No global installed
 * pool, UTC conversion, ecliptic rotation or approximate fallback enters it. */
export async function createDe440Dynamics(options: {
  spkBytes: ArrayBuffer; gmText: string; referenceEpochTdb: number;
  elapsedRangeSeconds: readonly [number, number];
  exclusionKm: Readonly<Record<number, number>>;
  solarRelativity?: boolean;
  solarRadiationPressure?: SolarRadiationPressure;
}) {
  const { referenceEpochTdb, gmText } = options
  const solarRelativity = options.solarRelativity ?? false
  const solarRadiationPressure = options.solarRadiationPressure === undefined ? undefined : parseSolarRadiationPressure(options.solarRadiationPressure)
  if (typeof solarRelativity !== 'boolean') throw new RangeError('Solar relativity adoption must be boolean')
  const [start, end] = options.elapsedRangeSeconds
  const exclusions = { ...options.exclusionKm }
  const referenceEt = (referenceEpochTdb - 2451545) * 86400
  if (![referenceEt, start, end].every(Number.isFinite) || start > 0 || end < 0 || end < start ||
      referenceEt + start < DE440_DYNAMICS_SOURCE.startEt || referenceEt + end > DE440_DYNAMICS_SOURCE.endEt) throw new RangeError('Dynamics interval must include the initial epoch inside pinned DE440 coverage')
  if (options.spkBytes.byteLength !== DE440_DYNAMICS_SOURCE.bytes) throw new RangeError('Unexpected DE440 kernel size')
  // Copy before the first await: the caller may release/change its input.
  const bytes = options.spkBytes.slice(0), gmBytes = new TextEncoder().encode(gmText)
  const [spkHash, gmHash] = await Promise.all([digest(bytes), digest(gmBytes.buffer)])
  if (spkHash !== DE440_DYNAMICS_SOURCE.sha256 || gmHash !== DE440_DYNAMICS_SOURCE.gmSha256) throw new Error('DE440 dynamics source checksum mismatch')
  const kernel = new SpkKernel(bytes)
  if (kernel.segments.some(segment => segment.frame !== 1)) throw new Error('Dynamics source requires original J2000 segments')
  const masses = DE440_FORCE_IDS.map(naifId => {
    const value = gmText.match(new RegExp(`BODY${naifId}_GM\\s*=\\s*\\(\\s*([\\d.EeDd+-]+)`))?.[1]
    return { naifId, gmKm3PerSecond2: Number(value?.replace(/[dD]/, 'E')),
      gmSource: `${DE440_DYNAMICS_SOURCE.gmSource} SHA-256 ${gmHash}`, exclusionKm: exclusions[naifId] }
  })
  function epoch(elapsed: number) {
    if (!Number.isFinite(elapsed) || elapsed < start || elapsed > end) throw new RangeError('Dynamics epoch outside frozen source window')
    return referenceEt + elapsed
  }
  let cachedEpoch: number | undefined
  let cachedResolver: ((id: number) => Float64Array) | undefined
  function resolver(et: number) {
    // One epoch only: Newtonian forces, optional 1PN and accepted-node sampling
    // can share the same center chains without an unbounded trajectory cache.
    if (et === cachedEpoch && cachedResolver) return cachedResolver
    const cache = new Map<number, Float64Array>([[0, new Float64Array(6)]])
    const visiting = new Set<number>()
    const resolve = (id: number): Float64Array => {
      const cached = cache.get(id)
      if (cached) return cached
      if (!Number.isSafeInteger(id) || visiting.has(id) || visiting.size > 8) throw new Error('Invalid DE440 center chain')
      visiting.add(id)
      try {
        const value = kernel.evaluate(id, et)
        if (!value) throw new Error(`Missing pinned DE440 state for NAIF ${id}`)
        const center = resolve(value.center)
        const state = Float64Array.of(value.position.x, value.position.y, value.position.z, value.velocity.x, value.velocity.y, value.velocity.z)
        for (let i = 0; i < 6; i++) state[i] += center[i]
        cache.set(id, state)
        return state
      } finally { visiting.delete(id) }
    }
    cachedEpoch = et; cachedResolver = resolve
    return resolve
  }
  const ephemeris: PrescribedEphemeris = {
    frame: 'J2000', origin: 'SSB', timeScale: 'TDB', aberration: 'NONE', referenceEpochTdb,
    elapsedRangeSeconds: [start, end], source: `${DE440_DYNAMICS_SOURCE.id} SHA-256 ${spkHash}`,
    positions(elapsed, ids, out) {
      if (out.length !== ids.length * 3 || ids.length !== DE440_FORCE_IDS.length || ids.some((id, i) => id !== DE440_FORCE_IDS[i])) throw new Error('DE440 force selection must retain the non-overlapping pinned mass plan')
      const resolve = resolver(epoch(elapsed))
      for (let i = 0; i < ids.length; i++) out.set(resolve(ids[i]).subarray(0, 3), i * 3)
    },
  }
  const force = createPointMassGravity(masses, ephemeris)
  // Verify the complete center chains at both endpoints before integrating.
  for (const time of [start, end]) {
    const resolve = resolver(epoch(time))
    for (const id of DE440_FORCE_IDS) resolve(id)
  }
  const sunState = (elapsed: number) => resolver(epoch(elapsed))(10)
  let derivative = solarRelativity ? withSolarRelativity(force.derivative, sunState, masses.find(mass => mass.naifId === 10)!.gmKm3PerSecond2) : force.derivative
  if (solarRadiationPressure) derivative = withSolarRadiationPressure(derivative, sunState, solarRadiationPressure)
  return { derivative,
    state: (naifId: number, elapsed = 0) => resolver(epoch(elapsed))(naifId).slice(),
    evidence: { ...force.evidence, model: solarRadiationPressure ? (solarRelativity ? 'restricted-newtonian-plus-solar-1pn-and-radial-srp' as const : 'restricted-newtonian-plus-radial-srp' as const) : solarRelativity ? 'restricted-newtonian-plus-solar-1pn' as const : force.evidence.model,
      solarRadiationPressure: solarRadiationPressure ? { ...SOLAR_RADIATION_PRESSURE, parameters: solarRadiationPressure } : null,
      solarRelativity: solarRelativity ? SOLAR_1PN : null, kernel: { ...DE440_DYNAMICS_SOURCE },
      representation: 'Sun; separate Earth and Moon; other planetary systems as single barycentric point masses',
      limitations: [...force.evidence.limitations.filter(value => !value.startsWith('No relativistic,')),
        'No harmonics, spin or test-particle back-reaction.',
        ...(solarRelativity ? ['Solar monopole 1PN only; no planetary/mixed relativistic terms.', SOLAR_1PN.approximation] : ['No relativistic forces.']),
        ...(solarRadiationPressure ? [SOLAR_RADIATION_PRESSURE.limitation, 'Imported force parameter sources are declarations, not independent authentication.'] : ['No non-gravitational forces.']),
        'Planetary-system point masses do not resolve non-lunar satellites.',
        'This restricted force model is not the DE440 or Horizons orbit-fit force model.'] } }
}
