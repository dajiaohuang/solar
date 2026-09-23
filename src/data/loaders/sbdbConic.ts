import type { PeriapsisConic } from '../../engine/ephemeris/conicPeriapsis'

const AU_KM = 149597870.7
const record = (value: unknown): Record<string,unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SBDB conic object')
  return value as Record<string,unknown>
}
const numeric = (value: unknown, field: string) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) throw new Error(`Invalid SBDB ${field}`)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Invalid SBDB ${field}`)
  return n
}
const text = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`Invalid SBDB ${field}`)
  return value
}
export const splitTdbDay = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{7}(?:\.\d{1,20})?$/.test(value)) throw new Error('SBDB TDB epoch requires decimal Julian-day source text')
  const [day,fraction='0'] = value.split('.')
  if (Number(day) < 2000000 || Number(day) > 3000000) throw new Error('TDB epoch outside supported range')
  return { day:Number(day),fraction:Number('0.'+fraction) }
}

/** Imports the source osculating conic without guessing a GM or fitting forces.
 * Retains the entire owned response and model parameters for reproducible use. */
export async function decodeSbdbConic(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 1024*1024) throw new Error('SBDB conic source exceeds byte budget')
  const owned = Uint8Array.from(bytes)
  const raw = record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(owned)))
  const signature = record(raw.signature), object = record(raw.object), orbit = record(raw.orbit)
  if (signature.version !== '1.3' || signature.source !== 'NASA/JPL Small-Body Database (SBDB) API' || orbit.source !== 'JPL' || orbit.equinox !== 'J2000') throw new Error('Unsupported SBDB version, source or reference frame')
  if (!Array.isArray(orbit.elements) || orbit.elements.length > 64 || !Array.isArray(orbit.model_pars) || orbit.model_pars.length > 64) throw new Error('Invalid SBDB element or model parameter list')
  const elements = new Map<string,Record<string,unknown>>()
  for (const item of orbit.elements) {
    const row = record(item), name = text(row.name,'element name')
    if (elements.has(name)) throw new Error('Duplicate SBDB orbital element')
    elements.set(name,row)
  }
  const element = (name: string, units: string | null) => {
    const row = elements.get(name)
    if (!row || row.units !== units) throw new Error(`Missing or unsupported SBDB ${name} units`)
    return numeric(row.value,name)
  }
  const eccentricity = element('e',null), periapsisKm = element('q','au')*AU_KM
  const periapsisTdbJd = element('tp','TDB'), osculationTdbJd = numeric(orbit.epoch,'epoch')
  const periapsisTdb = splitTdbDay(elements.get('tp')!.value), osculationTdb = splitTdbDay(orbit.epoch)
  const inclinationRadians = element('i','deg')*Math.PI/180
  const ascendingNodeRadians = element('om','deg')*Math.PI/180, argumentOfPeriapsisRadians = element('w','deg')*Math.PI/180
  if (eccentricity < 0 || !(periapsisKm > 0) || ![periapsisKm,inclinationRadians,ascendingNodeRadians,argumentOfPeriapsisRadians].every(Number.isFinite) || inclinationRadians < 0 || inclinationRadians > Math.PI || ![periapsisTdbJd,osculationTdbJd].every(jd=>jd>=2000000&&jd<=3000000)) throw new Error('SBDB conic outside supported numerical range')
  const orbitId = text(orbit.orbit_id,'orbit ID')
  if (object.orbit_id !== orbitId) throw new Error('SBDB solution identity mismatch')
  const parameters: Omit<PeriapsisConic,'gmKm3PerSecond2'> = { eccentricity,periapsisKm,inclinationRadians,ascendingNodeRadians,argumentOfPeriapsisRadians }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',owned)),v=>v.toString(16).padStart(2,'0')).join('')
  return { designation:text(object.des,'designation'), name:text(object.fullname,'fullname'), spkId:text(object.spkid,'SPK ID'), orbitId,
    parameters, periapsisTdbText:elements.get('tp')!.value as string, osculationTdbText:orbit.epoch as string, periapsisTdb, osculationTdb, periapsisTdbJd, osculationTdbJd, timeScale:'TDB' as const, frame:'ECLIPJ2000' as const, center:'Sun' as const,
    sourceSha256:sha256, sourceBytes:owned.length, raw, modelParameters:structuredClone(orbit.model_pars),
    sourceValidity:{notValidBefore:orbit.not_valid_before ?? null,notValidAfter:orbit.not_valid_after ?? null},
    limitations:['GM must be supplied with independent source evidence.', 'Osculating two-body propagation does not reproduce the fitted planetary, relativistic or non-gravitational model.', 'No propagated covariance or physical accuracy certification.'] }
}
