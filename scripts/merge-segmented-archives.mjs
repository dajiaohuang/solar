import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { verifyApproximationAssets } from './lib/verify-approximation-assets.mjs'
import { createServer } from 'vite'

const [destination, ...roots] = process.argv.slice(2).map(path => resolve(path))
if (!destination || roots.length < 2) throw new Error('Use DESTINATION SOURCE_ARCHIVE SOURCE_ARCHIVE [...]')
const verified = []
for (const root of roots) verified.push({ root, ...(await verifyApproximationAssets(root)) })
const identity = manifest => JSON.stringify(['schemaVersion', 'model', 'frame', 'timeScale', 'positionUnit', 'velocityUnit',
  'sourceManifestSha256', 'sourceManifestPath', 'positionToleranceKm', 'velocityToleranceKmS', 'validation', 'boundaryConvention', 'candidates'].map(key => manifest[key]))
if (verified.some(archive => identity(archive.manifest) !== identity(verified[0].manifest))) throw new Error('Archive source/configuration differs')
const bodies = new Map()
for (const archive of verified) for (const body of archive.manifest.bodies) {
  if (bodies.has(body.id)) throw new Error(`Duplicate shard identity: ${body.id}`)
  bodies.set(body.id, { body, root: archive.root })
}
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
let ids
try {
  const { majorBodies } = await server.ssrLoadModule('/src/data/majorBodies.ts')
  const { SCIENTIFIC_SPACECRAFT } = await server.ssrLoadModule('/src/data/scientificSpacecraft.ts')
  ids = [...majorBodies, ...SCIENTIFIC_SPACECRAFT].map(body => body.id)
} finally { await server.close() }
if (ids.length !== bodies.size || ids.some(id => !bodies.has(id))) throw new Error('Shards do not cover the complete current registry')
await mkdir(join(destination, 'chunks'), { recursive: true })
for (const { body, root } of bodies.values()) for (const chunk of body.chunks) {
  if (root !== destination) await copyFile(join(root, chunk.path), join(destination, chunk.path))
}
const manifest = { ...verified[0].manifest, bodies: ids.map(id => bodies.get(id).body),
  totalBytes: verified.reduce((sum, archive) => sum + archive.manifest.totalBytes, 0) }
delete manifest.reusedVerifiedPrefixBefore
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2))
await verifyApproximationAssets(destination)
console.log(`Merged and verified ${manifest.bodies.length} identities`)
