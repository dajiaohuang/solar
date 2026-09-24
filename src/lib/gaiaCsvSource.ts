import capacity from '../data/gaiaCapacity.json'

// Parse only bounded original evidence; keep decimal source IDs as text.
export async function selectedGaiaCsvSource(bytes: Uint8Array, sourceId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  if (!bytes.length || bytes.length > capacity.maxCsvBytes) throw new Error('Gaia CSV byte budget exceeded')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let header: string[] | undefined, selected: string[] | undefined, count = 0
  const row: string[] = []
  let cell = '', quoted = false, closed = false, pendingQuote = false, pendingCR = false
  const field = () => { row.push(cell); cell = ''; closed = false }
  const record = () => {
    field()
    if (row.length === 1 && row[0] === '') { row.length = 0; return }
    if (!header) {
      header = row.splice(0)
      if (header[0] !== 'source_id' || new Set(header).size !== header.length || header.some(v => !v)) throw new Error('Invalid Gaia CSV header')
      return
    }
    if (++count > capacity.maxCatalogRows) throw new Error('Gaia CSV row budget exceeded')
    if (row.length !== header.length) throw new Error('Gaia CSV column mismatch')
    if (row[0] === sourceId) { if (selected) throw new Error('Duplicate Gaia source'); selected = row.slice() }
    row.length = 0
  }
  const consume = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      // A quote or CR can be the last character of a decoded chunk. Resolve
      // lookahead in the next chunk without retaining the whole CSV string.
      if (pendingCR) { pendingCR = false; if (char === '\n') continue }
      if (pendingQuote) {
        pendingQuote = false
        if (char === '"') { cell += '"'; continue }
        quoted = false; closed = true
      }
      if (quoted) {
        if (char === '"') pendingQuote = true
        else cell += char
      } else if (char === ',') field()
      else if (char === '\n' || char === '\r') { pendingCR = char === '\r'; record() }
      else if (char === '"' && !cell && !closed) quoted = true
      else { if (closed || char === '"') throw new Error('Malformed Gaia CSV quoting'); cell += char }
    }
  }
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    // Yield by source bytes, including for a single long quoted field.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    consume(decoder.decode(bytes.subarray(offset, offset + 32768), { stream: true }))
  }
  consume(decoder.decode()) // Reject a truncated final UTF-8 sequence.
  if (pendingQuote) { pendingQuote = false; quoted = false; closed = true }
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
