import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { evaluatePckOrientation } from '../../scripts/evaluate-pck-orientation.mjs'

it('writes a source-bearing orientation and preserves an existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-pck-orientation-'))
  try {
    const output = join(directory, 'result.json')
    const report = await evaluatePckOrientation(401, 843523200, output)
    const original = await readFile(output, 'utf8')
    expect(JSON.parse(original)).toEqual(report)
    expect(report.orientation.j2000ToBodyFixed).toHaveLength(9)
    expect(report.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.keys(report.implementationSha256)).toHaveLength(2)
    await expect(evaluatePckOrientation(499, 0, output)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(output, 'utf8')).toBe(original)
    await expect(evaluatePckOrientation(123456, 0, join(directory, 'missing.json'))).rejects.toThrow('No orientation model')
    await expect(evaluatePckOrientation(499, Infinity, join(directory, 'invalid.json'))).rejects.toThrow('TDB seconds')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
