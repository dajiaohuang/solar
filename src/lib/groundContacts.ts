import { loadGroundPayload, type GroundStation, type GroundObservation } from './groundObservation'
import { STATE_TILE_API_VERSION } from './stateTiles'
import pck from '../data/pck00011.source.json'

export type GroundContactRequest = { startUtc: string; endUtc: string; station: GroundStation; foregroundId: number; backgroundId: number; aberration: 'CN' }
export type GroundContact = { boundary: 'external' | 'internal'; direction: 'enter' | 'exit' | 'sampled-zero'; utc: string; elapsedTaiSeconds: number; bracketSeconds: [number, number]; bracketUtc: [string, string] }
type Geometry = { classification: 'none' | 'partial' | 'annular' | 'total'; separationRadians: number; foregroundAngularRadiusRadians: number; backgroundAngularRadiusRadians: number; externalGapRadians: number; internalGapRadians: number }
export type GroundContacts = Pick<GroundObservation, 'apiVersion' | 'catalogVersion' | 'catalogManifestSha256'> & {
  result: { model: string; request: GroundContactRequest; durationSeconds: number; contacts: GroundContact[]; evaluations: number
    startGeometry: Geometry; endGeometry: Geometry; sources: GroundObservation['result']['sources']; earthOrientation: GroundObservation['earthOrientation']
    radiusSourceSha256: string; radiusSourceUrl: string; warnings: string[]; possibleMissedEvents: true; contract: Record<string, unknown> }
}
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid contact response'); return value as Record<string, unknown> }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const utc = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)

export function validateGroundContacts(raw: unknown, request: GroundContactRequest): GroundContacts {
  const value = object(raw), r = object(value.result), echo = object(r.request), station = object(echo.station), eop = object(r.earthOrientation), contract = object(r.contract)
  const reject = () => { throw new Error('Contact identity or scientific contract mismatch') }
  if (value.apiVersion !== STATE_TILE_API_VERSION || typeof value.catalogVersion !== 'string' || !hash(value.catalogManifestSha256)
    || r.model !== 'earth-station-cn-spherical-contacts-v1' || echo.startUtc !== request.startUtc || echo.endUtc !== request.endUtc || echo.aberration !== 'CN'
    || echo.foregroundId !== request.foregroundId || echo.backgroundId !== request.backgroundId || Object.entries(request.station).some(([key, expected]) => station[key] !== expected)
    || !hash(eop.sha256) || eop.sourceUrl !== 'https://data.iers.org/products/eop/rapid/standard/finals2000A.all' || typeof eop.retrievedAt !== 'string' || !Number.isFinite(Date.parse(eop.retrievedAt))
    || r.radiusSourceSha256 !== pck.sha256 || r.radiusSourceUrl !== pck.url || r.possibleMissedEvents !== true
    || !finite(r.durationSeconds) || r.durationSeconds < 1 || r.durationSeconds > 86401 || !finite(r.evaluations) || !Number.isInteger(r.evaluations) || r.evaluations < 1 || r.evaluations > 8192
    || contract.timeAxis !== 'TAI-elapsed-SI-seconds' || contract.coverage !== 'sampled-sign-changes-only' || contract.stepSeconds !== 30 || contract.toleranceSeconds !== .05
    || contract.maxEvaluations !== 8192 || contract.maxContacts !== 512 || contract.physicalTimingUncertaintySeconds !== null
    || !Array.isArray(r.warnings) || !r.warnings.every(v => typeof v === 'string') || !Array.isArray(r.contacts) || r.contacts.length > 512 || !Array.isArray(r.sources)) reject()
  for (const rawGeometry of [r.startGeometry, r.endGeometry]) {
    const g = object(rawGeometry)
    for (const field of ['separationRadians', 'foregroundAngularRadiusRadians', 'backgroundAngularRadiusRadians', 'externalGapRadians', 'internalGapRadians']) if (!finite(g[field])) reject()
    const { separationRadians: s, foregroundAngularRadiusRadians: a, backgroundAngularRadiusRadians: b, externalGapRadians: e, internalGapRadians: i } = g as Geometry
    if (s < 0 || s > Math.PI || a <= 0 || a >= Math.PI/2 || b <= 0 || b >= Math.PI/2 || Math.abs(e-(s-a-b)) > 1e-12 || Math.abs(i-(s-Math.abs(a-b))) > 1e-12
      || g.classification !== (e >= 0 ? 'none' : i > 0 ? 'partial' : a >= b ? 'total' : 'annular')) reject()
  }
  let previous = 0
  for (const rawContact of r.contacts as unknown[]) {
    const c = object(rawContact), bracket = c.bracketSeconds, times = c.bracketUtc
    if (!['external', 'internal'].includes(c.boundary as string) || !['enter', 'exit', 'sampled-zero'].includes(c.direction as string) || !utc(c.utc)
      || !finite(c.elapsedTaiSeconds) || c.elapsedTaiSeconds < previous || c.elapsedTaiSeconds > (r.durationSeconds as number)
      || !Array.isArray(bracket) || bracket.length !== 2 || !bracket.every(finite) || bracket[0] < 0 || bracket[0] > c.elapsedTaiSeconds || bracket[1] < c.elapsedTaiSeconds || bracket[1] > (r.durationSeconds as number) || bracket[1]-bracket[0] > .05+1e-9
      || !Array.isArray(times) || times.length !== 2 || !times.every(utc) || times[0] > c.utc || times[1] < c.utc) reject()
    previous = c.elapsedTaiSeconds as number
  }
  const expected = new Set([399, 10, request.foregroundId, request.backgroundId].map(id => `naif:${id}`))
  for (const rawSource of r.sources as unknown[]) {
    const s = object(rawSource)
    if (typeof s.bodyId !== 'string' || !expected.delete(s.bodyId) || typeof s.source !== 'string' || !s.source || !hash(s.kernelSha256) || !finite(s.startJdTdb) || !finite(s.endJdTdb) || s.startJdTdb > s.endJdTdb) reject()
  }
  if (expected.size) reject()
  return raw as GroundContacts
}

export function loadGroundContacts(base: string | null, profile: 'full' | 'preview', request: GroundContactRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GroundContacts> {
  return loadGroundPayload(base, profile, '/v1/observation/contacts', request, signal, raw => validateGroundContacts(raw, request), fetcher)
}
