import { describe, expect, it } from 'vitest'
// @ts-expect-error The workflow helper is directly executable JavaScript.
import { eligibleQualityRun, findNativeQualityEvidence, nativeJobsPassed } from '../../scripts/native-quality-reuse.mjs'

const repository = 'owner/solar', sha = 'a'.repeat(40), now = Date.parse('2026-09-23T00:00:00Z')
const stamp = '2026-09-22T23:30:00Z'
const run = { id: 42, head_sha: sha, status: 'completed', conclusion: 'success', path: '.github/workflows/pull-request-quality.yml', head_repository: { full_name: repository }, updated_at: stamp }
const jobs = ['Mobile quality / android', 'Mobile quality / ios'].map(name => ({ name, head_sha: sha, status: 'completed', conclusion: 'success', completed_at: stamp }))

describe('exact-head native CI reuse', () => {
  it('requires same repository, head, workflow, success and a fresh completion', () => {
    expect(eligibleQualityRun(run, repository, sha, now)).toBe(true)
    for (const changed of [{ head_sha: 'b'.repeat(40) }, { path: '.github/workflows/other.yml' }, { conclusion: 'failure' }, { status: 'in_progress' }, { head_repository: { full_name: 'fork/solar' } }, { updated_at: '2026-09-01T00:00:00Z' }]) {
      expect(eligibleQualityRun({ ...run, ...changed }, repository, sha, now)).toBe(false)
    }
  })
  it('does not let a rerun of only the gate refresh old or skipped native proof', () => {
    expect(nativeJobsPassed(jobs, sha, now)).toBe(true)
    for (const changed of [{ conclusion: 'skipped' }, { conclusion: 'cancelled' }, { head_sha: 'b'.repeat(40) }, { completed_at: '2026-09-01T00:00:00Z' }, { completed_at: '2026-09-24T00:00:00Z' }]) {
      expect(nativeJobsPassed([jobs[0], { ...jobs[1], ...changed }], sha, now)).toBe(false)
    }
    expect(nativeJobsPassed(jobs.slice(0, 1), sha, now)).toBe(false)
    expect(nativeJobsPassed([...jobs, jobs[0]], sha, now)).toBe(false)
  })
  it('finishes job pagination before accepting Android and iOS evidence', async () => {
    const urls: string[] = []
    const evidence = await findNativeQualityEvidence({ repository, sha, now, api: async (url: string) => {
      urls.push(url)
      if (url.includes('/workflows/')) return { workflow_runs: [run] }
      if (url.endsWith('page=1')) return { jobs: [jobs[0], ...Array.from({ length: 99 }, (_, i) => ({ name: `other-${i}` }))] }
      return { jobs: [jobs[1]] }
    } })
    expect(evidence).toMatchObject({ runId: 42, sha, maxAgeHours: 24 })
    expect(urls).toHaveLength(3)
  })
  it('returns no reuse when even one native job lacks evidence', async () => {
    const evidence = await findNativeQualityEvidence({ repository, sha, now, api: async (url: string) => url.includes('/workflows/') ? { workflow_runs: [run] } : { jobs: [jobs[0]] } })
    expect(evidence).toBeNull()
  })
})
