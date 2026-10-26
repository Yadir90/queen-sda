// Queen SDA — emparejamiento del estado extendido de trabajadores
// (app_settings 'workers-extended') con el registro de RH del clon,
// y el identificador de credencial del original.
//
// El extendido se empareja por worker_key/nombre normalizado (la
// misma normalización de syncCore: sin acentos, minúsculas). Las
// claves de una sola palabra del servidor («dayami», «jesus»,
// «yeisi»…) emparejan por el primer nombre de la ficha.

import type { Worker, WorkerExtended } from '../types'
import { personNorm, slug } from './media'

export function extendedForWorker(worker: Worker, list: WorkerExtended[]): WorkerExtended | null {
  if (!list.length) return null
  const keyNorm = personNorm(worker.key)
  const nameNorm = personNorm(worker.nombre)
  const nameSlug = slug(worker.nombre)
  const firstName = nameNorm.split(' ')[0] ?? ''
  for (const ext of list) {
    if (ext.workerKey && (ext.workerKey === keyNorm || ext.workerKey === nameNorm)) return ext
    if (ext.nombre && (personNorm(ext.nombre) === nameNorm || slug(ext.nombre) === nameSlug)) return ext
  }
  // Claves cortas del servidor (una sola palabra): primer nombre.
  for (const ext of list) {
    if (ext.workerKey && !ext.workerKey.includes(' ') && ext.workerKey === firstName) return ext
  }
  return null
}

/** Mapa clave-del-clon → extendido, para pantallas con muchas fichas. */
export function extendedByWorker(list: WorkerExtended[], workers: Worker[]): Map<string, WorkerExtended> {
  const map = new Map<string, WorkerExtended>()
  for (const w of workers) {
    const ext = extendedForWorker(w, list)
    if (ext) map.set(w.key, ext)
  }
  return map
}

// ---------- Credencial del original (workerCredentialId) ----------

export function workerCredentialId(numericId: number): string {
  return `LR-TRAB-${String(numericId).padStart(6, '0')}`
}

export function workerCredentialPayload(numericId: number): string {
  return `PDL-LA-REINA|TRABAJADOR|${workerCredentialId(numericId)}`
}

export function workerIdFromCredentialPayload(payload: string): number | null {
  const match = String(payload ?? '').trim().match(/^PDL-LA-REINA\|TRABAJADOR\|LR-TRAB-(\d{6})$/)
  if (!match?.[1]) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Acepta también la entrada manual: «LR-TRAB-000016», el payload
 *  completo o solo el número, y devuelve el id numérico. */
export function workerIdFromManualCode(raw: string): number | null {
  const text = String(raw ?? '').trim()
  const fromPayload = workerIdFromCredentialPayload(text)
  if (fromPayload != null) return fromPayload
  const m = /LR-TRAB-(\d{1,6})/i.exec(text) ?? /^(\d{1,6})$/.exec(text)
  if (!m?.[1]) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Id numérico de credencial de una ficha: el id REAL del servidor
 * original cuando el estado extendido lo trae (Yadir = 16, etc.).
 * Sin extendido, se deriva uno estable del nombre (hash de la
 * clave) SOLO para que la credencial y el escáner de esta copia
 * sean coherentes entre sí; queda declarado en IGUALACION.md.
 */
export function credentialNumericId(worker: Worker, extended: WorkerExtended | null): number {
  if (extended && extended.id > 0) return extended.id
  const key = personNorm(worker.key || worker.nombre)
  let h = 0
  for (const c of key) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0
  return 900000 + (h % 99999)
}
