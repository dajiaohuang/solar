import { describe, expect, it } from 'vitest'
import { markdownAnchors, markdownLinks, validateRepository } from '../../scripts/validate-repository.mjs'
import { pullRequestQualityPasses, requiresFullWebQuality } from '../../scripts/pr-quality-contract.mjs'

describe('repository contract', () => {
  it('extracts local destinations without treating code examples as links', () => {
    const markdown = '[Guide](./GUIDE.md#setup)\n`[ignored](./missing.md)`\n```md\n[ignored](./missing.md)\n```\n'
    expect(markdownLinks(markdown)).toEqual(['./GUIDE.md#setup'])
  })

  it('uses GitHub-style heading anchors and disambiguates repeats', () => {
    expect([...markdownAnchors('# Quality gate\n## Quality gate\n## 科学模型与边界\n')]).toEqual([
      'quality-gate',
      'quality-gate-1',
      '科学模型与边界',
    ])
  })

  it('keeps documentation links and release identities synchronized', () => {
    expect(validateRepository()).toMatchObject({
      name: 'solar',
      version: '0.11.0',
      appId: 'io.github.dajiaohuang.solaratlas',
    })
  })

  it('runs the full suite for product and workflow changes, but not documentation-only changes', () => {
    expect(requiresFullWebQuality(['README.md', 'docs/screenshots/deck.png', 'CITATION.cff'])).toBe(false)
    expect(requiresFullWebQuality(['README.md', 'src/App.tsx'])).toBe(true)
    expect(requiresFullWebQuality(['.github/workflows/pull-request-quality.yml'])).toBe(true)
  })

  it('passes the stable summary only for successful required work', () => {
    expect(pullRequestQualityPasses('success', 'success')).toBe(true)
    expect(pullRequestQualityPasses('success', 'skipped')).toBe(true)
    expect(pullRequestQualityPasses('failure', 'skipped')).toBe(false)
    expect(pullRequestQualityPasses('success', 'failure')).toBe(false)
    expect(pullRequestQualityPasses('success', 'cancelled')).toBe(false)
  })
})
