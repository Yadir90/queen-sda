// Queen SDA — prueba de verificación del importador de respaldo.
// Uso: node scripts/verify-import.mjs [ruta-al-respaldo]
// Reutiliza la MISMA lógica de la app (src/lib/backupCore.mjs) y comprueba
// los totales de control exactos del respaldo de referencia.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { buildBackupExport } from '../src/lib/documentosCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BACKUP = resolve(
  here,
  '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json',
)
const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BACKUP

// Totales de control por respaldo, verificados contra una fuente
// independiente del parser: el respaldo de referencia (24-oct) contra
// sus totales registrados, y la foto actual (26-oct) contra los
// resúmenes que calcula el servidor del original (getcoresnapshot).
const EXPECTED_BY_FILE = {
  'backup-sda-2026-10-24.json': { count: 23, from: '2026-10-01', to: '2026-10-23', ventas: 2662090, gananciaBruta: 667141, gananciaNeta: 645576, cuadreTotal: 0 },
  'backup-sda-2026-10-26.json': { count: 24, from: '2026-10-01', to: '2026-10-24', ventas: 2786190, gananciaBruta: 718191, gananciaNeta: 696096, cuadreTotal: 0 },
}
const EXPECTED = EXPECTED_BY_FILE[path.split('/').pop()]
if (!EXPECTED) { console.error(`Sin totales de control registrados para ${path}: no se verifica a ciegas.`); process.exit(1) }

console.log(`Leyendo respaldo: ${path}`)
const raw = JSON.parse(readFileSync(path, 'utf8'))
const parsed = parseBackup(raw)
const s = parsed.summary

console.log('— Resultado del parser (misma lógica que la app) —')
console.log(`Días:            ${s.count}`)
console.log(`Rango:           ${s.from} → ${s.to}`)
console.log(`Ventas totales:  ${s.ventas}`)
console.log(`Ganancia bruta:  ${s.gananciaBruta}`)
console.log(`Ganancia neta:   ${s.gananciaNeta}`)
console.log(`Cuadre total:    ${s.cuadreTotal} (todos a 0: ${s.allSquared})`)
console.log(`Cuentas:         ${parsed.receivables.length}`)
console.log(`Gastos (conteo): ${parsed.expensesCount} · Nóminas: ${parsed.payrollCount} · Trabajadores: ${parsed.workersCount}`)

const checks = [
  ['n.º de días', s.count, EXPECTED.count],
  ['fecha inicial', s.from, EXPECTED.from],
  ['fecha final', s.to, EXPECTED.to],
  ['ventas totales', s.ventas, EXPECTED.ventas],
  ['ganancia bruta', s.gananciaBruta, EXPECTED.gananciaBruta],
  ['ganancia neta', s.gananciaNeta, EXPECTED.gananciaNeta],
  ['cuadre total', s.cuadreTotal, EXPECTED.cuadreTotal],
  ['todos los días cuadrados', s.allSquared, true],
]

let failed = 0
console.log('— Comprobaciones contra los totales de control —')
for (const [label, got, want] of checks) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ${want}, obtenido ${got}`)
}

/* ---------- Ida y vuelta de las cinco colecciones (oleada 2) ----------
   Fuga cerrada: receivablePhotos, smsLogs, smsOutbox, monthlyArchives
   y workerPayments viajaban en el respaldo y el clon las descartaba
   al importar (al reexportar salían []). Los esperados se calculan
   DESDE EL PROPIO ARCHIVO leído (si se pasa otro respaldo, sus
   conteos mandan): en el respaldo del 24-oct son 23 / 15 / 8 / 1 / 0.
   La ida y vuelta es parseBackup → buildBackupExport → parseBackup,
   y además se exige igualdad de CONTENIDO (JSON) en cada colección. */
console.log('— Ida y vuelta de las cinco colecciones del respaldo —')
const FIVE = ['receivablePhotos', 'smsLogs', 'smsOutbox', 'monthlyArchives', 'workerPayments']
let failedFive = 0
for (const key of FIVE) {
  const expectedList = Array.isArray(raw.data[key]) ? raw.data[key] : []
  const parsedList = parsed[key]
  const exported = buildBackupExport(parsed, '2026-10-24')
  const exportedList = exported.data[key]
  const reparsed = parseBackup(exported)
  const reparsedList = reparsed[key]
  const sameContent = JSON.stringify(parsedList) === JSON.stringify(expectedList)
    && JSON.stringify(exportedList) === JSON.stringify(expectedList)
    && JSON.stringify(reparsedList) === JSON.stringify(expectedList)
  const ok = Array.isArray(parsedList) && parsedList.length === expectedList.length && sameContent
  if (!ok) failedFive++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${key}: respaldo ${expectedList.length} · parseado ${Array.isArray(parsedList) ? parsedList.length : 'no-array'} · reexportado ${Array.isArray(exportedList) ? exportedList.length : 'no-array'} · reparseado ${Array.isArray(reparsedList) ? reparsedList.length : 'no-array'} · contenido idéntico: ${sameContent}`)
}

if (failed > 0 || failedFive > 0) {
  console.error(`\nRESULTADO: FALLO (${failed + failedFive} comprobaciones)`)
  process.exit(1)
}
console.log('\nRESULTADO: OK — el importador reproduce los totales de control exactos del respaldo y las cinco colecciones viajan íntegras de ida y vuelta.')
