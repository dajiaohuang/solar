export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type PackedJson = { schemas: string[][]; strings: string[]; root: JsonValue }

// Only generated build artifacts use this representation. Scientific values,
// property order and source documents are preserved; no precision is reduced.
export function unpackRuntimeJson<T>(packed: PackedJson): T {
  const decode = (value: JsonValue): unknown => {
    if (!Array.isArray(value)) return value
    const tag = value[0] as number
    if (tag === -1) return packed.strings[value[1] as number]
    if (tag === -2) return -0
    if (tag === 0) return value.slice(1).map(decode)
    const keys = packed.schemas[tag - 1]
    return Object.fromEntries(keys.map((key, index) => [key, decode(value[index + 1])]))
  }
  return decode(packed.root) as T
}
