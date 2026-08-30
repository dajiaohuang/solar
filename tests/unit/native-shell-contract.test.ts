import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import capacitorConfig from '../../capacitor.config'

describe('native shell system-bar contract', () => {
  it('keeps light system-bar controls visible over the dark application surface', () => {
    expect(capacitorConfig.plugins?.SystemBars).toEqual({
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
      animation: 'NONE',
    })
  })

  it('prefers Capacitor Android insets before the standards-based fallback', async () => {
    const css = await readFile(new URL('../../src/App.css', import.meta.url), 'utf8')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(
        `--safe-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px));`,
      )
    }
  })
})
