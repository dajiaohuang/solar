// Repackage complete original Chebyshev records, never resample or fit states.
// DAF/SPK layout: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html
import { createHash } from 'node:crypto'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024
const MAX_RANGE_BYTES = 128 * 1024 * 1024

async function sha256File(path) {
  const hash = createHash('sha256')
  const handle = await open(path, 'r')
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk))
  } finally { await handle.close() }
  return hash.digest('hex')
}

export async function openSource(source) {
  if (!/^https:\/\//.test(source)) {
    const handle = await open(source, 'r')
    const size = (await handle.stat()).size
    return {
      size, identity: { source, bytes: size, sha256: await sha256File(source) },
      async read(start, length) {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0 || length > MAX_RANGE_BYTES || start + length > size) throw new Error('SPK range outside source or safety limit')
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, start)
        if (bytesRead !== length) throw new Error('Truncated local SPK')
        return buffer
      },
      close: () => handle.close(),
    }
  }
  const head = await fetch(source, { method: 'HEAD', signal: AbortSignal.timeout(60000) })
  if (!head.ok) throw new Error(`SPK HEAD ${head.status}: ${source}`)
  const size = Number(head.headers.get('content-length'))
  const etag = head.headers.get('etag')
  const modified = head.headers.get('last-modified')
  if (!Number.isSafeInteger(size) || size <= 0 || (!etag && !modified)) throw new Error('Remote SPK needs size and response validator')
  return {
    size, identity: { source, bytes: size, etag, lastModified: modified },
    async read(start, length) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0 || length > MAX_RANGE_BYTES || start + length > size) throw new Error('SPK range outside source')
      const response = await fetch(source, {
        headers: { Range: `bytes=${start}-${start + length - 1}`, ...(etag ? { 'If-Match': etag } : { 'If-Unmodified-Since': modified }) },
        signal: AbortSignal.timeout(120000),
      })
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${start + length - 1}/${size}`) {
        await response.body?.cancel()
        throw new Error(`Server did not honor exact SPK range (${response.status})`)
      }
      if ((etag && response.headers.get('etag') !== etag) || (modified && response.headers.get('last-modified') !== modified)) {
        await response.body?.cancel(); throw new Error('Source SPK changed during extraction')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Missing SPK range body')
      const buffer = Buffer.alloc(length)
      let offset = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (offset + chunk.value.length > length) throw new Error('Oversized SPK range')
          buffer.set(chunk.value, offset); offset += chunk.value.length
        }
      } catch (error) { await reader.cancel(); throw error }
      if (offset !== length) throw new Error('Truncated SPK range')
      return buffer
    },
    async close() {},
  }
}

export async function inspectSpk(source) {
  const header = await source.read(0, 1024)
  if (header.toString('ascii', 0, 8) !== 'DAF/SPK ') throw new Error('Not a DAF/SPK kernel')
  const format = header.toString('ascii', 88, 96)
  const little = format === 'LTL-IEEE'
  if (!little && format !== 'BIG-IEEE') throw new Error(`Unsupported DAF architecture ${format}`)
  const int = (b, offset) => little ? b.readInt32LE(offset) : b.readInt32BE(offset)
  const double = (b, offset) => little ? b.readDoubleLE(offset) : b.readDoubleBE(offset)
  if (int(header, 8) !== 2 || int(header, 12) !== 6) throw new Error('Invalid SPK descriptor dimensions')
  const visited = new Set()
  let record = int(header, 76)
  const segments = []
  while (record) {
    if (!Number.isInteger(record) || record < 2 || record * 1024 > source.size || visited.has(record)) throw new Error('Invalid/cyclic DAF summary')
    visited.add(record)
    const summary = await source.read((record - 1) * 1024, 1024)
    const count = double(summary, 16)
    if (!Number.isInteger(count) || count < 0 || count > 25) throw new Error('Invalid SPK segment count')
    for (let index = 0; index < count; index++) {
      const offset = 24 + index * 40
      const segment = {
        startEt: double(summary, offset), endEt: double(summary, offset + 8),
        target: int(summary, offset + 16), center: int(summary, offset + 20),
        frame: int(summary, offset + 24), type: int(summary, offset + 28),
        startAddress: int(summary, offset + 32), endAddress: int(summary, offset + 36),
      }
      if (!Number.isFinite(segment.startEt) || !Number.isFinite(segment.endEt) || segment.startEt > segment.endEt || !Number.isSafeInteger(segment.startAddress) || !Number.isSafeInteger(segment.endAddress) || segment.startAddress < 1 || segment.endAddress < segment.startAddress || segment.endAddress * 8 > source.size) throw new Error('SPK segment descriptor/address out of bounds')
      segments.push(segment)
    }
    record = double(summary, 0)
  }
  return { segments, little, double, header }
}

export async function cropSpk(source, { startEt, endEt, targets }) {
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || startEt >= endEt) throw new Error('Invalid crop time window')
  const input = await inspectSpk(source)
  const selected = input.segments.filter((s) => (!targets || targets.includes(s.target)) && s.startEt <= endEt && s.endEt >= startEt)
  const output = []
  let dataBytes = 0
  for (const segment of selected) {
    if (![2, 3].includes(segment.type) || ![1, 17].includes(segment.frame)) throw new Error(`Unsupported selected SPK ${segment.target}: type ${segment.type}, frame ${segment.frame}`)
    const directory = await source.read((segment.endAddress - 4) * 8, 32)
    const init = input.double(directory, 0), interval = input.double(directory, 8)
    const recordSize = input.double(directory, 16), count = input.double(directory, 24)
    const validStride = segment.type === 2 ? (recordSize - 2) % 3 === 0 : (recordSize - 2) % 6 === 0
    if (!Number.isFinite(init) || !Number.isFinite(interval) || !(interval > 0) || !Number.isInteger(recordSize) || recordSize < 5 || !validStride || !Number.isInteger(count) || count < 1 || !Number.isSafeInteger(count * recordSize) || count * recordSize + 4 !== segment.endAddress - segment.startAddress + 1 || segment.startEt < init || segment.endEt > init + count * interval) throw new Error('Invalid Chebyshev directory')
    const from = Math.max(startEt, segment.startEt), to = Math.min(endEt, segment.endEt)
    const first = Math.max(0, Math.min(count - 1, Math.floor((from - init) / interval)))
    const last = Math.max(first, Math.min(count - 1, Math.floor((to - init) / interval)))
    const rawBytes = (last - first + 1) * recordSize * 8
    if (!Number.isSafeInteger(rawBytes) || rawBytes > MAX_RANGE_BYTES || dataBytes + rawBytes + 32 > MAX_OUTPUT_BYTES - 3 * 1024) throw new Error('Cropped SPK exceeds safety limit')
    const raw = await source.read((segment.startAddress - 1 + first * recordSize) * 8, rawBytes)
    const data = Buffer.alloc(raw.length + 32)
    for (let offset = 0; offset < raw.length; offset += 8) data.writeDoubleLE(input.double(raw, offset), offset)
    data.writeDoubleLE(init + first * interval, raw.length)
    data.writeDoubleLE(interval, raw.length + 8)
    data.writeDoubleLE(recordSize, raw.length + 16)
    data.writeDoubleLE(last - first + 1, raw.length + 24)
    output.push({ ...segment, startEt: from, endEt: to, data })
    dataBytes += data.length
  }
  if (!output.length) throw new Error('No selected SPK coverage')
  // Header followed by pairs of summary/name records; addresses are 1-based doubles.
  const summaryCount = Math.ceil(output.length / 25)
  const prefixBytes = (1 + 2 * summaryCount) * 1024
  const length = prefixBytes + output.reduce((total, s) => total + s.data.length, 0)
  const paddedLength = Math.ceil(length / 1024) * 1024
  if (!Number.isSafeInteger(paddedLength) || paddedLength > MAX_OUTPUT_BYTES) throw new Error(`Cropped SPK exceeds ${MAX_OUTPUT_BYTES} byte safety limit`)
  const buffer = Buffer.alloc(paddedLength)
  buffer.write('DAF/SPK ', 0, 'ascii'); buffer.writeInt32LE(2, 8); buffer.writeInt32LE(6, 12)
  buffer.write('Solar Atlas: exact original SPK record subset', 16, 'ascii')
  buffer.writeInt32LE(2, 76); buffer.writeInt32LE(2 + 2 * (summaryCount - 1), 80)
  buffer.writeInt32LE(length / 8 + 1, 84); buffer.write('LTL-IEEE', 88, 'ascii')
  buffer.write('FTPSTR:\r:\n:\r\n:\r\0:\x81:\x10\xce:ENDFTP', 699, 'latin1')
  let address = prefixBytes / 8 + 1
  for (let index = 0; index < output.length; index++) {
    const s = output[index], group = Math.floor(index / 25), slot = index % 25
    const summaryOffset = (1 + 2 * group) * 1024
    buffer.writeDoubleLE(group + 1 < summaryCount ? 2 + 2 * (group + 1) : 0, summaryOffset)
    buffer.writeDoubleLE(group ? 2 + 2 * (group - 1) : 0, summaryOffset + 8)
    buffer.writeDoubleLE(Math.min(25, output.length - group * 25), summaryOffset + 16)
    const offset = summaryOffset + 24 + slot * 40
    buffer.writeDoubleLE(s.startEt, offset); buffer.writeDoubleLE(s.endEt, offset + 8)
    ;[s.target, s.center, s.frame, s.type, address, address + s.data.length / 8 - 1].forEach((value, i) => buffer.writeInt32LE(value, offset + 16 + i * 4))
    buffer.write(`JPL subset target ${s.target}`, summaryOffset + 1024 + slot * 40, 40, 'ascii')
    s.data.copy(buffer, (address - 1) * 8)
    address += s.data.length / 8
  }
  return { buffer, segments: output.map(({ data, ...s }) => ({ ...s, bytes: data.length })), source: source.identity, sha256: sha256(buffer) }
}

async function main() {
  const [sourceName, destination, from = '2000-01-01', to = '2051-01-01', targetList] = process.argv.slice(2)
  if (!sourceName || !destination) throw new Error('Usage: node scripts/crop-spk.mjs SOURCE_FILE_OR_HTTPS OUTPUT.bsp [FROM_ISO TO_ISO TARGET_IDS_COMMA_SEPARATED] (bounds interpreted as TDB dates)')
  const toEt = (date) => (Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5 - 2451545) * 86400
  const source = await openSource(sourceName)
  try {
    const result = await cropSpk(source, { startEt: toEt(from), endEt: toEt(to), targets: targetList ? targetList.split(',').map(Number) : undefined })
    await mkdir(dirname(resolve(destination)), { recursive: true })
    await writeFile(destination, result.buffer)
    const { buffer, ...evidence } = result
    await writeFile(`${destination}.json`, `${JSON.stringify({ ...evidence, bytes: buffer.length }, null, 2)}\n`)
    console.log(JSON.stringify({ destination, bytes: buffer.length, sha256: result.sha256, targets: [...new Set(result.segments.map((s) => s.target))] }))
  } finally { await source.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
