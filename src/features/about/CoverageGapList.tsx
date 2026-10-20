import { useState } from 'react'
import type { validateCoverageGaps } from '../../lib/coverageGaps'

export function CoverageGapList({ gaps, zh }: { gaps: ReturnType<typeof validateCoverageGaps>; zh: boolean }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(gaps.length/20)), current = Math.min(page, pages-1)
  return <div>
    <p>{zh ? '时刻点包含该时刻；区间为开区间，不包含端点。单位为 J2000 起算的 TDB 秒，端点覆盖需分别查看。' : 'A point includes that instant; intervals are open and exclude endpoints. Units are TDB seconds past J2000; endpoint coverage is separate.'}</p>
    <ol start={current*20+1}>{gaps.slice(current*20, current*20+20).map((gap, index) => <li key={current*20+index}>
      <p>{gap.kind === 'point' ? `[${gap.start}]` : `(${gap.start}, ${gap.end})`} · {gap.reason}</p>
      <details><summary>{zh ? '查看来源依赖链' : 'Inspect source dependency chain'} ({gap.chain.length})</summary>
        {!gap.chain.length ? <p>{zh ? '报告未提供依赖链步骤。' : 'The report supplies no dependency-chain steps.'}</p> : <ol>{gap.chain.map((step, index) => <li key={index}>
          <p>{zh ? '目标 / 来源原点：' : 'Target / source origin: '}{String(step.target ?? step.origin ?? '—')}
            {' · '}{zh ? '中心：' : 'Center: '}{String(step.center ?? '—')}</p>
          {typeof step.origin === 'string' && <p>{zh ? '来源原点：' : 'Source origin: '}{step.origin}</p>}
          {typeof step.context === 'string' && <p>{step.context}</p>}
          {typeof step.kernelId === 'string' && <p>{step.kernelId} · {zh ? '坐标系 / 类型：' : 'Frame / type: '}{String(step.frame)} / {String(step.type)} · [{String(step.startEt)}, {String(step.endEt)}]</p>}
        </li>)}</ol>}
      </details>
    </li>)}</ol>
    {pages > 1 && <div>
      <button type="button" disabled={current === 0} onClick={() => setPage(current-1)}>{zh ? '上一页' : 'Previous'}</button>
      <span> {current+1} / {pages} </span>
      <button type="button" disabled={current+1 === pages} onClick={() => setPage(current+1)}>{zh ? '下一页' : 'Next'}</button>
    </div>}
  </div>
}
