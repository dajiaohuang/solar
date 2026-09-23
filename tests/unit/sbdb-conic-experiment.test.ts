import { readFile } from 'node:fs/promises'
import { test,expect } from 'vitest'
import { sbdbConicExperiment } from '../../src/engine/ephemeris/sbdbConicExperiment'
import reference from '../fixtures/borisov-conic-reference.json'
const source=await readFile('tests/fixtures/sbdb-borisov-20260923/response.json'),gm=await readFile('src/data/gm_de440.tpc','utf8')
test.each(reference.cases)('Borisov numerical conic at $targetTdbText',async sample=>{
  const result=await sbdbConicExperiment(source,gm,sample.targetTdbText)
  const actual=[...Object.values(result.positionKm),...Object.values(result.velocityKmPerSecond)]
  for(const start of [0,3]) {
    const error=Math.hypot(...actual.slice(start,start+3).map((x,i)=>x-sample.state[start+i]))/Math.hypot(...sample.state.slice(start,start+3))
    expect(error).toBeLessThan(2e-12)
  }
  expect(result.adoptedSolarGM.sha256).toBe(reference.gmSha256)
  expect(result.source.sourceSha256).toBe(reference.sourceSha256)
  expect(result.fittedModelReproduced).toBe(false);expect(result.physicalUncertainty).toBeNull()
  expect(result.omittedSourceModelParameters).toHaveLength(9)
})
test('altered GM and unsupported source validity never silently propagate',async()=>{
  await expect(sbdbConicExperiment(source,gm+' ','2458853.5')).rejects.toThrow(/checksum/)
  const raw=JSON.parse(source.toString());raw.orbit.not_valid_after='2020-01-01'
  await expect(sbdbConicExperiment(new TextEncoder().encode(JSON.stringify(raw)),gm,'2458853.5')).rejects.toThrow(/validity/)
})
