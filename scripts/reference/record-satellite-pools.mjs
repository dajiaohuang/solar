// Explicit independent CSPICE run across every newly integrated root and its
// original ordered source dependencies. No application evaluator is called.
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const [output, command, ...args] = process.argv.slice(2)
if (!output || !command) throw new Error('New reference output and oracle command required')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = await readFile('src/data/ephemeris-manifest-full.json')
const manifest = JSON.parse(manifestBytes)
const byId = new Map(manifest.files.map(file => [file.id, file]))
const contexts = [], requests = []
for (const root of manifest.files.filter(file => file.solutionKernelIds && !file.dependencyOnly)) {
  const pool = [...root.solutionKernelIds.map(id => byId.get(id)), root]
  if (pool.some(file => !file || !/^[\w.-]+\.bsp$/.test(file.path))) throw new Error('Invalid reference pool')
  for (const file of pool) {
    const bytes = await readFile(`public/data/ephemerides/${file.path}`)
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Reference input hash mismatch')
  }
  const index = contexts.length
  contexts.push({ rootId: root.id, files: pool.map(file => ({ id: file.id, path: file.path, sha256: file.sha256 })) })
  for (const target of root.targets) for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
    requests.push({ context: index, target, et, line: `${target} ${et} ${pool.length} ${pool.map(file => file.path).join(' ')}` })
  }
}
const oracle = spawnSync(command, args, { input: requests.map(request => request.line).join('\n') + '\n', encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
if (oracle.status !== 0) throw new Error(`Independent oracle failed: ${oracle.stderr || oracle.stdout || oracle.error}`)
const states = oracle.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
if (states.length !== requests.length || states.some(state => [state.heliocentric, state.barycentric].some(values => !Array.isArray(values) || values.length !== 6 || !values.every(Number.isFinite)))) throw new Error('Invalid independent states')
const result = { oracle: 'CSPICE N0067 spkgeo_c', oracleSourceSha256: digest(await readFile(new URL('./spk-pool-oracle.c', import.meta.url))),
  manifestSha256: digest(manifestBytes), frame: 'ECLIPJ2000', timeScale: 'TDB seconds past J2000', positionUnit: 'km', velocityUnit: 'km/s',
  contract: 'Independent original-kernel numerical parity at three epochs per integrated root. Not continuous physical uncertainty, all dates, or one global fit.',
  contexts, samples: requests.map(({ line: _line, ...request }, index) => ({ ...request, ...states[index] })) }
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(`${contexts.length} source pools, ${states.length} independent six-vector sample pairs`)
