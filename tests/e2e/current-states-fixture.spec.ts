import { expect, test } from './fixtures'

test('full-Web fixture rejects duplicate IDs and marks unknown identities missing', async ({ page }) => {
  await page.goto('./?v=4&lang=en')
  const result = await page.evaluate(async () => {
    const request = (ids: string[]) => fetch('/solar-test-api/v1/current-states', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, epochJd: 2461287.5, frame: 'ECLIPJ2000', precision: 'exact' }),
    })
    const duplicate = await request(['sun', 'sun'])
    const unknown = await request(['naif:999999999'])
    const staleAlias = await request(['quaoar'])
    const knownPrimary = await request(['naif:920050000'])
    return {
      duplicateStatus: duplicate.status,
      unknownStatus: unknown.status,
      unknownBody: await unknown.json(),
      staleAliasBody: await staleAlias.json(),
      knownPrimaryBody: await knownPrimary.json(),
    }
  })

  expect(result.duplicateStatus).toBe(400)
  expect(result.unknownStatus).toBe(200)
  expect(result.unknownBody.availability).toEqual(['missing'])
  expect(result.unknownBody.model).toEqual(['exact-only'])
  expect(result.unknownBody.missingReason).toEqual(['unknown-identity'])
  expect(result.unknownBody.statePresent).toEqual([false])
  expect(result.staleAliasBody.availability).toEqual(['missing'])
  expect(result.staleAliasBody.missingReason).toEqual(['unknown-identity'])
  expect(result.knownPrimaryBody.availability).toEqual(['operational'])
  expect(result.knownPrimaryBody.statePresent).toEqual([true])
})
