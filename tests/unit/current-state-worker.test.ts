import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentStateObservationTransfers, framesFromCurrentStateObservation, loadCurrentStateObservation, type CurrentStateObservation } from '../../src/lib/currentStateObservation'
import { createCurrentStateWorkerClient } from '../../src/lib/currentStateWorkerClient'
import { decodeStateTile, digestStateTileRequestIds, encodeStateTile, StateTileSnapshot, type StateTileMetadata } from '../../src/lib/stateTiles'
import type { CurrentStateWorkerRequest, CurrentStateWorkerResponse } from '../../src/workers/current-states.protocol'
import type { CelestialBody } from '../../src/types'
import { AU_IN_KM } from '../../src/engine/units'
import { createStateTileAdmissionPool, serveStateTileAdmission } from '../../src/lib/stateTileAdmission'

const channels: (() => void)[] = []
afterEach(() => { for (const close of channels.splice(0)) close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const hash = 'a'.repeat(64), planHash = 'b'.repeat(64), epoch = 2451545
const body = (id: string): CelestialBody => ({ id, name: id, kind: 'asteroid', color: '#fff', size: 1, source: 'custom' })
const input = { base: 'https://fixture.invalid', selectedIds: ['a', 'alias', 'gap'],
  requestedIds: new Map([['a', 'source:a'], ['alias', 'source:a'], ['gap', 'source:gap'], ['ref', 'source:ref']]),
  referenceIds: ['ref', 'a'], epochTdbJd: epoch, epochUtcJd: epoch - 0.001 }
const json = (value: unknown) => { const text = JSON.stringify(value); return new Response(text, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } }) }

async function fixture(corrupt = false) {
  const ids = ['source:a', 'source:gap', 'source:ref']
  const metadata: StateTileMetadata[] = ids.map(id => ({ id, source: 'synthetic-worker', datasetVersion: 'fixture', datasetSha256: hash,
    kernelSha256: 'c'.repeat(64), model: 'spk-original', centerId: 'naif:0', validityStartEt: -100, validityEndEt: 100,
    validityPresent: true, evidenceWindowStartEt: -100, evidenceWindowEndEt: 100, evidenceWindowPresent: true,
    stateEvidence: id.endsWith('gap') ? '' : 'kernel', missingReason: id.endsWith('gap') ? 'synthetic-gap' : '', identityStatus: '', sourceRecord: false }))
  const states = new Float64Array([1e12 + 1 / 7, -0, 1 / 3, -0, 0.125, -1 / 7, 0, 0, 0, 0, 0, 0, 1e12, -0, 1 / 9, 0.25, 0, -0])
  const encoded = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: epoch, metadata, states, exact: [0, 2], planHash, catalogManifestSha256: hash })
  const decoded = await decodeStateTile(encoded, { planHash, catalogManifestSha256: hash })
  const manifest = { apiVersion: 'solar.api/v1', catalogVersion: 'fixture', catalogManifestSha256: hash }
  const plan = { ...manifest, planId: planHash, requestIdsSha256: await digestStateTileRequestIds(ids), epochJd: epoch,
    timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s',
    stride: 6, fieldMask: ['position', 'velocity'], bodyCount: 3, exactCount: 2, approximateCount: 0, missingCount: 1,
    tileCount: 1, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 3 }] }
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    if (String(url).endsWith('/catalog/manifest')) return json(manifest)
    if (String(url).endsWith('/state/plan')) {
      expect(JSON.parse(String(init?.body)).ids).toEqual(ids)
      return json(plan)
    }
    if (!String(url).endsWith('/state/tiles')) throw new Error('Unexpected fixture URL')
    const bytes = new Uint8Array(encoded.slice(0)); if (corrupt) bytes[bytes.length - 1] ^= 1
    return new Response(bytes, { headers: { 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(bytes.byteLength), etag: `"${decoded.payloadSha256}"` } })
  })
  return { fetcher, states, decoded }
}

async function workerScope(fetcher: typeof fetch) {
  vi.resetModules()
  const messages: CurrentStateWorkerResponse[] = [], transfers: Transferable[][] = []
  const scope = { onmessage: null as ((event: MessageEvent<CurrentStateWorkerRequest>) => void) | null,
    postMessage(message: CurrentStateWorkerResponse, transfer?: Transferable[]) { messages.push(structuredClone(message, { transfer })); transfers.push(transfer ?? []) } }
  vi.stubGlobal('self', scope); vi.stubGlobal('fetch', fetcher)
  await import('../../src/workers/current-states.worker')
  const channel = new MessageChannel(), detach = serveStateTileAdmission(channel.port1, createStateTileAdmissionPool())
  channels.push(() => { detach(); channel.port2.close() })
  scope.onmessage!({ data: { type: 'init-tile-admission', port: channel.port2 } } as MessageEvent<CurrentStateWorkerRequest>)
  return { messages, transfers, send: (data: CurrentStateWorkerRequest) => scope.onmessage!({ data } as MessageEvent<CurrentStateWorkerRequest>) }
}

describe('current-state worker transfer', () => {
  it('runs the actual worker, transfers every numeric buffer and adopts byte-exact states without reindexing or materializing evidence', async () => {
    const runtime = await fixture(), worker = await workerScope(runtime.fetcher)
    worker.send({ type: 'load', requestId: 1, request: input })
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    const message = worker.messages[0]
    if (message.type !== 'result') throw new Error(JSON.stringify(message))
    const result = message.result, source = result.snapshot.tiles[0]
    expect(worker.transfers[0]).toHaveLength(15) // 7 source, 2 bindings, 3 per reference
    expect(worker.transfers[0].every(buffer => (buffer as ArrayBuffer).byteLength === 0)).toBe(true)
    expect(Buffer.from(source.states.buffer).equals(Buffer.from(runtime.states.buffer))).toBe(true)
    const idRead = vi.spyOn(Object.getPrototypeOf(runtime.decoded.metadata), 'idAt')
    const rowRead = vi.spyOn(Object.getPrototypeOf(runtime.decoded.metadata), 'rowAt')
    const bodies = input.selectedIds.map(body)
    const frames = framesFromCurrentStateObservation(result, bodies, input.referenceIds)
    expect(idRead).not.toHaveBeenCalled(); expect(rowRead).not.toHaveBeenCalled()
    const first = frames.get('ref')!, second = frames.get('a')!
    expect(first.evidence).toBe(second.evidence)
    const adopted = (first.evidence as StateTileSnapshot).transfer()
    expect(adopted.byBody).toBe(result.snapshot.byBody)
    expect(adopted.tileIndexes).toBe(result.snapshot.tileIndexes)
    expect(adopted.rowIndexes).toBe(result.snapshot.rowIndexes)
    expect(adopted.tiles[0].states).toBe(source.states)
    expect(adopted.tiles[0].metadata.stringIndexes).toBe(source.metadata.stringIndexes)
    expect(adopted.tiles[0].metadata.numbers).toBe(source.metadata.numbers)
    expect(adopted.tiles[0].metadata.flags).toBe(source.metadata.flags)
    expect(adopted.tiles[0].metadata.strings).toBe(source.metadata.strings)
    expect(first.currentPositions.bodyAt(0)).toBe(bodies[0])
    expect(first.currentPositions.bodyAt(1)).toBe(bodies[1])
    expect(first.missingBodyIds).toEqual(['gap'])
    expect(first.currentPositions.coordinateAt(0, 0)).toBe(runtime.states[0] / AU_IN_KM - runtime.states[12] / AU_IN_KM)
    expect(second.currentPositions.coordinateAt(0, 0)).toBe(0)
    expect(first.evidence.rowAt(2)).toMatchObject({ bodyId: 'gap', missingReason: 'synthetic-gap', source: 'synthetic-worker' })
    expect(Object.is(first.evidence.stateValueAt(0, 1), -0)).toBe(true)
    expect(runtime.fetcher).toHaveBeenCalledTimes(3)
  })

  it('rejects corrupt binary data in the worker without returning a partial snapshot', async () => {
    const runtime = await fixture(true), worker = await workerScope(runtime.fetcher)
    worker.send({ type: 'load', requestId: 1, request: input })
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ type: 'error', requestId: 1, error: expect.stringMatching(/checksum/) })
    expect(worker.transfers[0]).toEqual([])
  })

  it('coalesces replacements behind an aborted active transport and removes a cancelled queued request', async () => {
    const runtime = await fixture()
    let rejectFirst!: (error: unknown) => void, activeSignal!: AbortSignal
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (fetcher.mock.calls.length === 1) return new Promise<Response>((_resolve, reject) => { rejectFirst = reject; activeSignal = init!.signal! })
      return runtime.fetcher(url, init)
    })
    const worker = await workerScope(fetcher)
    worker.send({ type: 'load', requestId: 1, request: input })
    worker.send({ type: 'load', requestId: 2, request: input })
    worker.send({ type: 'load', requestId: 3, request: input })
    worker.send({ type: 'cancel', requestId: 3 })
    expect(activeSignal.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    rejectFirst(activeSignal.reason)
    await Promise.resolve()
    worker.send({ type: 'load', requestId: 4, request: input })
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ type: 'result', requestId: 4 })
    expect(runtime.fetcher).toHaveBeenCalledTimes(3)
  })

  it('reports a whole-job deadline, aborts stalled I/O and keeps the worker reusable', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    const worker = await workerScope(fetcher)
    worker.send({ type: 'load', requestId: 1, request: input })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(worker.messages).toEqual([{ type: 'error', requestId: 1, error: 'Current-state worker deadline exceeded' }])
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    worker.send({ type: 'load', requestId: 2, request: input })
    worker.send({ type: 'cancel', requestId: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.messages).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid internal column shapes and mismatched source/epoch/reference before frame adoption', async () => {
    const runtime = await fixture()
    const value = await loadCurrentStateObservation({ ...input, fetcher: runtime.fetcher, signal: new AbortController().signal })
    const clone = () => structuredClone(value)
    for (const field of ['states', 'exactBitmap', 'approximateBitmap', 'missingBitmap'] as const) {
      const changed = clone(); changed.snapshot.tiles[0][field] = new Float64Array() as never
      expect(() => framesFromCurrentStateObservation(changed, input.selectedIds.map(body), input.referenceIds)).toThrow(/columns/)
    }
    for (const field of ['stringIndexes', 'numbers', 'flags'] as const) {
      const changed = clone(); changed.snapshot.tiles[0].metadata[field] = new Uint8Array() as never
      expect(() => framesFromCurrentStateObservation(changed, input.selectedIds.map(body), input.referenceIds)).toThrow(/columns/)
    }
    for (const change of [{ epochTdbJd: epoch + 1 }, { manifest: { ...value.manifest, catalogManifestSha256: 'd'.repeat(64) } }, { projections: [] }]) {
      expect(() => framesFromCurrentStateObservation({ ...value, ...change }, input.selectedIds.map(body), input.referenceIds)).toThrow(/mismatch/)
    }
    const all = currentStateObservationTransfers(value)
    expect(new Set(all).size).toBe(all.length)
  })
})

function clientPort() {
  const port = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'] }
  const factory = vi.fn(() => port), client = createCurrentStateWorkerClient(factory)
  port.postMessage.mockClear() // The mandatory admission channel is set up before jobs.
  return { port, factory, client, send: (data: unknown) => port.onmessage!.call(port as unknown as Worker, { data } as MessageEvent<CurrentStateWorkerResponse>) }
}
const result = { epochTdbJd: epoch, epochUtcJd: epoch - 0.001 } as CurrentStateObservation

describe('reusable current-state worker client', () => {
  it('reuses one port and retires replaced promises without accepting late messages', async () => {
    const { client, port, factory, send } = clientPort()
    const first = client.load(input, new AbortController().signal), retired = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = client.load(input, new AbortController().signal)
    await retired
    expect(port.postMessage.mock.calls.map(([value]) => [value.type, value.requestId])).toEqual([['load', 1], ['cancel', 1], ['load', 2]])
    let settled = false; void second.then(() => { settled = true })
    send({ type: 'result', requestId: 1, result }); await Promise.resolve(); expect(settled).toBe(false)
    send({ type: 'result', requestId: 2, result }); await expect(second).resolves.toBe(result)
    const third = client.load(input, new AbortController().signal)
    send({ type: 'result', requestId: 3, result }); await expect(third).resolves.toBe(result)
    expect(factory).toHaveBeenCalledTimes(1); expect(port.terminate).not.toHaveBeenCalled()
    client.dispose(); client.dispose(); expect(port.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects pre-aborted and cancelled calls immediately and removes abort listeners after success', async () => {
    const { client, port, send } = clientPort(), aborted = new AbortController()
    aborted.abort(); await expect(client.load(input, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(port.postMessage).not.toHaveBeenCalled()
    const controller = new AbortController(), pending = client.load(input, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected
    const completed = new AbortController(), success = client.load(input, completed.signal)
    send({ type: 'result', requestId: 2, result }); await success
    const count = port.postMessage.mock.calls.length; completed.abort(); expect(port.postMessage).toHaveBeenCalledTimes(count)
    client.dispose()
  })

  it.each(['epoch', 'malformed', 'error'])('rejects %s responses without leaving a dangling promise', async mode => {
    const { client, send } = clientPort(), pending = client.load(input, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow(mode === 'epoch' ? /epoch mismatch/ : mode === 'malformed' ? /Invalid/ : /unavailable/)
    send(mode === 'epoch' ? { type: 'result', requestId: 1, result: { ...result, epochTdbJd: epoch + 1 } }
      : mode === 'malformed' ? { type: 'unexpected', requestId: 1 } : { type: 'error', requestId: 1, error: 'unavailable' })
    await rejected; client.dispose()
  })

  it('retires and terminates a crashed port; disposal cannot terminate it twice', async () => {
    const { client, port } = clientPort(), pending = client.load(input, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('crashed')
    port.onerror!.call(port as unknown as Worker, { message: 'crashed' } as ErrorEvent)
    await rejected; expect(client.closed).toBe(true)
    await expect(client.load(input, new AbortController().signal)).rejects.toThrow(/closed/)
    client.dispose(); expect(port.terminate).toHaveBeenCalledTimes(1)
  })
})
