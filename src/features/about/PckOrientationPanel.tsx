import { useEffect, useRef, useState } from 'react'
import pckText from '../../data/pck00011.tpc?raw'
import { loadPckOrientation } from '../../data/loaders/pckOrientation'
import { loadPckRadii, type BodyRadii } from '../../data/loaders/pckRadii'
import { ellipsoidLimb } from '../../engine/events/ellipsoidLimb'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Models = Awaited<ReturnType<typeof loadPckOrientation>>
type Orientation = NonNullable<ReturnType<Models['evaluate']>>
type LimbResult = { shape: BodyRadii; observerJ2000Km: [number, number, number]; geometry: ReturnType<typeof ellipsoidLimb> }
export function PckOrientationPanel() {
  const { language } = useI18n(), zh = language === 'zh'
  const [body, setBody] = useState('499'), [seconds, setSeconds] = useState('0')
  const [models, setModels] = useState<Models | null>(null), [result, setResult] = useState<Orientation | null>(null)
  const [includeLimb, setIncludeLimb] = useState(false), [observer, setObserver] = useState(['1000000', '0', '0'])
  const [limb, setLimb] = useState<LimbResult | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const clear = () => { generation.current++; setResult(null); setLimb(null); setError(''); setBusy(false) }
  const calculate = async () => {
    clear()
    const token = generation.current
    setBusy(true)
    try {
      if (!body.trim() || !seconds.trim()) throw new Error(zh ? '请填写来源编号和 TDB 秒。' : 'Enter the source ID and TDB seconds.')
      const source = models ?? await loadPckOrientation(new TextEncoder().encode(pckText).buffer)
      const orientation = source.evaluate(Number(body), Number(seconds))
      if (!orientation) throw new Error(zh ? '该精确 PCK 编号没有姿态模型。' : 'No orientation model for this exact PCK ID.')
      let nextLimb: LimbResult | null = null
      if (includeLimb) {
        if (observer.some(value => !value.trim() || !Number.isFinite(Number(value)))) throw new Error(zh ? '请填写三个有限的观察位置分量。' : 'Enter three finite observer coordinates.')
        const shapes = await loadPckRadii(new TextEncoder().encode(pckText).buffer)
        const shape = shapes.get(orientation.naifPckId)
        if (!shape) throw new Error(zh ? '该精确 PCK 编号没有来源半轴。' : 'No source axes for this exact PCK ID.')
        const observerJ2000Km = observer.map(Number) as [number, number, number]
        nextLimb = { shape, observerJ2000Km, geometry: ellipsoidLimb(shape.radiiKm, orientation.j2000ToBodyFixed, observerJ2000Km) }
      }
      if (token !== generation.current) return
      setModels(source); setResult(orientation); setLimb(nextLimb)
    } catch (reason) { if (token === generation.current) setError(String(reason)) }
    finally { if (token === generation.current) setBusy(false) }
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '天体姿态' : 'Body orientation'}>
    <div className="module-heading"><span>{zh ? '天体姿态' : 'Body orientation'}</span><em>PCK · IAU</em></div>
    <p>{zh ? '由固定的原始 PCK 计算天体自转轴、初始子午线与 J2000 至固连坐标矩阵。默认 499 为火星，0 秒为 J2000 TDB。' : 'Evaluate the pole, prime meridian and J2000-to-body-fixed matrix from the pinned original PCK. The default 499 is Mars; zero seconds is J2000 TDB.'}</p>
    <label className="field"><span>{zh ? '精确 PCK 天体编号' : 'Exact PCK body ID'}</span><input type="number" step="1" value={body} onChange={event => { clear(); setBody(event.target.value) }} /></label>
    <label className="field"><span>{zh ? 'J2000 起算的 TDB 秒' : 'TDB seconds past J2000'}</span><input type="number" value={seconds} onChange={event => { clear(); setSeconds(event.target.value) }} /></label>
    <label className="dynamics-check"><input type="checkbox" checked={includeLimb} onChange={event => { clear(); setIncludeLimb(event.target.checked) }} />{zh ? '计算有限距离椭球轮廓' : 'Include finite-distance ellipsoid limb'}</label>
    {includeLimb && <fieldset><legend>{zh ? '观察者相对天体中心的位置 · J2000 · km' : 'Observer relative to body center · J2000 · km'}</legend>
      <p>{zh ? '输入同一几何时刻的观察位置。默认 (1000000, 0, 0) km 仅为演示输入，不是观测数据；位于椭球内部或表面的观察位置将拒绝计算。' : 'Supply the observer position at the same geometric epoch. The default (1000000, 0, 0) km is illustrative, not observed; viewpoints inside or on the ellipsoid are rejected.'}</p>
      {['X', 'Y', 'Z'].map((axis, index) => <label className="field" key={axis}><span>{zh ? `观察位置 ${axis}（km）` : `Observer ${axis} (km)`}</span><input type="number" value={observer[index]} onChange={event => { clear(); setObserver(values => values.map((value, i) => i === index ? event.target.value : value)) }} /></label>)}
    </fieldset>}
    <button className="secondary-button" disabled={busy} onClick={() => { void calculate() }}>{zh ? '计算来源姿态' : 'Evaluate source orientation'}</button>
    {error && <p role="alert">{error}</p>}
    {result && models && <div data-testid="pck-orientation-result">
      <p>{zh ? '来源模型数：' : 'Source models: '}{models.ids().length} · {result.model} · {result.secondsPastJ2000Tdb} s TDB</p>
      <dl className="contract-list">
        <div><dt>{zh ? '自转轴赤经 / 赤纬（度）' : 'Pole RA / Dec (degrees)'}</dt><dd>{result.poleRightAscensionDegrees.toPrecision(12)} / {result.poleDeclinationDegrees.toPrecision(12)}</dd></div>
        <div><dt>{zh ? '初始子午线角（度）' : 'Prime meridian angle (degrees)'}</dt><dd>{result.primeMeridianDegrees.toPrecision(12)}</dd></div>
      </dl>
      <pre style={{ maxWidth: '100%', overflowX: 'auto' }}>{[0, 1, 2].map(row => result.j2000ToBodyFixed.slice(row * 3, row * 3 + 3).map(value => value.toFixed(12)).join('  ')).join('\n')}</pre>
      {limb && <div data-testid="pck-limb-result">
        <p>{zh ? '有限距离几何轮廓 · J2000 · 天体中心为原点 · km' : 'Finite-distance geometric limb · J2000 · body-center origin · km'}</p>
        <dl className="contract-list">
          <div><dt>{zh ? '来源半轴（固连坐标）' : 'Source axes (body-fixed)'}</dt><dd>{limb.shape.radiiKm.join(', ')}</dd></div>
          <div><dt>{zh ? '轮廓中心' : 'Limb center'}</dt><dd>{limb.geometry.centerJ2000Km.map(value => value.toPrecision(8)).join(', ')}</dd></div>
          {limb.geometry.generatorsJ2000Km.map((axis, index) => <div key={index}><dt>{zh ? `生成向量 ${index + 1}` : `Generator ${index + 1}`}</dt><dd>{axis.map(value => value.toPrecision(8)).join(', ')}</dd></div>)}
        </dl>
        <p>{zh ? '轮廓点 = 中心 + 向量 1 × cos(θ) + 向量 2 × sin(θ)。生成向量不一定是主半轴。物理误差未知；不含光行时、像差、偏折、地形、大气或环。' : 'Limb point = center + generator 1 × cos(θ) + generator 2 × sin(θ). Generators are not necessarily principal axes. Physical uncertainty is unknown; light time, aberration, deflection, terrain, atmosphere and rings are excluded.'}</p>
      </div>}
      <button className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ schemaVersion: 1, source: models.source, orientation: result, limb, limitations: models.limitations, build: BUILD_INFO }, null, 2), 'solar-pck-orientation.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出姿态与来源' : 'Export orientation and source'}</button>
      <details><summary>{zh ? '可用的原始 PCK 编号' : 'Available original PCK IDs'}</summary><p>{models.ids().join(', ')}</p></details>
    </div>}
    <p>{zh ? '这是 IAU 文本 PCK 模型，不是 SOFA/IERS 地球姿态或高精度月球姿态。前后 100 儒略年仅为计算范围，不表示物理精度有效期。物理姿态误差未知；尚未接入椭球掩星接触、地形、大气或环。' : 'IAU text-PCK model, not SOFA/IERS Earth orientation or high-precision lunar orientation. The ±100 Julian-year evaluation range is not a physical accuracy interval. Physical orientation uncertainty is unknown; ellipsoidal occultation contacts, terrain, atmosphere and rings are not included.'}</p>
  </section>
}
