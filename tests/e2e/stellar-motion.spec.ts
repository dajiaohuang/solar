import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import experiment from '../fixtures/gaia-motion-experiment.json' with { type: 'json' }
import covarianceExperiment from '../fixtures/gaia-motion-covariance-experiment.json' with { type: 'json' }
import { STATE_TILE_API_VERSION } from '../../src/lib/stateTiles'

test('stellar controls preserve original evidence and invalidate stale calculations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  let held = false, release: (() => void) | undefined
  await page.route('**/v1/stellar/motion', async route => {
    const request = route.request().postDataJSON()
    expect(request.originalRowsCsvBase64).toBe(experiment.originalRowsCsvBase64)
    expect(request.radialVelocityPolicy).toBe('spectroscopic-as-astrometric')
    if (held) { await new Promise<void>(resolve => { release = resolve }); await route.abort().catch(() => undefined); return }
    const body = JSON.stringify({ apiVersion: STATE_TILE_API_VERSION, experiment: request.covariancePolicy ? covarianceExperiment : experiment })
    await route.fulfill({ contentType:'application/json', headers:{ 'Content-Length':String(Buffer.byteLength(body)) }, body })
  })
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name:'Stellar epoch propagation', exact:true })
  await panel.getByLabel('Stellar original manifest and CSV').setInputFiles(['tests/fixtures/gaia-six-20260923/manifest.json','tests/fixtures/gaia-six-20260923/rows.csv'])
  const compute = panel.getByRole('button', { name:'Compute stellar state', exact:true })
  await expect(compute).toBeDisabled()
  await panel.getByRole('checkbox', {name:'Adopt spectroscopic RV as astrometric RV (astrophysical shifts uncorrected)',exact:true}).check()
  await compute.click()
  await expect(panel.getByTestId('stellar-motion-result')).toContainText('J2026 TCB')
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name:'Export stellar calculation and originals' }).click()
  const output = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(output.experiment).toEqual(experiment)
  await panel.getByRole('checkbox', {name:'Propagate formal covariance assuming RV errors are independent of astrometry',exact:true}).check()
  await expect(panel.getByTestId('stellar-motion-result')).toHaveCount(0)
  await compute.click()
  await expect(panel.getByTestId('stellar-covariance-result')).toContainText('Propagated marginal standard deviations')
  await expect(panel.getByTestId('stellar-covariance-result')).toContainText('radial-velocity')
  const covarianceDownload = page.waitForEvent('download')
  await panel.getByRole('button', {name:'Export stellar calculation and originals'}).click()
  const covarianceOutput = JSON.parse(await readFile((await (await covarianceDownload).path())!,'utf8'))
  expect(covarianceOutput.experiment).toEqual(covarianceExperiment)
  await panel.screenshot({ path:test.info().outputPath('stellar-motion.png') })
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
  await panel.getByLabel('Target TCB Julian year').fill('2027')
  await expect(panel.getByTestId('stellar-motion-result')).toHaveCount(0)
  held = true
  const requested = page.waitForRequest('**/v1/stellar/motion')
  await compute.click(); await requested
  await panel.getByRole('button', { name:'Cancel stellar calculation' }).click(); release?.()
  await expect(panel.getByTestId('stellar-motion-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})
