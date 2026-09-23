/** Session-only encoded source bytes. LRU limits exclude active decode/GPU memory. */
export class GaiaSourceCache {
  private entries = new Map<string, Uint8Array>()
  private size = 0
  readonly maxBytes: number
  readonly maxEntries: number
  constructor(maxBytes = 16*1024*1024, maxEntries = 128) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64*1024*1024 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 2592) throw new Error('Invalid Gaia cache budget')
    this.maxBytes = maxBytes; this.maxEntries = maxEntries
  }
  get retainedBytes() { return this.size }
  get count() { return this.entries.size }
  get(hash: string): Uint8Array | undefined {
    const bytes = this.entries.get(hash)
    if (!bytes) return
    this.entries.delete(hash); this.entries.set(hash,bytes)
    return bytes.slice()
  }
  put(hash: string, bytes: Uint8Array) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid Gaia cache hash')
    if (bytes.byteLength > this.maxBytes) return
    this.delete(hash)
    while (this.size+bytes.byteLength > this.maxBytes || this.entries.size >= this.maxEntries) this.delete(this.entries.keys().next().value!)
    this.entries.set(hash,Uint8Array.from(bytes)); this.size += bytes.byteLength
  }
  delete(hash: string) {
    const existing = this.entries.get(hash)
    if (existing) { this.size -= existing.byteLength; this.entries.delete(hash) }
  }
  clear() { this.entries.clear(); this.size = 0 }
}
