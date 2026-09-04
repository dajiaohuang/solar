import { expect, test } from './fixtures'

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
    const noKernel = await request(['sat:planet:saturn:provisional:S/2009 S1'])
    return {
      duplicateStatus: duplicate.status,
      unknownStatus: unknown.status,
      unknownBody: await unknown.json(),
      staleAliasBody: await staleAlias.json(),
      knownPrimaryBody: await knownPrimary.json(),
      coverageGapBody: await coverageGap.json(),
      noKernelBody: await noKernel.json(),
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
  expect(result.noKernelBody.availability).toEqual(['missing'])
  expect(result.noKernelBody.source).toEqual(['fixture-current-states'])
  expect(result.noKernelBody.datasetVersion).toEqual(['fixture-v1'])
  expect(result.noKernelBody.model).toEqual(['unavailable-no-kernel'])
  expect(result.noKernelBody.missingReason).toEqual(['kernel-not-packaged'])
  expect(result.noKernelBody.validityPresent).toEqual([false])
  expect(result.noKernelBody.evidenceWindowPresent).toEqual([false])
})
