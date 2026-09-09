import { describe, expect, it } from 'vitest'
import { createSceneExportModelEvidenceLines, sceneUsesEarthMoonSystem, sceneUsesJplApproximation } from '../../src/lib/sceneExportEvidence'
import { dateToJulianDay } from '../../src/lib/julianDate'
import type { BackendTrajectoryAudit } from '../../src/lib/backendTrajectories'

describe('annotated scene export model evidence', () => {
  const jd = (date: string) => dateToJulianDay(new Date(`${date}T00:00:00Z`))

  it('uses the actual backend history window and never attributes it to browser fallback models', () => {
    const audit = { referenceId: 'earth', startUtcJd: 2451545, endUtcJd: 2451546, epochsTdbJd: new Float64Array(3), catalogManifestSha256: 'a'.repeat(64) } as BackendTrajectoryAudit
    const lines = createSceneExportModelEvidenceLines('en', ['moon'], 'earth', 2460000, 2460100, audit).join('\n')
    expect(lines).toContain('2451545.000000 → 2451546.000000')
    expect(lines).toContain('3 samples'); expect(lines).toContain('display interpolation')
    expect(lines).not.toContain('jpl-approx-table-1'); expect(lines).not.toContain('2460000')
    expect(createSceneExportModelEvidenceLines('zh', ['moon'], 'earth', 0, 1, audit).join('\n')).toContain('缺失采样不以近似补齐')
    expect(createSceneExportModelEvidenceLines('en', ['moon'], 'earth', 0, 1, null).join('\n')).toContain('pending or unavailable')
  })

  it('tracks planetary parent models and the full trajectory interval', () => {
    expect(sceneUsesJplApproximation(['moon'], 'sun')).toBe(true)
    const lines = createSceneExportModelEvidenceLines('en', ['moon'], 'sun', jd('1799-12-31'), jd('1800-12-31'))
    expect(lines[0]).toContain('orbit seed = Earth–Moon barycenter')
    expect(lines[0]).toContain('rendered Earth = derived geocenter')
    expect(lines[0]).toContain('trajectory window includes extrapolation')
    expect(lines[2]).toContain('de440-earth-moon-gm-partition-v1')
    expect(lines[3]).toContain('gm_de440.tpc')
  })

  it('includes the active reference body in model dependency detection', () => {
    expect(sceneUsesJplApproximation(['ceres'], 'earth')).toBe(true)
    expect(sceneUsesEarthMoonSystem(['ceres'], 'earth')).toBe(true)
    expect(createSceneExportModelEvidenceLines('en', ['ceres'], 'earth', jd('2026-01-01'), jd('2026-12-31'))[0]).toContain('jpl-approx-table-1')
  })

  it('does not attribute the Earth-Moon partition to other JPL planets', () => {
    expect(sceneUsesEarthMoonSystem(['mars'], 'sun')).toBe(false)
    const lines = createSceneExportModelEvidenceLines('en', ['mars'], 'sun', jd('2026-01-01'), jd('2026-12-31'))
    expect(lines).toHaveLength(2)
    expect(lines.join('\n')).not.toContain('Earth–Moon')
    expect(lines.join('\n')).not.toContain('de440-earth-moon-gm-partition-v1')
  })

  it('localizes the complete evidence line and omits an inactive model', () => {
    const chinese = createSceneExportModelEvidenceLines('zh', ['earth'], 'sun', jd('2026-01-01'), jd('2026-12-31'))
    expect(chinese[0]).toContain('轨道种子 = 地月质心')
    expect(chinese[0]).toContain('渲染地球 = 推导地心')
    expect(chinese[0]).toContain('轨迹时间窗在有效范围内')
    expect(chinese[0]).not.toContain('Earth')
    expect(createSceneExportModelEvidenceLines('en', ['ceres', 'pluto'], 'sun', jd('2051-01-01'), jd('2052-01-01'))).toEqual([
      'The selected scene does not use the JPL Table 1 planetary approximation.',
    ])
  })
})
