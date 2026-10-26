// Queen SDA — cliente de MEDIA AUTENTICADA (tabla public.media).
//
// Los binarios del sistema original (fotos de productos/almacén/
// trabajadores/clientes, documentos, foto de perfil, activos del
// sistema e IPV archivados) viven SOLO en la tabla `media` de
// Supabase, tras el login (RLS: lectura con rol, escritura solo
// admin). Nunca se publican como archivos estáticos.
//
// Rendimiento (Galaxy A16): NUNCA se trae la tabla entera. Primero
// se carga un ÍNDICE LIGERO por `kind` (sin data_base64: kind,
// entity_key, variant, label, mime, bytes) y cada binario se pide
// por (kind, entity_key, variant) SOLO cuando su pantalla lo pinta,
// con caché en memoria por sesión. En modo local (sin Supabase)
// no hay tabla: el cliente devuelve vacío y las pantallas pintan
// su respaldo honesto (iniciales / sin foto), sin fingir datos.

import { useEffect, useState } from 'react'
import { getSupabase } from './supabaseClient'
import { supabaseConfigured } from './supabaseClient'

export type MediaKind =
  | 'foto-producto' | 'foto-almacen' | 'foto-trabajador' | 'documento-trabajador'
  | 'foto-cliente' | 'foto-perfil' | 'activo-sistema'
  | 'ipv-original' | 'ipv-actualizado'
  | 'adjunto-correo' | 'grafico-correo' | 'firma-trabajador'

export interface MediaIndexItem {
  kind: string
  entity_key: string
  variant: string
  label: string
  mime: string
  bytes: number
}

/**
 * slug() IDÉNTICO al del generador de la importación
 * (scripts/generate-media-sql.mjs): NFD, sin acentos, minúsculas,
 * [^a-z0-9]+ → '-'. Es el contrato de claves de public.media.
 */
export function slug(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Clave de foto de producto: slug(departamento + nombre + um),
 *  la misma que productKeyOf del original convertida a stem. */
export function productMediaKey(dept: string, name: string, um: string): string {
  return slug(`${dept ?? ''} ${name ?? ''} ${um ?? ''}`)
}

/** Normalización de nombre de persona para emparejar fichas
 *  (la de clientKeyOf/canonicalPersonKey de syncCore, sin acentos). */
export function personNorm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ')
}

const indexCache = new Map<string, Promise<MediaIndexItem[]>>()
const dataCache = new Map<string, Promise<string | null>>()

const cacheKey = (kind: string, entityKey: string, variant: string) => `${kind}|${entityKey}|${variant}`

/** Índice ligero de un kind (sin data_base64), bajo demanda y con
 *  caché. Sin Supabase (modo local) o sin tabla: lista vacía. */
export function loadMediaIndex(kind: MediaKind | string): Promise<MediaIndexItem[]> {
  const cached = indexCache.get(kind)
  if (cached) return cached
  const promise = (async (): Promise<MediaIndexItem[]> => {
    if (!supabaseConfigured()) return []
    const client = getSupabase()
    if (!client) return []
    const { data, error } = await client
      .from('media')
      .select('kind, entity_key, variant, label, mime, bytes')
      .eq('kind', kind)
      .order('entity_key')
    if (error || !data) return []
    return data as MediaIndexItem[]
  })()
  indexCache.set(kind, promise)
  return promise
}

/** Data URL de UN binario, bajo demanda y con caché en memoria. */
export function loadMediaDataUrl(kind: MediaKind | string, entityKey: string, variant = ''): Promise<string | null> {
  const key = cacheKey(kind, entityKey, variant)
  const cached = dataCache.get(key)
  if (cached) return cached
  const promise = (async (): Promise<string | null> => {
    if (!supabaseConfigured()) return null
    const client = getSupabase()
    if (!client) return null
    const { data, error } = await client
      .from('media')
      .select('mime, data_base64')
      .eq('kind', kind)
      .eq('entity_key', entityKey)
      .eq('variant', variant)
      .maybeSingle<{ mime: string; data_base64: string }>()
    if (error || !data?.data_base64) return null
    return `data:${data.mime};base64,${data.data_base64}`
  })()
  dataCache.set(key, promise)
  return promise
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Blob de UN binario (para descargas de IPV/PDF y visores). */
export async function loadMediaBlob(kind: MediaKind | string, entityKey: string, variant = ''): Promise<{ blob: Blob; mime: string; label: string } | null> {
  if (!supabaseConfigured()) return null
  const client = getSupabase()
  if (!client) return null
  const { data, error } = await client
    .from('media')
    .select('mime, label, data_base64')
    .eq('kind', kind)
    .eq('entity_key', entityKey)
    .eq('variant', variant)
    .maybeSingle<{ mime: string; label: string; data_base64: string }>()
  if (error || !data?.data_base64) return null
  return { blob: base64ToBlob(data.data_base64, data.mime), mime: data.mime, label: data.label }
}

async function sha256Hex(base64: string): Promise<string> {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

/**
 * Guarda (crea o sustituye) un binario en public.media. Solo el
 * administrador puede escribir (RLS lo impone en el servidor; un
 * perfil de lectura recibe el rechazo y se propaga el error).
 * Tras guardar, la caché de esa clave y la del índice se invalidan
 * para que la pantalla repinte el contenido nuevo.
 */
export async function saveMedia(input: {
  kind: MediaKind | string
  entityKey: string
  variant?: string
  label: string
  mime: string
  dataBase64: string
}): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Sin conexión con Supabase: la media solo se guarda en el servidor.')
  const variant = input.variant ?? ''
  const bytes = Math.floor((input.dataBase64.length * 3) / 4)
  const sha256 = await sha256Hex(input.dataBase64)
  const { error } = await client.from('media').upsert(
    {
      kind: input.kind, entity_key: input.entityKey, variant, label: input.label,
      mime: input.mime, bytes, sha256, data_base64: input.dataBase64,
    },
    { onConflict: 'kind,entity_key,variant' },
  )
  if (error) throw new Error('El servidor rechazó guardar el archivo. Solo el administrador puede escribir la media, o falló la conexión.')
  dataCache.delete(cacheKey(input.kind, input.entityKey, variant))
  indexCache.delete(input.kind)
}

/** Borra un binario de public.media (solo admin, RLS). */
export async function deleteMedia(kind: MediaKind | string, entityKey: string, variant = ''): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Sin conexión con Supabase: la media solo se borra en el servidor.')
  const { error } = await client.from('media').delete().eq('kind', kind).eq('entity_key', entityKey).eq('variant', variant)
  if (error) throw new Error('El servidor rechazó borrar el archivo. Solo el administrador puede borrar media, o falló la conexión.')
  dataCache.delete(cacheKey(kind, entityKey, variant))
  indexCache.delete(kind)
}

/** Lee un File como base64 pelado (sin el prefijo data:). */
export function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      const comma = url.indexOf(',')
      resolve({ base64: comma >= 0 ? url.slice(comma + 1) : url, mime: file.type || 'application/octet-stream' })
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

/** Data URL → base64 pelado. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

// ---------- Hooks ----------

/** Índice ligero de un kind para la pantalla que lo pinta. */
export function useMediaIndex(kind: MediaKind | string): { items: MediaIndexItem[]; ready: boolean } {
  const [items, setItems] = useState<MediaIndexItem[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    setReady(false)
    void loadMediaIndex(kind).then((list) => {
      if (!cancelled) { setItems(list); setReady(true) }
    })
    return () => { cancelled = true }
  }, [kind])
  return { items, ready }
}

/** Data URL de un binario concreto (null = no existe / sin cargar
 *  todavía / modo local). `entityKey` null no pide nada. */
export function useMediaUrl(kind: MediaKind | string, entityKey: string | null, variant = ''): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    if (!entityKey) return
    void loadMediaDataUrl(kind, entityKey, variant).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [kind, entityKey, variant])
  return url
}

/**
 * Foto de cliente del original: coincidencia por slug del nombre
 * completo y, si no, por el primer nombre (la clave guardada puede
 * ser «dayami-daya», «jesus», «noel»…). Devuelve el item o null.
 */
export function pickClientPhoto(items: MediaIndexItem[], clientName: string): MediaIndexItem | null {
  if (!items.length) return null
  const full = slug(clientName)
  const exact = items.find((i) => i.entity_key === full)
  if (exact) return exact
  const first = slug(String(clientName ?? '').split(/[\s(]/)[0] ?? '')
  if (!first) return null
  return items.find((i) => i.entity_key === first || i.entity_key.startsWith(`${first}-`)) ?? null
}

/** Extensión de archivo según el mime guardado (para descargas). */
export function extForMime(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'xlsx'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/jpeg') return 'jpg'
  return 'bin'
}
