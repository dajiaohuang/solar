import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Source'
import { parseDe440MassPlan } from '../../src/engine/dynamics/de440Gm'
import { checkDe440MassReceipt } from '../../src/lib/de440MassReceipt'

const gmText = readFileSync('src/data/gm_de440.tpc','utf8')
const exclusions = Object.fromEntries(DE440_FORCE_IDS.map(id => [id,0]))

test('receipt mass evidence matches the exact pinned GM values and exclusions', async () => {
  const masses = parseDe440MassPlan(gmText,exclusions)
  expect(masses).toHaveLength(DE440_FORCE_IDS.length)
  expect(masses.find(mass => mass.naifId === 10)?.gmSource).toBe(`${DE440_DYNAMICS_SOURCE.gmSource} SHA-256 ${DE440_DYNAMICS_SOURCE.gmSha256}`)
  await expect(checkDe440MassReceipt(masses,0)).resolves.toBeUndefined()

  const changedGm = masses.map(mass => ({ ...mass }))
  changedGm[0].gmKm3PerSecond2 *= 1.000001
  await expect(checkDe440MassReceipt(changedGm,0)).rejects.toThrow('pinned GM source')

  const changedExclusion = masses.map(mass => ({ ...mass }))
  changedExclusion[0].exclusionKm = 1
  await expect(checkDe440MassReceipt(changedExclusion,0)).rejects.toThrow('request')
})

test('DE440 mass-plan parsing rejects unmodeled exclusions and duplicate GM assignments', () => {
  expect(() => parseDe440MassPlan(gmText,{ ...exclusions, 3: 0 })).toThrow('each pinned force ID')
  expect(() => parseDe440MassPlan(gmText.replace('BODY1_GM       =', 'BODY1_GM       = ( 1 )\n     BODY1_GM       ='),exclusions)).toThrow('NAIF 1')
})
