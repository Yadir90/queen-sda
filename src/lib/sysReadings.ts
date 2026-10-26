// Lecturas de rendimiento de ESTA copia, medidas en el dispositivo.
//
// Puerto del registro de lecturas del original (de ahí salen su vista
// «Rendimiento», su rejilla «Día × hora», sus «Eventos» y su «Actividad»
// en client/src/charts.tsx · SystemRealtimeCharts): cada apertura de
// Sistema mide lo medible aquí y ahora — peso real de los datos
// cargados (KB), memoria JS del navegador cuando la expone (MB) y
// latencia de esa medición (ms) — y guarda la lectura con su hora.
//
// REFUERZO (corrección del espejo): además de las lecturas de apertura,
// se SIEMBRAN lecturas históricas derivadas de los días reales del
// respaldo importado, para que las vistas no nazcan vacías en un
// dispositivo nuevo:
//   · una lectura por jornada importada, con `source: 'historica'`;
//   · su `pesoKb` es el peso REAL del registro de ese día (el JSON del
//     DayData medido con la misma fórmula que las lecturas de apertura);
//   · `memoriaMb` y `latenciaMs` quedan null: en su día no se midieron
//     en este dispositivo y no se inventan;
//   · su hora se fija a las 12:00 de la jornada SOLO como clave de
//     agrupación de la rejilla «Día × hora» (el respaldo trae la fecha,
//     no la hora de la comprobación): la UI lo declara. Lo real de la
//     lectura sembrada es la jornada y su peso, no esa hora.
//   · los FALLOS por jornada no viven en la lectura: se calculan en
//     Sistema desde el propio día (cuadre ≠ 0 y merma con costo > 0),
//     igual que el original cuenta failedCount por jornada observada.
// La siembra es idempotente: una jornada ya sembrada no se duplica, y
// las lecturas de apertura (`source: 'apertura'`, o sin source en
// registros antiguos) nunca se tocan.

export interface SysReading {
  at: string // ISO con hora local
  pesoKb: number | null
  memoriaMb: number | null
  latenciaMs: number | null
  /** 'historica' = sembrada desde un día del respaldo · 'apertura' = medida al abrir Sistema. */
  source?: 'historica' | 'apertura'
}

/** Forma mínima de un día que la siembra necesita (DayData la cumple). */
export interface SysSeedDay {
  date: string
  cuadre: number
}

const KEY = 'queen-sda:sysreadings:v1'
const MAX = 400

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

function saveReadings(next: SysReading[]): SysReading[] {
  const sorted = [...next].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(sorted))
  } catch {
    // Sin almacenamiento disponible: las lecturas de esta sesión se usan igual.
  }
  return sorted
}

/** Peso en KB (1 decimal) con la fórmula de las lecturas de apertura. */
function pesoKbOf(payload: unknown): number | null {
  try {
    return Math.round((JSON.stringify(payload)?.length ?? 0) / 102.4) / 10
  } catch {
    return null
  }
}

/**
 * Siembra (una sola vez por jornada) las lecturas históricas derivadas
 * de los días del respaldo. Devuelve la lista completa guardada.
 * `days` debe venir con su registro completo para medir su peso real:
 * por eso recibe los DayData enteros, no un resumen.
 */
export function seedHistoricalReadings(days: readonly unknown[], dayDates: readonly string[]): SysReading[] {
  const current = loadReadings()
  const seededDates = new Set(
    current.filter((r) => r.source === 'historica').map((r) => r.at.slice(0, 10)),
  )
  const fresh: SysReading[] = []
  days.forEach((day, i) => {
    const date = dayDates[i]
    if (!date || seededDates.has(date)) return
    seededDates.add(date)
    fresh.push({
      // Clave de agrupación declarada: mediodía local de la jornada.
      at: new Date(`${date}T12:00:00`).toISOString(),
      pesoKb: pesoKbOf(day),
      memoriaMb: null,
      latenciaMs: null,
      source: 'historica',
    })
  })
  if (!fresh.length) return current
  return saveReadings([...current, ...fresh])
}

/** Mide el estado actual y añade la lectura (una por apertura de Sistema). */
export function recordReading(payload: unknown): SysReading[] {
  const t0 = performance.now()
  const pesoKb = pesoKbOf(payload)
  const latenciaMs = Math.max(1, Math.round(performance.now() - t0))
  let memoriaMb: number | null = null
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
  if (mem?.usedJSHeapSize) memoriaMb = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10
  const reading: SysReading = { at: new Date().toISOString(), pesoKb, memoriaMb, latenciaMs, source: 'apertura' }
  return saveReadings([...loadReadings(), reading])
}
