import type { ConjunctionEvent } from '../workers/conjunction.worker'

type Props = {
  events: ConjunctionEvent[]
  isComputing: boolean
  thresholdAU: number
  windowDays: number
  bodyCount: number
  onThresholdChange: (value: number) => void
  onWindowDaysChange: (value: number) => void
  onJumpToEvent: (julianDay: number) => void
}

function formatDistance(au: number) {
  if (au < 0.01) {
    return `${(au * 149597870.7).toFixed(0)} km`
  }

  return `${au.toFixed(4)} AU`
}

function distanceClass(au: number) {
  if (au < 0.01) {
    return 'critical'
  }

  if (au < 0.05) {
    return 'close'
  }

  if (au < 0.1) {
    return 'moderate'
  }

  return 'distant'
}

export function ConjunctionPanel({
  events,
  isComputing,
  thresholdAU,
  windowDays,
  bodyCount,
  onThresholdChange,
  onWindowDaysChange,
  onJumpToEvent,
}: Props) {
  return (
    <div className="panel-block">
      <div className="field-header">
        <span>近距离交会</span>
        <strong>{bodyCount} 个天体</strong>
      </div>

      <p className="catalog-summary" style={{ marginBottom: 8 }}>
        检测当前显示天体两两之间的最近距离，结果按距离升序排列。
      </p>

      <label className="field">
        <span>距离阈值 (AU)</span>
        <select
          value={thresholdAU}
          onChange={(event) => onThresholdChange(Number(event.target.value))}
        >
          <option value="0.005">0.005 AU (~750,000 km)</option>
          <option value="0.01">0.01 AU (~1,500,000 km)</option>
          <option value="0.05">0.05 AU (~7,500,000 km)</option>
          <option value="0.1">0.1 AU (~15,000,000 km)</option>
          <option value="0.5">0.5 AU</option>
          <option value="1">1 AU</option>
        </select>
      </label>

      <label className="field">
        <span>搜索窗口 (天)</span>
        <select
          value={windowDays}
          onChange={(event) => onWindowDaysChange(Number(event.target.value))}
        >
          <option value="30">30 天</option>
          <option value="90">90 天</option>
          <option value="365">1 年</option>
          <option value={365 * 5}>5 年</option>
        </select>
      </label>

      {isComputing ? (
        <div className="catalog-loading">正在计算交会事件…</div>
      ) : (
        <div className="catalog-toolbar">
          <span className="catalog-hint">
            {events.length ? `找到 ${events.length} 个交会事件` : '未找到交会事件'}
          </span>
        </div>
      )}

      <div className="result-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {events.map((event) => {
          const key = `${event.bodyAId}-${event.bodyBId}-${event.julianDay.toFixed(0)}`
          const cls = distanceClass(event.minDistanceAU)

          return (
            <button
              key={key}
              type="button"
              className={`result-card ${cls}`}
              onClick={() => onJumpToEvent(event.julianDay)}
              style={{
                borderLeft: cls === 'critical'
                  ? '3px solid #ff4444'
                  : cls === 'close'
                    ? '3px solid #ff8833'
                    : cls === 'moderate'
                      ? '3px solid #ffcc00'
                      : '3px solid #888',
              }}
            >
              <span className="result-title">
                {event.bodyAName} ←→ {event.bodyBName}
              </span>
              <span className="result-meta">
                {formatDistance(event.minDistanceAU)}
              </span>
            </button>
          )
        })}

        {!isComputing && !events.length && bodyCount >= 2 && (
          <div className="catalog-empty">在当前阈值和窗口内未检测到交会事件。</div>
        )}

        {bodyCount < 2 && (
          <div className="catalog-empty">需要至少选择 2 个天体才能检测交会。</div>
        )}
      </div>
    </div>
  )
}
