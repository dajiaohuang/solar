import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2] ?? 'dist/capacity-report.json'
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const mib = (value) => `${(value / 1024 / 1024).toFixed(1)} MiB`
const gaiaSummary = Number.isSafeInteger(report.gaiaSkyBytes) && report.gaiaSkyBytes >= 0
  && Number.isSafeInteger(report.gaiaSkyFileCount) && report.gaiaSkyFileCount >= 0
  ? `${mib(report.gaiaSkyBytes)} / ${report.gaiaSkyFileCount} files`
  : 'n/a'

process.stdout.write([
  `Artifact ${mib(report.distTotalBytes)}`,
  `shell ${mib(report.applicationShellBytes)}`,
  `asteroid data ${mib(report.datasetTotalBytes)}`,
  `ephemerides ${mib(report.ephemerisTotalBytes)}`,
  `Gaia ${gaiaSummary}`,
  `typical catalog session ${mib(report.typicalCatalogSessionBytes)}`,
].join(' · ') + '\n')
if (!report.withinBudget) {
  throw new Error(`Pages artifact exceeds ${mib(report.thresholds.maximumBytes)} budget`)
}
if (report.warning) process.stderr.write(`Warning: artifact exceeds ${mib(report.thresholds.warningBytes)} internal warning threshold\n`)
