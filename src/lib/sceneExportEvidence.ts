import { majorBodiesById } from '../data/majorBodies'
import {
  JPL_APPROX_MODEL_EVIDENCE,
  jplApproxWindowState,
} from '../engine/ephemeris/modelValidity'
import type { BodyId } from '../types'

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

export function createSceneExportModelEvidenceLines(
  language: 'en' | 'zh',
  selectedIds: BodyId[],
  referenceId: BodyId,
  startJulianDay: number,
  endJulianDay: number,
) {
  if (!sceneUsesJplApproximation(selectedIds, referenceId)) {
    return [language === 'zh'
      ? '所选场景未使用 JPL Table 1 行星近似模型。'
      : 'The selected scene does not use the JPL Table 1 planetary approximation.']
  }
  const validityState = jplApproxWindowState(startJulianDay, endJulianDay)
  const validityLabel = validityState === 'within-validity'
    ? (language === 'zh' ? '轨迹时间窗在有效范围内' : 'trajectory window within validity')
    : (language === 'zh' ? '轨迹时间窗含外推' : 'trajectory window includes extrapolation')
  const earthPoint = language === 'zh' ? '地球点位 = 地月质心' : 'Earth point = Earth–Moon barycenter'
  return [
    `${JPL_APPROX_MODEL_EVIDENCE.id} · ${JPL_APPROX_MODEL_EVIDENCE.validFrom}/${JPL_APPROX_MODEL_EVIDENCE.validTo} · ${earthPoint} · ${validityLabel}`,
    JPL_APPROX_MODEL_EVIDENCE.sourceUrl,
  ]
}
