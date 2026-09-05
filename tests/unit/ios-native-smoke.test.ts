import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootOwnedSimulator, command, removeOwnedTemporary, selectSimulatorTemplate, testArguments, verifyPointPixelEvidence, verifyTraffic } from '../../scripts/ios-native-smoke.mjs'

const iphone = { isAvailable: true, name: 'iPhone 17', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }

describe('isolated native iOS runtime validation', () => {
  it('flushes the full log before returning a bounded in-memory tail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solar-ios-smoke-'))
    const log = join(directory, 'command.log')
    const expected = `early-measurement\n${'x'.repeat(256 * 1024)}\nlast-measurement\n`
    try {
      const tail = await command(process.execPath, ['-e', 'process.stdout.write("early-measurement\\n"+"x".repeat(256*1024)+"\\nlast-measurement\\n")'], { log })
      expect(tail.length).toBeLessThanOrEqual(16_384)
      expect(tail).not.toContain('early-measurement')
      expect(tail).toContain('last-measurement')
      expect(readFileSync(log, 'utf8')).toBe(expected)
    } finally { await removeOwnedTemporary(directory) }
  })

  it('waits for the same owned cold device with a bounded budget and retained boot evidence', async () => {
    const device = '12345678-1234-1234-1234-123456789abc'
    const run = vi.fn().mockResolvedValue('ready')
    const report = {} as { boot: { status: string; timeoutMs: number; elapsedMs: number } }
    await bootOwnedSimulator(device, 'artifacts', report, run)
    expect(run.mock.calls).toEqual([
      ['xcrun', ['simctl', 'boot', device]],
      ['xcrun', ['simctl', 'bootstatus', device, '-b'],
        { timeout: 600_000, log: join('artifacts', 'simulator-boot.log') }],
    ])
    expect(report.boot).toMatchObject({ status: 'passed', timeoutMs: 600_000 })
    expect(report.boot.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('fails closed on boot timeout without retrying or creating another simulator', async () => {
    const failure = new Error('xcrun timed out during data migration')
    const run = vi.fn().mockResolvedValueOnce('').mockRejectedValueOnce(failure)
    const report = {}
    await expect(bootOwnedSimulator('12345678-1234-1234-1234-123456789abc', 'artifacts', report, run)).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(2)
    expect(report).toMatchObject({ boot: { status: 'failed', error: failure.message } })
    run.mockClear()
    await expect(bootOwnedSimulator('booted', 'artifacts', {}, run)).rejects.toThrow('Invalid owned')
    expect(run).not.toHaveBeenCalled()
  })

  it('cleans only a validated task-owned temporary directory, never the temp root', async () => {
    await expect(removeOwnedTemporary(tmpdir())).rejects.toThrow('Refusing cleanup')
    const directory = await mkdtemp(join(tmpdir(), 'solar-ios-smoke-'))
    await writeFile(join(directory, 'generated-fixture.txt'), 'fixture')
    await removeOwnedTemporary(directory)
    await expect(access(directory)).rejects.toThrow()
  })
  it('selects an available iPhone template from the newest installed iOS runtime', () => {
    const selected = selectSimulatorTemplate({ devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-9-0': [iphone],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [iphone],
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ ...iphone, isAvailable: false }],
      'com.apple.CoreSimulator.SimRuntime.tvOS-28-0': [iphone],
    } })
    expect(selected.runtime).toBe('com.apple.CoreSimulator.SimRuntime.iOS-26-0')
    expect(() => selectSimulatorTemplate({ devices: {} })).toThrow('cannot be skipped')
  })

  it('pins tests to one explicitly owned device and rejects broad simulator targets', () => {
    const device = '12345678-1234-1234-1234-123456789abc'
    const args = testArguments(device, '/tmp/result.xcresult')
    expect(args).toContain(`platform=iOS Simulator,id=${device}`)
    expect(args).toContain('-parallel-testing-enabled')
    expect(args).toContain('test')
    expect(args).toContain('-only-testing:ObservationUITests/ObservationUITests')
    expect(args).toContain('-only-testing:ObservationUITests/NativePointGeometryTests')
    for (const invalid of ['booted', 'all', '', '../device']) expect(() => testArguments(invalid, '/tmp/result')).toThrow()
  })

  it('requires measured pixels and a working perspective negative control, not just green xcodebuild', () => {
    const rows = [256, 512, 768].flatMap(viewport => [16, 160, 1600].map(distance =>
      ({ viewport, distance, width: 4, height: 4, brightCount: 16, peak: 255, totalLight: 4080 })))
    rows.push({ viewport: 256, distance: 16, width: 50, height: 50, brightCount: 2500, peak: 255, totalLight: 637500 },
      { viewport: 256, distance: 1600, width: 1, height: 1, brightCount: 1, peak: 255, totalLight: 255 })
    const log = (value: unknown) => `SOLAR_POINT_PIXELS ${JSON.stringify(value)}\n`
    expect(verifyPointPixelEvidence(log(rows))).toMatchObject({ status: 'passed', measurements: rows })
    expect(() => verifyPointPixelEvidence('TEST SUCCEEDED')).toThrow()
    expect(() => verifyPointPixelEvidence(log(rows) + log(rows))).toThrow()
    expect(() => verifyPointPixelEvidence(log(rows.slice(0, 9)))).toThrow()
    for (const change of [{ width: 0 }, { width: 2 }, { peak: 230 }, { totalLight: 1800 },
      { brightCount: 3 }, { distance: 16 }, { viewport: 255 }, { peak: null }]) {
      const bad = structuredClone(rows); Object.assign(bad[2], change)
      expect(() => verifyPointPixelEvidence(log(bad))).toThrow()
    }
    const ineffective = structuredClone(rows); ineffective[9].width = 4; ineffective[9].brightCount = 1
    expect(() => verifyPointPixelEvidence(log(ineffective))).toThrow('negative control')
  })

  it('requires real online traffic and proves cached tile reuse rather than two downloads', () => {
    const row = (path: string) => ({ path: `/v1/${path}`, status: 200 })
    const traffic = [row('catalog/manifest'), row('state/plan'), row('state/tiles'), row('catalog/manifest'), row('state/plan')]
    expect(() => verifyTraffic(traffic)).not.toThrow()
    expect(() => verifyTraffic([])).toThrow()
    expect(() => verifyTraffic([...traffic, row('state/tiles')])).toThrow()
    expect(() => verifyTraffic([...traffic, { path: '/v1/state/tiles', status: 500 }])).toThrow()
  })

  it('runs actual native UI tests without weakening production transport security', () => {
    const workflow = readFileSync('.github/workflows/mobile.yml', 'utf8')
    const service = readFileSync('ios/App/App/StateTileService.swift', 'utf8')
    const uiTests = readFileSync('ios/App/ObservationUITests/ObservationUITests.swift', 'utf8')
    expect(workflow).toContain('run: node scripts/ios-native-smoke.mjs')
    expect(workflow).toContain('name: solar-atlas-ios-native-smoke')
    expect(service).toContain('base.scheme == "https"')
    expect(service).not.toMatch(/serverTrust|URLProtocol|#if DEBUG/)
    expect(uiTests).toContain('https://127.0.0.1:18791')
    expect(uiTests).toContain('3 verified states · 0 data gaps')
    expect(uiTests).toContain('XCUIDevice.shared.press(.home)')
  })
})
