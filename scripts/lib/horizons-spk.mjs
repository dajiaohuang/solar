import { createHash } from 'node:crypto'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Official small-body SPK API; caller must await requests serially. */
export async function fetchHorizonsSpk({ designation, target, from, to }) {
  if (!/^[1-9]\d*$/.test(designation) || !Number.isSafeInteger(target)) throw new Error('Explicit numbered designation and target required')
  for (const date of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid TDB calendar bound')
  if (from >= to) throw new Error('Invalid SPK interval')
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api')
  for (const [key, value] of Object.entries({ format: 'json', COMMAND: `'${designation};'`, EPHEM_TYPE: 'SPK', OBJ_DATA: 'YES', START_TIME: `'${from}'`, STOP_TIME: `'${to}'` })) url.searchParams.set(key, value)
  const retrievedAt = new Date().toISOString()
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Horizons SPK HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing Horizons response body')
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.length
      if (size > 64 * 1024 * 1024) throw new Error('Horizons SPK response exceeds limit')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel(); throw error }
  const raw = Buffer.concat(chunks), payload = JSON.parse(raw.toString('utf8'))
  if (payload.signature?.source !== 'NASA/JPL Horizons API' || payload.signature?.version !== '1.2' && payload.signature?.version !== '1.3') throw new Error('Unrecognized Horizons API signature')
  if (payload.error || String(payload.spk_file_id) !== String(target) || typeof payload.spk !== 'string') throw new Error(`Horizons did not return the requested SPK target ${target}: ${payload.error ?? payload.result?.slice(0, 500) ?? 'missing SPK'}`)
  const encoded = payload.spk.replace(/\s/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid SPK base64')
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length < 3072 || buffer.toString('ascii', 0, 8) !== 'DAF/SPK ') throw new Error('Invalid SPK payload')
  return { buffer, raw, source: { source: url.href, retrievedAt, bytes: buffer.length, sha256: digest(buffer), responseSha256: digest(raw), signature: payload.signature, target, designation, from, to, timeScale: 'TDB', solution: payload.result } }
}
