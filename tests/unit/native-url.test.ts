import { describe, expect, it } from 'vitest'
import { resolveNativeSceneLocation } from '../../src/lib/nativeUrl'

describe('native scene links', () => {
  it('maps the custom scene scheme onto the installed shell path', () => {
    expect(resolveNativeSceneLocation(
      'solaratlas://scene?v=4&page=explorer&ref=mars#details',
      '/index.html',
    )).toBe('/index.html?v=4&page=explorer&ref=mars#details')
  })

  it('accepts canonical public scene links', () => {
    expect(resolveNativeSceneLocation(
      'https://dajiaohuang.github.io/solar/?v=4&page=stories',
      '/',
    )).toBe('/?v=4&page=stories')
  })

  it('rejects lookalike, unrelated, and malformed links', () => {
    expect(resolveNativeSceneLocation('https://example.com/solar/?v=4', '/')).toBeNull()
    expect(resolveNativeSceneLocation('solaratlas://other?v=4', '/')).toBeNull()
    expect(resolveNativeSceneLocation('not a url', '/')).toBeNull()
  })
})
