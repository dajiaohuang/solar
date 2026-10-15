import { useEffect, useMemo, useState } from 'react'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { useI18n } from '../../i18n/context'

type SigmaSample = {
  dataCutoffTdb: number
  epochTdb: number
  epochLabelTdb: string
  radiusMercuryKm: number
  transverseVelocityKmPerSecond: number
  sigmaRtnPositionKm: [number, number, number]
  sigmaScaleFactor: number
}

type SigmaGroup = {
  dataCutoffTdb: number
  count: number
  firstEpochTdb: number
  lastEpochTdb: number
  sigmaScaleFactors: number[]
}

type SigmaEvidence = {
  schemaVersion: number
  source: { url: string; md5: string; sha256: string; bytes: number; publication: string }
  frame: { timeScale: string; positionSigmaAxes: string[]; positionSigmaUnit: string }
  sampling: { count: number; dataCutoffCount: number; displayEndTdb: number; displayedCount: number; interpolation: string }
  solutionGroups: SigmaGroup[]
  limitations: string[]
  samples: SigmaSample[]
}

const AXES = ['R', 'HxR', 'H'] as const
const COLORS = ['#6ecbff', '#ffb86b', '#84ddb0']

export function MessengerOrecon3Evidence() {
  const { language } = useI18n(), zh = language === 'zh'
  const [evidence, setEvidence] = useState<SigmaEvidence | null>(null)
  const [loadError, setLoadError] = useState('')
  const [exportError, setExportError] = useState('')
  const [selectedCutoff, setSelectedCutoff] = useState<number | null>(null)
  const [sampleIndex, setSampleIndex] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}data/evidence/messenger-orecon3-sigmas.json`, { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<SigmaEvidence> : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(value => {
        if (value.schemaVersion !== 1 || !Array.isArray(value.samples) || !Array.isArray(value.solutionGroups)) throw new Error('Invalid ORECON3 sigma data')
        setEvidence(value)
        const lastVisibleGroup = [...value.solutionGroups].reverse().find(group =>
          value.samples.some(sample => sample.dataCutoffTdb === group.dataCutoffTdb && sample.epochTdb <= value.sampling.displayEndTdb))
        setSelectedCutoff(lastVisibleGroup?.dataCutoffTdb ?? null)
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setLoadError(String(error))
      })
    return () => controller.abort()
  }, [])

  const visibleGroups = useMemo(() => {
    if (!evidence) return []
    const groups = new Map<number, SigmaSample[]>()
    for (const sample of evidence.samples) {
      if (sample.epochTdb > evidence.sampling.displayEndTdb) continue
      const rows = groups.get(sample.dataCutoffTdb) ?? []
      rows.push(sample)
      groups.set(sample.dataCutoffTdb, rows)
    }
    return evidence.solutionGroups.flatMap(group => {
      const samples = groups.get(group.dataCutoffTdb)
      return samples?.length ? [{ ...group, samples }] : []
    })
  }, [evidence])

  const group = visibleGroups.find(row => row.dataCutoffTdb === selectedCutoff) ?? visibleGroups.at(-1)
  const sample = group ? group.samples[Math.min(sampleIndex, group.samples.length - 1)] : undefined
  const maximumSigmaKm = group ? Math.max(...group.samples.flatMap(row => row.sigmaRtnPositionKm)) : 1
  const timeSpan = group ? Math.max(1, group.samples[group.samples.length - 1].epochTdb - group.samples[0].epochTdb) : 1
  const chart = (axis: number) => {
    if (!group) return ''
    return group.samples.map(row => {
    const x = 44 + (row.epochTdb - group.samples[0].epochTdb) / timeSpan * 584
    const y = 166 - row.sigmaRtnPositionKm[axis] / maximumSigmaKm * 132
    return `${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }

  if (loadError) return <section className="evidence-module glass-panel" aria-label="MESSENGER ORECON3 uncertainty">
    <div className="module-heading"><span>{zh ? 'MESSENGER ORECON3 形式不确定度' : 'MESSENGER ORECON3 formal uncertainty'}</span><em>NASA/JPL PDS</em></div>
    <p role="alert">{zh ? '无法载入冻结的来源数据' : 'Could not load the frozen source data'}: {loadError}</p>
  </section>

  return <section className="evidence-module glass-panel" aria-label={zh ? 'MESSENGER ORECON3 轨道不确定度' : 'MESSENGER ORECON3 orbit uncertainty'}>
    <div className="module-heading"><span>{zh ? 'MESSENGER ORECON3 形式不确定度' : 'MESSENGER ORECON3 formal uncertainty'}</span><em>NASA/JPL · ORECON3</em></div>
    <p>{zh
      ? '按各自的数据截止历元（DCO）查看 Mercury 中心重建轨道报告的离散位置边际 1σ。每组保留各自的历元与缩放系数；横坐标按 TDB 实际时间间隔绘制。'
      : 'Inspect the discrete marginal position 1σ values for the Mercury-centered reconstructed orbit, grouped by each solution’s data-cutoff epoch (DCO). Each group retains its own epochs and sigma scale factor; the horizontal axis uses actual TDB spacing.'}</p>
    <p>{zh ? '图中 σ 已含来源注明的缩放；该系数只作来源标签，不会重复施加。' : 'The displayed sigmas already include the source-listed scale; it is shown for provenance and is not applied again.'}</p>
    <p>{zh
      ? '此 ORECON3 不确定度文件与本轮单独审阅的 MESSENGER 末段 SPK 源是不同交付物，不是该 SPK 的协方差；图表按那份 SPK 的拟议裁剪边界截断，避免展示撞击后的“幽灵”近拱点。'
      : 'This ORECON3 uncertainty file is a separate delivery from the MESSENGER final-arc SPK source under review, not that SPK’s covariance. The chart is clipped to the proposed SPK crop boundary so it does not show the post-impact “phantom” periapsis.'}</p>
    <p className="checksum">{evidence ? `${evidence.sampling.displayedCount.toLocaleString()} / ${evidence.sampling.count.toLocaleString()} ${zh ? '个离散样本显示至轨道段边界' : 'discrete samples shown through the trajectory bound'} · ${visibleGroups.length} {zh ? '个 DCO 解弧' : 'DCO solution arcs'} · TDB` : (zh ? '正在载入归档数据…' : 'Loading archived data…')}<br/>
      {zh ? 'PDS 源 MD5' : 'PDS source MD5'} {evidence?.source.md5 ?? '—'}<br/>
      {zh ? '冻结数据 SHA-256' : 'Frozen data SHA-256'} {evidence?.source.sha256 ?? '—'}</p>
    <a href="https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/document/spkrecon/orecon3_sigmas_m.asc" target="_blank" rel="noreferrer">NASA/JPL PDS · ORECON3 sigmas</a>
    {' · '}
    <a href="https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/document/spkrecon/recon_orbit_phase_trajectory_part3.pdf" target="_blank" rel="noreferrer">{zh ? '导航重建说明与误差边界' : 'Navigation reconstruction and uncertainty limits'}</a>
    {evidence && group && sample && <>
      <label className="field" htmlFor="messenger-orecon3-dco">
        <span>{zh ? '选择解的 DCO（TDB 秒，J2000 起算）' : 'Select solution DCO (TDB seconds past J2000)'}</span>
        <select id="messenger-orecon3-dco" value={group.dataCutoffTdb} onChange={event => {
          setSelectedCutoff(Number(event.target.value)); setSampleIndex(0)
        }}>
          {visibleGroups.map(row => <option key={row.dataCutoffTdb} value={row.dataCutoffTdb}>
            {row.dataCutoffTdb.toFixed(0)} · {row.count} {zh ? '个样本 · σ 缩放' : 'samples · sigma scale'} ×{row.sigmaScaleFactors.join('/')}
          </option>)}
        </select>
      </label>
      <figure aria-label={zh ? '按 DCO 解弧展示的 RTN 位置边际 1σ' : 'RTN marginal position 1-sigma for selected DCO arc'}>
        <svg viewBox="0 0 640 190" role="img" aria-label={zh ? '离散 R、H 叉乘 R、H 方向位置标准差' : 'Discrete position sigma along R, H cross R and H'}>
          <path d="M44 34H628M44 100H628M44 166H628" className="uncertainty-axis" />
          <text x="4" y="38" fontSize="11">{maximumSigmaKm.toPrecision(2)} km</text>
          <text x="25" y="170" fontSize="11">0</text>
          {AXES.map((axis, index) => <polyline key={axis} points={chart(index)} fill="none" stroke={COLORS[index]} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
          <text x="44" y="184" fontSize="11">{group.samples[0].epochLabelTdb.slice(0, 10)}</text>
          <text x="628" y="184" fontSize="11" textAnchor="end">{group.samples[group.samples.length - 1].epochLabelTdb.slice(0, 10)}</text>
        </svg>
        <figcaption>{zh ? '位置边际 1σ（km）；连线只连接该 DCO 解的离散来源样本，不代表插值或中间历元不确定度。' : 'Position marginal 1σ (km); lines only connect discrete samples from this DCO solution and do not define interpolation or intermediate-epoch uncertainty.'}</figcaption>
      </figure>
      <div className="uncertainty-projections" aria-label={zh ? '方向图例' : 'Axis legend'}>
        {AXES.map((axis, index) => <span key={axis} style={{ color: COLORS[index] }}>● {axis}</span>)}
      </div>
      <label className="field" htmlFor="messenger-orecon3-epoch">
        <span>{zh ? '选择离散的来源历元' : 'Select a discrete source epoch'}</span>
        <input id="messenger-orecon3-epoch" type="range" min="0" max={group.samples.length - 1} step="1" value={Math.min(sampleIndex, group.samples.length - 1)}
          aria-valuetext={`${sample.epochLabelTdb} · DCO ${group.dataCutoffTdb} TDB`} onChange={event => setSampleIndex(Number(event.target.value))}/>
      </label>
      <p>{sample.epochLabelTdb} · DCO {group.dataCutoffTdb} TDB · {zh ? 'σ 缩放' : 'sigma scale'} ×{sample.sigmaScaleFactor}</p>
      <div className="uncertainty-table"><table>
        <caption>{zh ? '来源报告的位置边际 1σ' : 'Source-reported marginal position 1σ'}</caption>
        <thead><tr><th>{zh ? '方向' : 'Direction'}</th><th>{zh ? '位置标准差（km）' : 'Position sigma (km)'}</th></tr></thead>
        <tbody>{AXES.map((axis, index) => <tr key={axis}>
          <th>{axis}{index === 0 ? (zh ? ' · 径向' : ' · radial') : index === 1 ? (zh ? ' · 横向 H×R' : ' · transverse H×R') : (zh ? ' · 轨道极向' : ' · orbit pole')}</th>
          <td>{sample.sigmaRtnPositionKm[index].toPrecision(7)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="preview-source-boundary">{zh
        ? '限制：这些是 ORECON3 单历元位置边际形式 1σ，不含方向间或历元间协方差；不是置信椭球、轨迹走廊或事件概率。原报告说明缩放系数带主观性，并称真实 σ 可能需要再乘 2–3。ORECON3 SPK 末端约在预估撞击后三分钟，含撞击后 26 秒的虚构近拱点；本图按另一份仍在审阅的末段 SPK 源裁切边界裁切。'
        : 'Boundary: these are ORECON3 single-epoch marginal formal position 1σ values, without cross-axis or cross-epoch covariance; they are not a confidence ellipsoid, trajectory corridor or event probability. The report says the scale factors are subjective and real sigmas may need another factor of 2–3. The ORECON3 SPK extends about three minutes beyond estimated impact and contains a phantom periapsis 26 seconds after impact; this chart is clipped to the bound of the separate final-arc SPK source under review.'}</p>
      <button type="button" className="secondary-button" onClick={() => {
        setExportError('')
        void saveTextExport(JSON.stringify({ build: BUILD_INFO, source: evidence.source, frame: evidence.frame,
          selectedGroup: group, displayedEndTdb: evidence.sampling.displayEndTdb }, null, 2),
        'solar-messenger-orecon3-sigma-evidence.json', 'application/json').catch(reason => setExportError(String(reason)))
      }}>{zh ? '导出此解弧证据' : 'Export this solution arc evidence'}</button>
      {exportError && <p role="alert">{exportError}</p>}
    </>}
  </section>
}
