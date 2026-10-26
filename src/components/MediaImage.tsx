// Queen SDA — imagen de la media autenticada (tabla public.media).
//
// Cada imagen pide SU binario bajo demanda (con la caché de
// src/lib/media.ts): nunca se trae la tabla entera. Si el binario
// no existe (o la app está en modo local, sin tabla), se pinta el
// respaldo que pase la pantalla (iniciales, letra, nada): la
// ausencia se dibuja como ausencia, nunca como una foto inventada.

import type { CSSProperties, ReactNode } from 'react'
import { pickClientPhoto, slug, useMediaIndex, useMediaUrl, type MediaKind } from '../lib/media'
import defaultPersonAvatar from '../assets/default-person-avatar.jpg'
import './workerFicha.css'

export function MediaImage({
  kind, entityKey, variant = '', alt = '', className, style, fallback = null,
}: {
  kind: MediaKind | string
  entityKey: string | null
  variant?: string
  alt?: string
  className?: string
  style?: CSSProperties
  fallback?: ReactNode
}) {
  const url = useMediaUrl(kind, entityKey, variant)
  if (!url) return <>{fallback}</>
  return <img src={url} alt={alt} className={className} style={style} loading="lazy" decoding="async" />
}

const PERSON_COLORS = ['#0e9f6e', '#0ea5bd', '#3b82f6', '#8b5cf6', '#e9a13b', '#287c5c', '#d64541', '#0b7285']
export function personColor(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PERSON_COLORS[h % PERSON_COLORS.length]
}
export function initialsOf(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'
}

/** Avatar de cliente (Cobrar/Cuentas), como el debtorAvatar y la
 *  tarjeta de contacto del original: foto-cliente por slug del
 *  nombre, con coincidencia por primer nombre; sin foto propia, el
 *  avatar genérico del original (default-person-avatar): el clon lo
 *  lleva EMPAQUETADO en src/assets, byte a byte el mismo archivo
 *  que el original importa desde su código, así que se ve siempre
 *  — también en modo local o sin la tabla media aplicada — y nunca
 *  cae a iniciales. Nunca una foto de otra persona ni de relleno. */
export function ClientAvatar({ name, clientKey, className = 'account-avatar' }: {
  name: string
  clientKey: string
  className?: string
}) {
  const { items } = useMediaIndex('foto-cliente')
  const item = pickClientPhoto(items, name)
  const url = useMediaUrl('foto-cliente', item?.entity_key ?? null, item?.variant ?? '')
  const defaultUrl = useMediaUrl('activo-sistema', url ? null : 'default-person-avatar')
  const src = url ?? defaultUrl ?? defaultPersonAvatar
  if (src) return <img src={src} alt="" className={className} style={{ objectFit: 'cover' }} loading="lazy" decoding="async" />
  return <span className={className} style={{ background: personColor(clientKey) }} aria-hidden>{initialsOf(name)}</span>
}

/** Foto de trabajador por slug(nombre); sin foto, iniciales. */
export function WorkerPhoto({ nombre, className, avatarClassName = 'org-avatar', colorKey }: {
  nombre: string
  className?: string
  avatarClassName?: string
  colorKey?: string
}) {
  const url = useMediaUrl('foto-trabajador', nombre ? slug(nombre) : null)
  if (url) return <img src={url} alt="" className={className} loading="lazy" decoding="async" />
  return (
    <span className={avatarClassName} style={{ background: personColor(colorKey ?? nombre) }} aria-hidden="true">
      {initialsOf(nombre)}
    </span>
  )
}
