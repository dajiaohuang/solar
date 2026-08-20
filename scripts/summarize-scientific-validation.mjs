import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = resolve(root, '.cache')
const testReport = JSON.parse(await readFile(resolve(cache, 'scientific-tests.json'), 'utf8'))
const horizons = JSON.parse(await readFile(resolve(root, 'tests/fixtures/jpl-horizons-events.json'), 'utf8'))
const lambert = JSON.parse(await readFile(resolve(root, 'tests/fixtures/lambert-benchmarks.json'), 'utf8'))

const suites = testReport.testResults.map((suite) => ({
  file: suite.name.replaceAll('\\', '/').split('/').slice(-2).join('/'),
  passed: suite.status === 'passed',
  tests: suite.assertionResults.map((test) => ({ name: test.fullName, status: test.status, durationMs: test.duration ?? null })),
}))

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  passed: Boolean(testReport.success),
  runner: { node: process.version, totalTests: testReport.numTotalTests, passedTests: testReport.numPassedTests, failedTests: testReport.numFailedTests },
  modelWindow: { planetaryApproximation: '1800-01-01/2050-12-31', outsideWindow: 'explicitly-labelled-extrapolation' },
  benchmarks: {
    horizonsEvents: {
      passed: suites.find((suite) => suite.file.endsWith('event-benchmarks.test.ts'))?.passed ?? false,
      count: horizons.events.length,
      source: horizons.source,
      sourceUrl: horizons.queryUrl,
      tolerances: horizons.events.map((event) => ({ bodyId: event.bodyId, kind: event.kind, timeToleranceDays: event.timeToleranceDays, valueToleranceAU: event.distanceToleranceAu })),
    },
    lambert: {
      passed: suites.find((suite) => suite.file.endsWith('lambert.test.ts'))?.passed ?? false,
      count: lambert.cases.length,
      source: lambert.source,
      residualContract: 'converged solutions require an absolute universal-variable residual below 1e-10 in solver tests',
    },
    ephemeris: {
      passed: suites.find((suite) => suite.file.endsWith('ephemeris.test.ts'))?.passed ?? false,
      contract: 'elliptic propagation, explicit non-elliptic rejection, parent resolution, and reference-frame translation',
    },
  },
  suites,
}

await mkdir(cache, { recursive: true })
await writeFile(resolve(cache, 'scientific-validation.json'), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`Scientific validation: ${report.runner.passedTests}/${report.runner.totalTests} passed.\n`)
