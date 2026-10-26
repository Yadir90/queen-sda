// Queen SDA — cola durable de escrituras sin conexión (D-03/D-68).
//
// Puerto del motor offline del original (su client/src/offline.ts):
// IndexedDB `la-reina-offline-v1`, escrituras que se encolan cuando no
// hay red y se REENVÍAN EN ORDEN al volver la conexión, con el estado
// público que alimenta la píldora ConnectionStatus de la carcasa
// (getOfflineState / subscribeOfflineState / requestOfflineSync).
//
// Alcance honesto de esta copia: la cola cubre las escrituras de las
// pantallas contra Supabase (abonos de Cobrar, movimientos de la
// tarjeta, gastos, almacén manual, inventario de bienes, referencias
// de paquetes, boletines, estado de Queen y de automatizaciones).
// Las operaciones en bloque o destructivas (importar respaldo/IPV,
// eliminar un día, ajustes de RH que devuelven el estado, contraseña)
// NO se encolan: sin red fallan con su error, como debe ser — una
// importación o un borrado nunca se «dispara solo» después.
//
// PIN y biometría nunca viajan por la cola (el original tampoco los
// trata como optimistas): aquí no existe ninguna operación de ese
// tipo entre las encolables.

export interface OfflineState {
  online: boolean
  pending: number
  syncing: boolean
  error: string | null
}

export interface QueuedOp {
  id: string
  fn: string
  args: unknown[]
  createdAt: number
  attempts: number
  lastError: string | null
}

const DB_NAME = 'la-reina-offline-v1'
const STORE = 'write-queue'
const LS_KEY = 'queen-sda:offline-queue-v1'

type Executor = (op: QueuedOp) => Promise<void>
let executor: Executor | null = null
export function registerOfflineExecutor(fn: Executor): void {
  executor = fn
}

// ---------- Persistencia (IndexedDB con respaldo localStorage) ----------

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB no disponible'))
  })
}

async function idbAll(): Promise<QueuedOp[]> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as QueuedOp[]).sort((a, b) => a.createdAt - b.createdAt))
    req.onerror = () => reject(req.error ?? new Error('No se pudo leer la cola'))
  })
}

async function idbPut(op: QueuedOp): Promise<void> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(op)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar en la cola'))
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('No se pudo limpiar la cola'))
  })
}

function lsAll(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const list = raw ? (JSON.parse(raw) as QueuedOp[]) : []
    return Array.isArray(list) ? list.sort((a, b) => a.createdAt - b.createdAt) : []
  } catch { return [] }
}
function lsSave(list: QueuedOp[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* sin almacenamiento */ }
}

let useLsFallback = false
async function loadQueue(): Promise<QueuedOp[]> {
  if (useLsFallback) return lsAll()
  try { return await idbAll() } catch { useLsFallback = true; return lsAll() }
}
async function persistPut(op: QueuedOp): Promise<void> {
  if (!useLsFallback) {
    try { await idbPut(op); return } catch { useLsFallback = true }
  }
  const list = lsAll()
  const idx = list.findIndex((o) => o.id === op.id)
  if (idx >= 0) list[idx] = op; else list.push(op)
  lsSave(list)
}
async function persistDelete(id: string): Promise<void> {
  if (!useLsFallback) {
    try { await idbDelete(id); return } catch { useLsFallback = true }
  }
  lsSave(lsAll().filter((o) => o.id !== id))
}

// ---------- Estado público (el de la píldora) ----------

let queue: QueuedOp[] = []
let syncing = false
let lastError: string | null = null
let loaded = false
const listeners = new Set<(s: OfflineState) => void>()

function snapshot(): OfflineState {
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: queue.length,
    syncing,
    error: lastError,
  }
}
function notify(): void {
  const s = snapshot()
  for (const fn of listeners) fn(s)
}

export function getOfflineState(): OfflineState {
  return snapshot()
}

export function subscribeOfflineState(fn: (s: OfflineState) => void): () => void {
  listeners.add(fn)
  fn(snapshot())
  return () => { listeners.delete(fn) }
}

// ---------- Encolar y reenviar EN ORDEN ----------

let opSeq = 0
export async function enqueueOfflineOp(fn: string, args: unknown[]): Promise<void> {
  const op: QueuedOp = {
    id: `q-${Date.now()}-${++opSeq}`,
    fn,
    args,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  }
  queue = [...queue, op]
  await persistPut(op)
  notify()
  if (snapshot().online) void flushQueue()
}

let flushing = false
export async function flushQueue(): Promise<void> {
  if (flushing || !executor) return
  if (!snapshot().online || queue.length === 0) return
  flushing = true
  syncing = true
  notify()
  let applied = 0
  try {
    while (queue.length > 0) {
      const op = queue[0]
      try {
        await executor(op)
      } catch (e) {
        op.attempts += 1
        op.lastError = e instanceof Error ? e.message : String(e)
        lastError = op.lastError
        await persistPut(op).catch(() => { /* la cola en memoria manda */ })
        break // en orden: si una falla, las demás esperan detrás de ella
      }
      queue = queue.slice(1)
      applied += 1
      await persistDelete(op.id).catch(() => { /* idem */ })
      notify()
    }
    if (queue.length === 0) lastError = null
  } finally {
    syncing = false
    flushing = false
    notify()
    if (applied > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('queen-offline-flushed', { detail: { applied } }))
    }
  }
}

/** El toque en la píldora: reintenta la sincronización, como el
 *  requestOfflineSync del original. */
export function requestOfflineSync(): void {
  void flushQueue()
}

// Arranque: se lee la cola guardada y, si hay red y ejecutor, se
// reenvía sola. Los eventos de red mantienen el estado al día.
if (typeof window !== 'undefined') {
  void loadQueue().then((ops) => {
    queue = ops
    loaded = true
    notify()
    if (snapshot().online) void flushQueue()
  }).catch(() => { loaded = true })
  window.addEventListener('online', () => { notify(); void flushQueue() })
  window.addEventListener('offline', () => notify())
}

export function offlineQueueLoaded(): boolean {
  return loaded
}
