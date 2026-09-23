import { decodeSbdbConic, splitTdbDay } from '../../data/loaders/sbdbConic'
import { DE440_DYNAMICS_SOURCE } from '../dynamics/de440Dynamics'
import { propagatePeriapsisConic } from './conicPeriapsis'

export async function sbdbConicExperiment(sourceBytes: Uint8Array, gmText: string, epochTdbText: string) {
  const source = await decodeSbdbConic(sourceBytes), target = splitTdbDay(epochTdbText)
  const gmBytes = new TextEncoder().encode(gmText)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',gmBytes)),v=>v.toString(16).padStart(2,'0')).join('')
  if (hash !== DE440_DYNAMICS_SOURCE.gmSha256) throw new Error('Adopted solar GM source checksum mismatch')
  const gm = Number(gmText.match(/BODY10_GM\s*=\s*\(\s*([\d.EeDd+-]+)/)?.[1].replace(/[dD]/,'E'))
  if (!(gm > 0) || !Number.isFinite(gm)) throw new Error('Missing adopted solar GM')
  // Source bounds are UTC and can have several upstream formats. Refuse until
  // their time conversion is supported, instead of treating them as TDB.
  if (source.sourceValidity.notValidBefore !== null || source.sourceValidity.notValidAfter !== null) throw new Error('Explicit SBDB UTC validity bounds require conversion before conic propagation')
  const elapsedTdbSeconds = ((target.day-source.periapsisTdb.day)+(target.fraction-source.periapsisTdb.fraction))*86400
  const state = propagatePeriapsisConic({...source.parameters,gmKm3PerSecond2:gm},elapsedTdbSeconds)
  return { schemaVersion:1, model:'osculating-Newtonian-two-body-conic' as const, frame:source.frame,center:source.center,timeScale:source.timeScale,
    targetTdb:target, targetTdbText:epochTdbText, elapsedTdbSeconds, source, ...state,
    adoptedSolarGM:{km3PerSecond2:gm,sha256:hash,url:DE440_DYNAMICS_SOURCE.gmSource},
    physicalUncertainty:null, fittedModelReproduced:false, omittedSourceModelParameters:source.modelParameters,
    limitations:[...source.limitations,'The adopted DE440 solar GM is explicit, not claimed to be the source fit GM.',
      'No planetary perturbations, relativity, non-gravitational acceleration or covariance propagation.',
      'A missing source validity bound does not certify accuracy at the requested epoch.'] }
}
