import { readFile, mkdir, mkdtemp, rename, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { downloadApproximationArchive } from './approximation-archive.mjs'

const execute = promisify(execFile)

export function datasetArchiveUrl(pin) {
  if (pin?.schemaVersion !== 1 || !/^dataset-mpcorb-[a-f0-9]{16}-full$/.test(pin.tag ?? '')
      || pin.version !== pin.tag.slice('dataset-'.length) || pin.asset !== 'asteroid-dataset.tar.gz'
      || !/^[a-f0-9]{64}$/.test(pin.assetSha256 ?? '')) throw new Error('Invalid full dataset build pin')
  return `https://github.com/dajiaohuang/solar/releases/download/${pin.tag}/${pin.asset}`
}

export function validateDatasetArchiveEntries(listing, verboseListing) {
  const paths = listing.trim().split(/\r?\n/)
  if (!listing.trim() || paths.length > 100_000) throw new Error('Dataset archive file budget exceeded')
  const seen = new Set()
  for (const path of paths) {
    const normalized = path.replace(/\/$/, '')
    if (!/^[a-zA-Z0-9._/-]+$/.test(normalized) || normalized.startsWith('/')
        || normalized.split('/').some(part => !part || part === '.' || part === '..')
        || seen.has(normalized)) throw new Error(`Unsafe dataset archive path: ${path}`)
    seen.add(normalized)
  }
  // Inspect types before extraction, so a link cannot redirect a later member.
  const rows = verboseListing.trim().split(/\r?\n/)
  if (rows.length !== paths.length || rows.some(row => !/^[-d]/.test(row))) {
    throw new Error('Dataset archive contains links or special files')
  }
  if (!seen.has('dataset-version.json')) throw new Error('Dataset archive lacks its version pointer')
}

export async function installBuildDataset(pin, destination = 'public/data/asteroids', cache = '.cache/vercel-datasets') {
  const url = datasetArchiveUrl(pin)
  const target = resolve(destination)
  try {
    const pointer = JSON.parse(await readFile(join(target, 'dataset-version.json'), 'utf8'))
    if (pointer.activeVersion !== pin.version || pointer.mode !== 'full'
        || pointer.manifestPath !== `releases/${pin.version}/manifest.json`) {
      throw new Error('Installed dataset differs from the build pin')
    }
    return target
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  // Never replace a partially installed or user-maintained directory.
  try { await stat(target); throw new Error('Dataset destination already exists without a complete version pointer') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const archive = await downloadApproximationArchive(url, pin.assetSha256, cache)
  const options = { encoding: 'utf8', maxBuffer: 16 * 1048576, timeout: 120_000 }
  const { stdout: listing } = await execute('tar', ['-tzf', archive], options)
  const { stdout: verbose } = await execute('tar', ['-tvzf', archive], options)
  validateDatasetArchiveEntries(listing, verbose)
  await mkdir(cache, { recursive: true })
  const staged = await mkdtemp(join(resolve(cache), 'dataset-'))
  await execute('tar', ['-xzf', resolve(archive), '-C', staged], { ...options, timeout: 300_000 })
  const pointer = JSON.parse(await readFile(join(staged, 'dataset-version.json'), 'utf8'))
  if (pointer.activeVersion !== pin.version || pointer.mode !== 'full'
      || pointer.manifestPath !== `releases/${pin.version}/manifest.json`) {
    throw new Error('Downloaded dataset differs from the build pin')
  }
  // Validate contents and checksums before making the restored dataset visible.
  const validation = await execute(process.execPath, ['scripts/validate-dataset.mjs'], {
    ...options, timeout: 300_000, env: { ...process.env, MPCORB_OUTPUT_DIR: staged },
  })
  process.stdout.write(validation.stdout)
  await mkdir(dirname(target), { recursive: true })
  await rename(staged, target)
  return target
}
