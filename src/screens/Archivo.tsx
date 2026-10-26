import { useMemo, useState } from 'react'
import type { MonthlyArchive, Section, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { effectiveSaldo, fmtCUP, fmtDate, fmtInt, isMorosa, todayISO } from '../lib/utils'
import { saveMonthlyArchives, supabaseConfigured } from '../lib/backend'
import { sbSaveMonthlyArchives } from '../lib/supabaseBackend'
import { printHtml } from '../lib/download'
import { BRAND_CUNO_URL } from '../lib/brandAssets'
import '../components/sectionsMirror.css'

const SB_MODE = supabaseConfigured()

/* Archivo mensual (oleada 3): espejo del ArchivoTab del original
   (App.tsx:4188) con lo que de verdad viaja. Los resúmenes de mes
   son los de StoredData.monthlyArchives, ÍNTEGROS del respaldo
   (con consumo de la casa y resultado efectivo, tal como los
   calculó el sistema original: no se recalculan aquí). El detalle
   de cada mes — días, gastos, cuentas pagadas y nacidas en el mes,
   boletines — se deriva de los registros reales cargados
   (days, expenses, receivables + abonos locales, bulletins).
   La cabecera «Lo que NO se archiva ni se reinicia» es la del
   original, con sus tres tarjetas vivas (cuentas pendientes,
   nómina en curso, por pasar al banco) calculadas de los datos.
   ARCHIVAR: esta copia sí archiva — el resumen del mes queda con
   estado «archivado» en su almacén (local o la colección
   'backup-collections' de app_settings, sin tocar las demás
   colecciones); un mes sin resumen en el respaldo se archiva con
   el resumen derivado de sus días por el núcleo de Economía. Los
   documentos del mes (informe, factura de gastos y factura de
   entradas) se generan con el constructor de documentos y se
   abren como vista de impresión/PDF. */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Saldo por pasar al banco derivado del historial de la tarjeta
 *  (mismo criterio que Transferencias: sin excluidos ni anulados). */
function transferBalance(data: StoredData): number {
  return data.transferMovements
    .filter((m) => !m.excluded && !m.superseded)
    .reduce((s, m) => s + m.amount, 0)
}

export default function ArchivoScreen({ data, bulletins, isAdmin, onChanged, onNavigate }: {
  data: StoredData
  bulletins: StoredData['bulletins']
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
}) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const today = todayISO()
  const archives = data.monthlyArchives
  const currentMonth = today.slice(0, 7)

  /* Meses con días importados, sin resumen en el respaldo y ya
     cerrados: se pueden archivar con el resumen derivado. */
  const archivableMonths = useMemo(() => {
    const known = new Set(archives.map((a) => a.monthKey))
    const months = new Set<string>()
    for (const d of data.days) {
      const mk = d.date.slice(0, 7)
      if (mk !== currentMonth && !known.has(mk)) months.add(mk)
    }
    return [...months].sort().reverse()
  }, [archives, data.days, currentMonth])

  const persistArchives = async (next: MonthlyArchive[], okMsg: string) => {
    setBusy(true); setError(''); setMsg('')
    try {
      if (SB_MODE) await sbSaveMonthlyArchives(next)
      else saveMonthlyArchives(next)
      setMsg(okMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar el mes.')
    } finally { setBusy(false) }
  }

  const archiveExisting = (a: MonthlyArchive) => {
    setConfirmArchive(null)
    void persistArchives(
      archives.map((x) => (x.monthKey === a.monthKey ? { ...x, status: 'archivado', isCurrent: false } : x)),
      `«${a.label || a.monthKey}» quedó archivado.`,
    )
  }

  const archiveDerived = async (monthKey: string) => {
    setConfirmArchive(null)
    setBusy(true); setError('')
    try {
      const [{ monthEconomy }, { monthLabelEs }] = await Promise.all([import('../lib/economiaCore.mjs'), import('../lib/documentosCore.mjs')])
      const eco = monthEconomy(data, monthKey, today)
      const daysCount = data.days.filter((d) => d.date.startsWith(monthKey)).length
      const record: MonthlyArchive = {
        monthKey,
        label: monthLabelEs(monthKey),
        status: 'archivado',
        isCurrent: false,
        daysCount,
        ventas: eco.ventas,
        resultado: eco.resultado,
        gananciaBruta: eco.bruta,
        gananciaNeta: eco.neta,
        gastos: eco.gastos,
        ingresosExtras: eco.ingresosExtras,
      }
      if (SB_MODE) await sbSaveMonthlyArchives([...archives, record])
      else saveMonthlyArchives([...archives, record])
      setMsg(`«${record.label}» quedó archivado con el resumen derivado de sus ${daysCount} días.`)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar el mes.')
    } finally { setBusy(false) }
  }

  const openMonthDoc = async (kind: 'informe' | 'gastos' | 'entradas', monthKey: string) => {
    setError('')
    const docs = await import('../lib/documentosCore.mjs')
    const rawHtml = kind === 'informe'
      ? docs.informeHtml(docs.buildInformeData(data, monthKey, today))
      : kind === 'gastos'
        ? docs.gastosInvoiceHtml(docs.buildGastosInvoiceData(data, monthKey))
        : docs.entradasInvoiceHtml(docs.buildEntradasInvoiceData(data, monthKey))
    /* El cuño real va incrustado también desde Archivo: sin esto,
       los documentos del mes archivado salían con el aviso de
       «Cuño no disponible» aunque el cuño viaja con la app. */
    const html = docs.withStampImage(rawHtml, BRAND_CUNO_URL)
    if (!printHtml(html)) setError('El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
  }

  /* Lo que sigue vivo entre meses (tarjetas del original). */
  const pending = useMemo(
    () => data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0),
    [data.receivables, data.localPayments],
  )
  const pendingTotal = pending.reduce((s, x) => s + x.saldo, 0)
  const pendingCasa = pending.filter((x) => x.rec.registro === 'aparte' || x.rec.persona)
  const pendingGeneral = pending.filter((x) => !pendingCasa.includes(x))
  const casaDe = (persona: string) => pending
    .filter((x) => x.rec.persona === persona)
    .reduce((s, x) => s + x.saldo, 0)
  const morosas = pending.filter((x) => isMorosa(x.rec, x.saldo, today))
  const cycle = useMemo(() => {
    const anchor = data.anchorDate || '2026-09-23'
    const DAY = 86400000
    const idx = Math.max(0, Math.floor((Date.parse(`${today}T12:00:00`) - Date.parse(`${anchor}T12:00:00`)) / DAY / 15))
    const start = new Date(Date.parse(`${anchor}T12:00:00`) + idx * 15 * DAY)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const startISO = iso(start)
    const endISO = iso(new Date(start.getTime() + 14 * DAY))
    const payISO = iso(new Date(start.getTime() + 15 * DAY))
    const cycleDays = data.days.filter((d) => d.date >= startISO && d.date <= endISO)
    const last = cycleDays.length ? cycleDays[cycleDays.length - 1] : null
    const total = last?.rh ? last.rh.reduce((s, e) => s + e.totalCobrar, 0) : 0
    return { startISO, endISO, payISO, last, total, crosses: startISO.slice(0, 7) !== endISO.slice(0, 7) || endISO.slice(0, 7) !== payISO.slice(0, 7) }
  }, [data.anchorDate, data.days, today])
  const bankBalance = useMemo(() => transferBalance(data), [data])

  const detail = useMemo(() => {
    if (!selectedMonth) return null
    const summary = archives.find((a) => a.monthKey === selectedMonth) ?? null
    if (!summary) return null
    const days = data.days.filter((d) => d.date.startsWith(selectedMonth))
    const expenses = data.expenses.filter((e) => e.date.startsWith(selectedMonth))
    const paidInMonth = data.receivables.flatMap((r) => {
      const own = (r.payments ?? [])
        .filter((p) => p.paidDate.startsWith(selectedMonth))
        .map((p) => ({ client: r.client, amount: p.amount, paidDate: p.paidDate, method: p.paymentMethod }))
      const local = data.localPayments
        .filter((p) => p.receivableId === r.id && p.date.startsWith(selectedMonth))
        .map((p) => ({ client: r.client, amount: p.amount, paidDate: p.date, method: p.method }))
      return [...own, ...local]
    }).sort((a, b) => a.paidDate.localeCompare(b.paidDate))
    const bornPending = data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.date.startsWith(selectedMonth) && x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
    const monthBulletins = bulletins.filter((b) => b.date.startsWith(selectedMonth))
    return { summary, days, expenses, paidInMonth, bornPending, monthBulletins }
  }, [selectedMonth, archives, data, bulletins])

  const monthChip = (a: MonthlyArchive) => {
    if (a.isCurrent) return <span className="chip ok">Mes en curso</span>
    if (a.status === 'archivado') return <span className="chip">Archivado</span>
    return <span className="chip warn">Abierto</span>
  }

  return (
    <section aria-label="Archivo mensual">
      <TabHeader icon="archive" title="Archivo" desc="Meses cerrados y morosas: el resumen de cada mes tal como lo trae el respaldo, con su detalle derivado de los registros." badge={TAB_BADGES.archivo} />
      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}
      {error ? <div className="error-box" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card>
        <h3>Lo que NO se archiva ni se reinicia</h3>
        <p className="small muted">Esto sigue vivo al cambiar de mes, igual el 1 que el 31:</p>
        <div className="grid-3">
          <button type="button" className="stat mod-stat-btn" onClick={() => onNavigate('cobrar')} aria-label={`Cuentas por cobrar pendientes heredadas: ${pending.length}`}>
            <div className="label"><Icon name="wallet" size={13} /> Cuentas pendientes</div>
            <div className="value">{fmtCUP(pendingTotal)}</div>
            <div className="hint">
              {fmtInt(pending.length)} sin pagar · general {fmtCUP(pendingGeneral.reduce((s, x) => s + x.saldo, 0))} · consumo de la casa {fmtCUP(pendingCasa.reduce((s, x) => s + x.saldo, 0))}
              {' '}(Dayami (Daya) {fmtCUP(casaDe('dayami'))} · Alejandro {fmtCUP(casaDe('alejandro'))} · Jesús {fmtCUP(casaDe('jesus'))}), con su fecha de origen.
              {morosas.length ? ` ${fmtInt(morosas.length)} ya vencida${morosas.length === 1 ? '' : 's'} (morosas heredadas).` : ''}
            </div>
          </button>
          <button type="button" className="stat mod-stat-btn" onClick={() => onNavigate('rh')} aria-label="Nómina: ciclo en curso">
            <div className="label"><Icon name="people" size={13} /> Nómina en curso</div>
            <div className="value" style={{ fontSize: '1.05rem' }}>{fmtDate(cycle.startISO)} — {fmtDate(cycle.endISO)}</div>
            <div className="hint">
              Pago el {fmtDate(cycle.payISO)}
              {cycle.last ? ` · foto del ${fmtDate(cycle.last.date)}: ${fmtCUP(cycle.total)}` : ' · sin foto aún en este ciclo'}
              {cycle.crosses ? ' · este ciclo cruza de mes y se cierra y paga igual' : ''}.
            </div>
          </button>
          <button type="button" className="stat mod-stat-btn" onClick={() => onNavigate('transferencias')} aria-label="Transferencias pendientes por pasar al banco">
            <div className="label"><Icon name="transfer" size={13} /> Por pasar al banco</div>
            <div className="value">{fmtCUP(bankBalance)}</div>
            <div className="hint">Saldo acumulado e historial completos: continúan entre meses sin tocarse.</div>
          </button>
        </div>
      </Card>

      {!selectedMonth || !detail ? (
        <>
          {isAdmin && archivableMonths.length > 0 ? (
            <Card>
              <h3>Meses por archivar</h3>
              <p className="small muted">Estos meses tienen días importados y ya cerraron, pero el respaldo no trae su resumen. Al archivarlos, el resumen se deriva de sus días con el núcleo de Economía y queda guardado.</p>
              <div className="list">
                {archivableMonths.map((mk) => (
                  <div className="row" key={mk}>
                    <span className="mod-row-main">
                      <span className="mod-row-title">{mk}</span>
                      <span className="small muted">{fmtInt(data.days.filter((d) => d.date.startsWith(mk)).length)} días importados</span>
                    </span>
                    {confirmArchive === mk ? (
                      <>
                        <button type="button" className="btn" onClick={() => setConfirmArchive(null)}>Cancelar</button>
                        <button type="button" className="btn primary" disabled={busy} onClick={() => void archiveDerived(mk)}>Confirmar archivo</button>
                      </>
                    ) : (
                      <button type="button" className="btn primary" onClick={() => setConfirmArchive(mk)}>Archivar mes</button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <h3 className="mod-section-h">Meses</h3>
          {archives.length === 0 ? (
            <EmptyState icon="archive" title="Todavía no hay meses que archivar" text="Cuando importes tu primer día, su mes aparece aquí. Este respaldo no trae resúmenes mensuales." />
          ) : (
            <div className="list">
              {archives.map((a) => (
                <Card key={a.monthKey} className="mod-month-card">
                  <div className="mod-month-head">
                    <button type="button" className="mod-month-open" onClick={() => setSelectedMonth(a.monthKey)} aria-label={`Abrir el archivo de ${a.label}`}>
                      <span className="mod-month-title">{a.label || a.monthKey} {monthChip(a)}</span>
                      <span className="small muted">
                        {fmtInt(a.daysCount)} día{a.daysCount === 1 ? '' : 's'} importado{a.daysCount === 1 ? '' : 's'}
                        {str(a.firstDay) ? ` · ${fmtDate(str(a.firstDay))} — ${fmtDate(str(a.lastDay) || str(a.firstDay))}` : ' · sin días todavía'}
                        {num(a.bulletinsCount) ? ` · ${fmtInt(num(a.bulletinsCount))} boletín${num(a.bulletinsCount) === 1 ? '' : 'es'}` : ''}
                      </span>
                    </button>
                  </div>
                  <div className="grid-2 mod-kpis" style={{ marginTop: 10 }}>
                    <div className="stat"><div className="label">Ventas</div><div className="value">{fmtCUP(a.ventas)}</div></div>
                    <div className="stat"><div className="label">Ganancia neta</div><div className="value">{fmtCUP(num(a.gananciaNeta))}</div></div>
                    <div className="stat"><div className="label">Gastos</div><div className="value">{fmtCUP(num(a.gastos))}</div></div>
                    <div className="stat"><div className="label">Resultado</div><div className="value">{fmtCUP(a.resultado)}</div></div>
                  </div>
                  {num(a.consumoCasa) > 0 ? (
                    <p className="small muted" style={{ marginBottom: 0 }}>
                      Consumo de la casa (familia del dueño): <strong>−{fmtCUP(num(a.consumoCasa))}</strong>
                      {' '}(Dayami (Daya) {fmtCUP(num(a.consumoDayami))} · Alejandro {fmtCUP(num(a.consumoAlejandro))} · Jesús {fmtCUP(num(a.consumoJesus))}) ·
                      {' '}<strong>Resultado efectivo del mes: {fmtCUP(num(a.resultadoEfectivo))}</strong> (el resultado oficial del IPV queda en {fmtCUP(a.resultado)}).
                    </p>
                  ) : null}
                  {a.isCurrent && a.daysCount === 0 ? (
                    <p className="small muted" style={{ marginBottom: 0 }}>Este mes arrancó en cero: todavía no tiene días importados ni totales. Lo anterior está en su archivo, abajo.</p>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
          <p className="small muted">
            Importar un IPV de un mes ya archivado lo guarda en el archivo de ESE mes y no contamina el mes en curso.
            El boletín diario sigue siendo solo de su día: el archivo no revive boletines ya enviados.
          </p>
        </>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setSelectedMonth(null)} style={{ marginBottom: 12 }}>
            <Icon name="chevronL" size={15} /> Todos los meses
          </button>
          <Card>
            <h3 style={{ fontSize: '1.15rem' }}>{detail.summary.label || detail.summary.monthKey} {monthChip(detail.summary)}</h3>
            <p className="small muted">{fmtDate(str(detail.summary.start))} — {fmtDate(str(detail.summary.end))} · {fmtInt(detail.summary.daysCount)} día{detail.summary.daysCount === 1 ? '' : 's'} importado{detail.summary.daysCount === 1 ? '' : 's'}</p>
            {isAdmin ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" className="btn" onClick={() => void openMonthDoc('informe', detail.summary.monthKey)}>
                  <Icon name="doc" size={15} /> Informe del mes (PDF)
                </button>
                <button type="button" className="btn" onClick={() => void openMonthDoc('gastos', detail.summary.monthKey)}>
                  <Icon name="doc" size={15} /> Factura de gastos (PDF)
                </button>
                <button type="button" className="btn" onClick={() => void openMonthDoc('entradas', detail.summary.monthKey)}>
                  <Icon name="doc" size={15} /> Factura de entradas (PDF)
                </button>
                {detail.summary.status !== 'archivado' && !detail.summary.isCurrent ? (
                  confirmArchive === detail.summary.monthKey ? (
                    <>
                      <button type="button" className="btn" onClick={() => setConfirmArchive(null)}>Cancelar</button>
                      <button type="button" className="btn primary" disabled={busy} onClick={() => archiveExisting(detail.summary)}>Confirmar archivo</button>
                    </>
                  ) : (
                    <button type="button" className="btn primary" onClick={() => setConfirmArchive(detail.summary.monthKey)}>
                      <Icon name="archive" size={15} /> Archivar mes
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
            <div className="grid-2 mod-kpis">
              <div className="stat"><div className="label">Ventas del mes</div><div className="value">{fmtCUP(detail.summary.ventas)}</div></div>
              <div className="stat"><div className="label">Ganancia bruta</div><div className="value">{fmtCUP(num(detail.summary.gananciaBruta))}</div></div>
              <div className="stat"><div className="label">Ganancia neta</div><div className="value">{fmtCUP(num(detail.summary.gananciaNeta))}</div></div>
              <div className="stat">
                <div className="label">Resultado (neta − gastos + otros ingresos)</div>
                <div className="value">{fmtCUP(detail.summary.resultado)}</div>
                <div className="hint">gastos {fmtCUP(num(detail.summary.gastos))} · Otros ingresos: +{fmtCUP(num(detail.summary.ingresosExtras))}</div>
              </div>
              <div className="stat">
                <div className="label">Consumo de la casa (familia del dueño)</div>
                <div className="value">−{fmtCUP(num(detail.summary.consumoCasa))}</div>
                <div className="hint">Dayami (Daya) {fmtCUP(num(detail.summary.consumoDayami))} · Alejandro {fmtCUP(num(detail.summary.consumoAlejandro))} · Jesús {fmtCUP(num(detail.summary.consumoJesus))} — cuentas de este mes aún pendientes</div>
              </div>
              <div className="stat">
                <div className="label">Resultado efectivo del mes</div>
                <div className="value">{fmtCUP(num(detail.summary.resultadoEfectivo))}</div>
                <div className="hint">resultado según IPV menos consumo de la casa: línea de lectura, la ganancia oficial no se toca</div>
              </div>
              <div className="stat">
                <div className="label">Entradas del mes</div>
                <div className="value">{fmtCUP(num(detail.summary.entradasImporte))}</div>
                <div className="hint">{fmtInt(num(detail.summary.entradasRegistros))} registro{num(detail.summary.entradasRegistros) === 1 ? '' : 's'} de entrada</div>
              </div>
              <div className="stat">
                <div className="label">Cuentas pagadas en el mes</div>
                <div className="value">{fmtCUP(num(detail.summary.paidReceivablesTotal))}</div>
                <div className="hint">{fmtInt(num(detail.summary.paidReceivablesCount))} cuenta{num(detail.summary.paidReceivablesCount) === 1 ? '' : 's'} cobrada{num(detail.summary.paidReceivablesCount) === 1 ? '' : 's'} este mes (según el resumen del respaldo)</div>
              </div>
              <div className="stat">
                <div className="label">Boletines del mes</div>
                <div className="value">{fmtInt(num(detail.summary.bulletinsCount))}</div>
                <div className="hint">guardados en la bandeja (resumen del respaldo)</div>
              </div>
            </div>
          </Card>

          <Card>
            <h3>Días importados ({detail.days.length})</h3>
            {detail.days.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Este mes no tiene días importados todavía. Si importas un IPV con fecha de este mes, entra aquí directamente.</p>
            ) : (
              <div className="list">
                {detail.days.map((d) => (
                  <div className="row" key={d.date}>
                    <span className="mod-row-main">
                      <span className="mod-row-title">{fmtDate(d.date)}</span>
                      <span className="small muted">venta {fmtCUP(d.ventasDia)} · neta {fmtCUP(d.gananciaNeta)}{d.cuadre !== 0 ? ` · cuadre ${fmtCUP(d.cuadre)}` : ''}</span>
                    </span>
                    <button type="button" className="btn" onClick={() => onNavigate('dias')}>Ver en Días</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3>Gastos del mes ({detail.expenses.length})</h3>
            {detail.expenses.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Sin gastos registrados con fecha de este mes.</p>
            ) : (
              <div className="list">
                {detail.expenses.slice(0, 12).map((e) => (
                  <div className="row" key={e.id}>
                    <span>{e.concept} <span className="small muted">({fmtDate(e.date)} · {e.category})</span></span>
                    <strong>{fmtCUP(e.total)}</strong>
                  </div>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginBottom: 0 }}>
              Entradas del mes: {fmtInt(num(detail.summary.entradasRegistros))} registro{num(detail.summary.entradasRegistros) === 1 ? '' : 's'} por {fmtCUP(num(detail.summary.entradasImporte))} (salen de la columna «Entrada» de los IPV de este mes; el detalle línea a línea está en la pantalla Entradas).
            </p>
          </Card>

          <Card>
            <h3>Cuentas y el mes</h3>
            <p className="small" style={{ marginTop: 0 }}>
              <strong>Pagadas en este mes:</strong> {fmtInt(detail.paidInMonth.length)} pago{detail.paidInMonth.length === 1 ? '' : 's'} por {fmtCUP(detail.paidInMonth.reduce((s, p) => s + p.amount, 0))} según los abonos registrados con fecha de este mes. Quedan en el historial de este mes, en el que se pagaron.
            </p>
            {detail.paidInMonth.length > 0 ? (
              <div className="list">
                {detail.paidInMonth.slice(0, 8).map((p, i) => (
                  <div className="row" key={`${p.client}-${p.paidDate}-${i}`}>
                    <span>{p.client} <span className="small muted">· pagó el {fmtDate(p.paidDate)}{p.method ? ` · ${p.method}` : ''}</span></span>
                    <strong>{fmtCUP(p.amount)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="small">
              <strong>Pendientes que nacieron este mes y siguen vivas:</strong> {fmtInt(detail.bornPending.length)} por {fmtCUP(detail.bornPending.reduce((s, x) => s + x.saldo, 0))}. No se archivan: pasan al mes siguiente como pendientes heredadas con su fecha de origen.
            </p>
            {detail.bornPending.length > 0 ? (
              <div className="list">
                {detail.bornPending.slice(0, 8).map((x) => (
                  <div className="row" key={x.rec.id}>
                    <span>{x.rec.client} <span className="small muted">· desde el {fmtDate(x.rec.date)}</span></span>
                    <strong>{fmtCUP(x.saldo)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <h3>Boletines de este mes ({detail.monthBulletins.length})</h3>
            {detail.monthBulletins.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Ningún boletín guardado con fecha de este mes. Cada boletín diario es solo de su día; el archivo no revive los ya enviados.</p>
            ) : (
              <div className="list">
                {detail.monthBulletins.map((b) => (
                  <div className="row" key={b.id}>
                    <span>{fmtDate(b.date)}</span>
                    <span className="small muted">{b.status === 'enviado' ? `enviado${b.sentAt ? ` el ${fmtDate(b.sentAt.slice(0, 10))}` : ''}` : 'pendiente de envío'}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginBottom: 0 }}>
              Las acciones de cada boletín (descargar, regenerar, enviar) viven en Historial. Los documentos del
              mes del original (su PDF y las facturas de gastos y entradas) los genera el constructor de
              documentos del original, que no se portó a esta copia: aquí el mes se consulta completo, sin
              documentos fingidos.
            </p>
          </Card>
        </div>
      )}
    </section>
  )
}
