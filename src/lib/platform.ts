import { Capacitor } from '@capacitor/core'

const IS_NATIVE_BUILD = typeof __SOLAR_NATIVE__ !== 'undefined' && __SOLAR_NATIVE__
export const IS_NATIVE_APP = IS_NATIVE_BUILD || Capacitor.isNativePlatform()
export const CANONICAL_APP_URL = 'https://dajiaohuang.github.io/solar/'
export const CATALOG_DATA_ROOT = (typeof __SOLAR_DATA_ROOT__ !== 'undefined' && __SOLAR_DATA_ROOT__)
  || (IS_NATIVE_APP ? `${CANONICAL_APP_URL}data/asteroids` : `${import.meta.env.BASE_URL}data/asteroids`)

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function blobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read export'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

export async function shareSceneUrl(url: string, title = 'Solar Atlas') {
  if (IS_NATIVE_APP) {
    const { Share } = await import('@capacitor/share')
    try {
      await Share.share({ title, text: title, url, dialogTitle: title })
      return 'shared' as const
    } catch (error) {
      if (error instanceof Error && /share cancel(?:ed|led)/i.test(error.message)) return 'cancelled' as const
      throw error
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied' as const
}

export async function saveExport(blob: Blob, filename: string) {
  if (!IS_NATIVE_APP) {
    downloadBlob(blob, filename)
    return
  }

  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const path = `exports/${filename}`
  const result = await Filesystem.writeFile({
    path,
    data: await blobAsBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  })
  try {
    await Share.share({ title: filename, files: [result.uri], dialogTitle: filename })
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined)
  }
}

export function saveTextExport(content: string, filename: string, mimeType: string) {
  return saveExport(new Blob([content], { type: mimeType }), filename)
}
