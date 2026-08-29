import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const violations = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  expect(violations, violations.map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => node.target.join(' ')).join('\n')}`).join('\n\n')).toEqual([])
}

test('first-run deck, story, and evidence surfaces have no serious automated accessibility violations', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  const firstRun = page.getByRole('dialog', { name: /How would you like to begin|你想从哪里开始/ })
  await expect(firstRun).toBeVisible()
  await expectNoSeriousViolations(page)
  await firstRun.getByRole('button', { name: /Explore independently|直接探索/ }).click()
  await expect(page.locator('.advanced-controls')).not.toHaveAttribute('open', '')
  await expectNoSeriousViolations(page)

  await page.goto('./?v=3&page=stories')
  await expect(page.getByRole('heading', { name: /Stories|引导故事/ })).toBeVisible()
  await expectNoSeriousViolations(page)
  await page.getByRole('button', { name: /Open this scene|打开此场景/ }).click()
  await expect(page.getByRole('dialog', { name: /From geocentrism to the geocentric frame|从地心说到地心参考系/ })).toBeVisible()
  await expectNoSeriousViolations(page)

  await page.goto('./?v=3&page=about')
  await expect(page.getByRole('heading', { name: /Evidence|证据与数据/ })).toBeVisible()
  await expectNoSeriousViolations(page)

  if ((page.viewportSize()?.width ?? 1280) > 980) await page.keyboard.press('Control+K')
  else await page.getByRole('button', { name: /Search Solar Atlas|搜索太阳系图谱/ }).click()
  await expect(page.getByRole('dialog', { name: /Search Solar Atlas|搜索太阳系图谱/ })).toBeVisible()
  await expectNoSeriousViolations(page)
})
