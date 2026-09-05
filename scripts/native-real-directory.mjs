import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const realDirectoryPrefix = '/source-directory-real/'
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

// Optional local data input, never a synthetic replacement or a download.
export async function pinnedNativeInventory(directory, sha256) {
  if (!directory && !sha256) return null
  requireValue(directory && /^[a-f0-9]{64}$/.test(sha256 ?? ''), 'Real directory requires an explicit inventory path and SHA-256')
  const file = join(resolve(directory), 'manifest.json')
  requireValue((await stat(file)).size <= 8 * 1024 * 1024, 'Inventory manifest exceeds budget')
  const bytes = await readFile(file)
  requireValue(createHash('sha256').update(bytes).digest('hex') === sha256, 'Inventory SHA-256 mismatch')
  const manifest = JSON.parse(bytes)
  requireValue(Number.isSafeInteger(manifest.totalRecords) && manifest.totalRecords >= 50, 'Real directory must have at least 50 source records')
  return { directory: resolve(directory), sha256, totalRecords: manifest.totalRecords }
}

async function json(address, path, body) {
  const response = await fetch(address + path, { signal: AbortSignal.timeout(30_000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  requireValue(response.ok, `Real directory preflight failed: ${response.status}`)
  const reader = response.body.getReader(), chunks = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      length += value.length; requireValue(length <= 256 * 1024, 'Real directory response exceeds budget'); chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks))
  } finally { await reader.cancel() }
}

export async function realDirectoryScenario(address, inventory) {
  const manifest = await json(address, '/v1/catalog/manifest')
  const page = await json(address, '/v1/identities?q=&limit=50')
  requireValue(manifest.inventoryManifestSha256 === inventory.sha256 && page.inventoryManifestSha256 === inventory.sha256,
    'Real source page must match the pinned inventory')
  requireValue(page.totalRecords === inventory.totalRecords && page.sourceRecords === true && page.identityAssertions === true
    && page.uniqueBodySemantics === 'not-deduplicated' && page.items?.length === 50 && page.limit === 50,
  'Real source page semantics or counts differ')
  const sourceIds = page.items.map(row => row.id)
  requireValue(new Set(sourceIds).size === 50 && sourceIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\s,]/.test(id)), 'Source IDs cannot be safely selected')
  const reference = 'naif:10', epochJd = 2461287.5
  const ids = sourceIds.includes(reference) ? sourceIds : [...sourceIds, reference]
  const plan = await json(address, '/v1/state/plan', { ids, epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', fieldMask: ['position', 'velocity'], tileSize: 16384 })
  requireValue(plan.inventoryManifestSha256 === inventory.sha256 && plan.catalogManifestSha256 === manifest.catalogManifestSha256
    && plan.bodyCount === ids.length && plan.tileCount === 1 && plan.approximateCount === 0
    && Number.isSafeInteger(plan.exactCount) && plan.exactCount > 0 && Number.isSafeInteger(plan.missingCount) && plan.missingCount > 0
    && plan.exactCount + plan.missingCount === ids.length, 'Real directory must exercise both verified states and explicit gaps')
  return { scope: 'real pinned source page and Go state plan; not independent astronomical accuracy or full-inventory state coverage',
    sourceIds, ids, reference, epochJd, totalRecords: page.totalRecords, inventoryHash: inventory.sha256,
    catalogHash: manifest.catalogManifestSha256, exactCount: plan.exactCount, missingCount: plan.missingCount, planId: plan.planId }
}

export function verifyRealDirectoryTraffic(traffic, scenario) {
  const rows = traffic.filter(row => row.path?.startsWith(realDirectoryPrefix))
  if (!scenario) { requireValue(rows.length === 0, 'Unexpected real-directory traffic'); return { status: 'not-configured' } }
  const expected = [['GET', 'v1/catalog/manifest'], ['GET', 'v1/identities?q=&limit=50'],
    ['GET', 'v1/catalog/manifest'], ['POST', 'v1/state/plan'], ['POST', 'v1/state/tiles']]
  requireValue(rows.length === expected.length && rows.every((row, i) => row.method === expected[i][0]
    && row.path === realDirectoryPrefix + expected[i][1] && row.status === 200 && row.bytes > 0), 'Real directory UI traffic does not prove selection then state loading')
  const request = JSON.parse(rows[3].requestBody)
  requireValue(JSON.stringify(request.ids) === JSON.stringify(scenario.ids) && request.epochJd === scenario.epochJd
    && request.precision === 'exact' && request.timeScale === 'TDB' && request.frame === 'ECLIPJ2000', 'Native selection changed real source IDs or scientific request')
  return { status: 'passed', requests: rows.length, selectedSourceRecords: scenario.sourceIds.length,
    requestedRecordsWithReference: scenario.ids.length, exactCount: scenario.exactCount, missingCount: scenario.missingCount }
}
