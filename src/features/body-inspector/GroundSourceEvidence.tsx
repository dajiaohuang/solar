import type { GroundEopManifest, GroundEopSample, GroundObservation } from '../../lib/groundObservation'

type GroundSource = GroundObservation['result']['sources'][number]

function number(value: number) {
  return value.toPrecision(15)
}

export function GroundSourceEvidence({
  earthOrientation, eopCoverageMjdUtc, sources, sample, zh,
}: {
  earthOrientation: GroundEopManifest
  eopCoverageMjdUtc: readonly [number, number]
  sources: readonly GroundSource[]
  sample?: GroundEopSample
  zh: boolean
}) {
  return <div className="ground-source-evidence">
    {sample && <>
      <p>{zh ? 'IERS UTC MJD 插值历元 / 数据端点' : 'IERS UTC MJD interpolation epoch / source bracket'}: {number(sample.mjdUtc)} · [{number(sample.bracketMjdUtc[0])}, {number(sample.bracketMjdUtc[1])}]</p>
      <table><thead><tr><th>{zh ? 'IERS 字段' : 'IERS field'}</th><th>{zh ? '插值值' : 'Interpolated value'}</th><th>{zh ? '来源误差（端点最大值）' : 'Source error (maximum endpoint value)'}</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{([
        [zh ? '极移 x' : 'Polar motion x', sample.xpArcsec, sample.xpErrorArcsec, 'arcsec'],
        [zh ? '极移 y' : 'Polar motion y', sample.ypArcsec, sample.ypErrorArcsec, 'arcsec'],
        [zh ? 'UT1−UTC' : 'UT1−UTC', sample.ut1MinusUtcSeconds, sample.ut1ErrorSeconds, 's'],
        ...(sample.celestialPoleCorrectionAvailable ? [
          [zh ? '天极修正 dX' : 'Celestial pole correction dX', sample.dXMas!, sample.dXErrorMas!, 'mas'],
          [zh ? '天极修正 dY' : 'Celestial pole correction dY', sample.dYMas!, sample.dYErrorMas!, 'mas'],
        ] : []),
      ] as [string, number, number, string][]).map(([label, value, error, unit]) => <tr key={label}><th>{label}</th><td>{number(value)}</td><td>{number(error)}</td><td>{unit}</td></tr>)}</tbody></table>
      <p>{zh ? `极移标志 ${sample.poleFlag} · UT1 标志 ${sample.ut1Flag} · 天极修正 ${sample.cpoFlag || '不可用'}` : `Pole flag ${sample.poleFlag} · UT1 flag ${sample.ut1Flag} · celestial-pole flag ${sample.cpoFlag || 'unavailable'}`}</p>
      <p>{zh ? '这些是来源发布的误差字段（插值端点取较大值），不是观测结果的不确定度或置信区间；未向方向、光时或事件结果传播。' : 'These are source-reported error fields, using the larger interpolation-endpoint value. They are not observation uncertainty or confidence intervals and are not propagated into directions, light time or events.'}</p>
    </>}
    <details>
      <summary>{zh ? `IERS 与 SPK 来源及有效范围（${sources.length} 个 SPK 源）` : `IERS and SPK sources and validity windows (${sources.length} SPK sources)`}</summary>
      <p>{earthOrientation.sourceUrl}<br />{zh ? '获取时间' : 'Retrieved'}: {earthOrientation.retrievedAt}<br />SHA-256: <code>{earthOrientation.sha256}</code></p>
      <p>{zh ? 'IERS 外层数据覆盖 MJD UTC' : 'IERS outer source coverage, MJD UTC'}: [{number(eopCoverageMjdUtc[0])}, {number(eopCoverageMjdUtc[1])}]</p>
      <p>{zh ? '首末覆盖端点不保证内部连续；请求仍会检查实际时刻与数据缺口。' : 'Outer endpoints do not prove continuous internal coverage; each request still checks the actual epochs and data gaps.'}</p>
      {sources.length ? <ul>{sources.map((source, index) => <li key={`${source.bodyId}/${source.kernelSha256}/${source.startJdTdb}/${index}`}>
        <strong>{source.bodyId}</strong> · {source.source}<br />{zh ? '覆盖 JD TDB' : 'Coverage JD TDB'}: [{number(source.startJdTdb)}, {number(source.endJdTdb)}]<br />SHA-256: <code>{source.kernelSha256}</code>
      </li>)}</ul> : <p>{zh ? '响应未包含可用的 SPK 状态来源。' : 'The response contains no available SPK state source.'}</p>}
      <p>{zh ? 'SPK 时间范围是源段覆盖，不代表该区间内的物理精度。' : 'SPK intervals report source-segment coverage, not physical accuracy over that interval.'}</p>
    </details>
  </div>
}
