// Parse only bounded original evidence; keep decimal source IDs as text.
export async function selectedGaiaCsvSource(bytes: Uint8Array, sourceId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  if (!bytes.length || bytes.length > 8 << 20) throw new Error('Gaia CSV byte budget exceeded')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let header: string[] | undefined, selected: string[] | undefined, count = 0
  const row: string[] = []
  let cell = '', quoted = false, closed = false
  const field = () => { row.push(cell); cell = ''; closed = false }
  const record = () => {
    field()
    if (row.length === 1 && row[0] === '') { row.length = 0; return }
    if (!header) {
      header = row.splice(0)
      if (header[0] !== 'source_id' || new Set(header).size !== header.length || header.some(v => !v)) throw new Error('Invalid Gaia CSV header')
      return
    }
    if (++count > 10000) throw new Error('Gaia CSV row budget exceeded')
    if (row.length !== header.length) throw new Error('Gaia CSV column mismatch')
    if (row[0] === sourceId) { if (selected) throw new Error('Duplicate Gaia source'); selected = row.slice() }
    row.length = 0
  }
  let nextYield = 0
  for (let i = 0; i < text.length; i++) {
    // Yield by input size rather than row count: even one long field is bounded.
    if (i >= nextYield) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); nextYield = i + 32768 }
    const char = text[i]
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
      else cell += char
    } else if (char === ',') field()
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record() }
    else if (char === '"' && !cell && !closed) quoted = true
    else { if (closed || char === '"') throw new Error('Malformed Gaia CSV quoting'); cell += char }
  }
  if (quoted) throw new Error('Unterminated Gaia CSV field')
  if (cell || closed || row.length) record()
  signal?.throwIfAborted()
  if (!header) throw new Error('Invalid Gaia CSV header')
  if (!selected) throw new Error('Selected Gaia source absent from original CSV')
  const selectedRow = selected
  const result: Record<string, unknown> = Object.create(null)
  header.forEach((name, i) => {
    const value = selectedRow[i]
    if (i === 0) result[name] = value
    else if (value === '') result[name] = null
    else {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error('Invalid Gaia numeric source field')
      result[name] = Number(value)
    }
  })
  return result
}
