import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { backendSnapshotDiagnostics } from '../../lib/backendSnapshotDiagnostics'
import { saveTextExport } from '../../lib/platform'
import type { BackendFrame } from '../../lib/backendFrames'
import type { CelestialBody } from '../../types'

export function BackendSnapshotReadout({ frame, body, reference }: { frame: BackendFrame | null; body: CelestialBody; reference: CelestialBody | undefined }) {
  const { language } = useI18n(), zh = language === 'zh'
  const [error, setError] = useState('')
  const result = useMemo(() => frame && reference ? backendSnapshotDiagnostics(frame, body, reference) : null, [frame, body, reference])
  const format = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString(language, { maximumSignificantDigits: 8 })
  return <details className="model-note">
    <summary>{zh ? '当前帧相对运动诊断' : 'Current-frame relative-motion diagnostics'}</summary>
    {!result ? <p>{zh ? '需要两个不同目标在同一帧中的完整精确状态。' : 'Two distinct objects with complete exact states in the same frame are required.'}</p> : <>
      <p>{bodyDisplayName(body, language)} → {reference && bodyDisplayName(reference, language)} · TDB JD {result.epochTdbJd.toFixed(6)}</p>
      <dl>
        <dt>{zh ? '几何距离 / km' : 'Geometric range / km'}</dt><dd>{format(result.distanceKm)}</dd>
        <dt>{zh ? '相对速率 / km/s' : 'Relative speed / km/s'}</dt><dd>{format(result.speedKmPerSecond)}</dd>
        <dt>{zh ? '距离变化率（正值为远离）/ km/s' : 'Range rate (positive = receding) / km/s'}</dt><dd>{format(result.rangeRateKmPerSecond)}</dd>
        {result.conic && <>
          <dt>{zh ? '瞬时偏心率' : 'Instantaneous eccentricity'}</dt><dd>{format(result.conic.eccentricity)}</dd>
          <dt>{zh ? '瞬时近心距 / km' : 'Instantaneous periapsis / km'}</dt><dd>{format(result.conic.periapsisKm)}</dd>
          <dt>{zh ? '半长轴（开放轨道可为负）/ km' : 'Semimajor axis (can be negative for open conics) / km'}</dt><dd>{format(result.conic.semiMajorAxisKm)}</dd>
          <dt>{zh ? '轨道倾角 / °' : 'Inclination / °'}</dt><dd>{format(result.conic.inclinationDeg)}</dd>
        </>}
      </dl>
      {result.conic?.nearParabolic && <p>{zh ? '接近抛物线退化区，半长轴未定义为有限值。' : 'Near the parabolic degeneracy; no finite semimajor axis is reported.'}</p>}
      {result.gm ? <p>GM = {format(result.gm.valueKm3PerSecond2)} km³/s² · <a href={result.gm.source} target="_blank" rel="noreferrer">DE440</a><br />{result.gm.secondaryGm === null
        ? (zh ? '目标 GM 缺失，明确采用仅参考天体 GM 的近似。' : 'Target GM is unavailable; the approximation uses only the reference GM.')
        : (zh ? '采用参考天体与目标 GM 之和。' : 'Uses the sum of reference and target GM.')}</p>
        : <p>{zh ? '参考天体 GM 不可用，未计算圆锥轨道诊断。' : 'Reference GM is unavailable; conic diagnostics were not computed.'}</p>}
      <p>{zh ? '这些是同时刻几何量，不是光行时修正或观测多普勒量。瞬时二体诊断不能用作未来轨迹；两个来源也不保证属于同一动力学拟合。' : 'These are simultaneous geometric quantities, not light-time-corrected or observed Doppler quantities. Instantaneous two-body diagnostics are not a future trajectory; the sources need not share one dynamical fit.'}</p>
      <button type="button" onClick={() => { setError(''); void saveTextExport(JSON.stringify(result, null, 2), 'solar-snapshot-diagnostics.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出状态、诊断与来源' : 'Export states, diagnostics and sources'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>
}
