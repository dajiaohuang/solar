import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import manifest from '../fixtures/gaia-pleiades-20260923/manifest.json' with { type:'json' }
const root = 'tests/fixtures/gaia-pleiades-20260923/'
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1','complete')); await page.goto('./?v=4&page=about&lang=en') })

test('real Gaia worker uploads, zooms, selects and exports original source rows', async ({ page }) => {
  const panel = page.getByRole('region',{ name:'Gaia sky chart', exact:true })
  await panel.getByRole('button',{ name:'Open Pleiades-area example' }).click()
  await expect(panel.getByTestId('gaia-complete')).toContainText('19 source records loaded')
  await expect(panel).toContainText('65212004581252736')
  await expect(panel.getByTestId('gaia-position-uncertainty')).toContainText('Major / minor semiaxes')
  const canvas = panel.getByRole('img')
  await expect(canvas).toBeVisible()
  expect(await canvas.evaluate(e => (e as HTMLCanvasElement).width)).toBeGreaterThan(100)
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth+1)).toBe(true)
  await panel.screenshot({ path:test.info().outputPath('gaia-sky.png') })
  await panel.getByLabel('Chart zoom').fill('2')
  await panel.getByLabel('Star row').fill('2')
  await expect(panel).toContainText('65212863574614912')
  const pending = page.waitForEvent('download')
  await panel.getByRole('button',{ name:'Export Gaia records and sources' }).click()
  const result = JSON.parse(await readFile((await (await pending).path())!,'utf8'))
  expect(result.sources).toHaveLength(19); expect(result.sources[0].source_id).toBe('65212004581252736')
  expect(result.selectedPositionUncertainty.sourceId).toBe('65212863574614912')
  expect(result.selectedPositionUncertainty.includesSystematics).toBe(false)
  expect(result.selectedPositionUncertainty.contour).toBe('unit-Mahalanobis')
  expect(result.selectedAstrometricCovariance).toMatchObject({sourceId:'65212863574614912',available:true,propagated:false,pseudocolourIncluded:false,sourceSolutionParameters:5})
  const original = result.sources[1]
  expect(result.selectedAstrometricCovariance.matrix[0][4]).toBe(original.ra_pmdec_corr*original.ra_error*original.pmdec_error)
  await expect(panel.getByTestId('gaia-astrometric-covariance')).toContainText('Validated 5 × 5 marginal')
  await panel.getByLabel('Star row').fill('14')
  await expect(panel.getByTestId('gaia-astrometric-covariance')).toContainText('five-parameter-solution-unavailable')
  expect(result.manifest.referenceEpochTimeScale).toBe('TCB'); expect(result.summary.verifiedChunks).toBe(1)
  expect(result.manifest.chunks[0].sha256).toBe(manifest.chunks[0].sha256)
  await panel.getByLabel('Gaia manifest URL').fill('https://example.test/manifest.json')
  await expect(panel.getByTestId('gaia-complete')).toHaveCount(0); await expect(canvas).toHaveCount(0)
})
test('extended local Gaia source exports its full six-parameter solution', async ({ page }) => {
  const panel=page.getByRole('region',{name:'Gaia sky chart',exact:true})
  const dir='tests/fixtures/gaia-six-20260923/'
  const sources=JSON.parse(await readFile(dir+'r11-d22.json','utf8')).sources
  const index=sources.findIndex((row:{source_id:string})=>row.source_id==='65212966653827840')
  expect(index).toBeGreaterThanOrEqual(0)
  await panel.getByLabel('Gaia manifest and chunk JSON files').setInputFiles([dir+'manifest.json',dir+'r11-d22.json'])
  await expect(panel.getByTestId('gaia-complete')).toContainText('94 source records loaded')
  await panel.getByLabel('Star row').fill(String(index+1))
  await expect(panel.getByTestId('gaia-six-parameter-covariance')).toContainText('Validated 6 × 6 matrix')
  const pending=page.waitForEvent('download')
  await panel.getByRole('button',{name:'Export Gaia records and sources'}).click()
  const result=JSON.parse(await readFile((await (await pending).path())!,'utf8'))
  expect(result.sources).toEqual(sources)
  expect(result.selectedSixParameterCovariance).toMatchObject({sourceId:'65212966653827840',available:true,pseudocolourIncluded:true,propagated:false})
  expect(result.selectedSixParameterCovariance.matrix).toHaveLength(6)
  expect(result.selectedSixParameterCovariance.matrix[5][5]).toBe(sources[index].pseudocolour_error**2)
  expect(result.selectedSixParameterCovariance.coordinateLabels[5]).toBe('pseudocolour')
  expect(result.selectedAstrometricCovariance.matrix).toHaveLength(5)
})
test('local imports reject corrupted source bytes without keeping a stale chart', async ({ page }) => {
  const panel = page.getByRole('region',{ name:'Gaia sky chart', exact:true })
  await panel.getByLabel('Gaia manifest and chunk JSON files').setInputFiles([root+'manifest.json',root+'r11-d22.json'])
  await expect(panel.getByTestId('gaia-complete')).toContainText('19 source records loaded')
  await panel.getByLabel('Gaia manifest and chunk JSON files').setInputFiles([
    { name:'manifest.json', mimeType:'application/json', buffer:await readFile(root+'manifest.json') },
    { name:'r11-d22.json', mimeType:'application/json', buffer:Buffer.from('{}') },
  ])
  await expect(panel.getByRole('alert')).toContainText('hash mismatch')
  await expect(panel.getByRole('img')).toHaveCount(0)
})
test('cancelling a held remote chunk prevents publication', async ({ page }) => {
  const panel = page.getByRole('region',{ name:'Gaia sky chart', exact:true })
  await page.route('**/gaia-test/manifest.json', route => route.fulfill({ json:manifest }))
  let release: (() => void) | undefined
  await page.route('**/gaia-test/r11-d22.json', async route => { await new Promise<void>(resolve => { release = resolve }); await route.abort().catch(() => undefined) })
  const requested = page.waitForRequest('**/gaia-test/r11-d22.json')
  await panel.getByLabel('Gaia manifest URL').fill(new URL('gaia-test/manifest.json',page.url()).href)
  await panel.getByRole('button',{ name:'Load sky region', exact:true }).click()
  await requested
  await panel.getByRole('button',{ name:'Cancel Gaia loading' }).click(); release?.()
  await expect(panel.getByRole('img')).toHaveCount(0); await expect(panel.getByTestId('gaia-complete')).toHaveCount(0)
})
test('a completed remote load reuses verified source bytes in the session worker', async ({ page }) => {
  const panel = page.getByRole('region',{ name:'Gaia sky chart', exact:true })
  let chunks = 0, manifests = 0
  await page.route('**/gaia-cache/manifest.json', async route => { manifests++; await route.fulfill({json:manifest}) })
  await page.route('**/gaia-cache/r11-d22.json', async route => { chunks++; await route.fulfill({contentType:'application/json',body:await readFile(root+'r11-d22.json')}) })
  await panel.getByLabel('Gaia manifest URL').fill(new URL('gaia-cache/manifest.json',page.url()).href)
  for (let i=0;i<2;i++) {
    await panel.getByRole('button',{name:'Load sky region',exact:true}).click()
    await expect(panel.getByTestId('gaia-complete')).toContainText('19 source records loaded')
    const pending = page.waitForEvent('download')
    await panel.getByRole('button',{name:'Export Gaia records and sources'}).click()
    const result = JSON.parse(await readFile((await (await pending).path())!,'utf8'))
    expect(result.summary.cacheHits).toBe(i)
    expect(result.sources).toHaveLength(19)
  }
  expect(chunks).toBe(1); expect(manifests).toBe(2)
})
