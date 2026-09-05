import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stageBackendProfile } from '../../scripts/stage-backend-profile.mjs'

describe('standalone backend profile staging', () => {
  it('publishes verified files without overwriting an existing profile or accepting corrupt sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'solar-profile-stage-'))
    try {
      await mkdir(join(root, 'src/data'), { recursive: true })
      await mkdir(join(root, 'public/data/ephemerides'), { recursive: true })
      const bytes = Buffer.from('staging fixture; not an SPK physics oracle')
      const file = { path: 'fixture.bsp', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      const manifest = JSON.stringify({ files: [file] })
      await writeFile(join(root, 'public/data/ephemerides/fixture.bsp'), bytes)
      await writeFile(join(root, 'src/data/ephemerisBodies.json'), '{}')
      await writeFile(join(root, 'src/data/ephemeris-manifest-full.json'), manifest)
      const output = join(root, 'prepared')
      expect(await stageBackendProfile({ root, output })).toMatchObject({ files: 1, bytes: bytes.length })
      expect(await readFile(join(output, 'fixture.bsp'))).toEqual(bytes)
      expect(await readFile(join(output, 'ephemeris-manifest.json'), 'utf8')).toBe(manifest)
      await expect(stageBackendProfile({ root, output })).rejects.toMatchObject({ code: 'EEXIST' })
      await writeFile(join(root, 'src/data/ephemeris-manifest-full.json'), JSON.stringify({ files: [{ ...file, sha256: '0'.repeat(64) }] }))
      await expect(stageBackendProfile({ root, output: join(root, 'corrupt') })).rejects.toThrow('checksum mismatch')
      await expect(access(join(root, 'corrupt'))).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(join(root, 'src/data/ephemeris-manifest-full.json'), JSON.stringify({ files: [{ ...file, path: '../fixture.bsp' }] }))
      await expect(stageBackendProfile({ root, output: join(root, 'traversal') })).rejects.toThrow('Invalid kernel manifest')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
