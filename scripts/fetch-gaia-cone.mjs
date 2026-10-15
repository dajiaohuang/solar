import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { columnsForSchema, endpoint, parseCount, parseSources, queries, sha256, spatialChunks } from './lib/gaia-dr3.mjs'
import capacity from '../src/data/gaiaCapacity.json' with { type: 'json' }

const TAP_REQUEST_TIMEOUT_MS = 120000
const TAP_JOB_TIMEOUT_MS = 85 * 60 * 1000
const TAP_POLL_INTERVAL_MS = 3000
const TAP_CLEANUP_TIMEOUT_MS = 15000
const TAP_TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504])
const TAP_JOB_RECEIPT_FORMAT = 'solar-gaia-tap-job-v1'

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
  const reader = response.body.getReader()
  let bytes = Buffer.allocUnsafe(Math.min(64 * 1024, capacity.maxCsvBytes))
  let length = 0, complete = false
  try {
    for (;;) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) { complete = true; break }
      signal.throwIfAborted()
      const nextLength = length + value.byteLength
      if (nextLength > capacity.maxCsvBytes) throw new Error('Gaia TAP response exceeds its byte budget')
      if (nextLength > bytes.byteLength) {
        const nextCapacity = Math.min(capacity.maxCsvBytes, Math.max(nextLength, bytes.byteLength * 2))
        const next = Buffer.allocUnsafe(nextCapacity)
        bytes.copy(next, 0, 0, length)
        bytes = next
      }
      bytes.set(value, length)
      length = nextLength
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  // Keep one bounded output buffer instead of retaining transport chunks beside
  // a second full-size concatenation allocation.
  return bytes.subarray(0, length)
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
  throw new Error(`Gaia TAP job cleanup could not be confirmed for ${jobUrl.href}: ${lastError.message}`, { cause: lastError })
}

function validatedTapJobUrl(value) {
  const base = new URL(endpoint)
  const jobUrl = new URL(value)
  if (jobUrl.origin !== base.origin || !/^\/tap-server\/tap\/async\/[A-Za-z0-9_-]+\/?$/.test(jobUrl.pathname) || jobUrl.search || jobUrl.hash) {
    throw new Error('Gaia TAP job receipt contains an invalid async job URL')
  }
  jobUrl.pathname = jobUrl.pathname.replace(/\/$/, '')
  return jobUrl
}

function parseJobReceipt(bytes, expected) {
  let receipt
  try { receipt = JSON.parse(bytes.toString('utf8')) }
  catch (error) { throw new Error(`Gaia TAP job receipt is not valid JSON: ${error.message}`, { cause: error }) }
  if (receipt?.format !== TAP_JOB_RECEIPT_FORMAT || !['count', 'rows'].includes(receipt.queryName)) throw new Error('Unsupported Gaia TAP job receipt format')
  if (receipt.queryName !== expected.queryName || receipt.maxrec !== expected.maxrec || receipt.schemaVersion !== expected.schemaVersion ||
      receipt.query !== expected.query || receipt.querySha256 !== sha256(Buffer.from(expected.query, 'utf8')) ||
      !receipt.settings || ['raDeg', 'decDeg', 'radiusDeg', 'maxMagnitude', 'maxRows'].some(key => receipt.settings[key] !== expected.settings[key])) {
    throw new Error('Gaia TAP job receipt does not match the requested query, schema or settings')
  }
  const jobUrl = validatedTapJobUrl(receipt.jobUrl)
  return { receipt, jobUrl, receiptSha256: sha256(bytes) }
}

async function readJobReceiptHeader(path) {
  let bytes
  try { bytes = await readFile(path) }
  catch (error) { throw new Error(`Could not read Gaia TAP job receipt ${path}: ${error.message}`, { cause: error }) }
  let receipt
  try { receipt = JSON.parse(bytes.toString('utf8')) }
  catch (error) { throw new Error(`Gaia TAP job receipt is not valid JSON: ${error.message}`, { cause: error }) }
  if (receipt?.format !== TAP_JOB_RECEIPT_FORMAT || !['count', 'rows'].includes(receipt.queryName)) throw new Error('Unsupported Gaia TAP job receipt format')
  return receipt.queryName
}

export async function retrieveGaiaCone(settings, { fetcher = fetch, signal, schemaVersion = 1, verifyCount = false, jobReceiptPath, resumeJobReceiptPath } = {}) {
  const query = queries(settings, schemaVersion)
  let resumeQueryName
  if (resumeJobReceiptPath) {
    resumeQueryName = await readJobReceiptHeader(resumeJobReceiptPath)
    if (!verifyCount && resumeQueryName !== 'rows') throw new Error('A count-job receipt can only be resumed with --verify-count')
  }
  const receiptPathFor = queryName => jobReceiptPath ? (queryName === 'count' ? jobReceiptPath.replace(/\.json$/i, '-count.json') : jobReceiptPath) : undefined
  const receive = async (adql, maxrec, queryName, { receiptPath = receiptPathFor(queryName), resumeReceiptPath = resumeQueryName === queryName ? resumeJobReceiptPath : undefined } = {}) => {
    const base = new URL(endpoint), jobEndpoint = new URL(base.pathname.replace(/\/sync$/, '/async'), base)
    const jobSignalController = new AbortController()
    const timeout = setTimeout(() => jobSignalController.abort(new DOMException('Gaia TAP job exceeded its 85 minute budget', 'TimeoutError')), TAP_JOB_TIMEOUT_MS)
    const jobSignal = signal ? AbortSignal.any([signal, jobSignalController.signal]) : jobSignalController.signal
    let jobUrl, durableReceiptPath = resumeReceiptPath
    try {
      let receiptSha256
      if (resumeReceiptPath) {
        const receiptBytes = await readFile(resumeReceiptPath)
        const parsed = parseJobReceipt(receiptBytes, { queryName, maxrec, schemaVersion, query: adql, settings })
        jobUrl = parsed.jobUrl
        receiptSha256 = parsed.receiptSha256
        console.error(`Gaia TAP ${queryName} resuming existing job: ${jobUrl.href}`)
      } else {
        const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(maxrec), QUERY: adql, PHASE: 'RUN' })
        const submitted = await withTimeout(jobSignal, TAP_REQUEST_TIMEOUT_MS, requestSignal => fetcher(jobEndpoint, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: requestSignal, redirect: 'manual'
        }))
        const location = submitted.headers.get('location')
        if (submitted.status !== 303 || !location) {
          const detail = (await readTextPrefix(submitted)).replace(/\s+/g, ' ').trim()
          throw new Error(`Gaia TAP async job was not created: HTTP ${submitted.status}${detail ? ` (${detail.slice(-1200)})` : ''}`)
        }
        jobUrl = validatedTapJobUrl(new URL(location, jobEndpoint).href)
        if (receiptPath) {
          const receipt = { format: TAP_JOB_RECEIPT_FORMAT, service: 'ESA Gaia TAP', catalog: 'Gaia DR3', queryName, jobUrl: jobUrl.href,
            query: adql, querySha256: sha256(Buffer.from(adql, 'utf8')), maxrec, schemaVersion,
            settings: { raDeg: settings.raDeg, decDeg: settings.decDeg, radiusDeg: settings.radiusDeg, maxMagnitude: settings.maxMagnitude, maxRows: settings.maxRows },
            createdAt: new Date().toISOString() }
          const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2)+'\n')
          await writeFile(receiptPath, receiptBytes, { flag: 'wx' })
          durableReceiptPath = receiptPath
          receiptSha256 = sha256(receiptBytes)
        }
        console.error(`Gaia TAP ${queryName} async job: ${jobUrl.href}`)
        if (durableReceiptPath) console.error(`Gaia TAP ${queryName} job receipt: ${durableReceiptPath}`)
      }
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
      let cleanupPending = false
      try { await destroyTapJob(fetcher, jobUrl) }
      catch (error) {
        // The complete result is already downloaded. A failed best-effort
        // DELETE must not discard authoritative rows that can be persisted.
        cleanupPending = true
        console.error(`Gaia TAP ${queryName} result retrieved; remote cleanup pending for ${jobUrl.href}: ${error.message}`)
      }
      const completedJobUrl = jobUrl.href
      jobUrl = undefined
      return { bytes, retrievedAt: new Date().toISOString(), query: adql, url: String(resultUrl), jobUrl: completedJobUrl,
        cleanupPending,
        ...(receiptSha256 ? { jobReceiptSha256: receiptSha256 } : {}), ...(resumeReceiptPath ? { resumedFromReceipt: true } : {}) }
    } finally {
      clearTimeout(timeout)
      if (jobUrl) {
        if (durableReceiptPath) {
          console.error(`Gaia TAP ${queryName} polling stopped without deleting the job; receipt retained at ${durableReceiptPath}. Resume only if ESA still exposes this UWS job.`)
        } else {
          await destroyTapJob(fetcher, jobUrl).catch(error => console.error(error.message))
        }
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
  const options = args.filter(value => value !== '--verify-count'), known = ['--ra', '--dec', '--radius', '--max-mag', '--max-rows', '--output', '--schema', '--resume-job'], values = {}
  if (options.length < 12 || options.length % 2 !== 0) throw new Error('Required: --ra --dec --radius --max-mag --max-rows --output (new directory); optional --schema 1 or 2, --verify-count and --resume-job <receipt>')
  for (let i = 0; i < options.length; i += 2) { if (!known.includes(options[i]) || values[options[i]] !== undefined || !options[i+1]) throw new Error('Invalid or duplicate Gaia option'); values[options[i]] = options[i+1] }
  if (known.slice(0,6).some(name => values[name] === undefined)) throw new Error('Missing required Gaia option')
  const schemaVersion = Number(values['--schema'] ?? 1), columns = columnsForSchema(schemaVersion)
  const settings = { raDeg: Number(values['--ra']), decDeg: Number(values['--dec']), radiusDeg: Number(values['--radius']), maxMagnitude: Number(values['--max-mag']), maxRows: Number(values['--max-rows']) }
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop)
  try {
    const directory = values['--output'], jobReceiptPath = `${directory}.tap-job.json`
    try { await access(directory); throw new Error('Gaia output directory already exists; choose a new output directory') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const path of [jobReceiptPath, `${directory}.tap-job-count.json`]) {
      try { await access(path); throw new Error(`Gaia job receipt already exists: ${path}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const result = await retrieveGaiaCone(settings, { signal: controller.signal, schemaVersion, verifyCount,
      jobReceiptPath, resumeJobReceiptPath: values['--resume-job'] })
    if (result.rows.length > capacity.maxCatalogRows || result.chunks.length > capacity.maxChunks) throw new Error('Gaia catalog or chunk-count budget exceeded')
    for (const chunk of result.chunks) {
      const bytes = Buffer.byteLength(JSON.stringify(chunk)+'\n')
      if (bytes > capacity.maxChunkBytes || chunk.sources.length > capacity.maxChunkRows) throw new Error(`Gaia chunk ${chunk.key} exceeds its row or byte budget`)
    }
    await mkdir(directory) // Exclusive output; immutable previous receipts are never replaced.
    const sources = []
    for (const [name, value] of [...(result.countSource ? [['count', result.countSource]] : []), ['rows', result.rowSource]]) {
      const path = `${name}.csv`; await writeFile(join(directory, path), value.bytes, { flag: 'wx' })
      sources.push({ path, bytes: value.bytes.length, sha256: sha256(value.bytes), query: value.query, url: value.url, jobUrl: value.jobUrl,
        cleanupPending: value.cleanupPending,
        ...(value.jobReceiptSha256 ? { jobReceiptSha256: value.jobReceiptSha256 } : {}), ...(value.resumedFromReceipt ? { resumedFromReceipt: true } : {}), retrievedAt: value.retrievedAt })
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
    const manifestText = JSON.stringify(manifest, null, 2)+'\n'
    if (Buffer.byteLength(manifestText, 'utf8') > capacity.maxManifestBytes) throw new Error('Gaia manifest exceeds its byte budget')
    controller.signal.throwIfAborted(); await writeFile(join(directory, 'manifest.json'), manifestText, { flag: 'wx' })
    console.log(JSON.stringify({ directory, rows: result.rows.length, chunks: chunks.length, countVerified: Boolean(result.countSource), cleanupPending: sources.some(source => source.cleanupPending), rowCountEvidence: 'top-plus-one-sentinel' }))
  } finally { process.removeListener('SIGINT', stop) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
