import { createHash } from 'node:crypto'

const ORIGIN = Buffer.from('solar-spk-source-chain-v2:ssb', 'utf8')
const SEGMENT_DOMAIN = Buffer.from('solar-spk-source-chain-v2:segment\0', 'utf8')

/** Hash selected SPK segments from the SSB outward using a language-neutral byte layout. */
export function sourceChainSha256(chain) {
  if (!Array.isArray(chain)) throw new TypeError('SPK source chain must be an array')
  let parent = createHash('sha256').update(ORIGIN).digest()
  for (let n = chain.length - 1; n >= 0; n--) {
    const segment = chain[n]
    const id = Buffer.from(segment.kernelId, 'utf8')
    const checksum = Buffer.from(segment.kernelSha256, 'hex')
    const integers = [segment.target, segment.center, segment.frame, segment.type]
    if (!id.length || id.length > 0xffffffff || !/^[a-f0-9]{64}$/.test(segment.kernelSha256) || checksum.length !== 32 ||
      !integers.every(value => Number.isSafeInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) ||
      ![segment.startEt, segment.endEt].every(Number.isFinite) || segment.endEt < segment.startEt) {
      throw new Error('Invalid selected SPK source-chain segment')
    }
    const encoded = Buffer.allocUnsafe(4 + 4 * 4 + 8 * 2)
    encoded.writeUInt32LE(id.length, 0)
    integers.forEach((value, index) => encoded.writeInt32LE(value, 4 + index * 4))
    encoded.writeDoubleLE(segment.startEt, 20)
    encoded.writeDoubleLE(segment.endEt, 28)
    parent = createHash('sha256').update(SEGMENT_DOMAIN).update(encoded.subarray(0, 4))
      .update(id).update(checksum).update(encoded.subarray(4)).update(parent).digest()
  }
  return parent.toString('hex')
}
