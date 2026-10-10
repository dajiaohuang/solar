import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDocumentedVersion, iosApplicationIdentity, markdownAnchors, markdownLinks, validateRepository } from '../../scripts/validate-repository.mjs'
import { changedPaths, pullRequestQualityPasses, requiresBackendQuality, requiresFullWebQuality, requiresNativeQuality } from '../../scripts/pr-quality-contract.mjs'

describe('repository contract', () => {
  it('extracts local destinations without treating code examples as links', () => {
    const markdown = '[Guide](./GUIDE.md#setup "title [ignored](./missing.md)")\n[diagram](./orbit_(3d).png)\n`[ignored](./missing.md)`\n<!-- [ignored](./missing-comment.md) -->\n````md\n[ignored](./missing.md)\n```\nstill fenced\n````\n'
    expect(markdownLinks(markdown)).toEqual(['./GUIDE.md#setup', './orbit_(3d).png'])
  })

  it('does not accept a backtick fence whose info string contains a backtick', () => {
    const markdown = '```bad`info\n[visible](./missing.md)\n```\n'
    expect(markdownLinks(markdown)).toEqual(['./missing.md'])
  })

  it('keeps odd-backslash escaped HTML comments visible and strips even ones', () => {
    expect(markdownLinks('\\<!-- [visible](./missing.md) -->')).toEqual(['./missing.md'])
    expect(markdownLinks('\\\\<!-- [ignored](./missing.md) -->')).toEqual([])
  })

  it('uses GitHub-style heading anchors and disambiguates repeats', () => {
    expect([...markdownAnchors('# Quality gate\n## Quality gate\n## Run `npm run build` now\n## 科学模型与边界\n')]).toEqual([
      'quality-gate',
      'quality-gate-1',
      'run-npm-run-build-now',
      '科学模型与边界',
    ])
  })

  it('requires one correct canonical README version line instead of an incidental match', () => {
    const staleCanonical = 'Application version: **v0.10.0** · [Health](./health.json)\n\nExample text containing Application version: **v0.11.0** elsewhere.\n'
    expect(() => assertDocumentedVersion(staleCanonical, '0.11.0', 'en')).toThrow(/does not match/)
    expect(() => assertDocumentedVersion('Application version: **v0.11.0**\nApplication version: **v0.11.0**\n', '0.11.0', 'en')).toThrow(/exactly one/)
    const misplacedCanonical = '# Solar Atlas\n\n## Version history\n\nApplication version: **v0.11.0**\n'
    expect(() => assertDocumentedVersion(misplacedCanonical, '0.11.0', 'en')).toThrow(/opening metadata block/)
    const fencedCanonical = '# Solar Atlas\n\n````text\nApplication version: **v0.11.0**\n````\n'
    expect(() => assertDocumentedVersion(fencedCanonical, '0.11.0', 'en')).toThrow(/exactly one/)
    const commentedCanonical = '# Solar Atlas\n\n<!-- Application version: **v0.11.0** -->\n'
    expect(() => assertDocumentedVersion(commentedCanonical, '0.11.0', 'en')).toThrow(/exactly one/)
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

  it('runs native validation for native consumers and shared transport changes', () => {
    expect(requiresNativeQuality(['README.md', 'docs/screenshots/deck.png'])).toBe(false)
    for (const path of ['src/App.tsx', 'go.mod', 'go.sum', 'tests/fixtures/spk21-synthetic.bsp', 'tsconfig.app.json']) {
      expect(requiresNativeQuality([path])).toBe(false)
    }
    for (const path of ['cmd/state-tile-fixture/main.go', 'internal/statewire/tile.go', 'internal/httpapi/tiles.go', 'tests/unit/state-tiles-golden.test.ts']) {
      expect(requiresNativeQuality([path])).toBe(true)
    }
    expect(requiresNativeQuality(['android/app/build.gradle'])).toBe(true)
    expect(requiresNativeQuality(['ios/App/App.xcodeproj/project.pbxproj'])).toBe(true)
    expect(requiresNativeQuality(['.github/workflows/mobile.yml'])).toBe(true)
    expect(requiresNativeQuality(['.github/workflows/pull-request-quality.yml'])).toBe(true)
  })

  it('runs Go checks for backend changes without treating frontend edits as native changes', () => {
    for (const path of ['cmd/solar-backend/main.go', 'internal/catalog/catalog.go', 'go.mod', 'go.sum']) {
      expect(requiresBackendQuality([path])).toBe(true)
    }
    expect(requiresBackendQuality(['src/App.tsx', 'README.md'])).toBe(false)
  })

  it('classifies both sides of a code-to-document rename', () => {
    const repository = mkdtempSync(join(tmpdir(), 'solar-pr-quality-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, stdio: 'ignore' })
    try {
      git('init')
      git('config', 'user.name', 'Quality test')
      git('config', 'user.email', 'quality@example.invalid')
      mkdirSync(join(repository, 'src'))
      writeFileSync(join(repository, 'src', 'view.tsx'), 'export const view = true\n')
      git('add', '.')
      git('commit', '-m', 'add source')
      mkdirSync(join(repository, 'docs'))
      renameSync(join(repository, 'src', 'view.tsx'), join(repository, 'docs', 'view.md'))
      git('add', '-A')
      git('commit', '-m', 'rename source to docs')

      const paths = changedPaths('HEAD^', 'HEAD', repository)
      expect(paths).toEqual(['docs/view.md', 'src/view.tsx'])
      expect(requiresFullWebQuality(paths)).toBe(true)
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })

  it('checks every application configuration without confusing the UI-test bundle with the app', () => {
    const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
    expect(iosApplicationIdentity(project)).toEqual({ ids: ['io.github.dajiaohuang.solaratlas', 'io.github.dajiaohuang.solaratlas'], versions: ['0.11.0', '0.11.0'] })
    const changedApp = project.replace('PRODUCT_BUNDLE_IDENTIFIER = io.github.dajiaohuang.solaratlas;', 'PRODUCT_BUNDLE_IDENTIFIER = wrong.app;')
    expect(iosApplicationIdentity(changedApp).ids).toContain('wrong.app')
    const changedTest = project.replaceAll('io.github.dajiaohuang.solaratlas.ObservationUITests', 'different.test.bundle')
    expect(iosApplicationIdentity(changedTest)).toEqual(iosApplicationIdentity(project))
    expect(() => iosApplicationIdentity(project.replace('productType = "com.apple.product-type.application";', 'productType = "invalid";'))).toThrow('one native iOS application')
  })


  it('passes the stable summary only for successful required work', () => {
    expect(pullRequestQualityPasses('success', 'success', 'success', 'success')).toBe(true)
    expect(pullRequestQualityPasses('success', 'skipped', 'skipped', 'skipped')).toBe(true)
    expect(pullRequestQualityPasses('failure', 'skipped', 'skipped', 'skipped')).toBe(false)
    expect(pullRequestQualityPasses('success', 'failure', 'success', 'success')).toBe(false)
    expect(pullRequestQualityPasses('success', 'cancelled', 'success', 'success')).toBe(false)
    expect(pullRequestQualityPasses('success', 'success', 'failure', 'success')).toBe(false)
    expect(pullRequestQualityPasses('success', 'success', 'cancelled', 'success')).toBe(false)
    for (const browserResult of ['failure', 'cancelled', undefined]) {
      expect(pullRequestQualityPasses('success', 'success', 'success', browserResult)).toBe(false)
    }
  })

})
