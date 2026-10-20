const MAX_RETRY_AFTER_MS = 30_000
const DEFAULT_RETRY_DELAY_MS = 100

function defaultRetryableStatus(status: number) { return status === 408 || status === 429 || status >= 500 }

export type RetryableHttpPolicy = {
  /** Override status handling for callers that retry only explicit queue rejection. */
  retryableStatuses?: readonly number[]
  /** Replaying a request after a transport failure may repeat expensive server work. */
  retryNetworkErrors?: boolean
  /** Require an advertised Retry-After value instead of using the short fallback. */
  requireRetryAfter?: boolean
}

/** Safe for deterministic or read-only requests rejected before work starts. */
export const ADVERTISED_QUEUE_RETRY: RetryableHttpPolicy = Object.freeze({
  retryableStatuses: Object.freeze([429]),
  retryNetworkErrors: false,
  requireRetryAfter: true,
})

export function retryAfterDelayMs(response: Response) {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw)
    // Saturate huge valid delta-seconds instead of treating numeric overflow as
    // an invalid header and retrying at the much shorter default delay.
    if (!Number.isFinite(seconds) || seconds >= MAX_RETRY_AFTER_MS / 1000) return MAX_RETRY_AFTER_MS
    return Math.max(0, Math.ceil(seconds * 1000))
  }
  const delay = Date.parse(raw) - Date.now()
  return Number.isFinite(delay) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(delay))) : undefined
}

export async function waitForRetry(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  if (milliseconds <= 0) return
  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => finish(), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  signal.throwIfAborted()
}

/** Retry a transient response once. The failed response is cancelled before
 * waiting; successful bodies remain owned by the caller for validation. */
export async function fetchRetryableResponse(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal,
  policy: RetryableHttpPolicy = {},
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted()
    let response: Response
    try {
      response = await fetcher(input, { ...init, signal })
    } catch (error) {
      signal.throwIfAborted()
      if (attempt === 1 || policy.retryNetworkErrors === false) throw error
      await waitForRetry(DEFAULT_RETRY_DELAY_MS, signal)
      continue
    }
    const retryable = policy.retryableStatuses
      ? policy.retryableStatuses.includes(response.status)
      : defaultRetryableStatus(response.status)
    if (!retryable || attempt === 1) return response
    const advertisedDelay = retryAfterDelayMs(response)
    if (policy.requireRetryAfter && advertisedDelay === undefined) return response
    await response.body?.cancel().catch(() => undefined)
    await waitForRetry(advertisedDelay ?? DEFAULT_RETRY_DELAY_MS, signal)
  }
  throw new Error('HTTP request retry limit exhausted')
}
