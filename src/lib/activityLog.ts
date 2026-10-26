/* Registro de actividad por usuario (decisión del dueño,
 * 2026-10-26 15:02): en Cronología —pestaña solo del
 * administrador— debe quedar reflejado TODO lo que hagan Yan,
 * Jesús y Dayami: inicios de sesión, creaciones/ediciones/borrados
 * en las secciones donde tengan escritura, importaciones,
 * exportaciones de documentos y el uso del chat de Queen, con
 * quién, qué y cuándo.
 *
 * El registro empieza cuando esta función existe: no se inventan
 * eventos pasados. Cada entrada se guarda en este dispositivo
 * (localStorage) y, en modo Supabase, se intenta además persistir
 * la lista en app_settings ('activity-log') para que el
 * administrador la vea desde cualquier dispositivo; si la política
 * de la base no permite escribir a un rol de lectura, sus entradas
 * quedan en su dispositivo (límite declarado en IGUALACION).
 *
 * Solo se registran las acciones de usuarios NO administradores:
 * es la vista del administrador sobre la actividad de su equipo.
 */
import type { Section, Session } from '../types'

export type ActivityKind = 'sesion' | 'edicion' | 'borrado' | 'importacion' | 'exportacion' | 'queen' | 'fallido'

export interface ActivityEntry {
  id: string
  ts: string
  profileId: string
  userName: string
  role: string
  kind: ActivityKind
  section?: Section
  detail: string
  /** Cuando el administrador está «viendo como» este usuario, las
   * acciones se atribuyen a él dentro de la cuenta ajena, nunca al
   * dueño de la cuenta (decisión del dueño, 2026-10-26 15:09). */
  viaAdmin?: string
}

const LS_KEY = 'queen-sda:activity-log-v1'
const MAX_ENTRIES = 800

let actor: Session | null = null
let impersonatorName: string | null = null
const listeners = new Set<() => void>()

export function setActivityActor(session: Session | null): void {
  actor = session
}

/** Nombre del administrador cuando está dentro de una cuenta ajena
 *  («entrar como»); null en sesiones normales. */
export function setImpersonationMarker(name: string | null): void {
  impersonatorName = name
}

export function loadActivityLog(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ActivityEntry[]
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.id && e.ts) : []
  } catch {
    return []
  }
}

function persist(entries: ActivityEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch { /* sin almacenamiento local: el registro vive en memoria */ }
  for (const fn of listeners) fn()
}

export function subscribeActivityLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Fusiona entradas remotas (Supabase) con las locales, por id. */
export function mergeActivityLog(remote: ActivityEntry[]): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>()
  for (const e of loadActivityLog()) byId.set(e.id, e)
  for (const e of remote) if (e && e.id && e.ts) byId.set(e.id, e)
  const merged = [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_ENTRIES)
  persist(merged)
  return merged
}

let remoteSaver: ((entries: ActivityEntry[]) => Promise<void>) | null = null
/** App registra el guardado remoto (modo Supabase) al arrancar. */
export function setActivityRemoteSaver(fn: ((entries: ActivityEntry[]) => Promise<void>) | null): void {
  remoteSaver = fn
}

/**
 * Registra una acción del usuario en curso. Sin actor o con actor
 * administrador no se registra nada (el registro es la vista del
 * administrador sobre su equipo). `explicitActor` permite registrar
 * el inicio de sesión justo antes de fijar el actor global.
 */
export function logActivity(
  kind: ActivityKind,
  detail: string,
  opts?: { section?: Section; actor?: Session },
): void {
  const who = opts?.actor ?? actor
  if (!who || who.role === 'admin') return
  const entry: ActivityEntry = {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    /* Instante absoluto (ISO UTC); Cronología lo presenta en hora
       de La Habana, como el resto de marcas de tiempo del sistema. */
    ts: new Date().toISOString(),
    profileId: who.profileId,
    userName: who.name,
    role: who.role,
    kind,
    section: opts?.section,
    detail,
    ...(impersonatorName ? { viaAdmin: impersonatorName } : {}),
  }
  const next = [entry, ...loadActivityLog()].slice(0, MAX_ENTRIES)
  persist(next)
  if (remoteSaver) void remoteSaver(next).catch(() => { /* queda la copia local */ })
}

/**
 * Evento de suplantación («entrar como»): lo firma el propio
 * administrador, por eso no pasa por el filtro de logActivity (que
 * solo registra a los demás usuarios). Queda en Cronología con su
 * nombre y la hora, como manda la decisión del dueño.
 */
export function logImpersonationEvent(adminName: string, detail: string): void {
  const entry: ActivityEntry = {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    profileId: 'yadir',
    userName: adminName,
    role: 'admin',
    kind: 'sesion',
    detail,
  }
  const next = [entry, ...loadActivityLog()].slice(0, MAX_ENTRIES)
  persist(next)
  if (remoteSaver) void remoteSaver(next).catch(() => { /* queda la copia local */ })
}
