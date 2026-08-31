import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

export function validateCandidateIdentity(version, assetSha256, sourceSha, artifactDigest) {
  automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  assertSha(sourceSha, 'Artifact source SHA')
  if (!ASSET_SHA_PATTERN.test(artifactDigest ?? '')) throw new Error('Invalid Actions artifact SHA-256')
  return { version, assetSha256, sourceSha, artifactDigest }
}

export function validatePublicRepositoryUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Public repository URL must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url.pathname)) {
    throw new Error('Public repository URL must be an uncredentialed HTTPS Git repository URL')
  }
  return url.href
}

export function classifyPublication(candidate, currentMainSha, currentCommit, pin) {
  automationBranch(candidate.version)
  if (!ASSET_SHA_PATTERN.test(candidate.assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  const sourceSha = assertSha(candidate.sourceSha, 'Artifact source SHA')
  assertSha(currentMainSha, 'Current main SHA')
  if (currentMainSha === sourceSha) return { mode: 'fresh', targetSha: sourceSha }

  const expectedKeys = ['asset', 'assetSha256', 'schemaVersion', 'tag', 'version']
  const pinKeys = pin && typeof pin === 'object' ? Object.keys(pin).sort() : []
  const exactPin = pin?.schemaVersion === 1 &&
    pin?.version === candidate.version &&
    pin?.tag === `dataset-${candidate.version}` &&
    pin?.asset === 'asteroid-dataset.tar.gz' &&
    pin?.assetSha256 === candidate.assetSha256 &&
    JSON.stringify(pinKeys) === JSON.stringify(expectedKeys)
  const exactCommit = currentCommit?.sha === currentMainSha &&
    currentCommit.parents?.length === 1 &&
    currentCommit.parents[0]?.sha === sourceSha &&
    currentCommit.files?.length === 1 &&
    currentCommit.files[0]?.filename === '.github/asteroid-dataset.json' &&
    currentCommit.files[0]?.status === 'modified'
  if (!exactCommit || !exactPin) {
    throw new Error('main advanced beyond the exact dataset pin merge; rerun the full data refresh from current main')
  }
  return { mode: 'recover', targetSha: currentMainSha }
}

export function validateReleaseAsset(release, version, assetSha256) {
  automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  if (release?.tag_name !== `dataset-${version}` || release.draft) {
    throw new Error('Dataset release identity does not match the validated candidate')
  }
  const assets = release.assets?.filter(asset => asset.name === 'asteroid-dataset.tar.gz') ?? []
  if (assets.length !== 1 || !Number.isSafeInteger(assets[0].id)) {
    throw new Error('Dataset release must contain exactly one immutable dataset asset')
  }
  return assets[0]
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

export function selectPullRequestWorkflowRun(runs, expected) {
  const identified = runs.filter(run => {
    const associations = run.pull_requests ?? []
    return run.event === 'pull_request' &&
      run.path === `.github/workflows/${QUALITY_WORKFLOW}` &&
      run.head_branch === expected.branch &&
      run.head_sha === expected.headSha &&
      associations.length === 1 &&
      associations[0]?.number === expected.prNumber &&
      associations[0]?.head?.ref === expected.branch &&
      associations[0]?.head?.sha === expected.headSha &&
      associations[0]?.base?.ref === 'main' &&
      associations[0]?.base?.sha === expected.baseSha
  })
  if (identified.length > 1) {
    throw new Error('Multiple pull_request workflow runs match the exact pull request identity')
  }
  return identified[0]
}

export function validatePullRequestWorkflowRun(run, expected) {
  const exact = selectPullRequestWorkflowRun([run], expected)
  if (!exact) throw new Error('Pull request workflow run identity is stale or mismatched')
  return exact
}

export function pullRequestWorkflowRunAction(run) {
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return 'success'
    if (run.conclusion === 'action_required') return 'approve'
    throw new Error(`Pull request quality workflow concluded ${run.conclusion || 'without a conclusion'}`)
  }
  if (run.conclusion !== null && run.conclusion !== undefined) {
    throw new Error('Pull request quality workflow has a conclusion before completion')
  }
  if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)) return 'wait'
  throw new Error(`Pull request quality workflow has unsupported status ${run.status || 'missing'}`)
}

export function requiredActionsCheck(checkRuns, expectedRunId) {
  const matches = checkRuns.filter(check => (
    check.name === QUALITY_CHECK &&
    check.app?.id === GITHUB_ACTIONS_APP_ID &&
    check.app?.slug === 'github-actions' &&
    check.details_url?.includes(`/actions/runs/${expectedRunId}/`)
  ))
  if (matches.length !== 1) throw new Error(`Expected one ${QUALITY_CHECK} check from the exact Actions run`)
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

export function requireArtifactBase(expectedSha, currentMainSha) {
  assertSha(expectedSha, 'Artifact source SHA')
  assertSha(currentMainSha, 'Current main SHA')
  if (expectedSha !== currentMainSha) {
    throw new Error('main advanced after dataset validation; rerun the full data refresh from the new main')
  }
  return expectedSha
}

export function successfulDeployment(runs, expectedSha) {
  assertSha(expectedSha, 'Expected deployed SHA')
  return runs.find(run => (
    run.head_branch === 'main' &&
    run.head_sha === expectedSha &&
    run.status === 'completed' &&
    run.conclusion === 'success'
  ))
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

export function git(args, options = {}) {
  const result = execFileSync('git', args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' })
  return options.capture ? result.trim() : undefined
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function remoteBranchSha(branch) {
  const line = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { capture: true })
  return line ? line.split(/\s+/)[0] : ''
}

function remoteMainSha(remote = 'origin') {
  const validatedRemote = remote === 'origin' ? remote : validatePublicRepositoryUrl(remote)
  const line = git(['ls-remote', '--heads', validatedRemote, 'refs/heads/main'], { capture: true })
  const sha = line ? line.split(/\s+/)[0] : ''
  return assertSha(sha, 'Remote main SHA')
}

function preparePin(version, assetSha256, artifactBaseSha) {
  const branch = automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  assertSha(artifactBaseSha, 'Artifact source SHA')
  git(['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
  const baseSha = assertSha(git(['rev-parse', 'origin/main'], { capture: true }), 'Fetched main SHA')
  requireArtifactBase(artifactBaseSha, baseSha)
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
    output('head_sha', baseSha)
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

async function publicGithub(path) {
  const response = await fetch(apiUrl(path), {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  if (!response.ok) throw new Error(`Public GitHub API ${response.status} ${path}: ${data?.message || text}`)
  return data
}

async function githubAssetSha256(path) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required')
  const response = await fetch(apiUrl(path), {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok || !response.body) throw new Error(`Unable to download immutable dataset asset: ${response.status}`)
  const hash = createHash('sha256')
  for await (const chunk of response.body) hash.update(chunk)
  return hash.digest('hex')
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

async function datasetPin(owner, repo, sha) {
  const { data } = await github(`/repos/${owner}/${repo}/contents/.github/asteroid-dataset.json?ref=${sha}`)
  if (data.type !== 'file' || data.encoding !== 'base64') throw new Error('main dataset pin is not a regular base64 GitHub content response')
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
}

async function publicDatasetPin(owner, repo, sha) {
  const data = await publicGithub(`/repos/${owner}/${repo}/contents/.github/asteroid-dataset.json?ref=${sha}`)
  if (data.type !== 'file' || data.encoding !== 'base64') {
    throw new Error('main dataset pin is not a regular base64 GitHub content response')
  }
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
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

async function waitForPullRequestWorkflowRun(owner, repo, expected, timeoutMinutes) {
  return waitFor(`pull_request quality run for pull request #${expected.prNumber}`, async () => {
    const query = new URLSearchParams({ event: 'pull_request', branch: expected.branch, per_page: '50' })
    const { data } = await github(`/repos/${owner}/${repo}/actions/workflows/${QUALITY_WORKFLOW}/runs?${query}`)
    return selectPullRequestWorkflowRun(data.workflow_runs, expected)
  }, timeoutMinutes)
}

async function approveAndWaitForPullRequestWorkflowRun(owner, repo, expected, initialRun, timeoutMinutes) {
  let action = pullRequestWorkflowRunAction(validatePullRequestWorkflowRun(initialRun, expected))
  if (action === 'approve') {
    await github(`/repos/${owner}/${repo}/actions/runs/${initialRun.id}/approve`, { method: 'POST' })
  }
  return waitFor(`exact pull_request quality run ${initialRun.id}`, async () => {
    const { data: run } = await github(`/repos/${owner}/${repo}/actions/runs/${initialRun.id}`)
    validatePullRequestWorkflowRun(run, expected)
    action = pullRequestWorkflowRunAction(run)
    if (action === 'success') return run
    if (action === 'approve' || action === 'wait') return undefined
    return undefined
  }, timeoutMinutes)
}

async function workflowRuns(owner, repo, workflow, branch) {
  const query = new URLSearchParams({ branch, per_page: '100' })
  const { data } = await github(`/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?${query}`)
  return data.workflow_runs
}

async function classifyPublicationFromRemote(version, assetSha256, sourceSha, publicRepositoryUrl) {
  automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  assertSha(sourceSha, 'Artifact source SHA')
  const currentMainSha = remoteMainSha(publicRepositoryUrl)
  let currentCommit
  let pin
  if (currentMainSha !== sourceSha) {
    const { owner, repo } = repositoryParts()
    currentCommit = await publicGithub(`/repos/${owner}/${repo}/commits/${currentMainSha}`)
    pin = await publicDatasetPin(owner, repo, currentMainSha)
  }
  const publication = classifyPublication({ version, assetSha256, sourceSha }, currentMainSha, currentCommit, pin)
  output('mode', publication.mode)
  output('target_sha', publication.targetSha)
  process.stdout.write(`Validated ${publication.mode} publication path at ${publication.targetSha}.\n`)
}

async function verifyRelease(owner, repo, version, assetSha256) {
  const { data: release } = await github(`/repos/${owner}/${repo}/releases/tags/dataset-${version}`)
  const asset = validateReleaseAsset(release, version, assetSha256)
  const publishedSha256 = await githubAssetSha256(`/repos/${owner}/${repo}/releases/assets/${asset.id}`)
  if (publishedSha256 !== assetSha256) {
    throw new Error('Immutable dataset release asset differs from the validated candidate SHA-256')
  }
  return asset
}

async function recoverDeployment(version, assetSha256, preparedMainSha) {
  automationBranch(version)
  if (!ASSET_SHA_PATTERN.test(assetSha256 ?? '')) throw new Error('Invalid dataset asset SHA-256')
  assertSha(preparedMainSha, 'Prepared main SHA')
  const { owner, repo } = repositoryParts()
  const currentMainSha = await mainSha(owner, repo)
  requireArtifactBase(preparedMainSha, currentMainSha)
  const pin = await datasetPin(owner, repo, currentMainSha)
  if (pin.version !== version || pin.tag !== `dataset-${version}` ||
      pin.asset !== 'asteroid-dataset.tar.gz' || pin.assetSha256 !== assetSha256) {
    throw new Error('Current main no longer contains the validated release version and asset SHA; refusing deployment recovery')
  }
  await verifyRelease(owner, repo, version, assetSha256)
  const existing = successfulDeployment(await workflowRuns(owner, repo, DEPLOY_WORKFLOW, 'main'), currentMainSha)
  if (existing) {
    requireArtifactBase(currentMainSha, await mainSha(owner, repo))
    output('deploy_run_url', existing.html_url)
    output('deployed_sha', currentMainSha)
    process.stdout.write(`Deployment ${existing.html_url} already succeeded for current main ${currentMainSha}.\n`)
    return
  }
  const sourceRun = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
  if (!/^\d+-\d+$/.test(sourceRun)) throw new Error('GitHub run identity is required')
  const requestId = `dataset-pin-recover-${sourceRun}-${currentMainSha.slice(0, 12)}`
  await dispatchWorkflow(owner, repo, DEPLOY_WORKFLOW, 'main', {
    expected_sha: currentMainSha,
    request_id: requestId,
  })
  const deployRun = await waitForWorkflowRun(owner, repo, DEPLOY_WORKFLOW, {
    requestId,
    branch: 'main',
    headSha: currentMainSha,
  }, 45)
  validateDeployDispatch(currentMainSha, deployRun.head_sha)
  requireArtifactBase(currentMainSha, await mainSha(owner, repo))
  output('deploy_run_url', deployRun.html_url)
  output('deployed_sha', currentMainSha)
  process.stdout.write(`Recovered deployment ${deployRun.html_url} for current main ${currentMainSha}.\n`)
}

async function validatePullRequestQuality(owner, repo, pull, expected, run) {
  const currentMain = await mainSha(owner, repo)
  if (pull.state !== 'open' || pull.merged || pull.base?.ref !== 'main' ||
      pull.base?.sha !== expected.baseSha || currentMain !== expected.baseSha ||
      pull.head?.ref !== expected.branch || pull.head?.sha !== expected.headSha) {
    throw new Error('Automation pull request identity became stale before quality validation')
  }
  validatePullRequestWorkflowRun(run, { ...expected, prNumber: pull.number })
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
  const baseSha = assertSha(initialBaseSha, 'Initial base SHA')
  const headSha = assertSha(initialHeadSha, 'Initial head SHA')
  const { owner, repo } = repositoryParts()
  const sourceRun = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
  if (!/^\d+-\d+$/.test(sourceRun)) throw new Error('GitHub run identity is required')
  let pull = await openOrReusePullRequest(owner, repo, branch, version)

  pull = await waitFor('GitHub to observe the exact pull request identities', async () => {
    const candidate = await pullRequest(owner, repo, pull.number)
    return candidate.head.sha === headSha && candidate.base.sha === baseSha ? candidate : undefined
  }, 5)
  requireArtifactBase(baseSha, await mainSha(owner, repo))
  if (pull.head.sha !== headSha) throw new Error('Automation pull request head changed outside this run')

  const qualityIdentity = {
    prNumber: pull.number,
    branch,
    baseSha,
    headSha,
  }
  const pendingQualityRun = await waitForPullRequestWorkflowRun(owner, repo, qualityIdentity, 5)
  const qualityRun = await approveAndWaitForPullRequestWorkflowRun(
    owner,
    repo,
    qualityIdentity,
    pendingQualityRun,
    45,
  )
  pull = await pullRequest(owner, repo, pull.number)
  await validatePullRequestQuality(owner, repo, pull, { branch, baseSha, headSha }, qualityRun)

  const mainBeforeMerge = await mainSha(owner, repo)
  requireArtifactBase(baseSha, mainBeforeMerge)
  if (pull.base.sha !== baseSha || pull.head.sha !== headSha) {
    throw new Error('Pull request identity changed after quality validation')
  }

  const { data: merge } = await github(`/repos/${owner}/${repo}/pulls/${pull.number}/merge`, {
    method: 'PUT',
    body: {
      sha: headSha,
      merge_method: 'squash',
      commit_title: `data: pin asteroid dataset ${version}`,
    },
  })
  if (!merge.merged) throw new Error(`Protected merge failed: ${merge?.message || 'unknown error'}`)

  const mergeSha = assertSha(merge.sha, 'Merge SHA')
  pull = await waitFor('merged pull request identity', async () => {
    const candidate = await pullRequest(owner, repo, pull.number)
    return candidate.merged && candidate.merge_commit_sha === mergeSha ? candidate : undefined
  }, 5)
  const mergedMainSha = await mainSha(owner, repo)
  if (mergedMainSha !== mergeSha) {
    throw new Error('main advanced before deployment dispatch; refusing an ambiguous deployment')
  }

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
  validateMergedDeployment(pull, await mainSha(owner, repo), deployRun, {
    mergeSha,
    requestId: deployRequestId,
  })
  output('pr_url', pull.html_url)
  output('merge_sha', mergeSha)
  output('quality_run_url', qualityRun.html_url)
  output('deploy_run_url', deployRun.html_url)
  process.stdout.write(`Published ${pull.html_url} at ${mergeSha}; deployment ${deployRun.html_url} passed.\n`)
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
  if (command === 'validate-candidate-identity') {
    validateCandidateIdentity(process.argv[3], process.argv[4], process.argv[5], process.argv[6])
  } else if (command === 'classify-publication') {
    await classifyPublicationFromRemote(process.argv[3], process.argv[4], process.argv[5], process.argv[6])
  } else if (command === 'validate-publication-base') {
    requireArtifactBase(process.argv[3], remoteMainSha(process.argv[4]))
  } else if (command === 'prepare-pin') preparePin(process.argv[3], process.argv[4], process.argv[5])
  else if (command === 'orchestrate') await orchestrate(process.argv[3], process.argv[4], process.argv[5], process.argv[6])
  else if (command === 'recover-deployment') await recoverDeployment(process.argv[3], process.argv[4], process.argv[5])
  else if (command === 'validate-quality-dispatch') await validateQualityDispatchFromEnvironment()
  else if (command === 'validate-deploy-dispatch') {
    validateDeployDispatch(process.env.EXPECTED_DEPLOY_SHA, process.env.GITHUB_SHA)
    process.stdout.write(`Validated deployment commit ${process.env.GITHUB_SHA}.\n`)
  } else if (process.argv[1]?.endsWith('dataset-pin-automation.mjs')) {
    throw new Error('Expected validate-candidate-identity, classify-publication, validate-publication-base, prepare-pin, orchestrate, recover-deployment, validate-quality-dispatch, or validate-deploy-dispatch')
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
