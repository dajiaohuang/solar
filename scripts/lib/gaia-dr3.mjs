import { createHash } from 'node:crypto'

export const endpoint = 'https://gea.esac.esa.int/tap-server/tap/sync'
import columns from '../../src/data/gaiaColumns.json' with { type: 'json' }
export { columns }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function queries({ raDeg, decDeg, radiusDeg, maxMagnitude, maxRows }) {
  if (![raDeg, decDeg, radiusDeg, maxMagnitude].every(Number.isFinite) || raDeg < 0 || raDeg >= 360 || Math.abs(decDeg) > 90 || radiusDeg <= 0 || radiusDeg > 2 || maxMagnitude < 3 || maxMagnitude > 20 || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw new Error('Invalid bounded Gaia cone settings')
  const predicate = `CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${raDeg},${decDeg},${radiusDeg}))=1 AND phot_g_mean_mag<=${maxMagnitude}`
  return { count: `SELECT COUNT(*) AS selected_count FROM gaiadr3.gaia_source WHERE ${predicate}`,
    rows: `SELECT TOP ${maxRows+1} ${columns.join(',')} FROM gaiadr3.gaia_source WHERE ${predicate} ORDER BY source_id` }
}
function csv(bytes, header) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.trimEnd().split(/\r?\n/)
  if (lines.shift() !== header.join(',')) throw new Error('Unexpected Gaia CSV columns')
  return lines.map(line => { const cells = line.split(','); if (cells.length !== header.length) throw new Error('Malformed Gaia CSV row'); return cells })
}
export function parseCount(bytes, maxRows) {
  const rows = csv(bytes, ['selected_count'])
  if (rows.length !== 1 || !/^\d+$/.test(rows[0][0])) throw new Error('Invalid Gaia count response')
  const count = Number(rows[0][0]); if (!Number.isSafeInteger(count) || count > maxRows) throw new Error('Gaia cone exceeds row budget; narrow the cone or magnitude limit')
  return count
}
export function parseSources(bytes, settings, count) {
  queries(settings)
  const rows = csv(bytes, columns)
  if (rows.length !== count || rows.length > settings.maxRows) throw new Error('Gaia count mismatch or truncated response')
  let last = -1n
  return rows.map(cells => {
    const id = cells[0]
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n || BigInt(id) <= last) throw new Error('Gaia source IDs must be unique ordered 64-bit strings')
    last = BigInt(id)
    const row = { source_id: id }
    for (let i = 1; i < columns.length; i++) {
      const name = columns[i], cell = cells[i]
      if (cell === '') { row[name] = null; continue }
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell) || !Number.isFinite(Number(cell))) throw new Error(`Invalid Gaia ${name}`)
      row[name] = Number(cell)
      if (name.endsWith('_error') && row[name] < 0 || name.endsWith('_corr') && Math.abs(row[name]) > 1) throw new Error(`Invalid Gaia uncertainty ${name}`)
    }
    if (row.ref_epoch !== 2016 || row.ra === null || row.ra < 0 || row.ra >= 360 || row.dec === null || Math.abs(row.dec) > 90 || row.phot_g_mean_mag === null || row.phot_g_mean_mag > settings.maxMagnitude || ![3,31,95].includes(row.astrometric_params_solved)) throw new Error('Gaia frame, epoch, position or selection mismatch')
    const rad = Math.PI/180, dra = (row.ra-settings.raDeg)*rad, dec = row.dec*rad, center = settings.decDeg*rad
    const hav = Math.sin((dec-center)/2)**2+Math.cos(dec)*Math.cos(center)*Math.sin(dra/2)**2
    if (2*Math.asin(Math.sqrt(Math.min(1, Math.max(0, hav))))/rad > settings.radiusDeg+1e-9) throw new Error('Gaia row outside requested cone')
    return row
  })
}
/** Partition by the returned ICRS coordinates, not source_id's assignment-era pixel. */
export function spatialChunks(rows) {
  const chunks = new Map()
  for (const row of rows) {
    const raBin = Math.floor(row.ra/5), decBin = Math.min(35, Math.floor((row.dec+90)/5)), key = `r${raBin}-d${decBin}`
    if (!chunks.has(key)) chunks.set(key, { key, raRangeDeg: [raBin*5, (raBin+1)*5], decRangeDeg: [decBin*5-90, (decBin+1)*5-90], sources: [] })
    chunks.get(key).sources.push(row)
  }
  return [...chunks.values()].sort((a,b) => a.key.localeCompare(b.key))
}
