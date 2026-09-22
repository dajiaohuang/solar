import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { packRuntimeJson } from '../../scripts/lib/pack-runtime-json'
import { unpackRuntimeJson, type JsonValue } from '../../src/data/runtimeJson'
import { runtimeEphemerisManifest } from '../../src/engine/ephemeris/runtimeManifest'
import { productDelivery } from '../../scripts/lib/product-delivery'

it('preserves nested JSON, property order, negative zero and special keys', () => {
  const input: JsonValue = { empty: [], object: {}, values: [false, true, null, -0, 1.2345678901234567, 'repeated long string', 'repeated long string'], special: JSON.parse('{"__proto__":{"safe":true},"constructor":7}') }
  const output = unpackRuntimeJson<typeof input>(JSON.parse(JSON.stringify(packRuntimeJson(input))))
  expect(output).toEqual(input)
  expect(JSON.stringify(output)).toBe(JSON.stringify(input))
  expect(Object.getPrototypeOf(output.special)).toBe(Object.prototype)
  expect(Object.hasOwn(output.special as object, '__proto__')).toBe(true)
})

it.each(['ephemerisBodies.json', 'satelliteCatalog.json'])('losslessly compacts the complete %s source', name => {
  const source = JSON.parse(readFileSync(new URL(`../../src/data/${name}`, import.meta.url), 'utf8'))
  const packed = JSON.stringify(packRuntimeJson(source))
  expect(JSON.stringify(unpackRuntimeJson(JSON.parse(packed)))).toBe(JSON.stringify(source))
  expect(Buffer.byteLength(packed)).toBeLessThan(Buffer.byteLength(JSON.stringify(source)) * .65)
})

it.each(['full', 'preview'])('preserves every field of the %s runtime manifest', profile => {
  const source = JSON.parse(JSON.stringify(runtimeEphemerisManifest(productDelivery(profile).manifest)))
  const packed = JSON.stringify(packRuntimeJson(source))
  expect(JSON.stringify(unpackRuntimeJson(JSON.parse(packed)))).toBe(JSON.stringify(source))
})
