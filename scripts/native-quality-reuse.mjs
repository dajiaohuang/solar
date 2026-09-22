import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const WORKFLOW = '.github/workflows/pull-request-quality.yml'
const NATIVE_JOBS = ['Mobile quality / android', 'Mobile quality / ios']
const MAX_AGE_MS = 24 * 60 * 60 * 1000

function fresh(value, now) {
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= now + 5 * 60 * 1000 && now - time <= MAX_AGE_MS
}

export function eligibleQualityRun(run, repository, sha, now = Date.now()) {
  return /^[a-f0-9]{40}$/.test(sha) && run.head_sha === sha && run.status === 'completed' && run.conclusion === 'success' &&
    run.path === WORKFLOW && run.head_repository?.full_name === repository &&
    fresh(run.updated_at, now) && Number.isSafeInteger(run.id) && run.id > 0
}

export function nativeJobsPassed(jobs, sha, now = Date.now()) {
  return NATIVE_JOBS.every(name => {
    const matching = jobs.filter(job => job.name === name)
    return matching.length === 1 && matching[0].head_sha === sha && matching[0].status === 'completed' &&
      matching[0].conclusion === 'success' && fresh(matching[0].completed_at, now)
  })
}

export async function findNativeQualityEvidence({ repository, sha, now = Date.now(), api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid repository or exact head')
  // Failure to find proof always falls back to full native validation. Bound
  // discovery, and paginate jobs before deciding; a partial page is not proof.
  for (let page = 1; page <= 3; page++) {
    const runs = await api(`repos/${repository}/actions/workflows/pull-request-quality.yml/runs?head_sha=${sha}&status=success&per_page=100&page=${page}`)
    if (!Array.isArray(runs.workflow_runs)) throw new Error('Invalid workflow run response')
    for (const run of runs.workflow_runs) {
      if (!eligibleQualityRun(run, repository, sha, now)) continue
      const jobs = []
      let complete = false
      for (let jobPage = 1; jobPage <= 10; jobPage++) {
        const response = await api(`repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${jobPage}`)
        if (!Array.isArray(response.jobs)) throw new Error('Invalid workflow job response')
        jobs.push(...response.jobs)
        if (response.jobs.length < 100) { complete = true; break }
      }
      if (complete && nativeJobsPassed(jobs, sha, now)) return { runId: run.id, url: `https://github.com/${repository}/actions/runs/${run.id}`, sha, maxAgeHours: 24 }
    }
    if (runs.workflow_runs.length < 100) break
  }
  return null
}

async function main() {
  let evidence = null
  if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main') {
    try {
      evidence = await findNativeQualityEvidence({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
        api: path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })) })
    } catch (error) { console.warn(`Exact-head evidence unavailable; running full native validation: ${error.message}`) }
  }
  const message = evidence ? `Reusing successful Android and iOS checks for exact head ${evidence.sha}: ${evidence.url} (each completed within 24 hours).` : 'Full native validation required; no reusable exact-head Android/iOS proof was selected.'
  console.log(message)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${Boolean(evidence)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
}

if (process.argv[1]?.endsWith('native-quality-reuse.mjs')) await main()
