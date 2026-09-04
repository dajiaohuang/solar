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
  const asteroidIds = new Map([['1', BODY_NAIF_IDS.ceres], ['2', BODY_NAIF_IDS.pallas], ['4', BODY_NAIF_IDS.vesta]])
  const moonIds = new Map(Object.entries(BODY_NAIF_IDS).filter(([, target]) => target >= 301 && target < 999 && target % 100 !== 99))
  for (const body of generated.bodies) {
    if (body.kind === 'moon') moonIds.set(body.name.toLowerCase(), body.naifId)
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
    if (/^naif:\d+$/.test(record.id)) target = Number(record.id.slice(5))
    else if (record.id === 'sb:asteroid:134340') target = BODY_NAIF_IDS.pluto
    else if (record.category === 'asteroid' || record.category === 'dwarf-planet') target = asteroidIds.get(record.designation)
    else if (record.category === 'moon') {
      const candidate = moonIds.get(record.name?.toLowerCase())
      const parent = candidate === undefined ? null : Math.floor(candidate / 100) === 9 ? 'sb:asteroid:134340' : `naif:${Math.floor(candidate / 100) * 100 + 99}`
      if (parent === record.parentId) target = candidate
    }
    if (target === undefined) return { ...record, ephemerisStatus: 'not-mapped-to-bundled-kernel' }
    const state = resolver.barycentric(target)
    return { ...record, naifId: target, ephemerisStatus: state ? 'state-available-at-audit-epoch' : 'no-state-at-audit-epoch',
      kernelEvidence: { target, auditEt: et, segments: byTarget.get(target) ?? [], stateAtAuditEpoch: state } }
  }
  return { attach, evidence: { manifestId: manifest.id, manifestSha256: digest(manifestBytes), auditEt: et,
    timeScale: 'TDB seconds past J2000', frame: 'ECLIPJ2000', positionUnit: 'km', velocityUnit: 'km/s',
    meaning: 'Integrity-checked bundled kernels evaluated with center chains at one audit epoch; not a whole-window accuracy or runtime-selection claim.' } }
}
