import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readScientificFile, writeScientificReceipt } from '../../scripts/lib/scientific-file.mjs'

test('scientific reads enforce byte budgets and exact source size', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-file-budget-'))
  const path = join(directory, 'source.bin'), bytes = Buffer.alloc(150000, 123)
  await writeFile(path, bytes)
  expect(await readScientificFile(path, bytes.length, { exactBytes: bytes.length })).toEqual(bytes)
  await expect(readScientificFile(path, bytes.length - 1)).rejects.toThrow('byte budget')
  await expect(readScientificFile(path, bytes.length, { exactBytes: bytes.length - 1 })).rejects.toThrow('byte budget')
  await expect(readScientificFile(path, Infinity)).rejects.toThrow('byte budget')
})

test('pre-cancelled file operations do not create a receipt or inspect a missing input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-file-cancel-'))
  const path = join(directory, 'absent.json'), signal = AbortSignal.abort()
  await expect(readScientificFile(path, 1024, { signal })).rejects.toMatchObject({ name: 'AbortError' })
  await expect(writeScientificReceipt(path, '{}', { signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(await readdir(directory)).toEqual([])
})

test('competing receipt writers publish exactly one complete file without overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-file-race-'))
  const path = join(directory, 'receipt.json')
  const payloads = ['a', 'b'].map(value => JSON.stringify({ payload: value.repeat(150000) }))
  const results = await Promise.allSettled(payloads.map(json => writeScientificReceipt(path, json)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(failure.reason).toMatchObject({ outputPublished: false, cause: { code: 'EEXIST' }, cleanupWarnings: [] })
  const winner = results.findIndex(result => result.status === 'fulfilled')
  expect(await readFile(path, 'utf8')).toBe(payloads[winner] + '\n')
  expect(await readdir(directory)).toEqual(['receipt.json'])
})

test('UTF-8 output byte budget includes the trailing newline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-file-output-budget-'))
  const path = join(directory, 'receipt.json'), payload = JSON.stringify({ label: '太阳' })
  const size = Buffer.byteLength(payload, 'utf8') + 1
  await expect(writeScientificReceipt(path, payload, { maxBytes: size - 1 })).rejects.toThrow('byte budget')
  expect(await readdir(directory)).toEqual([])
  const result = await writeScientificReceipt(path, payload, { maxBytes: size })
  expect(result.outputBytes).toBe(size)
  expect(await readFile(path, 'utf8')).toBe(payload + '\n')
})
