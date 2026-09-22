import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { backendBodyId } from '../../lib/currentStateIdentity'
import { GroundObservationError, loadGroundObservation, type GroundObservation, type GroundObservationRequest } from '../../lib/groundObservation'
import { julianDayToDate } from '../../lib/julianDate'
import { saveTextExport } from '../../lib/platform'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'
import type { CelestialBody } from '../../types'

export function GroundObserverReadout({ body, julianDay }: { body: CelestialBody; julianDay: number }) {
  const { language } = useI18n(), zh = language === 'zh'
  const [utc, setUtc] = useState(() => julianDayToDate(julianDay).toISOString())
  const [station, setStation] = useState({ longitudeDeg: '0', latitudeDeg: '0', heightMeters: '0' })
  const [weather, setWeather] = useState({ pressureHPa: '1013.25', temperatureC: '15', relativeHumidity: '0.5', wavelengthMicrometers: '0.55' })
  const [refraction, setRefraction] = useState(false), [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GroundObservation | null>(null), [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || null
  const available = PRODUCT_PROFILE === 'full' && Boolean(base)
  const clear = () => { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { active.current?.abort() }, [])
  const run = async () => {
    clear()
    const controller = new AbortController(); active.current = controller; setBusy(true)
    const request: GroundObservationRequest = { utc, bodyIds: [backendBodyId(body)], station: { longitudeDeg: Number(station.longitudeDeg), latitudeDeg: Number(station.latitudeDeg), heightMeters: Number(station.heightMeters) },
      ...(refraction ? { atmosphere: { pressureHPa: Number(weather.pressureHPa), temperatureC: Number(weather.temperatureC), relativeHumidity: Number(weather.relativeHumidity), wavelengthMicrometers: Number(weather.wavelengthMicrometers) } } : {}) }
    try {
      const response = await loadGroundObservation(base, PRODUCT_PROFILE, request, controller.signal)
      if (active.current === controller) setResult(response)
    } catch (reason) {
      if (active.current !== controller) return
      const code = reason instanceof GroundObservationError ? reason.code : ''
      setError(code === 'earth_orientation_unavailable' ? (zh ? '服务尚未配置 IERS 地球定向数据。' : 'The service has no IERS Earth orientation snapshot.')
        : code === 'earth_orientation_outside_coverage' ? (zh ? '此时刻超出 IERS 数据覆盖，或位于数据缺口。' : 'This time is outside IERS coverage or inside a data gap.')
          : code === 'observer_ephemeris_unavailable' ? (zh ? '地球中心或太阳缺少此时刻的完整 SPK 星历。' : 'Earth center or Sun lacks complete SPK coverage at this time.')
            : `${zh ? '观测计算失败' : 'Observation failed'}: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const observed = result?.result.bodies[0]
  return <details className="model-note ground-observer">
    <summary>{zh ? '地面观测 · 高度与方位' : 'Ground observer · altitude and azimuth'}</summary>
    <p>{zh ? '输入地球站点与 UTC 时刻，按需计算目标中心的位置。高度为 WGS84 椭球高。' : 'Enter an Earth station and UTC time to calculate the target center on demand. Height is above the WGS84 ellipsoid.'}</p>
    {!available ? <p role="status">{zh ? '此功能需要连接配置了 IERS 与 SPK 数据的完整版后端。' : 'Connect a full backend configured with IERS and SPK data to use this feature.'}</p> : <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label>{zh ? 'UTC 时刻' : 'UTC time'}<input required value={utc} placeholder="2026-09-23T04:00:00Z" onChange={event => { clear(); setUtc(event.target.value) }} /></label>
      <button type="button" onClick={() => { clear(); setUtc(julianDayToDate(julianDay).toISOString()) }}>{zh ? '使用当前模拟时刻' : 'Use simulation time'}</button>
      <div className="ground-observer-fields">{([
        ['longitudeDeg', zh ? '经度 °（东为正）' : 'Longitude ° (east positive)', -180, 180],
        ['latitudeDeg', zh ? '纬度 °' : 'Latitude °', -90, 90],
        ['heightMeters', zh ? '椭球高 m' : 'Ellipsoidal height m', -1000, 100000],
      ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" step="any" required min={min} max={max} value={station[key]} onChange={event => { clear(); setStation({ ...station, [key]: event.target.value }) }} /></label>)}</div>
      <label className="ground-refraction"><input type="checkbox" checked={refraction} onChange={event => { clear(); setRefraction(event.target.checked) }} />{zh ? '按输入气象条件估计折射（仅高度 ≥ 5°）' : 'Estimate refraction from weather inputs (altitude ≥ 5° only)'}</label>
      {refraction && <div className="ground-observer-fields">{([
        ['pressureHPa', zh ? '气压 hPa' : 'Pressure hPa', 0, 1100], ['temperatureC', zh ? '温度 °C' : 'Temperature °C', -100, 100],
        ['relativeHumidity', zh ? '相对湿度 0–1' : 'Relative humidity 0–1', 0, 1], ['wavelengthMicrometers', zh ? '波长 μm' : 'Wavelength μm', 0.1, 1e6],
      ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" step="any" required min={min} max={max} value={weather[key]} onChange={event => { clear(); setWeather({ ...weather, [key]: event.target.value }) }} /></label>)}</div>}
      <button className="primary-button" disabled={busy}>{busy ? (zh ? '计算中…' : 'Calculating…') : (zh ? '计算地面观测' : 'Calculate ground observation')}</button>
      {busy && <button type="button" onClick={clear}>{zh ? '取消' : 'Cancel'}</button>}
    </form>}
    {error && <p role="alert">{error}</p>}
    {result && observed && <section aria-label={zh ? '地面观测结果' : 'Ground observation result'}>
      <p><strong>{bodyDisplayName(body, language)}</strong> · {result.result.request.utc}</p>
      {observed.status === 'missing' ? <p role="status">{zh ? '目标星历不完整，无法计算：' : 'Target ephemeris is incomplete: '}{observed.missingReason}</p> : <>
        <table><thead><tr><th>{zh ? '方向' : 'Direction'}</th><th>{zh ? '方位 °' : 'Azimuth °'}</th><th>{zh ? '高度 °' : 'Altitude °'}</th></tr></thead><tbody>{([
          [zh ? '几何' : 'Geometric', observed.geometric], [zh ? '视位置（无折射）' : 'Apparent (airless)', observed.apparentAirless], [zh ? '含折射估计' : 'Refracted estimate', observed.refracted],
        ] as const).filter(([, value]) => value).map(([label, value]) => <tr key={label}><th>{label}</th><td>{value!.azimuthDeg.toFixed(5)}</td><td>{value!.altitudeDeg.toFixed(5)}</td></tr>)}</tbody></table>
        <p>{zh ? '光时距离' : 'Light-time range'}: {observed.lightTimeRangeKm?.toLocaleString(language, { maximumFractionDigits: 3 })} km · {observed.lightTimeSeconds?.toFixed(6)} s</p>
      </>}
      <p>{result.result.earthOrientation.predicted ? (zh ? 'IERS 含预测值' : 'IERS includes predictions') : (zh ? 'IERS 测量值' : 'IERS measured values')} · {zh ? '数据获取时间' : 'Snapshot retrieved'}: {result.earthOrientation.retrievedAt}</p>
      <p>{zh ? '未传播物理不确定性；不包含地形遮挡、天体边缘、站点潮汐或未来闰秒预测。' : 'Physical uncertainty is not propagated. Terrain, target limbs, station tides and future leap seconds are not modeled.'}</p>
      {refraction && !observed.refracted && observed.status === 'available' && <p>{zh ? '目标低于折射模型的 5° 使用下限，未给出折射值。' : 'The target is below the refraction model’s 5° altitude limit; no refracted value is returned.'}</p>}
      {!result.result.earthOrientation.celestialPoleCorrectionAvailable && <p>{zh ? '天极修正数据缺失，使用岁差章动模型。' : 'Celestial pole corrections are missing; precession-nutation is model-only.'}</p>}
      {observed.warnings.includes('solar-deflection-limited-near-solar-limb') && <p>{zh ? '此方向接近日面，光偏折模型已限幅；不能用于确定日面接触。' : 'Solar light deflection is limited near the solar limb; this result cannot determine limb contact.'}</p>}
      <button type="button" onClick={() => { void saveTextExport(JSON.stringify(result, null, 2), `solar-ground-observation-${body.id.replace(/[^\w-]/g, '_')}.json`, 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出结果与来源 JSON' : 'Export result and sources JSON'}</button>
    </section>}
  </details>
}
