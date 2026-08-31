import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'

const SHA_PATTERN = /^[a-f0-9]{40}$/
const DATASET_VERSION_PATTERN = /^mpcorb-[a-f0-9]{16}-(?:full|lite)$/
const ASSET_SHA_PATTERN = /^[a-f0-9]{64}$/
const QUALITY_WORKFLOW = 'pull-request-quality.yml'
const DEPLOY_WORKFLOW = 'deploy.yml'
const QUALITY_CHECK = 'Pull request quality gate'
const GITHUB_ACTIONS_APP_ID = 15368

export function assertSha(value, label) {
  if (!SHA_PATTERN.test(value ?? '')) throw new Error(`${label} must be a full lowercase Git SHA`)
  return value
}

export function automationBranch(version) {
  if (!DATASET_VERSION_PATTERN.test(version ?? '')) throw new Error('Invalid dataset version')
  return `automation/dataset-pin-${version}`
}

export function validateQualityDispatch(input, pullRequest, mainSha) {
  if (input.eventName !== 'workflow_dispatch') throw new Error('Quality identity validation requires workflow_dispatch')
  const baseSha = assertSha(input.baseSha, 'Expected base SHA')
  const headSha = assertSha(input.headSha, 'Expected head SHA')
  assertSha(input.runtimeSha, 'Workflow SHA')
  if (!/^\d+$/.test(input.prNumber ?? '') || Number(input.prNumber) !== pullRequest.number) {
    throw new Error('Pull request number does not match the dispatch input')
  }
  if (input.runtimeSha !== headSha) throw new Error('Workflow is not running on the expected pull request head')
  if (pullRequest.state !== 'open' || pullRequest.merged) throw new Error('Automation pull request is not open')
  if (pullRequest.base?.ref !== 'main' || pullRequest.base?.sha !== baseSha || mainSha !== baseSha) {
    throw new Error('Automation pull request base is stale or does not target main')
  }
  if (pullRequest.head?.sha !== headSha || pullRequest.head?.ref !== input.runtimeRef) {
    throw new Error('Automation pull request head does not match the dispatched ref')
  }
  return { baseSha, headSha, branch: pullRequest.head.ref }
}

export function selectWorkflowRun(runs, expected) {
  const identified = runs.filter(run => (
    run.event === 'workflow_dispatch' &&
    run.head_branch === expected.branch &&
    run.display_title === expected.requestId
  ))
  if (identified.length > 1) throw new Error('Multiple workflow runs share the supposedly unique request identity')
  if (identified.length === 1 && identified[0].head_sha !== expected.headSha) {
    throw new Error('Dispatched workflow resolved to an unexpected commit')
  }
  return identified[0]
}

export function requiredActionsCheck(checkRuns, expectedRunId) {
  const matches = checkRuns.filter(check => (
    check.name === QUALITY_CHECK &&
    check.app?.id === GITHUB_ACTIONS_APP_ID &&
    check.app?.slug === 'github-actions' &&
    check.details_url?.includes(`/actions/runs/${expectedRunId}/`)
  ))
  if (matches.length !== 1) throw new Error(`Expected one ${QUALITY_CHECK} check from the dispatched Actions run`)
  const [check] = matches
  if (check.status !== 'completed' || check.conclusion !== 'success') {
    throw new Error(`${QUALITY_CHECK} did not complete successfully`)
  }
  return check
}

export function validateDeployDispatch(expectedSha, runtimeSha) {
  assertSha(expectedSha, 'Expected deployment SHA')
  assertSha(runtimeSha, 'Deployment workflow SHA')
  if (expectedSha !== runtimeSha) throw new Error('Deployment workflow is not running on the expected main SHA')
  return expectedSha
}

export function validateMergedDeployment(pullRequest, mainSha, deploymentRun, expected) {
  if (!pullRequest.merged || pullRequest.merge_commit_sha !== expected.mergeSha) {
    throw new Error('Pull request merge identity does not match the expected commit')
  }
  if (mainSha !== expected.mergeSha) throw new Error('main advanced before the dataset deployment was dispatched')
  if (!deploymentRun || deploymentRun.event !== 'workflow_dispatch' || deploymentRun.head_branch !== 'main' ||
      deploymentRun.head_sha !== expected.mergeSha || deploymentRun.display_title !== expected.requestId) {
    throw new Error('Deployment run identity does not match the merged main commit')
  }
  if (deploymentRun.status !== 'completed' || deploymentRun.conclusion !== 'success') {
    throw new Error('Deployment did not complete successfully')
  }
  return deploymentRun
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' }).trim()
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function remoteBranchSha(branch) {
  const line = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { capture: true })
  return line ? line.split(/\s+/)[0] : ''
}

function preparePin(version, assetSha256) {
  const branch = automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  git(['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
  const baseSha = assertSha(git(['rev-parse', 'origin/main'], { capture: true }), 'Fetched main SHA')
  const previousRemoteSha = remoteBranchSha(branch)
  git(['switch', '-C', branch, 'origin/main'])
  writeFileSync('.github/asteroid-dataset.json', `${JSON.stringify({
    schemaVersion: 1,
    tag: `dataset-${version}`,
    version,
    asset: 'asteroid-dataset.tar.gz',
    assetSha256,
  }, null, 2)}\n`)
  git(['config', 'user.name', 'github-actions[bot]'])
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  git(['add', '.github/asteroid-dataset.json'])
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'])
    output('changed', 'false')
    output('base_sha', baseSha)
    output('branch', branch)
    process.stdout.write(`Dataset pin already points to dataset-${version}.\n`)
    return
  } catch {
    // A non-zero diff status means there is a pin update to publish.
  }
  git(['commit', '-m', `data: pin asteroid dataset ${version}`])
  const headSha = assertSha(git(['rev-parse', 'HEAD'], { capture: true }), 'Automation head SHA')
  git([
    'push',
    `--force-with-lease=refs/heads/${branch}:${previousRemoteSha}`,
    'origin',
    `HEAD:refs/heads/${branch}`,
  ])
  output('changed', 'true')
  output('base_sha', baseSha)
  output('head_sha', headSha)
  output('branch', branch)
}

function apiUrl(path) {
  return `${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`
}

async function github(path, options = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required')
  const response = await fetch(apiUrl(path), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  if (!response.ok && !options.allow?.includes(response.status)) {
    throw new Error(`GitHub API ${response.status} ${path}: ${data?.message || text}`)
  }
  return { response, data }
}

function repositoryParts() {
  const [owner, repo, extra] = (process.env.GITHUB_REPOSITORY || '').split('/')
  if (!owner || !repo || extra) throw new Error('GITHUB_REPOSITORY must be owner/repository')
  return { owner, repo }
}

async function mainSha(owner, repo) {
  const { data } = await github(`/repos/${owner}/${repo}/branches/main`)
  return assertSha(data.commit.sha, 'Remote main SHA')
}

async function pullRequest(owner, repo, number) {
  const { data } = await github(`/repos/${owner}/${repo}/pulls/${number}`)
  return data
}

async function sleep(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitFor(label, probe, timeoutMinutes) {
  const deadline = Date.now() + timeoutMinutes * 60_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await sleep(10_000)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function openOrReusePullRequest(owner, repo, branch, version) {
  const query = new URLSearchParams({ state: 'open', base: 'main', head: `${owner}:${branch}`, per_page: '10' })
  const { data: existing } = await github(`/repos/${owner}/${repo}/pulls?${query}`)
  if (existing.length > 1) throw new Error(`Multiple open pull requests target ${branch}`)
  if (existing.length === 1) return existing[0]
  const { data } = await github(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: {
      title: `data: pin asteroid dataset ${version}`,
      head: branch,
      base: 'main',
      body: 'Automated immutable dataset pin update. The exact head commit must pass the protected pull request quality gate before merge.',
    },
  })
  return data
}

async function dispatchWorkflow(owner, repo, workflow, ref, inputs) {
  await github(`/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    body: { ref, inputs },
  })
}

async function waitForWorkflowRun(owner, repo, workflow, expected, timeoutMinutes) {
  return waitFor(`${workflow} run ${expected.requestId}`, async () => {
    const query = new URLSearchParams({ event: 'workflow_dispatch', branch: expected.branch, per_page: '50' })
    const { data } = await github(`/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?${query}`)
    const run = selectWorkflowRun(data.workflow_runs, expected)
    if (!run) return undefined
    if (run.status !== 'completed') return undefined
    if (run.conclusion !== 'success') throw new Error(`${workflow} run concluded ${run.conclusion}`)
    return run
  }, timeoutMinutes)
}

async function rebaseAutomationBranch(branch, expectedHeadSha) {
  git([
    'fetch',
    'origin',
    'refs/heads/main:refs/remotes/origin/main',
    `refs/heads/${branch}:refs/remotes/origin/${branch}`,
  ])
  const remoteHeadSha = remoteBranchSha(branch)
  if (remoteHeadSha !== expectedHeadSha) throw new Error('Automation branch changed unexpectedly before rebase')
  git(['switch', '-C', branch, `origin/${branch}`])
  git(['rebase', 'origin/main'])
  const baseSha = assertSha(git(['rev-parse', 'origin/main'], { capture: true }), 'Rebased main SHA')
  const headSha = assertSha(git(['rev-parse', 'HEAD'], { capture: true }), 'Rebased head SHA')
  git([
    'push',
    `--force-with-lease=refs/heads/${branch}:${remoteHeadSha}`,
    'origin',
    `HEAD:refs/heads/${branch}`,
  ])
  return { baseSha, headSha }
}

async function validateDispatchedQuality(owner, repo, pull, expected, run) {
  const currentMain = await mainSha(owner, repo)
  validateQualityDispatch({
    eventName: 'workflow_dispatch',
    prNumber: String(pull.number),
    baseSha: expected.baseSha,
    headSha: expected.headSha,
    runtimeSha: run.head_sha,
    runtimeRef: run.head_branch,
  }, pull, currentMain)
  await waitFor('the exact required GitHub Actions check', async () => {
    const { data } = await github(`/repos/${owner}/${repo}/commits/${expected.headSha}/check-runs?per_page=100`)
    try {
      return requiredActionsCheck(data.check_runs, run.id)
    } catch (error) {
      if (/Expected one/.test(error.message)) return undefined
      throw error
    }
  }, 5)
}

async function orchestrate(version, branch, initialBaseSha, initialHeadSha) {
  automationBranch(version)
  if (branch !== automationBranch(version)) throw new Error('Automation branch does not match the dataset version')
  let baseSha = assertSha(initialBaseSha, 'Initial base SHA')
  let headSha = assertSha(initialHeadSha, 'Initial head SHA')
  const { owner, repo } = repositoryParts()
  const sourceRun = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
  if (!/^\d+-\d+$/.test(sourceRun)) throw new Error('GitHub run identity is required')
  let pull = await openOrReusePullRequest(owner, repo, branch, version)

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    pull = await pullRequest(owner, repo, pull.number)
    const currentMain = await mainSha(owner, repo)
    if (pull.head.sha !== headSha) throw new Error('Automation pull request head changed outside this run')
    if (currentMain !== baseSha || pull.base.sha !== baseSha) {
      ({ baseSha, headSha } = await rebaseAutomationBranch(branch, headSha))
      pull = await waitFor('GitHub to observe the rebased pull request head', async () => {
        const candidate = await pullRequest(owner, repo, pull.number)
        return candidate.head.sha === headSha && candidate.base.sha === baseSha ? candidate : undefined
      }, 5)
    }

    const qualityRequestId = `dataset-pin-quality-${sourceRun}-${attempt}-${headSha.slice(0, 12)}`
    await dispatchWorkflow(owner, repo, QUALITY_WORKFLOW, branch, {
      pr_number: String(pull.number),
      base_sha: baseSha,
      head_sha: headSha,
      request_id: qualityRequestId,
    })
    const qualityRun = await waitForWorkflowRun(owner, repo, QUALITY_WORKFLOW, {
      requestId: qualityRequestId,
      branch,
      headSha,
    }, 45)
    pull = await pullRequest(owner, repo, pull.number)
    await validateDispatchedQuality(owner, repo, pull, { baseSha, headSha }, qualityRun)

    const mainBeforeMerge = await mainSha(owner, repo)
    if (mainBeforeMerge !== baseSha || pull.base.sha !== baseSha || pull.head.sha !== headSha) {
      if (attempt === 4) throw new Error('main kept advancing; refusing to reuse stale quality evidence')
      ({ baseSha, headSha } = await rebaseAutomationBranch(branch, headSha))
      continue
    }

    const { response, data: merge } = await github(`/repos/${owner}/${repo}/pulls/${pull.number}/merge`, {
      method: 'PUT',
      body: {
        sha: headSha,
        merge_method: 'squash',
        commit_title: `data: pin asteroid dataset ${version}`,
      },
      allow: [405, 409],
    })
    if (!response.ok || !merge.merged) {
      if (attempt === 4) throw new Error(`Protected merge failed: ${merge?.message || response.status}`)
      const latestMain = await mainSha(owner, repo)
      if (latestMain === baseSha) throw new Error(`Protected merge failed without a main update: ${merge?.message}`)
      ({ baseSha, headSha } = await rebaseAutomationBranch(branch, headSha))
      continue
    }

    const mergeSha = assertSha(merge.sha, 'Merge SHA')
    pull = await waitFor('merged pull request identity', async () => {
      const candidate = await pullRequest(owner, repo, pull.number)
      return candidate.merged && candidate.merge_commit_sha === mergeSha ? candidate : undefined
    }, 5)
    const mergedMainSha = await mainSha(owner, repo)
    if (mergedMainSha !== mergeSha) throw new Error('main advanced before deployment dispatch; refusing an ambiguous deployment')

    const deployRequestId = `dataset-pin-deploy-${sourceRun}-${mergeSha.slice(0, 12)}`
    await dispatchWorkflow(owner, repo, DEPLOY_WORKFLOW, 'main', {
      expected_sha: mergeSha,
      request_id: deployRequestId,
    })
    const deployRun = await waitForWorkflowRun(owner, repo, DEPLOY_WORKFLOW, {
      requestId: deployRequestId,
      branch: 'main',
      headSha: mergeSha,
    }, 45)
    validateMergedDeployment(pull, mergedMainSha, deployRun, {
      mergeSha,
      requestId: deployRequestId,
    })
    output('pr_url', pull.html_url)
    output('merge_sha', mergeSha)
    output('quality_run_url', qualityRun.html_url)
    output('deploy_run_url', deployRun.html_url)
    process.stdout.write(`Published ${pull.html_url} at ${mergeSha}; deployment ${deployRun.html_url} passed.\n`)
    return
  }
  throw new Error('Dataset pin automation exhausted its validation attempts')
}

async function validateQualityDispatchFromEnvironment() {
  const { owner, repo } = repositoryParts()
  const prNumber = process.env.PR_NUMBER
  if (!/^\d+$/.test(prNumber ?? '')) throw new Error('PR_NUMBER must be numeric')
  const pull = await pullRequest(owner, repo, Number(prNumber))
  validateQualityDispatch({
    eventName: process.env.GITHUB_EVENT_NAME,
    prNumber,
    baseSha: process.env.EXPECTED_BASE_SHA,
    headSha: process.env.EXPECTED_HEAD_SHA,
    runtimeSha: process.env.GITHUB_SHA,
    runtimeRef: process.env.GITHUB_REF_NAME,
  }, pull, await mainSha(owner, repo))
  process.stdout.write(`Validated pull request #${prNumber} at ${process.env.EXPECTED_HEAD_SHA}.\n`)
}

async function main() {
  const command = process.argv[2]
  if (command === 'prepare-pin') preparePin(process.argv[3], process.argv[4])
  else if (command === 'orchestrate') await orchestrate(process.argv[3], process.argv[4], process.argv[5], process.argv[6])
  else if (command === 'validate-quality-dispatch') await validateQualityDispatchFromEnvironment()
  else if (command === 'validate-deploy-dispatch') {
    validateDeployDispatch(process.env.EXPECTED_DEPLOY_SHA, process.env.GITHUB_SHA)
    process.stdout.write(`Validated deployment commit ${process.env.GITHUB_SHA}.\n`)
  } else if (process.argv[1]?.endsWith('dataset-pin-automation.mjs')) {
    throw new Error('Expected prepare-pin, orchestrate, validate-quality-dispatch, or validate-deploy-dispatch')
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
