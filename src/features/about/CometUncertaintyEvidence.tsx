import { useState } from 'react'
import evidence from '../../data/borisovHorizonsUncertainty.json'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { useI18n } from '../../i18n/context'

const AU_KM = 149597870.7
const AU_PER_DAY_TO_METERS_PER_SECOND = AU_KM * 1000 / 86400
const POSITION_COLORS = ['#6ecbff', '#ffb86b', '#84ddb0']
const POSITION_DIRECTIONS = ['R', 'T', 'N'] as const

export function CometUncertaintyEvidence() {
  const { language } = useI18n(), zh = language === 'zh'
  const [sampleIndex, setSampleIndex] = useState(0)
  const [exportError, setExportError] = useState('')
  const sample = evidence.samples[sampleIndex]
  const peakPositionSigmaKm = Math.max(...evidence.samples.flatMap(row => row.sigmaRtnPositionAu.map(value => value * AU_KM)))
  const chart = (axis: number) => evidence.samples.map((row, index) => {
    const x = 44 + index / (evidence.samples.length - 1) * 584
    const sigmaKm = row.sigmaRtnPositionAu[axis] * AU_KM
    const y = 166 - sigmaKm / peakPositionSigmaKm * 132
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  return <section className="evidence-module glass-panel" aria-label={zh ? 'Borisov JPL 映射轨道不确定度' : 'Borisov JPL mapped orbit uncertainty'}>
    <div className="module-heading"><span>{zh ? 'Borisov JPL 映射不确定度' : 'Borisov JPL mapped uncertainty'}</span><em>JPL HORIZONS · JPL #54</em></div>
    <p>{zh
      ? '显示 JPL Horizons 在各采样历元报告的 RTN 形式统计状态 1σ 分量。它与本页的二体实验分开呈现；JPL 数值轨迹包含拟合中的非引力模型。'
      : 'Shows the formal statistical RTN state 1σ components reported by JPL Horizons at sampled epochs. It is separate from the two-body experiment; the Horizons numerical trajectory includes its fitted non-gravitational model.'}</p>
    <p>{zh
      ? '另行固定的 SBDB 协方差也标记为 JPL #54。Horizons 与 SBDB 的十个名义拟合参数不完全相同，但各差值均小于 SBDB 对应的形式边际 σ；这不证明 Horizons 映射使用了这份协方差，也不界定模型系统误差。'
      : 'The separately pinned SBDB covariance also identifies JPL #54. Its ten nominal fit values are not identical to the Horizons values, but each difference is below the corresponding SBDB formal marginal sigma. This does not prove Horizons used this exact covariance mapping or bound model error.'}</p>
    <a href="https://ssd-api.jpl.nasa.gov/doc/horizons.html" target="_blank" rel="noreferrer">NASA/JPL Horizons API · vector uncertainties</a>
    <p className="checksum">{evidence.sampling.count} {zh ? '个离散历元 · 每 30 天 · TDB' : 'discrete epochs · 30-day step · TDB'}<br/>{zh ? '源解数据弧' : 'Source observation arc'}: {evidence.source.observationArc.join(' — ')}<br/>SHA-256 {evidence.source.responseSha256}</p>
    <figure aria-label={zh ? 'RTN 位置一倍标准差随时间变化' : 'RTN position one-sigma by epoch'}>
      <svg viewBox="0 0 640 190" role="img" aria-label={zh ? 'JPL 报告的 R、T、N 方向位置一倍标准差样本' : 'JPL reported sampled R, T and N position one-sigma values'}>
        <path d="M44 34H628M44 100H628M44 166H628" className="uncertainty-axis" />
        <text x="4" y="38" fontSize="11">{peakPositionSigmaKm.toPrecision(2)} km</text>
        <text x="25" y="170" fontSize="11">0</text>
        {POSITION_DIRECTIONS.map((direction, axis) => <polyline key={direction} points={chart(axis)} fill="none" stroke={POSITION_COLORS[axis]} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        <text x="44" y="184" fontSize="11">2019</text><text x="325" y="184" fontSize="11" textAnchor="middle">2025</text><text x="628" y="184" fontSize="11" textAnchor="end">2030</text>
      </svg>
      <figcaption>{zh ? '位置边际 1σ（km）；连线只帮助阅读离散样本，不定义中间历元的不确定度。' : 'Position marginal 1σ (km); lines aid reading between discrete samples and do not define intermediate-epoch uncertainty.'}</figcaption>
    </figure>
    <div className="uncertainty-projections" aria-label={zh ? '图例' : 'Legend'}>
      {POSITION_DIRECTIONS.map((direction, axis) => <span key={direction} style={{ color: POSITION_COLORS[axis] }}>● {direction} {zh ? '位置' : 'position'}</span>)}
    </div>
    <label className="field" htmlFor="borisov-uncertainty-epoch">
      <span>{zh ? '选择离散的 JPL 历元' : 'Select a discrete JPL epoch'}</span>
      <input id="borisov-uncertainty-epoch" type="range" min="0" max={evidence.samples.length - 1} step="1" value={sampleIndex}
        aria-valuetext={`JD ${sample.epochTdb} TDB`} onChange={event => setSampleIndex(Number(event.target.value))}/>
    </label>
    <p>{sample.sourceDateTdb} · JD {sample.epochTdb} TDB</p>
    <div className="uncertainty-table"><table>
      <caption>{zh ? 'JPL 报告的 RTN 边际 1σ' : 'JPL reported RTN marginal 1σ'}</caption>
      <thead><tr><th>{zh ? '方向' : 'Direction'}</th><th>{zh ? '位置标准差（km）' : 'Position sigma (km)'}</th><th>{zh ? '速度标准差（m/s）' : 'Velocity sigma (m/s)'}</th></tr></thead>
      <tbody>{POSITION_DIRECTIONS.map((direction, axis) => <tr key={direction}>
        <th>{direction}</th>
        <td>{(sample.sigmaRtnPositionAu[axis] * AU_KM).toPrecision(7)}</td>
        <td>{(sample.sigmaRtnVelocityAuPerDay[axis] * AU_PER_DAY_TO_METERS_PER_SECOND).toPrecision(7)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="preview-source-boundary">{zh
      ? '限制：这些是单历元 RTN 边际标准差，不包含各方向间或历元间的协方差。它们不是置信椭球、轨迹走廊或事件概率；未采样历元不作插值。JPL 的 SPK/状态数值精度也不代表观测轨道的物理精度。'
      : 'Boundary: these are single-epoch RTN marginal standard deviations. Cross-axis and cross-epoch covariance are not supplied. They are not a confidence ellipsoid, trajectory corridor or event probability; unsampled epochs are not interpolated. Numerical precision of a JPL SPK/state is not the physical accuracy of the observed orbit.'}</p>
    <button type="button" className="secondary-button" onClick={() => { setExportError(''); void saveTextExport(JSON.stringify({ build: BUILD_INFO, evidence }, null, 2), 'solar-borisov-horizons-uncertainty.json', 'application/json').catch(reason => setExportError(String(reason))) }}>
      {zh ? '导出采样与来源证据' : 'Export samples and source evidence'}
    </button>
    {exportError && <p role="alert">{exportError}</p>}
  </section>
}
