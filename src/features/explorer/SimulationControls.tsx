import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { julianDayToDate, dateToJulianDay } from '../../lib/julianDate'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { useI18n } from '../../i18n/context'

function toDateInput(julianDay: number) {
  return julianDayToDate(julianDay).toISOString().slice(0, 10)
}

export function SimulationControls() {
  const clock = useSimulationClock()
  const simulation = simulationStore.useStore()
  const { t } = useI18n()
  return (
    <div className="simulation-bar glass-panel">
      <button type="button" className="primary-button" onClick={simulationActions.togglePlayback}>
        {clock.isPlaying ? `❚❚ ${t('pause')}` : `▶ ${t('play')}`}
      </button>
      <label className="compact-field">
        <span>{t('date')}</span>
        <input
          type="date"
          value={toDateInput(clock.julianDay)}
          onChange={(event) => {
            if (event.target.value) simulationActions.seek(dateToJulianDay(new Date(`${event.target.value}T12:00:00Z`)))
          }}
        />
      </label>
      <label className="compact-field rate-field">
        <span>{t('rate')}</span>
        <select value={clock.rateDaysPerSecond} onChange={(event) => simulationActions.setRate(Number(event.target.value))}>
          <option value={-365}>−365 d/s</option>
          <option value={-30}>−30 d/s</option>
          <option value={1}>1 d/s</option>
          <option value={30}>30 d/s</option>
          <option value={365}>365 d/s</option>
          <option value={3650}>3,650 d/s</option>
        </select>
      </label>
      <button type="button" className="quiet-button" onClick={simulationActions.resetTime}>{t('today')}</button>
      <div className="segmented-control" aria-label={t('view')}>
        <button className={simulation.viewMode === '2d' ? 'active' : ''} onClick={() => simulationActions.patch({ viewMode: '2d' })}>2D</button>
        <button className={simulation.viewMode === '3d' ? 'active' : ''} onClick={() => simulationActions.patch({ viewMode: '3d' })}>3D</button>
      </div>
      <span className="jd-readout">JD {clock.julianDay.toFixed(3)}</span>
    </div>
  )
}
