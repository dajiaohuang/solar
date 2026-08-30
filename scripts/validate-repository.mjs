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

function stripFencedCode(markdown) {
  const output = []
  let fence = null
  for (const line of markdown.split(/(?<=\n)/)) {
    const content = line.replace(/\r?\n$/, '')
    if (!fence) {
      const opening = content.match(/^ {0,3}(`{3,}|~{3,})/)
      if (opening) fence = { marker: opening[1][0], length: opening[1].length }
      else output.push(line)
      continue
    }
    const closing = content.match(/^ {0,3}(`+|~+)\s*$/)
    if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null
  }
  return output.join('')
}

function codeSpanEnd(source, start) {
  let length = 1
  while (source[start + length] === '`') length += 1
  const delimiter = '`'.repeat(length)
  const closing = source.indexOf(delimiter, start + length)
  return closing === -1 ? start + length : closing + length
}

function closingBracket(source, start) {
  let depth = 1
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source[index] === '`') {
      index = codeSpanEnd(source, index) - 1
      continue
    }
    if (source[index] === '[') depth += 1
    else if (source[index] === ']' && --depth === 0) return index
  }
  return -1
}

function inlineDestination(source, open) {
  function closeAfter(index) {
    while (/\s/.test(source[index] ?? '')) index += 1
    if (source[index] === ')') return index + 1
    const opener = source[index]
    const closer = opener === '(' ? ')' : opener
    if (!['"', "'", '('].includes(opener)) return -1
    let depth = 1
    for (index += 1; index < source.length; index += 1) {
      if (source[index] === '\\') {
        index += 1
        continue
      }
      if (opener === '(' && source[index] === '(') depth += 1
      else if (source[index] === closer && --depth === 0) {
        index += 1
        while (/\s/.test(source[index] ?? '')) index += 1
        return source[index] === ')' ? index + 1 : -1
      }
    }
    return -1
  }

  let index = open + 1
  while (/\s/.test(source[index] ?? '')) index += 1
  if (source[index] === '<') {
    const end = source.indexOf('>', index + 1)
    const close = end === -1 ? -1 : closeAfter(end + 1)
    return close === -1 ? null : { target: source.slice(index + 1, end), end: close }
  }

  const start = index
  let depth = 0
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '(') depth += 1
    else if (source[index] === ')') {
      if (depth === 0) return { target: source.slice(start, index), end: index + 1 }
      depth -= 1
    } else if (/\s/.test(source[index]) && depth === 0) {
      const close = closeAfter(index)
      return close === -1 ? null : { target: source.slice(start, index), end: close }
    }
    index += 1
  }
  return null
}

export function markdownLinks(markdown) {
  const source = stripFencedCode(markdown)
  const links = []
  const definition = /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '`') {
      index = codeSpanEnd(source, index) - 1
      continue
    }
    if (source[index] !== '[') continue
    const bracket = closingBracket(source, index)
    if (bracket === -1) continue
    let open = bracket + 1
    while (/\s/.test(source[open] ?? '')) open += 1
    if (source[open] !== '(') continue
    const destination = inlineDestination(source, open)
    if (destination?.target) links.push(destination.target)
    index = destination?.end ? destination.end - 1 : bracket
  }
  for (const match of source.matchAll(definition)) links.push(match[1])
  return links
}

function headingText(markdown) {
  return markdown.replace(/(`+)(.*?)\1/g, '$2')
}

export function markdownAnchors(markdown) {
  const anchors = new Set()
  const counts = new Map()
  for (const match of stripFencedCode(markdown).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = headingText(match[1])
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

export function assertDocumentedVersion(markdown, expected, language) {
  const source = language === 'zh'
    ? '^应用版本：\\s*\\*\\*v([^*\\n]+)\\*\\*(?:\\s*·.*)?$'
    : '^Application version:\\s*\\*\\*v([^*\\n]+)\\*\\*(?:\\s*·.*)?$'
  const expression = new RegExp(source, 'gm')
  const versions = [...markdown.matchAll(expression)].map(match => match[1].trim())
  const filename = language === 'zh' ? 'README-CN.md' : 'README.md'
  if (versions.length !== 1) fail(`${filename} must contain exactly one canonical application-version line`)
  if (versions[0] !== expected) fail(`${filename} application version does not match package.json`)

  const lines = markdown.split(/\r?\n/)
  const versionLine = lines.findIndex(line => new RegExp(source).test(line))
  const firstSection = lines.findIndex(line => /^##\s+/.test(line))
  if (versionLine < 0 || versionLine >= 15 || (firstSection >= 0 && versionLine >= firstSection)) {
    fail(`${filename} canonical application version must remain in the opening metadata block`)
  }
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
  assertDocumentedVersion(read('README.md'), pkg.version, 'en')
  assertDocumentedVersion(read('README-CN.md'), pkg.version, 'zh')

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
