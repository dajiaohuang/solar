#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateInventory } from './validate-body-inventory.mjs'
import { inventoryKernels } from './lib/inventory-kernels.mjs'
import { createIdentityLedger } from './lib/body-identity-ledger.mjs'
import { analyzeKernelWindow } from './lib/kernel-window-coverage.mjs'
import { digest } from './lib/inventory-snapshot.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function auditBodyCoverage({ inventory, sources, output, root = ROOT, profile = 'full', auditEt = 841752000, startEt, endEt }) {
  if (!Number.isFinite(auditEt) || !Number.isFinite(startEt) || !Number.isFinite(endEt) || startEt > endEt) throw new Error('Finite ordered TDB window and audit epoch required')
  if (!output || resolve(output) === resolve(inventory) || (sources && resolve(output) === resolve(sources))) throw new Error('A separate new output directory is required')
  const kernels = await inventoryKernels(root, auditEt, profile)
  const identities = createIdentityLedger()
  const verified = await validateInventory(inventory, sources, { onRecord(record, ordinal) {
    // The input can have audited a different delivery profile. Never inherit its
    // previous NAIF/state claims when an explicit current mapping is absent.
    const fresh = { ...record }
    delete fresh.naifId; delete fresh.kernelEvidence; delete fresh.ephemerisStatus; delete fresh.identityMappingEvidence
    identities.add(kernels.attach(fresh), ordinal)
  } })
  const identity = identities.finish()
  if (!verified.snapshotSha256) throw new Error('Coverage audit requires a pinned source snapshot')
  if (identity.counts.sourceRecords !== verified.recordsVerified) throw new Error('Identity ledger lost source rows')
  const windows = identity.explicitTargetGroups.map(({ target }) => analyzeKernelWindow({ kernels: kernels.descriptors, target, startEt, endEt }))
  const windowCounts = {
    dependencyCoveredTargets: windows.filter(window => window.gaps.length === 0).length,
    targetsWithDependencyGaps: windows.filter(window => window.gaps.length > 0).length,
    numericallyCertifiedWholeWindowTargets: null,
  }
  const generator = []
  for (const path of ['scripts/audit-body-coverage.mjs', 'scripts/validate-body-inventory.mjs', 'scripts/lib/body-identity-ledger.mjs',
    'scripts/lib/inventory-kernels.mjs', 'scripts/lib/kernel-window-coverage.mjs', 'scripts/lib/inventory-snapshot.mjs',
    'src/engine/ephemeris/kernelPool.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts',
    'src/engine/ephemeris/spkType21.ts', 'src/data/ephemerisTargets.ts', 'src/data/ephemerisProfile.ts']) {
    generator.push({ path, sha256: digest(await readFile(join(ROOT, path))) })
  }
  const report = { schemaVersion: 1, purpose: 'source-identity-and-dependency-window-audit',
    inputInventorySha256: verified.manifestSha256, sourceSnapshotSha256: verified.snapshotSha256, sourceBytesVerified: Boolean(sources),
    generator, kernels: kernels.evidence, requestedWindow: { startEt, endEt, timeScale: 'TDB seconds past J2000' },
    identity, windowCounts, windows,
    limitations: [
      'Explicit NAIF target groups are not an all-source unique physical-body count. Unmapped, unresolved and candidate records stay in the pinned input inventory.',
      'State availability is evaluated only at auditEt. Window atoms certify descriptor and center dependency availability, not continuous numerical accuracy or observational uncertainty.',
      'No SPK coefficients, new orbital solutions, N-body integration, extrapolation or approximate replacement states are created.',
    ] }
  await mkdir(output)
  await writeFile(join(output, 'README.md'), `# Identity and dependency-window audit\n\n` +
    `Input inventory SHA-256: ${report.inputInventorySha256}\n\n` +
    `Profile: ${kernels.evidence.profile}; audit epoch: ${auditEt} TDB seconds past J2000.\n\n` +
    `Source records: ${identity.counts.sourceRecords}; explicit NAIF targets: ${identity.counts.explicitNaifTargets}; unresolved source records: ${identity.counts.unresolvedSourceRecords}.\n\n` +
    `Targets with a state at the audit epoch: ${identity.counts.availableTargetsAtAuditEpoch}.\n\n` +
    `Requested TDB window: [${startEt}, ${endEt}]. Dependency-covered targets: ${windowCounts.dependencyCoveredTargets}; targets with dependency gaps: ${windowCounts.targetsWithDependencyGaps}.\n\n` +
    `Whole-window numerical accuracy remains unverified. See report.json for source ordinals, mapping/profile hashes, boundary points and open-interval evidence.\n`, { flag: 'wx' })
  // Completion marker last; a failed source validation never publishes a ledger.
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = new Map()
  if (args.includes('--help')) {
    console.log('node --experimental-strip-types scripts/audit-body-coverage.mjs --inventory DIR [--sources DIR] --output NEW_DIR --start-et TDB_SECONDS --end-et TDB_SECONDS [--profile full|pages] [--audit-et TDB_SECONDS]')
  } else {
    for (let i = 0; i < args.length; i += 2) {
      if (!['--inventory', '--sources', '--output', '--start-et', '--end-et', '--profile', '--audit-et'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || values.has(args[i])) throw new Error('Unknown, duplicate or incomplete argument; use --help')
      values.set(args[i], args[i + 1])
    }
    if (['--inventory', '--output', '--start-et', '--end-et'].some(key => !values.has(key))) throw new Error('Inventory, new output and explicit TDB window are required')
    const report = await auditBodyCoverage({ inventory: resolve(values.get('--inventory')), sources: values.has('--sources') ? resolve(values.get('--sources')) : undefined,
      output: resolve(values.get('--output')), profile: values.get('--profile') ?? 'full', startEt: Number(values.get('--start-et')), endEt: Number(values.get('--end-et')),
      auditEt: values.has('--audit-et') ? Number(values.get('--audit-et')) : undefined })
    console.log(JSON.stringify({ identity: report.identity.counts, windows: report.windowCounts, inputInventorySha256: report.inputInventorySha256 }, null, 2))
  }
}
