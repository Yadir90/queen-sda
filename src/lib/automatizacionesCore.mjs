/* automatizacionesCore.mjs — Paridad de automatizaciones del clon
 * externo de Queen SDA.
 *
 * Las cinco lógicas puras y compartidas (app y Node) de las tareas
 * programadas del sistema original, con la condición de aceptación
 * del dueño (2026-10-25): en la arquitectura nueva corren como
 * tareas en la nube (Supabase pg_cron + Edge Functions), pero el
 * RESULTADO debe ser el mismo:
 *
 *   1. RESPALDO AUTOMÁTICO 23:45 — mismo formato JSON del original
 *      ({backupOf, exportedAt, data:{...}}), verificado tras
 *      generarse (reimportación de control con los totales) y con
 *      retención de 14 días sobre copias numeradas.
 *   2. MANTENIMIENTO NOCTURNO 03:45 — diagnóstico equivalente:
 *      días IPV y cuadres, integridad de cuentas, respaldo reciente
 *      y restauración, boletines pendientes y centinelas; banco de
 *      errores actualizado SOLO con errores verificados; poda de
 *      historiales con los criterios del original (corridas inmunes:
 *      se conservan 90; de comportamiento: 30; aprendizajes sin uso
 *      en 30 días se marcan para poda). Nunca toca cifras, saldos ni
 *      reglas de negocio: lo que en el original es solo-código se
 *      declara como tal.
 *   3. APRENDIZAJE NOCTURNO — integra conceptos, alias, correcciones
 *      y decisiones del dueño ya persistidos en la memoria de Queen,
 *      de forma IDEMPOTENTE; una lección que contradice una regla
 *      queda en conflicto pendiente de la palabra del dueño, nunca
 *      aplicada sola.
 *   4. DESPACHO DE BOLETINES — revisa la cola y despacha con la
 *      REGLA ANTI-DUPLICADO (comprobación inmediatamente antes de
 *      enviar, vía attemptBulletinSend de documentosCore). Sin
 *      servicio de correo, la cola queda intacta y se registra el
 *      motivo honesto; nunca se marca enviado sin envío real.
 *   5. AVISO DE IPV AUSENTE — después de las 22:30; antes, el estado
 *      es «pendiente/en espera» sin alarma. Solo estado y registro.
 *
 * Todo se reutiliza de los núcleos existentes (backupCore,
 * syncCore, documentosCore, queenCore): ningún cálculo se duplica
 * y ninguna cifra se toca. Sin secretos: las tareas de la nube
 * nombran sus secretos (SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY…)
 * pero ninguno se escribe aquí.
 */

import { parseBackup, summarizeDays } from './backupCore.mjs'
import { attemptBulletinSend, buildBackupExport, BULLETIN_RECIPIENTS } from './documentosCore.mjs'
import {
  buildQueenErrorBank, buildQueenEvolution, buildQueenMemory, QUEEN_PERMISSION_RULES,
} from './queenCore.mjs'

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Retención del original: copias numeradas, 14 días. */
export const BACKUP_RETENTION_DAYS = 14
/** Antigüedad máxima de un respaldo confirmado (centinela del original). */
export const BACKUP_MAX_AGE_HOURS = 30
/** Hora a partir de la cual la ausencia de IPV es aviso (regla del dueño). */
export const IPV_MISSING_ALARM_TIME = '22:30'
/** Criterios de poda del original (historiales de diagnóstico). */
export const PRUNE_KEEP = { immuneRuns: 90, behaviorRuns: 30, automationRuns: 90, unusedLearningDays: 30 }

/** Las cinco tareas, con su horario y su destino en la nube. */
export const AUTOMATION_TASKS = [
  {
    key: 'respaldo', name: 'Respaldo automático', schedule: 'Diario · 23:45',
    cloud: 'Edge Function queen-backup (pg_cron 23:45) → Supabase Storage',
  },
  {
    key: 'mantenimiento', name: 'Mantenimiento nocturno', schedule: 'Diario · 03:45',
    cloud: 'Edge Function queen-maintenance (pg_cron 03:45)',
  },
  {
    key: 'aprendizaje', name: 'Aprendizaje nocturno de Queen', schedule: 'Diario · tras el mantenimiento',
    cloud: 'Edge Function queen-maintenance (misma corrida, segunda fase)',
  },
  {
    key: 'boletines', name: 'Despacho de boletines pendientes', schedule: 'Cada 10 minutos',
    cloud: 'Edge Function queen-bulletins (pg_cron cada 10 min) con el servicio de correo',
  },
  {
    key: 'aviso-ipv', name: 'Aviso de IPV ausente', schedule: 'Diario · 22:30',
    cloud: 'Edge Function queen-maintenance (revisión de las 22:30)',
  },
]

/** Estado honesto mientras las tareas no están desplegadas en la nube. */
/* SIS-R6 (27-oct): el estado «pendiente de despliegue» quedó falso
   tras el despliegue del 26-oct (Edge Functions + pg_cron activos en
   Supabase). El estado veraz es «programada en la nube»; las corridas
   locales registradas en esta copia se declaran aparte, por tarea. */
export const AUTOMATION_CLOUD_PENDING = 'Programada en la nube (Supabase)'

function isoNow(now) {
  return now instanceof Date ? now.toISOString() : String(now ?? new Date().toISOString())
}
/* Fecha y hora en America/Havana SIEMPRE (D-03): este núcleo corre en
   las funciones del servidor (UTC) y en el navegador; con la zona del
   entorno, la fecha del boletín de las 23:45 salía con el día UTC.
   Intl con timeZone explícito da la misma respuesta en ambos lados. */
function havanaParts(now) {
  const instant = now instanceof Date ? now : new Date(isoNow(now))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}
function dateOf(now) {
  return havanaParts(now).date
}
function timeOf(now) {
  return havanaParts(now).time
}

/**
 * Comprobación de integridad derivable de los datos del clon
 * (equivalente funcional a la del original, que además contrasta
 * contra sus tarjetas de contacto internas: en el clon las tarjetas
 * se derivan de las propias cuentas, así que la orfandad contra
 * tarjeta no es derivable y NO se finge). Problemas detectables sin
 * inventar nada: días duplicados, cuentas duplicadas, abonos que
 * superan el importe original (saldo imposible) e importes
 * negativos, y pagos locales que apuntan a cuentas inexistentes.
 */
export function listCloneIntegrityIssues(data) {
  const issues = []
  const days = Array.isArray(data?.days) ? data.days : []
  const seenDates = new Set()
  for (const d of days) {
    if (seenDates.has(d.date)) issues.push({ kind: 'dia-duplicado', detail: `El día ${d.date} aparece más de una vez.` })
    seenDates.add(d.date)
  }
  const recs = Array.isArray(data?.receivables) ? data.receivables : []
  const seenIds = new Set()
  for (const r of recs) {
    if (seenIds.has(r.id)) issues.push({ kind: 'cuenta-duplicada', detail: `La cuenta #${r.id} (${r.client}) aparece más de una vez.` })
    seenIds.add(r.id)
    const original = Number(r.originalAmount ?? 0)
    const abonado = Number(r.totalAbonadoBase ?? 0)
    const saldo = Number(r.saldoBase ?? 0)
    if (abonado > original || saldo > original) issues.push({ kind: 'saldo-imposible', detail: `La cuenta #${r.id} (${r.client}) registra abonos (${abonado}) o saldo (${saldo}) por encima de su importe original (${original}).` })
    if (original < 0 || abonado < 0 || saldo < 0) issues.push({ kind: 'importe-negativo', detail: `La cuenta #${r.id} (${r.client}) tiene importes negativos.` })
  }
  for (const p of Array.isArray(data?.localPayments) ? data.localPayments : []) {
    if (!seenIds.has(p.receivableId)) issues.push({ kind: 'pago-huerfano', detail: `Un pago local de ${p.amount} apunta a la cuenta #${p.receivableId}, que no existe.` })
  }
  return issues
}

/* ------------------------------------------------------------------ */
/* 1. Respaldo automático                                              */
/* ------------------------------------------------------------------ */

/**
 * Genera el respaldo diario en el formato exacto del original y lo
 * VERIFICA reimportándolo (ida y vuelta): los totales de control
 * del respaldo generado deben reproducir los de los datos vivos.
 * Devuelve el objeto exportable, su control y la verificación.
 */
export function buildNightlyBackup(data, now = new Date()) {
  /* SIS-R6 (27-oct): la fecha del respaldo es la de LA HABANA, como en
     el original (todayHavana): la corrida de las 23:45 Habana cae a
     las 03:45Z del día UTC siguiente y con la fecha UTC la copia de
     la noche del 26 salía nombrada «2026-10-27». exportedAt del
     formato es una FECHA (la batería lo fija), no el instante. */
  const havanaDate = dateOf(now)
  const backup = buildBackupExport(data, havanaDate)
  const control = summarizeDays(Array.isArray(data?.days) ? data.days : [])
  const verification = verifyBackupRoundTrip(backup)
  return {
    backup,
    filename: `backup-sda-${havanaDate}.json`,
    control: {
      days: control.count, from: control.from, to: control.to,
      ventas: control.ventas, gananciaBruta: control.gananciaBruta,
      gananciaNeta: control.gananciaNeta, cuadreTotal: control.cuadreTotal,
      allSquared: control.allSquared,
      receivables: Array.isArray(data?.receivables) ? data.receivables.length : 0,
    },
    verification,
    verified: Boolean(verification.ok)
      && verification.totals.ventas === control.ventas
      && verification.totals.gananciaBruta === control.gananciaBruta
      && verification.totals.gananciaNeta === control.gananciaNeta
      && verification.totals.cuadreTotal === control.cuadreTotal
      && verification.totals.days === control.count,
  }
}

/** Reimportación de control de un respaldo: totales y problemas. */
export function verifyBackupRoundTrip(backup) {
  try {
    const parsed = parseBackup(backup)
    const totals = {
      days: parsed.summary.count, from: parsed.summary.from, to: parsed.summary.to,
      ventas: parsed.summary.ventas, gananciaBruta: parsed.summary.gananciaBruta,
      gananciaNeta: parsed.summary.gananciaNeta, cuadreTotal: parsed.summary.cuadreTotal,
      receivables: parsed.receivables.length,
    }
    return { ok: true, totals, issues: [] }
  } catch (err) {
    return {
      ok: false,
      totals: { days: 0, from: null, to: null, ventas: 0, gananciaBruta: 0, gananciaNeta: 0, cuadreTotal: 0, receivables: 0 },
      issues: [err instanceof Error ? err.message : 'El respaldo no se pudo reimportar.'],
    }
  }
}

/**
 * Retención equivalente a la del original: copias numeradas con
 * retención de 14 días. Recibe la lista de copias ({id, generatedAt})
 * y separa las que se conservan de las que caducan. Pura: no borra.
 */
export function pruneBackupCopies(copies, now = new Date(), retentionDays = BACKUP_RETENTION_DAYS) {
  const list = Array.isArray(copies) ? copies : []
  const cutoff = new Date(isoNow(now)).getTime() - retentionDays * 24 * 3600 * 1000
  const keep = []
  const remove = []
  for (const copy of list) {
    const at = new Date(copy?.generatedAt ?? copy?.exportedAt ?? 0).getTime()
    if (Number.isFinite(at) && at >= cutoff) keep.push(copy)
    else remove.push(copy)
  }
  return { keep, remove, copyCount: keep.length, retentionDays }
}

/* ------------------------------------------------------------------ */
/* 2. Mantenimiento nocturno                                           */
/* ------------------------------------------------------------------ */

/**
 * Diagnóstico nocturno equivalente al del original, derivado SOLO
 * de los datos y del estado real que se le pasa:
 *   opts.backupStatus: { lastAt, copyCount, lastVerificationOk }
 *     — sin constancia, el centinela lo declara (no se inventa).
 *   opts.backupExport: respaldo a probar (restauración de control).
 *   opts.histories: { immuneRuns, behaviorRuns } conteos para la poda.
 * Es puro e idempotente: mismos datos y misma hora → mismo resultado.
 */
export function runMaintenanceDiagnosis(data, opts = {}) {
  const now = opts.now ?? new Date()
  const at = isoNow(now)
  const days = Array.isArray(data?.days) ? data.days : []
  const totals = summarizeDays(days)
  const descuadrados = days.filter((d) => Number(d.cuadre ?? 0) !== 0)
  const integrity = listCloneIntegrityIssues(data)
  const pendingBulletins = (Array.isArray(data?.bulletins) ? data.bulletins : [])
    .filter((b) => b.status !== 'enviado')
  const errorBank = buildQueenErrorBank(data)
  const evolution = buildQueenEvolution(data, dateOf(now))
  const checks = []

  checks.push({
    key: 'dias-ipv', area: 'IPV', label: 'Días IPV y cuadres',
    status: days.length === 0 ? 'warning' : descuadrados.length === 0 ? 'healthy' : 'warning',
    detail: days.length === 0
      ? 'Sin días importados: nada que cuadrar.'
      : descuadrados.length === 0
        ? `${totals.count} días importados (${totals.from} → ${totals.to}), todos con cuadre 0.`
        : `${totals.count} días importados; ${descuadrados.length} con descuadre: ${descuadrados.map((d) => `${d.date} (${Number(d.cuadre)})`).join(', ')}.`,
  })
  checks.push({
    key: 'integridad-cuentas', area: 'Cuentas', label: 'Integridad de cuentas',
    status: integrity.length === 0 ? 'healthy' : 'warning',
    detail: integrity.length === 0
      ? 'Sin problemas de integridad: ninguna cuenta huérfana, duplicada ni con saldo imposible.'
      : `${integrity.length} problema(s) de integridad: ${integrity.slice(0, 4).map((i) => i.detail).join(' · ')}`,
  })

  /* Respaldo reciente y restauración de control. */
  const backupStatus = opts.backupStatus ?? null
  let backupCheck
  if (opts.backupExport) {
    const verification = verifyBackupRoundTrip(opts.backupExport)
    backupCheck = {
      key: 'respaldo-restauracion', area: 'Respaldo', label: 'Respaldo y restauración de control',
      status: verification.ok ? 'healthy' : 'warning',
      detail: verification.ok
        ? `El respaldo de control se reimporta y cuadra: ${verification.totals.days} días, ventas ${verification.totals.ventas}, cuadre ${verification.totals.cuadreTotal}.`
        : `El respaldo de control NO se pudo reimportar: ${verification.issues.join(' · ')}`,
    }
  } else if (backupStatus?.lastAt) {
    const ageHours = (new Date(at).getTime() - new Date(backupStatus.lastAt).getTime()) / 3600000
    backupCheck = {
      key: 'respaldo-restauracion', area: 'Respaldo', label: 'Respaldo y restauración de control',
      status: ageHours <= BACKUP_MAX_AGE_HOURS && backupStatus.lastVerificationOk !== false ? 'healthy' : 'warning',
      detail: `Último respaldo registrado ${backupStatus.lastAt.slice(0, 10)} (${Math.max(0, Math.round(ageHours))} h), ${backupStatus.copyCount ?? 0} copia(s) con retención de ${BACKUP_RETENTION_DAYS} días.`,
    }
  } else {
    backupCheck = {
      key: 'respaldo-restauracion', area: 'Respaldo', label: 'Respaldo y restauración de control',
      status: 'warning',
      detail: 'Sin constancia de un respaldo verificado en esta base: la tarea de las 23:45 lo deja registrado al correr.',
    }
  }
  checks.push(backupCheck)

  checks.push({
    key: 'boletines', area: 'Boletines', label: 'Boletines pendientes',
    status: pendingBulletins.length === 0 ? 'healthy' : 'warning',
    detail: pendingBulletins.length === 0
      ? 'Sin boletines pendientes en la cola.'
      : `${pendingBulletins.length} boletín(es) pendiente(s) en la cola: ${pendingBulletins.map((b) => b.date).join(', ')}.`,
  })
  checks.push({
    key: 'banco-errores', area: 'Sistema inmune', label: 'Banco de errores',
    status: 'healthy',
    detail: errorBank.cells.length === 0
      ? 'Sin errores verificados nuevos: el banco no añade células sin evidencia.'
      : `${errorBank.cells.length} célula(s) de errores verificados (${errorBank.openCount} abierta(s)): ${errorBank.cells.slice(0, 3).map((c) => c.title).join(' · ')}`,
  })
  checks.push({
    key: 'memoria-queen', area: 'Queen', label: 'Memoria y evolución de Queen',
    status: 'healthy',
    detail: `Etapa ${evolution.stage.name} (índice ${evolution.score}); ${buildQueenMemory(data).learnedKinds.length} conceptos aprendidos y ${data?.cuentasOverrides && typeof data.cuentasOverrides === 'object' ? Object.keys(data.cuentasOverrides).length : 0} decisiones del dueño persistidas.`,
  })

  const healthy = checks.filter((c) => c.status === 'healthy').length
  const warnings = checks.length - healthy
  const score = Math.round((healthy / checks.length) * 100)
  const sentinels = checks.map((c) => ({
    key: c.key, area: c.area, status: c.status, detail: c.detail, heartbeatAt: at,
  }))

  /* Poda de historiales con los criterios del original: se CALCULA
     el plan; aplicarlo sobre historiales de diagnóstico nunca toca
     cifras ni registros de negocio. */
  const histories = opts.histories ?? {}
  const prunePlan = [
    { kind: 'immune-runs', label: 'Corridas del sistema inmune', keep: PRUNE_KEEP.immuneRuns, wouldRemove: Math.max(0, (histories.immuneRuns ?? 0) - PRUNE_KEEP.immuneRuns) },
    { kind: 'behavior-runs', label: 'Corridas de comportamiento', keep: PRUNE_KEEP.behaviorRuns, wouldRemove: Math.max(0, (histories.behaviorRuns ?? 0) - PRUNE_KEEP.behaviorRuns) },
    { kind: 'automation-runs', label: 'Registro de automatizaciones', keep: PRUNE_KEEP.automationRuns, wouldRemove: Math.max(0, (histories.automationRuns ?? 0) - PRUNE_KEEP.automationRuns) },
    { kind: 'unused-learnings', label: `Aprendizajes sin uso en ${PRUNE_KEEP.unusedLearningDays} días (se marcan, no se borran)`, keep: null, wouldRemove: 0 },
  ]

  return {
    at,
    score,
    status: warnings === 0 ? 'healthy' : 'warning',
    checks,
    sentinels,
    errorBank: { cells: errorBank.cells.length, open: errorBank.openCount },
    prunePlan,
    codeOnlyNotes: [
      'La optimización de código y de consultas del original se hace editando el sistema; en el clon equivale a la pasada de optimización de la puerta de calidad, no a una tarea nocturna.',
      'La restauración completa (reconstruir la base desde el respaldo) la ejecuta el administrador desde Sistema; la tarea nocturna solo verifica que el respaldo se reimporta y cuadra.',
    ],
    summary: `Salud ${score}/100 · ${healthy}/${checks.length} comprobaciones sanas · ${totals.count} días, cuadre total ${totals.cuadreTotal} · integridad: ${integrity.length} problema(s) · boletines pendientes: ${pendingBulletins.length}.`,
  }
}

/** Poda del registro de corridas: conserva las últimas N por tarea. */
export function pruneAutomationRuns(runs, keep = PRUNE_KEEP.automationRuns) {
  const list = Array.isArray(runs) ? [...runs] : []
  const byTask = new Map()
  for (const run of list) {
    const key = run?.task ?? 'otra'
    if (!byTask.has(key)) byTask.set(key, [])
    byTask.get(key).push(run)
  }
  const out = []
  for (const group of byTask.values()) {
    group.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    out.push(...group.slice(0, keep))
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return out
}

/* ------------------------------------------------------------------ */
/* 3. Aprendizaje nocturno de Queen                                    */
/* ------------------------------------------------------------------ */

/** Estado vacío del aprendizaje persistente. */
export function emptyQueenLearning() {
  return { integratedConcepts: [], integratedAliases: [], integratedDecisions: 0, integratedLessons: [], conflicts: [], lastRunAt: null, runs: 0 }
}

function ruleIds() {
  /* Las reglas de permiso de Queen se identifican por
     «dominio:capacidad» (p. ej. «money:write»). */
  return new Set(QUEEN_PERMISSION_RULES.map((r) => `${r.domain}:${r.capability}`))
}

/**
 * Ciclo de aprendizaje nocturno: integra en el estado persistente lo
 * aprendido y persistido durante el día (conceptos de clasificación,
 * alias de personas y decisiones del dueño) SIN duplicar: lo ya
 * integrado no se vuelve a integrar. Las lecciones nuevas
 * (opts.lessons: [{id, text, contradictsRuleId}]) que contradicen
 * una regla vigente quedan en CONFLICTO pendiente de la palabra del
 * dueño y nunca se aplican; las demás se integran como lecciones.
 * Devuelve el estado nuevo y el detalle de la corrida.
 */
export function runNightlyLearning(data, prior, opts = {}) {
  const state = {
    ...emptyQueenLearning(),
    ...(prior ?? {}),
    integratedConcepts: [...(prior?.integratedConcepts ?? [])],
    integratedAliases: [...(prior?.integratedAliases ?? [])],
    integratedLessons: [...(prior?.integratedLessons ?? [])],
    conflicts: [...(prior?.conflicts ?? [])],
  }
  const at = isoNow(opts.now ?? new Date())
  const detail = { newConcepts: [], newAliases: [], newDecisions: 0, newLessons: [], newConflicts: [] }

  const conceptKeys = new Set(Object.keys(data?.learnedKinds ?? {}))
  for (const key of conceptKeys) {
    if (!state.integratedConcepts.includes(key)) {
      state.integratedConcepts.push(key)
      detail.newConcepts.push(key)
    }
  }
  const aliasKeys = new Set(Object.keys(data?.aliases ?? {}))
  for (const key of aliasKeys) {
    if (!state.integratedAliases.includes(key)) {
      state.integratedAliases.push(key)
      detail.newAliases.push(key)
    }
  }
  const decisions = data?.cuentasOverrides && typeof data.cuentasOverrides === 'object'
    ? Object.keys(data.cuentasOverrides).length
    : 0
  if (decisions > state.integratedDecisions) {
    detail.newDecisions = decisions - state.integratedDecisions
    state.integratedDecisions = decisions
  }

  const known = ruleIds()
  for (const lesson of Array.isArray(opts.lessons) ? opts.lessons : []) {
    if (!lesson?.id || state.integratedLessons.includes(lesson.id)) continue
    if (state.conflicts.some((c) => c.id === lesson.id)) continue
    if (lesson.contradictsRuleId && known.has(lesson.contradictsRuleId)) {
      const conflict = {
        id: lesson.id, text: String(lesson.text ?? ''), ruleId: lesson.contradictsRuleId,
        status: 'pendiente', detectedAt: at,
        note: 'Contradice una regla vigente: queda pendiente de la palabra del dueño, sin aplicar.',
      }
      state.conflicts.push(conflict)
      detail.newConflicts.push(conflict)
    } else if (lesson.contradictsRuleId) {
      /* La regla citada no existe: no se inventa el conflicto; la
         lección tampoco se aplica sin verificar contra qué choca. */
      const conflict = {
        id: lesson.id, text: String(lesson.text ?? ''), ruleId: lesson.contradictsRuleId,
        status: 'pendiente', detectedAt: at,
        note: 'Cita una regla que no consta en el registro: queda pendiente de verificación del dueño, sin aplicar.',
      }
      state.conflicts.push(conflict)
      detail.newConflicts.push(conflict)
    } else {
      state.integratedLessons.push(lesson.id)
      detail.newLessons.push(lesson.id)
    }
  }

  state.lastRunAt = at
  state.runs = (state.runs ?? 0) + 1
  const integratedCount = detail.newConcepts.length + detail.newAliases.length + detail.newDecisions + detail.newLessons.length
  return {
    state,
    detail,
    summary: integratedCount === 0 && detail.newConflicts.length === 0
      ? 'Nada nuevo que integrar: la memoria ya estaba al día (corrida idempotente).'
      : `Integrado: ${detail.newConcepts.length} concepto(s), ${detail.newAliases.length} alias, ${detail.newDecisions} decisión(es), ${detail.newLessons.length} lección(es). Conflictos pendientes del dueño: ${state.conflicts.filter((c) => c.status === 'pendiente').length}.`,
  }
}

/* ------------------------------------------------------------------ */
/* 4. Despacho automático de boletines                                 */
/* ------------------------------------------------------------------ */

/**
 * Revisa la cola y despacha los pendientes con la REGLA
 * ANTI-DUPLICADO: attemptBulletinSend comprueba el índice de
 * enviados inmediatamente antes de llamar al transporte, y esta
 * corrida alimenta ese índice con lo enviado dentro de la propia
 * corrida — correrla dos veces seguidas no envía nada dos veces.
 * Sin transporte: la cola queda intacta y el motivo se registra.
 */
export async function dispatchPendingBulletins(bulletins, opts = {}) {
  const list = Array.isArray(bulletins) ? bulletins : []
  const raw = opts.transport ?? null
  const transport = typeof raw === 'function' ? { send: raw } : raw
  const sentIds = []
  const skipped = []
  if (!transport || typeof transport.send !== 'function') {
    return {
      bulletins: list, sentIds, skipped,
      transported: false,
      reason: 'Sin servicio de correo conectado en el sistema externo: la cola queda intacta y ningún boletín se marca enviado.',
    }
  }
  let current = list
  for (const bulletin of list) {
    if (bulletin.status === 'enviado') continue
    const result = await attemptBulletinSend(current, bulletin.id, transport, isoNow(opts.now ?? new Date()))
    current = result.queue
    if (result.sent) sentIds.push(bulletin.id)
    else skipped.push({ id: bulletin.id, reason: result.reason })
  }
  return {
    bulletins: current, sentIds, skipped, transported: true,
    reason: sentIds.length
      ? `Despachados ${sentIds.length} boletín(es) a ${BULLETIN_RECIPIENTS.length} destinatarios, cada uno una sola vez.`
      : 'Sin boletines pendientes por despachar.',
    recipients: [...BULLETIN_RECIPIENTS],
  }
}

/* ------------------------------------------------------------------ */
/* 5. Aviso de IPV ausente                                             */
/* ------------------------------------------------------------------ */

/**
 * Estado del IPV de hoy: importado, en espera (antes de las 22:30,
 * sin alarma) o ausente (desde las 22:30, con aviso). Solo estado y
 * registro: no envía mensajes.
 * opts: { date: 'YYYY-MM-DD', time: 'HH:MM' } o { now: Date }.
 */
export function missingIpvStatus(data, opts = {}) {
  const now = opts.now ?? new Date()
  const date = opts.date ?? dateOf(now)
  const time = opts.time ?? timeOf(now)
  const days = Array.isArray(data?.days) ? data.days : []
  const has = days.some((d) => d.date === date)
  if (has) return { date, state: 'importado', alarm: false, detail: `El IPV del ${date} ya está importado.` }
  if (time >= IPV_MISSING_ALARM_TIME) {
    return {
      date, state: 'ausente', alarm: true,
      detail: `Son las ${time} y el IPV del ${date} aún no se ha subido: queda registrado como ausente para que el dueño lo revise.`,
    }
  }
  return {
    date, state: 'en-espera', alarm: false,
    detail: `El IPV del ${date} aún no se ha subido; antes de las ${IPV_MISSING_ALARM_TIME} el estado es «pendiente/en espera», sin alarma.`,
  }
}

/* ------------------------------------------------------------------ */
/* Estado para Sistema y registro de corridas                          */
/* ------------------------------------------------------------------ */

/** Crea el registro de una corrida (persistido en automation_runs). */
export function createAutomationRun(task, status, detail, now = new Date()) {
  const at = isoNow(now)
  return { id: `run-${task}-${at}`, task, at, status, detail: String(detail ?? '') }
}

/**
 * Estado de las automatizaciones para Sistema: último respaldo,
 * último mantenimiento con su salud, último aprendizaje y cola de
 * boletines, desde los registros reales; mientras las tareas no
 * estén desplegadas, cada una declara «pendiente de despliegue» —
 * nunca un «activo» falso. Las corridas manuales locales se marcan
 * como lo que son: ejecutadas en este dispositivo.
 */
export function buildAutomationsStatus(data, runs, learning, opts = {}) {
  const list = Array.isArray(runs) ? runs : []
  const lastOf = (task) => list.filter((r) => r.task === task)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null
  const lastBackup = lastOf('respaldo')
  const lastMaintenance = lastOf('mantenimiento')
  const lastLearning = lastOf('aprendizaje')
  const lastDispatch = lastOf('boletines')
  const pendingBulletins = (Array.isArray(data?.bulletins) ? data.bulletins : [])
    .filter((b) => b.status !== 'enviado').length
  const tasks = AUTOMATION_TASKS.map((t) => {
    const last = lastOf(t.key)
    return {
      ...t,
      cloudStatus: AUTOMATION_CLOUD_PENDING,
      lastRunAt: last?.at ?? null,
      lastStatus: last?.status ?? null,
      lastDetail: last?.detail ?? 'Sin corridas registradas en esta base.',
    }
  })
  return {
    tasks,
    cloudStatus: AUTOMATION_CLOUD_PENDING,
    backup: {
      lastRunAt: lastBackup?.at ?? null,
      detail: lastBackup?.detail ?? 'Sin respaldo generado por la tarea en esta base.',
    },
    maintenance: {
      lastRunAt: lastMaintenance?.at ?? null,
      detail: lastMaintenance?.detail ?? 'Sin mantenimiento nocturno registrado en esta base.',
    },
    learning: {
      lastRunAt: learning?.lastRunAt ?? lastLearning?.at ?? null,
      integratedConcepts: learning?.integratedConcepts?.length ?? 0,
      integratedAliases: learning?.integratedAliases?.length ?? 0,
      pendingConflicts: (learning?.conflicts ?? []).filter((c) => c.status === 'pendiente').length,
    },
    bulletins: {
      pending: pendingBulletins,
      lastDispatchAt: lastDispatch?.at ?? null,
      recipients: [...BULLETIN_RECIPIENTS],
    },
    ipvToday: missingIpvStatus(data, opts),
  }
}
