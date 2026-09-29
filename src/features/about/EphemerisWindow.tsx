type RequestedTime = { kind: 'search'; start: number; end: number } |
  { kind: 'instant'; reception: number; emission: number }

/** Keep source admission separate from searched events and reception epochs. */
export function EphemerisWindow({ referenceEpochTdb, elapsedRangeSeconds, requested, zh }: {
  referenceEpochTdb: number; elapsedRangeSeconds: readonly number[]; requested: RequestedTime; zh: boolean
}) {
  const times = requested.kind === 'search' ? [requested.start, requested.end] : [requested.reception, requested.emission]
  const valid = Number.isFinite(referenceEpochTdb) && elapsedRangeSeconds.length === 2 &&
    elapsedRangeSeconds.every(Number.isFinite) && elapsedRangeSeconds[0] <= 0 && elapsedRangeSeconds[1] >= 0 &&
    (requested.kind === 'search' ? requested.start <= requested.end : requested.emission <= requested.reception) &&
    times.every(time => Number.isFinite(time) && time >= elapsedRangeSeconds[0] && time <= elapsedRangeSeconds[1])
  return <details>
    <summary>{zh ? '查看请求时间与星历求值窗口' : 'Inspect requested times and ephemeris evaluation window'}</summary>
    {!valid ? <p role="status">{zh ? '报告中的时间窗口不一致，无法显示。' : 'The reported time window is inconsistent and cannot be displayed.'}</p> : <>
      <dl className="contract-list">
        <div><dt>{zh ? '参考历元（JD TDB）' : 'Reference epoch (JD TDB)'}</dt><dd>{referenceEpochTdb}</dd></div>
        {requested.kind === 'search' ? <div><dt>{zh ? '接触搜索区间（相对 TDB 秒）' : 'Contact search interval (elapsed TDB seconds)'}</dt><dd>{requested.start} → {requested.end}</dd></div> : <>
          <div><dt>{zh ? '接收时刻（相对 TDB 秒）' : 'Reception instant (elapsed TDB seconds)'}</dt><dd>{requested.reception}</dd></div>
          <div><dt>{zh ? '天体中心发射时刻（相对 TDB 秒）' : 'Body-center emission instant (elapsed TDB seconds)'}</dt><dd>{requested.emission}</dd></div>
        </>}
        <div><dt>{zh ? '冻结的来源求值窗口（相对 TDB 秒）' : 'Frozen source evaluation window (elapsed TDB seconds)'}</dt><dd>{elapsedRangeSeconds[0]} → {elapsedRangeSeconds[1]}</dd></div>
      </dl>
      <p>{zh ? '求值窗口包含参考历元，以及所采用的天体中心光行时余量。它不是整个星历文件的覆盖范围，也不证明没有遗漏事件；数值为 TDB，不是 UTC。' : 'The evaluation window includes the reference epoch and any adopted body-center light-time margin. It is not the full kernel coverage and does not establish event completeness. Values are TDB, not UTC.'}</p>
    </>}
  </details>
}
