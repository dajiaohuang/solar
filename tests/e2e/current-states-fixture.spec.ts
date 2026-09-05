import { expect, test } from './fixtures'
import satelliteCatalog from '../../src/data/satelliteCatalog.json' with { type: 'json' }

test('full-Web fixture rejects duplicate IDs and marks unknown identities missing', async ({ page }) => {
  await page.goto('./?v=4&lang=en')
  const result = await page.evaluate(async () => {
    const request = (ids: string[], epochJd = 2461287.5) => fetch('/solar-test-api/v1/current-states', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, epochJd, frame: 'ECLIPJ2000', precision: 'exact' }),
    })
    const duplicate = await request(['sun', 'sun'])
    const unknown = await request(['naif:999999999'])
    const staleAlias = await request(['quaoar'])
    const knownPrimary = await request(['naif:920050000'])
    const coverageGap = await request(['naif:920050000', 'naif:120050000'], 2460000.5)
    const noInventoryIdentity = await request(['sat:planet:saturn:provisional:S/2009 S1'])
    return {
      duplicateStatus: duplicate.status,
      unknownStatus: unknown.status,
      unknownBody: await unknown.json(),
      staleAliasBody: await staleAlias.json(),
      knownPrimaryBody: await knownPrimary.json(),
      coverageGapBody: await coverageGap.json(),
      noInventoryIdentityBody: await noInventoryIdentity.json(),
    }
  })

  expect(result.duplicateStatus).toBe(400)
  expect(result.unknownStatus).toBe(200)
  expect(result.unknownBody.availability).toEqual(['missing'])
  expect(result.unknownBody.source).toEqual([''])
  expect(result.unknownBody.datasetVersion).toEqual([''])
  expect(result.unknownBody.model).toEqual([''])
  expect(result.unknownBody.centerIds).toEqual([''])
  expect(result.unknownBody.validityPresent).toEqual([false])
  expect(result.unknownBody.missingReason).toEqual(['unknown-identity'])
  expect(result.unknownBody.statePresent).toEqual([false])
  expect(result.staleAliasBody.availability).toEqual(['missing'])
  expect(result.staleAliasBody.source).toEqual([''])
  expect(result.staleAliasBody.model).toEqual([''])
  expect(result.staleAliasBody.missingReason).toEqual(['unknown-identity'])
  expect(result.knownPrimaryBody.availability).toEqual(['operational'])
  expect(result.knownPrimaryBody.statePresent).toEqual([true])
  expect(result.coverageGapBody.availability).toEqual(['missing', 'missing'])
  expect(result.coverageGapBody.source).toEqual(['fixture-current-states', 'fixture-current-states'])
  expect(result.coverageGapBody.datasetVersion).toEqual(['fixture-v1', 'fixture-v1'])
  expect(result.coverageGapBody.model).toEqual(['spk-original', 'spk-original'])
  expect(result.coverageGapBody.missingReason).toEqual(['kernel-coverage-gap', 'kernel-coverage-gap'])
  expect(result.coverageGapBody.validityPresent).toEqual([true, true])
  expect(result.coverageGapBody.evidenceWindowPresent).toEqual([false, false])
  expect(result.coverageGapBody.statePresent).toEqual([false, false])
  expect(result.noInventoryIdentityBody.availability).toEqual(['missing'])
  expect(result.noInventoryIdentityBody.source).toEqual([''])
  expect(result.noInventoryIdentityBody.datasetVersion).toEqual([''])
  expect(result.noInventoryIdentityBody.model).toEqual([''])
  expect(result.noInventoryIdentityBody.missingReason).toEqual(['unknown-identity'])
  expect(result.noInventoryIdentityBody.validityPresent).toEqual([false])
  expect(result.noInventoryIdentityBody.evidenceWindowPresent).toEqual([false])
})

test('keeps a slow 294-body playing request alive and eventually publishes', async ({ page }) => {
  test.setTimeout(30_000)
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  const ids = ['saturn', ...satelliteCatalog.bodies.filter(body => body.parentId === 'saturn').map(body => body.naifId === 606 ? 'titan' : body.id)]
  const requests: string[] = []
  let completedResponses = 0
  const requestTimes: number[] = []
  const responseTimes: number[] = []
  page.on('request', request => {
    if (request.url().endsWith('/solar-test-api/v1/current-states')) { requests.push(request.url()); requestTimes.push(Date.now()) }
  })
  page.on('response', response => {
    if (response.url().endsWith('/solar-test-api/v1/current-states') && response.ok() && response.headers()['x-solar-fixture-current-state'] === 'complete') { completedResponses += 1; responseTimes.push(Date.now()) }
  })
  const query = new URLSearchParams({ v: '4', lang: 'en', speed: '30', view: '3d', ref: 'saturn', bodies: ids.join(','), jd: '2461287.5', history: '1', samples: '24', 'slow-current-states': '1' })
  await page.goto(`?${query}`)
  const summary = page.getByTestId('ephemeris-status').locator('summary')
  await expect(summary).toContainText('293/294', { timeout: 15_000 })
  await expect(summary).not.toContainText('Loading', { timeout: 5_000 })
  const baselineRequests = requests.length
  const baselineCompletedResponses = completedResponses
  expect(baselineCompletedResponses).toBe(baselineRequests)
  await page.locator('.simulation-bar .primary-button').click()
  // The fixture holds each response for 1.2s, longer than the 500ms wall
  // cadence. A bounded sampler must let the active request finish instead of
  // creating an unbounded stream of aborted requests.
  await expect.poll(() => completedResponses, { timeout: 5_000 }).toBeGreaterThan(baselineCompletedResponses)
  const firstPlayingRequest = baselineRequests
  const firstPlayingResponse = baselineCompletedResponses
  expect(responseTimes[firstPlayingResponse] - requestTimes[firstPlayingRequest]).toBeGreaterThanOrEqual(1_000)
  // The initial paused request and the first playing request have completed;
  // completion may release exactly one newest-sample request, but no further
  // 500ms tick may start another while that request is active.
  await expect.poll(() => requests.length, { timeout: 3_000 }).toBe(baselineRequests + 2)
  await expect.poll(() => completedResponses, { timeout: 5_000 }).toBeGreaterThan(baselineCompletedResponses + 1)
  await expect.poll(() => requests.length, { timeout: 3_000 }).toBe(baselineRequests + 3)
  expect(completedResponses).toBe(baselineCompletedResponses + 2)
  await page.locator('.simulation-bar .primary-button').click()
  await expect(summary).not.toContainText('Loading', { timeout: 10_000 })
})
