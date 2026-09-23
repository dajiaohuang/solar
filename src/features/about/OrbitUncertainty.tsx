import { useEffect, useMemo, useRef, useState } from 'react'
import gmText from '../../data/gm_de440.tpc?raw'
import { parseSbdbCovariance, type SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import { cartesianCovarianceAtSolutionEpoch } from '../../engine/ephemeris/orbitCovariance'
import { covarianceProjection } from '../../engine/ephemeris/covarianceProjection'
import { covarianceEllipsoid } from '../../engine/ephemeris/covarianceEllipsoid'
import { CovarianceEllipsoid } from './CovarianceEllipsoid'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'

const AU_KM = 149597870.7
const GM_SHA = '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140'
type Loaded = { source: SbdbCovariance; sourceSha256: string; sourceBytes: number; sourceName: string }
type Converted = ReturnType<typeof cartesianCovarianceAtSolutionEpoch>
const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')

export function OrbitUncertainty() {
  const { language } = useI18n(), zh = language === 'zh'
  const [loaded, setLoaded] = useState<Loaded | null>(null), [result, setResult] = useState<Converted | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  const ellipsoid = useMemo(() => {
    if (!result) return null
    try { return covarianceEllipsoid(result.matrix, AU_KM) } catch { return null }
  }, [result])
  useEffect(() => () => { generation.current++ }, [])
  const clear = () => { generation.current++; setLoaded(null); setResult(null); setError(''); setBusy(false) }
  const read = async (file: File) => {
    clear()
    const current = generation.current
    setBusy(true)
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(zh ? '文件超过 2 MiB 上限。' : 'The file exceeds the 2 MiB limit.')
      const bytes = await file.arrayBuffer()
      if (current !== generation.current) return
      const source = parseSbdbCovariance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      const sourceSha256 = await sha(bytes)
      if (current === generation.current) setLoaded({ source, sourceSha256, sourceBytes: bytes.byteLength, sourceName: file.name })
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const convert = async () => {
    if (!loaded) return
    const current = ++generation.current
    setBusy(true); setError(''); setResult(null)
    try {
      const gmBytes = new TextEncoder().encode(gmText)
      if (await sha(gmBytes.buffer) !== GM_SHA) throw new Error('Bundled DE440 GM source hash mismatch')
      const value = gmText.match(/BODY10_GM\s*=\s*\(\s*([\d.Ee+-]+)/)?.[1]
      const au3PerDay2 = Number(value) * 86400 ** 2 / AU_KM ** 3
      const converted = cartesianCovarianceAtSolutionEpoch(loaded.source, { au3PerDay2,
        source: `Explicitly adopted DE440 solar GM; SHA-256 ${GM_SHA}; not asserted to reproduce the source orbit-fit force model` })
      if (current === generation.current) setResult(converted)
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  return <section className="evidence-module glass-panel orbit-uncertainty" aria-label={zh ? '轨道不确定性' : 'Orbit uncertainty'}>
    <div className="module-heading"><span>{zh ? '轨道不确定性' : 'Orbit uncertainty'}</span><em>SBDB</em></div>
    <p>{zh ? '导入 JPL SBDB 的全精度协方差 JSON，检查解算历元的形式不确定性。文件在浏览器内处理。' : 'Import a full-precision JPL SBDB covariance JSON to inspect formal uncertainty at its solution epoch. Files are processed in your browser.'}</p>
    <p><a href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html#orbit-subsection-covariance" target="_blank" rel="noreferrer">JPL SBDB · cov=mat · full-prec=1</a></p>
    <label className="field"><span>{zh ? 'SBDB 协方差 JSON 文件' : 'SBDB covariance JSON file'}</span><input type="file" accept=".json,application/json" onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void read(file)
    }} /></label>
    {busy && <p role="status">{zh ? '正在校验…' : 'Validating…'}</p>}
    {(loaded || busy || error) && <button type="button" className="secondary-button" onClick={clear}>{zh ? '清除不确定性数据' : 'Clear uncertainty data'}</button>}
    {error && <p role="alert">{error}</p>}
    {loaded && <>
      <dl className="contract-list">
        <div><dt>{zh ? '已导入文件' : 'Imported file'}</dt><dd>{loaded.sourceName}</dd></div>
        <div><dt>{zh ? '天体 / 解算编号' : 'Designation / solution'}</dt><dd>{loaded.source.designation} / {loaded.source.solutionId}</dd></div>
        <div><dt>{zh ? '协方差历元' : 'Covariance epoch'}</dt><dd>JD {loaded.source.solutionEpochTdb} TDB</dd></div>
        <div><dt>{zh ? '标准要素历元' : 'Standard element epoch'}</dt><dd>JD {loaded.source.standardElementEpochTdb} TDB</dd></div>
        <div><dt>{zh ? '源解算星历' : 'Source fit ephemeris'}</dt><dd>{loaded.source.planetaryEphemeris ?? '—'} / {loaded.source.smallBodyEphemeris ?? '—'}</dd></div>
        <div><dt>{zh ? '全部协方差轴' : 'All covariance axes'}</dt><dd>{loaded.source.labels.join(', ')}</dd></div>
      </dl>
      <p className="checksum">SHA-256 {loaded.sourceSha256}</p>
      <p>{zh ? '坐标转换需指定太阳引力参数。以下操作明确采用已校验的 DE440 常数；这不保证复现源轨道拟合所用的动力学模型。' : 'Coordinate conversion needs a solar gravitational parameter. The following action explicitly adopts the verified DE440 constant; it does not establish equivalence to the source orbit-fit model.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={() => { void convert() }}>{zh ? '采用 DE440 GM 并计算' : 'Adopt DE440 GM and calculate'}</button>
    </>}
    {result && loaded && <div data-testid="orbit-uncertainty-result">
      <p>{zh ? '日心 IAU76/80 J2000 黄道坐标，解算历元的一阶协方差转换。' : 'Heliocentric IAU76/80 J2000 ecliptic coordinates; first-order covariance conversion at the solution epoch.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '坐标分量的形式标准差' : 'Formal coordinate standard deviations'}</caption><thead><tr><th>{zh ? '分量' : 'Axis'}</th><th>σ</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{result.labels.map((label, i) => {
        const scale = i < 3 ? AU_KM : i < 6 ? AU_KM / 86400 : 1
        return <tr key={label}><th>{label}</th><td>{(result.marginalSigmas[i] * scale).toExponential(5)}</td><td>{i < 3 ? 'km' : i < 6 ? 'km/s' : result.units[i] ?? '1'}</td></tr>
      })}</tbody></table></div>
      <div className="uncertainty-projections">{[[0, 1], [0, 2], [1, 2]].map(([a, b]) => <Projection key={`${a}${b}`} matrix={result.matrix} first={a} second={b} zh={zh} />)}</div>
      <p>{zh ? '椭圆为二维投影协方差的单位马氏距离轮廓。尚未随时间传播，不用于估计事件概率；形式协方差不包含全部物理模型误差。' : 'Ellipses are unit-Mahalanobis contours of the projected covariance. No time propagation or event probability is calculated; formal covariance does not cover every physical model error.'}</p>
      {ellipsoid ? <CovarianceEllipsoid geometry={ellipsoid} zh={zh} /> : <p>{zh ? '三维椭球无法可靠分解，未修补协方差。' : 'The 3D ellipsoid cannot be factored reliably; covariance has not been repaired.'}</p>}
      <button type="button" className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ schemaVersion: 1, calculation: 'solution-epoch-coordinate-covariance', ...loaded, adoptedGmSourceSha256: GM_SHA, result, positionEllipsoid: ellipsoid ? { ...ellipsoid, units: 'km', frame: result.frame } : null }, null, 2), `solar-covariance-${loaded.source.designation.replace(/[^\w-]/g, '_')}.json`, 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出协方差与来源 JSON' : 'Export covariance and source JSON'}</button>
    </div>}
  </section>
}

function Projection({ matrix, first, second, zh }: { matrix: number[][]; first: number; second: number; zh: boolean }) {
  const labels = ['x', 'y', 'z'], name = `${labels[first]} / ${labels[second]}`
  let projection: ReturnType<typeof covarianceProjection>
  try {
    projection = covarianceProjection(matrix, first, second, AU_KM)
  } catch { return <p>{name}: {zh ? '投影无法可靠计算。' : 'Projection cannot be evaluated reliably.'}</p> }
  const extent = projection.major * 1.2 || 1
  return <figure><svg viewBox="0 0 160 160" role="img" aria-label={`${name} ${zh ? '协方差投影椭圆' : 'covariance projection ellipse'}`}>
      <path d="M15 80H145M80 15V145" className="uncertainty-axis" />
      <g transform={`translate(80 80) rotate(${-projection.angleRadians * 180 / Math.PI})`}>
        <ellipse rx={projection.major / extent * 65} ry={projection.minor / extent * 65} className="uncertainty-contour" />
      </g>
      <text x="146" y="75" textAnchor="end">Δ{labels[first]}</text><text x="85" y="18">Δ{labels[second]}</text>
    </svg><figcaption>{name} · ±{extent.toExponential(2)} km</figcaption></figure>
}
