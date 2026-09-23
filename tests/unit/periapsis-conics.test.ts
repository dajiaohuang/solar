import { describe, expect, test } from 'vitest'
import reference from '../fixtures/periapsis-conics-reference.json'
import { propagatePeriapsisConic } from '../../src/engine/ephemeris/conicPeriapsis'

describe('independent CSPICE periapsis conics', () => {
  test.each(reference.cases)('e=$eccentricity dt=$elapsedTdbSeconds', sample => {
    const result=propagatePeriapsisConic(sample,sample.elapsedTdbSeconds)
    const p=Object.values(result.positionKm),v=Object.values(result.velocityKmPerSecond)
    const error=(actual:number[],wanted:number[])=>Math.hypot(...actual.map((a,i)=>a-wanted[i]))/Math.hypot(...wanted)
    expect(error(p,sample.state.slice(0,3))).toBeLessThan(2e-12)
    expect(error(v,sample.state.slice(3))).toBeLessThan(2e-12)
    const energy = Math.hypot(...v)**2/2-sample.gmKm3PerSecond2/Math.hypot(...p)
    const expectedEnergy = sample.gmKm3PerSecond2*(sample.eccentricity-1)/(2*sample.periapsisKm)
    expect(Math.abs(energy-expectedEnergy)/(sample.gmKm3PerSecond2/sample.periapsisKm)).toBeLessThan(2e-12)
  })
  test('parabolic periapsis and Barker time are analytic', () => {
    const orbit={periapsisKm:1,eccentricity:1,gmKm3PerSecond2:1,inclinationRadians:0,ascendingNodeRadians:0,argumentOfPeriapsisRadians:0}
    // Barker D=1: r=(0,2), dt=sqrt(2)*(D+D^3/3).
    const state=propagatePeriapsisConic(orbit,4*Math.sqrt(2)/3)
    expect(state.positionKm.x).toBeCloseTo(0,14); expect(state.positionKm.y).toBeCloseTo(2,14)
    expect(state.velocityKmPerSecond.x).toBeCloseTo(-1/Math.sqrt(2),14)
    expect(state.velocityKmPerSecond.y).toBeCloseTo(1/Math.sqrt(2),14)
    const periapsis=propagatePeriapsisConic(orbit,0)
    expect(periapsis.positionKm).toEqual({x:1,y:0,z:0})
  })
  test.each([1e4,1e8,-1e8])('retains parabolic transverse velocity at Barker D=%s', d => {
    const orbit={periapsisKm:1,eccentricity:1,gmKm3PerSecond2:1,inclinationRadians:0,ascendingNodeRadians:0,argumentOfPeriapsisRadians:0}
    // Analytic Barker state; component-relative checks detect cancellation that
    // a total-vector relative tolerance hides in the small transverse velocity.
    const state=propagatePeriapsisConic(orbit,Math.sqrt(2)*(d+d**3/3))
    const expectedY=Math.sqrt(2)/(1+d*d)
    expect(Math.abs(state.velocityKmPerSecond.y/expectedY-1)).toBeLessThan(2e-12)
    expect(Math.abs(state.velocityKmPerSecond.x/(-Math.sqrt(2)*d/(1+d*d))-1)).toBeLessThan(2e-12)
  })
  test('invalid inputs fail explicitly', () => {
    const orbit=reference.cases[0]
    expect(()=>propagatePeriapsisConic({...orbit,periapsisKm:0},1)).toThrow()
    expect(()=>propagatePeriapsisConic({...orbit,eccentricity:-1},1)).toThrow()
    expect(()=>propagatePeriapsisConic(orbit,Infinity)).toThrow()
    expect(()=>propagatePeriapsisConic({...orbit,periapsisKm:1e300,gmKm3PerSecond2:1e-300},1)).toThrow(/range/)
  })
})
