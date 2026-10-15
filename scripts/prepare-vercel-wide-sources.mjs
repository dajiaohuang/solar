import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, relative } from 'node:path'
import { openSource, cropSpk } from './crop-spk.mjs'
import { MESSENGER_FINAL_ORBIT } from './lib/spacecraft-source-sets.mjs'
import { createServer } from 'vite'

const root = resolve('.cache/vercel-wide-sources')
await mkdir(join(root, 'files'), { recursive: true })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = await readFile('src/data/ephemeris-manifest-full.json')
const manifest = JSON.parse(baseline)
const audit = JSON.parse(await readFile('docs/benchmarks/non-small-coverage-20261012/report.json', 'utf8'))
if (audit.sourceManifestSha256 !== digest(baseline)) throw new Error('Source audit baseline differs')
try {
  const pinned = JSON.parse(await readFile('src/data/ephemeris-manifest-vercel-wide.json', 'utf8'))
  if (pinned.baselineManifestSha256 !== digest(baseline)) throw new Error('Wide source baseline changed')
  for (const file of pinned.files) {
    const bytes = await readFile(file.localPath)
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Pinned source bytes changed: ${file.id}`)
  }
  console.log(`Verified ${pinned.files.length} cached pinned source files; no source download needed`)
  process.exit(0)
} catch (error) { if (error.code !== 'ENOENT') throw error }
const from = -43200, to = 1609416000
const groups = new Map()
const registryServer = await createServer({ configFile: false, cacheDir: '.cache/segmented-generator-vite',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
let parents
try {
  const { majorBodies } = await registryServer.ssrLoadModule('/src/data/majorBodies.ts')
  const { bodyNaifId } = await registryServer.ssrLoadModule('/src/data/ephemerisTargets.ts')
  parents = new Map(majorBodies.map(body => [body.id, bodyNaifId(body)]))
} finally { await registryServer.close() }
const evidenceRoot = process.env.SOLAR_ATLAS_SOURCE_EVIDENCE_DIR ?? '.cache/non-small-coverage-20261012-b'
for (const body of audit.rows) {
  if (!body.currentGaps.length || body.target === null || body.target === -236) continue
  const full = body.candidates.filter(candidate => candidate.status === 'full-window-supported-descriptors')
  const candidates = full.length ? full : body.candidates
  const selected = candidates.find(candidate => body.pinnedRoots.some(root => root.source === candidate.url)) ?? candidates[0]
  if (!selected) continue
  if (!groups.has(selected.sourceId)) groups.set(selected.sourceId, { id: selected.sourceId, url: selected.url, targets: new Set() })
  const group = groups.get(selected.sourceId)
  group.targets.add(body.target)
  const sourceSurvey = JSON.parse(await readFile(join(evidenceRoot, `sources/${group.id}/survey.json`), 'utf8'))
  const parent = parents.get(body.parentId)
  if (parent !== 10 && Number.isSafeInteger(parent) && sourceSurvey.targets.includes(parent)) group.targets.add(parent)
}
const files = manifest.files.map(file => ({ ...file, localPath: `public/data/ephemerides/${file.path}` }))
const sources = []
const initialCore = manifest.files.find(file => file.core && file.targets.includes(10))
async function prepare(group, localSource, minimumEt = from, maximumEt = to) {
  const survey = JSON.parse(await readFile(join(evidenceRoot, `sources/${group.id}/survey.json`), 'utf8'))
  const source = await openSource(localSource ?? group.url)
  try {
    if (!localSource && (source.identity.bytes !== survey.source.bytes || source.identity.lastModified !== survey.source.lastModified)) throw new Error('Source identity changed since audit')
    const originalRead = source.read.bind(source), metadata = new Map(), bulk = new Map()
    source.read = async (start, length) => {
      const key = `${start}:${length}`
      if (bulk.has(key)) return bulk.get(key)
      if (metadata.has(key)) return metadata.get(key)
      const bytes = await originalRead(start, length)
      if (length <= 1024) metadata.set(key, bytes)
      return bytes
    }
    const wanted = new Set(group.targets)
    // Preserve the original center chain and embedded Sun whenever present.
    if (survey.targets.includes(10)) wanted.add(10)
    for (const target of wanted) for (const segment of survey.segments.filter(segment => segment.target === target)) {
      if (segment.center !== 0 && survey.targets.includes(segment.center)) wanted.add(segment.center)
    }
    const dependencyTargets = [...wanted].filter(target => !group.targets.has(target))
    const spans = survey.segments.filter(segment => group.targets.has(segment.target))
    const start = Math.max(minimumEt, Math.min(...spans.map(segment => segment.startEt)))
    const end = Math.min(maximumEt, Math.max(...spans.map(segment => segment.endEt)))
    const prepared = []
    const parallel = async requests => {
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => {
        while (next < requests.length) await requests[next++]()
      }))
    }
    const header = await source.read(0, 1024)
    const little = header.toString('ascii', 88, 96) === 'LTL-IEEE'
    const double = (bytes, offset) => little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset)
    const chebyshev = survey.segments.filter(segment => wanted.has(segment.target) && [2, 3].includes(segment.type))
    await parallel(chebyshev.map(segment => () => source.read((segment.endAddress - 4) * 8, 32)))
    for (let a = start, index = 0; a < end; index++) {
      const b = Math.min(end, a + 5 * 366 * 86400)
      // Fetch independent original records concurrently, bounded at 64 MiB.
      // Cropping itself still uses the established validator and exact bytes.
      const ranges = new Map()
      for (const segment of chebyshev.filter(segment => segment.startEt <= b && segment.endEt >= a)) {
        const directory = await source.read((segment.endAddress - 4) * 8, 32)
        const init = double(directory, 0), interval = double(directory, 8), stride = double(directory, 16), count = double(directory, 24)
        if (!(interval > 0) || !Number.isSafeInteger(stride) || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid source directory')
        const first = Math.max(0, Math.min(count - 1, Math.floor((Math.max(a, segment.startEt) - init) / interval)))
        const last = Math.max(first, Math.min(count - 1, Math.floor((Math.min(b, segment.endEt) - init) / interval)))
        const offset = (segment.startAddress - 1 + first * stride) * 8, length = (last - first + 1) * stride * 8
        ranges.set(`${offset}:${length}`, { offset, length })
      }
      const checkpointPaths = [['dependencies', dependencyTargets], ['targets', [...group.targets]]]
        .filter(([, targets]) => targets.length).flatMap(([role]) => [`files/wide-${group.id}-${index}-${role}.bsp`, `files/wide-${group.id}-${index}-${role}.bsp.json`])
      const completed = (await Promise.all(checkpointPaths.map(path => access(join(root, path)).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error
        return false
      })))).every(Boolean)
      if (!completed && [...ranges.values()].reduce((sum, range) => sum + range.length, 0) <= 64 * 1048576) {
        await parallel([...ranges.entries()].map(([key, range]) => async () => { bulk.set(key, await originalRead(range.offset, range.length)) }))
      }
      const dependencyId = `wide-${group.id}-${index}-dependencies`
      for (const [role, targets] of [['dependencies', dependencyTargets], ['targets', [...group.targets]]]) {
        if (!targets.length) continue
        const id = `wide-${group.id}-${index}-${role}`, path = `files/${id}.bsp`
        let result, receipt
        try {
          receipt = JSON.parse(await readFile(join(root, `${path}.json`), 'utf8'))
          const bytes = await readFile(join(root, path))
          if (receipt.sha256 !== digest(bytes) || receipt.bytes !== bytes.length || receipt.source.source !== source.identity.source
            || receipt.startEt !== a || receipt.endEt !== b) throw new Error('Invalid prepared checkpoint')
          result = { ...receipt, buffer: bytes }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          result = await cropSpk(source, { startEt: a, endEt: b, targets })
          receipt = { source: result.source, sha256: result.sha256, bytes: result.buffer.length, startEt: a, endEt: b,
            segments: result.segments }
          await writeFile(join(root, path), result.buffer)
          await writeFile(join(root, `${path}.json`), JSON.stringify(receipt, null, 2))
        }
        const ranges = result.segments.map(segment => [segment.startEt, segment.endEt])
        const file = { id, path, localPath: `${relative(resolve('.'), root).replaceAll('\\', '/')}/${path}`,
          bytes: result.buffer.length, sha256: result.sha256, targets: [...new Set(result.segments.map(segment => segment.target))],
          startEt: Math.min(...ranges.map(range => range[0])), endEt: Math.max(...ranges.map(range => range[1])),
          source: group.url, sourceIdentity: result.source, dependencyOnly: role === 'dependencies', core: false,
          ...(role === 'targets' ? { solutionKernelIds: [initialCore.id, ...(dependencyTargets.length ? [dependencyId] : [])] } : {}),
          sourceNature: group.targets.has(-31) || group.targets.has(-32) ? 'published-trajectory-extension' : 'upstream-SPK-solution' }
        files.push(file); prepared.push(file.id)
      }
      console.log(`${group.url.split('/').at(-1)}: ${a}..${b}`)
      bulk.clear()
      a = b
    }
    sources.push({ url: group.url, source: source.identity, targets: [...group.targets], prepared })
  } finally { await source.close() }
}
for (const group of groups.values()) await prepare(group)
const messenger = audit.inspectedSources.find(source => source.url === MESSENGER_FINAL_ORBIT.sourceUrl)
await prepare({ id: messenger.id, url: messenger.url, targets: new Set([-236]) },
  '.cache/spacecraft-packs/messenger-final-impact-20260929-r1/originals/msgr_040803_150430_150430_od431sc_2.bsp',
  MESSENGER_FINAL_ORBIT.coverageStartEt, MESSENGER_FINAL_ORBIT.coverageEndEt)
// A moon's physical parent offset can be in a separate kernel of the same
// admitted planetary system. Add its prepared roots and their own dependency
// closure explicitly, rather than silently substituting a system barycenter.
const bodyParentTargets = new Map(audit.rows.filter(body => body.kind === 'moon').map(body => [body.target, parents.get(body.parentId)]))
const addedRoots = files.filter(file => file.id.startsWith('wide-') && !file.dependencyOnly)
for (const file of addedRoots) {
  const needed = new Set(file.targets.map(target => bodyParentTargets.get(target)).filter(target => Number.isSafeInteger(target) && !file.targets.includes(target)))
  const peerIds = addedRoots.filter(peer => peer.id !== file.id && peer.targets.some(target => needed.has(target))
    && peer.startEt <= file.endEt && peer.endEt >= file.startEt).map(peer => peer.id)
  file.solutionKernelIds = [...new Set([...file.solutionKernelIds, ...peerIds])]
}
const filesById = new Map(files.map(file => [file.id, file]))
for (const file of addedRoots) {
    const closure = new Set(file.solutionKernelIds)
  for (const id of closure) for (const dependency of filesById.get(id)?.solutionKernelIds ?? []) {
    if (dependency === file.id) throw new Error('Prepared source center pool contains a cycle')
    closure.add(dependency)
  }
  file.solutionKernelIds = [...closure].sort()
}
const result = { ...manifest, id: 'vercel-wide-sources-2000-2051', baselineManifestSha256: digest(baseline), sources,
  contract: 'Original-record crops with explicit source-local center dependencies. Numerical fit/reference validation required before delivery.', files }
await writeFile(join(root, 'source-manifest.json'), JSON.stringify(result, null, 2))
// Pin metadata as well as the cropped bytes. Existing published receipts must
// be reproduced exactly, never silently replaced by an upstream update.
const pinnedPath = 'src/data/ephemeris-manifest-vercel-wide.json'
const serialized = JSON.stringify(result, null, 2)
try {
  const pinned = await readFile(pinnedPath, 'utf8')
  if (pinned !== serialized) throw new Error('Prepared source manifest differs from the pinned wide profile; review source changes before updating it')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  await writeFile(pinnedPath, serialized)
}
console.log(`Prepared ${sources.length} source groups, ${files.length - manifest.files.length} new source/dependency files`)
