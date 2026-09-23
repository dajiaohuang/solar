import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import reference from '../fixtures/reception-contacts-reference.json' with { type: 'json' }

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete')) })

test('real contact worker exports independently checked CN contacts and duration windows', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Occultation laboratory', exact: true })
  await panel.getByRole('button', { name: 'Load Venus transit example' }).click()
  await panel.getByRole('button', { name: 'Search spherical contacts' }).click()
  const result = panel.getByTestId('occultation-result')
  await expect(result).toContainText('4 contacts')
  await expect(result).toContainText('23975.4730')
  await expect(result).toContainText('not UTC')
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth+1)).toBe(true)
  await panel.screenshot({ path: test.info().outputPath('occultation-laboratory.png') })
  const pending = page.waitForEvent('download')
  await result.getByRole('button', { name: 'Export contacts, windows and sources JSON' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(receipt.inputFile.payload.aberration).toBe('CN')
  expect(receipt.possibleMissedEvents).toBe(true)
  expect(receipt.physicalTimingUncertaintySeconds).toBeNull()
  expect(receipt.sampledOverlapWindows).toHaveLength(2)
  expect(receipt.shapes.foreground.naifPckId).toBe(299)
  expect(receipt.inputFile.sha256).toMatch(/^[a-f0-9]{64}$/)
  const expected = reference.cases.find(row => row.name === 'venus-2012')!
  for (const [i, contact] of expected.contacts.entries()) expect(Math.abs(receipt.contacts[i].elapsedTdbSeconds-contact.elapsedTdbSeconds)).toBeLessThan(.02)
  await panel.getByLabel('Light-time model', { exact: true }).selectOption('NONE')
  await expect(result).toHaveCount(0)
  await panel.getByLabel('Contact numerical tolerance (seconds)').fill('')
  await panel.getByRole('button', { name: 'Search spherical contacts' }).click()
  await expect(panel.getByRole('alert')).toContainText('Enter the scan step')
})

test('cancelling held source loading prevents stale contact results', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  let release: (() => void) | undefined
  await page.route('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.abort().catch(() => undefined)
  })
  const panel = page.getByRole('region', { name: 'Occultation laboratory', exact: true })
  await panel.getByLabel('Contact experiment JSON file').setInputFiles('src/data/venus-transit-reception-example.json')
  const requested = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: 'Search spherical contacts' }).click()
  await requested
  await panel.getByRole('button', { name: 'Cancel contact search' }).click()
  release?.()
  await expect(panel.getByTestId('occultation-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Search spherical contacts' })).toBeEnabled()
})

test('invalid import and corrupted SPK fail without a contact result', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=zh')
  const panel = page.getByRole('region', { name: '掩星与凌日实验室', exact: true })
  await panel.getByLabel('接触实验 JSON 文件').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByRole('button', { name: '搜索球形接触' })).toBeDisabled()
  await panel.getByRole('button', { name: '载入金星凌日示例' }).click()
  await page.route('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', route => route.fulfill({ body: Buffer.alloc(5558272), contentType: 'application/octet-stream' }))
  await panel.getByRole('button', { name: '搜索球形接触' }).click()
  await expect(panel.getByRole('alert')).toContainText('checksum mismatch')
  await expect(panel.getByTestId('occultation-result')).toHaveCount(0)
})
