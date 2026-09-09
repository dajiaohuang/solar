export const CANONICAL_APP_URL = 'https://dajiaohuang.github.io/solar/'
export const CATALOG_DATA_ROOT = (typeof __SOLAR_DATA_ROOT__ !== 'undefined' && __SOLAR_DATA_ROOT__)
  || `${import.meta.env.BASE_URL}data/asteroids`

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function shareSceneUrl(url: string, title = 'Solar Atlas') {
  void title
  await navigator.clipboard.writeText(url)
  return 'copied' as const
}

export async function saveExport(blob: Blob, filename: string) {
  downloadBlob(blob, filename)
}

export function saveTextExport(content: string, filename: string, mimeType: string) {
  return saveExport(new Blob([content], { type: mimeType }), filename)
}
