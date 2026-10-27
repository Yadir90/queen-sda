// @ts-nocheck
/* Edge Function «queen-bulletins» — DESPACHO AUTOMÁTICO de
 * boletines pendientes (cada 10 minutos), con la REGLA
 * ANTI-DUPLICADO del dueño: la comprobación de duplicados ocurre
 * inmediatamente antes de enviar (la hace attemptBulletinSend
 * contra el índice de enviados, que aquí se alimenta de los
 * boletines ya marcados como enviados y de lo enviado dentro de la
 * propia corrida). Jamás el mismo boletín dos veces; jamás se
 * marca enviado sin envío real.
 *
 * El transporte es el servicio de correo que el dueño conecte en la
 * puerta final: si el secreto RESEND_API_KEY no existe, la función
 * NO envía nada, deja la cola intacta y registra el motivo honesto
 * (nunca un «enviado» falso). Secretos (solo se nombran):
 *   RESEND_API_KEY  clave del servicio de correo (Resend).
 *   BULLETIN_FROM   remitente verificado, p. ej. «Queen SDA <…>».
 *   CRON_SECRET     secreto compartido con pg_cron.
 * Destinatarios: los 4 correos fijados en documentosCore
 * (BULLETIN_RECIPIENTS), que viajan en cada boletín.
 */

import {
  appendAutomationRun, cloudConfigured, cronAuthorized, jsonResponse, loadStoredData, saveBulletins,
} from '../_shared/cloud.ts'
import {
  createAutomationRun, dispatchPendingBulletins, pruneAutomationRuns,
} from '../_shared/automatizacionesCore.mjs'
import {
  buildBulletinPdfBase64, buildBulletinPdfBase64FromStructured,
} from '../_shared/documentosCore.mjs'

function buildTransport(data) {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from = Deno.env.get('BULLETIN_FROM') ?? ''
  if (!apiKey || !from) return null
  return async (bulletin) => {
    /* El boletín del original adjunta el PDF del día y su pie lo
       anuncia: un boletín sin adjunto no se envía. El PDF sale del
       `structured` guardado con el propio boletín (los mismos
       datos que su cuerpo); solo si un boletín viejo no lo trae
       se recompone desde el estado guardado. */
    const pdf = bulletin.structured
      ? buildBulletinPdfBase64FromStructured(bulletin.structured)
      : buildBulletinPdfBase64(data, bulletin.date)
    if (!pdf) throw new Error(`No se pudo generar el PDF adjunto del boletín del ${bulletin.date}: no se envía sin él.`)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: bulletin.recipients,
        subject: bulletin.subject,
        html: bulletin.html,
        text: bulletin.text,
        attachments: [{
          filename: bulletin.pdfFilename ?? `contabilidad-${bulletin.date}.pdf`,
          content: pdf,
        }],
      }),
    })
    if (!res.ok) throw new Error(`El servicio de correo rechazó el boletín del ${bulletin.date} (${res.status}).`)
  }
}

Deno.serve(async (req) => {
  if (!cloudConfigured()) return jsonResponse({ ok: false, reason: 'Entorno de la función incompleto.' }, 500)
  if (!cronAuthorized(req)) return jsonResponse({ ok: false, reason: 'No autorizado.' }, 401)
  try {
    const now = new Date()
    const data = await loadStoredData()
    const transport = buildTransport(data)
    const result = await dispatchPendingBulletins(data.bulletins, { transport, now })
    if (result.sentIds.length) await saveBulletins(result.bulletins)
    const run = createAutomationRun(
      'boletines',
      result.transported ? 'ok' : 'atencion',
      result.transported ? result.reason : `Despacho sin envío: ${result.reason}`,
      now,
    )
    await appendAutomationRun(run, data.automationRuns, pruneAutomationRuns)
    return jsonResponse({ ok: true, transported: result.transported, sentIds: result.sentIds, skipped: result.skipped, reason: result.reason })
  } catch (err) {
    return jsonResponse({ ok: false, reason: err instanceof Error ? err.message : 'Error desconocido en el despacho de boletines.' }, 500)
  }
})
