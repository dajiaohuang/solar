/// <reference lib="webworker" />
import { decodeGaiaManifest, gaiaHash, streamGaiaChunks } from '../lib/gaiaChunks'
import { projectGaiaDisplay } from '../lib/gaiaProjection'
import { readBounded } from '../lib/stateTiles'
const scope = self as unknown as DedicatedWorkerGlobalScope
let acknowledge: (() => void) | undefined, started = false, sequence = 0
scope.onmessage = async event => {
  if (event.data.type === 'ack') { if (event.data.sequence === sequence) { acknowledge?.(); acknowledge = undefined }; return }
  if (started) return
  started = true
  try {
    const { manifestUrl, files } = event.data as { manifestUrl?: string; files?: File[] }
    const controller = new AbortController()
    const local = new Map<string, File>((files ?? []).map(f => [f.name, f]))
    let bytes: Uint8Array, base: string
    if (files) {
      const manifest = local.get('manifest.json')
      if (files.length > 2593 || local.size !== files.length || !manifest || manifest.size > 1024*1024 || files.some(f => f.size > 8*1024*1024)) throw new Error('Select one manifest.json and its bounded chunk JSON files')
      bytes = new Uint8Array(await manifest.arrayBuffer()); base = 'https://local-gaia.invalid/'
    } else {
      const url = new URL(manifestUrl!)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Gaia manifest URL')
      const timeout = setTimeout(() => controller.abort(), 30000)
      try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
        if (!response.ok) throw new Error(`Gaia manifest HTTP ${response.status}`)
        bytes = new Uint8Array(await readBounded(response, 'application/json', 1024*1024))
      } finally { clearTimeout(timeout) }
      base = new URL('./', url).href
    }
    const manifest = decodeGaiaManifest(bytes), manifestSha256 = await gaiaHash(bytes)
    scope.postMessage({ type: 'manifest', manifest, manifestSha256 })
    const fetcher: typeof fetch = files ? async input => {
      const name = new URL(String(input)).pathname.slice(1), file = local.get(name)
      if (!file) throw new Error(`Missing Gaia chunk: ${name}`)
      return new Response(await file.arrayBuffer(), { headers: { 'Content-Type': 'application/json', 'Content-Length': String(file.size) } })
    } : fetch
    const summary = await streamGaiaChunks({ manifest, baseUrl: base, signal: controller.signal, fetcher,
      region: { raStartDeg: 0, raEndDeg: 360, decMinDeg: -90, decMaxDeg: 90, epochJulianYear: 2016 },
      onChunk: async chunk => {
        const display = projectGaiaDisplay(chunk, manifest.settings.raDeg, manifest.settings.decDeg, manifest.settings.radiusDeg)
        await new Promise<void>(resolve => {
          sequence++
          acknowledge = resolve
          scope.postMessage({ type: 'chunk', sequence, sources: chunk.sources, display }, [display.buffer])
        })
      } })
    scope.postMessage({ type: 'done', summary })
  } catch (error) { scope.postMessage({ type: 'error', error: String(error) }) }
}
