import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, open, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { inventoryKernels } from '../../scripts/lib/inventory-kernels.mjs'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

it('bounds concurrent reads, preserves manifest precedence, and still rejects corrupt coefficients', async () => {
  const root = await mkdtemp(join(tmpdir(), 'solar-inventory-loading-'))
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const original = actual.open
  try {
    await mkdir(join(root, 'src/data'), { recursive: true })
    await mkdir(join(root, 'public/data/ephemerides'), { recursive: true })
    const bytes = await actual.readFile('tests/fixtures/jup347-himalia-join.bsp')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const files = Array.from({ length: 8 }, (_, index) => ({ id: `file-${index}`, path: `file-${index}.bsp`, bytes: bytes.length, sha256 }))
    await writeFile(join(root, 'src/data/ephemeris-manifest.json'), JSON.stringify({ schemaVersion: 1, profile: 'pages', id: 'test-order', files }))
    await writeFile(join(root, 'src/data/ephemerisBodies.json'), JSON.stringify({ bodies: [] }))
    await writeFile(join(root, 'src/data/satelliteCatalog.json'), JSON.stringify({ bodies: [] }))
    await Promise.all(files.map(file => writeFile(join(root, 'public/data/ephemerides', file.path), bytes)))
    let active = 0, peak = 0
    let releaseFirst!: () => void
    const secondFinished = new Promise<void>(resolve => { releaseFirst = resolve })
    const finished: string[] = []
    vi.mocked(open).mockImplementation(async (...args: Parameters<typeof original>) => {
      const path = String(args[0])
      const handle = await original(...args)
      if (!path.endsWith('.bsp')) return handle
      active++
      peak = Math.max(peak, active)
      const read = handle.read.bind(handle), close = handle.close.bind(handle)
      handle.read = (async (...readArgs: Parameters<typeof read>) => {
        if (path.endsWith('file-0.bsp')) await secondFinished
        return read(...readArgs)
      }) as typeof handle.read
      handle.close = async () => {
        await close()
        finished.push(path)
        if (path.endsWith('file-1.bsp')) releaseFirst()
        active--
      }
      return handle
    })
    const audit = await inventoryKernels(root, 755524800)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
    expect(finished.indexOf(join(root, 'public/data/ephemerides/file-1.bsp'))).toBeLessThan(finished.indexOf(join(root, 'public/data/ephemerides/file-0.bsp')))
    const record = audit.attach({ id: 'naif:506', category: 'moon' })
    expect(record.kernelEvidence.segments.map((segment: { kernelId: string }) => segment.kernelId)).toEqual(files.flatMap(file => [file.id, file.id]))
    // Same size, different bytes: the SHA check remains necessary and enforced.
    await writeFile(join(root, 'public/data/ephemerides/file-0.bsp'), Buffer.alloc(bytes.length))
    vi.mocked(open).mockImplementation(original)
    await expect(inventoryKernels(root, 755524800)).rejects.toThrow('Bundled kernel integrity mismatch: file-0')
  } finally {
    vi.mocked(open).mockImplementation(original)
    await rm(root, { recursive: true, force: true })
  }
})
