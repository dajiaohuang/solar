import { createServer } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { planExplorerCatalog } = await server.ssrLoadModule('/src/lib/explorerCatalogSession.ts')
  const { planCatalogStream } = await server.ssrLoadModule('/src/lib/catalogStreaming.ts')
  const active = JSON.parse(await readFile('public/data/asteroids/dataset-version.json', 'utf8'))
  const manifestPath = `public/data/asteroids/${active.manifestPath}`
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.releasePath = `releases/${active.activeVersion}`
  const rows = []
  for (const mib of [256, 512, 1024]) {
    const plan = planExplorerCatalog(manifest, manifest.totalCount, mib * 1048576, '3d')
    const worker = planCatalogStream(manifest, plan.capacity, plan.workerBudget, '3d', true)
    rows.push({ scenePlanMiB: mib, capacity: plan.capacity, sceneExtraMiB: plan.capacity * 208 / 1048576,
      workerBudgetMiB: plan.workerBudget / 1048576, workerReservedMiB: worker.reservedBytes / 1048576,
      totalModelReservedMiB: (worker.reservedBytes + plan.capacity * 208) / 1048576 })
  }
  const receipt = { type: 'executed-current-source-admission-model-not-RSS-or-device-performance',
    manifestPath, count: manifest.totalCount, chunkSize: manifest.chunkSize, chunkCount: manifest.chunkCount, rows,
    fullSourceStorageMiB: { preparedFloat64Coefficients: manifest.totalCount * 80 / 1048576,
      mainDoubleXYZSnapshots: manifest.totalCount * 48 / 1048576,
      lazyDoubleXY: manifest.totalCount * 16 / 1048576,
      twoFloat32XYZVisualSnapshots: manifest.totalCount * 24 / 1048576 },
    sourceHashes: {} }
  for (const path of ['src/lib/catalogStreaming.ts', 'src/lib/explorerCatalogSession.ts', 'src/hooks/useExplorerCatalog.ts']) {
    receipt.sourceHashes[path] = createHash('sha256').update((await readFile(path, 'utf8')).replace(/\r\n/g, '\n')).digest('hex')
  }
  await mkdir('.cache', { recursive: true })
  await writeFile('.cache/capacity-audit-20261003.json', JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt, null, 2))
} finally { await server.close() }
