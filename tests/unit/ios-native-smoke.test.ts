import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootOwnedSimulator, removeOwnedTemporary, selectSimulatorTemplate, testArguments, verifyTraffic } from '../../scripts/ios-native-smoke.mjs'

const iphone = { isAvailable: true, name: 'iPhone 17', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }

describe('isolated native iOS runtime validation', () => {
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
    for (const invalid of ['booted', 'all', '', '../device']) expect(() => testArguments(invalid, '/tmp/result')).toThrow()
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
