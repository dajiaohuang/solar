// Pin independent Horizons observer tables. Requests are deliberately serial,
// in accordance with https://ssd-api.jpl.nasa.gov/doc/index.php.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const cases = [
  { name: 'moon-singapore', command: '301', site: '103.851959,1.290270,0', start: '2026-09-23 00:00', stop: '2026-09-23 00:01' },
  { name: 'venus-greenwich', command: '299', site: '0,51.477811,0.046', start: '2026-09-23 12:00', stop: '2026-09-23 12:01' },
  { name: 'sun-singapore', command: '10', site: '103.851959,1.290270,0', start: '2026-09-23 04:00', stop: '2026-09-23 04:01' },
]
for (const item of cases) {
  const path = fileURLToPath(new URL(`../tests/fixtures/observer-${item.name}.json`, import.meta.url))
  try { await readFile(path); console.log(`Retained ${item.name}`); continue } catch (error) { if (error.code !== 'ENOENT') throw error }
  const params = { format: 'json', COMMAND: `'${item.command}'`, EPHEM_TYPE: "'OBSERVER'", CENTER: "'coord@399'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${item.site}'`, START_TIME: `'${item.start}'`, STOP_TIME: `'${item.stop}'`, STEP_SIZE: "'1m'", QUANTITIES: "'4,20,21,49'", APPARENT: "'AIRLESS'", CSV_FORMAT: "'YES'", EXTRA_PREC: "'YES'", TIME_DIGITS: "'FRACSEC'", CAL_FORMAT: "'BOTH'", OBJ_DATA: "'NO'" }
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${new URLSearchParams(params)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Horizons HTTP ${response.status}`)
  const raw = await response.text()
  const body = JSON.parse(raw)
  if (body.error || !body.result?.includes('$$SOE')) throw new Error(body.error ?? 'Missing observer table')
  const fixture = { schemaVersion: 1, retrievedAt: new Date().toISOString(), url, params, responseSha256: createHash('sha256').update(raw).digest('hex'), rawResponse: raw }
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' })
  console.log(`${item.name}: ${fixture.responseSha256}`)
}
