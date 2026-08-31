import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  automationBranch,
  classifyPublication,
  git,
  requireArtifactBase,
  requiredActionsCheck,
  selectWorkflowRun,
  successfulDeployment,
  validateCandidateIdentity,
  validateDeployDispatch,
  validateMergedDeployment,
  validatePublicRepositoryUrl,
  validateQualityDispatch,
  validateReleaseAsset,
} from '../../scripts/dataset-pin-automation.mjs'

const baseSha = '1'.repeat(40)
const headSha = '2'.repeat(40)
const mergeSha = '3'.repeat(40)
const assetSha = 'a'.repeat(64)
const artifactDigest = 'b'.repeat(64)
const version = 'mpcorb-0123456789abcdef-lite'

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
  it('normalizes captured Git output and accepts inherited-stdio commands', () => {
    expect(git(['rev-parse', '--is-inside-work-tree'], { capture: true })).toBe('true')
    expect(git(['rev-parse', '--is-inside-work-tree'])).toBeUndefined()
  })

  it('accepts only deterministic dataset automation branch names', () => {
    expect(automationBranch('mpcorb-0123456789abcdef-lite')).toBe(
      'automation/dataset-pin-mpcorb-0123456789abcdef-lite',
    )
    expect(() => automationBranch('../../main')).toThrow(/Invalid dataset version/)
  })

  it('validates every identity handed from the read-only build to publishing', () => {
    expect(validateCandidateIdentity(version, assetSha, baseSha, artifactDigest)).toEqual({
      version,
      assetSha256: assetSha,
      sourceSha: baseSha,
      artifactDigest,
    })
    expect(() => validateCandidateIdentity(version, 'bad', baseSha, artifactDigest)).toThrow(/asset SHA/)
    expect(() => validateCandidateIdentity(version, assetSha, 'main', artifactDigest)).toThrow(/source SHA/)
    expect(() => validateCandidateIdentity(version, assetSha, baseSha, 'missing')).toThrow(/artifact SHA/)
  })

  it('accepts only public uncredentialed repository URLs for pre-publication main checks', () => {
    expect(validatePublicRepositoryUrl('https://github.com/dajiaohuang/solar.git')).toBe(
      'https://github.com/dajiaohuang/solar.git',
    )
    expect(() => validatePublicRepositoryUrl('https://token@github.com/dajiaohuang/solar.git')).toThrow(/uncredentialed/)
    expect(() => validatePublicRepositoryUrl('ssh://github.com/dajiaohuang/solar.git')).toThrow(/uncredentialed/)
    expect(() => validatePublicRepositoryUrl('https://github.com/dajiaohuang/solar.git?token=secret')).toThrow(/uncredentialed/)
  })

  it('refuses to reuse a candidate after main advances', () => {
    expect(requireArtifactBase(baseSha, baseSha)).toBe(baseSha)
    expect(() => requireArtifactBase(baseSha, mergeSha)).toThrow(/main advanced.*rerun the full data refresh/)
  })

  it('classifies only an exact pin-only direct successor as a safe deployment recovery', () => {
    const candidate = { version, assetSha256: assetSha, sourceSha: baseSha }
    const exactCommit = {
      sha: mergeSha,
      parents: [{ sha: baseSha }],
      files: [{ filename: '.github/asteroid-dataset.json', status: 'modified' }],
    }
    const exactPin = {
      schemaVersion: 1,
      tag: `dataset-${version}`,
      version,
      asset: 'asteroid-dataset.tar.gz',
      assetSha256: assetSha,
    }
    expect(classifyPublication(candidate, baseSha)).toEqual({ mode: 'fresh', targetSha: baseSha })
    expect(classifyPublication(candidate, mergeSha, exactCommit, exactPin)).toEqual({
      mode: 'recover',
      targetSha: mergeSha,
    })
    expect(() => classifyPublication(candidate, mergeSha, {
      ...exactCommit,
      parents: [{ sha: headSha }],
    }, exactPin)).toThrow(/advanced beyond the exact dataset pin merge/)
    expect(() => classifyPublication(candidate, mergeSha, {
      ...exactCommit,
      files: [...exactCommit.files, { filename: 'src/data.ts', status: 'modified' }],
    }, exactPin)).toThrow(/advanced beyond/)
    expect(() => classifyPublication(candidate, mergeSha, exactCommit, {
      ...exactPin,
      assetSha256: 'c'.repeat(64),
    })).toThrow(/advanced beyond/)
  })

  it('requires one exact published asset before deployment recovery', () => {
    const release = {
      tag_name: `dataset-${version}`,
      draft: false,
      assets: [{ id: 123, name: 'asteroid-dataset.tar.gz' }],
    }
    expect(validateReleaseAsset(release, version, assetSha)).toBe(release.assets[0])
    expect(() => validateReleaseAsset({ ...release, draft: true }, version, assetSha)).toThrow(/identity/)
    expect(() => validateReleaseAsset({ ...release, assets: [] }, version, assetSha)).toThrow(/exactly one/)
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

  it('routes a post-merge failed-deployment rerun into exact current-main recovery', () => {
    const failedExact = {
      head_branch: 'main',
      head_sha: mergeSha,
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/dajiaohuang/solar/actions/runs/1',
    }
    const successfulOld = {
      ...failedExact,
      head_sha: headSha,
      conclusion: 'success',
      html_url: 'https://github.com/dajiaohuang/solar/actions/runs/2',
    }
    const successfulExact = {
      ...failedExact,
      conclusion: 'success',
      html_url: 'https://github.com/dajiaohuang/solar/actions/runs/3',
    }
    const publication = classifyPublication({ version, assetSha256: assetSha, sourceSha: baseSha }, mergeSha, {
      sha: mergeSha,
      parents: [{ sha: baseSha }],
      files: [{ filename: '.github/asteroid-dataset.json', status: 'modified' }],
    }, {
      schemaVersion: 1,
      tag: `dataset-${version}`,
      version,
      asset: 'asteroid-dataset.tar.gz',
      assetSha256: assetSha,
    })
    expect(publication).toEqual({ mode: 'recover', targetSha: mergeSha })
    expect(successfulDeployment([failedExact, successfulOld], mergeSha)).toBeUndefined()
    expect(successfulDeployment([failedExact, successfulOld, successfulExact], mergeSha)).toBe(successfulExact)
    expect(successfulDeployment([{ ...successfulExact, head_branch: 'feature' }], mergeSha)).toBeUndefined()
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
    expect(quality['run-name']).toBe("${{ inputs.request_id || format('Pull request #{0}', github.event.pull_request.number) }}")
    expect(quality.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' })
    expect(quality.jobs.mobile_quality.uses).toBe('./.github/workflows/mobile.yml')
    expect(mobile.on.workflow_call.inputs.checkout_ref.type).toBe('string')
    expect(refresh.permissions).toEqual({ contents: 'read' })
    expect(refresh.jobs.build_candidate.permissions).toEqual({ contents: 'read' })
    expect(refresh.jobs.build_candidate.outputs.source_sha).toBe('${{ github.sha }}')
    const buildCheckout = refresh.jobs.build_candidate.steps.find(step => step.uses === 'actions/checkout@v7')
    expect(buildCheckout.with).toEqual({ ref: '${{ github.sha }}', 'persist-credentials': false })
    const upload = refresh.jobs.build_candidate.steps.find(step => step.uses === 'actions/upload-artifact@v6')
    expect(upload.with.path).toBe('asteroid-dataset.tar.gz')
    expect(refresh.jobs.publish.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      actions: 'write',
    })
    expect(refresh.jobs.publish.needs).toBe('build_candidate')
    const publishSteps = refresh.jobs.publish.steps
    const sourceCheckoutIndex = publishSteps.findIndex(step => step.name === 'Read the immutable source control without persistent credentials')
    const downloadIndex = publishSteps.findIndex(step => step.name === 'Download the validated dataset candidate')
    const verifyIndex = publishSteps.findIndex(step => step.name === 'Verify and classify the candidate before any write')
    const authenticatedCheckoutIndex = publishSteps.findIndex(step => step.name === 'Enable authenticated publishing after candidate verification')
    const releaseIndex = publishSteps.findIndex(step => step.name === 'Publish GitHub release')
    expect(sourceCheckoutIndex).toBeGreaterThanOrEqual(0)
    expect(sourceCheckoutIndex).toBeLessThan(downloadIndex)
    expect(downloadIndex).toBeLessThan(verifyIndex)
    expect(verifyIndex).toBeLessThan(authenticatedCheckoutIndex)
    expect(authenticatedCheckoutIndex).toBeLessThan(releaseIndex)
    expect(publishSteps[sourceCheckoutIndex].with).toEqual({
      ref: '${{ needs.build_candidate.outputs.source_sha }}',
      'persist-credentials': false,
    })
    expect(publishSteps[verifyIndex].run).toContain('validate-candidate-identity')
    expect(publishSteps[verifyIndex].run).toContain('sha256sum --check --strict')
    expect(publishSteps[verifyIndex].run).toContain('classify-publication')
    expect(publishSteps[verifyIndex].run).toContain('"$VERSION" "$EXPECTED_ASSET_SHA256" "$SOURCE_SHA" "$PUBLIC_REPOSITORY_URL"')
    expect(publishSteps.slice(0, authenticatedCheckoutIndex).every(step => (
      !step.env?.GH_TOKEN && !step.env?.GITHUB_TOKEN && !JSON.stringify(step).includes('github.token')
    ))).toBe(true)
    expect(publishSteps[authenticatedCheckoutIndex].with).toEqual({
      ref: '${{ needs.build_candidate.outputs.source_sha }}',
      'persist-credentials': true,
      clean: false,
    })
    expect(publishSteps[authenticatedCheckoutIndex].if).toBe("steps.publication.outputs.mode == 'fresh'")
    expect(publishSteps.some(step => step.uses === 'actions/download-artifact@v7')).toBe(true)
    expect(publishSteps.find(step => step.id === 'pin').run).toContain('"$SOURCE_SHA"')
    expect(publishSteps.find(step => step.id === 'recover_deploy').if).toContain("steps.publication.outputs.mode == 'fresh'")
    expect(publishSteps.find(step => step.id === 'recover_post_merge').if).toBe("steps.publication.outputs.mode == 'recover'")
    expect(publishSteps.find(step => step.id === 'recover_post_merge').run).toContain('steps.publication.outputs.target_sha')
    expect(publishSteps.filter(step => step.run).every(step => !step.run.includes('publish-input/scripts/'))).toBe(true)
    expect(publishSteps.filter(step => step.run?.includes('dataset-pin-automation.mjs')).every(step => (
      step.run.includes('node scripts/dataset-pin-automation.mjs')
    ))).toBe(true)
    expect(publishSteps.map(step => step.run ?? '').join('\n')).not.toMatch(/\bnpm\b|\bnpx\b/)
    expect(deploy.on.workflow_dispatch.inputs).toMatchObject({
      expected_sha: { required: false },
      request_id: { required: false },
    })
    const refreshSource = readFileSync(new URL('.github/workflows/data-refresh.yml', root), 'utf8')
    const automationSource = readFileSync(new URL('scripts/dataset-pin-automation.mjs', root), 'utf8')
    expect(refreshSource).not.toContain('HEAD:main')
    expect(automationSource).not.toContain("git(['rebase'")
    expect(automationSource).not.toContain('rebaseAutomationBranch')
  })
})
