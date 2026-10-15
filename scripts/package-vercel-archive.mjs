import { packApproximationArchive } from './lib/approximation-archive.mjs'
const [root, destination] = process.argv.slice(2)
if (!root || !destination) throw new Error('Use SOURCE_APPROXIMATION_DIRECTORY NEW_ARCHIVE.ndjson.gz')
console.log(JSON.stringify({ archive: destination, ...await packApproximationArchive(root, destination) }, null, 2))
