import { useEffect, useRef, useState } from 'react'
import pckText from '../../data/pck00011.tpc?raw'
import { loadPckOrientation } from '../../data/loaders/pckOrientation'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Models = Awaited<ReturnType<typeof loadPckOrientation>>
type Orientation = NonNullable<ReturnType<Models['evaluate']>>
export function PckOrientationPanel() {
  const { language } = useI18n(), zh = language === 'zh'
  const [body, setBody] = useState('499'), [seconds, setSeconds] = useState('0')
  const [models, setModels] = useState<Models | null>(null), [result, setResult] = useState<Orientation | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const clear = () => { generation.current++; setResult(null); setError(''); setBusy(false) }
  const calculate = async () => {
    clear()
    const token = generation.current
    setBusy(true)
    try {
      if (!body.trim() || !seconds.trim()) throw new Error(zh ? '请填写来源编号和 TDB 秒。' : 'Enter the source ID and TDB seconds.')
      const source = models ?? await loadPckOrientation(new TextEncoder().encode(pckText).buffer)
      const orientation = source.evaluate(Number(body), Number(seconds))
      if (!orientation) throw new Error(zh ? '该精确 PCK 编号没有姿态模型。' : 'No orientation model for this exact PCK ID.')
      if (token !== generation.current) return
      setModels(source); setResult(orientation)
    } catch (reason) { if (token === generation.current) setError(String(reason)) }
    finally { if (token === generation.current) setBusy(false) }
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '天体姿态' : 'Body orientation'}>
    <div className="module-heading"><span>{zh ? '天体姿态' : 'Body orientation'}</span><em>PCK · IAU</em></div>
    <p>{zh ? '由固定的原始 PCK 计算天体自转轴、初始子午线与 J2000 至固连坐标矩阵。默认 499 为火星，0 秒为 J2000 TDB。' : 'Evaluate the pole, prime meridian and J2000-to-body-fixed matrix from the pinned original PCK. The default 499 is Mars; zero seconds is J2000 TDB.'}</p>
    <label className="field"><span>{zh ? '精确 PCK 天体编号' : 'Exact PCK body ID'}</span><input type="number" step="1" value={body} onChange={event => { clear(); setBody(event.target.value) }} /></label>
    <label className="field"><span>{zh ? 'J2000 起算的 TDB 秒' : 'TDB seconds past J2000'}</span><input type="number" value={seconds} onChange={event => { clear(); setSeconds(event.target.value) }} /></label>
    <button className="secondary-button" disabled={busy} onClick={() => { void calculate() }}>{zh ? '计算来源姿态' : 'Evaluate source orientation'}</button>
    {error && <p role="alert">{error}</p>}
    {result && models && <div data-testid="pck-orientation-result">
      <p>{zh ? '来源模型数：' : 'Source models: '}{models.ids().length} · {result.model} · {result.secondsPastJ2000Tdb} s TDB</p>
      <dl className="contract-list">
        <div><dt>{zh ? '自转轴赤经 / 赤纬（度）' : 'Pole RA / Dec (degrees)'}</dt><dd>{result.poleRightAscensionDegrees.toPrecision(12)} / {result.poleDeclinationDegrees.toPrecision(12)}</dd></div>
        <div><dt>{zh ? '初始子午线角（度）' : 'Prime meridian angle (degrees)'}</dt><dd>{result.primeMeridianDegrees.toPrecision(12)}</dd></div>
      </dl>
      <pre style={{ maxWidth: '100%', overflowX: 'auto' }}>{[0, 1, 2].map(row => result.j2000ToBodyFixed.slice(row * 3, row * 3 + 3).map(value => value.toFixed(12)).join('  ')).join('\n')}</pre>
      <button className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ schemaVersion: 1, source: models.source, orientation: result, limitations: models.limitations, build: BUILD_INFO }, null, 2), 'solar-pck-orientation.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出姿态与来源' : 'Export orientation and source'}</button>
      <details><summary>{zh ? '可用的原始 PCK 编号' : 'Available original PCK IDs'}</summary><p>{models.ids().join(', ')}</p></details>
    </div>}
    <p>{zh ? '这是 IAU 文本 PCK 模型，不是 SOFA/IERS 地球姿态或高精度月球姿态。前后 100 儒略年仅为计算范围，不表示物理精度有效期。物理姿态误差未知；尚未接入椭球掩星接触、地形、大气或环。' : 'IAU text-PCK model, not SOFA/IERS Earth orientation or high-precision lunar orientation. The ±100 Julian-year evaluation range is not a physical accuracy interval. Physical orientation uncertainty is unknown; ellipsoidal occultation contacts, terrain, atmosphere and rings are not included.'}</p>
  </section>
}
