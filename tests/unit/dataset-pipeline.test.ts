import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

function fixedWidthRecord(designation: string, label: string, semiMajorAxisAU: number) {
  const characters = Array(194).fill(' ')
  const put = (start: number, value: string) => value.split('').forEach((character, index) => { characters[start + index] = character })
  put(0, designation.padStart(7, '0').slice(-7))
  put(8, ' 8.10')
  put(20, 'K2411')
  put(26, ' 10.0000')
  put(37, ' 73.0000')
  put(48, ' 80.0000')
  put(59, ' 10.6000')
  put(70, '0.0758000')
  put(80, '0.214000000')
  put(92, semiMajorAxisAU.toFixed(7).padStart(11, ' '))
  put(161, '0000')
  put(166, label.slice(0, 28))
  return characters.join('')
}

describe('immutable asteroid dataset publisher', () => {
  it('publishes and validates binary shards, indexes, provenance, and checksums', async () => {
    const temporaryRoot = await mkdtemp(resolve(process.cwd(), '.dataset-test-'))
    const sourcePath = resolve(temporaryRoot, 'MPCORB-mini.DAT')
    const outputPath = resolve(temporaryRoot, 'output')
    const secondOutputPath = resolve(temporaryRoot, 'output-repeat')
    try {
      const source = [
        'MPCORB integration fixture',
        '---------------------------',
        fixedWidthRecord('0001001', '1001 Atlas Alpha', 2.31),
        fixedWidthRecord('0001002', '1002 Atlas Beta', 2.72),
        fixedWidthRecord('0001003', '1003 Atlas Gamma', 3.14),
        '',
      ].join('\n')
      await writeFile(sourcePath, source)
      const environment = {
        ...process.env,
        MPCORB_SOURCE_FILE: sourcePath,
        MPCORB_OUTPUT_DIR: outputPath,
        MPCORB_MODE: 'lite',
        MPCORB_LITE_MAX_NUMBER: '30000',
        MPCORB_REQUIRE_FEATURED: '0',
        MPCORB_CHUNK_SIZE: '2',
      }
      await execFileAsync(process.execPath, [resolve('scripts/preprocess-asteroids.mjs')], { cwd: process.cwd(), env: environment })
      const pointer = JSON.parse(await readFile(resolve(outputPath, 'dataset-version.json'), 'utf8'))
      const releasePath = resolve(outputPath, 'releases', pointer.activeVersion)
      const manifest = JSON.parse(await readFile(resolve(releasePath, 'manifest.json'), 'utf8'))
      const validation = JSON.parse(await readFile(resolve(releasePath, 'validation-report.json'), 'utf8'))
      const checksums = JSON.parse(await readFile(resolve(releasePath, 'checksums.json'), 'utf8'))

      expect(pointer).toMatchObject({ mode: 'lite', contentSha256: manifest.contentSha256 })
      expect(manifest).toMatchObject({ schemaVersion: 2, totalCount: 3, chunkCount: 2, chunkSize: 2, format: 'binary-v1' })
      expect(manifest.selectionPolicy).toMatchObject({ type: 'permanent-number-through-plus-featured', maxPermanentNumber: 30000 })
      expect(manifest.contentSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(validation).toMatchObject({ passed: true, validObjects: 3, parsedSourceObjects: 3, rejectedObjects: 0 })
      expect(checksums.files).toHaveProperty('binary/chunk-0000.bin')
      expect(checksums.files).toHaveProperty('search/number-000000-009999.json')
      expect((await stat(resolve(releasePath, 'binary', 'chunk-0000.bin'))).size).toBe(2 * 8 * Float64Array.BYTES_PER_ELEMENT)

      await expect(execFileAsync(process.execPath, [resolve('scripts/preprocess-asteroids.mjs')], { cwd: process.cwd(), env: environment }))
        .rejects.toThrow(/Immutable dataset release already exists/)

      const verified = await execFileAsync(process.execPath, [resolve('scripts/validate-dataset.mjs')], { cwd: process.cwd(), env: environment })
      expect(verified.stdout).toContain(`Validated dataset ${pointer.activeVersion}: 3 objects`)

      manifest.totalCount = 4
      const modifiedManifest = JSON.stringify(manifest)
      checksums.files['manifest.json'] = createHash('sha256').update(modifiedManifest).digest('hex')
      await writeFile(resolve(releasePath, 'manifest.json'), modifiedManifest)
      await writeFile(resolve(releasePath, 'checksums.json'), JSON.stringify(checksums))
      await expect(execFileAsync(process.execPath, [resolve('scripts/validate-dataset.mjs')], { cwd: process.cwd(), env: environment }))
        .rejects.toThrow(/metadata contains 3 objects; manifest declares 4/)

      const repeatEnvironment = { ...environment, MPCORB_OUTPUT_DIR: secondOutputPath }
      await execFileAsync(process.execPath, [resolve('scripts/preprocess-asteroids.mjs')], { cwd: process.cwd(), env: repeatEnvironment })
      const repeatPointer = JSON.parse(await readFile(resolve(secondOutputPath, 'dataset-version.json'), 'utf8'))
      expect(repeatPointer.activeVersion).toBe(pointer.activeVersion)
      expect(repeatPointer.contentSha256).toBe(pointer.contentSha256)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
