import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const root = resolve(import.meta.dirname, '..')

function fail(message) {
  throw new Error(message)
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function json(path) {
  return JSON.parse(read(path))
}

function stripCode(markdown) {
  return markdown
    .replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1\s*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
}

export function markdownLinks(markdown) {
  const source = stripCode(markdown)
  const links = []
  const inline = /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  const definition = /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm
  for (const match of source.matchAll(inline)) links.push(match[1])
  for (const match of source.matchAll(definition)) links.push(match[1])
  return links
}

export function markdownAnchors(markdown) {
  const anchors = new Set()
  const counts = new Map()
  for (const match of stripCode(markdown).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]*>/g, '')
      .normalize('NFKD')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    anchors.add(count ? `${base}-${count}` : base)
  }
  return anchors
}

function validateMarkdown() {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean)
  const failures = []

  for (const file of files) {
    const markdown = read(file)
    for (let target of markdownLinks(markdown)) {
      target = target.replace(/^<|>$/g, '')
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue

      const hashIndex = target.indexOf('#')
      const rawPath = (hashIndex === -1 ? target : target.slice(0, hashIndex)).split('?')[0]
      const rawFragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1)
      let decodedPath
      let fragment
      try {
        decodedPath = decodeURIComponent(rawPath)
        fragment = decodeURIComponent(rawFragment).toLowerCase()
      } catch {
        failures.push(`${file}: invalid URL encoding in ${target}`)
        continue
      }

      const absolute = decodedPath ? resolve(root, dirname(file), decodedPath) : resolve(root, file)
      const relativeTarget = relative(root, absolute)
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
        failures.push(`${file}: local link escapes the repository: ${target}`)
        continue
      }
      if (!existsSync(absolute)) {
        failures.push(`${file}: missing local link target ${target}`)
        continue
      }
      if (fragment && statSync(absolute).isFile() && /\.md$/i.test(absolute)) {
        const anchors = markdownAnchors(readFileSync(absolute, 'utf8'))
        if (!anchors.has(fragment)) failures.push(`${file}: missing Markdown anchor ${target}`)
      }
    }
  }

  if (failures.length) fail(failures.join('\n'))
  return files.length
}

function matchOne(source, expression, label) {
  const match = source.match(expression)
  if (!match) fail(`Unable to read ${label}`)
  return match[1]
}

function validateIdentity() {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  if (lock.name !== pkg.name || lock.version !== pkg.version) fail('package-lock.json root identity does not match package.json')
  if (lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== pkg.version) {
    fail('package-lock.json package identity does not match package.json')
  }

  const citation = parseDocument(read('CITATION.cff'), { prettyErrors: true, uniqueKeys: true })
  if (citation.errors.length) fail(`CITATION.cff: ${citation.errors.map(error => error.message).join('; ')}`)
  if (String(citation.get('version')) !== pkg.version) fail('CITATION.cff version does not match package.json')
  if (!read('README.md').includes(`Application version: **v${pkg.version}**`)) fail('README.md application version does not match package.json')
  if (!read('README-CN.md').includes(`应用版本：**v${pkg.version}**`)) fail('README-CN.md application version does not match package.json')

  const capacitorId = matchOne(read('capacitor.config.ts'), /appId:\s*['"]([^'"]+)['"]/, 'Capacitor app ID')
  const androidId = matchOne(read('android/app/build.gradle'), /applicationId\s+['"]([^'"]+)['"]/, 'Android application ID')
  const iosIds = [...read('ios/App/App.xcodeproj/project.pbxproj').matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map(match => match[1].trim())
  if (!iosIds.length || androidId !== capacitorId || iosIds.some(id => id !== capacitorId)) fail('Native application IDs do not match capacitor.config.ts')

  const androidVersion = matchOne(read('android/app/build.gradle'), /versionName\s+['"]([^'"]+)['"]/, 'Android version')
  const iosVersions = [...read('ios/App/App.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)].map(match => match[1].trim())
  if (androidVersion !== pkg.version || !iosVersions.length || iosVersions.some(version => version !== pkg.version)) {
    fail('Native application versions do not match package.json')
  }

  return { name: pkg.name, version: pkg.version, appId: capacitorId }
}

export function validateRepository() {
  const markdownFileCount = validateMarkdown()
  const identity = validateIdentity()
  return { markdownFileCount, ...identity }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = validateRepository()
    process.stdout.write(`Repository contract valid: ${result.markdownFileCount} Markdown files; ${result.name} ${result.version}; ${result.appId}.\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
