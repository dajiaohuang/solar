import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assembleStateTiles, decodeStateTile, digestStateTileRequestIds, validateStateTileManifest, validateStateTilePlan } from '../../src/lib/stateTiles'

const directory = process.env.SOLAR_STATE_TILE_FIXTURE_DIR
type Golden = {
  format: string
  ids: string[]
  epochJd: number
  tiles: { sequence: number; file: string; bytes: number; sha256: string; payloadSha256: string; ordinalStart: number; recordCount: number; expectedRows: { id: string; status: string; stateIEEE754BitsLE: string[] }[] }[]
}

describe.skipIf(!directory)('shared Go-generated state tiles', () => {
  it('decodes the actual Go handler output with the production Web decoder', async () => {
    const golden: Golden = JSON.parse(await readFile(join(directory!, 'manifest.json'), 'utf8'))
    expect(golden.format).toBe('solar.state-tile-fixture/v1')
    const manifest = validateStateTileManifest(JSON.parse(await readFile(join(directory!, 'catalog-manifest.json'), 'utf8')))
    const plan = validateStateTilePlan(JSON.parse(await readFile(join(directory!, 'plan.json'), 'utf8')), manifest, golden.epochJd, golden.ids, await digestStateTileRequestIds(golden.ids))
    const decoded = []
    for (const item of golden.tiles) {
      expect(item.file).toBe(`tile-${item.sequence}.bin`)
      const bytes = await readFile(join(directory!, item.file))
      expect(bytes.byteLength).toBe(item.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256)
      const tile = await decodeStateTile(bytes, { planHash: plan.planHash, catalogManifestSha256: manifest.catalogManifestSha256, inventoryManifestSha256: manifest.inventoryManifestSha256, sequence: item.sequence, tileCount: plan.tileCount })
      expect(tile.payloadSha256).toBe(item.payloadSha256)
      expect(tile.ordinalStart).toBe(item.ordinalStart)
      expect(tile.recordCount).toBe(item.recordCount)
      for (const [row, expected] of item.expectedRows.entries()) {
        expect(tile.metadata.idAt(row)).toBe(expected.id)
        expect(Boolean(tile.exactBitmap[row >> 3] & (1 << (row % 8)))).toBe(expected.status === 'exact')
        const view = new DataView(tile.states.buffer, tile.states.byteOffset, tile.states.byteLength)
        expect(Array.from({ length: 6 }, (_, axis) => view.getBigUint64((row * 6 + axis) * 8, true).toString(16).padStart(16, '0'))).toEqual(expected.stateIEEE754BitsLE)
      }
      decoded.push(tile)
    }
    expect(assembleStateTiles(decoded.reverse(), plan).flatMap(tile => Array.from({ length: tile.recordCount }, (_, row) => tile.metadata.idAt(row)))).toEqual(golden.ids)
  })
})
