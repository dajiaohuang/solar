import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { SpkKernel } from '../../src/engine/ephemeris/spk.ts'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool.ts'
import { BODY_NAIF_IDS } from '../../src/data/ephemerisTargets.ts'
import { SPACECRAFT_IDENTITIES, SPACECRAFT_IDENTITY_SOURCE } from '../../src/data/spacecraftIdentities.ts'
import { digest } from './inventory-snapshot.mjs'
import { ephemerisProfile } from '../../src/data/ephemerisProfile.ts'
import { readScientificFile } from './scientific-file.mjs'
import { sourceChainSha256 } from './source-chain.mjs'

async function readKernelBytes(path, expectedBytes, signal) {
  signal.throwIfAborted()
  const file = await open(path, 'r')
  try {
    signal.throwIfAborted()
    const info = await file.stat({ bigint: true })
    signal.throwIfAborted()
    if (!info.isFile() || info.size !== BigInt(expectedBytes)) throw new Error('Bundled kernel size differs from manifest')
    // Allocate only the admitted byte count. A changed or oversized local file
    // cannot cause readFile to allocate beyond the four-reader budget.
    const bytes = Buffer.alloc(expectedBytes)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset)
      signal.throwIfAborted()
      if (!bytesRead) throw new Error('Truncated bundled kernel')
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    signal.throwIfAborted()
    if (after.size !== info.size || after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs) throw new Error('Bundled kernel changed during read')
    return bytes
  } finally { await file.close() }
}

/** The inventory is a one-epoch audit. Retain original evaluated states and
 * descriptors, not gigabytes of coefficients in each audit closure. All input
 * bytes are still integrity-checked before this bounded snapshot is created. */
export function snapshotKernelAtEpoch(kernel, et) {
  if (!Number.isFinite(et)) throw new Error('Finite inventory epoch required')
  const states = new Map([...new Set(kernel.segments.map(segment => segment.target))].map(target => [target, kernel.evaluate(target, et)]))
  return { segments: kernel.segments, evaluate(target, requestedEt) {
    if (requestedEt !== et) throw new Error('Inventory snapshot cannot evaluate another epoch')
    return states.get(target) ?? null
  } }
}

/** Only explicit existing identity mappings; never guess an ID from a name. */
export async function inventoryKernels(root, et, requestedProfile = 'pages') {
  if (!Number.isFinite(et)) throw new Error('Finite inventory epoch required')
  const profile = ephemerisProfile(requestedProfile)
  const manifestBytes = await readScientificFile(join(root, `src/data/ephemeris-manifest${profile === 'full' ? '-full' : ''}.json`), 16 * 1024 * 1024)
  const manifest = JSON.parse(manifestBytes)
  if (manifest.schemaVersion !== 1 || manifest.profile !== profile || typeof manifest.id !== 'string' || !manifest.id || !Array.isArray(manifest.files) || manifest.files.length > 4096) throw new Error('Kernel manifest does not match requested inventory profile or file budget')
  const fileIds = new Set(), filePaths = new Set()
  for (const file of manifest.files) {
    if (!file || typeof file.id !== 'string' || !file.id || fileIds.has(file.id) || typeof file.path !== 'string' || !/^[\w.-]+\.bsp$/.test(file.path) || filePaths.has(file.path)) throw new Error('Invalid or duplicate inventory kernel identity')
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 128 * 1024 * 1024 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid inventory kernel integrity metadata')
    if (file.dependencyOnly !== undefined && typeof file.dependencyOnly !== 'boolean') throw new Error(`Invalid inventory dependency flag: ${file.id}`)
    // Validate selection metadata before loading coefficients. Missing named
    // dependencies remain reportable coverage gaps, not malformed metadata.
    const pool = file.solutionKernelIds
    if (pool !== undefined && (!Array.isArray(pool) || pool.length > 4096 ||
      pool.some(id => typeof id !== 'string' || !id) || new Set(pool).size !== pool.length || pool.includes(file.id))) {
      throw new Error(`Invalid inventory solution pool: ${file.id}`)
    }
    fileIds.add(file.id); filePaths.add(file.path)
  }
  const generated = JSON.parse(await readScientificFile(join(root, 'src/data/ephemerisBodies.json'), 16 * 1024 * 1024))
  const satelliteCatalogBytes = await readScientificFile(join(root, 'src/data/satelliteCatalog.json'), 16 * 1024 * 1024)
  const satelliteCatalogSha256 = digest(satelliteCatalogBytes)
  const satelliteCatalog = JSON.parse(satelliteCatalogBytes)
  const asteroidIds = new Map([['1', BODY_NAIF_IDS.ceres], ['2', BODY_NAIF_IDS.pallas], ['4', BODY_NAIF_IDS.vesta], ['136199', BODY_NAIF_IDS.eris], ['136108', BODY_NAIF_IDS.haumea]])
  // Five-digit satellite IDs do not encode their parent by division by 100.
  // Use the independently reconciled catalog's explicit parent and aliases.
  const parentIds = new Map([['earth', 'naif:399'], ['mars', 'naif:499'], ['jupiter', 'naif:599'], ['saturn', 'naif:699'], ['uranus', 'naif:799'], ['neptune', 'naif:899'], ['pluto', 'sb:asteroid:134340']])
  parentIds.set('eris', 'sb:asteroid:136199')
  parentIds.set('haumea', 'sb:asteroid:136108')
  const primaryTargets = new Map()
  for (const primary of satelliteCatalog.primaries ?? []) {
    if (!primary || typeof primary.id !== 'string' || !primary.id.trim() ||
      typeof primary.designation !== 'string' || !primary.designation.trim() ||
      primary.inventoryId !== `sb:asteroid:${primary.designation}` ||
      !Number.isSafeInteger(primary.naifId) || !Number.isSafeInteger(primary.systemNaifId) ||
      primary.naifId === primary.systemNaifId) throw new Error('Invalid resolved satellite primary identity')
    if (parentIds.has(primary.id) && parentIds.get(primary.id) !== primary.inventoryId) throw new Error(`Conflicting primary parent identity: ${primary.id}`)
    const previous = primaryTargets.get(primary.designation)
    if (previous && (previous.target !== primary.naifId || previous.system !== primary.systemNaifId)) throw new Error(`Conflicting resolved primary: ${primary.designation}`)
    primaryTargets.set(primary.designation, { target: primary.naifId, system: primary.systemNaifId })
    parentIds.set(primary.id, primary.inventoryId)
    asteroidIds.set(primary.designation, primary.naifId)
  }
  const moonIds = new Map(), discoveryIds = new Map(), moonParents = new Map()
  const aliasKey = (parent, name) => JSON.stringify([parent, String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')])
  function moonParent(body) {
    const parent = parentIds.get(body.parentId)
    if (!parent) throw new Error(`Unknown satellite parent: ${body.parentId}`)
    if (moonParents.has(body.naifId) && moonParents.get(body.naifId) !== parent) throw new Error('Conflicting satellite parents')
    return parent
  }
  function addMoon(body) {
    if (!Number.isSafeInteger(body.naifId)) return
    const parent = moonParent(body)
    moonParents.set(body.naifId, parent)
    for (const alias of [body.name, ...(body.aliases ?? [])].filter(Boolean)) {
      const key = aliasKey(parent, alias)
      if (moonIds.has(key) && moonIds.get(key) !== body.naifId) throw new Error('Ambiguous satellite alias')
      moonIds.set(key, body.naifId)
    }
    if (body.discoveryId) {
      const previous = discoveryIds.get(body.discoveryId)
      if (previous && (previous.target !== body.naifId || previous.parent !== parent)) throw new Error(`Conflicting satellite discovery identity: ${body.discoveryId}`)
      discoveryIds.set(body.discoveryId, { target: body.naifId, parent })
    }
  }
  addMoon({ name: 'Moon', naifId: 301, parentId: 'earth' })
  for (const body of satelliteCatalog.bodies) addMoon(body)
  const generatedAsteroidIds = new Map()
  for (const body of generated.bodies) {
    if (body.kind === 'moon') {
      // Retain catalog alias authority, but never hide contradictory parent
      // metadata merely because this target was already inserted.
      if (moonParents.has(body.naifId)) moonParent(body)
      else addMoon(body)
    }
    const number = /^asteroid:(\d+)$/.exec(body.id)?.[1]
    if (number) {
      if (!Number.isSafeInteger(body.naifId)) throw new Error(`Invalid generated asteroid target: ${body.id}`)
      const primary = primaryTargets.get(number)
      if (primary && primary.target !== body.naifId) throw new Error(`Generated asteroid contradicts resolved primary: ${body.id}`)
      if (generatedAsteroidIds.has(number) && generatedAsteroidIds.get(number) !== body.naifId) throw new Error(`Conflicting generated asteroid identity: ${body.id}`)
      generatedAsteroidIds.set(number, body.naifId)
      // An explicit generated source target takes precedence over the static
      // legacy ID. Do not derive modern Horizons IDs by numeric arithmetic.
      asteroidIds.set(number, body.naifId)
    }
  }
  const kernels = new Array(manifest.files.length)
  let nextFile = 0
  // Bound I/O to four files, rather than serializing hundreds of disk reads or
  // loading the whole profile. Store by manifest index: pool precedence must
  // never depend on which read finishes first. Snapshots release coefficients.
  const readers = new AbortController()
  await Promise.all(Array.from({ length: Math.min(4, manifest.files.length) }, async () => {
    try {
      while (!readers.signal.aborted && nextFile < manifest.files.length) {
        const index = nextFile++
        const file = manifest.files[index]
        if (!/^[\w.-]+\.bsp$/.test(file.path)) throw new Error('Invalid bundled kernel path')
        const bytes = await readKernelBytes(join(root, 'public/data/ephemerides', file.path), file.bytes, readers.signal)
        readers.signal.throwIfAborted()
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Bundled kernel integrity mismatch: ${file.id}`)
        const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const kernel = snapshotKernelAtEpoch(new SpkKernel(buffer), et)
        kernels[index] = { id: file.id, sha256: file.sha256, solutionKernelIds: file.solutionKernelIds, dependencyOnly: file.dependencyOnly, kernel }
      }
    } catch (error) {
      // Preserve the first failure; sibling cancellation errors are secondary.
      if (!readers.signal.aborted) readers.abort(error)
    }
  }))
  // Every worker caught its failure and completed readKernelBytes' finally.
  // Never return while siblings are still consuming files in the background.
  readers.signal.throwIfAborted()
  const resolver = createKernelResolver(kernels, et)
  const byTarget = new Map()
  for (const { id, kernel } of kernels) for (const segment of kernel.segments) {
    if (!byTarget.has(segment.target)) byTarget.set(segment.target, [])
    byTarget.get(segment.target).push({ kernelId: id, startEt: segment.startEt, endEt: segment.endEt, center: segment.center, frame: segment.frame, type: segment.type })
  }
  function attach(record) {
    let target, identityMappingEvidence
    if (record.category === 'small-body-moon') {
      const source = record.sourceRef
      // Join two explicit source identities, never a display name or numeric
      // SPK-ID formula. Incomplete/unnamed API components stay unresolved even
      // when their parent currently has only one bundled companion.
      if (record.confirmation === 'confirmed' && record.identityStatus === 'source-designation' &&
          source?.confirmed === 'Y' && source.kind === 'an' && /^[1-9]\d*$/.test(String(source.pdes ?? '')) &&
          /^[1-9]\d*$/.test(String(source.iau_num ?? '')) && typeof source.iau_name === 'string' && source.iau_name.trim()) {
        const parent = `sb:asteroid:${source.pdes}`
        if (record.parentId === parent && record.id === `sat:${parent}:iau:${source.iau_num}`) {
          target = moonIds.get(aliasKey(parent, source.iau_name))
          if (target !== undefined) identityMappingEvidence = { method: 'jpl-iau-name-and-primary-to-audited-spk-alias',
            sourceRecordId: record.id, primaryId: parent, iauNumber: String(source.iau_num), iauName: source.iau_name,
            target, satelliteCatalogSha256 }
        }
      }
    }
    else if (record.category === 'spacecraft') {
      const identity = SPACECRAFT_IDENTITIES.find(body => record.id === `naif:${body.naifId}`)
      if (identity && record.source === 'spacecraftIdentities' && record.name === identity.name &&
        record.sourceRef?.url === SPACECRAFT_IDENTITY_SOURCE && record.sourceRef.naifId === identity.naifId &&
        record.sourceRef.name === identity.name) {
        target = identity.naifId
        identityMappingEvidence = { method: 'reviewed-naif-spacecraft-identity', target, sourceUrl: SPACECRAFT_IDENTITY_SOURCE }
      }
    }
    else if (/^naif:\d+$/.test(record.id)) {
      const candidate = Number(record.id.slice(5))
      if (Number.isSafeInteger(candidate) && (record.category !== 'moon' || !moonParents.has(candidate) || moonParents.get(candidate) === record.parentId)) target = candidate
    }
    else if (record.id === 'sb:asteroid:134340') target = BODY_NAIF_IDS.pluto
    else if (record.category === 'asteroid' || record.category === 'dwarf-planet') {
      if (typeof record.designation === 'string' && record.id === `sb:asteroid:${record.designation}`) target = asteroidIds.get(record.designation)
    }
    else if (record.category === 'moon') {
      const discovery = discoveryIds.get(record.id)
      if (discovery) {
        if (discovery.parent === record.parentId) target = discovery.target
      } else target = moonIds.get(aliasKey(record.parentId, record.name))
    }
    if (target === undefined) return { ...record, ephemerisStatus: 'not-mapped-to-bundled-kernel' }
    const evaluatedState = resolver.barycentric(target)
    const chain = evaluatedState ? resolver.sourceChain(target) : null
    const sourceChain = chain ? sourceChainSha256(chain) : null
    // A numerical value without its recursively selected, checksum-bound
    // center chain is not advertised as an exact audited snapshot.
    const state = sourceChain ? evaluatedState : null
    return { ...record, ...(identityMappingEvidence ? { identityMappingEvidence } : {}), naifId: target, ephemerisStatus: state ? 'state-available-at-audit-epoch' : 'no-state-at-audit-epoch',
      kernelEvidence: { target, auditEt: et, segments: byTarget.get(target) ?? [],
        ...(sourceChain ? { sourceKernelSha256: chain[0].kernelSha256, sourceChainSha256: sourceChain,
          sourceSegment: { kernelId: chain[0].kernelId, startEt: chain[0].startEt, endEt: chain[0].endEt,
            center: chain[0].center, frame: chain[0].frame, type: chain[0].type } } : {}),
        stateAtAuditEpoch: state } }
  }
  const descriptors = kernels.map(({ id, solutionKernelIds, dependencyOnly, kernel }) => ({ id, solutionKernelIds, dependencyOnly,
    segments: kernel.segments.map(({ target, center, frame, type, startEt, endEt }) => ({ target, center, frame, type, startEt, endEt })) }))
  return { attach, descriptors, evidence: { manifestId: manifest.id, profile, manifestSha256: digest(manifestBytes), auditEt: et,
    identityMappingSha256: digest(JSON.stringify({ asteroidIds: [...asteroidIds], moonIds: [...moonIds], discoveryIds: [...discoveryIds], moonParents: [...moonParents], spacecraft: SPACECRAFT_IDENTITIES, spacecraftSource: SPACECRAFT_IDENTITY_SOURCE })),
    satelliteCatalogSha256,
    timeScale: 'TDB seconds past J2000', frame: 'ECLIPJ2000', positionUnit: 'km', velocityUnit: 'km/s',
    meaning: 'Integrity-checked bundled kernels evaluated with center chains at one audit epoch; not a whole-window accuracy or runtime-selection claim.' } }
}
