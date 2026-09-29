import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, platform, arch } from 'node:os'
import { test, expect } from './fixtures'

// Opt-in real-source measurement, excluded unless the caller provides a capture
// or requests the checked-in four-region Gaia collection.
const directory = process.env.SOLAR_GAIA_CAPACITY_DIR
const collectionMode = process.env.SOLAR_GAIA_CAPACITY_COLLECTION === 'pleiades-praesepe-orion'
const collectionDirectories = [
  'pleiades-ra55-dec25-r1-g17-20260923',
  'pleiades-ra55-dec25-r1p5-g18-20260927',
  'praesepe-ra130p1-dec19p67-r1-g18-20260927',
  'orion-ra83p822-dec-5p391-r1-g18-recovered-20260927',
]

test('measure real Gaia source loading and retained-buffer zoom', async ({ page, browser }, info) => {
  test.skip(!directory && !collectionMode, 'Provide SOLAR_GAIA_CAPACITY_DIR or opt into the checked-in four-region collection')
  test.setTimeout(90000)
  const roots = collectionMode
    ? collectionDirectories.map(name => resolve('public','data','gaia',name))
    : [resolve(directory!)]
  const manifests = await Promise.all(roots.map(async root => {
    const raw = await readFile(join(root,'manifest.json'))
    const manifest = JSON.parse(raw.toString())
    const files = [join(root,'manifest.json'), ...manifest.chunks.map((chunk: {path: string}) => join(root,chunk.path))]
    return { root, raw, manifest, files, sha256:createHash('sha256').update(raw).digest('hex') }
  }))
  const totalRows = manifests.reduce((sum, item) => sum+item.manifest.rows, 0)
  const totalChunks = manifests.reduce((sum, item) => sum+item.manifest.chunks.length, 0)
  const uniqueSourceIds = new Set<string>()
  for (const item of manifests) {
    for (const chunk of item.manifest.chunks) {
      const bytes = await readFile(join(item.root,chunk.path))
      const decoded = JSON.parse(bytes.toString())
      for (const source of decoded.sources) {
        if (typeof source.source_id !== 'string' || !/^[1-9]\d{0,18}$/.test(source.source_id)) throw new Error('Invalid source_id in real Gaia capacity input')
        uniqueSourceIds.add(source.source_id)
      }
    }
  }
  const uniqueRows = uniqueSourceIds.size
  const capacityButton = page.getByRole('button',{name:/^Combine Pleiades \+ Praesepe \+ Orion/})
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1','complete'))
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region',{name:'Gaia sky chart',exact:true})
  const samples = []
  for (let iteration = 0; iteration < 3; iteration++) {
    const started = performance.now()
    if (collectionMode) await capacityButton.click()
    else await panel.getByLabel('Gaia manifest and chunk JSON files').setInputFiles(manifests[0].files)
    const completion = panel.getByTestId('gaia-complete')
    await expect(completion).toContainText(uniqueRows.toLocaleString('en-US')+' unique stars displayed')
    const loadMilliseconds = performance.now()-started
    const loadWindow = await completion.evaluate(node => {
      const readInteger = (name: string) => {
        const value = node.getAttribute(name)
        if (!value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Missing Gaia load-window receipt: ${name}`)
        return Number(value)
      }
      return {
        maxConcurrentChunks:readInteger('data-load-window-max-chunks'),
        maxInFlightBytes:readInteger('data-load-window-max-bytes'),
        maxInFlightRows:readInteger('data-load-window-max-rows'),
        maxTotalBytes:readInteger('data-load-window-max-total-bytes'),
        peakActiveChunks:readInteger('data-load-window-peak-chunks'),
        peakReservedBytes:readInteger('data-load-window-peak-bytes'),
        peakReservedRows:readInteger('data-load-window-peak-rows'),
        maxConcurrentManifests:readInteger('data-load-window-max-manifests'),
        peakConcurrentManifests:readInteger('data-load-window-peak-manifests'),
        sourceReadChunks:readInteger('data-load-window-source-read-chunks'),
      }
    })
    expect(loadWindow.maxConcurrentChunks).toBe(8)
    expect(loadWindow.maxInFlightBytes).toBe(96*1024*1024)
    expect(loadWindow.maxInFlightRows).toBe(90000)
    expect(loadWindow.maxTotalBytes).toBe(128*1024*1024)
    expect(loadWindow.peakActiveChunks).toBeGreaterThan(0)
    expect(loadWindow.peakActiveChunks).toBeLessThanOrEqual(loadWindow.maxConcurrentChunks)
    expect(loadWindow.peakReservedBytes).toBeGreaterThan(0)
    expect(loadWindow.peakReservedBytes).toBeLessThanOrEqual(loadWindow.maxInFlightBytes)
    expect(loadWindow.peakReservedRows).toBeGreaterThan(0)
    expect(loadWindow.peakReservedRows).toBeLessThanOrEqual(loadWindow.maxInFlightRows)
    expect(loadWindow.maxConcurrentManifests).toBeGreaterThan(0)
    expect(loadWindow.maxConcurrentManifests).toBeLessThanOrEqual(Math.min(8,manifests.length))
    expect(loadWindow.peakConcurrentManifests).toBeLessThanOrEqual(loadWindow.maxConcurrentManifests)
    if (loadWindow.sourceReadChunks === 0) expect(loadWindow.peakConcurrentManifests).toBe(0)
    else expect(loadWindow.peakConcurrentManifests).toBeGreaterThan(0)
    if (collectionMode && loadWindow.sourceReadChunks > 0) expect(loadWindow.peakConcurrentManifests).toBeGreaterThan(1)
    const uploadWindow = await completion.evaluate(node => {
      const readInteger = (name: string) => {
        const value = node.getAttribute(name)
        if (!value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Missing Gaia upload-window receipt: ${name}`)
        return Number(value)
      }
      return {
        maxPendingChunks:readInteger('data-upload-window-max-chunks'),
        maxInputRows:readInteger('data-upload-window-max-rows'),
        peakPendingChunks:readInteger('data-upload-window-peak-chunks'),
        peakPendingInputRows:readInteger('data-upload-window-peak-rows'),
      }
    })
    expect(uploadWindow.maxPendingChunks).toBeGreaterThan(0)
    expect(uploadWindow.maxInputRows).toBeGreaterThan(0)
    expect(uploadWindow.peakPendingChunks).toBeGreaterThan(0)
    expect(uploadWindow.peakPendingChunks).toBeLessThanOrEqual(uploadWindow.maxPendingChunks)
    expect(uploadWindow.peakPendingInputRows).toBeGreaterThan(0)
    expect(uploadWindow.peakPendingInputRows).toBeLessThanOrEqual(uploadWindow.maxInputRows)
    const canvas = panel.getByRole('img')
    await expect(canvas).toBeVisible()
    const measurement = await canvas.evaluate(async element => {
      const gl = (element as HTMLCanvasElement).getContext('webgl2')!
      const retainedBufferBytes = gl.getBufferParameter(gl.ARRAY_BUFFER,gl.BUFFER_SIZE) as number
      let reallocations = 0, uploads = 0, draws = 0
      const allocate = gl.bufferData.bind(gl), upload = gl.bufferSubData.bind(gl), draw = gl.drawArrays.bind(gl)
      gl.bufferData = ((...args: Parameters<typeof allocate>) => { reallocations++; return allocate(...args) }) as typeof gl.bufferData
      gl.bufferSubData = ((...args: Parameters<typeof upload>) => { uploads++; return upload(...args) }) as typeof gl.bufferSubData
      gl.drawArrays = (...args) => { draws++; return draw(...args) }
      const frameIntervals: number[] = [], input = element.closest('section')!.querySelector('input[type=range]') as HTMLInputElement
      let previous = await new Promise<number>(requestAnimationFrame)
      try {
        for (let i = 0; i < 120; i++) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(1+(i%70)/10))
          input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}))
          const now = await new Promise<number>(requestAnimationFrame)
          frameIntervals.push(now-previous); previous = now
        }
      } finally { gl.bufferData = allocate; gl.bufferSubData = upload; gl.drawArrays = draw }
      return { retainedBufferBytes, reallocations, uploads, draws, frameIntervals, userAgent:navigator.userAgent, hardwareConcurrency:navigator.hardwareConcurrency, devicePixelRatio }
    })
    expect(measurement.retainedBufferBytes).toBe(totalRows*12)
    expect(measurement.reallocations).toBe(0); expect(measurement.uploads).toBe(0)
    expect(measurement.draws).toBeGreaterThan(60)
    const ordered = [...measurement.frameIntervals].sort((a,b)=>a-b)
    samples.push({ iteration, loadMilliseconds, loadWindow, uploadWindow, ...measurement, frameP50:ordered[60], frameP95:ordered[114], frameMax:ordered.at(-1) })
  }
  await panel.screenshot({path:info.outputPath('gaia-capacity.png')})
  const implementations = await Promise.all(['src/data/gaiaCapacity.json','src/lib/gaiaCache.ts','src/data/gaiaColumns.json','src/lib/gaiaChunks.ts','src/lib/gaiaCollection.ts','src/lib/gaiaPackedSources.ts','src/lib/gaiaProjection.ts','src/workers/gaia.protocol.ts','src/workers/gaia.worker.ts','src/features/about/GaiaPlot.tsx','src/features/about/GaiaSky.tsx','tests/e2e/gaia-capacity.spec.ts'].map(async path => ({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})))
  const reportPath = info.outputPath('gaia-capacity.json')
  await writeFile(reportPath,JSON.stringify({
    schemaVersion:4, capturedAt:new Date().toISOString(), browserVersion:browser.version(), profile:info.project.name,
    dataset:collectionMode ? 'pleiades-praesepe-orion' : 'single-capture',
    manifests:manifests.map(item => ({ sha256:item.sha256, rows:item.manifest.rows, chunks:item.manifest.chunks.length, sourceReceipts:item.manifest.sources })),
    rows:totalRows, uniqueRows, chunks:totalChunks,
    implementations, host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length}, samples,
    limitations:['Local capture files and locally served packaged data on this host; not live TAP or production network throughput.', 'Browser frame intervals during 120 zoom steps; not native or sustained all-sky FPS.', 'WebGL BUFFER_SIZE is allocated buffer size, not total GPU memory.', 'No worker/page heap measurement; no cross-device capacity certification.'],
  },null,2))
  await info.attach('gaia-capacity.json',{contentType:'application/json',path:reportPath})
})
