// Queen SDA — prueba de verificación del importador de IPV en Excel.
// Uso: node scripts/verify-ipv.mjs
// Corre el MISMO lector que usa la app (src/lib/ipvCore.mjs, puerto del
// lector original) contra el IPV real del 24 de octubre de 2026
// (~/workspace/ipv-fix-2026-10-24/: el original subido por el dueño y su
// versión corregida de fórmulas/protección) y comprueba que los totales
// extraídos coinciden con lo que el propio archivo declara en su
// Desglose: ventas 636.730, fondos 637.290 y cuadre SOBRANTE de 560
// (la hoja lo declara como «CUADRE (Ventas − Fondos)» = −560 y su estado
// «⚠ SOBRANTE: sobran fondos por 560 CUP»): el descuadre se lee y se
// muestra tal como viene, NO se corrige ni se esconde.
//
// En Node no hay DOMParser nativo: se inyecta el de @xmldom/xmldom
// (devDependency, solo para esta prueba; en el navegador manda el nativo).

import { DOMParser } from '@xmldom/xmldom'
globalThis.DOMParser = DOMParser

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseDayFile, ipvPayloadToRawDay } from '../src/lib/ipvCore.mjs'
import { normalizeDay, parseBackup } from '../src/lib/backupCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIX_DIR = resolve(here, '../../ipv-fix-2026-10-24')
const FILES = [
  resolve(FIX_DIR, 'original.xlsx'),
  resolve(FIX_DIR, 'PDL La Reina IPV - SDA 24-10-26 (corregido).xlsx'),
]
const BACKUP = resolve(here, '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json')

// Lo que el propio IPV del 24 declara (leído de su Desglose por la
// revisión independiente del archivo, 2026-10-25).
const EXPECTED = {
  date: '2026-10-24',
  ventasDia: 636730,
  totalFondos: 637290,
  cuadre: -560, // «CUADRE (Ventas − Fondos)» de la hoja: sobran fondos por 560.
  efectivo: 506860,
  transferencias: 40700,
  totalCuentasPorCobrar: 64930,
  cuentasDetalle: 16,
}

let failed = 0
function check(label, got, want) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ${want}, obtenido ${got}`)
}

const results = []
for (const path of FILES) {
  const buf = readFileSync(path)
  const file = new File([buf], path.split('/').pop())
  const payload = await parseDayFile(file)
  const rawDay = ipvPayloadToRawDay(payload)
  const day = normalizeDay(rawDay) // lo que la app guarda y muestra
  results.push({ path, payload, day })

  console.log(`\n— ${file.name} —`)
  console.log(`Fecha detectada:     ${payload.date}`)
  console.log(`Ventas del día:      ${payload.ventasDia}`)
  console.log(`Total de fondos:     ${payload.fondos?.totalFondos}`)
  console.log(`Cuadre (V − F):      ${payload.cuadre}  → sobran fondos por ${payload.fondos.totalFondos - payload.ventasDia}`)
  console.log(`Ganancia bruta/neta: ${payload.gananciaBruta} / ${payload.gananciaNeta}`)
  console.log(`Productos:           ${payload.productCount} · Entradas: ${payload.entries.length} · Gastos IPV: ${payload.gastosIpv.length} líneas`)
  console.log(`Cuentas del Desglose: ${payload.fondos.cuentasDetalle.length} (suma ${payload.fondos.cuentasDetalle.reduce((s, c) => s + c.saldo, 0)})`)
  console.log(`RH:                  ${payload.rh.length} trabajadores · total a cobrar ${payload.totalRH} · marcas: ${payload.rhFechas.length} días (${payload.rhFechas[0] ?? '—'} → ${payload.rhFechas[payload.rhFechas.length - 1] ?? '—'})`)
  console.log(`Avisos del lector:   ${payload.warnings.length ? payload.warnings.join(' | ') : '(ninguno)'}`)

  console.log('— Comprobaciones contra lo que el archivo declara —')
  check('fecha del día', payload.date, EXPECTED.date)
  check('ventas del día', payload.ventasDia, EXPECTED.ventasDia)
  check('total de fondos', payload.fondos?.totalFondos, EXPECTED.totalFondos)
  check('cuadre declarado (Ventas − Fondos)', payload.cuadre, EXPECTED.cuadre)
  check('sobrante visible (fondos − ventas)', payload.fondos.totalFondos - payload.ventasDia, 560)
  check('efectivo del arqueo', payload.fondos?.efectivo, EXPECTED.efectivo)
  check('transferencias', payload.fondos?.transferencias, EXPECTED.transferencias)
  check('total cuentas por cobrar', payload.fondos?.totalCuentasPorCobrar, EXPECTED.totalCuentasPorCobrar)
  check('n.º de cuentas del Desglose', payload.fondos?.cuentasDetalle.length, EXPECTED.cuentasDetalle)
  check('suma de cuentas del Desglose', payload.fondos.cuentasDetalle.reduce((s, c) => s + c.saldo, 0), EXPECTED.totalCuentasPorCobrar)
  // El día normalizado que la app guarda conserva los mismos totales.
  check('día guardado: ventas', day.ventasDia, EXPECTED.ventasDia)
  check('día guardado: fondos', day.fondos.totalFondos, EXPECTED.totalFondos)
  check('día guardado: cuadre (descuadre visible, sin corregir)', day.cuadre, EXPECTED.cuadre)
  check('día guardado: cuentas del Desglose', day.fondos.cuentasDetalle?.length, EXPECTED.cuentasDetalle)
  check('día guardado: foto de RH', day.rh?.length, payload.rh.length)
}

console.log('\n— Original vs corregido (mismos totales) —')
const [a, b] = results
for (const k of ['date', 'ventasDia', 'gananciaBruta', 'gananciaNeta', 'cuadre']) {
  check(`ambos archivos: ${k}`, b.payload[k], a.payload[k])
}
check('ambos archivos: total de fondos', b.payload.fondos.totalFondos, a.payload.fondos.totalFondos)

// Referencia cruzada: el sistema original guarda estas mismas cifras de
// ventas y fondos en su respaldo (bajo la fecha 2026-10-23, tal como
// quedó importado allí; su lector leía el cuadre como 0 por el título
// «RESUMEN Y CUADRE DEL DÍA» — ver la nota de ipvCore.mjs). Es una
// observación de contraste, no una comprobación de esta prueba.
try {
  const backup = parseBackup(JSON.parse(readFileSync(BACKUP, 'utf8')))
  const twin = backup.days.find((d) => d.ventasDia === EXPECTED.ventasDia && d.fondos.totalFondos === EXPECTED.totalFondos)
  console.log('\n— Referencia cruzada con el respaldo del SDA —')
  if (twin) {
    console.log(`El respaldo guarda ventas ${twin.ventasDia} y fondos ${twin.fondos.totalFondos} bajo la fecha ${twin.date}, con cuadre ${twin.cuadre} (lectura del sistema original).`)
    console.log('Este lector extrae del archivo tal como viene hoy: fecha 2026-10-24 y el descuadre declarado de 560 visible.')
  } else {
    console.log('No se encontró en el respaldo un día con estas cifras (solo informativo).')
  }
} catch {
  console.log('\n(Sin referencia cruzada: no se pudo leer el respaldo; solo informativo.)')
}

if (failed > 0) {
  console.error(`\nRESULTADO: FALLO (${failed} comprobaciones)`)
  process.exit(1)
}
console.log('\nRESULTADO: OK — el importador de IPV reproduce lo que el archivo del 24 declara, con su descuadre visible y sin tocar.')
