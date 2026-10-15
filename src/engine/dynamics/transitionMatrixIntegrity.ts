export const TRANSITION_MATRIX_INTEGRITY_ALGORITHM = 'sha256-row-major-f64le-v1'
const scope = 'receipt-content-integrity-only'
const limitation = 'Confirms the reported matrix bytes were not changed after worker production; it is not an independent numerical or physical validation.'

function encode(values: readonly number[]) {
  if (values.length !== 36 || values.some(value => !Number.isFinite(value))) throw new RangeError('Transition matrix integrity requires 36 finite values')
  const bytes = new Uint8Array(36*Float64Array.BYTES_PER_ELEMENT), view = new DataView(bytes.buffer)
  values.forEach((value,index) => view.setFloat64(index*Float64Array.BYTES_PER_ELEMENT,value,true))
  return bytes
}

export async function createTransitionMatrixIntegrity(values: readonly number[]) {
  const bytes = encode(values)
  const digest = await crypto.subtle.digest('SHA-256',bytes)
  return { algorithm: TRANSITION_MATRIX_INTEGRITY_ALGORITHM,
    sha256: Array.from(new Uint8Array(digest),value => value.toString(16).padStart(2,'0')).join(''),
    scope, limitation }
}

export async function checkTransitionMatrixIntegrity(values: unknown, evidence: unknown) {
  if (!Array.isArray(values)) throw new Error('Transition matrix integrity values must be an array')
  const actual = Array.from(values)
  if (!actual.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Transition matrix integrity values must be finite')
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Transition matrix integrity evidence missing')
  const reported = evidence as Record<string,unknown>
  if (Object.keys(reported).length !== 4 || reported.algorithm !== TRANSITION_MATRIX_INTEGRITY_ALGORITHM ||
      reported.scope !== scope || reported.limitation !== limitation || typeof reported.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reported.sha256)) {
    throw new Error('Transition matrix integrity evidence mismatch')
  }
  const expected = await createTransitionMatrixIntegrity(actual)
  if (reported.sha256 !== expected.sha256) throw new Error('Transition matrix receipt integrity mismatch')
}
