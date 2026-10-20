export type EphemerisSelectionFile = {
  id: string
  targets: readonly number[]
  core?: boolean
  dependencyOnly?: boolean
  solutionKernelIds?: readonly string[]
}

function indexFiles<T extends EphemerisSelectionFile>(files: readonly T[]) {
  if (!Array.isArray(files as unknown) || files.length > 4096) throw new Error('Invalid ephemeris file budget')
  const byId = new Map<string, T>()
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || !file.id) throw new Error('Invalid ephemeris file identity')
    if (byId.has(file.id)) throw new Error('Duplicate ephemeris file identity')
    if (!Array.isArray(file.targets) || file.targets.some(target => !Number.isSafeInteger(target))) throw new Error(`Invalid ephemeris targets ${file.id}`)
    if ((file.core !== undefined && typeof file.core !== 'boolean') ||
      (file.dependencyOnly !== undefined && typeof file.dependencyOnly !== 'boolean')) throw new Error(`Invalid ephemeris selection flag ${file.id}`)
    const pool = file.solutionKernelIds
    if (pool !== undefined && (!Array.isArray(pool) || pool.length > 4096 ||
      pool.some(id => typeof id !== 'string' || !id) || new Set(pool).size !== pool.length || pool.includes(file.id))) {
      throw new Error(`Invalid explicit SPK dependency pool ${file.id}`)
    }
    byId.set(file.id, file)
  }
  return byId
}

function dependencyClosure<T extends EphemerisSelectionFile>(byId: ReadonlyMap<string, T>, roots: Iterable<string>) {
  const wanted = new Set(roots)
  const visited = new Set<string>(), visiting = new Set<string>()
  // An explicit stack avoids making JavaScript call-stack depth a second,
  // undocumented limit on an otherwise admitted manifest's dependency chain.
  for (const root of wanted) {
    if (visited.has(root)) continue
    const rootFile = byId.get(root)
    if (!rootFile) throw new Error(`Unknown ephemeris file ${root}`)
    const stack: { file: T; next: number }[] = [{ file: rootFile, next: 0 }]
    visiting.add(root)
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const pool = frame.file.solutionKernelIds ?? []
      if (frame.next === pool.length) {
        visiting.delete(frame.file.id)
        visited.add(frame.file.id)
        stack.pop()
        continue
      }
      const id = pool[frame.next++]
      const file = byId.get(id)
      if (!file) throw new Error(`Missing declared ephemeris dependency ${id}`)
      wanted.add(id)
      if (visiting.has(id)) throw new Error(`Cyclic ephemeris dependency ${id}`)
      if (visited.has(id)) continue
      visiting.add(id)
      stack.push({ file, next: 0 })
    }
  }
  return wanted
}

/** Select a dependency-closed pool without changing source precedence or bytes.
 * Shared by preview generation and runtime loading; no coefficient evaluation. */
export function selectEphemerisFiles<T extends EphemerisSelectionFile>(files: readonly T[], targets: ReadonlySet<number>) {
  const byId = indexFiles(files)
  const roots = files.filter(file => !file.dependencyOnly &&
    (file.core || file.targets.some(target => targets.has(target)))).map(file => file.id)
  const wanted = dependencyClosure(byId, roots)
  return files.filter(file => wanted.has(file.id))
}

/** A worker request pins an exact pool. Check closure without adding sources. */
export function exactEphemerisFiles<T extends EphemerisSelectionFile>(files: readonly T[], ids: readonly string[]) {
  if (!Array.isArray(ids as unknown) || ids.length > 4096 || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid requested ephemeris file identities')
  const byId = indexFiles(files)
  const requested = new Set(ids)
  const closure = dependencyClosure(byId, requested)
  for (const id of closure) {
    if (!requested.has(id)) throw new Error(`Requested ephemeris pool omits dependency ${id}`)
  }
  return files.filter(file => requested.has(file.id))
}
