import { expect, test } from 'vitest'
import { projectGaiaDisplay } from '../../src/lib/gaiaProjection'
import type { GaiaChunk } from '../../src/lib/gaiaChunks'

test('tangent display keeps east left and north up without changing scientific Float64 directions', () => {
  const ra = .001*Math.PI/180, dec = .002*Math.PI/180
  const directions = new Float64Array([Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec)])
  const before = directions.slice()
  const chunk = { sources:[{ source_id:'123', ref_epoch:2016, ra:.001, dec:.002, phot_g_mean_mag:12 }], directionsICRS:directions } as GaiaChunk
  const display = projectGaiaDisplay(chunk,0,0,.1), scale = Math.tan(.1*Math.PI/180)*1.1
  expect(display).toBeInstanceOf(Float32Array)
  expect(display[0]).toBeCloseTo(-Math.tan(ra)/scale,8)
  expect(display[1]).toBeCloseTo(Math.tan(dec)/Math.cos(ra)/scale,8)
  expect(display[2]).toBe(12); expect(directions).toEqual(before)
})
test('rejects a star behind the tangent plane', () => {
  const chunk = { sources:[{ phot_g_mean_mag:12 }], directionsICRS:new Float64Array([-1,0,0]) } as GaiaChunk
  expect(() => projectGaiaDisplay(chunk,0,0,1)).toThrow(/behind/)
})
