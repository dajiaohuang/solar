import { expect, it } from 'vitest'
import { exactEphemerisFiles, selectEphemerisFiles } from '../../src/data/ephemerisSelection'

const files = [
  { id: 'core', targets: [], core: true, solutionKernelIds: ['shared'] },
  { id: 'target-a', targets: [42], solutionKernelIds: ['shared'] },
  { id: 'target-b', targets: [43], dependencyOnly: true, solutionKernelIds: ['shared'] },
  { id: 'shared', targets: [99], dependencyOnly: true },
  { id: 'unused', targets: [44] },
]

it('selects a dependency-closed target pool in manifest order', () => {
  expect(selectEphemerisFiles(files, new Set([42])).map(file => file.id)).toEqual(['core', 'target-a', 'shared'])
})

it('requires worker-pinned pools to include every declared dependency', () => {
  expect(() => exactEphemerisFiles(files, ['target-a'])).toThrow('omits dependency shared')
  expect(exactEphemerisFiles(files, ['target-a', 'shared']).map(file => file.id)).toEqual(['target-a', 'shared'])
  expect(() => exactEphemerisFiles(files, ['unknown'])).toThrow('Unknown ephemeris file unknown')
})

it('rejects cyclic and duplicate manifest identities', () => {
  const cyclic = [
    { id: 'a', targets: [], core: true, solutionKernelIds: ['b'] },
    { id: 'b', targets: [], dependencyOnly: true, solutionKernelIds: ['a'] },
  ]
  expect(() => selectEphemerisFiles(cyclic, new Set())).toThrow('Cyclic ephemeris dependency')
  expect(() => exactEphemerisFiles(cyclic, ['a', 'b'])).toThrow('Cyclic ephemeris dependency')
  expect(() => selectEphemerisFiles([files[0], files[0]], new Set())).toThrow('Duplicate ephemeris file identity')
})
