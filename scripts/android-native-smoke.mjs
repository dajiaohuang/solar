import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { certificates, command, verifyTraffic } from './ios-native-smoke.mjs'
import { stageBackendProfile } from './stage-backend-profile.mjs'
import { createNativeCoverageResponder, verifyNativeCoverageTraffic } from './native-coverage-fixture.mjs'
import { createNativeIdentityResponder, verifyNativeIdentityTraffic } from './native-identity-fixture.mjs'
import { pinnedNativeInventory, realDirectoryPrefix, realDirectoryScenario, verifyRealDirectoryTraffic } from './native-real-directory.mjs'

const appId = 'io.github.dajiaohuang.solaratlas'
const windows = process.platform === 'win32'

export function verifyInstrumentation(output) {
  if (!/OK \(1 test\)/.test(output) || /FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(output)) {
    throw new Error('Android instrumentation did not prove the real observation test passed')
  }
}

export function validateEmulatorIdentity(serial, actual, expected) {
  if (!/^emulator-\d+$/.test(serial) || !/^solar_smoke_\d+$/.test(expected) || actual.split(/\r?\n/)[0].trim() !== expected) {
    throw new Error('Refusing to operate on an emulator not created by this smoke run')
  }
}

export async function removeOwnedAndroidTemporary(directory) {
  const root = await realpath(tmpdir()), resolved = await realpath(directory)
  if ((await lstat(directory)).isSymbolicLink() || dirname(resolved) !== root || !basename(resolved).startsWith('solar-android-smoke-')) {
    throw new Error('Refusing cleanup outside the owned Android smoke directory')
  }
  await rm(resolved, { recursive: true, force: true })
}

async function freePort(port) {
  const server = net.createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
  await new Promise(done => server.close(done))
}

function ownedProcess(file, args, env, log) {
  const stream = createWriteStream(log, { flags: 'wx' })
  const child = spawn(file, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.once('error', error => { child.spawnFailure = error; stream.end() })
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false })
  child.once('close', () => stream.end())
  return child
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.spawnFailure) return
  await new Promise(done => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 5000)
    child.once('close', () => { clearTimeout(timer); done() })
    child.kill('SIGTERM')
  })
}

// Only generated/validated local paths reach cmd.exe. No user shell expressions.
function batch(file, args, options) {
  if (!windows) return command(file, args, options)
  const values = [file, ...args]
  if (values.some(value => /["\r\n%&|<>^]/.test(value))) throw new Error('Unsafe Windows batch argument')
  return command('cmd.exe', ['/d', '/s', '/c', `"${values.map(value => `"${value}"`).join(' ')}"`], { ...options, windowsVerbatimArguments: true })
}

export async function androidNativeSmoke() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!sdk) throw new Error('Set ANDROID_HOME to an installed SDK with emulator and API 36 x86_64 default image')
  const adb = join(sdk, 'platform-tools', `adb${windows ? '.exe' : ''}`)
  const emulator = join(sdk, 'emulator', `emulator${windows ? '.exe' : ''}`)
  const avdmanager = join(sdk, 'cmdline-tools/latest/bin', `avdmanager${windows ? '.bat' : ''}`)
  const artifact = resolve(process.env.SOLAR_ANDROID_SMOKE_OUTPUT || 'build/android-native-smoke')
  await mkdir(dirname(artifact), { recursive: true })
  await mkdir(artifact) // Existing evidence must never be overwritten.
  const temporary = await mkdtemp(join(tmpdir(), 'solar-android-smoke-'))
  const env = { ...process.env, ANDROID_AVD_HOME: join(temporary, 'avd'), ANDROID_USER_HOME: join(temporary, 'android') }
  const name = `solar_smoke_${Date.now()}`, serial = 'emulator-5580'
  const traffic = [], report = { status: 'running', scope: 'real full-profile SPK → Go → HTTPS → Android emulator UI/cache; not physical-device performance' }
  let device, backend, proxy, identityVerified = false
  const deviceCommand = args => command(adb, ['-s', serial, ...args], { env })
  const assertOwned = async () => validateEmulatorIdentity(serial, await deviceCommand(['emu', 'avd', 'name']), name)
  try {
    const inventory = await pinnedNativeInventory(process.env.SOLAR_ANDROID_INVENTORY_DIR, process.env.SOLAR_ANDROID_INVENTORY_SHA256)
    report.source = { commit: await command('git', ['rev-parse', 'HEAD']), files: {} }
    for (const file of ['scripts/android-native-smoke.mjs', 'scripts/ios-native-smoke.mjs', 'scripts/native-coverage-fixture.mjs', 'scripts/native-identity-fixture.mjs', 'scripts/native-real-directory.mjs',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/MainActivity.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/NativeObservationDeck.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/NativeRenderBudget.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/StateTileService.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/StateTileDecoder.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/StateTileClient.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/StateTileCache.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/CoverageReport.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/CoverageService.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/CoveragePanel.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/SourceIdentityPage.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/SourceIdentityService.java',
      'android/app/src/main/java/io/github/dajiaohuang/solaratlas/SourceIdentityPanel.java',
      'android/app/src/main/res/values/identities.xml', 'android/app/src/main/res/values-zh/identities.xml',
      'android/app/src/main/res/values/coverage.xml', 'android/app/src/main/res/values-zh/coverage.xml',
      'android/app/src/main/res/values/render-budget.xml', 'android/app/src/main/res/values-zh/render-budget.xml',
      'android/app/src/androidTest/java/io/github/dajiaohuang/solaratlas/ObservationUITest.java']) {
      report.source.files[file] = createHash('sha256').update(await readFile(file)).digest('hex')
    }
    await Promise.all([mkdir(env.ANDROID_AVD_HOME), mkdir(env.ANDROID_USER_HOME)])
    await Promise.all([5580, 5581, 18790, 18791].map(freePort))
    if ((await command(adb, ['devices'], { env })).split(/\r?\n/).some(line => line.startsWith(serial + '\t'))) throw new Error('Selected emulator serial is already in use')
    report.profile = await stageBackendProfile({ root: process.cwd(), output: join(temporary, 'data'), profile: 'full' })
    const executable = join(temporary, `solar-backend${windows ? '.exe' : ''}`)
    await command('go', ['build', '-o', executable, './cmd/solar-backend'])
    const fixture = join(temporary, 'real-golden')
    await command('go', ['run', './cmd/state-tile-fixture', '-out', fixture, '-data-dir', join(temporary, 'data'),
      '-ids', 'naif:399,naif:301,naif:10,unknown:fixture', '-tile-size', '2'])
    const goldenEnv = { ...env, SOLAR_STATE_TILE_FIXTURE_DIR: fixture }
    await command(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/state-tiles-golden.test.ts'], { env: goldenEnv, log: join(artifact, 'real-web-golden.log') })
    await batch(resolve('android', windows ? 'gradlew.bat' : 'gradlew'), ['-p', resolve('android'), 'testDebugUnitTest', 'assembleDebug', 'assembleDebugAndroidTest'],
      { env: goldenEnv, log: join(artifact, 'android-build.log'), timeout: 600_000 })
    report.golden = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'))
    if (report.golden.plan.exactCount !== 3 || report.golden.plan.missingCount !== 1) throw new Error('Real golden must contain 3 exact states and 1 explicit gap')
    await certificates(temporary, process.env.SOLAR_OPENSSL || 'openssl')
    await batch(avdmanager, ['create', 'avd', '-n', name, '-k', 'system-images;android-36;default;x86_64', '-p', join(env.ANDROID_AVD_HOME, name + '.avd'), '-d', 'pixel_6'], { env })
    device = ownedProcess(emulator, ['-avd', name, '-port', '5580', '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader', '-memory', '4096'], env, join(artifact, 'emulator.log'))
    let booted = false
    for (let i = 0; i < 180; i++) {
      if (device.spawnFailure) throw device.spawnFailure
      if (device.exitCode !== null) throw new Error('Owned Android emulator exited before boot')
      try { if ((await deviceCommand(['shell', 'getprop', 'sys.boot_completed'])) === '1') { booted = true; break } } catch { /* adb may not be ready yet */ }
      await new Promise(done => setTimeout(done, 1000))
    }
    if (!booted) throw new Error('Owned Android emulator did not boot')
    await assertOwned(); identityVerified = true
    report.emulator = { serial, name, image: 'system-images;android-36;default;x86_64' }
    // Espresso environment preparation, scoped to this disposable emulator.
    // Runtime smoke is not an animation/frame-rate benchmark.
    for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
      await deviceCommand(['shell', 'settings', 'put', 'global', setting, '0'])
    }
    await deviceCommand(['shell', 'input', 'keyevent', '82'])
    await deviceCommand(['install', resolve('android/app/build/outputs/apk/debug/app-debug.apk')])
    await deviceCommand(['install', resolve('android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')])
    backend = ownedProcess(executable, ['-data-dir', join(temporary, 'data'), '-listen', '127.0.0.1:18790',
      ...(inventory ? ['-inventory-dir', inventory.directory] : [])], env, join(artifact, 'backend.log'))
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (backend.spawnFailure) throw backend.spawnFailure
      if (backend.exitCode !== null) throw new Error('Owned Go backend exited')
      try {
        const response = await fetch('http://127.0.0.1:18790/v1/catalog/manifest', { signal: AbortSignal.timeout(500) })
        if (response.ok && (await response.json()).catalogManifestSha256 === report.profile.manifestSha256) { ready = true; break }
      } catch { /* backend startup */ }
      await new Promise(done => setTimeout(done, 100))
    }
    if (!ready) throw new Error('Owned Go backend did not serve the staged manifest')
    const realScenario = inventory ? await realDirectoryScenario('http://127.0.0.1:18790', inventory) : null
    report.sourceDirectory = realScenario
    const coverageReply = createNativeCoverageResponder()
    const identityReply = createNativeIdentityResponder()
    proxy = https.createServer({ key: await readFile(join(temporary, 'server.key')), cert: await readFile(join(temporary, 'server.crt')) }, (request, response) => {
      const fixtureReply = coverageReply(request.method, request.url) ?? identityReply(request.method, request.url)
      if (fixtureReply) {
        const body = Buffer.from(JSON.stringify(fixtureReply.body))
        traffic.push({ method: request.method, path: request.url, status: fixtureReply.status, bytes: body.length })
        response.writeHead(fixtureReply.status, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
        response.end(body); return
      }
      // Transparent test routing to the same real Go backend, never fixture data.
      const isRealDirectory = Boolean(realScenario) && request.url.startsWith(realDirectoryPrefix)
      const row = { method: request.method, path: request.url, status: 0, bytes: 0 }
      if (isRealDirectory && request.method === 'POST') {
        row.requestBody = ''
        request.on('data', bytes => { row.requestBody += bytes.toString(); if (row.requestBody.length > 64 * 1024) request.destroy() })
      }
      const upstream = http.request({ hostname: '127.0.0.1', port: 18790,
        path: isRealDirectory ? '/' + request.url.slice(realDirectoryPrefix.length) : request.url, method: request.method, headers: request.headers }, incoming => {
        row.status = incoming.statusCode; traffic.push(row)
        response.writeHead(incoming.statusCode, incoming.headers)
        incoming.on('data', bytes => { row.bytes += bytes.length }); incoming.pipe(response)
      })
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() })
      upstream.setTimeout(30_000, () => upstream.destroy()); response.on('close', () => upstream.destroy()); request.pipe(upstream)
    })
    await new Promise((done, reject) => { proxy.once('error', reject); proxy.listen(18791, '127.0.0.1', done) })
    await deviceCommand(['reverse', 'tcp:18791', 'tcp:18791'])
    // Test APK trusts only this temporary CA. Production TLS and hostname
    // validation remain unchanged; no root cert is installed on the host/device.
    const output = await command(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r',
      '-e', 'class', `${appId}.ObservationUITest`, '-e', 'solarBackend', 'https://127.0.0.1:18791',
      ...(realScenario ? ['-e', 'solarRealDirectory', Buffer.from(JSON.stringify(realScenario)).toString('base64')] : []),
      '-e', 'solarCaBase64', (await readFile(join(temporary, 'root.crt'))).toString('base64'), `${appId}.test/androidx.test.runner.AndroidJUnitRunner`],
    { env, log: join(artifact, 'instrumentation.log'), timeout: 240_000 })
    verifyInstrumentation(output); verifyTraffic(traffic.filter(row => !row.path.startsWith('/coverage-fixture/') && !row.path.startsWith('/identity-fixture/') && !row.path.startsWith(realDirectoryPrefix)))
    report.realDirectoryUi = verifyRealDirectoryTraffic(traffic, realScenario)
    report.identityUi = verifyNativeIdentityTraffic(traffic)
    report.coverageUi = verifyNativeCoverageTraffic(traffic)
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'; report.error = error.message
    throw error
  } finally {
    if (identityVerified) {
      try {
        await assertOwned()
        await command(adb, ['-s', serial, 'logcat', '-d', '-t', '3000'], { env, log: join(artifact, 'logcat.log') })
        await deviceCommand(['pull', `/sdcard/Android/data/${appId}/files/solar-native-smoke`, join(artifact, 'screenshots')])
      } catch (error) { report.evidenceError = error.message }
      try { await assertOwned(); await deviceCommand(['reverse', '--remove', 'tcp:18791']); await deviceCommand(['emu', 'kill']) }
      catch (error) { report.deviceCleanupError = error.message }
    }
    proxy?.closeAllConnections()
    if (proxy?.listening) await new Promise(done => proxy.close(done))
    await stop(backend); await stop(device)
    await removeOwnedAndroidTemporary(temporary).catch(error => { report.temporaryCleanupError = error.message })
    report.traffic = traffic
    if (report.evidenceError || report.deviceCleanupError || report.temporaryCleanupError) report.status = 'failed'
    await writeFile(join(artifact, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  }
  if (report.status !== 'passed') throw new Error('Android smoke cleanup/evidence failed; inspect report.json')
  console.log(`Android HTTPS smoke passed; evidence: ${artifact}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await androidNativeSmoke()
