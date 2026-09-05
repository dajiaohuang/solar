import { createHash } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { copyFile, link, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Produce a standalone immutable backend data directory. The manifest is
 * published last, so Catalog.Load cannot mistake an interrupted staging run
 * for a complete profile. Existing output directories are never overwritten. */
export async function stageBackendProfile({ root, output, profile = 'full' }) {
  if (!['full', 'pages'].includes(profile)) throw new Error('Profile must be full or pages')
  const manifestPath = join(root, 'src/data', `ephemeris-manifest${profile === 'full' ? '-full' : ''}.json`)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes)
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Profile has no kernel files')
  const names = new Set()
  let totalBytes = 0
  for (const file of manifest.files) {
    if (!/^[\w.-]+\.bsp$/.test(file.path) || names.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error('Invalid kernel manifest entry')
    names.add(file.path)
    const path = join(root, 'public/data/ephemerides', file.path)
    if ((await stat(path)).size !== file.bytes) throw new Error(`Kernel byte count mismatch: ${file.path}`)
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(path)) hash.update(bytes)
    if (hash.digest('hex') !== file.sha256) throw new Error(`Kernel checksum mismatch: ${file.path}`)
    totalBytes += file.bytes
  }
  await mkdir(output)
  let linkedFiles = 0
  for (const file of manifest.files) {
    const source = join(root, 'public/data/ephemerides', file.path)
    const target = join(output, file.path)
    try { await link(source, target); linkedFiles += 1 } catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(error.code)) throw error
      await copyFile(source, target, constants.COPYFILE_EXCL)
    }
  }
  await copyFile(join(root, 'src/data/ephemerisBodies.json'), join(output, 'ephemerisBodies.json'), constants.COPYFILE_EXCL)
  await copyFile(manifestPath, join(output, 'ephemeris-manifest.json'), constants.COPYFILE_EXCL)
  return { profile, files: manifest.files.length, bytes: totalBytes, linkedFiles, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node scripts/stage-backend-profile.mjs NEW_OUTPUT_DIRECTORY [full|pages]')
  console.log(JSON.stringify(await stageBackendProfile({ root: process.cwd(), output: resolve(process.argv[2]), profile: process.argv[3] ?? 'full' }), null, 2))
}
