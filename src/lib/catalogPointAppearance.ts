const CLASS_COLORS: Record<string, readonly [number, number, number]> = {
  MBA: [0.45, 0.65, 0.79], APO: [1, 0.45, 0.37], ATE: [1, 0.68, 0.33],
  AMO: [0.91, 0.56, 0.85], ATI: [0.96, 0.83, 0.37], MCR: [0.94, 0.56, 0.42], HUN: [0.44, 0.82, 0.66],
  HIL: [0.62, 0.55, 1], JTA: [0.79, 0.65, 0.42], TNO: [0.56, 0.68, 1],
}
const PHA = [1, 0.35, 0.3] as const, NEO = [1, 0.62, 0.5] as const, OTHER = [0.62, 0.7, 0.76] as const

export function catalogPointColor(orbitClass: string, flags: number) {
  return flags & 2 ? PHA : flags & 1 ? NEO : CLASS_COLORS[orbitClass] ?? OTHER
}

export function catalogPointSize(flags: number) { return flags & 2 ? 3.2 : flags & 1 ? 2.5 : 1.7 }

/** Compact per-class/per-flag RGB8 + size-tenths lookup for large upload loops. */
export function createCatalogPointStyleTable(orbitClasses: readonly string[]) {
  const table = new Uint8Array(orbitClasses.length * 8 * 4)
  for (let classIndex = 0; classIndex < orbitClasses.length; classIndex++) {
    for (let flags = 0; flags < 8; flags++) {
      const color = catalogPointColor(orbitClasses[classIndex], flags)
      const offset = (classIndex * 8 + flags) * 4
      table[offset] = Math.round(color[0] * 255)
      table[offset + 1] = Math.round(color[1] * 255)
      table[offset + 2] = Math.round(color[2] * 255)
      table[offset + 3] = Math.round(catalogPointSize(flags) * 10)
    }
  }
  return table
}
