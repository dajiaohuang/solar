import type { JsonValue, PackedJson } from '../../src/data/runtimeJson.ts'

// Share repeated key sequences and strings, retaining the complete JSON tree.
export function packRuntimeJson(value: JsonValue): PackedJson {
  const counts = new Map<string, number>()
  const count = (item: JsonValue) => {
    if (typeof item === 'string' && item.length >= 8) counts.set(item, (counts.get(item) ?? 0) + 1)
    else if (item && typeof item === 'object') Object.values(item).forEach(count)
  }
  count(value)
  const strings = [...counts].filter(([, count]) => count > 1).map(([text]) => text)
  const stringIds = new Map(strings.map((text, index) => [text, index]))
  const schemas: string[][] = []
  const schemaIds = new Map<string, number>()
  const encode = (item: JsonValue): JsonValue => {
    if (typeof item === 'number' && Object.is(item, -0)) return [-2]
    if (typeof item === 'string' && stringIds.has(item)) return [-1, stringIds.get(item)!]
    if (Array.isArray(item)) return [0, ...item.map(encode)]
    if (item && typeof item === 'object') {
      const keys = Object.keys(item), key = JSON.stringify(keys)
      let id = schemaIds.get(key)
      if (id === undefined) { id = schemas.length; schemaIds.set(key, id); schemas.push(keys) }
      return [id + 1, ...keys.map(key => encode(item[key]))]
    }
    return item
  }
  const root = encode(value)
  return { schemas, strings, root }
}
