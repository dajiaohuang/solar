import { describe, expect, it } from 'vitest'
import { fetchStateWindow } from '../../src/lib/stateWindowClient'
import { fetchStateTilePlan } from '../../src/lib/stateTileClient'
import { fetchStateTiles } from '../../src/lib/stateTiles'

const base = process.env.SOLAR_TEST_BACKEND_URL?.replace(/\/+$/, '')
describe.skipIf(!base)('real Go multi-epoch stream', () => {
  it('matches independent exact tiles, including explicit missing states, in the Web decoder', async () => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base!).hostname)) throw new Error('Loopback backend required')
    const bodyIds = ['naif:10', 'naif:399', 'naif:301', 'naif:599', 'naif:501', 'test:missing']
    const epochsTdbJd = [2461287.5, 2461287.51, 2461287.52, 2461287.53, 2461287.54]
    const signal = AbortSignal.timeout(60_000)
    let received = 0
    for await (const value of fetchStateWindow({ base: base!, bodyIds, epochsTdbJd, signal })) {
      const { plan } = await fetchStateTilePlan({ base: base!, bodyIds, epochTdbJd: epochsTdbJd[value.epochIndex], signal })
      const tiles = await fetchStateTiles({ base: base!, plan, signal })
      expect(value.plan.exactCount).toBe(5); expect(value.plan.missingCount).toBe(1)
      expect(value.tiles[0].states).toEqual(tiles[0].states)
      expect(value.tiles[0].exactBitmap).toEqual(tiles[0].exactBitmap)
      for (let row = 0; row < bodyIds.length; row++) expect(value.tiles[0].metadata.rowAt(row)).toEqual(tiles[0].metadata.rowAt(row))
      received++
    }
    expect(received).toBe(5)
  }, 90_000)
})
