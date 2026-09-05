import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// This checks packaging/source wiring, not compilation or device performance.
const read = path => readFile(path, 'utf8')
const project = await read('ios/App/App.xcodeproj/project.pbxproj')
const scheme = await read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme')
const target = project.match(/([A-F0-9]{24}) \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/)?.[1]
if (!target || !scheme.includes(`BlueprintIdentifier="${target}"`) || !scheme.includes('BuildableName="App.app"') || !scheme.includes('ReferencedContainer="container:App.xcodeproj"')) {
  throw new Error('Shared Xcode App scheme does not select the native application target')
}
const scene = await read('ios/App/App/SceneDelegate.swift')
const android = await read('android/app/build.gradle')
const activity = await read('android/app/src/main/java/io/github/dajiaohuang/solaratlas/MainActivity.java')
if (/CapApp-SPM|public in Resources|capacitor\.config|Main\.storyboard/.test(project)) throw new Error('iOS still packages the Web shell')
if (!scene.includes('UIHostingController(rootView: ObservationDeckView())')) throw new Error('iOS native Observation Deck is not the scene root')
if (/BridgeActivity|WebView/.test(activity) || /implementation project\(':capacitor/.test(android)) throw new Error('Android still embeds the Web shell')
for (const source of ['NativeObservationDeck.swift', 'StateTileDecoder.swift', 'StateTileCache.swift', 'StateTileService.swift', 'NativeStateProjection.swift']) {
  if (!project.includes(`${source} in Sources`)) throw new Error(`iOS source is not in its build target: ${source}`)
  await read(`ios/App/App/${source}`)
}
if (!project.includes('productType = "com.apple.product-type.bundle.ui-testing"') ||
    !project.includes('ObservationUITests.swift in Sources') ||
    !scheme.includes('BuildableName="ObservationUITests.xctest"')) {
  throw new Error('Native iOS UI tests must remain wired into the App scheme')
}
await read('ios/App/ObservationUITests/ObservationUITests.swift')
const definitions = new Set([...project.matchAll(/^\s*([A-F0-9]{24})\s+(?:\/\*.*?\*\/\s*)?=\s*\{/gm)].map(match => match[1]))
for (const match of project.matchAll(/\b[A-F0-9]{24}\b/g)) {
  if (!definitions.has(match[0])) throw new Error(`Dangling Xcode project reference: ${match[0]}`)
}
async function rejectPackagedKernels(path) {
  for (const entry of await readdir(path, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await rejectPackagedKernels(child)
    else if (/\.(bsp|spk)$/i.test(entry.name)) throw new Error(`Native resource contains a kernel: ${child}`)
  }
}
await rejectPackagedKernels('android/app/src/main/assets')
await rejectPackagedKernels('ios/App/App/public')
process.stdout.write('Native source/packaging contract passed; platform compilation and protocol tests are separate gates.\n')
