const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Shrinks big phone screenshots before upload (saves mobile data) and
 * converts anything the browser can decode into JPEG.
 */
export async function prepareImage(file: File, maxSide = 1600, maxBytes = 8 * 1024 * 1024): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG or PNG).')
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && ALLOWED.includes(file.type) && file.size < 1.5 * 1024 * 1024) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (blob) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    /* cannot decode: fall back to the original file */
  }
  if (!ALLOWED.includes(file.type)) throw new Error('Please upload a JPG, PNG or WEBP image.')
  if (file.size > maxBytes) throw new Error('Image is too large (max 8 MB).')
  return file
}

export function extOf(file: File): string {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}
