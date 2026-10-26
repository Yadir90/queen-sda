// Lecturas de rendimiento de ESTA copia, medidas en el dispositivo.
//
// El original registra lecturas de rendimiento y de ahí salen su vista
// «Rendimiento» y su rejilla «Día × hora». Esta copia hace lo mismo a su
// escala: cada vez que se abre Sistema se mide lo medible aquí y ahora —
// peso real de los datos cargados (KB), memoria JS del navegador cuando
// la expone (MB) y latencia de esa medición (ms) — y se guarda la lectura
// con su hora local. Sin lecturas no hay gráfico: las vistas muestran el
// aviso del original en vez de rellenar actividad que no se midió.

export interface SysReading {
  at: string // ISO con hora local
  pesoKb: number | null
  memoriaMb: number | null
  latenciaMs: number | null
}

const KEY = 'queen-sda:sysreadings:v1'
const MAX = 240

export function loadReadings(): SysReading[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SysReading[]
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.at === 'string') : []
  } catch {
    return []
  }
}

/** Mide el estado actual y añade la lectura (una por apertura de Sistema). */
export function recordReading(payload: unknown): SysReading[] {
  const t0 = performance.now()
  let pesoKb: number | null = null
  try {
    pesoKb = Math.round((JSON.stringify(payload)?.length ?? 0) / 102.4) / 10
  } catch {
    pesoKb = null
  }
  const latenciaMs = Math.max(1, Math.round(performance.now() - t0))
  let memoriaMb: number | null = null
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
  if (mem?.usedJSHeapSize) memoriaMb = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10
  const reading: SysReading = { at: new Date().toISOString(), pesoKb, memoriaMb, latenciaMs }
  const next = [...loadReadings(), reading].slice(-MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Sin almacenamiento disponible: la lectura de esta apertura se usa igual.
  }
  return next
}
