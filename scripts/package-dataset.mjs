import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createGzip } from 'node:zlib'

const TAR_BLOCK_SIZE = 512

function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

async function listFiles(root, directory = root) {
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => comparePaths(left.name, right.name))
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
    else throw new Error(`Dataset archive cannot contain links or special files: ${path}`)
  }
  return files
}

function writeString(header, offset, length, value, label) {
  const encoded = Buffer.from(value)
  if (encoded.length > length) throw new Error(`${label} is too long for a deterministic ustar header: ${value}`)
  encoded.copy(header, offset)
}

function writeOctal(header, offset, length, value, label) {
  const encoded = value.toString(8)
  if (encoded.length > length - 1) throw new Error(`${label} exceeds the deterministic ustar field width`)
  writeString(header, offset, length, `${encoded.padStart(length - 1, '0')}\0`, label)
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) {
    const prefix = path.slice(0, slash)
    const name = path.slice(slash + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  throw new Error(`Dataset archive path is too long for deterministic ustar: ${path}`)
}

function createTarHeader(path, size) {
  const { name, prefix } = splitTarPath(path)
  const header = Buffer.alloc(TAR_BLOCK_SIZE)
  writeString(header, 0, 100, name, 'path')
  writeOctal(header, 100, 8, 0o644, 'mode')
  writeOctal(header, 108, 8, 0, 'uid')
  writeOctal(header, 116, 8, 0, 'gid')
  writeOctal(header, 124, 12, size, 'size')
  writeOctal(header, 136, 12, 0, 'mtime')
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeString(header, 257, 6, 'ustar\0', 'magic')
  writeString(header, 263, 2, '00', 'version')
  writeString(header, 345, 155, prefix, 'path prefix')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `, 'checksum')
  return header
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await new Promise((resolveDrain) => stream.once('drain', resolveDrain))
}

export async function createDeterministicDatasetArchive(inputDirectory, outputFile) {
  const inputRoot = resolve(inputDirectory)
  const archivePath = resolve(outputFile)
  const archiveRelativeToInput = relative(inputRoot, archivePath)
  if (!archiveRelativeToInput.startsWith('..') && !isAbsolute(archiveRelativeToInput)) {
    throw new Error('Dataset archive output must be outside the input directory')
  }
  const inputStats = await lstat(inputRoot)
  if (!inputStats.isDirectory()) throw new Error(`Dataset archive input is not a directory: ${inputRoot}`)
  const files = await listFiles(inputRoot)
  if (!files.length) throw new Error(`Dataset archive input is empty: ${inputRoot}`)
  await mkdir(dirname(archivePath), { recursive: true })

  const gzip = createGzip({ level: 9, mtime: 0 })
  const completion = pipeline(gzip, createWriteStream(archivePath))
  for (const relativePath of files) {
    const absolutePath = resolve(inputRoot, ...relativePath.split('/'))
    const stats = await lstat(absolutePath)
    await writeChunk(gzip, createTarHeader(relativePath, stats.size))
    for await (const chunk of createReadStream(absolutePath)) await writeChunk(gzip, chunk)
    const padding = (TAR_BLOCK_SIZE - stats.size % TAR_BLOCK_SIZE) % TAR_BLOCK_SIZE
    if (padding) await writeChunk(gzip, Buffer.alloc(padding))
  }
  await writeChunk(gzip, Buffer.alloc(TAR_BLOCK_SIZE * 2))
  gzip.end()
  await completion

  // Fix both variable gzip header fields even if the host zlib defaults change.
  const handle = await open(archivePath, 'r+')
  try {
    await handle.write(Buffer.from([0, 0, 0, 0]), 0, 4, 4)
    await handle.write(Buffer.from([3]), 0, 1, 9)
  } finally {
    await handle.close()
  }
  return archivePath
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  const [, , inputDirectory, outputFile] = process.argv
  if (!inputDirectory || !outputFile) {
    console.error('Usage: node scripts/package-dataset.mjs <input-directory> <output-file>')
    process.exitCode = 2
  } else {
    createDeterministicDatasetArchive(inputDirectory, outputFile)
      .then(async (path) => console.log(`${await sha256File(path)}  ${path}`))
      .catch((error) => { console.error(error); process.exitCode = 1 })
  }
}
