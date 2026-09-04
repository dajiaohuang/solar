import { get as getHttp } from 'node:http'
import { get as getHttps } from 'node:https'

/** Fetch the artifact bytes, not fetch()'s transparently decoded HTTP body. */
export function fetchArtifactBytes(url, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error('Invalid artifact byte limit')
  const target = new URL(url)
  const get = target.protocol === 'https:' ? getHttps : target.protocol === 'http:' ? getHttp : null
  if (!get) throw new Error('Artifact URL must use HTTP or HTTPS')
  return new Promise((resolve, reject) => {
    const request = get(target, { headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } }, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Artifact ${target.pathname} returned HTTP ${response.statusCode}`))
        return
      }
      const chunks = []
      let received = 0
      response.on('data', chunk => {
        received += chunk.length
        if (received > maximumBytes) {
          response.destroy(new Error(`Artifact ${target.pathname} exceeds its declared byte limit`))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => request.destroy(new Error('Artifact request timed out')), 60_000)
    request.on('close', () => clearTimeout(timer))
    request.on('error', reject)
  })
}
