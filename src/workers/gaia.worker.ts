/// <reference lib="webworker" />
import { decodeGaiaManifest, gaiaHash, streamGaiaChunks } from '../lib/gaiaChunks'
import { projectGaiaDisplay } from '../lib/gaiaProjection'
import { readBounded } from '../lib/stateTiles'
import { GaiaSourceCache } from '../lib/gaiaCache'
import { readScientificSourceFile } from '../lib/scientificSourceFile'
import { validateGaiaLoadRequest, type GaiaWorkerResponse } from './gaia.protocol'
const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: GaiaWorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer)
const cache = new GaiaSourceCache()
let acknowledge: (() => void) | undefined, started = false, sequence = 0
scope.onmessage = async event => {
  if (event.data?.type === 'ack') {
    if (started && acknowledge && Number.isSafeInteger(event.data.sequence) && event.data.sequence > 0 && event.data.sequence === sequence) acknowledge()
    return
  }
  if (started) return
  started = true
  sequence = 0
  const controller = new AbortController()
  const manifestDeadline = performance.now() + 30000
  const manifestTimeout = () => new Error('Gaia manifest preparation exceeded 30 seconds')
  const checkManifest = () => {
    if (performance.now() >= manifestDeadline) controller.abort(manifestTimeout())
    controller.signal.throwIfAborted()
  }
  const manifestTimer = setTimeout(() => controller.abort(manifestTimeout()), 30000)
  try {
    checkManifest()
    const { manifestUrl, files } = validateGaiaLoadRequest(event.data)
    const local = new Map<string, File>((files ?? []).map(f => [f.name, f]))
    let bytes: Uint8Array, base: string
    if (files) {
      const manifest = local.get('manifest.json')
      if (!manifest) throw new Error('Missing Gaia manifest')
      bytes = new Uint8Array(await readScientificSourceFile(manifest, controller.signal, 1024*1024)); base = 'https://local-gaia.invalid/'
    } else {
      const url = new URL(manifestUrl!)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Gaia manifest URL')
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
      try { checkManifest() } catch (error) { await response.body?.cancel().catch(() => undefined); throw error }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Gaia manifest HTTP ${response.status}`) }
      bytes = await readBounded(response, 'application/json', 1024*1024, controller.signal)
      base = new URL('./', url).href
    }
    checkManifest()
    const manifest = decodeGaiaManifest(bytes)
    checkManifest()
    const manifestSha256 = await gaiaHash(bytes)
    checkManifest()
    // Keep the exact valid UTF-8 text, including a possible BOM, for hash replay.
    const originalManifestJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    checkManifest()
    post({ type: 'manifest', manifest, manifestSha256, originalManifestJson, manifestBytes: bytes.byteLength })
    clearTimeout(manifestTimer)
    const readChunk = files ? async (name: string, expectedBytes: number, signal: AbortSignal) => {
      signal.throwIfAborted()
      const file = local.get(name)
      if (!file) throw new Error(`Missing Gaia chunk: ${name}`)
      if (file.size !== expectedBytes) throw new Error(`Gaia local chunk size differs from manifest: ${name}`)
      return new Uint8Array(await readScientificSourceFile(file, signal, expectedBytes))
    } : undefined
    const summary = await streamGaiaChunks({ manifest, baseUrl: base, signal: controller.signal, readChunk, cache: files ? undefined : cache,
      region: { raStartDeg: 0, raEndDeg: 360, decMinDeg: -90, decMaxDeg: 90, epochJulianYear: 2016 },
      onChunk: async (chunk, chunkSignal) => {
        chunkSignal.throwIfAborted()
        const display = projectGaiaDisplay(chunk, manifest.settings.raDeg, manifest.settings.decDeg, manifest.settings.radiusDeg)
        await new Promise<void>((resolve, reject) => {
          sequence++
          let settled = false
          const finish = (error?: unknown) => {
            if (settled) return
            settled = true; clearTimeout(timeout)
            chunkSignal.removeEventListener('abort', cancel)
            acknowledge = undefined
            if (error !== undefined) reject(error)
            else resolve()
          }
          const cancel = () => finish(chunkSignal.reason ?? new DOMException('Gaia loading cancelled', 'AbortError'))
          const timeout = setTimeout(() => {
            finish(new Error('Gaia display upload acknowledgement timed out after 30 seconds'))
            controller.abort()
          }, 30000)
          acknowledge = () => finish()
          chunkSignal.addEventListener('abort', cancel, { once: true })
          if (chunkSignal.aborted) { cancel(); return }
          try {
            post({ type: 'chunk', sequence, path: chunk.descriptor.path, sources: chunk.sources, display }, [display.buffer])
          } catch (error) {
            finish(error); controller.abort()
          }
        })
      } })
    post({ type: 'done', summary })
  } catch (error) { post({ type: 'error', error: String(error) }) }
  finally { clearTimeout(manifestTimer); controller.abort(); started = false; acknowledge = undefined }
}
