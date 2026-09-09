import { majorBodiesById } from '../data/majorBodies'
import {
  EARTH_MOON_MASS_PARTITION_EVIDENCE,
  JPL_APPROX_MODEL_EVIDENCE,
  jplApproxWindowState,
} from '../engine/ephemeris/modelValidity'
import type { BodyId } from '../types'
import { EPHEMERIS_MANIFEST, kernelCoverage, kernelsForWindow, loadedKernelIds } from '../engine/ephemeris/kernelStore'
import type { BackendTrajectoryAudit } from './backendTrajectories'

function bodyUsesJplApproximation(bodyId: BodyId, visited = new Set<BodyId>()): boolean {
  if (visited.has(bodyId)) return false
  visited.add(bodyId)
  const body = majorBodiesById.get(bodyId)
  if (!body) return false
  if (body.orbit?.model === 'planetaryApprox') return true
  return body.parentId ? bodyUsesJplApproximation(body.parentId, visited) : false
}

export function sceneUsesJplApproximation(selectedIds: BodyId[], referenceId: BodyId) {
  return [...selectedIds, referenceId].some((bodyId) => bodyUsesJplApproximation(bodyId))
}

function bodyUsesEarthMoonSystem(bodyId: BodyId, visited = new Set<BodyId>()): boolean {
  if (visited.has(bodyId)) return false
  visited.add(bodyId)
  if (bodyId === 'earth' || bodyId === 'moon') return true
  const body = majorBodiesById.get(bodyId)
  return body?.parentId ? bodyUsesEarthMoonSystem(body.parentId, visited) : false
}

export function sceneUsesEarthMoonSystem(selectedIds: BodyId[], referenceId: BodyId) {
  return [...selectedIds, referenceId].some((bodyId) => bodyUsesEarthMoonSystem(bodyId))
}

export function createSceneExportModelEvidenceLines(
  language: 'en' | 'zh',
  selectedIds: BodyId[],
  referenceId: BodyId,
  startJulianDay: number,
  endJulianDay: number,
  trajectoryAudit?: BackendTrajectoryAudit | null,
) {
  if (trajectoryAudit === null) return [language === 'zh' ? '后端历史采样尚未完成或不可用；不以浏览器模型替代其证据。' : 'Backend history is pending or unavailable; browser models do not replace its evidence.']
  if (trajectoryAudit) return [
    `Backend Float64 samples · TDB / ECLIPJ2000 · reference ${trajectoryAudit.referenceId}`,
    `UTC JD ${trajectoryAudit.startUtcJd.toFixed(6)} → ${trajectoryAudit.endUtcJd.toFixed(6)} · ${trajectoryAudit.epochsTdbJd.length} samples`,
    `catalog SHA256 ${trajectoryAudit.catalogManifestSha256}`,
    language === 'zh' ? '连线为显示插值，不代表连续精确星历；缺失采样不以近似补齐。' : 'Lines are display interpolation, not certified continuous ephemerides; missing samples are not approximated.',
  ]
  const loaded = loadedKernelIds()
  if (loaded.length) {
    const bodies = [...new Set([...selectedIds, referenceId])].map((id) => majorBodiesById.get(id) ?? { id })
    const covered = bodies.filter((body) => kernelCoverage(body, endJulianDay).model === 'jpl-spk')
    const windowFiles = kernelsForWindow(startJulianDay, endJulianDay)
    return [
      `${EPHEMERIS_MANIFEST.id} · J2000 ecliptic · geometric · UTC → TT → TDB`,
      language === 'zh' ? `当前 SPK 覆盖 ${covered.length}/${bodies.length}；其余使用已有近似模型或标记为无状态。` : `Current SPK coverage ${covered.length}/${bodies.length}; other bodies use an existing approximation or are unavailable.`,
      language === 'zh' ? `轨迹全窗可用 ${windowFiles.length} 个内核；缺少完整中心链时整段使用已有回退或省略，精度因对象而异。` : `${windowFiles.length} kernels cover the entire trail; an incomplete center chain uses an existing fallback or omits the trail. Accuracy varies by body.`,
      `https://github.com/dajiaohuang/solar/blob/main/src/data/ephemeris-manifest${EPHEMERIS_MANIFEST.profile === 'full' ? '-full' : ''}.json`,
    ]
  }
  if (!sceneUsesJplApproximation(selectedIds, referenceId)) {
    return [language === 'zh'
      ? '所选场景未使用 JPL Table 1 行星近似模型。'
      : 'The selected scene does not use the JPL Table 1 planetary approximation.']
  }
  const validityState = jplApproxWindowState(startJulianDay, endJulianDay)
  const validityLabel = validityState === 'within-validity'
    ? (language === 'zh' ? '轨迹时间窗在有效范围内' : 'trajectory window within validity')
    : (language === 'zh' ? '轨迹时间窗含外推' : 'trajectory window includes extrapolation')
  const usesEarthMoonSystem = sceneUsesEarthMoonSystem(selectedIds, referenceId)
  const earthIdentity = language === 'zh'
    ? '轨道种子 = 地月质心 · 渲染地球 = 推导地心'
    : 'orbit seed = Earth–Moon barycenter · rendered Earth = derived geocenter'
  const lines = [
    [JPL_APPROX_MODEL_EVIDENCE.id, `${JPL_APPROX_MODEL_EVIDENCE.validFrom}/${JPL_APPROX_MODEL_EVIDENCE.validTo}`, usesEarthMoonSystem ? earthIdentity : null, validityLabel].filter(Boolean).join(' · '),
    JPL_APPROX_MODEL_EVIDENCE.sourceUrl,
  ]
  if (usesEarthMoonSystem) {
    lines.push(
      `${EARTH_MOON_MASS_PARTITION_EVIDENCE.id} · ${EARTH_MOON_MASS_PARTITION_EVIDENCE.unit} · ${EARTH_MOON_MASS_PARTITION_EVIDENCE.precisionBoundary}`,
      EARTH_MOON_MASS_PARTITION_EVIDENCE.sourceUrl,
    )
  }
  return lines
}
