import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  automationBranch,
  requiredActionsCheck,
  selectWorkflowRun,
  validateDeployDispatch,
  validateMergedDeployment,
  validateQualityDispatch,
} from '../../scripts/dataset-pin-automation.mjs'

const baseSha = '1'.repeat(40)
const headSha = '2'.repeat(40)
const mergeSha = '3'.repeat(40)

function pullRequest(overrides = {}) {
  return {
    number: 64,
    state: 'open',
    merged: false,
    base: { ref: 'main', sha: baseSha },
    head: { ref: 'automation/dataset-pin-mpcorb-0123456789abcdef-lite', sha: headSha },
    ...overrides,
  }
}

describe('protected dataset pin automation', () => {
  it('accepts only deterministic dataset automation branch names', () => {
    expect(automationBranch('mpcorb-0123456789abcdef-lite')).toBe(
      'automation/dataset-pin-mpcorb-0123456789abcdef-lite',
    )
    expect(() => automationBranch('../../main')).toThrow(/Invalid dataset version/)
  })

  it('rejects stale or mismatched explicit quality identities', () => {
    const input = {
      eventName: 'workflow_dispatch',
      prNumber: '64',
      baseSha,
      headSha,
      runtimeSha: headSha,
      runtimeRef: 'automation/dataset-pin-mpcorb-0123456789abcdef-lite',
    }
    expect(validateQualityDispatch(input, pullRequest(), baseSha)).toEqual({
      baseSha,
      headSha,
      branch: input.runtimeRef,
    })
    expect(() => validateQualityDispatch({ ...input, runtimeSha: mergeSha }, pullRequest(), baseSha)).toThrow(/expected pull request head/)
    expect(() => validateQualityDispatch(input, pullRequest(), mergeSha)).toThrow(/base is stale/)
    expect(() => validateQualityDispatch(input, pullRequest({ head: { ref: input.runtimeRef, sha: mergeSha } }), baseSha)).toThrow(/head does not match/)
  })

  it('selects only the uniquely identified workflow dispatch on the exact head', () => {
    const expected = { requestId: 'request-1', branch: 'automation/data', headSha }
    const run = { event: 'workflow_dispatch', head_sha: headSha, head_branch: 'automation/data', display_title: 'request-1' }
    expect(selectWorkflowRun([run], expected)).toBe(run)
    expect(() => selectWorkflowRun([{ ...run, head_sha: mergeSha }], expected)).toThrow(/unexpected commit/)
    expect(selectWorkflowRun([{ ...run, event: 'pull_request' }], expected)).toBeUndefined()
  })

  it('requires the exact successful GitHub Actions summary from the dispatched run', () => {
    const exact = {
      name: 'Pull request quality gate',
      app: { id: 15368, slug: 'github-actions' },
      details_url: 'https://github.com/dajiaohuang/solar/actions/runs/123/job/456',
      status: 'completed',
      conclusion: 'success',
    }
    expect(requiredActionsCheck([exact], 123)).toBe(exact)
    expect(() => requiredActionsCheck([{ ...exact, conclusion: 'failure' }], 123)).toThrow(/successfully/)
    expect(() => requiredActionsCheck([{ ...exact, app: { id: 1, slug: 'github-actions' } }], 123)).toThrow(/Expected one/)
    expect(() => requiredActionsCheck([{ ...exact, details_url: 'https://github.com/actions/runs/999/job/456' }], 123)).toThrow(/Expected one/)
  })

  it('binds deployment to the merge commit and exact successful dispatch', () => {
    expect(validateDeployDispatch(mergeSha, mergeSha)).toBe(mergeSha)
    expect(() => validateDeployDispatch(mergeSha, headSha)).toThrow(/expected main SHA/)
    const mergedPull = pullRequest({ merged: true, merge_commit_sha: mergeSha })
    const run = {
      event: 'workflow_dispatch',
      head_branch: 'main',
      head_sha: mergeSha,
      display_title: 'deploy-request',
      status: 'completed',
      conclusion: 'success',
    }
    expect(validateMergedDeployment(mergedPull, mergeSha, run, {
      mergeSha,
      requestId: 'deploy-request',
    })).toBe(run)
    expect(() => validateMergedDeployment(mergedPull, headSha, run, {
      mergeSha,
      requestId: 'deploy-request',
    })).toThrow(/main advanced/)
    expect(() => validateMergedDeployment(mergedPull, mergeSha, { ...run, head_sha: headSha }, {
      mergeSha,
      requestId: 'deploy-request',
    })).toThrow(/identity/)
  })

  it('keeps dispatch, reusable quality, and scoped write permissions in the workflow contract', () => {
    const root = new URL('../../', import.meta.url)
    const quality = parse(readFileSync(new URL('.github/workflows/pull-request-quality.yml', root), 'utf8'))
    const mobile = parse(readFileSync(new URL('.github/workflows/mobile.yml', root), 'utf8'))
    const refresh = parse(readFileSync(new URL('.github/workflows/data-refresh.yml', root), 'utf8'))
    const deploy = parse(readFileSync(new URL('.github/workflows/deploy.yml', root), 'utf8'))

    expect(quality.on.workflow_dispatch.inputs).toMatchObject({
      pr_number: { required: true },
      base_sha: { required: true },
      head_sha: { required: true },
      request_id: { required: true },
    })
    expect(quality.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' })
    expect(quality.jobs.mobile_quality.uses).toBe('./.github/workflows/mobile.yml')
    expect(mobile.on.workflow_call.inputs.checkout_ref.type).toBe('string')
    expect(refresh.permissions).toEqual({ contents: 'read' })
    expect(refresh.jobs.publish.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      actions: 'write',
    })
    expect(deploy.on.workflow_dispatch.inputs).toMatchObject({
      expected_sha: { required: false },
      request_id: { required: false },
    })
    expect(readFileSync(new URL('.github/workflows/data-refresh.yml', root), 'utf8')).not.toContain('HEAD:main')
  })
})
