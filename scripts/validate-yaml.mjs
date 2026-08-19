import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { parseDocument } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const githubRoot = join(root, '.github')

async function yamlFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await yamlFiles(path))
    else if (/\.ya?ml$/i.test(entry.name)) files.push(path)
  }
  return files
}

let failed = false
for (const path of [...await yamlFiles(githubRoot), join(root, 'CITATION.cff')]) {
  const document = parseDocument(await readFile(path, 'utf8'), { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length) {
    failed = true
    for (const error of document.errors) process.stderr.write(`${relative(root, path)}: ${error.message}\n`)
  }
}

if (failed) process.exitCode = 1
else process.stdout.write('GitHub YAML parsed successfully.\n')
