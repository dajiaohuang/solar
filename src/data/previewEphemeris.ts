import profile from './preview-profile.json' with { type: 'json' }
import satellites from './satelliteCatalog.json' with { type: 'json' }
import seeds from './ephemerisBodies.json' with { type: 'json' }
import { bodyNaifId } from './ephemerisTargets.ts'
import { selectEphemerisFiles } from './ephemerisSelection.ts'

type File = { id: string; targets: number[]; core?: boolean; dependencyOnly?: boolean; solutionKernelIds?: string[] }
type Manifest = { id: string; files: File[] }

// Read explicit component/primary identities from the SAME records as the body
// registry. Never infer a satellite's target from its name or system barycenter.
const identities = new Map([...seeds.bodies, ...satellites.primaries, ...satellites.bodies].map(body => [body.id, body]))
export const previewBodyTargets = profile.bodyIds.map(id => ({ id, naifId: bodyNaifId(identities.get(id) ?? { id }) }))

/** Shared by Vite runtime, artifact writer and independent delivery checks.
 * Filtering preserves solution order, coefficient bytes and declared windows. */
export function previewEphemerisManifest<T extends Manifest>(source: T, targets = previewBodyTargets) {
  const targetIds = new Set(targets.map(body => body.naifId).filter(id => id !== undefined))
  const files = selectEphemerisFiles(source.files, targetIds)
  return {
    ...source,
    id: `${source.id}-${profile.id}`,
    profile: 'preview',
    sourceManifestId: source.id,
    availabilityProfileId: profile.id,
    // Identity without a target (e.g. Makemake) remains visible with its gap.
    bodyTargets: targets.map(body => ({ id: body.id, naifId: body.naifId ?? null })),
    files,
  }
}
