import { useEffect, useRef, useState } from 'react'
import type { searchEnsembleDistanceEvents } from '../../engine/dynamics/ensembleDistanceEvents'
import { startDynamicsJob, type DynamicsJob } from '../../lib/dynamicsJob'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { ForceModelEvidence } from './ForceModelEvidence'
import { CovarianceFactorizationEvidence } from './CovarianceFactorizationEvidence'
import { TdbEpochReadout } from './TdbEpochReadout'
import { UnsupportedCovarianceAxesNotice, type CovarianceSourceAxis } from './UnsupportedCovarianceAxesNotice'

type Receipt = Awaited<ReturnType<typeof searchEnsembleDistanceEvents>> & {
  schemaVersion: number; calculation: string
  sourceFile: { sha256: string; bytes: number; originalBase64: string; payload: unknown }
  finalEpoch: { referenceEpochTdb: number; elapsedTdbSeconds: number }
}
const targets = [
  [10,'太阳','Sun'],[1,'水星系质心','Mercury system barycenter'],[2,'金星系质心','Venus system barycenter'],
  [399,'地球','Earth'],[301,'月球','Moon'],[4,'火星系质心','Mars system barycenter'],
  [5,'木星系质心','Jupiter system barycenter'],[6,'土星系质心','Saturn system barycenter'],
  [7,'天王星系质心','Uranus system barycenter'],[8,'海王星系质心','Neptune system barycenter'],[9,'冥王星系质心','Pluto system barycenter'],
] as const

export function EnsembleDistanceEvents({ bytes, dimension, extraAxes, zh }: {
  bytes: ArrayBuffer; dimension: number; extraAxes: readonly CovarianceSourceAxis[]; zh: boolean
}) {
  const [fields,setFields] = useState({ days:'1',count:'8',seed:'20260923',distance:'1000000',step:'3600',tolerance:'1',evaluations:'256',events:'32',exclusion:'1' })
  const [target,setTarget] = useState(399), [solar,setSolar] = useState(false)
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [completed,setCompleted] = useState<{ bytes: ArrayBuffer; receipt: Receipt } | null>(null)
  const [drawIndex,setDrawIndex] = useState(0)
  const generation = useRef(0), job = useRef<DynamicsJob | null>(null)
  const clear = () => {
    generation.current++; job.current?.terminate(); job.current = null
    setBusy(false); setError(''); setCompleted(null); setDrawIndex(0)
  }
  useEffect(() => {
    const token = ++generation.current
    job.current?.terminate(); job.current = null
    queueMicrotask(() => {
      if (generation.current !== token) return
      setBusy(false); setError(''); setCompleted(null); setDrawIndex(0)
    })
    return () => { generation.current++; job.current?.terminate(); job.current = null }
  }, [bytes,dimension])
  const result = completed?.bytes === bytes ? completed.receipt : null
  const run = () => {
    clear()
    if (dimension !== 6) return
    if (!Object.values(fields).every(value => value.trim())) { setError(zh ? '请填写所有数值参数。' : 'Fill in every numeric setting.'); return }
    const token = generation.current
    try {
      const initialBytes = bytes.slice(0)
      job.current = startDynamicsJob<Receipt>({ kind:'ensemble-events',initialBytes,
        durationSeconds:Number(fields.days)*86400,sampleCount:Number(fields.count),seed:Number(fields.seed),
        exclusionKm:Number(fields.exclusion),solarRelativity:solar,compareRefinement:false,
        eventSearch:{targetNaifId:target,distanceKm:Number(fields.distance),maxStepSeconds:Number(fields.step),
          toleranceSeconds:Number(fields.tolerance),maxEvaluations:Number(fields.evaluations),maxEvents:Number(fields.events)},
      },[initialBytes],{
        done: receipt => {
          if (generation.current !== token) return
          job.current = null; setBusy(false); setCompleted({bytes,receipt})
        },
        error: message => {
          if (generation.current !== token) return
          job.current = null; setBusy(false); setCompleted(null); setError(message)
        },
      })
      setBusy(true)
    } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const field = (key: keyof typeof fields, label: string, min: number, max?: number, step: number | 'any' = 'any') =>
    <label className="field"><span>{label}</span><input type="number" value={fields[key]} min={min} max={max} step={step}
      onChange={event => { clear(); setFields(previous => ({...previous,[key]:event.target.value})) }} /></label>
  const save = async () => {
    if (!result) return
    const token = generation.current
    try {
      const json = JSON.stringify({...result,build:BUILD_INFO,
        packedArrayConvention:'Initial states and offsets are row-major six-component arrays. Invalid coordinates encode as null. Preserve every draw index and status; unresolved and failed draws are not negative event searches.'},
      (_key,value:unknown) => value instanceof Float64Array || value instanceof Uint8Array ? Array.from(value) : value,2)
      await saveTextExport(json,'solar-distance-event-ensemble.json','application/json')
    } catch (reason) { if (generation.current === token) setError(String(reason)) }
  }
  const selected = result?.draws[drawIndex]
  return <details className="covariance-time-propagation">
    <summary>{zh ? '轨道样本的距离阈值事件' : 'Distance-threshold events across orbit samples'}</summary>
    <p>{zh ? '查找轨道样本进入或离开指定距离的时刻。距离以同时刻的目标中心为准，不是碰撞、掩星或事件概率；星系质心不代表行星表面。' : 'Search when orbit samples cross a chosen distance from the simultaneous target center. These are not collisions, occultations or event probabilities; system barycenters do not represent planetary surfaces.'}</p>
    {dimension !== 6 ? <UnsupportedCovarianceAxesNotice extraAxes={extraAxes} zh={zh} /> : <>
      <label className="field"><span>{zh ? '距离参考目标' : 'Distance reference target'}</span><select value={target} onChange={event => { clear(); setTarget(Number(event.target.value)) }}>
        {targets.map(([id,chinese,english]) => <option key={id} value={id}>{zh ? chinese : english} · NAIF {id}</option>)}
      </select></label>
      {field('distance',zh ? '距离阈值（km，须大于零）' : 'Distance threshold (km, positive)',0)}
      {field('days',zh ? '从协方差历元起的时长（TDB 天）' : 'Duration from covariance epoch (TDB days)',-365,365)}
      {field('count',zh ? '样本数量' : 'Sample count',1,128,1)}
      {field('seed',zh ? '随机种子' : 'Random seed',0,0xffffffff,1)}
      <details><summary>{zh ? '搜索精度与资源限制' : 'Search resolution and resource limits'}</summary>
        {field('step',zh ? '最大采样间隔（秒）' : 'Maximum scan spacing (seconds)',0)}
        {field('tolerance',zh ? '数值定位容差（秒）' : 'Numerical localization tolerance (seconds)',0)}
        {field('evaluations',zh ? '每样本事件函数求值上限' : 'Event evaluations per draw',1,2048,1)}
        {field('events',zh ? '每样本事件记录上限' : 'Event records per draw',1,128,1)}
        {field('exclusion',zh ? '力模型排除距离（km）' : 'Force-model exclusion distance (km)',0)}
        <label className="dynamics-check"><input type="checkbox" checked={solar} onChange={event => { clear(); setSolar(event.target.checked) }} />{zh ? '采用太阳 1PN 修正' : 'Adopt solar 1PN correction'}</label>
      </details>
      <p>{zh ? '全部样本共享 250,000 次力计算，任务限时 300 秒。数值定位容差不包含积分误差或物理误差；采样可能漏掉切触和短事件。参数变化会取消当前任务。' : 'All draws share 250,000 force evaluations and a 300-second job limit. Localization tolerance excludes integration and physical errors; sampling can miss tangencies and short events. Changing settings cancels the current job.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={run}>{zh ? '采用条件模型并搜索事件' : 'Adopt conditional model and search events'}</button>
      {busy && <><p role="status">{zh ? '正在校验来源并逐样本搜索…' : 'Verifying sources and searching each draw…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消事件搜索' : 'Cancel event search'}</button></>}
    </>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="ensemble-distance-events-result">
      <ForceModelEvidence evidence={result.forceModel} zh={zh} />
      <CovarianceFactorizationEvidence evidence={result.sampling.factorization} zh={zh} />
      <details><summary>{zh ? '查看样本初始坐标转换' : 'Inspect initial sample frame conversion'}</summary>
        <p>{result.initialFrameTransform.sourceFrame} → {result.initialFrameTransform.destinationFrame} / {result.initialFrameTransform.destinationOrigin}</p>
        <p>JD {result.initialFrameTransform.referenceEpochTdb} TDB · {zh ? '固定黄赤交角' : 'Fixed obliquity'}: {result.initialFrameTransform.obliquityArcseconds} arcsec</p>
        <p>{zh ? '太阳平移状态（km，km/s）：' : 'Prescribed Sun translation state (km, km/s): '}{result.initialFrameTransform.sunStateKmKmPerSecond.map(value => value.toPrecision(12)).join(', ')}</p>
        <p>{zh ? '积分初始状态已按所报样本核对单位换算、旋转与太阳平移；此一致性核对未独立重算星历或源轨道状态，也不包含太阳星历与 GM 的不确定性。' : 'Initial integration states are checked against the reported samples for unit conversion, rotation and Sun translation. This consistency check does not independently recompute ephemerides or source orbit states and excludes Sun ephemeris and GM uncertainty.'}</p>
      </details>
      <TdbEpochReadout epoch={result.finalEpoch} title={zh ? '搜索另一端时刻（起点为协方差历元）' : 'Other search endpoint (from covariance epoch)'} zh={zh} />
      <p>{zh ? '总数 / 已搜索 / 失败 / 未完成：' : 'Total / searched / failed / unresolved: '}{result.counts.total} / {result.counts.searched} / {result.counts.failed} / {result.counts.unresolved}</p>
      <p>{result.forceEvaluations} / {result.maximumForceEvaluations} {zh ? '次力计算。零事件只表示采样未检出；失败与未完成不算无事件。' : 'force evaluations. Zero events means none detected by sampling; failed and unresolved draws are not event-free.'}</p>
      <details><summary>{zh ? '首次检出事件的条件时间统计' : 'Conditional timing of first detected events'}</summary>
        <p>{zh ? '每个样本按时间先后选择首次检出的指定方向事件。仅统计被选中的有限样本，不是物理事件概率、总体分位数或置信区间，也不保证各样本对应同一个物理事件。' : 'Select the earliest detected event of each direction in each draw. Statistics describe only the selected finite subset, not physical probabilities, population quantiles or confidence intervals; the same physical event is not guaranteed across draws.'}</p>
        {result.timingSummary.summaries.map(summary => <div key={summary.direction}>
          <p><strong>{summary.direction === 'decreasing' ? (zh ? '首次检出进入阈值' : 'First detected threshold entry') : (zh ? '首次检出离开阈值' : 'First detected threshold exit')}</strong></p>
          <p>{zh ? '总数 / 选中 / 失败 / 未完成 / 未检出 / 更早零点方向不明：' : 'Total / selected / failed / unresolved / not detected / earlier unclassified zero: '}
            {summary.counts.total} / {summary.counts.selected} / {summary.counts.failed} / {summary.counts.unresolved} / {summary.counts.notDetected} / {summary.counts.ambiguousZero}</p>
          {summary.quantiles ? <div className="uncertainty-table"><table><caption>{zh ? '选中样本的经验分位数（相对历元 TDB 秒）' : 'Selected-sample empirical quantiles (TDB seconds from reference)'}</caption>
            <thead><tr><th>{zh ? '分位' : 'Quantile'}</th><th>{zh ? '秩' : 'Rank'}</th><th>{zh ? '时刻' : 'Time'}</th><th>{zh ? '数值定位边界，非置信区间' : 'Localization bounds, not a confidence interval'}</th></tr></thead>
            <tbody>{summary.quantiles.map(value => <tr key={value.fraction}><th scope="row">{value.fraction*100}%</th><td>{value.rank}/{summary.counts.selected}</td><td>{value.elapsedTdbSeconds.toPrecision(12)}</td><td>{value.localizationBoundsSeconds.map(bound => bound.toPrecision(12)).join(' … ')}</td></tr>)}</tbody>
          </table></div> : <p>{zh ? '被选中的样本少于两个，不汇总分位数。' : 'Fewer than two selected draws; quantiles are unavailable.'}</p>}
          <details><summary>{zh ? '查看本方向的纳入与排除明细' : 'Inspect inclusion and exclusions for this direction'}</summary>
            <div className="uncertainty-table"><table>
              <caption>{zh ? '条件时间统计的逐样本依据（界面编号从 1 开始）' : 'Draw-level basis of conditional timing (display numbers start at 1)'}</caption>
              <thead><tr><th>{zh ? '样本' : 'Draw'}</th><th>{zh ? '处理' : 'Disposition'}</th><th>{zh ? '选中事件 / 相对历元 TDB 秒' : 'Selected event / elapsed TDB seconds'}</th></tr></thead>
              <tbody>
                {summary.selections.map(entry => <tr key={entry.index}><th scope="row"><button type="button" className="text-button" onClick={() => setDrawIndex(entry.index)}>#{entry.index+1}</button></th><td>{zh ? '纳入' : 'Included'}</td><td>#{entry.eventIndex+1} / {entry.elapsedTdbSeconds.toPrecision(12)}</td></tr>)}
                {summary.exclusions.map(entry => <tr key={entry.index}><th scope="row"><button type="button" className="text-button" onClick={() => setDrawIndex(entry.index)}>#{entry.index+1}</button></th><td>{entry.reason === 'failed' ? (zh ? '失败，排除' : 'Failed; excluded')
                  : entry.reason === 'unresolved' ? (zh ? '未完成，排除' : 'Unresolved; excluded')
                  : entry.reason === 'not-detected' ? (zh ? '未检出本方向事件，排除' : 'No event detected in this direction; excluded')
                  : (zh ? '存在更早或同时的方向未明零点，排除' : 'Earlier or simultaneous unclassified zero; excluded')}</td><td>—</td></tr>)}
              </tbody>
            </table></div>
            <p>{zh ? '点击编号可切换下方样本详情。此表的纳入项才构成当前方向分位数的样本集合；排除项不被赋予零时刻，也不代表没有事件。导出使用从 0 开始的原始样本和事件索引。' : 'Select a number to change the draw details below. Only included entries form this direction’s quantile sample set; excluded entries receive no zero time and do not establish event absence. Exports use original zero-based draw and event indices.'}</p>
          </details>
        </div>)}
        <p>{zh ? '采用排序后向上取整的秩，不做插值。负时长也按时间先后选择。数值定位边界不包含积分误差、有限抽样误差或物理误差；两个样本的最低门槛不代表统计充分。选中和排除的样本编号见完整导出。' : 'Nearest-rank order statistics without interpolation; negative durations also use chronological order. Localization bounds exclude integration, finite-sampling and physical errors. The two-draw minimum does not establish statistical adequacy. Export retains all selected and excluded identities.'}</p>
      </details>
      <div className="uncertainty-table"><table><caption>{zh ? '逐样本搜索状态' : 'Search status by draw'}</caption><thead><tr><th>#</th><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '检出记录' : 'Detected records'}</th><th>{zh ? '力求值' : 'Force calls'}</th></tr></thead><tbody>
        {result.draws.map(draw => <tr key={draw.index}><th scope="row">{draw.index+1}</th><td>{draw.status === 'searched' ? (zh ? '已搜索' : 'Searched') : draw.status === 'failed' ? (zh ? '失败' : 'Failed') : (zh ? '未完成' : 'Unresolved')}</td><td>{draw.status === 'searched' ? draw.result.search.events.length : '—'}</td><td>{draw.forceEvaluations}</td></tr>)}
      </tbody></table></div>
      <label className="field"><span>{zh ? '查看样本详情' : 'Inspect draw'}</span><select value={drawIndex} onChange={event => setDrawIndex(Number(event.target.value))}>{result.draws.map(draw => <option key={draw.index} value={draw.index}>#{draw.index+1}</option>)}</select></label>
      {selected && (selected.status !== 'searched' ? <p role="status">
        {selected.status === 'unresolved' && (selected.stage === 'not-started' ? (zh ? '总预算已耗尽，未开始搜索。' : 'Not started after total budget exhaustion. ') : (zh ? '搜索中途达到预算。' : 'Search interrupted by its budget. '))}
        {selected.reason}
        {selected.status === 'failed' && selected.stage === 'localization' && <><br />
          {zh ? '未达到容差的剩余定位区间（TDB 秒）：' : 'Remaining bracket wider than tolerance (TDB seconds): '}{selected.bracketSeconds.map(value => String(value)).join(' … ')}
          <br />{zh ? '区间端点事件函数值（km）：' : 'Bracket endpoint event values (km): '}{selected.bracketValues.map(value => String(value)).join(' … ')}
        </>}
        {selected.status === 'unresolved' && selected.searchProgress && <><br />
          {zh ? '已尝试 / 已完成求值 / 已定位但未作为完整结果发布的记录：' : 'Attempted / completed evaluations / localized records withheld from complete results: '}
          {selected.searchProgress.attemptedEvaluations} / {selected.searchProgress.completedEvaluations} / {selected.searchProgress.retainedEventCount}
          <br />{zh ? '最后尝试时刻（相对历元 TDB 秒）：' : 'Last attempted epoch (elapsed TDB seconds): '}{selected.searchProgress.lastAttemptSeconds}
        </>}</p> : <>
        <p>{zh ? '时刻为相对协方差历元的 TDB 秒。负时长仍按时间先后显示；区间宽度不是物理时间不确定性。' : 'Times are TDB seconds from the covariance epoch, in chronological order even for negative durations. Bracket widths are not physical timing uncertainty.'}</p>
        <p>{zh ? '已完成积分 / 接受步 / 拒绝步：' : 'Completed integrations / accepted steps / rejected steps: '}{selected.result.integrations} / {selected.result.accepted} / {selected.result.rejected}</p>
        <p>{zh ? '最大已接受 DP54 局部误差比：' : 'Maximum accepted local DP54 error ratio: '}{selected.result.maxAcceptedErrorRatio.toPrecision(5)}
          {' · '}{zh ? '接受步长范围（秒）：' : 'accepted step range (seconds): '}
          {selected.result.smallestAcceptedStepSeconds === null ? '—' : selected.result.smallestAcceptedStepSeconds.toPrecision(6)} … {selected.result.largestAcceptedStepSeconds.toPrecision(6)}
        </p>
        <p>{zh ? '以上仅为已完成积分段的局部求解器诊断，不是累计轨道状态或事件时刻误差界。' : 'These are local solver diagnostics for completed segments, not accumulated state or event-time error bounds.'}</p>
        {selected.result.search.events.length === 0 ? <p>{zh ? '本样本未检出事件，不能据此证明没有事件。' : 'No event detected in this draw; this does not prove absence.'}</p> : <div className="uncertainty-table"><table><caption>{zh ? '所选样本的事件定位' : 'Selected draw event localization'}</caption><thead><tr><th>#</th><th>{zh ? '类型' : 'Kind'}</th><th>{zh ? 'TDB 秒' : 'TDB seconds'}</th><th>{zh ? '定位区间（秒）' : 'Localization bracket (seconds)'}</th></tr></thead><tbody>
          {selected.result.search.events.map((event,index) => <tr key={index}><th scope="row">{index+1}</th><td>{event.kind === 'sampled-zero' ? (zh ? '采样零点，方向未定' : 'Sampled zero, unclassified') : event.direction === 'increasing' ? (zh ? '离开阈值' : 'Exit threshold') : (zh ? '进入阈值' : 'Enter threshold')}</td><td>{event.elapsedTdbSeconds.toPrecision(12)}</td><td>{event.localizationBracketSeconds.map(value => value.toPrecision(12)).join(' … ')}</td></tr>)}
        </tbody></table></div>}
      </>)}
      <button type="button" className="secondary-button" onClick={() => void save()}>{zh ? '导出全部样本、区间与来源 JSON' : 'Export all draws, brackets and sources JSON'}</button>
    </div>}
  </details>
}
