import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import ts from 'typescript'

// Exercise the actual cache module against browser IndexedDB, not a storage
// mock. A blank same-origin document isolates persistence from app startup.
const cacheScript = ts.transpileModule(readFileSync(resolve('src/data/cache/indexedDb.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
type CacheWindow = Window & {
  cacheUnderTest: { fetchImmutableArrayBuffer(url: string): Promise<ArrayBuffer> }
}
const fullRoot = '/solar/data/asteroids/releases/'
const previewRoot = `/solar/data/asteroids/preview/${'a'.repeat(64)}/releases/`
const previewVersion = `preview:${'a'.repeat(64)}:v1`
type Seed = { key: string; version: string; accessed: number }

async function seed(page: Page, records: Seed[]) {
  await page.evaluate(async (entries) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('solar-atlas-data-v1', 2)
      request.onupgradeneeded = () => request.result.createObjectStore('immutable-responses')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('immutable-responses', 'readwrite')
      for (const entry of entries) transaction.objectStore('immutable-responses').put({
        buffer: new Uint8Array(128).fill(42).buffer,
        datasetVersion: entry.version, byteLength: 128, lastAccessed: entry.accessed,
      }, entry.key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, records)
}

async function keys(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('solar-atlas-data-v1', 2)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const result = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = database.transaction('immutable-responses').objectStore('immutable-responses').getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return result
  })
}

async function read(page: Page, url: string) {
  expect(await page.evaluate(async (url) => {
    const buffer = await (window as CacheWindow).cacheUnderTest.fetchImmutableArrayBuffer(url)
    return [buffer.byteLength, new Uint8Array(buffer)[0]]
  }, url)).toEqual([128, 42])
}

test.beforeEach(async ({ page }) => {
  await page.route('**/solar/__cache-test.html', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>IndexedDB contract</title>',
  }))
  await page.goto('/solar/__cache-test.html')
  await page.addScriptTag({ content: `(function(){const exports={};${cacheScript}\nwindow.cacheUnderTest=exports;})()` })
  // Cache hits must work offline. A missed record fails the test immediately.
  await page.route('**/data/asteroids/**', (route) => route.fulfill({ status: 503, body: 'unexpected network access' }))
})

test('preview and full caches coexist while stale releases are removed per product', async ({ page }) => {
  const full = `${fullRoot}v2/sample.bin`
  const preview = `${previewRoot}v1/sample.bin`
  await seed(page, [
    { key: `${fullRoot}v1/sample.bin`, version: 'v1', accessed: 1 },
    { key: full, version: 'v2', accessed: 2 },
    { key: `${previewRoot}v0/sample.bin`, version: `preview:${'a'.repeat(64)}:v0`, accessed: 3 },
    { key: '/legacy-sample.bin', version: 'legacy', accessed: 4 },
    { key: preview, version: previewVersion, accessed: 5 },
  ])
  await read(page, preview)
  expect(await keys(page)).toEqual([`${fullRoot}v1/sample.bin`, full, preview].sort())
  await read(page, full)
  expect(await keys(page)).toEqual([full, preview].sort())

  const next = `/solar/data/asteroids/preview/${'b'.repeat(64)}/releases/v1/sample.bin`
  await seed(page, [{ key: next, version: `preview:${'b'.repeat(64)}:v1`, accessed: Date.now() }])
  await read(page, next)
  expect(await keys(page)).toEqual([full, next].sort())
  await read(page, full)
})

test('full and preview records share one global LRU byte budget', async ({ page }) => {
  await page.evaluate(() => {
    // The implementation reserves at most 25% of quota: 256 bytes here.
    Object.defineProperty(navigator.storage, 'estimate', { value: async () => ({ quota: 1024, usage: 0 }) })
  })
  const oldPreview = `${previewRoot}v1/old.bin`
  const preview = `${previewRoot}v1/sample.bin`
  const full = `${fullRoot}v2/sample.bin`
  await seed(page, [
    { key: oldPreview, version: previewVersion, accessed: 1 },
    { key: preview, version: previewVersion, accessed: 2 },
    { key: full, version: 'v2', accessed: 3 },
  ])
  await read(page, preview)
  expect(await keys(page)).toEqual([full, preview].sort())
  await read(page, full)
  expect(await keys(page)).toEqual([full, preview].sort())
})
