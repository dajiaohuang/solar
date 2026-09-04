import { describe, expect, it } from 'vitest'
import evidence from '../fixtures/makemake-primary-availability.json'

describe('Makemake primary-center availability evidence', () => {
  it('keeps the unresolved identity and data-gated decision explicit', () => {
    expect(evidence.requiredIdentity).toMatchObject({
      designation: '136472',
      systemBarycenter: 20136472,
      primaryCenter: 920136472,
      timeScale: 'TDB',
    })
    expect(evidence.horizons.lookup.result).toMatchObject({
      name: '136472 Makemake',
      type: 'asteroid (integrated barycenter)',
      spkid: '20136472',
    })
    expect(evidence.horizons.directSpk.acceptedAsPrimaryCenter).toBe(false)
    expect(evidence.naif.summaryContainsMakemake).toBe(false)
    expect(evidence.decision).toContain('No public source currently supplies the Makemake primary offset')
  })
})
