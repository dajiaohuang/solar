import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const run = (script: string, args: string[]) => spawnSync(process.execPath, [resolve('scripts', script), ...args], { encoding: 'utf8', timeout: 10_000 })

describe('explicit source tooling guards', () => {
  it.each(['http://naif.jpl.nasa.gov/source.bsp', 'https://example.com/source.bsp', 'https://user:pass@naif.jpl.nasa.gov/source.bsp'])('rejects an unapproved source before creating output: %s', url => {
    const result = run('archive-spk-source.mjs', [url, 'unused-source-output'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Explicit official HTTPS SPK URL required')
  })

  it('refuses an existing archive before any network retrieval', () => {
    const directory = mkdtempSync(join(tmpdir(), 'solar-source-guard-'))
    try {
      const result = run('archive-spk-source.mjs', ['https://naif.jpl.nasa.gov/source.bsp', directory])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('EEXIST')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('does not replace unrelated JSON or start an oracle for it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'solar-reference-guard-'))
    const file = join(directory, 'unrelated.json')
    const original = '{"note":"keep this file"}\n'
    writeFileSync(file, original)
    try {
      const result = run('reference/record-satellite-pools.mjs', ['--replace-generated', file, 'must-not-run'])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Refusing to replace an unrelated reference file')
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
