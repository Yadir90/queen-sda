/* Verificación de la fase PARIDAD DE AUTOMATIZACIONES contra el
   respaldo real backup-sda-2026-10-24.json (23 días, 1–23 oct;
   ventas 2.662.090 · bruta 667.141 · neta 645.576 · cuadre 0):
     - Respaldo de la tarea: mismo formato del original, verificado
       por reimportación (ida y vuelta con los totales de control)
       y retención de 14 días sobre copias numeradas.
     - Mantenimiento: diagnóstico esperado (23 días, cuadre 0,
       integridad sin problemas inventados), idempotente, y poda
       con los criterios del original.
     - Aprendizaje: dos corridas sin duplicar conceptos/alias; un
       conflicto sembrado queda pendiente SIN aplicarse.
     - Boletines: con transporte simulado cada pendiente se envía
       una sola vez aunque la tarea corra dos veces seguidas; sin
       transporte no se marca ninguno.
     - Aviso de IPV ausente: día con IPV = sin aviso; día sin IPV
       antes de las 22:30 = en espera sin alarma; desde las 22:30
       = ausente con alarma.
     - Estado para Sistema: declara «pendiente de despliegue». */

import { readFileSync } from 'node:fs'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { syncDerivedData } from '../src/lib/syncCore.mjs'
import { ensureBulletinsForDays } from '../src/lib/documentosCore.mjs'
import {
  AUTOMATION_CLOUD_PENDING, AUTOMATION_TASKS, BACKUP_RETENTION_DAYS,
  buildAutomationsStatus, buildNightlyBackup, createAutomationRun,
  dispatchPendingBulletins, emptyQueenLearning, listCloneIntegrityIssues,
  missingIpvStatus, pruneAutomationRuns, pruneBackupCopies,
  runMaintenanceDiagnosis, runNightlyLearning, verifyBackupRoundTrip,
} from '../src/lib/automatizacionesCore.mjs'

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
const baseData = {
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
  automationRuns: [],
  queenLearning: null,
  expensesCount: synced.expenses.length,
  payrollCount: parsed.payrollHistory.length,
  workersCount: parsed.workers.length,
}
const REF = '2026-10-24'
const bulletins = ensureBulletinsForDays(baseData, [], { now: REF })
const data = { ...baseData, bulletins }

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ok  ${name}`) }
  else { failed += 1; console.log(`  XX  ${name} ${extra}`) }
}

console.log('— 1. Respaldo automático (23:45) —')
const NOW = new Date('2026-10-25T23:45:00Z')
const nightly = buildNightlyBackup(data, NOW)
check('formato del original: {backupOf, exportedAt, data}',
  typeof nightly.backup.backupOf === 'string'
  && nightly.backup.exportedAt === '2026-10-25'
  && nightly.backup.data && Array.isArray(nightly.backup.data.days))
check('nombre de copia del día', nightly.filename === 'backup-sda-2026-10-25.json', nightly.filename)
check('control: 23 días', nightly.control.days === 23, `=> ${nightly.control.days}`)
check('control: ventas 2.662.090', nightly.control.ventas === 2662090, `=> ${nightly.control.ventas}`)
check('control: bruta 667.141 y neta 645.576', nightly.control.gananciaBruta === 667141 && nightly.control.gananciaNeta === 645576)
check('control: cuadre total 0', nightly.control.cuadreTotal === 0 && nightly.control.allSquared === true)
check('verificado tras generarse (ida y vuelta)', nightly.verified === true)
check('la reimportación reproduce los totales',
  nightly.verification.totals.ventas === 2662090
  && nightly.verification.totals.days === 23
  && nightly.verification.totals.receivables === nightly.control.receivables)
const roundTrip = verifyBackupRoundTrip(raw)
check('el respaldo real también se reimporta y cuadra', roundTrip.ok && roundTrip.totals.cuadreTotal === 0)
const copies = pruneBackupCopies([
  { id: 'backup-sda-2026-10-25.json', generatedAt: '2026-10-25T23:45:00Z' },
  { id: 'backup-sda-2026-10-12.json', generatedAt: '2026-10-12T23:45:00Z' },
  { id: 'backup-sda-2026-10-10.json', generatedAt: '2026-10-10T23:45:00Z' },
], NOW)
check('retención de 14 días: conserva 2 y retira 1', copies.copyCount === 2 && copies.remove.length === 1 && copies.retentionDays === BACKUP_RETENTION_DAYS,
  `=> keep ${copies.copyCount}, remove ${copies.remove.length}`)

console.log('— 2. Mantenimiento nocturno (03:45) —')
const maintOpts = {
  now: new Date('2026-10-25T03:45:00Z'),
  backupStatus: { lastAt: '2026-10-24T23:45:00Z', copyCount: 12, lastVerificationOk: true },
  backupExport: raw,
  histories: { immuneRuns: 95, behaviorRuns: 41, automationRuns: 3 },
}
const m1 = runMaintenanceDiagnosis(data, maintOpts)
const diasCheck = m1.checks.find((c) => c.key === 'dias-ipv')
const intCheck = m1.checks.find((c) => c.key === 'integridad-cuentas')
const bakCheck = m1.checks.find((c) => c.key === 'respaldo-restauracion')
check('días IPV sanos: 23 días, cuadre 0', diasCheck?.status === 'healthy' && diasCheck.detail.includes('23 días'), diasCheck?.detail)
check('integridad sin problemas inventados', intCheck?.status === 'healthy' && listCloneIntegrityIssues(data).length === 0, intCheck?.detail)
check('respaldo y restauración de control sanos', bakCheck?.status === 'healthy', bakCheck?.detail)
check('centinelas = comprobaciones (6)', m1.sentinels.length === m1.checks.length && m1.checks.length === 6, `=> ${m1.checks.length}`)
check('banco de errores sin células falsas (0 días con descuadre)', m1.errorBank.cells === 0, `=> ${m1.errorBank.cells}`)
check('boletines pendientes declarados (23 en cola)', m1.checks.find((c) => c.key === 'boletines')?.detail.includes('23'), m1.checks.find((c) => c.key === 'boletines')?.detail)
const m2 = runMaintenanceDiagnosis(data, maintOpts)
check('idempotente: dos corridas, mismo diagnóstico',
  JSON.stringify(m1.checks) === JSON.stringify(m2.checks) && m1.score === m2.score && m1.summary === m2.summary)
const pruneImmune = m1.prunePlan.find((p) => p.kind === 'immune-runs')
const pruneBehavior = m1.prunePlan.find((p) => p.kind === 'behavior-runs')
check('poda del original: inmunes conserva 90 (sobran 5)', pruneImmune?.keep === 90 && pruneImmune?.wouldRemove === 5, `=> ${pruneImmune?.wouldRemove}`)
check('poda del original: comportamiento conserva 30 (sobran 11)', pruneBehavior?.keep === 30 && pruneBehavior?.wouldRemove === 11, `=> ${pruneBehavior?.wouldRemove}`)
check('notas de solo-código declaradas', m1.codeOnlyNotes.length >= 2)
const damaged = { ...data, days: data.days.map((d, i) => (i === 0 ? { ...d, cuadre: -560 } : d)) }
const mBad = runMaintenanceDiagnosis(damaged, maintOpts)
check('con un descuadre sembrado: el centinela lo ve y el banco gana su célula',
  mBad.checks.find((c) => c.key === 'dias-ipv')?.status === 'warning' && mBad.errorBank.cells >= 1,
  `=> cells ${mBad.errorBank.cells}`)
const prunedRuns = pruneAutomationRuns(
  Array.from({ length: 95 }, (_, i) => createAutomationRun('respaldo', 'ok', `corrida ${i}`, new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 24), i % 24)))),
)
check('poda del registro: 95 corridas → 90', prunedRuns.length === 90, `=> ${prunedRuns.length}`)

console.log('— 3. Aprendizaje nocturno de Queen —')
const learn1 = runNightlyLearning(data, emptyQueenLearning(), { now: new Date('2026-10-25T04:05:00Z') })
const conceptCount = Object.keys(data.learnedKinds ?? {}).length
const aliasCount = Object.keys(synced.aliases ?? {}).length
check('integra los conceptos persistidos', learn1.state.integratedConcepts.length === conceptCount, `=> ${learn1.state.integratedConcepts.length}/${conceptCount}`)
check('integra los alias persistidos', learn1.state.integratedAliases.length === aliasCount, `=> ${learn1.state.integratedAliases.length}/${aliasCount}`)
check('integra las decisiones del dueño (81)', learn1.state.integratedDecisions === 81, `=> ${learn1.state.integratedDecisions}`)
const learn2 = runNightlyLearning(data, learn1.state, { now: new Date('2026-10-26T04:05:00Z') })
check('segunda corrida idempotente: nada nuevo',
  learn2.detail.newConcepts.length === 0 && learn2.detail.newAliases.length === 0
  && learn2.detail.newDecisions === 0 && learn2.state.integratedConcepts.length === conceptCount
  && learn2.state.integratedAliases.length === aliasCount)
const conflictLesson = { id: 'leccion-sembrada-1', text: 'Queen puede marcar cuentas como pagadas sin confirmación.', contradictsRuleId: 'accounts:write' }
const learn3 = runNightlyLearning(data, learn2.state, { now: new Date('2026-10-26T04:06:00Z'), lessons: [conflictLesson] })
check('lección contradictoria → conflicto pendiente, sin aplicar',
  learn3.state.conflicts.length === 1
  && learn3.state.conflicts[0].status === 'pendiente'
  && !learn3.state.integratedLessons.includes('leccion-sembrada-1'))
const learn4 = runNightlyLearning(data, learn3.state, { now: new Date('2026-10-27T04:05:00Z'), lessons: [conflictLesson] })
check('el conflicto no se duplica al repetir la corrida', learn4.state.conflicts.length === 1, `=> ${learn4.state.conflicts.length}`)
const goodLesson = { id: 'leccion-buena-1', text: 'El pase al banco descuenta 210 fijos.' }
const learn5 = runNightlyLearning(data, learn4.state, { now: new Date('2026-10-27T04:06:00Z'), lessons: [goodLesson] })
check('lección sin contradicción sí se integra', learn5.state.integratedLessons.includes('leccion-buena-1'))

console.log('— 4. Despacho automático de boletines —')
check('la cola derivada tiene 23 pendientes', bulletins.length === 23 && bulletins.every((b) => b.status === 'pendiente'), `=> ${bulletins.length}`)
const noTransport = await dispatchPendingBulletins(bulletins, { now: new Date('2026-10-25T12:00:00Z') })
check('sin transporte: no se marca ninguno y el motivo es honesto',
  noTransport.transported === false
  && noTransport.sentIds.length === 0
  && noTransport.bulletins.every((b) => b.status === 'pendiente')
  && noTransport.reason.includes('Sin servicio de correo'))
const sentLog = []
const transport = async (b) => { sentLog.push(b.id) }
const run1 = await dispatchPendingBulletins(bulletins, { transport, now: new Date('2026-10-25T12:10:00Z') })
check('con transporte simulado: se envían los 23, una vez cada uno',
  run1.sentIds.length === 23 && sentLog.length === 23 && new Set(sentLog).size === 23,
  `=> sent ${run1.sentIds.length}, log ${sentLog.length}`)
check('todos quedan marcados «enviado» con sentAt', run1.bulletins.every((b) => b.status === 'enviado' && b.sentAt))
check('destinatarios: los 4 correos', JSON.stringify(run1.recipients) === JSON.stringify([
  'yadir.medina900710@gmail.com', 'dayamifernandez584@gmail.com', 'yanespinosa08@gmail.com', 'jesusmmpatria@gmail.com',
]), `=> ${run1.recipients}`)
const run2 = await dispatchPendingBulletins(run1.bulletins, { transport, now: new Date('2026-10-25T12:20:00Z') })
check('segunda corrida seguida: cero reenvíos (anti-duplicado)',
  run2.sentIds.length === 0 && sentLog.length === 23, `=> sent ${run2.sentIds.length}, log ${sentLog.length}`)

console.log('— 5. Aviso de IPV ausente (22:30) —')
const withIpv = missingIpvStatus(data, { date: '2026-10-23', time: '23:00' })
check('día con IPV: sin aviso aunque sea tarde', withIpv.state === 'importado' && withIpv.alarm === false, withIpv.detail)
const early = missingIpvStatus(data, { date: '2026-10-24', time: '18:00' })
check('día sin IPV a las 18:00: en espera, sin alarma', early.state === 'en-espera' && early.alarm === false, early.detail)
const late = missingIpvStatus(data, { date: '2026-10-24', time: '22:30' })
check('día sin IPV a las 22:30: ausente, con alarma', late.state === 'ausente' && late.alarm === true, late.detail)

console.log('— Estado para Sistema —')
const status = buildAutomationsStatus(data, [], null, { date: '2026-10-24', time: '12:00' })
check('cinco tareas declaradas', status.tasks.length === 5 && AUTOMATION_TASKS.length === 5)
check('estado honesto: pendiente de despliegue, nunca «activo» falso',
  status.cloudStatus === AUTOMATION_CLOUD_PENDING
  && status.tasks.every((t) => t.cloudStatus === AUTOMATION_CLOUD_PENDING))
check('sin corridas: Sistema lo dice, no lo inventa', status.backup.lastRunAt === null && status.bulletins.pending === 23)
const run = createAutomationRun('respaldo', 'ok', 'Respaldo verificado.', new Date('2026-10-24T23:45:00Z'))
const status2 = buildAutomationsStatus(data, [run], learn1.state, { date: '2026-10-24', time: '12:00' })
check('con una corrida registrada: último respaldo visible',
  status2.backup.lastRunAt === '2026-10-24T23:45:00.000Z' && status2.learning.integratedConcepts === conceptCount)

console.log(`\nAutomatizaciones: ${passed} ok, ${failed} fallos`)
if (failed) process.exit(1)
