import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export function requiresFullWebQuality(paths) {
  return paths.some(path => !(
    path.endsWith('.md') ||
    path.startsWith('docs/') ||
    path === 'LICENSE' ||
    path === 'CITATION.cff' ||
    path.startsWith('.github/ISSUE_TEMPLATE/') ||
    path === '.github/pull_request_template.md'
  ))
}

export function pullRequestQualityPasses(repositoryContract, webQuality) {
  return repositoryContract === 'success' && (webQuality === 'success' || webQuality === 'skipped')
}

function classify(baseSha, headSha) {
  if (!baseSha || !headSha || !process.env.GITHUB_OUTPUT) throw new Error('Classification requires base SHA, head SHA, and GITHUB_OUTPUT')
  const paths = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACDMRT', baseSha, headSha], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
  const full = requiresFullWebQuality(paths)
  appendFileSync(process.env.GITHUB_OUTPUT, `full_web_quality=${full}\n`)
  process.stdout.write(`${full ? 'Full Web quality required' : 'Repository contract only'} for ${paths.length} changed path(s).\n`)
}

function gate() {
  const repositoryContract = process.env.REPOSITORY_CONTRACT_RESULT
  const webQuality = process.env.WEB_QUALITY_RESULT
  if (!pullRequestQualityPasses(repositoryContract, webQuality)) {
    throw new Error(`Pull request quality failed: repository-contract=${repositoryContract}, web-quality=${webQuality}`)
  }
  process.stdout.write(`Pull request quality passed: repository-contract=${repositoryContract}, web-quality=${webQuality}.\n`)
}

try {
  if (process.argv[2] === 'classify') classify(process.argv[3], process.argv[4])
  else if (process.argv[2] === 'gate') gate()
  else if (process.argv[1]?.endsWith('pr-quality-contract.mjs')) throw new Error('Expected "classify <base> <head>" or "gate"')
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
