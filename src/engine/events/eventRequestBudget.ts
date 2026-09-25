const MAX_REQUEST_WEIGHT = 8 * 1024 * 1024

/** Admission weight for plain event inputs, not a structured-clone heap-size
 * claim. Count repeated references repeatedly so JSON cache-key expansion is
 * also bounded; reject cycles and accessors before cloning/serializing them. */
export function assertEventRequestBudget(request: unknown): void {
  let weight = 0
  const ancestors = new Set<object>()
  const charge = (bytes: number) => {
    weight += bytes
    if (weight > MAX_REQUEST_WEIGHT) throw new RangeError('Event request exceeds the 8 MiB input-weight budget')
  }
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64) throw new RangeError('Event request nesting exceeds 64 levels')
    if (typeof value === 'string') { charge(24 + 6 * value.length); return }
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') { charge(24); return }
    if (typeof value !== 'object') throw new TypeError('Event request must contain plain data')
    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Event request must contain plain objects and arrays')
    if (ancestors.has(value)) throw new TypeError('Event request contains a cycle')
    charge(64 + (Array.isArray(value) ? value.length * 8 : 0))
    ancestors.add(value)
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      charge(24 + 6 * key.length)
      const property = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in property)) throw new TypeError('Event request accessors are unsupported')
      visit(property.value, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(request, 0)
}
