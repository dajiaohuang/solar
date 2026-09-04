import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SpkKernel } from '../../src/engine/ephemeris/spk.ts'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool.ts'
import { BODY_NAIF_IDS } from '../../src/data/ephemerisTargets.ts'
import { digest } from './inventory-snapshot.mjs'

/** Only explicit existing identity mappings; never guess an ID from a name. */
export async function inventoryKernels(root, et) {
  const manifestBytes = await readFile(join(root, 'src/data/ephemeris-manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  const generated = JSON.parse(await readFile(join(root, 'src/data/ephemerisBodies.json'), 'utf8'))
  const satelliteCatalogBytes = await readFile(join(root, 'src/data/satelliteCatalog.json'))
  const satelliteCatalog = JSON.parse(satelliteCatalogBytes)
  const asteroidIds = new Map([['1', BODY_NAIF_IDS.ceres], ['2', BODY_NAIF_IDS.pallas], ['4', BODY_NAIF_IDS.vesta], ['136199', BODY_NAIF_IDS.eris], ['136108', BODY_NAIF_IDS.haumea]])
  // Five-digit satellite IDs do not encode their parent by division by 100.
  // Use the independently reconciled catalog's explicit parent and aliases.
  const parentIds = new Map([['earth', 'naif:399'], ['mars', 'naif:499'], ['jupiter', 'naif:599'], ['saturn', 'naif:699'], ['uranus', 'naif:799'], ['neptune', 'naif:899'], ['pluto', 'sb:asteroid:134340']])
  const moonIds = new Map(), discoveryIds = new Map(), moonParents = new Map()
  const aliasKey = (parent, name) => JSON.stringify([parent, String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')])
  function addMoon(body) {
    if (!Number.isSafeInteger(body.naifId)) return
    const parent = parentIds.get(body.parentId)
    if (!parent) throw new Error(`Unknown satellite parent: ${body.parentId}`)
    if (moonParents.has(body.naifId) && moonParents.get(body.naifId) !== parent) throw new Error('Conflicting satellite parents')
    moonParents.set(body.naifId, parent)
    for (const alias of [body.name, ...(body.aliases ?? [])].filter(Boolean)) {
      const key = aliasKey(parent, alias)
      if (moonIds.has(key) && moonIds.get(key) !== body.naifId) throw new Error('Ambiguous satellite alias')
      moonIds.set(key, body.naifId)
    }
    if (body.discoveryId) discoveryIds.set(body.discoveryId, { target: body.naifId, parent })
  }
  addMoon({ name: 'Moon', naifId: 301, parentId: 'earth' })
  for (const body of satelliteCatalog.bodies) addMoon(body)
  for (const body of generated.bodies) {
    if (body.kind === 'moon' && !moonParents.has(body.naifId)) addMoon(body)
    const number = /^asteroid:(\d+)$/.exec(body.id)?.[1]
    if (number) asteroidIds.set(number, body.naifId)
  }
  const kernels = []
  for (const file of manifest.files) {
    if (!/^[\w.-]+\.bsp$/.test(file.path)) throw new Error('Invalid bundled kernel path')
    const bytes = await readFile(join(root, 'public/data/ephemerides', file.path))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Bundled kernel integrity mismatch: ${file.id}`)
    kernels.push({ id: file.id, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) })
  }
  const resolver = createKernelResolver(kernels, et)
  const byTarget = new Map()
  for (const { id, kernel } of kernels) for (const segment of kernel.segments) {
    if (!byTarget.has(segment.target)) byTarget.set(segment.target, [])
    byTarget.get(segment.target).push({ kernelId: id, startEt: segment.startEt, endEt: segment.endEt, center: segment.center, frame: segment.frame, type: segment.type })
  }
  function attach(record) {
    let target
    if (/^naif:\d+$/.test(record.id)) {
      const candidate = Number(record.id.slice(5))
      if (record.category !== 'moon' || !moonParents.has(candidate) || moonParents.get(candidate) === record.parentId) target = candidate
    }
    else if (record.id === 'sb:asteroid:134340') target = BODY_NAIF_IDS.pluto
    else if (record.category === 'asteroid' || record.category === 'dwarf-planet') target = asteroidIds.get(record.designation)
    else if (record.category === 'moon') {
      const discovery = discoveryIds.get(record.id)
      if (discovery) {
        if (discovery.parent === record.parentId) target = discovery.target
      } else target = moonIds.get(aliasKey(record.parentId, record.name))
    }
    if (target === undefined) return { ...record, ephemerisStatus: 'not-mapped-to-bundled-kernel' }
    const state = resolver.barycentric(target)
    return { ...record, naifId: target, ephemerisStatus: state ? 'state-available-at-audit-epoch' : 'no-state-at-audit-epoch',
      kernelEvidence: { target, auditEt: et, segments: byTarget.get(target) ?? [], stateAtAuditEpoch: state } }
  }
  return { attach, evidence: { manifestId: manifest.id, manifestSha256: digest(manifestBytes), auditEt: et,
    identityMappingSha256: digest(JSON.stringify({ asteroidIds: [...asteroidIds], moonIds: [...moonIds], discoveryIds: [...discoveryIds], moonParents: [...moonParents] })),
    satelliteCatalogSha256: digest(satelliteCatalogBytes),
    timeScale: 'TDB seconds past J2000', frame: 'ECLIPJ2000', positionUnit: 'km', velocityUnit: 'km/s',
    meaning: 'Integrity-checked bundled kernels evaluated with center chains at one audit epoch; not a whole-window accuracy or runtime-selection claim.' } }
}
