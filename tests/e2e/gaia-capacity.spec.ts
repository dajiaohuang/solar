import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, platform, arch } from 'node:os'
import { test, expect } from './fixtures'

// Opt-in real-capture measurement, excluded unless the caller provides data.
const directory = process.env.SOLAR_GAIA_CAPACITY_DIR

test('measure real Gaia capture loading and retained-buffer zoom', async ({ page, browser }, info) => {
  test.skip(!directory, 'Provide SOLAR_GAIA_CAPACITY_DIR containing a real Gaia capture')
  test.setTimeout(90000)
  const root = resolve(directory!), raw = await readFile(join(root,'manifest.json'))
  const manifest = JSON.parse(raw.toString())
  const files = [join(root,'manifest.json'), ...manifest.chunks.map((c: {path: string}) => join(root,c.path))]
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1','complete'))
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region',{name:'Gaia sky chart',exact:true})
  const samples = []
  for (let iteration = 0; iteration < 3; iteration++) {
    const started = performance.now()
    await panel.getByLabel('Gaia manifest and chunk JSON files').setInputFiles(files)
    await expect(panel.getByTestId('gaia-complete')).toContainText(manifest.rows+' source records loaded')
    const loadMilliseconds = performance.now()-started
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
    expect(measurement.retainedBufferBytes).toBe(manifest.rows*12)
    expect(measurement.reallocations).toBe(0); expect(measurement.uploads).toBe(0)
    expect(measurement.draws).toBeGreaterThan(60)
    const ordered = [...measurement.frameIntervals].sort((a,b)=>a-b)
    samples.push({ iteration, loadMilliseconds, ...measurement, frameP50:ordered[60], frameP95:ordered[114], frameMax:ordered.at(-1) })
  }
  await panel.screenshot({path:info.outputPath('gaia-capacity.png')})
  const implementations = await Promise.all(['src/data/gaiaColumns.json','src/lib/gaiaChunks.ts','src/lib/gaiaProjection.ts','src/workers/gaia.worker.ts','src/features/about/GaiaPlot.tsx','src/features/about/GaiaSky.tsx','tests/e2e/gaia-capacity.spec.ts'].map(async path => ({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})))
  const reportPath = info.outputPath('gaia-capacity.json')
  await writeFile(reportPath,JSON.stringify({
    schemaVersion:1, capturedAt:new Date().toISOString(), browserVersion:browser.version(), profile:info.project.name,
    manifestSha256:createHash('sha256').update(raw).digest('hex'), rows:manifest.rows, chunks:manifest.chunks.length,
    sourceReceipts:manifest.sources, implementations, host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length}, samples,
    limitations:['Local file imports on this host; not live TAP or network throughput.', 'Browser frame intervals during 120 zoom steps; not native or sustained all-sky FPS.', 'WebGL BUFFER_SIZE is allocated buffer size, not total GPU memory.', 'No worker/page heap measurement; no cross-device capacity certification.'],
  },null,2))
  await info.attach('gaia-capacity.json',{contentType:'application/json',path:reportPath})
})
