import { gaiaAstrometricCovariance } from './gaiaAstrometricCovariance'
import type { GaiaSource } from './gaiaChunks'

export type StellarCovariance = {
  model: string; policy: string; frame: string; timeScale: string
  inputMatrix: number[][]; outputMatrix: number[][]; jacobian: number[][]
  differenceSteps: number[]; maxScaledDerivativeDifference: number
  coordinateLabels: string[]; coordinateUnits: string[]; targetEpochJulianYearTCB: number; assumptions: string[]
}
export function validateStellarCovariance(raw: unknown, source: Record<string, unknown>, epoch: number): StellarCovariance {
  const reject = (): never => { throw new Error('Stellar covariance source or matrix contract mismatch') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject()
  const c = raw as StellarCovariance
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const labels = ['delta-alpha*cos(delta)','delta-dec','parallax','pmra','pmdec','radial-velocity']
  const units = ['mas','mas','mas','mas/Julian-year','mas/Julian-year','km/s']
  if (c.model !== 'first-order-starpm-covariance-v1' || c.policy !== 'independent-spectroscopic-rv' || c.frame !== 'ICRS' || c.timeScale !== 'TCB'
    || c.targetEpochJulianYearTCB !== epoch || JSON.stringify(c.coordinateLabels) !== JSON.stringify(labels) || JSON.stringify(c.coordinateUnits) !== JSON.stringify(units)
    || !finite(c.maxScaledDerivativeDifference) || c.maxScaledDerivativeDifference < 0 || c.maxScaledDerivativeDifference > 1e-4
    || !Array.isArray(c.differenceSteps) || c.differenceSteps.length !== 6 || !c.differenceSteps.every(v => finite(v) && (epoch === 2016 ? v === 0 : v > 0))
    || !Array.isArray(c.assumptions) || !c.assumptions.length || !c.assumptions.every(v => typeof v === 'string' && v.length)) reject()
  for (const matrix of [c.inputMatrix,c.outputMatrix,c.jacobian]) {
    if (!Array.isArray(matrix) || matrix.length !== 6 || matrix.some(row => !Array.isArray(row) || row.length !== 6 || !row.every(finite))) reject()
  }
  for (const matrix of [c.inputMatrix,c.outputMatrix]) {
    const lower = Array.from({ length:6 }, () => Array<number>(6).fill(0))
    for (let i = 0; i < 6; i++) {
      if (!(matrix[i][i] > 0)) reject()
      for (let j = 0; j <= i; j++) {
        if (matrix[i][j] !== matrix[j][i]) reject()
        let value = matrix[i][j]/Math.sqrt(matrix[i][i]*matrix[j][j])
        for (let k = 0; k < j; k++) value -= lower[i][k]*lower[j][k]
        if (i === j) { if (!(value > 0)) reject(); lower[i][j] = Math.sqrt(value) }
        else lower[i][j] = value/lower[j][j]
      }
    }
  }
  const astrometry = gaiaAstrometricCovariance(source as GaiaSource)
  const rvError = source.radial_velocity_error
  if (!astrometry.available || !finite(rvError) || rvError <= 0) return reject()
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const expected = i < 5 && j < 5 ? astrometry.matrix[i][j] : i === 5 && j === 5 ? rvError*rvError : 0
    const inputScale = Math.sqrt(c.inputMatrix[i][i]*c.inputMatrix[j][j])
    if (Math.abs(c.inputMatrix[i][j]-expected) > 1e-10*inputScale) reject()
    let output = 0
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) output += c.jacobian[i][a]*c.inputMatrix[a][b]*c.jacobian[j][b]
    if (!finite(output) || Math.abs(output-c.outputMatrix[i][j]) > 1e-10*Math.sqrt(c.outputMatrix[i][i]*c.outputMatrix[j][j])) reject()
  }
  return c
}
