import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { evaluatePckLimb } from '../../scripts/evaluate-pck-limb.mjs'

it('exports source-backed oriented Phobos limbs without overwriting existing reports or guessing absent IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-pck-limb-'))
  try {
    const output = join(directory, 'limb.json')
    const report = await evaluatePckLimb(401, 843523200, [100, 200, 300], output)
    const original = await readFile(output, 'utf8')
    expect(JSON.parse(original)).toEqual(report)
    expect(report.shape.representation).toBe('triaxial-ellipsoid')
    expect(report.limb.generatorsJ2000Km).toHaveLength(2)
    expect(Object.keys(report.implementationSha256)).toHaveLength(3)
    await expect(evaluatePckLimb(401, 0, [100, 200, 300], output)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(output, 'utf8')).toBe(original)
    await expect(evaluatePckLimb(123456, 0, [100, 200, 300], join(directory, 'absent.json'))).rejects.toThrow('Exact PCK ID')
    await expect(evaluatePckLimb(401, 0, [0, 0, 0], join(directory, 'internal.json'))).rejects.toThrow('outside')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
