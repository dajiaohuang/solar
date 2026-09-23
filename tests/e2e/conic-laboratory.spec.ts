import { readFile } from 'node:fs/promises'
import { test,expect } from './fixtures'
import reference from '../fixtures/borisov-conic-reference.json' with {type:'json'}
test('Borisov source computes a labeled conic and exports independently checked states',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('solar-atlas-first-run-v1','complete'))
  await page.goto('./?v=4&page=about&lang=en')
  const panel=page.getByRole('region',{name:'Conic orbit laboratory',exact:true})
  await panel.getByRole('button',{name:'Load real Borisov source'}).click()
  await expect(panel).toContainText('C/2019 Q4 (Borisov)')
  await panel.getByRole('button',{name:'Compute two-body state'}).click()
  await expect(panel.getByTestId('conic-result')).toContainText('Omitted source fit parameters: 9')
  expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
  await panel.screenshot({path:test.info().outputPath('conic-laboratory.png')})
  const pending=page.waitForEvent('download')
  await panel.getByRole('button',{name:'Export conic calculation and sources'}).click()
  const result=JSON.parse(await readFile((await (await pending).path())!,'utf8'))
  const expected=reference.cases.find(c=>c.targetTdbText===result.targetTdbText)!
  expect(expected).toBeDefined()
  const actual=[...Object.values(result.positionKm),...Object.values(result.velocityKmPerSecond)] as number[]
  for(const start of [0,3])expect(Math.hypot(...actual.slice(start,start+3).map((x,i)=>x-expected.state[start+i]))/Math.hypot(...expected.state.slice(start,start+3))).toBeLessThan(2e-12)
  expect(result.physicalUncertainty).toBeNull();expect(result.fittedModelReproduced).toBe(false)
  expect(result.source.sourceSha256).toBe(reference.sourceSha256)
  expect(result.adoptedSolarGM.sha256).toBe(reference.gmSha256)
  await panel.getByLabel('Target TDB Julian day').fill('invalid')
  await expect(panel.getByTestId('conic-result')).toHaveCount(0)
  await panel.getByRole('button',{name:'Compute two-body state'}).click()
  await expect(panel.getByRole('alert')).toContainText('decimal Julian-day')
  await expect(panel.getByRole('button',{name:'Export conic calculation and sources'})).toHaveCount(0)
})
