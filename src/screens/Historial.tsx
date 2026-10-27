import { useMemo, useState } from 'react'
import {
  attemptBulletinSend, bulletinQueueSummary, regenerateBulletin,
  BULLETIN_RECIPIENTS,
} from '../lib/documentosCore.mjs'
import { daysInMonthOf } from '../lib/economiaCore.mjs'
import { downloadText } from '../lib/download'
import type { Bulletin, StoredData } from '../types'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import IpvDownloads from '../components/IpvDownloads'
import '../components/sectionsMirror.css'

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

      {data.monthlyArchives.length > 0 ? (
        <Card>
          <p className="eyebrow">Archivo mensual (del respaldo)</p>
          <h2>Meses del archivo</h2>
          <p className="small muted">
            Los resúmenes mensuales que trae el respaldo (monthlyArchives). Se muestran tal como viajan, sin recalcularlos.
          </p>
          <div className="list">
            {data.monthlyArchives.map((a) => (
              <div className="row" key={a.monthKey}>
                <span>
                  <strong>{a.label || a.monthKey}</strong>
                  <span className="small muted"> · {a.status}{a.isCurrent ? ' · mes en curso' : ''} · {fmtInt(a.daysCount)} días con IPV · ventas {fmtCUP(a.ventas)}</span>
                </span>
                <span className="mono">Resultado {fmtCUP(a.resultado)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <p className="eyebrow">Rejilla del mes</p>
        <h2>Boletines por día</h2>
        <div className="month-chips" role="group" aria-label="Mes del historial">
          {months.map((mk) => (
            <button key={mk} type="button" className={`chip-btn${mk === activeMonth ? ' active' : ''}`} onClick={() => setMonthKey(mk)}>{mk}</button>
          ))}
        </div>
        {/* Rejilla del mes del original (HistorialMonthGrid): semana que
            empieza en lunes con sus huecos, enviado en verde sólido,
            pendiente en dorado, sin boletín punteado, hoy con anillo
            dorado y seleccionado con doble anillo. */}
        {(() => {
          const MONTH_NAMES_H = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
          const [hy, hm] = activeMonth.split('-').map(Number)
          const monthLabelH = `${MONTH_NAMES_H[(hm || 1) - 1]} de ${hy}`
          const leadH = (new Date(hy, (hm || 1) - 1, 1, 12).getDay() + 6) % 7
          const enviadosH = monthBulletins.filter((b) => b.status === 'enviado').length
          const pendientesH = monthBulletins.length - enviadosH
          return (
            <div style={{ marginTop: 12 }}>
              <p className="hist-month-head">
                {monthLabelH}
                <span className="hm-count">{monthBulletins.length} {monthBulletins.length === 1 ? 'boletín' : 'boletines'}</span>
                {enviadosH > 0 ? <span className="hm-count"><span className="hm-dot" style={{ background: '#23aa70' }} />{enviadosH} enviado{enviadosH === 1 ? '' : 's'}</span> : null}
                {pendientesH > 0 ? <span className="hm-count"><span className="hm-dot" style={{ background: 'var(--gold)' }} />{pendientesH} pendiente{pendientesH === 1 ? '' : 's'}</span> : null}
              </p>
              <div className="hist-dow-row" aria-hidden="true">
                {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((l) => <span key={l}>{l}</span>)}
              </div>
              <div className="hist-month-grid" role="group" aria-label={`Boletines de ${monthLabelH}: toca un día con boletín para ir a su tarjeta`}>
                {Array.from({ length: leadH }, (_, i) => <div key={`vacio-${i}`} aria-hidden="true" />)}
                {Array.from({ length: totalDays }, (_, i) => {
                  const date = `${activeMonth}-${String(i + 1).padStart(2, '0')}`
                  const b = byDate.get(date)
                  if (!b) {
                    return (
                      <div key={date} title={`${fmtDate(date)}: sin boletín`} className="hist-cell2 none">
                        {i + 1}
                      </div>
                    )
                  }
                  const sent = b.status === 'enviado'
                  const resumen = `Boletín ${b.date}: ${sent ? 'enviado' : b.status === 'error' ? 'con error de envío' : 'pendiente de envío'}`
                  return (
                    <button
                      key={date}
                      type="button"
                      className={`hist-cell2 ${sent ? 'sent' : 'pending'}`}
                      onClick={() => goTo(date)}
                      aria-pressed={flash === date}
                      aria-label={`Ir a la tarjeta del boletín del ${fmtDate(date)}: ${resumen}`}
                      title={`${fmtDate(date)} · ${resumen}`}
                      style={{
                        boxShadow: flash === date
                          ? '0 0 0 2px var(--surface), 0 0 0 4px var(--deep)'
                          : date === today
                            ? '0 0 0 2px var(--gold)'
                            : undefined,
                      }}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>
              <div className="hist-legend" aria-label="Leyenda del estado de los boletines">
                <span><i style={{ background: '#23aa70' }} />Enviado</span>
                <span><i style={{ background: 'color-mix(in srgb, var(--gold) 62%, var(--surface-tonal))' }} />Pendiente</span>
                <span><i style={{ border: '1px dashed var(--border)' }} />Sin boletín</span>
              </div>
            </div>
          )
        })()}
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
              {/* IPV original/actualizado de ese día desde la media, cuando existe. */}
              <IpvDownloads date={b.date} data={data} />
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
