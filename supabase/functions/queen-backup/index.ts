// @ts-nocheck
/* Edge Function «queen-backup» — RESPALDO AUTOMÁTICO diario (23:45
 * hora de La Habana), equivalente al respaldo del sistema original:
 * mismo formato JSON ({backupOf, exportedAt, data:{...}}),
 * verificado tras generarse (reimportación de control con los
 * totales) antes de darse por bueno, guardado como copia numerada
 * en Supabase Storage (bucket privado «backups») y con retención
 * de 14 días (las copias caducadas se retiran en la misma corrida).
 *
 * Despliegue (puerta final, NO hecho en la fase de construcción):
 *   1. Copiar los núcleos compartidos:
 *        cp src/lib/*.mjs supabase/functions/_shared/
 *   2. Crear el bucket privado «backups» en Storage.
 *   3. supabase functions deploy queen-backup
 *   4. supabase secrets set CRON_SECRET=…  (el mismo valor que
 *      guarda Vault para pg_cron; aquí solo se nombra)
 *   5. Aplicar supabase/automatizaciones-cron.sql.
 * La clave de servicio (SUPABASE_SERVICE_ROLE_KEY) la inyecta la
 * propia plataforma en el entorno de la función.
 */

import {
  appendAutomationRun, cloudConfigured, cronAuthorized, jsonResponse, loadStoredData,
} from '../_shared/cloud.ts'
import {
  buildNightlyBackup, createAutomationRun, pruneAutomationRuns, pruneBackupCopies,
} from '../_shared/automatizacionesCore.mjs'

const BUCKET = 'backups'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function storageFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Storage ${res.status} en ${path}: ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

Deno.serve(async (req) => {
  if (!cloudConfigured()) return jsonResponse({ ok: false, reason: 'Entorno de la función incompleto (faltan SUPABASE_URL o la clave de servicio inyectada).' }, 500)
  if (!cronAuthorized(req)) return jsonResponse({ ok: false, reason: 'No autorizado.' }, 401)
  try {
    const now = new Date()
    const data = await loadStoredData()
    const { backup, filename, control, verified } = buildNightlyBackup(data, now)
    if (!verified) {
      const run = createAutomationRun('respaldo', 'error', `El respaldo generado NO pasó la verificación de reimportación (control: ${control.days} días, ventas ${control.ventas}). No se guardó como copia válida.`, now)
      await appendAutomationRun(run, data.automationRuns, pruneAutomationRuns)
      return jsonResponse({ ok: false, reason: run.detail }, 500)
    }
    await storageFetch(`object/${BUCKET}/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(backup),
    })
    /* Retención de 14 días: listar las copias y retirar las caducadas. */
    const listed = await storageFetch(`object/list/${BUCKET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100 }),
    }).catch(() => [])
    const copies = (Array.isArray(listed) ? listed : [])
      .filter((o) => typeof o?.name === 'string' && o.name.startsWith('backup-sda-'))
      .map((o) => ({ id: o.name, generatedAt: o.created_at ?? o.name.slice('backup-sda-'.length, 'backup-sda-'.length + 10) }))
    const { keep, remove } = pruneBackupCopies(copies, now)
    if (remove.length) {
      await storageFetch(`object/${BUCKET}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: remove.map((c) => c.id) }),
      }).catch(() => null)
    }
    const run = createAutomationRun(
      'respaldo', 'ok',
      `Respaldo ${filename} generado y verificado (reimportación de control: ${control.days} días, ventas ${control.ventas}, cuadre ${control.cuadreTotal}). Copias conservadas: ${keep.length} (retención de 14 días).`,
      now,
    )
    await appendAutomationRun(run, data.automationRuns, pruneAutomationRuns)
    return jsonResponse({ ok: true, filename, control, copies: keep.length })
  } catch (err) {
    return jsonResponse({ ok: false, reason: err instanceof Error ? err.message : 'Error desconocido en el respaldo.' }, 500)
  }
})
