import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { columnsForSchema, endpoint, parseCount, parseSources, queries, sha256, spatialChunks } from './lib/gaia-dr3.mjs'

export async function retrieveGaiaCone(settings, { fetcher = fetch, signal, schemaVersion = 1 } = {}) {
  const query = queries(settings, schemaVersion)
  const receive = async (adql, maxrec) => {
    const url = new URL(endpoint); url.search = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(maxrec), QUERY: adql })
    const deadline = AbortSignal.timeout(45000), combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    const response = await fetcher(url, { signal: combined, redirect: 'error' })
    if (!response.ok || !/^text\/csv(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error(`Gaia TAP rejected CSV query: HTTP ${response.status}`)
    const reader = response.body.getReader(), parts = []; let length = 0
    try {
      for (;;) {
        combined.throwIfAborted(); const { value, done } = await reader.read(); combined.throwIfAborted(); if (done) break
        length += value.byteLength; if (length > 8*1024*1024) throw new Error('Gaia TAP response exceeds 8 MiB budget')
        parts.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    return { bytes: Buffer.concat(parts), retrievedAt: new Date().toISOString(), query: adql, url: String(url) }
  }
  // Sequential source queries avoid unbounded TAP concurrency; count preflight
  // also detects truncated CSV results, which have no VOTable OVERFLOW marker.
  const countSource = await receive(query.count, 1), count = parseCount(countSource.bytes, settings.maxRows)
  const rowSource = await receive(query.rows, settings.maxRows+1)
  const rows = parseSources(rowSource.bytes, settings, count, schemaVersion); signal?.throwIfAborted()
  return { countSource, rowSource, rows, chunks: spatialChunks(rows) }
}
async function main() {
  const args = process.argv.slice(2), known = ['--ra', '--dec', '--radius', '--max-mag', '--max-rows', '--output', '--schema'], values = {}
  if (args.length !== 12 && args.length !== 14) throw new Error('Required: --ra --dec --radius --max-mag --max-rows --output (new directory); optional --schema 1 or 2')
  for (let i = 0; i < args.length; i += 2) { if (!known.includes(args[i]) || values[args[i]] !== undefined || !args[i+1]) throw new Error('Invalid or duplicate Gaia option'); values[args[i]] = args[i+1] }
  if (known.slice(0,6).some(name => values[name] === undefined)) throw new Error('Missing required Gaia option')
  const schemaVersion = Number(values['--schema'] ?? 1), columns = columnsForSchema(schemaVersion)
  const settings = { raDeg: Number(values['--ra']), decDeg: Number(values['--dec']), radiusDeg: Number(values['--radius']), maxMagnitude: Number(values['--max-mag']), maxRows: Number(values['--max-rows']) }
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop)
  try {
    const result = await retrieveGaiaCone(settings, { signal: controller.signal, schemaVersion }), directory = values['--output']
    await mkdir(directory) // Exclusive output; immutable previous receipts are never replaced.
    const sources = []
    for (const [name, value] of [['count', result.countSource], ['rows', result.rowSource]]) {
      const path = `${name}.csv`; await writeFile(join(directory, path), value.bytes, { flag: 'wx' })
      sources.push({ path, bytes: value.bytes.length, sha256: sha256(value.bytes), query: value.query, url: value.url, retrievedAt: value.retrievedAt })
    }
    const chunks = []
    for (const chunk of result.chunks) {
      const path = `${chunk.key}.json`, bytes = Buffer.from(JSON.stringify(chunk)+'\n')
      await writeFile(join(directory, path), bytes, { flag: 'wx' }); chunks.push({ path, sha256: sha256(bytes), bytes: bytes.length, rows: chunk.sources.length, raRangeDeg: chunk.raRangeDeg, decRangeDeg: chunk.decRangeDeg })
    }
    const implementation = { node: process.version, generatorSha256: sha256(await readFile(new URL(import.meta.url))), parserSha256: sha256(await readFile(new URL('./lib/gaia-dr3.mjs', import.meta.url))), columnsSha256: sha256(await readFile(new URL(schemaVersion === 2 ? '../src/data/gaiaColumnsV2.json' : '../src/data/gaiaColumns.json', import.meta.url))) }
    const manifest = { schemaVersion, catalog: 'Gaia DR3', table: 'gaiadr3.gaia_source', frame: 'ICRS', referenceEpochJulianYear: 2016, referenceEpochTimeScale: 'TCB', implementation, settings, columns, rows: result.rows.length, queryCountMatched: true, catalogCompletenessCertified: false,
      units: { ra: 'degree', dec: 'degree', ra_error: 'mas; alpha*cos(delta)', dec_error: 'mas', parallax: 'mas', pmra: 'mas/Julian year; mu_alpha*cos(delta)', pmdec: 'mas/Julian year', radial_velocity: 'km/s', ...(schemaVersion === 2 ? { pseudocolour:'inverse-micrometre', pseudocolour_error:'inverse-micrometre' } : {}) },
      limitations: ['A magnitude-limited cone is not full-sky data or a completeness guarantee.', 'Missing fields remain null. Negative parallax is retained; no inverse-parallax distances are inferred.', 'No proper-motion propagation, observer parallax, aberration, deflection, zero-point correction or occultation uncertainty model is applied.', 'Spatial bins describe returned coordinates at J2016.0, not bounds at arbitrary epochs.'],
      documentation: ['https://www.cosmos.esa.int/web/gaia/dr3', 'https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access', 'https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html'], sources, chunks }
    controller.signal.throwIfAborted(); await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n', { flag: 'wx' })
    console.log(JSON.stringify({ directory, rows: result.rows.length, chunks: chunks.length, queryCountMatched: true }))
  } finally { process.removeListener('SIGINT', stop) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
