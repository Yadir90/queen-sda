import { useMemo, useState } from 'react'
import {
  attemptBulletinSend, bulletinQueueSummary, regenerateBulletin,
  BULLETIN_RECIPIENTS,
} from '../lib/documentosCore.mjs'
import { daysInMonthOf } from '../lib/economiaCore.mjs'
import { downloadText } from '../lib/download'
import type { Bulletin, StoredData } from '../types'
import { fmtCUP, fmtDate } from '../lib/utils'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'

/**
 * Historial de boletines diarios: rejilla del mes (verde =
 * enviado, ámbar = pendiente, punteado = sin boletín) y la
 * cola con estado, descargar, regenerar y envío.
 *
 * ENVÍO HONESTO: en el sistema externo todavía NO hay un
 * servicio de correo conectado, así que «Enviar por correo»
 * ejecuta el intento real (con la comprobación anti-duplicado
 * inmediatamente antes) y el boletín queda pendiente con el
 * motivo declarado — jamás se marca enviado sin envío real.
 * El punto de integración está en documentosCore
 * (attemptBulletinSend): cuando exista un servicio gratuito
 * configurado, su transporte se inyecta ahí y el mismo botón
 * enviará de verdad a los 4 correos del boletín.
 * «Marcar enviado a mano» es el registro del propio dueño
 * cuando el boletín se envió por otro medio.
 */
export default function Historial({ data, bulletins, today, isAdmin, onBulletinsChange }: {
  data: StoredData
  bulletins: Bulletin[]
  today: string
  isAdmin: boolean
  onBulletinsChange: (next: Bulletin[]) => void
}) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of data.days) set.add(d.date.slice(0, 7))
    for (const b of bulletins) set.add(b.date.slice(0, 7))
    return [...set].sort().reverse()
  }, [data.days, bulletins])
  const [monthKey, setMonthKey] = useState('')
  const activeMonth = monthKey || months[0] || today.slice(0, 7)
  const [flash, setFlash] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmMark, setConfirmMark] = useState<string | null>(null)

  const summary = useMemo(() => bulletinQueueSummary(bulletins), [bulletins])
  const byDate = useMemo(() => new Map(bulletins.map((b) => [b.date, b])), [bulletins])
  const monthBulletins = useMemo(
    () => bulletins.filter((b) => b.date.startsWith(activeMonth)),
    [bulletins, activeMonth],
  )
  const totalDays = daysInMonthOf(activeMonth)

  const goTo = (date: string) => {
    setFlash(date)
    requestAnimationFrame(() => {
      document.getElementById(`boletin-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    setTimeout(() => setFlash(null), 2400)
  }

  const doRegenerate = (b: Bulletin) => {
    const fresh = regenerateBulletin(data, b)
    onBulletinsChange(bulletins.map((x) => (x.id === b.id ? fresh : x)))
    setNotice(`Boletín del ${fmtDate(b.date)} regenerado desde los datos actuales. ${b.status === 'enviado' ? 'Sigue marcado como enviado (no se reenvía).' : 'Queda pendiente en la cola.'}`)
  }

  const doSendAttempt = async (b: Bulletin) => {
    // Sin servicio de correo configurado: transporte null. La
    // comprobación anti-duplicado corre dentro, antes de enviar.
    const res = await attemptBulletinSend(bulletins, b.id, null, today)
    onBulletinsChange(res.queue)
    setNotice(res.reason)
  }

  const doMarkSent = (b: Bulletin) => {
    const next = bulletins.map((x) => (x.id === b.id ? { ...x, status: 'enviado' as const, sentAt: today, lastError: null } : x))
    onBulletinsChange(next)
    setConfirmMark(null)
    setNotice(`Boletín del ${fmtDate(b.date)} marcado como enviado a mano (registro tuyo: se envió por otro medio).`)
  }

  return (
    <section>
      <TabHeader
        icon="receipt"
        title="Historial"
        desc="Boletines diarios del sistema: uno por cada día importado, con sus acumulados del mes y sin gráficos. Verde: enviado · ámbar: pendiente · punteado: sin boletín."
        badge={TAB_BADGES.historial}
      />
      {notice ? <div className="ok-box" style={{ marginBottom: 14 }}>{notice}</div> : null}

      <Card>
        <p className="eyebrow">Cola de boletines</p>
        <h2>Estado del envío</h2>
        <div className="grid-3">
          <div className="stat"><div className="label">Boletines</div><div className="value">{summary.total}</div></div>
          <div className="stat"><div className="label">Pendientes</div><div className="value">{summary.pendientes}</div></div>
          <div className="stat"><div className="label">Enviados</div><div className="value">{summary.enviados}</div></div>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Destinatarios del boletín: {BULLETIN_RECIPIENTS.join(' · ')}.
        </p>
        <div className="error-box" style={{ marginTop: 8 }}>
          <strong>Envío por correo aún no conectado en el sistema externo.</strong> Los boletines se
          generan solos al importar cada IPV y quedan en cola, listos para descargar. Cuando se conecte
          un servicio de correo gratuito, el botón «Enviar por correo» enviará de verdad; mientras tanto
          ningún boletín se marca enviado sin un envío real. La regla anti-duplicado (comprobar
          duplicados justo antes de enviar) ya está activa en el intento de envío.
        </div>
      </Card>

      <Card>
        <p className="eyebrow">Rejilla del mes</p>
        <h2>Boletines por día</h2>
        <div className="month-chips" role="group" aria-label="Mes del historial">
          {months.map((mk) => (
            <button key={mk} type="button" className={`chip-btn${mk === activeMonth ? ' active' : ''}`} onClick={() => setMonthKey(mk)}>{mk}</button>
          ))}
        </div>
        <div className="hist-grid" style={{ marginTop: 12 }}>
          {Array.from({ length: totalDays }, (_, i) => {
            const date = `${activeMonth}-${String(i + 1).padStart(2, '0')}`
            const b = byDate.get(date)
            if (!b) {
              return (
                <div key={date} className="hist-cell none" aria-label={`${fmtDate(date)}: sin boletín`}>
                  <span className="h-num">{i + 1}</span><span className="h-tag">Sin boletín</span>
                </div>
              )
            }
            const cls = b.status === 'enviado' ? 'sent' : b.status === 'error' ? 'err' : 'pending'
            const tag = b.status === 'enviado' ? 'Enviado' : b.status === 'error' ? 'Error' : 'Pendiente'
            return (
              <button key={date} type="button" className={`hist-cell ${cls}`} onClick={() => goTo(date)} aria-label={`${fmtDate(date)}: boletín ${tag.toLowerCase()} — ir a la tarjeta`}>
                <span className="h-num">{i + 1}</span><span className="h-tag">{tag}</span>
              </button>
            )
          })}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Toca un día con boletín para bajar a su tarjeta.</p>
      </Card>

      {monthBulletins.length === 0 ? (
        <Card><p className="small muted">Este mes no tiene boletines: se generan al importar los IPV del mes.</p></Card>
      ) : monthBulletins.map((b) => (
        <div key={b.id} id={`boletin-${b.date}`} className={flash === b.date ? 'bulletin-card flash' : 'bulletin-card'}>
          <Card>
            <p className="eyebrow">Boletín diario · {b.status === 'enviado' ? 'Enviado' : b.status === 'error' ? 'Con error' : 'Pendiente'}</p>
            <h2>{fmtDate(b.date)}</h2>
            <table className="kv"><tbody>
              <tr><td>Venta del día</td><td>{fmtCUP(b.structured.venta)}</td></tr>
              <tr><td>Ganancia neta</td><td>{fmtCUP(b.structured.neta)}</td></tr>
              <tr><td>Resultado del día</td><td>{fmtCUP(b.structured.resultadoDia)}</td></tr>
              <tr><td>Dinero en la calle (clientes)</td><td>{fmtCUP(b.structured.dineroEnLaCalle)}</td></tr>
              <tr><td>Intentos de envío</td><td>{b.attempts}</td></tr>
              {b.sentAt ? <tr><td>Enviado</td><td>{fmtDate(b.sentAt)}</td></tr> : null}
            </tbody></table>
            {b.lastError ? <div className="error-box" style={{ marginTop: 10 }}>{b.lastError}</div> : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn" onClick={() => downloadText(b.html, `boletin-${b.date}.html`, 'text/html;charset=utf-8')}>Descargar correo (.html)</button>
              <button className="btn" onClick={() => downloadText(b.text, `boletin-${b.date}.txt`)}>Descargar texto (.txt)</button>
              {isAdmin ? <button className="btn" onClick={() => doRegenerate(b)}>Regenerar</button> : null}
              {isAdmin && b.status !== 'enviado' ? (
                <button className="btn primary" onClick={() => void doSendAttempt(b)}>Enviar por correo</button>
              ) : null}
              {isAdmin && b.status !== 'enviado' ? (
                confirmMark === b.id
                  ? <button className="btn danger" onClick={() => doMarkSent(b)}>Confirmar: ya lo envié por otro medio</button>
                  : <button className="btn" onClick={() => setConfirmMark(b.id)}>Marcar enviado a mano</button>
              ) : null}
            </div>
          </Card>
        </div>
      ))}
    </section>
  )
}
