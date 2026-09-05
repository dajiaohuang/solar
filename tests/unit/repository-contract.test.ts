import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { assertDocumentedVersion, markdownAnchors, markdownLinks, validateRepository } from '../../scripts/validate-repository.mjs'
import { changedPaths, pullRequestQualityPasses, requiresFullWebQuality, requiresNativeQuality } from '../../scripts/pr-quality-contract.mjs'

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

  it('runs native validation only for the existing mobile impact paths', () => {
    expect(requiresNativeQuality(['README.md', 'docs/screenshots/deck.png'])).toBe(false)
    expect(requiresNativeQuality(['src/App.tsx'])).toBe(true)
    for (const path of ['cmd/state-tile-fixture/main.go', 'internal/statewire/tile.go', 'go.mod', 'go.sum', 'tests/fixtures/spk21-synthetic.bsp', 'tests/unit/state-tiles-golden.test.ts']) {
      expect(requiresNativeQuality([path])).toBe(true)
    }
    expect(requiresNativeQuality(['android/app/build.gradle'])).toBe(true)
    expect(requiresNativeQuality(['ios/App/App.xcodeproj/project.pbxproj'])).toBe(true)
    expect(requiresNativeQuality(['tsconfig.app.json'])).toBe(true)
    expect(requiresNativeQuality(['.github/workflows/mobile.yml'])).toBe(true)
    expect(requiresNativeQuality(['.github/workflows/pull-request-quality.yml'])).toBe(true)
  })

  it('reuses the native workflow from the stable pull request gate', () => {
    const root = new URL('../../', import.meta.url)
    const mobile = parse(readFileSync(new URL('.github/workflows/mobile.yml', root), 'utf8'))
    const quality = parse(readFileSync(new URL('.github/workflows/pull-request-quality.yml', root), 'utf8'))

    expect(mobile.on).toHaveProperty('workflow_call')
    expect(mobile.on).not.toHaveProperty('pull_request')
    expect(quality.jobs.mobile_quality).toMatchObject({
      uses: './.github/workflows/mobile.yml',
      needs: 'repository_contract',
    })
    expect(quality.jobs.pull_request_quality_gate.needs).toEqual([
      'repository_contract',
      'web_quality',
      'mobile_quality',
    ])
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

  it('runs native consumers on Go-generated files without silently skipping golden checks', () => {
    const mobile = parse(readFileSync(new URL('../../.github/workflows/mobile.yml', import.meta.url), 'utf8'))
    for (const path of ['cmd/**', 'internal/**', 'go.mod', 'go.sum', 'tests/**']) {
      expect(mobile.on.push.paths).toContain(path)
    }
    for (const [job, consumer] of [['android', './gradlew lint'], ['ios', 'swiftc ios/']]) {
      const steps: { run?: string; env?: Record<string, string> }[] = mobile.jobs[job].steps
      const generated = steps.findIndex(step => step.run?.includes('go run ./cmd/state-tile-fixture'))
      const consumed = steps.findIndex(step => step.run?.includes(consumer))
      expect(generated).toBeGreaterThan(-1)
      expect(consumed).toBeGreaterThan(generated)
      expect(steps[generated].run).toContain('-tile-size 1')
      expect(steps[generated].run).toContain('npx vitest run tests/unit/state-tiles-golden.test.ts')
      expect(steps[generated].env?.SOLAR_STATE_TILE_FIXTURE_DIR).toBe('${{ runner.temp }}/solar-state-tile-fixture')
      expect(steps[consumed].env?.SOLAR_STATE_TILE_FIXTURE_DIR).toBe(steps[generated].env?.SOLAR_STATE_TILE_FIXTURE_DIR)
    }
  })

  it('activates the cached macOS Go toolchain before generating native fixtures', () => {
    const mobile = parse(readFileSync(new URL('../../.github/workflows/mobile.yml', import.meta.url), 'utf8'))
    const steps: { name?: string; run?: string }[] = mobile.jobs.ios.steps
    const activate = steps.findIndex(step => step.name === 'Activate runner-cached Go')
    const generate = steps.findIndex(step => step.run?.includes('go run ./cmd/state-tile-fixture'))
    expect(activate).toBeGreaterThan(-1)
    expect(activate).toBeLessThan(generate)
    expect(steps[activate].run).toContain('"$RUNNER_TOOL_CACHE"/go/*/"$go_arch"/bin')
    expect(steps[activate].run).toContain('"$GITHUB_PATH"')
    expect(steps[activate].run).toContain('"$go_bin/go" version')
    expect(steps[activate].run).toContain('exit 1')
  })

  it('passes the stable summary only for successful required work', () => {
    expect(pullRequestQualityPasses('success', 'success', 'success')).toBe(true)
    expect(pullRequestQualityPasses('success', 'skipped', 'skipped')).toBe(true)
    expect(pullRequestQualityPasses('failure', 'skipped', 'skipped')).toBe(false)
    expect(pullRequestQualityPasses('success', 'failure', 'success')).toBe(false)
    expect(pullRequestQualityPasses('success', 'cancelled', 'success')).toBe(false)
    expect(pullRequestQualityPasses('success', 'success', 'failure')).toBe(false)
    expect(pullRequestQualityPasses('success', 'success', 'cancelled')).toBe(false)
  })
})
