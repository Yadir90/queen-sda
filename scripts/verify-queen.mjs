/* Verificación de la fase QUEEN EXTERNA CON IA contra el respaldo
   real backup-sda-2026-10-24.json (23 días, 1–23 oct):
     - Batería de preguntas deterministas con respuesta comprobada
       contra las cifras conocidas del dueño (ventas 2.662.090 ·
       bruta 667.141 · neta 645.576 · cuadre total 0 · mayor tarjeta
       Jesús 124.320 en 21 cuentas · morosas 13 por 56.620 (plazo
       hábil de trabajadores corregido el 26-oct, ver la nota en la
       comprobación de totales) · dinero
       en la calle 67.920 · nómina 82.000 del ciclo 8–22 oct ·
       Tequila Corrales Gold 10.000 → 12.000 el 22-oct · sugerencia
       real de productosCore para el Pargo asado).
     - Pregunta sin datos → «no tengo ese dato» sin inventar, y
       pregunta fuera de dominio → respuesta honesta.
     - Etapa del Reactor = Joven (juvenil) derivada de las señales,
       con las 3 señales que no viajan declaradas sin medir.
     - Memoria cargada del respaldo: 40 directivas, 15 conceptos,
       20 alias, 81 decisiones del dueño; banco de errores vacío
       (ningún día cargado trae descuadre).
     - Ninguna ruta del chat escribe: la petición de escritura se
       deniega y el núcleo no exporta mutadores de negocio. */

import { readFileSync } from 'node:fs'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { syncDerivedData } from '../src/lib/syncCore.mjs'
import { buildProductsCatalog, buildPriceSuggestions } from '../src/lib/productosCore.mjs'
import {
  answerQueen, buildQueenEvolution, buildQueenMemory, buildQueenErrorBank,
  buildQueenObservations, buildQueenOperationModes, queenLanguageStatus,
  QUEEN_OWNER_DIRECTIVES, QUEEN_PERMISSION_RULES, QUEEN_AUTONOMY_RULES,
  QUEEN_STAGES, pendingTotals,
} from '../src/lib/queenCore.mjs'
import * as queenCore from '../src/lib/queenCore.mjs'

const PATH = '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json'
const raw = JSON.parse(readFileSync(new URL(PATH, import.meta.url), 'utf8'))
const parsed = parseBackup(raw)

const synced = syncDerivedData({
  days: parsed.days,
  receivables: parsed.receivables,
  localPayments: [],
  expenses: parsed.expenses,
  workers: parsed.workers,
  aliases: {},
  learnedKinds: parsed.learnedKinds,
  cuentasOverrides: parsed.cuentasOverrides,
  suppressedEntries: [],
  payrollHistory: parsed.payrollHistory,
  accountSyncDates: [],
})
const data = {
  version: 2,
  importedAt: null,
  exportedAt: parsed.meta.exportedAt,
  backupOf: parsed.meta.backupOf,
  days: parsed.days,
  receivables: synced.receivables,
  localPayments: [],
  expenses: synced.expenses,
  workers: parsed.workers,
  payrollHistory: parsed.payrollHistory,
  anchorDate: parsed.anchorDate ?? '2026-09-23',
  aliases: synced.aliases,
  learnedKinds: parsed.learnedKinds,
  cuentasOverrides: parsed.cuentasOverrides,
  suppressedEntries: [],
  unpaidWorkers: [],
  payrollAdjustments: {},
  transferMovements: parsed.transferMovements,
  packageReferences: [],
  bulletins: [],
  queenEvolution: null,
  expensesCount: synced.expenses.length,
  payrollCount: parsed.payrollHistory.length,
  workersCount: parsed.workers.length,
}
const REF = '2026-10-24'

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ok  ${name}`) }
  else { failed += 1; console.log(`  XX  ${name} ${extra}`) }
}
function fig(ans, label) {
  const f = ans.figures.find((x) => x.label === label)
  return f ? f.value : undefined
}

console.log('— Evolución del Reactor —')
const evo = buildQueenEvolution(data, REF)
check('etapa Joven (juvenil)', evo.stage.id === 'juvenil', `=> ${evo.stage.id}`)
check('índice entre 50 y 75', evo.score >= 50 && evo.score < 75, `=> ${evo.score}`)
check('5 etapas con los colores del original',
  QUEEN_STAGES.length === 5
  && QUEEN_STAGES.find((s) => s.id === 'celula')?.color === '#22C55E'
  && QUEEN_STAGES.find((s) => s.id === 'juvenil')?.color === '#F0564F'
  && QUEEN_STAGES.find((s) => s.id === 'maduro')?.color === '#C084FC')
check('señales medidas: directivas 40', evo.metrics.find((m) => m.key === 'directives')?.value === 40)
check('señales medidas: conceptos 35 (15 conceptos + 20 alias)', evo.metrics.find((m) => m.key === 'concepts')?.value === 35, `=> ${evo.metrics.find((m) => m.key === 'concepts')?.value}`)
check('señales medidas: decisiones del dueño 81', evo.metrics.find((m) => m.key === 'corrections')?.value === 81)
check('3 señales declaradas sin medir (patrones, autónomas, precisión)',
  evo.metrics.filter((m) => !m.measured).length === 3 && evo.metrics.filter((m) => !m.measured).every((m) => m.value === null))
check('snapshot guardable con etapa e índice', evo.snapshot?.stageId === 'juvenil' && typeof evo.snapshot?.score === 'number')
const evoEmpty = buildQueenEvolution({ ...data, days: [] }, REF)
check('sin datos: etapa no se declara (score null)', evoEmpty.score === null && evoEmpty.stage.id === 'celula')

console.log('— Memoria, banco de errores y permisos —')
const mem = buildQueenMemory(data)
check('directivas del dueño: 40', mem.directives.length === 40 && QUEEN_OWNER_DIRECTIVES.length === 40)
check('conceptos aprendidos del respaldo: 15', mem.learnedKinds.length === 15, `=> ${mem.learnedKinds.length}`)
check('alias aprendidos: 20', mem.aliases.length === 20, `=> ${mem.aliases.length}`)
check('decisiones del dueño por entrada: 81', mem.decisionsCount === 81)
check('lo que no viaja declarado (4 partidas)', mem.notTraveling.length === 4)
const bank = buildQueenErrorBank(data)
check('banco de errores: 0 células (ningún día con descuadre)', bank.cells.length === 0 && bank.knownThreats === 0)
const bankBad = buildQueenErrorBank({ ...data, days: data.days.map((d, i) => (i === 0 ? { ...d, cuadre: -560 } : d)) })
check('banco de errores: 1 célula ante un día con cuadre −560', bankBad.cells.length === 1 && bankBad.cells[0].cellKey === `cuadre-${data.days[0].date}`)
check('permisos: 12 reglas de Queen', QUEEN_PERMISSION_RULES.length === 12)
check('escritura denegada en los 5 dominios protegidos',
  ['money', 'accounts', 'ipv', 'dna', 'permissions'].every((d) => QUEEN_PERMISSION_RULES.some((r) => r.domain === d && r.capability === 'write' && !r.allowed)))
check('autonomía: 16 reglas (7 autorizar… con la del dueño)', QUEEN_AUTONOMY_RULES.length === 16)
const modes = buildQueenOperationModes(data)
check('3 modos de operación con señales vivas', modes.length === 3 && modes[0].liveSignal.includes('12 reglas') && modes[1].liveSignal.includes('16 reglas'))

console.log('— Observaciones —')
const obs = buildQueenObservations(data, REF)
check('observaciones calculadas (cuadres, cuentas, precios, riesgo)', obs.length >= 4, `=> ${obs.length}`)
check('observación de cuadres: 23 días exactos', obs.some((o) => o.kind === 'cuadres' && o.text.includes('23 días importados')))
check('sin observación de huecos (rango completo)', !obs.some((o) => o.kind === 'huecos'))

console.log('— Batería de preguntas deterministas —')
const totals = pendingTotals(data, REF)
/* Corrección 26-oct (D-03): las morosas de trabajadores salen del
   plazo de 15 días HÁBILES del original (addBusinessDays; servidor
   _addBusinessDaysQ). La cifra anterior (14/57.420) venía del núcleo
   con días naturales: Nelson (trabajador, nacido el 8-oct, 800) vence
   el 29-oct hábil, no el 23 natural — no es moroso el 24-oct. */
check('totales de control: pendiente 291.690 · morosas 13/56.620 · calle 67.920',
  totals.total === 291690 && totals.morosasCount === 13 && totals.morosasTotal === 56620 && totals.dineroEnLaCalle === 67920,
  `=> ${totals.total}/${totals.morosasCount}/${totals.morosasTotal}/${totals.dineroEnLaCalle}`)

const aVentas = answerQueen(data, '¿Cuánto se vendió en octubre?', { refDate: REF })
check('ventas de octubre: 2.662.090', aVentas.intent === 'ventas-mes' && fig(aVentas, 'Ventas') === 2662090, `=> ${fig(aVentas, 'Ventas')}`)
check('bruta 667.141 · neta 645.576', fig(aVentas, 'Ganancia bruta') === 667141 && fig(aVentas, 'Ganancia neta') === 645576)
check('línea de verificación presente', aVentas.verifiedAgainst.length >= 1)

const aDia = answerQueen(data, '¿Cuánto se vendió el 22 de octubre?', { refDate: REF })
check('ventas del 22-oct: 88.060', aDia.intent === 'ventas-dia' && fig(aDia, 'Ventas') === 88060)

const aDeudor = answerQueen(data, '¿Quién debe más?', { refDate: REF })
check('mayor tarjeta: Jesús 124.320', aDeudor.intent === 'mayor-deudor' && fig(aDeudor, 'Mayor tarjeta') === 124320, `=> ${fig(aDeudor, 'Mayor tarjeta')}`)
check('mayor tarjeta con su conteo (21 cuentas en el texto)', aDeudor.text.includes('21 cuentas'))

const aPersona = answerQueen(data, '¿Cuánto debe Ismael?', { refDate: REF })
check('saldo por primer nombre (Ismael): en el respaldo consta sin pendiente',
  aPersona.intent === 'saldo-persona-cero' && aPersona.text.includes('Ismael Morales Vivas') && fig(aPersona, 'Pendiente') === 0,
  `=> ${aPersona.intent}`)

const aMorosas = answerQueen(data, '¿Qué cuentas están morosas?', { refDate: REF })
check('morosas: 13 por 56.620', aMorosas.intent === 'morosas' && fig(aMorosas, 'Cuentas morosas') === 13 && fig(aMorosas, 'Importe moroso') === 56620)

const aCalle = answerQueen(data, '¿Cuánto hay en la calle?', { refDate: REF })
check('dinero en la calle: 67.920 (solo clientes)', aCalle.intent === 'dinero-calle' && fig(aCalle, 'Dinero en la calle (clientes)') === 67920)

const aCuadre = answerQueen(data, '¿Cómo está el cuadre?', { refDate: REF })
check('cuadre total: 0 con 23 días cuadrados', aCuadre.intent === 'cuadre' && fig(aCuadre, 'Cuadre total') === 0 && fig(aCuadre, 'Días cuadrados') === 23)

const aNomina = answerQueen(data, '¿Cuánto fue la nómina del ciclo 8 al 22?', { refDate: REF })
check('nómina ciclo 8–22: 82.000 · 23 trabajadores · pago 2026-10-23',
  aNomina.intent === 'nomina' && fig(aNomina, 'Total de la nómina') === 82000 && fig(aNomina, 'Trabajadores') === 23 && fig(aNomina, 'Fecha de pago') === '2026-10-23',
  `=> ${fig(aNomina, 'Total de la nómina')}/${fig(aNomina, 'Trabajadores')}/${fig(aNomina, 'Fecha de pago')}`)

const aTequila = answerQueen(data, '¿Cambió el precio del Tequila Corrales Gold?', { refDate: REF })
check('cambio Tequila: venta 10.000 → 12.000 el 2026-10-22',
  aTequila.intent === 'cambios-precio' && aTequila.text.includes('Tequila Corrales Gold') && aTequila.text.includes('10.000') && aTequila.text.includes('12.000') && aTequila.text.includes('22 de octubre de 2026'))

const sug = buildPriceSuggestions(buildProductsCatalog(data.days))
const pargo = sug.items.find((i) => i.name === 'Pargo asado')
const aSug = answerQueen(data, '¿Qué precio sugerido tiene el Pargo asado?', { refDate: REF })
check('sugerencia del Pargo = la de productosCore', aSug.intent === 'sugerencia' && pargo != null && fig(aSug, 'Precio sugerido') === pargo.suggestedPrice,
  `=> core ${pargo?.suggestedPrice} vs queen ${fig(aSug, 'Precio sugerido')}`)

const aGastos = answerQueen(data, '¿Cuánto se gastó en octubre?', { refDate: REF })
check('gastos de octubre: 262.505', aGastos.intent === 'gastos' && fig(aGastos, 'Gastos del mes') === 262505)

const aTarjeta = answerQueen(data, '¿Cuál es el saldo de la tarjeta?', { refDate: REF })
check('tarjeta: saldo 32.625 · pasado al banco 107.625', aTarjeta.intent === 'tarjeta' && fig(aTarjeta, 'Saldo de la tarjeta') === 32625 && fig(aTarjeta, 'Pasado al banco') === 107625)

const aConc = answerQueen(data, '¿Cuadró la conciliación del 22 de octubre?', { refDate: REF })
check('conciliación del 22: diferencia 0', aConc.intent === 'conciliacion' && fig(aConc, 'Diferencia') === 0)

console.log('— Honestidad y límites —')
const aSinDato = answerQueen(data, '¿Cuánto se vendió el 15 de marzo?', { refDate: REF })
check('día sin IPV → «no tengo ese dato»', aSinDato.text.includes('No tengo ese dato'), `=> ${aSinDato.intent}`)
const aFuera = answerQueen(data, '¿Qué tiempo hace mañana en La Habana?', { refDate: REF })
check('fuera de dominio → respuesta honesta sin inventar', aFuera.intent === 'fuera-de-dominio' && aFuera.text.includes('no tengo ese dato'))
const aEtapa = answerQueen(data, '¿En qué etapa estás?', { refDate: REF })
check('pregunta de etapa → Joven con su índice', aEtapa.intent === 'evolucion' && aEtapa.text.includes('Joven'))
const aWrite = answerQueen(data, 'Marca pagada la cuenta de Leidy y borra ese saldo', { refDate: REF })
check('petición de escritura → denegada con su regla', aWrite.intent === 'escritura-denegada' && aWrite.text.includes('denegada'))
check('el núcleo no exporta mutadores de negocio',
  !Object.keys(queenCore).some((k) => /^(set|add|delete|remove|update|save|mark|import)/i.test(k)))
const langLocal = queenLanguageStatus(false)
const langSb = queenLanguageStatus(true)
check('capa de lenguaje: determinista siempre lista, IA sin configurar declarada',
  langLocal.deterministicReady && !langLocal.configured && !langSb.configured && langSb.channelDeployed)

console.log(`\nverify:queen — ${passed} ok, ${failed} fallos`)
if (failed) process.exit(1)
