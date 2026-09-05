import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageBackendProfile } from './stage-backend-profile.mjs'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function selectSimulatorTemplate(snapshot) {
  const candidates = Object.entries(snapshot.devices ?? {}).flatMap(([runtime, devices]) =>
    runtime.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-')
      ? devices.filter(device => device.isAvailable && device.name.startsWith('iPhone') &&
        device.deviceTypeIdentifier?.startsWith('com.apple.CoreSimulator.SimDeviceType.iPhone-'))
        .map(device => ({ runtime, deviceType: device.deviceTypeIdentifier, name: device.name }))
      : [])
  candidates.sort((a, b) => b.runtime.localeCompare(a.runtime, 'en', { numeric: true }) || a.name.localeCompare(b.name))
  if (!candidates.length) throw new Error('No available iPhone simulator runtime; native smoke cannot be skipped')
  return candidates[0]
}

export function testArguments(device, resultPath) {
  if (!uuidPattern.test(device)) throw new Error('Invalid owned simulator ID')
  return ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
    '-destination', `platform=iOS Simulator,id=${device}`, '-destination-timeout', '120',
    '-derivedDataPath', 'build/ios-derived-data', '-resultBundlePath', resultPath,
    '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
    'CODE_SIGNING_ALLOWED=NO', 'test']
}

export async function bootOwnedSimulator(device, artifact, report, run = command) {
  if (!uuidPattern.test(device)) throw new Error('Invalid owned simulator ID')
  // Fresh CI devices migrate system data before applications can launch. Keep
  // this infrastructure budget separate from the unchanged XCTest deadline.
  const started = Date.now()
  report.boot = { status: 'running', timeoutMs: 600_000 }
  try {
    await run('xcrun', ['simctl', 'boot', device])
    await run('xcrun', ['simctl', 'bootstatus', device, '-b'],
      { timeout: report.boot.timeoutMs, log: join(artifact, 'simulator-boot.log') })
    report.boot.status = 'passed'
  } catch (error) {
    report.boot.status = 'failed'
    report.boot.error = error.message
    throw error
  } finally {
    report.boot.elapsedMs = Date.now() - started
  }
}

export function verifyTraffic(traffic) {
  const count = path => traffic.filter(row => row.path === path && row.status === 200).length
  if (traffic.some(row => row.status !== 200)) throw new Error('Native HTTPS request failed')
  if (count('/v1/catalog/manifest') !== 2 || count('/v1/state/plan') !== 2 || count('/v1/state/tiles') !== 1) {
    throw new Error('Expected two actual online observations and one verified cached-tile reuse')
  }
}

export async function removeOwnedTemporary(directory) {
  const resolved = await realpath(directory), root = await realpath(tmpdir())
  if ((await lstat(directory)).isSymbolicLink() || dirname(resolved) !== root || !basename(resolved).startsWith('solar-ios-smoke-')) {
    throw new Error('Refusing cleanup outside the owned simulator temporary directory')
  }
  await rm(resolved, { recursive: true, force: true })
}

export function command(file, args, { env = process.env, log, timeout = 120_000, windowsVerbatimArguments = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { env, windowsHide: true, windowsVerbatimArguments, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', expired = false, overflow = false
    const stream = log ? createWriteStream(log, { flags: 'wx' }) : undefined
    stream?.on('error', reject)
    const consume = bytes => {
      stream?.write(bytes)
      output += bytes.toString()
      if (stream) output = output.slice(-16_384)
      else if (output.length > 4 * 1024 * 1024) { overflow = true; child.kill('SIGKILL') }
    }
    child.stdout.on('data', consume); child.stderr.on('data', consume)
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL') }, timeout)
    child.on('error', error => { clearTimeout(timer); stream?.end(); reject(error) })
    child.on('close', code => {
      clearTimeout(timer); stream?.end()
      if (overflow) reject(new Error(`${file} exceeded its bounded capture limit`))
      else if (code !== 0 || expired) reject(new Error(`${file} ${expired ? 'timed out' : `exited ${code}`}\n${output}`))
      else resolvePromise(output.trim())
    })
  })
}

async function assertFreePort(port) {
  const probe = net.createServer()
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject)
    probe.listen(port, '127.0.0.1', resolvePromise)
  })
  await new Promise(resolvePromise => probe.close(resolvePromise))
}

async function waitForBackend(child, expectedHash) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.spawnFailure) throw child.spawnFailure
    if (child.exitCode !== null) throw new Error(`Owned Go backend exited ${child.exitCode}`)
    try {
      const response = await fetch('http://127.0.0.1:18790/v1/catalog/manifest', { signal: AbortSignal.timeout(500) })
      const manifest = await response.json()
      if (!response.ok || manifest.catalogManifestSha256 !== expectedHash) throw new Error('Unexpected backend manifest')
      return
    } catch {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
    }
  }
  throw new Error('Owned Go backend did not become ready with the staged manifest')
}

export async function certificates(directory, openssl = 'openssl') {
  const rootConfig = join(directory, 'root.cnf'), leafConfig = join(directory, 'server.cnf')
  await writeFile(rootConfig, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=Solar isolated simulator test CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n', { flag: 'wx' })
  await writeFile(leafConfig, '[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=localhost\n[v3_req]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { flag: 'wx' })
  await command(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-config', rootConfig, '-keyout', join(directory, 'root.key'), '-out', join(directory, 'root.crt')])
  await command(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-config', leafConfig,
    '-keyout', join(directory, 'server.key'), '-out', join(directory, 'server.csr')])
  await command(openssl, ['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', join(directory, 'root.crt'),
    '-CAkey', join(directory, 'root.key'), '-CAcreateserial', '-days', '2', '-sha256',
    '-extfile', leafConfig, '-extensions', 'v3_req', '-out', join(directory, 'server.crt')])
}

export async function nativeSmoke() {
  if (process.platform !== 'darwin') throw new Error('iOS runtime validation requires macOS and Xcode')
  const artifact = resolve('build/ios-native-smoke')
  await mkdir(artifact) // Never overwrite an earlier result.
  const temporary = await mkdtemp(join(tmpdir(), 'solar-ios-smoke-'))
  const traffic = [], report = { status: 'running', scope: 'real full-profile SPK → Go → HTTPS → native simulator UI; not real-device performance' }
  let device, backend, proxy
  try {
    report.profile = await stageBackendProfile({ root: process.cwd(), output: join(temporary, 'data'), profile: 'full' })
    await command('go', ['build', '-o', join(temporary, 'solar-backend'), './cmd/solar-backend'])
    await command('go', ['run', './cmd/state-tile-fixture', '-out', join(temporary, 'real-golden'),
      '-data-dir', join(temporary, 'data'), '-ids', 'naif:399,naif:301,naif:10,unknown:fixture', '-tile-size', '2'])
    const goldenEnv = { ...process.env, SOLAR_STATE_TILE_FIXTURE_DIR: join(temporary, 'real-golden') }
    await command(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/state-tiles-golden.test.ts'],
      { env: goldenEnv, log: join(artifact, 'real-web-golden.log') })
    await command('swiftc', ['ios/App/App/StateTileDecoder.swift', 'ios/App/App/StateTileCache.swift',
      'ios/App/App/NativeStateProjection.swift', 'ios/ProtocolTests/ProtocolTests.swift', '-o', join(temporary, 'protocol-tests')])
    await command(join(temporary, 'protocol-tests'), [], { env: goldenEnv, log: join(artifact, 'real-swift-golden.log') })
    report.golden = JSON.parse(await readFile(join(temporary, 'real-golden/manifest.json'), 'utf8'))
    if (report.golden.plan.exactCount !== 3 || report.golden.plan.missingCount !== 1) throw new Error('Real Earth/Moon/Sun fixture must contain three exact states and one explicit gap')

    await certificates(temporary)
    const snapshot = JSON.parse(await command('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
    report.simulator = selectSimulatorTemplate(snapshot)
    const created = await command('xcrun', ['simctl', 'create', `Solar native smoke ${Date.now()}`, report.simulator.deviceType, report.simulator.runtime])
    if (!uuidPattern.test(created)) throw new Error('simctl did not return an owned simulator UUID')
    device = created
    report.simulator.udid = device
    await bootOwnedSimulator(device, artifact, report)
    await command('xcrun', ['simctl', 'keychain', device, 'add-root-cert', join(temporary, 'root.crt')])

    await assertFreePort(18790)
    const backendLog = createWriteStream(join(artifact, 'backend.log'), { flags: 'wx' })
    backend = spawn(join(temporary, 'solar-backend'), ['-data-dir', join(temporary, 'data'), '-listen', '127.0.0.1:18790'], { stdio: ['ignore', 'pipe', 'pipe'] })
    backend.once('error', error => { backend.spawnFailure = error })
    backend.stdout.pipe(backendLog, { end: false }); backend.stderr.pipe(backendLog, { end: false })
    backend.once('close', () => backendLog.end())
    await waitForBackend(backend, report.profile.manifestSha256)
    proxy = https.createServer({ key: await readFile(join(temporary, 'server.key')), cert: await readFile(join(temporary, 'server.crt')) }, (request, response) => {
      const upstream = http.request({ hostname: '127.0.0.1', port: 18790, path: request.url, method: request.method, headers: request.headers }, incoming => {
        const row = { method: request.method, path: request.url, status: incoming.statusCode, bytes: 0 }
        traffic.push(row)
        response.writeHead(incoming.statusCode, incoming.headers)
        incoming.on('data', bytes => { row.bytes += bytes.length })
        incoming.pipe(response)
      })
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() })
      upstream.setTimeout(30_000, () => upstream.destroy())
      response.on('close', () => upstream.destroy())
      request.pipe(upstream)
    })
    // Use the IPv4 URL in the app and certificate to keep the listener local
    // without depending on the simulator's localhost resolution order.
    await new Promise((resolvePromise, reject) => { proxy.once('error', reject); proxy.listen(18791, '127.0.0.1', resolvePromise) })
    await command('xcodebuild', testArguments(device, join(artifact, 'Observation.xcresult')),
      { log: join(artifact, 'xcode-test.log'), timeout: 12 * 60_000 })
    verifyTraffic(traffic)
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'; report.error = error.message
    throw error
  } finally {
    proxy?.closeAllConnections()
    if (proxy?.listening) await new Promise(resolvePromise => proxy.close(resolvePromise))
    if (backend && backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise(resolvePromise => {
        const timer = setTimeout(() => { backend.kill('SIGKILL'); resolvePromise() }, 5000)
        backend.once('close', () => { clearTimeout(timer); resolvePromise() })
      })
    }
    if (device) {
      await command('xcrun', ['simctl', 'shutdown', device]).catch(error => { report.shutdownError = error.message })
      await command('xcrun', ['simctl', 'delete', device]).catch(error => { report.cleanupError = error.message })
    }
    // Private keys never enter artifacts, repository data, or the host keychain.
    await Promise.all(['root.key', 'server.key'].map(name => rm(join(temporary, name), { force: true })))
    report.traffic = traffic
    await removeOwnedTemporary(temporary).catch(error => { report.temporaryCleanupError = error.message })
    if (report.cleanupError || report.temporaryCleanupError) report.status = 'failed'
    await writeFile(join(artifact, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  }
  if (report.cleanupError || report.temporaryCleanupError) throw new Error('Native smoke cleanup failed; inspect report.json')
  console.log(`Native HTTPS simulator smoke passed; evidence: ${artifact}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await nativeSmoke()
