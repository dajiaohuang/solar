import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { decodeSbdbConic } from '../../data/loaders/sbdbConic'
import { sbdbConicExperiment } from '../../engine/ephemeris/sbdbConicExperiment'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

export function ConicLaboratory() {
  const {language} = useI18n(), zh = language === 'zh'
  const [bytes,setBytes] = useState<Uint8Array | null>(null), [name,setName] = useState('')
  const [epoch,setEpoch] = useState('2458853.5'), [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [result,setResult] = useState<Awaited<ReturnType<typeof sbdbConicExperiment>> | null>(null)
  const generation = useRef(0)
  const clear = () => { generation.current++; setResult(null); setError(''); setBusy(false) }
  useEffect(()=>()=>{generation.current++},[])
  const load = async (read:()=>Promise<Uint8Array>) => {
    clear(); setBytes(null); setName(''); const token = generation.current; setBusy(true)
    try {
      const next = await read(), parsed = await decodeSbdbConic(next)
      if (token !== generation.current) return
      setBytes(next); setName(parsed.name); setEpoch(parsed.osculationTdbText); setBusy(false)
    } catch (error) { if(token === generation.current) {setError(String(error));setBusy(false)} }
  }
  const run = async () => {
    if(!bytes) return
    clear(); const token = generation.current; setBusy(true)
    try {
      const gm = await import('../../data/gm_de440.tpc?raw')
      const next = await sbdbConicExperiment(bytes,gm.default,epoch)
      if(token === generation.current) {setResult(next);setBusy(false)}
    } catch(error) {if(token === generation.current) {setError(String(error));setBusy(false)}}
  }
  return <section className="evidence-module glass-panel" style={{overflowWrap:'anywhere'}} aria-label={zh?'圆锥轨道实验':'Conic orbit laboratory'}>
    <div className="module-heading"><span>{zh?'圆锥轨道实验':'Conic orbit laboratory'}</span><em>ECLIPJ2000 · TDB</em></div>
    <p>{zh?'比较椭圆、抛物线和双曲线的日心二体传播。导入的轨道仅为瞬时密切根数；这里不复现 JPL 完整拟合力模型。':'Explore heliocentric elliptic, parabolic and hyperbolic two-body propagation. Imported osculating elements do not reproduce the complete JPL fitted force model here.'}</p>
    <button className="secondary-button" onClick={()=>void load(async()=>new TextEncoder().encode((await import('../../../tests/fixtures/sbdb-borisov-20260923/response.json?raw')).default))}>{zh?'载入 Borisov 真实来源示例':'Load real Borisov source'}</button>
    <label className="field"><span>{zh?'SBDB 原始 JSON':'Original SBDB JSON'}</span><input type="file" accept=".json,application/json" onChange={event=>{
      const file=event.target.files?.[0];event.target.value=''
      if(file) void load(async()=>{if(file.size>1024*1024)throw new Error('SBDB source exceeds 1 MiB');return new Uint8Array(await file.arrayBuffer())})
    }}/></label>
    {name && <p>{name}</p>}
    <form onSubmit={event=>{event.preventDefault();void run()}}>
      <label className="field"><span>{zh?'目标 TDB 儒略日':'Target TDB Julian day'}</span><input type="text" inputMode="decimal" required value={epoch} onChange={event=>{clear();setEpoch(event.target.value)}}/></label>
      <button className="secondary-button" disabled={!bytes||busy}>{zh?'计算二体状态':'Compute two-body state'}</button>
    </form>
    {busy && <button onClick={clear}>{zh?'取消圆锥计算':'Cancel conic calculation'}</button>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="conic-result">
      <p>{zh?'偏心率':'Eccentricity'}: {result.source.parameters.eccentricity}</p>
      <p>{zh?'位置（km）':'Position (km)'}: {Object.values(result.positionKm).map(v=>v.toPrecision(12)).join(', ')}</p>
      <p>{zh?'速度（km/s）':'Velocity (km/s)'}: {Object.values(result.velocityKmPerSecond).map(v=>v.toPrecision(12)).join(', ')}</p>
      <p>{zh?'未采用的源拟合参数':'Omitted source fit parameters'}: {result.omittedSourceModelParameters.length}</p>
      <p>{zh?'不含行星摄动、相对论、非引力加速度或误差传播。物理不确定性未知，不能用作精确事件预测。':'No planetary perturbations, relativity, non-gravitational acceleration or uncertainty propagation. Physical uncertainty is unknown; this is not a precise event prediction.'}</p>
      <button className="secondary-button" onClick={()=>void saveTextExport(JSON.stringify({...result,build:BUILD_INFO},null,2),'solar-conic-experiment.json','application/json').catch(error=>setError(String(error)))}>{zh?'导出圆锥计算与来源':'Export conic calculation and sources'}</button>
      <p style={{fontSize:10}}>SBDB SHA-256 {result.source.sourceSha256}<br/>GM SHA-256 {result.adoptedSolarGM.sha256}</p>
    </div>}
  </section>
}
