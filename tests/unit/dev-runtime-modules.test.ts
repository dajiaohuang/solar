import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createServer } from 'vite'

it('serves scientific registry dependencies through browser URLs under the application base', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Development server did not bind a TCP port')
    const origin = `http://127.0.0.1:${address.port}`
    let dependencies = 0
    for (const name of ['selectedEphemerisManifest.ts', 'ephemerisBodies.json?import', 'satelliteCatalog.json?import']) {
      const response = await fetch(`${origin}/solar/src/data/${name}`)
      expect(response.status).toBe(200)
      const code = await response.text()
      expect(code).toMatch(/export /)
      for (const [, specifier] of code.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
        const url = new URL(specifier, response.url)
        expect(url.origin).toBe(origin)
        expect(url.pathname).toMatch(/^\/solar\//)
        const dependency = await fetch(url)
        expect(dependency.status).toBe(200)
        expect(dependency.headers.get('content-type')).toContain('javascript')
        dependencies++
      }
    }
    expect(dependencies).toBeGreaterThan(0)
  } finally {
    await server.close()
  }
}, 20_000)
