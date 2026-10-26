// @ts-nocheck
/* Edge Function «queen-maintenance» — tres tareas del sistema
 * original en una sola función (el cuerpo decide cuál corre):
 *
 *   { "task": "mantenimiento" }  03:45 — diagnóstico nocturno:
 *     salud del organismo con comprobaciones reales, banco de
 *     errores solo con errores verificados y plan de poda con los
 *     criterios del original. Nunca toca cifras ni saldos.
 *   { "task": "aprendizaje" }     tras el mantenimiento — integra
 *     lo aprendido en el día en la memoria persistente de Queen,
 *     idempotente; los conflictos quedan pendientes del dueño.
 *   { "task": "aviso-ipv" }       22:30 — estado del IPV de hoy:
 *     «en espera» sin alarma antes de las 22:30; «ausente» con
 *     registro desde las 22:30. Solo estado: no envía mensajes.
 *
 * Cada corrida deja su constancia en automation_state ('runs'), que
 * es lo que Sistema muestra. Despliegue: ver queen-backup/index.ts
 * (mismos pasos; el horario vive en automatizaciones-cron.sql).
 * La fecha/hora «de hoy» se calcula en America/Havana.
 */

import {
  appendAutomationRun, cloudConfigured, cronAuthorized, jsonResponse, loadStoredData, saveAutomationRows,
} from '../_shared/cloud.ts'
import {
  createAutomationRun, missingIpvStatus, pruneAutomationRuns, runMaintenanceDiagnosis, runNightlyLearning,
} from '../_shared/automatizacionesCore.mjs'

function havanaNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

Deno.serve(async (req) => {
  if (!cloudConfigured()) return jsonResponse({ ok: false, reason: 'Entorno de la función incompleto.' }, 500)
  if (!cronAuthorized(req)) return jsonResponse({ ok: false, reason: 'No autorizado.' }, 401)
  try {
    const body = await req.json().catch(() => ({}))
    const task = typeof body?.task === 'string' ? body.task : 'mantenimiento'
    const now = new Date()
    const data = await loadStoredData()
    const runs = [...(data.automationRuns ?? [])]
    const record = async (run) => {
      const next = pruneAutomationRuns([...runs, run])
      runs.length = 0
      runs.push(...next)
      await saveAutomationRows([{ id: 'runs', payload: next }])
    }

    if (task === 'mantenimiento') {
      const lastBackup = runs.filter((r) => r.task === 'respaldo' && r.status === 'ok')
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null
      const result = runMaintenanceDiagnosis(data, {
        now,
        backupStatus: lastBackup
          ? { lastAt: lastBackup.at, lastVerificationOk: true }
          : null,
        histories: { automationRuns: runs.length },
      })
      await record(createAutomationRun('mantenimiento', result.status === 'healthy' ? 'ok' : 'atencion', result.summary, now))
      return jsonResponse({ ok: true, task, score: result.score, summary: result.summary, checks: result.checks })
    }

    if (task === 'aprendizaje') {
      const { state, summary } = runNightlyLearning(data, data.queenLearning, { now })
      await saveAutomationRows([{ id: 'learning', payload: state }])
      await record(createAutomationRun('aprendizaje', 'ok', summary, now))
      return jsonResponse({ ok: true, task, summary, pendingConflicts: state.conflicts.filter((c) => c.status === 'pendiente').length })
    }

    if (task === 'aviso-ipv') {
      const { date, time } = havanaNow()
      const status = missingIpvStatus(data, { date, time })
      await record(createAutomationRun('aviso-ipv', status.alarm ? 'atencion' : 'ok', status.detail, now))
      return jsonResponse({ ok: true, task, ...status })
    }

    return jsonResponse({ ok: false, reason: `Tarea desconocida: ${task}` }, 400)
  } catch (err) {
    return jsonResponse({ ok: false, reason: err instanceof Error ? err.message : 'Error desconocido en el mantenimiento.' }, 500)
  }
})
