import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { columnsForSchema, endpoint, parseCount, parseSources, queries, sha256, spatialChunks } from './lib/gaia-dr3.mjs'
import capacity from '../src/data/gaiaCapacity.json' with { type: 'json' }

const TAP_REQUEST_TIMEOUT_MS = 120000
const TAP_JOB_TIMEOUT_MS = 85 * 60 * 1000
const TAP_POLL_INTERVAL_MS = 3000
const TAP_CLEANUP_TIMEOUT_MS = 15000
const TAP_TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504])

async function withTimeout(signal, timeoutMs, action) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.throwIfAborted()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Gaia TAP request timed out', 'TimeoutError')), timeoutMs)
  try { return await action(controller.signal) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}

async function readCsvResponse(response, signal) {
  if (!response.ok || !/^text\/csv(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw new Error(`Gaia TAP rejected CSV query: HTTP ${response.status}`)
  }
  const reader = response.body.getReader(), parts = []
  let length = 0, complete = false
  try {
    for (;;) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) { complete = true; break }
      signal.throwIfAborted()
      length += value.byteLength
      if (length > capacity.maxCsvBytes) throw new Error('Gaia TAP response exceeds its byte budget')
      parts.push(value)
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return Buffer.concat(parts)
}

async function readTextPrefix(response, maxBytes = 8192) {
  if (!response.body) return ''
  const reader = response.body.getReader(), parts = []
  let length = 0, complete = false
  try {
    while (length < maxBytes) {
      const { value, done } = await reader.read()
      if (done) { complete = true; break }
      const part = value.subarray(0, maxBytes-length)
      parts.push(part); length += part.byteLength
      if (part.byteLength !== value.byteLength) break
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return Buffer.concat(parts).toString('utf8')
}

function transientTapError(error) {
  if (error?.retryable === true || error?.name === 'TimeoutError') return true
  for (let cause = error; cause; cause = cause.cause) {
    if (['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT'].includes(cause.code)) return true
  }
  return false
}

async function waitForRetry(milliseconds, signal) {
  signal.throwIfAborted()
  await new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve() }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function retryTapRead(label, signal, action) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await withTimeout(signal, TAP_REQUEST_TIMEOUT_MS, action) }
    catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      if (!transientTapError(error) || attempt >= 4) {
        throw new Error(`${label} failed${attempt ? ` after ${attempt + 1} attempts` : ''}: ${error.message}`, { cause: error })
      }
      await waitForRetry(500 * 2 ** attempt, signal)
    }
  }
}

function transientResponseError(response, label) {
  const error = new Error(`${label}: HTTP ${response.status}`)
  error.retryable = TAP_TRANSIENT_STATUSES.has(response.status)
  return error
}

async function destroyTapJob(fetcher, jobUrl) {
  const phaseUrl = new URL(`${jobUrl.pathname}/phase`, jobUrl.origin)
  let lastError = new Error('Gaia TAP job cleanup was not confirmed')
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await withTimeout(undefined, TAP_CLEANUP_TIMEOUT_MS, requestSignal => fetcher(jobUrl, {
        method: 'DELETE', signal: requestSignal, redirect: 'manual'
      }))
      if (response.status === 303 || response.status === 204 || response.status === 404) {
        await response.body?.cancel().catch(() => {})
        return
      }
      lastError = transientResponseError(response, 'Gaia TAP job deletion failed')
      await response.body?.cancel().catch(() => {})
      if (!lastError.retryable && response.status < 500) throw lastError
    } catch (error) { lastError = error }
    try {
      const phaseResponse = await withTimeout(undefined, 5000, requestSignal => fetcher(phaseUrl, { signal: requestSignal, redirect: 'error' }))
      if (phaseResponse.status === 404) return
      await phaseResponse.body?.cancel().catch(() => {})
    } catch {}
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
  }
  throw new Error(`Gaia TAP job cleanup could not be confirmed: ${lastError.message}`, { cause: lastError })
}

export async function retrieveGaiaCone(settings, { fetcher = fetch, signal, schemaVersion = 1, verifyCount = false } = {}) {
  const query = queries(settings, schemaVersion)
  const receive = async (adql, maxrec, queryName) => {
    const base = new URL(endpoint), jobEndpoint = new URL(base.pathname.replace(/\/sync$/, '/async'), base)
    const jobSignalController = new AbortController()
    const timeout = setTimeout(() => jobSignalController.abort(new DOMException('Gaia TAP job exceeded its 85 minute budget', 'TimeoutError')), TAP_JOB_TIMEOUT_MS)
    const jobSignal = signal ? AbortSignal.any([signal, jobSignalController.signal]) : jobSignalController.signal
    let jobUrl
    try {
      const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(maxrec), QUERY: adql, PHASE: 'RUN' })
      const submitted = await withTimeout(jobSignal, TAP_REQUEST_TIMEOUT_MS, requestSignal => fetcher(jobEndpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: requestSignal, redirect: 'manual'
      }))
      const location = submitted.headers.get('location')
      if (submitted.status !== 303 || !location) {
        const detail = (await readTextPrefix(submitted)).replace(/\s+/g, ' ').trim()
        throw new Error(`Gaia TAP async job was not created: HTTP ${submitted.status}${detail ? ` (${detail.slice(-1200)})` : ''}`)
      }
      const createdJobUrl = new URL(location, jobEndpoint)
      if (createdJobUrl.origin !== base.origin || !/^\/tap-server\/tap\/async\/[A-Za-z0-9_-]+\/?$/.test(createdJobUrl.pathname)) {
        throw new Error('Gaia TAP returned an invalid async job URL')
      }
      jobUrl = createdJobUrl
      jobUrl.pathname = jobUrl.pathname.replace(/\/$/, '')
      const phaseUrl = new URL(`${jobUrl.pathname}/phase`, jobUrl.origin)
      let previousPhase = '', heldRetries = 0
      for (;;) {
        jobSignal.throwIfAborted()
        const phase = await retryTapRead(`Gaia TAP ${queryName} job phase`, jobSignal, async requestSignal => {
          const phaseResponse = await fetcher(phaseUrl, { headers: { accept: 'text/plain' }, signal: requestSignal, redirect: 'error' })
          if (!phaseResponse.ok) {
            await phaseResponse.body?.cancel().catch(() => {})
            throw transientResponseError(phaseResponse, `Gaia TAP job phase request failed`)
          }
          return (await phaseResponse.text()).trim().toUpperCase()
        })
        if (phase !== previousPhase) { console.error(`Gaia TAP ${queryName}: ${phase}`); previousPhase = phase }
        if (phase === 'COMPLETED') break
        if (phase === 'ERROR') {
          let detail = ''
          try {
            const errorResponse = await withTimeout(jobSignal, 5000, requestSignal => fetcher(new URL(`${jobUrl.pathname}/error`, jobUrl.origin), { signal: requestSignal, redirect: 'error' }))
            if (errorResponse.ok) detail = (await readTextPrefix(errorResponse)).replace(/\s+/g, ' ').trim().slice(-1200)
            else await errorResponse.body?.cancel().catch(() => {})
          } catch {}
          throw new Error(`Gaia TAP async job ended in ERROR${detail ? `: ${detail}` : ''}`)
        }
        if (phase === 'ABORTED' || phase === 'ARCHIVED') throw new Error(`Gaia TAP async job ended in ${phase}`)
        if (phase === 'HELD') {
          if (++heldRetries > 4) throw new Error('Gaia TAP job remained HELD after four run requests')
          const resume = await withTimeout(jobSignal, TAP_REQUEST_TIMEOUT_MS, requestSignal => fetcher(phaseUrl, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'PHASE=RUN', signal: requestSignal, redirect: 'manual'
          }))
          if (resume.status !== 303) throw new Error(`Gaia TAP HELD job could not be resumed: HTTP ${resume.status}`)
        } else if (phase !== 'UNKNOWN' && phase !== 'SUSPENDED' && !['PENDING', 'QUEUED', 'EXECUTING'].includes(phase)) {
          throw new Error(`Gaia TAP returned an unknown async phase: ${phase || '(empty)'}`)
        } else if (phase !== 'HELD') heldRetries = 0
        await waitForRetry(TAP_POLL_INTERVAL_MS, jobSignal)
      }
      const resultUrl = new URL(`${jobUrl.pathname}/results/result`, jobUrl.origin)
      const bytes = await retryTapRead(`Gaia TAP ${queryName} result`, jobSignal, async requestSignal => {
        const result = await fetcher(resultUrl, { headers: { accept: 'text/csv' }, signal: requestSignal, redirect: 'error' })
        if (TAP_TRANSIENT_STATUSES.has(result.status)) {
          await result.body?.cancel().catch(() => {})
          throw transientResponseError(result, 'Gaia TAP result download failed')
        }
        return readCsvResponse(result, requestSignal)
      })
      jobSignal.throwIfAborted()
      await destroyTapJob(fetcher, jobUrl)
      jobUrl = undefined
      return { bytes, retrievedAt: new Date().toISOString(), query: adql, url: String(resultUrl) }
    } finally {
      clearTimeout(timeout)
      if (jobUrl) {
        await destroyTapJob(fetcher, jobUrl).catch(error => console.error(error.message))
      }
    }
  }
  // TOP maxRows+1 supplies an overflow sentinel for bounded CSV responses.
  // A second COUNT(*) scan is optional because it can cost nearly another full
  // source query while providing no extra completeness guarantee below the cap.
  const countSource = verifyCount ? await receive(query.count, 1, 'count') : undefined
  const count = countSource ? parseCount(countSource.bytes, settings.maxRows) : undefined
  const rowSource = await receive(query.rows, settings.maxRows+1, 'rows')
  const rows = parseSources(rowSource.bytes, settings, count, schemaVersion); signal?.throwIfAborted()
  return { countSource, rowSource, rows, chunks: spatialChunks(rows) }
}
async function main() {
  const args = process.argv.slice(2), verifyCount = args.filter(value => value === '--verify-count').length === 1
  if (args.filter(value => value === '--verify-count').length > 1) throw new Error('Duplicate --verify-count option')
  const options = args.filter(value => value !== '--verify-count'), known = ['--ra', '--dec', '--radius', '--max-mag', '--max-rows', '--output', '--schema'], values = {}
  if (options.length !== 12 && options.length !== 14) throw new Error('Required: --ra --dec --radius --max-mag --max-rows --output (new directory); optional --schema 1 or 2 and --verify-count')
  for (let i = 0; i < options.length; i += 2) { if (!known.includes(options[i]) || values[options[i]] !== undefined || !options[i+1]) throw new Error('Invalid or duplicate Gaia option'); values[options[i]] = options[i+1] }
  if (known.slice(0,6).some(name => values[name] === undefined)) throw new Error('Missing required Gaia option')
  const schemaVersion = Number(values['--schema'] ?? 1), columns = columnsForSchema(schemaVersion)
  const settings = { raDeg: Number(values['--ra']), decDeg: Number(values['--dec']), radiusDeg: Number(values['--radius']), maxMagnitude: Number(values['--max-mag']), maxRows: Number(values['--max-rows']) }
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop)
  try {
    const result = await retrieveGaiaCone(settings, { signal: controller.signal, schemaVersion, verifyCount }), directory = values['--output']
    for (const chunk of result.chunks) {
      const bytes = Buffer.byteLength(JSON.stringify(chunk)+'\n')
      if (bytes > capacity.maxChunkBytes || chunk.sources.length > capacity.maxChunkRows) throw new Error(`Gaia chunk ${chunk.key} exceeds its row or byte budget`)
    }
    await mkdir(directory) // Exclusive output; immutable previous receipts are never replaced.
    const sources = []
    for (const [name, value] of [...(result.countSource ? [['count', result.countSource]] : []), ['rows', result.rowSource]]) {
      const path = `${name}.csv`; await writeFile(join(directory, path), value.bytes, { flag: 'wx' })
      sources.push({ path, bytes: value.bytes.length, sha256: sha256(value.bytes), query: value.query, url: value.url, retrievedAt: value.retrievedAt })
    }
    const chunks = []
    for (const chunk of result.chunks) {
      const path = `${chunk.key}.json`, bytes = Buffer.from(JSON.stringify(chunk)+'\n')
      await writeFile(join(directory, path), bytes, { flag: 'wx' }); chunks.push({ path, sha256: sha256(bytes), bytes: bytes.length, rows: chunk.sources.length, raRangeDeg: chunk.raRangeDeg, decRangeDeg: chunk.decRangeDeg })
    }
    const implementation = { node: process.version, generatorSha256: sha256(await readFile(new URL(import.meta.url))), parserSha256: sha256(await readFile(new URL('./lib/gaia-dr3.mjs', import.meta.url))), columnsSha256: sha256(await readFile(new URL(schemaVersion === 2 ? '../src/data/gaiaColumnsV2.json' : '../src/data/gaiaColumns.json', import.meta.url))) }
    const manifest = { schemaVersion, catalog: 'Gaia DR3', table: 'gaiadr3.gaia_source', frame: 'ICRS', referenceEpochJulianYear: 2016, referenceEpochTimeScale: 'TCB', implementation, settings, columns, rows: result.rows.length,
      ...(result.countSource ? { queryCountMatched: true } : {}), rowCountEvidence: { method: 'top-plus-one-sentinel', limit: settings.maxRows+1, returnedRows: result.rows.length, overflow: false }, catalogCompletenessCertified: false,
      units: { ra: 'degree', dec: 'degree', ra_error: 'mas; alpha*cos(delta)', dec_error: 'mas', parallax: 'mas', pmra: 'mas/Julian year; mu_alpha*cos(delta)', pmdec: 'mas/Julian year', radial_velocity: 'km/s', ...(schemaVersion === 2 ? { pseudocolour:'inverse-micrometre', pseudocolour_error:'inverse-micrometre' } : {}) },
      limitations: ['A magnitude-limited cone is not full-sky data or a completeness guarantee.', 'Missing fields remain null. Negative parallax is retained; no inverse-parallax distances are inferred.', 'No proper-motion propagation, observer parallax, aberration, deflection, zero-point correction or occultation uncertainty model is applied.', 'Spatial bins describe returned coordinates at J2016.0, not bounds at arbitrary epochs.'],
      documentation: ['https://www.cosmos.esa.int/web/gaia/dr3', 'https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access', 'https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html'], sources, chunks }
    controller.signal.throwIfAborted(); await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n', { flag: 'wx' })
    console.log(JSON.stringify({ directory, rows: result.rows.length, chunks: chunks.length, countVerified: Boolean(result.countSource), rowCountEvidence: 'top-plus-one-sentinel' }))
  } finally { process.removeListener('SIGINT', stop) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
