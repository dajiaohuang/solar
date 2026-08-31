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

export function requiresNativeQuality(paths) {
  return paths.some(path => (
    path.startsWith('android/') ||
    path.startsWith('ios/') ||
    path.startsWith('resources/') ||
    path.startsWith('src/') ||
    path.startsWith('scripts/') ||
    path.startsWith('public/') ||
    path === 'index.html' ||
    /^tsconfig[^/]*\.json$/.test(path) ||
    path === 'capacitor.config.ts' ||
    path === 'package.json' ||
    path === 'package-lock.json' ||
    path === 'vite.config.ts' ||
    path === '.github/workflows/mobile.yml' ||
    path === '.github/workflows/pull-request-quality.yml'
  ))
}

function applicableJobPassed(result) {
  return result === 'success' || result === 'skipped'
}

export function pullRequestQualityPasses(repositoryContract, webQuality, mobileQuality) {
  return repositoryContract === 'success' &&
    applicableJobPassed(webQuality) &&
    applicableJobPassed(mobileQuality)
}

export function changedPaths(baseSha, headSha, cwd = process.cwd()) {
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '--diff-filter=ACDMRT', baseSha, headSha], { cwd, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
}

function classify(baseSha, headSha) {
  if (!baseSha || !headSha || !process.env.GITHUB_OUTPUT) throw new Error('Classification requires base SHA, head SHA, and GITHUB_OUTPUT')
  const paths = changedPaths(baseSha, headSha)
  const full = requiresFullWebQuality(paths)
  const native = requiresNativeQuality(paths)
  appendFileSync(process.env.GITHUB_OUTPUT, `full_web_quality=${full}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `native_quality=${native}\n`)
  process.stdout.write(`Web quality ${full ? 'required' : 'skipped'}; native quality ${native ? 'required' : 'skipped'} for ${paths.length} changed path(s).\n`)
}

function gate() {
  const repositoryContract = process.env.REPOSITORY_CONTRACT_RESULT
  const webQuality = process.env.WEB_QUALITY_RESULT
  const mobileQuality = process.env.MOBILE_QUALITY_RESULT
  if (!pullRequestQualityPasses(repositoryContract, webQuality, mobileQuality)) {
    throw new Error(`Pull request quality failed: repository-contract=${repositoryContract}, web-quality=${webQuality}, mobile-quality=${mobileQuality}`)
  }
  process.stdout.write(`Pull request quality passed: repository-contract=${repositoryContract}, web-quality=${webQuality}, mobile-quality=${mobileQuality}.\n`)
}

try {
  if (process.argv[2] === 'classify') classify(process.argv[3], process.argv[4])
  else if (process.argv[2] === 'gate') gate()
  else if (process.argv[1]?.endsWith('pr-quality-contract.mjs')) throw new Error('Expected "classify <base> <head>" or "gate"')
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
