// Queen SDA — marcas del negocio EMPACQUETADAS en el bundle, byte a
// byte las del sistema original (D-30): en el original viven en
// client/src/assets y entran en su dist; en el clon solo existían
// servidas desde la tabla media de Supabase, así que sin media aplicada
// o sin conexión no cargaban. Los mismos bytes quedan también en media
// (la tabla sigue siendo la fuente para el resto de fotos); estas
// copias garantizan que logo, logo blanco y cuño existan SIEMPRE,
// también sin conexión, como en el original.
//
// SHA-256 verificados contra el original (INFORME-DIFERENCIAS):
//   la-reina-logo.jpg                    43909d3bfe5d4fcdb4…
//   la-reina-logo-blanco-transparente.png dc5e48ac61c9c732…
//   cuno-la-reina-aprobado.webp          bc8d0b268b4d8b3e…

import logoUrl from '../assets/la-reina-logo.jpg'
import logoBlancoUrl from '../assets/la-reina-logo-blanco-transparente.png'
import cunoUrl from '../assets/cuno-la-reina-aprobado.webp'

export const BRAND_LOGO_URL = logoUrl
export const BRAND_LOGO_BLANCO_URL = logoBlancoUrl
export const BRAND_CUNO_URL = cunoUrl

/** Data URL de un recurso empaquetado (para lienzos/PDF que no pueden
 *  referenciar la URL del bundle: credencial de trabajador). Se lee del
 *  propio origen — el service worker lo sirve de la caché sin red. */
export async function bundledDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer el recurso empaquetado.'))
    reader.readAsDataURL(blob)
  })
}
