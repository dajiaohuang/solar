import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packagePath = resolve('ios/App/CapApp-SPM/Package.swift')
let source = await readFile(packagePath, 'utf8')
source = source.replaceAll('\\', '/')
source = source.replace('.iOS(.v15)', '.iOS(.v16)')
const capacitorDependency = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),'
const filesystemDependency = '.package(url: "https://github.com/ionic-team/ion-ios-filesystem.git", exact: "1.1.2"),'
if (!source.includes(filesystemDependency)) {
  source = source.replace(capacitorDependency, `${capacitorDependency}\n        ${filesystemDependency}`)
}
if (!source.includes(filesystemDependency)) throw new Error('Unable to pin ion-ios-filesystem 1.1.2')
await writeFile(packagePath, source)
process.stdout.write('Normalized Capacitor iOS package paths and dependency pins\n')
