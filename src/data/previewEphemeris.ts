import profile from './preview-profile.json' with { type: 'json' }
import satellites from './satelliteCatalog.json' with { type: 'json' }
import seeds from './ephemerisBodies.json' with { type: 'json' }
import { bodyNaifId } from './ephemerisTargets.ts'

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
  const byId = new Map(source.files.map(file => [file.id, file]))
  if (byId.size !== source.files.length) throw new Error('Duplicate ephemeris file identity')
  const wanted = new Set(source.files.filter(file => !file.dependencyOnly && (file.core || file.targets.some(id => targetIds.has(id)))).map(file => file.id))
  const visited = new Set<string>(), visiting = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Cyclic ephemeris dependency ${id}`)
    const file = byId.get(id)
    if (!file) throw new Error(`Missing declared ephemeris dependency ${id}`)
    visiting.add(id)
    for (const dependency of file.solutionKernelIds ?? []) {
      // A source pool may explicitly include its root in the ordered pool.
      if (dependency !== id) { wanted.add(dependency); visit(dependency) }
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of wanted) visit(id)
  return {
    ...source,
    id: `${source.id}-${profile.id}`,
    profile: 'preview',
    sourceManifestId: source.id,
    availabilityProfileId: profile.id,
    // Identity without a target (e.g. Makemake) remains visible with its gap.
    bodyTargets: targets.map(body => ({ id: body.id, naifId: body.naifId ?? null })),
    files: source.files.filter(file => wanted.has(file.id)),
  }
}
