/** Preserve the report's two-part time representation; do not round by adding
 * a sub-day offset to a large Julian date or silently convert TDB to UTC. */
export function TdbEpochReadout({ epoch, title, zh }: {
  epoch: { referenceEpochTdb: number; elapsedTdbSeconds: number }; title: string; zh: boolean
}) {
  const valid = Number.isFinite(epoch.referenceEpochTdb) && Number.isFinite(epoch.elapsedTdbSeconds)
  return <div>
    <p>{title}</p>
    {!valid ? <p role="status">{zh ? '终点时刻不可用。' : 'Endpoint time is unavailable.'}</p> : <>
      <dl>
        <dt>{zh ? '参考历元（JD TDB）' : 'Reference epoch (JD TDB)'}</dt><dd>{String(epoch.referenceEpochTdb)}</dd>
        <dt>{zh ? '相对参考历元的 TDB 秒数' : 'Elapsed TDB seconds from reference'}</dt><dd>{String(epoch.elapsedTdbSeconds)}</dd>
      </dl>
      <p>{zh ? '两部分共同确定时刻，保留原始数值而不合并舍入；负秒数表示参考历元之前。这不是 UTC 日期，显示位数不代表物理精度。' : 'Both parts identify the instant and retain the reported values without merging and rounding. Negative seconds precede the reference epoch. This is not a UTC date; displayed digits do not establish physical accuracy.'}</p>
    </>}
  </div>
}
