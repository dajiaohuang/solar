import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const violations = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  expect(violations, violations.map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => node.target.join(' ')).join('\n')}`).join('\n\n')).toEqual([])
}

test('visitor, story, and evidence surfaces have no serious automated accessibility violations', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /See the Solar System|把太阳系看成/ })).toBeVisible()
  await expectNoSeriousViolations(page)

  await page.goto('./?v=3&page=stories')
  await expect(page.getByRole('heading', { name: /Stories|引导故事/ })).toBeVisible()
  await expectNoSeriousViolations(page)

  await page.goto('./?v=3&page=about')
  await expect(page.getByRole('heading', { name: /Evidence|证据与数据/ })).toBeVisible()
  await expectNoSeriousViolations(page)
})
