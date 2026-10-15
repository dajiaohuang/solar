import gmText from '../data/gm_de440.tpc?raw'
import { DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../engine/dynamics/de440Source.ts'
import { parseDe440MassPlan } from '../engine/dynamics/de440Gm.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid DE440 mass evidence')
  return value as Record<string, unknown>
}

/** Bind reported force masses to the local, content-pinned GM kernel values. */
export async function checkDe440MassReceipt(value: unknown, exclusionKm: number) {
  if (!Array.isArray(value) || value.length !== DE440_FORCE_IDS.length) throw new Error('DE440 mass plan shape mismatch')
  const gmBytes = new TextEncoder().encode(gmText)
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',gmBytes)), byte => byte.toString(16).padStart(2,'0')).join('')
  if (digest !== DE440_DYNAMICS_SOURCE.gmSha256) throw new Error('Local DE440 GM source checksum mismatch')
  const exclusions = Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm]))
  const expected = parseDe440MassPlan(gmText, exclusions)
  for (let index = 0; index < expected.length; index++) {
    const actual = record(value[index]), mass = expected[index]
    if (actual.naifId !== mass.naifId || actual.gmKm3PerSecond2 !== mass.gmKm3PerSecond2 ||
        actual.gmSource !== mass.gmSource || actual.exclusionKm !== mass.exclusionKm) {
      throw new Error('DE440 mass plan differs from the pinned GM source or request')
    }
  }
}
