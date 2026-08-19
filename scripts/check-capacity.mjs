import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2] ?? 'dist/capacity-report.json'
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const mib = (value) => `${(value / 1024 / 1024).toFixed(1)} MiB`

process.stdout.write(`Artifact ${mib(report.distTotalBytes)} · shell ${mib(report.applicationShellBytes)} · dataset ${mib(report.datasetTotalBytes)} · typical catalog session ${mib(report.typicalCatalogSessionBytes)}\n`)
if (!report.withinBudget) {
  throw new Error(`Pages artifact exceeds ${mib(report.thresholds.maximumBytes)} budget`)
}
if (report.warning) process.stderr.write(`Warning: artifact exceeds ${mib(report.thresholds.warningBytes)} internal warning threshold\n`)
