import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { findOccultationFile } from '../../scripts/find-occultation-contacts.mjs'
import reference from '../fixtures/occultation-contacts-reference.json'
import example from '../../src/data/venus-transit-contact-example.json'

test('offline contact receipt retains sources, numerical brackets and limitations without overwriting output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-contacts-')), output = join(directory, 'result.json')
  const input = 'src/data/venus-transit-contact-example.json'
  await findOccultationFile(input, output)
  const bytes = await readFile(output, 'utf8'), receipt = JSON.parse(bytes)
  expect(receipt.inputFile.sha256).toBe(createHash('sha256').update(await readFile(input)).digest('hex'))
  expect(receipt.inputFile.payload).toEqual(example)
  expect(receipt.physicalTimingUncertaintySeconds).toBeNull()
  expect(receipt.possibleMissedEvents).toBe(true)
  expect(receipt.ephemeris.aberration).toBe('NONE')
  expect(receipt.shapes.foreground.radiiKm).toEqual([6051.8, 6051.8, 6051.8])
  expect(receipt.contacts).toHaveLength(4)
  for (let i = 0; i < 4; i++) expect(Math.abs(receipt.contacts[i].elapsedTdbSeconds-reference.cases[0].contacts[i].elapsedTdbSeconds)).toBeLessThan(.02)
  for (const [path, hash] of Object.entries(receipt.implementationSha256)) expect(hash).toBe(createHash('sha256').update(await readFile(path)).digest('hex'))
  await expect(findOccultationFile(input, output)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(output, 'utf8')).toBe(bytes)
  const rejected = join(directory, 'rejected.json'), badInput = join(directory, 'unsupported.json')
  await writeFile(badInput, JSON.stringify({ ...example, foregroundId: 499 }))
  await expect(findOccultationFile(badInput, rejected)).rejects.toThrow('triaxial')
  await expect(findOccultationFile(input, rejected, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  await expect(readFile(rejected)).rejects.toMatchObject({ code: 'ENOENT' })
})
