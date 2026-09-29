import { useEffect, useMemo, useRef, useState } from 'react'
import gmText from '../../data/gm_de440.tpc?raw'
import { parseSbdbCovariance, type SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import { cartesianCovarianceAtSolutionEpoch } from '../../engine/ephemeris/orbitCovariance'
import { covarianceProjection } from '../../engine/ephemeris/covarianceProjection'
import { covarianceEllipsoid } from '../../engine/ephemeris/covarianceEllipsoid'
import { CovarianceEllipsoid } from './CovarianceEllipsoid'
import { CovarianceTimePropagation } from './CovarianceTimePropagation'
import { NonlinearOrbitEnsemble } from './NonlinearOrbitEnsemble'
import { EnsembleDistanceEvents } from './EnsembleDistanceEvents'
import { CovarianceCoordinateModel } from './CovarianceCoordinateModel'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { readScientificSourceFile } from '../../lib/scientificSourceFile'

const AU_KM = 149597870.7
const GM_SHA = '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140'
type Loaded = { source: SbdbCovariance; sourceSha256: string; sourceBytes: number; sourceName: string; originalBase64: string }
type Converted = ReturnType<typeof cartesianCovarianceAtSolutionEpoch>
const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')
const extraCovarianceAxes = (source: SbdbCovariance) => source.labels.slice(6).map((label, index) => ({
  label, value: source.nominal[index + 6], units: source.units[index + 6],
}))

export function OrbitUncertainty() {
  const { language } = useI18n(), zh = language === 'zh'
  const [loaded, setLoaded] = useState<Loaded | null>(null), [result, setResult] = useState<Converted | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [inputBytes, setInputBytes] = useState<ArrayBuffer | null>(null)
  const generation = useRef(0)
  const sourceRead = useRef<AbortController | null>(null)
  const workTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ellipsoid = useMemo(() => {
    if (!result) return null
    try { return covarianceEllipsoid(result.matrix, AU_KM) } catch { return null }
  }, [result])
  const stop = () => {
    generation.current++; sourceRead.current?.abort(); sourceRead.current = null
    clearTimeout(workTimer.current); workTimer.current = undefined
  }
  useEffect(() => () => { generation.current++; sourceRead.current?.abort(); sourceRead.current = null; clearTimeout(workTimer.current); workTimer.current = undefined }, [])
  const clear = () => { stop(); setLoaded(null); setInputBytes(null); setResult(null); setError(''); setBusy(false) }
  const beginWork = () => {
    stop()
    const current = generation.current, controller = new AbortController(), deadline = performance.now()+30000
    sourceRead.current = controller; setBusy(true); setError(''); setResult(null)
    const finish = () => {
      if (sourceRead.current !== controller) return
      sourceRead.current = null; clearTimeout(workTimer.current); workTimer.current = undefined; setBusy(false)
    }
    const expire = () => {
      if (current !== generation.current || sourceRead.current !== controller) return
      generation.current++; controller.abort(); finish()
      setError(zh ? '协方差处理超过 30 秒时限，请重试。' : 'Covariance processing exceeded its 30-second limit; retry the operation.')
    }
    workTimer.current = setTimeout(expire,30000)
    const check = () => {
      if (current !== generation.current || controller.signal.aborted) return false
      if (performance.now() >= deadline) { expire(); return false }
      return true
    }
    return { controller, check, finish }
  }
  const read = async (file: File) => {
    clear()
    const work = beginWork()
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(zh ? '文件超过 2 MiB 上限。' : 'The file exceeds the 2 MiB limit.')
      const bytes = await readScientificSourceFile(file,work.controller.signal)
      if (!work.check()) return
      const source = parseSbdbCovariance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      const originalBase64 = dynamicsSourceBase64(bytes)
      if (!work.check()) return
      const sourceSha256 = await sha(bytes)
      if (work.check()) { setLoaded({ source, sourceSha256, sourceBytes: bytes.byteLength, sourceName: file.name, originalBase64 }); setInputBytes(bytes) }
    } catch (reason) { if (work.check()) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { work.finish() }
  }
  const loadPinned67pExample = async () => {
    clear()
    const requestGeneration = generation.current
    setBusy(true)
    try {
      const { default: sourceText } = await import('../../../tests/fixtures/sbdb-67p-covariance.json?raw')
      if (requestGeneration !== generation.current) return
      setBusy(false)
      await read(new File([sourceText], 'sbdb-67p-k284-1-covariance.json', { type: 'application/json' }))
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }
  const loadPinnedBorisovExample = async () => {
    clear()
    const requestGeneration = generation.current
    setBusy(true)
    try {
      const { default: sourceText } = await import('../../../tests/fixtures/sbdb-borisov-covariance-20260929/c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987.json?raw')
      if (requestGeneration !== generation.current) return
      setBusy(false)
      await read(new File([sourceText], 'sbdb-borisov-jpl54-covariance.json', { type: 'application/json' }))
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }
  const convert = async () => {
    if (!loaded) return
    const work = beginWork()
    try {
      const gmBytes = new TextEncoder().encode(gmText)
      const gmHash = await sha(gmBytes.buffer)
      if (!work.check()) return
      if (gmHash !== GM_SHA) throw new Error('Bundled DE440 GM source hash mismatch')
      const value = gmText.match(/BODY10_GM\s*=\s*\(\s*([\d.Ee+-]+)/)?.[1]
      const au3PerDay2 = Number(value) * 86400 ** 2 / AU_KM ** 3
      const converted = cartesianCovarianceAtSolutionEpoch(loaded.source, { au3PerDay2,
        source: `Explicitly adopted DE440 solar GM; SHA-256 ${GM_SHA}; not asserted to reproduce the source orbit-fit force model` })
      if (work.check()) setResult(converted)
    } catch (reason) { if (work.check()) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { work.finish() }
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
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { void loadPinned67pExample() }}>
      {zh ? '载入固定的 67P K284/1 协方差样例' : 'Load pinned 67P K284/1 covariance example'}
    </button>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { void loadPinnedBorisovExample() }}>
      {zh ? '载入固定的 Borisov JPL #54 协方差样例' : 'Load pinned Borisov JPL #54 covariance example'}
    </button>
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
      {loaded.source.modelParameters.length > 0 && <details>
        <summary>{zh ? 'SBDB 轨道模型参数（不全是协方差轴）' : 'SBDB orbit-model parameters (not all are covariance axes)'}</summary>
        <p>{zh ? '保留每项参数的来源类型与单位；只有协方差 labels 中的估计参数才属于该联合矩阵。' : 'Source kind and units are retained for every entry. Only estimated parameters named in covariance labels belong to the joint matrix.'}</p>
        <div className="uncertainty-table"><table>
          <thead><tr><th>{zh ? '参数' : 'Parameter'}</th><th>n</th><th>{zh ? '来源类型' : 'Source kind'}</th><th>{zh ? '标称值' : 'Nominal value'}</th><th>{zh ? '单位' : 'Unit'}</th><th>σ</th><th>{zh ? '定义' : 'Definition'}</th></tr></thead>
          <tbody>{loaded.source.modelParameters.map(parameter => <tr key={parameter.name}>
            <th>{parameter.name}</th><td>{parameter.index ?? '—'}</td><td>{parameter.kind}</td><td>{parameter.value.toPrecision(15)}</td>
            <td>{parameter.units ?? (zh ? '未声明' : 'unspecified')}</td>
            <td>{parameter.sigma === null ? '—' : parameter.sigma.toExponential(5)}</td>
            <td>{parameter.description ?? parameter.title ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      <p className="checksum">SHA-256 {loaded.sourceSha256}</p>
      <details>
        <summary>{zh ? '源参数、单位与形式标准差' : 'Source parameters, units and formal standard deviations'}</summary>
        <div className="uncertainty-table"><table>
          <caption>{zh ? '解算历元的原始协方差轴顺序' : 'Original covariance axis order at the solution epoch'}</caption>
          <thead><tr><th>{zh ? '参数' : 'Parameter'}</th><th>{zh ? '标称值' : 'Nominal value'}</th><th>{zh ? '标称值单位' : 'Nominal unit'}</th><th>σ</th><th>{zh ? '标准差单位' : 'Standard-deviation unit'}</th></tr></thead>
          <tbody>{loaded.source.labels.map((label, i) => {
            const unit = loaded.source.units[i] ?? (i < 6 && label === 'e' ? (zh ? '无量纲' : 'dimensionless') : (zh ? '单位未声明' : 'unit unspecified'))
            return <tr key={label}><th>{label}</th><td>{loaded.source.nominal[i].toPrecision(15)}</td><td>{i < 6 && label === 'tp' ? 'JD TDB' : unit}</td><td>{loaded.source.marginalSigmas[i].toExponential(5)}</td><td>{unit}</td></tr>
          })}</tbody>
        </table></div>
        <p>{zh ? '近日点时刻的标称值为 TDB 儒略日，其标准差以天表示。附加参数未声明单位时，不推断为无量纲。显示位数不代表物理精度；导出保留解析值与原始来源字节。' : 'The nominal periapsis epoch is a TDB Julian date; its standard deviation is in days. Missing additional-parameter units are not inferred to be dimensionless. Displayed digits do not establish physical accuracy; exports retain parsed values and original source bytes.'}</p>
      </details>
      <p>{zh ? '坐标转换需指定太阳引力参数。以下操作明确采用已校验的 DE440 常数；这不保证复现源轨道拟合所用的动力学模型。' : 'Coordinate conversion needs a solar gravitational parameter. The following action explicitly adopts the verified DE440 constant; it does not establish equivalence to the source orbit-fit model.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={() => { void convert() }}>{zh ? '采用 DE440 GM 并计算' : 'Adopt DE440 GM and calculate'}</button>
    </>}
    {result && loaded && <div data-testid="orbit-uncertainty-result">
      <CovarianceCoordinateModel conversion={result} zh={zh} />
      <p>{zh ? '日心 IAU76/80 J2000 黄道坐标，解算历元的一阶协方差转换。' : 'Heliocentric IAU76/80 J2000 ecliptic coordinates; first-order covariance conversion at the solution epoch.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '坐标分量的形式标准差' : 'Formal coordinate standard deviations'}</caption><thead><tr><th>{zh ? '分量' : 'Axis'}</th><th>σ</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{result.labels.map((label, i) => {
        const scale = i < 3 ? AU_KM : i < 6 ? AU_KM / 86400 : 1
        return <tr key={label}><th>{label}</th><td>{(result.marginalSigmas[i] * scale).toExponential(5)}</td><td>{i < 3 ? 'km' : i < 6 ? 'km/s' : result.units[i] ?? (zh ? '单位未声明' : 'unit unspecified')}</td></tr>
      })}</tbody></table></div>
      <div className="uncertainty-projections">{[[0, 1], [0, 2], [1, 2]].map(([a, b]) => <Projection key={`${a}${b}`} matrix={result.matrix} first={a} second={b} zh={zh} />)}</div>
      <p>{zh ? '椭圆为二维投影协方差的单位马氏距离轮廓。尚未随时间传播，不用于估计事件概率；形式协方差不包含全部物理模型误差。' : 'Ellipses are unit-Mahalanobis contours of the projected covariance. No time propagation or event probability is calculated; formal covariance does not cover every physical model error.'}</p>
      {ellipsoid ? <CovarianceEllipsoid geometry={ellipsoid} zh={zh} /> : <p>{zh ? '三维椭球无法可靠分解，未修补协方差。' : 'The 3D ellipsoid cannot be factored reliably; covariance has not been repaired.'}</p>}
      <button type="button" className="secondary-button" onClick={() => { const current = generation.current; void saveTextExport(JSON.stringify({ schemaVersion: 1, calculation: 'solution-epoch-coordinate-covariance', ...loaded, adoptedGmSourceSha256: GM_SHA, result, positionEllipsoid: ellipsoid ? { ...ellipsoid, units: 'km', frame: result.frame } : null }, null, 2), `solar-covariance-${loaded.source.designation.replace(/[^\w-]/g, '_')}.json`, 'application/json').catch(reason => { if (current === generation.current) setError(String(reason)) }) }}>{zh ? '导出协方差与来源 JSON' : 'Export covariance and source JSON'}</button>
    </div>}
    {loaded && inputBytes && <CovarianceTimePropagation key={`covariance:${loaded.sourceSha256}`} bytes={inputBytes} dimension={loaded.source.labels.length}
      extraAxes={extraCovarianceAxes(loaded.source)} zh={zh} />}
    {loaded && inputBytes && <NonlinearOrbitEnsemble key={`ensemble:${loaded.sourceSha256}`} bytes={inputBytes} dimension={loaded.source.labels.length}
      extraAxes={extraCovarianceAxes(loaded.source)} zh={zh} />}
    {loaded && inputBytes && <EnsembleDistanceEvents key={`events:${loaded.sourceSha256}`} bytes={inputBytes} dimension={loaded.source.labels.length}
      extraAxes={extraCovarianceAxes(loaded.source)} zh={zh} />}
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
