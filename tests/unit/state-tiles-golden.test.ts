import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assembleStateTiles, buildBackendFrame, decodeStateTile, digestStateTileRequestIds, StateTileSnapshot, validateStateTileManifest, validateStateTilePlan } from '../../src/lib/stateTiles'
import { AU_IN_KM } from '../../src/engine/units'
import type { CelestialBody } from '../../src/types'

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
    const assembled = assembleStateTiles(decoded.reverse(), plan)
    expect(assembled.flatMap(tile => Array.from({ length: tile.recordCount }, (_, row) => tile.metadata.idAt(row)))).toEqual(golden.ids)
    const snapshot = new StateTileSnapshot(assembled, new Map(golden.ids.map(id => [id, id])))
    for (const item of golden.tiles) for (const [row, expected] of item.expectedRows.entries()) {
      const index = item.ordinalStart + row
      expect(snapshot.backendIdAt(index)).toBe(expected.id)
      expect(snapshot.statusAt(index)).toBe(expected.status)
      const values = new Float64Array(6)
      for (let axis = 0; axis < 6; axis++) values[axis] = snapshot.stateValueAt(index, axis)
      const view = new DataView(values.buffer)
      expect(Array.from({ length: 6 }, (_, axis) => view.getBigUint64(axis * 8, true).toString(16).padStart(16, '0'))).toEqual(expected.stateIEEE754BitsLE)
    }
    const sourceRows = golden.tiles.flatMap(item => item.expectedRows)
    const exact = sourceRows.filter(row => row.status === 'exact')
    const fromBits = (bits: string) => {
      const view = new DataView(new ArrayBuffer(8))
      view.setBigUint64(0, BigInt(`0x${bits}`), true)
      return view.getFloat64(0, true)
    }
    const bodies: CelestialBody[] = golden.ids.map(id => ({ id, name: id, kind: 'asteroid', color: '#fff', size: 1, source: 'custom' }))
    for (const reference of exact.slice(0, 2)) {
      const frame = buildBackendFrame({ bodies, referenceId: reference.id, evidence: snapshot })
      expect(frame.currentPositions.length).toBe(exact.length)
      expect(frame.missingBodyIds).toEqual(sourceRows.filter(row => row.status !== 'exact').map(row => row.id))
      for (let index = 0; index < exact.length; index++) {
        expect(frame.currentPositions.bodyAt(index).id).toBe(exact[index].id)
        for (let axis = 0; axis < 3; axis++) {
          expect(frame.currentPositions.coordinateAt(index, axis)).toBe(fromBits(exact[index].stateIEEE754BitsLE[axis]) / AU_IN_KM - fromBits(reference.stateIEEE754BitsLE[axis]) / AU_IN_KM)
        }
      }
    }
  })
})
