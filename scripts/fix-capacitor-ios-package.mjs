import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packagePath = resolve('ios/App/CapApp-SPM/Package.swift')
let source = await readFile(packagePath, 'utf8')
source = source.replaceAll('\\', '/')
source = source.replace('.iOS(.v15)', '.iOS(.v16)')
await writeFile(packagePath, source)
process.stdout.write('Normalized Capacitor iOS package paths\n')
