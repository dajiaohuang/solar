// Explicit metadata archive for an independently selected official source.
// Does not pick a solution, download all coefficient data, or add body states.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openSource } from './crop-spk.mjs'
import { surveySpkSource, replaySpkSurvey } from './lib/spk-source-survey.mjs'

const [url, directory] = process.argv.slice(2)
if (!url || !directory) throw new Error('Usage: node scripts/archive-spk-source.mjs OFFICIAL_SPK_URL NEW_DIRECTORY')
const parsed = new URL(url)
if (parsed.protocol !== 'https:' || !['naif.jpl.nasa.gov', 'ssd.jpl.nasa.gov'].includes(parsed.hostname) || parsed.username || parsed.password || !parsed.pathname.endsWith('.bsp')) throw new Error('Explicit official HTTPS SPK URL required')
await mkdir(directory)
const source = await openSource(url)
try {
  const survey = await surveySpkSource(source, (start, bytes) => writeFile(join(directory, `source-range-${start}.bin`), bytes, { flag: 'wx' }))
  const record = { id: 'source', url, ...survey }
  await replaySpkSurvey(directory, 'source', record)
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
  await writeFile(join(directory, 'source.json'), bytes, { flag: 'wx' })
  console.log(JSON.stringify({ directory, id: 'source', sha256: createHash('sha256').update(bytes).digest('hex'), targets: record.targets }))
} finally { await source.close() }
