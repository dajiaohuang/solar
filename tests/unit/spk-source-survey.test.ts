import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSource } from '../../scripts/crop-spk.mjs'
import { classifySatelliteAssignments, classifySatelliteSource, decodeDafComments, locateSatelliteSource, replaySpkSurvey, satelliteDirectoryUrls, surveySpkSource } from '../../scripts/lib/spk-source-survey.mjs'

const root = 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/'
describe('satellite SPK source survey', () => {
  it('reports every alternative without choosing the first source implicitly', () => {
    const assignments = [{ ephemeris: 'OLD', reference: 'old' }, { ephemeris: 'NEW', reference: 'new' }]
    const body = { naifId: 715, name: 'Puck', ...assignments[0], sourceAssignments: assignments }
    const surveys = new Map([['NEW', { segments: [{ target: 715, center: 7, frame: 1, type: 2, startEt: 0, endEt: 100 }] }]])
    const result = classifySatelliteAssignments(body, surveys, 10, 20)
    expect(result.status).toBe('source-selection-required')
    expect(result).not.toHaveProperty('ephemeris')
    expect(result.classifications.map(item => [item.ephemeris, item.status])).toEqual([
      ['OLD', 'source-unavailable'], ['NEW', 'supported-window-descriptors'],
    ])
    const reversed = classifySatelliteAssignments({ ...body, sourceAssignments: [...assignments].reverse() }, surveys, 10, 20)
    expect(reversed.status).toBe(result.status)
    expect(reversed.classifications).toEqual([...result.classifications].reverse())
  })
  it('decodes DAF lines across physical records without injecting padding into names', () => {
    const bytes = Buffer.alloc(2048)
    bytes.fill(65, 0, 998)
    bytes.write('Hi', 998)
    bytes.fill(255, 1000, 1024) // Physical padding is not part of a comment.
    bytes.write('malia\0End\0\x04', 1024, 'ascii')
    expect(decodeDafComments(bytes)).toBe(`${'A'.repeat(998)}Himalia\nEnd\n`)
    expect(decodeDafComments(Buffer.alloc(1024))).toBe('')
    expect(() => decodeDafComments(Buffer.alloc(1024, 65))).toThrow('marker')
    expect(() => decodeDafComments(Buffer.alloc(5))).toThrow('record')
  })
  it('reads actual descriptors without pretending it validated a trajectory', async () => {
    const path = 'tests/fixtures/spk21-horizons-makemake.bsp'
    const source = await openSource(path)
    try {
      const survey = await surveySpkSource(source)
      expect(survey.targets).toEqual([20136472])
      expect(survey.segments[0]).toMatchObject({ target: 20136472, center: 10, frame: 1, type: 21 })
      expect(survey.stateValidation).toContain('not-evaluated')
      expect(survey.reads.reduce((sum, read) => sum + read.length, 0)).toBeLessThan((await readFile(path)).length)
      expect(survey.reads.every(read => /^[a-f0-9]{64}$/.test(read.sha256))).toBe(true)
    } finally { await source.close() }
  })
  it('repairs only a same-filename link verified in the public directory', () => {
    const files = satelliteDirectoryUrls('<a href="sat458.bsp">x</a><a href="../bad.bsp">bad</a>')
    expect(files).toEqual([`${root}sat458.bsp`])
    expect(locateSatelliteSource('https://ssd.jpl.nasa.gov/home/sat/sat458.bsp', files)).toMatchObject({ url: files[0], reason: 'same-filename-in-verified-public-directory' })
    expect(locateSatelliteSource(`${root}missing.bsp`, files).url).toBeNull()
    expect(locateSatelliteSource('https://example.com/sat458.bsp', files).url).toBeNull()
    expect(locateSatelliteSource('file:///home/sat458.bsp', files).url).toBeNull()
    expect(() => satelliteDirectoryUrls('<a href="other.txt">x</a>')).toThrow()
  })
  it('replays retained original ranges offline and rejects corruption or changed descriptors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solar-spk-survey-'))
    const source = await openSource('tests/fixtures/spk21-horizons-makemake.bsp')
    try {
      const record = await surveySpkSource(source, (start, bytes) => writeFile(join(directory, `test-range-${start}.bin`), bytes))
      expect((await replaySpkSurvey(directory, 'test', record)).targets).toEqual(record.targets)
      await expect(replaySpkSurvey(directory, '../test', record)).rejects.toThrow('Unsafe')
      await expect(replaySpkSurvey(directory, 'test', { ...record, targets: [10] })).rejects.toThrow('replay mismatch')
      await writeFile(join(directory, 'test-range-0.bin'), Buffer.alloc(1024))
      await expect(replaySpkSurvey(directory, 'test', record)).rejects.toThrow('integrity mismatch')
    } finally {
      await source.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('keeps missing, unsupported and out-of-window data explicit', () => {
    const body = { naifId: 601, name: 'Mimas' }
    const segment = { target: 601, center: 6, startEt: 10, endEt: 30, type: 2, frame: 1 }
    expect(classifySatelliteSource(body, { segments: [] }, 12, 20).status).toBe('target-absent')
    expect(classifySatelliteSource(body, { segments: [segment] }, 12, 20).status).toBe('supported-window-descriptors')
    expect(classifySatelliteSource(body, { segments: [{ ...segment, type: 17 }] }, 12, 20).status).toBe('supported-window-descriptors')
    expect(classifySatelliteSource(body, { segments: [segment] }, 0, 20).status).toBe('partial-window-descriptors')
    expect(classifySatelliteSource(body, { segments: [segment] }, 31, 40).status).toBe('outside-requested-window')
    expect(classifySatelliteSource(body, { segments: [{ ...segment, type: 13 }] }, 12, 20).status).toBe('unsupported-format-in-window')
    expect(classifySatelliteSource(body, { segments: [segment, { ...segment, type: 13 }] }, 12, 20).status).toBe('unsupported-format-in-window')
    expect(classifySatelliteSource(body, { segments: [segment, { ...segment, startEt: 30, endEt: 50 }] }, 12, 40).status).toBe('supported-window-descriptors')
    expect(classifySatelliteSource(body, { segments: [segment, { ...segment, startEt: 31, endEt: 50 }] }, 12, 40).status).toBe('partial-window-descriptors')
    expect(() => classifySatelliteSource(body, { segments: [] }, NaN, 20)).toThrow()
  })
})
