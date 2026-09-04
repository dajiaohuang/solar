import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ephemerisProfile } from '../src/data/ephemerisProfile.ts'
import { verifyEphemerisAssets } from './lib/verify-ephemeris-assets.mjs'

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

const stylesheets = assetFiles.filter((name) => name.endsWith('.css'))
const styles = (await Promise.all(stylesheets.map((name) => readFile(join(dist, 'assets', name), 'utf8')))).join('\n')
for (const side of ['top', 'right', 'bottom', 'left']) {
  if (!styles.includes(`var(--safe-area-inset-${side},env(safe-area-inset-${side},0px))`)) {
    throw new Error(`Native CSS does not preserve the Capacitor ${side} safe-area fallback`)
  }
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
const buildInfo = JSON.parse(await readFile(join(dist, 'build-info.json'), 'utf8'))
if (buildInfo.productProfile !== 'full') throw new Error('Native build inherited preview product restrictions')
const profile = ephemerisProfile('native', buildInfo.ephemerisProfile)
const ephemerisManifest = JSON.parse(await readFile(`src/data/ephemeris-manifest${profile === 'full' ? '-full' : ''}.json`, 'utf8'))
const ephemerisBytes = await verifyEphemerisAssets(join(dist, 'data', 'ephemerides'), ephemerisManifest.files)
const shellBytes = bytes - ephemerisBytes
if (shellBytes > 25 * 1024 * 1024) throw new Error(`Native shell is unexpectedly large: ${shellBytes} bytes`)
process.stdout.write(`Verified native shell: ${javascript.length} JavaScript assets, ${shellBytes} shell bytes + ${ephemerisBytes} pinned SPK bytes\n`)
