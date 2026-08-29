import { describe, expect, it } from 'vitest'
import { createSceneExportModelEvidenceLines, sceneUsesJplApproximation } from '../../src/lib/sceneExportEvidence'
import { dateToJulianDay } from '../../src/lib/julianDate'

describe('annotated scene export model evidence', () => {
  const jd = (date: string) => dateToJulianDay(new Date(`${date}T00:00:00Z`))

  it('tracks planetary parent models and the full trajectory interval', () => {
    expect(sceneUsesJplApproximation(['moon'], 'sun')).toBe(true)
    const lines = createSceneExportModelEvidenceLines('en', ['moon'], 'sun', jd('1799-12-31'), jd('1800-12-31'))
    expect(lines[0]).toContain('Earth point = Earth–Moon barycenter')
    expect(lines[0]).toContain('trajectory window includes extrapolation')
  })

  it('includes the active reference body in model dependency detection', () => {
    expect(sceneUsesJplApproximation(['ceres'], 'earth')).toBe(true)
    expect(createSceneExportModelEvidenceLines('en', ['ceres'], 'earth', jd('2026-01-01'), jd('2026-12-31'))[0]).toContain('jpl-approx-table-1')
  })

  it('localizes the complete evidence line and omits an inactive model', () => {
    const chinese = createSceneExportModelEvidenceLines('zh', ['earth'], 'sun', jd('2026-01-01'), jd('2026-12-31'))
    expect(chinese[0]).toContain('地球点位 = 地月质心')
    expect(chinese[0]).toContain('轨迹时间窗在有效范围内')
    expect(chinese[0]).not.toContain('Earth')
    expect(createSceneExportModelEvidenceLines('en', ['ceres', 'pluto'], 'sun', jd('2051-01-01'), jd('2052-01-01'))).toEqual([
      'The selected scene does not use the JPL Table 1 planetary approximation.',
    ])
  })
})
