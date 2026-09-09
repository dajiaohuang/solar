import { describe, expect, it } from 'vitest'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeOwnedAndroidTemporary, validateEmulatorIdentity, verifyInstrumentation } from '../../scripts/android-native-smoke.mjs'

describe('isolated Android real-data smoke guards', () => {
  it('runs each native harness only on its matching platform job', () => {
    const workflow = parse(readFileSync('.github/workflows/mobile.yml', 'utf8'))
    const scripts = (job: string) => workflow.jobs[job].steps.map((step: { run?: string }) => step.run ?? '').join('\n')
    expect(scripts('android')).toContain('node scripts/android-native-smoke.mjs')
    expect(scripts('android')).not.toContain('node scripts/ios-native-smoke.mjs')
    expect(scripts('ios')).toContain('node scripts/ios-native-smoke.mjs')
    expect(scripts('ios')).not.toContain('node scripts/android-native-smoke.mjs')
  })
  it('requires an actual successful test, not adb shell success', () => {
    expect(() => verifyInstrumentation('Time: 42\nOK (1 test)\nINSTRUMENTATION_CODE: -1')).not.toThrow()
    for (const output of ['', 'OK (0 tests)', 'FAILURES!!!\nOK (1 test)', 'Process crashed', 'INSTRUMENTATION_FAILED: missing runner']) {
      expect(() => verifyInstrumentation(output)).toThrow()
    }
  })
  it('refuses existing or unidentified devices', () => {
    expect(() => validateEmulatorIdentity('emulator-5580', 'solar_smoke_123\r\nOK', 'solar_smoke_123')).not.toThrow()
    for (const [serial, actual, expected] of [
      ['physical-device', 'solar_smoke_123', 'solar_smoke_123'],
      ['emulator-5580', 'personal-device', 'solar_smoke_123'],
      ['emulator-5580', 'personal-device', 'personal-device'],
    ]) expect(() => validateEmulatorIdentity(serial, actual, expected)).toThrow()
  })
  it('only removes an owned temporary child, never the temp root', async () => {
    await expect(removeOwnedAndroidTemporary(tmpdir())).rejects.toThrow('Refusing cleanup')
    const directory = await mkdtemp(join(tmpdir(), 'solar-android-smoke-'))
    await writeFile(join(directory, 'generated-fixture.txt'), 'fixture')
    await removeOwnedAndroidTemporary(directory)
    await expect(access(directory)).rejects.toThrow()
  })
})
