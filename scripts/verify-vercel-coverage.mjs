import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyApproximationAssets } from './lib/verify-approximation-assets.mjs'
import { evaluateApproximation, segmentAt } from '../src/engine/ephemeris/segmentedApproximation.ts'
import { propagateTwoBody } from '../src/engine/ephemeris/twoBodyForecast.ts'

const root = process.argv[2] ?? 'public/data/approximation'
const { manifest } = await verifyApproximationAssets(root)
const audit = JSON.parse(await readFile('docs/benchmarks/non-small-coverage-20261012/report.json', 'utf8'))
const policy = manifest.forecastPolicy
if (!policy || policy.requestedStartEt !== -43200 || policy.requestedEndEt !== 1609416000) throw new Error('Missing unified forecast policy')
const byId = new Map(manifest.bodies.map(body => [body.id, body]))
const documents = new Map(), rows = []
async function localState(body, et) {
  const chunk = body.chunks.findLast(chunk => chunk.startEt <= et && et <= chunk.endEt)
  if (chunk) {
    if (!documents.has(chunk.path)) documents.set(chunk.path, JSON.parse(await readFile(join(root, chunk.path), 'utf8')))
    const segment = segmentAt(documents.get(chunk.path).segments, et)
    if (!segment) throw new Error(`Descriptor without coefficients: ${body.id}`)
    return evaluateApproximation(segment, et)
  }
  const forecast = body.forecasts?.find(window => window.startEt <= et && et <= window.endEt)
  return forecast ? propagateTwoBody(forecast.seed, forecast.gmKm3S2, et - forecast.seedEt) : null
}
async function absoluteState(id, et, seen = new Set()) {
  if (seen.has(id)) throw new Error('Cyclic body centers')
  seen.add(id)
  const body = byId.get(id)
  if (!body) throw new Error(`Missing identity: ${id}`)
  if (body.origin) return { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
  const local = await localState(body, et), parent = await absoluteState(body.parentId, et, seen)
  if (!local || !parent) return null
  return Object.fromEntries(['position', 'velocity'].map(key => [key, Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, local[key][axis] + parent[key][axis]]))]))
}
for (const reviewed of audit.rows) {
  const body = byId.get(reviewed.id)
  if (!body) throw new Error(`Audited object omitted: ${reviewed.id}`)
  const intervals = [...body.chunks, ...(body.forecasts ?? [])].sort((a, b) => a.startEt - b.startEt)
  let cursor = policy.requestedStartEt
  if (body.origin) cursor = policy.requestedEndEt
  for (const interval of intervals) {
    if (interval.endEt < cursor) continue
    if (interval.startEt > cursor) break
    cursor = Math.max(cursor, interval.endEt)
  }
  const complete = cursor >= policy.requestedEndEt
  const exception = policy.unavailable.find(row => row.id === body.id)
  if (!complete && !exception) throw new Error(`Unexplained coverage gap: ${body.id}`)
  let sampled = 0
  if (complete) {
    const epochs = new Set([policy.requestedStartEt, policy.requestedEndEt, (policy.requestedStartEt + policy.requestedEndEt) / 2])
    for (const forecast of body.forecasts ?? []) {
      if (!forecast.sourceHashes?.length || !forecast.sourceUrls?.length || !forecast.parameterSource || forecast.uncertainty !== 'unknown-outside-source-coverage') throw new Error(`Forecast provenance missing: ${body.id}`)
      if (body.chunks.some(chunk => forecast.startEt < chunk.endEt && forecast.endEt > chunk.startEt)) throw new Error(`Forecast displaces source: ${body.id}`)
      for (let index = 0; index <= 24; index++) epochs.add(forecast.startEt + index / 24 * (forecast.endEt - forecast.startEt))
      if (forecast.anchorSource === 'source-fit') {
        const anchor = await localState(body, forecast.seedEt)
        if (!anchor || ['position', 'velocity'].some(key => ['x', 'y', 'z'].some(axis => anchor[key][axis] !== forecast.seed[key][axis]))) throw new Error(`Forecast anchor differs from source: ${body.id}`)
      }
    }
    for (const et of epochs) {
      const state = await absoluteState(body.id, et)
      if (!state || ['position', 'velocity'].some(key => Object.values(state[key]).some(value => !Number.isFinite(value)))) throw new Error(`Composed state unavailable: ${body.id}, ${et}`)
      sampled++
    }
  }
  rows.push({ id: body.id, complete, sourceChunks: body.chunks.length, forecastWindows: body.forecasts?.length ?? 0, sampled, exception: exception?.reason ?? null })
  documents.clear()
}
const report = { requestedStartEt: policy.requestedStartEt, requestedEndEt: policy.requestedEndEt,
  audited: rows.length, complete: rows.filter(row => row.complete).length, forecastBodies: rows.filter(row => row.forecastWindows).length,
  sampled: rows.reduce((sum, row) => sum + row.sampled, 0), unavailable: rows.filter(row => !row.complete),
  boundary: 'Finite composed model states and explicit coverage verified; prediction error outside source intervals remains unknown.', rows }
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2))
