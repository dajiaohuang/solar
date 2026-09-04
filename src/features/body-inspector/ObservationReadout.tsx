import { useState } from 'react'
import { currentObservation } from '../../engine/ephemeris/diagnostics'
import type { ApparentMode } from '../../engine/ephemeris/apparent'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import type { CelestialBody } from '../../types'

export function ObservationReadout({ body, observer, julianDay }: { body: CelestialBody; observer: CelestialBody; julianDay: number }) {
  const [mode, setMode] = useState<ApparentMode>('light-time+stellar-aberration')
  const { t, language } = useI18n()
  const result = currentObservation(body, observer, julianDay, mode)
  return <details className="model-note">
    <summary>{t('observationCorrection')} · {bodyDisplayName(observer, language)}</summary>
    <label>{t('model')} <select value={mode} onChange={(event) => setMode(event.target.value as ApparentMode)}>
      <option value="geometric">Geometric</option><option value="light-time">Light time</option><option value="light-time+stellar-aberration">Light time + stellar aberration</option>
    </select></label>
    {result ? <p>{t('distance')}: {Math.hypot(...result.position).toLocaleString(language, { maximumFractionDigits: 1 })} km<br />{language === 'zh' ? '光时修正' : 'Light-time correction'}: {mode === 'geometric' ? (language === 'zh' ? '未应用' : 'Not applied') : `${result.lightTimeSeconds.toFixed(4)} s`}</p> : <p>{language === 'zh' ? '当前目标、观测者或发射时刻无完整星历覆盖。' : 'Target, observer or emission epoch lacks complete ephemeris coverage.'}</p>}
    <p className="fine-print">{t('observationBoundary')}</p>
  </details>
}
