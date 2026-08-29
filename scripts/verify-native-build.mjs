import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const dist = resolve('dist')
const index = await readFile(join(dist, 'index.html'), 'utf8')
if (/(?:src|href)=["']\/solar\/(?:assets\/|sw\.js)/.test(index)) {
  throw new Error('Native index still contains GitHub Pages application asset paths')
}
if (!index.includes('./assets/')) throw new Error('Native index does not use relative asset paths')

const assetFiles = await readdir(join(dist, 'assets'))
const javascript = assetFiles.filter((name) => name.endsWith('.js'))
const bundles = await Promise.all(javascript.map((name) => readFile(join(dist, 'assets', name), 'utf8')))
const joined = bundles.join('\n')
if (joined.includes('serviceWorker.register')) throw new Error('Native JavaScript still registers a service worker')
if (!joined.includes('https://dajiaohuang.github.io/solar/data/asteroids')) {
  throw new Error('Native JavaScript does not contain the audited catalog data origin')
}

async function directoryBytes(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await directoryBytes(child) : (await stat(child)).size
  }
  return total
}

const bytes = await directoryBytes(dist)
if (bytes > 25 * 1024 * 1024) throw new Error(`Native shell is unexpectedly large: ${bytes} bytes`)
process.stdout.write(`Verified native shell: ${javascript.length} JavaScript assets, ${bytes} bytes\n`)
