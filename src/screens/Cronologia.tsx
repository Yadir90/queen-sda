import { useMemo, useState } from 'react'
import type { Bulletin, Section, StoredData } from '../types'
import { buildProductsCatalog } from '../lib/productosCore.mjs'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { effectiveSaldo, fmtCUP, fmtDate, todayISO } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Cronología global (oleada 3): espejo del CronologiaTab del
   original (App.tsx:13240, categorías CRONO_CATS de :13230). Junta
   en una sola línea de tiempo, del más reciente al más antiguo y
   agrupada por día, los registros que ya guardan las demás
   secciones. Nada se duplica ni se guarda aparte: cada evento se
   DERIVA de un registro real de StoredData —
     ipv:       los días importados (DayData);
     rh:        nóminas pagadas (payrollHistory), pagos fuera de
                nómina (workerPayments) y el contrato cancelado
                del estado extendido (workersExtended);
     cuentas:   cuentas creadas, abonos (del respaldo y locales
                de Cobrar) y cuentas saldadas (receivables), más
                los SMS de cobro ya enviados (smsLogs);
     gastos:    los gastos registrados (expenses);
     productos: cambios de precio y de costo que el catálogo
                detecta entre los IPV (buildProductsCatalog);
     boletines: la cola de boletines (bulletins de la app).
   Sin registro real no hay evento: el historial interno por
   trabajador del registro de RH del original no viaja en el
   respaldo y no se reconstruye aquí. */

export type CronoCat = 'ipv' | 'rh' | 'cuentas' | 'gastos' | 'productos' | 'boletines'
export interface CronoEvent {
  id: string
  cat: CronoCat
  date: string
  ts: number
  title: string
  detail: string
  icon: IconName
  go: Section | null
  goLabel: string
}
export const CRONO_CATS: { id: CronoCat; label: string; icon: IconName }[] = [
  { id: 'ipv', label: 'IPV', icon: 'calendar' },
  { id: 'rh', label: 'RH', icon: 'people' },
  { id: 'cuentas', label: 'Cuentas', icon: 'wallet' },
  { id: 'gastos', label: 'Gastos', icon: 'receipt' },
  { id: 'productos', label: 'Productos', icon: 'package' },
  { id: 'boletines', label: 'Boletines', icon: 'send' },
]
const CRONO_CAT_LABEL: Record<CronoCat, string> = { ipv: 'IPV', rh: 'RH', cuentas: 'Cuentas', gastos: 'Gastos', productos: 'Productos', boletines: 'Boletines' }

const CAT_LABEL: Record<string, string> = { cliente: 'cliente', trabajador: 'trabajador', administrativo: 'administrativa' }

function buildEvents(data: StoredData, bulletins: Bulletin[]): CronoEvent[] {
  const out: CronoEvent[] = []
  const tsOf = (date: string) => Date.parse(`${date}T12:00:00`) || 0
  for (const d of data.days) {
    const productCount = d.departments.reduce((s, dep) => s + dep.products.length, 0)
    out.push({
      id: `ipv-${d.date}`, cat: 'ipv', date: d.date, ts: tsOf(d.date), icon: 'calendar',
      title: `IPV del ${fmtDate(d.date)}`,
      detail: `Ventas ${fmtCUP(d.ventasDia)} · ganancia neta ${fmtCUP(d.gananciaNeta)} · ${productCount} productos · cuadre ${d.cuadre === 0 ? 'exacto' : fmtCUP(d.cuadre)}`,
      go: 'dias', goLabel: 'Ver en Días',
    })
  }
  for (const p of data.payrollHistory) {
    out.push({
      id: `nom-${p.id}`, cat: 'rh', date: p.payDate, ts: tsOf(p.payDate), icon: 'money',
      title: `Nómina pagada · ${fmtDate(p.cycleStart)} — ${fmtDate(p.cycleEnd)}`,
      detail: `${p.workersCount} ${p.workersCount === 1 ? 'trabajador' : 'trabajadores'} · total ${fmtCUP(p.total)} · pagada el ${fmtDate(p.payDate)}`,
      go: 'rh', goLabel: 'Ver en RH',
    })
  }
  const workerName = (key: string) => data.workers.find((w) => w.key === key)?.nombre ?? key
  for (const wp of data.workerPayments) {
    if (!wp.fecha) continue
    out.push({
      id: `wp-${wp.workerKey}-${wp.fecha}-${wp.monto}`, cat: 'rh', date: wp.fecha, ts: tsOf(wp.fecha), icon: 'people',
      title: wp.concepto || 'Pago fuera de nómina',
      detail: `${workerName(wp.workerKey)}${wp.monto ? ` · ${fmtCUP(wp.monto)}` : ''}`,
      go: 'rh', goLabel: 'Ver en RH',
    })
  }
  for (const w of data.workersExtended) {
    if (!w.contratoCanceladoEl) continue
    out.push({
      id: `rh-cc-${w.id}`, cat: 'rh', date: w.contratoCanceladoEl, ts: tsOf(w.contratoCanceladoEl), icon: 'people',
      title: `Contrato cancelado · ${w.nombre}`,
      detail: `Cuño CANCELADO desde el ${fmtDate(w.contratoCanceladoEl)}${w.contratoCanceladoCiclo ? ` · ciclo ${w.contratoCanceladoCiclo}` : ''}`,
      go: 'rh', goLabel: 'Ver en RH',
    })
  }
  for (const r of data.receivables) {
    out.push({
      id: `cta-${r.id}`, cat: 'cuentas', date: r.date, ts: tsOf(r.date), icon: 'wallet',
      title: `Cuenta creada · ${r.client}`,
      detail: `${fmtCUP(r.originalAmount)}${r.detail ? ` · ${r.detail}` : ''} · ${CAT_LABEL[r.category] ?? r.category} · ${r.origin === 'ipv' ? 'detectada del IPV' : 'manual'}`,
      go: 'cobrar', goLabel: 'Ver en Cobrar',
    })
    const saldo = effectiveSaldo(r, data.localPayments)
    for (const pay of r.payments ?? []) {
      out.push({
        id: `cta-p-${pay.id}`, cat: 'cuentas', date: pay.paidDate, ts: tsOf(pay.paidDate), icon: 'wallet',
        title: `Abono · ${r.client}`,
        detail: `${fmtCUP(pay.amount)} por ${pay.paymentMethod} · saldo restante ${fmtCUP(saldo)}`,
        go: 'cobrar', goLabel: 'Ver en Cobrar',
      })
    }
    for (const lp of data.localPayments.filter((p) => p.receivableId === r.id)) {
      out.push({
        id: `cta-lp-${lp.id}`, cat: 'cuentas', date: lp.date, ts: tsOf(lp.date), icon: 'wallet',
        title: `Abono · ${r.client}`,
        detail: `${fmtCUP(lp.amount)} por ${lp.method} · registrado en esta copia · saldo restante ${fmtCUP(saldo)}`,
        go: 'cobrar', goLabel: 'Ver en Cobrar',
      })
    }
    if (r.status === 'pagada' && r.paidDate && !(r.payments ?? []).length) {
      out.push({
        id: `cta-s-${r.id}`, cat: 'cuentas', date: r.paidDate, ts: tsOf(r.paidDate), icon: 'check',
        title: `Cuenta saldada · ${r.client}`,
        detail: `${fmtCUP(r.originalAmount)}${r.paymentMethod ? ` por ${r.paymentMethod}` : ''} · saldada el ${fmtDate(r.paidDate)}`,
        go: 'cobrar', goLabel: 'Ver en Cobrar',
      })
    }
  }
  for (const log of data.smsLogs) {
    const date = (log.sentAt ?? '').slice(0, 10)
    if (!date) continue
    out.push({
      id: `sms-${log.receivableId}-${log.sentAt}`, cat: 'cuentas', date, ts: Date.parse(log.sentAt) || tsOf(date), icon: 'send',
      title: `SMS de cobro · ${log.client}`,
      detail: log.message,
      go: 'cobrar', goLabel: 'Ver en Cobrar',
    })
  }
  for (const e of data.expenses) {
    out.push({
      id: `gas-${e.id}`, cat: 'gastos', date: e.date, ts: tsOf(e.date), icon: 'receipt',
      title: e.concept,
      detail: `${fmtCUP(e.total)} · ${e.category}${e.note ? ` · ${e.note}` : ''}`,
      go: 'economia', goLabel: 'Ver en Gastos',
    })
  }
  const catalog = buildProductsCatalog(data.days)
  for (const p of catalog.products) {
    for (const ev of p.precioHistorial) {
      if (ev.oldPrice == null) continue
      out.push({
        id: `pro-p-${p.productKey}-${ev.date}-${ev.newPrice}`, cat: 'productos', date: ev.date, ts: tsOf(ev.date), icon: 'package',
        title: `Cambio de precio · ${p.name}`,
        detail: `De ${fmtCUP(ev.oldPrice)} a ${fmtCUP(ev.newPrice)} · detectado entre IPV consecutivos${ev.note ? ` · ${ev.note}` : ''}`,
        go: 'productos', goLabel: 'Ver en Productos',
      })
    }
    for (const en of p.entradasHistorial) {
      if (!en.distinto) continue
      out.push({
        id: `pro-c-${p.productKey}-${en.date}-${en.costoEntrada}`, cat: 'productos', date: en.date, ts: tsOf(en.date), icon: 'package',
        title: `Cambio de costo · ${p.name}`,
        detail: `Entrada a ${fmtCUP(en.costoEntrada)}${en.costoAnterior != null ? ` (antes ${fmtCUP(en.costoAnterior)})` : ''} · costo promedio ${fmtCUP(en.costoPromedio)} · detectado en la entrada del IPV`,
        go: 'productos', goLabel: 'Ver en Productos',
      })
    }
  }
  for (const b of bulletins) {
    out.push({
      id: `bol-${b.id}`, cat: 'boletines', date: b.date, ts: b.createdAt ? Date.parse(b.createdAt) || tsOf(b.date) : tsOf(b.date), icon: 'send',
      title: `Boletín · ${fmtDate(b.date)}`,
      detail: `${b.subject} · ${b.status === 'enviado' ? `enviado${b.sentAt ? ` el ${fmtDate(b.sentAt.slice(0, 10))}` : ''}` : 'pendiente de envío'}`,
      go: 'historial', goLabel: 'Ver en Historial',
    })
  }
  return out.sort((a, b) => b.ts - a.ts || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es'))
}

export default function CronologiaScreen({ data, bulletins, onNavigate }: {
  data: StoredData
  bulletins: Bulletin[]
  onNavigate: (s: Section) => void
}) {
  const [cat, setCat] = useState<CronoCat | 'todos'>('todos')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [limit, setLimit] = useState(80)

  const events = useMemo(() => buildEvents(data, bulletins), [data, bulletins])
  const counts = useMemo(() => {
    const map = new Map<CronoCat, number>()
    for (const e of events) map.set(e.cat, (map.get(e.cat) ?? 0) + 1)
    return map
  }, [events])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => (cat === 'todos' || e.cat === cat) && (!q || `${e.title} ${e.detail}`.toLowerCase().includes(q)))
  }, [events, cat, query])
  const visible = filtered.slice(0, limit)
  const groups = useMemo(() => {
    const map = new Map<string, CronoEvent[]>()
    for (const e of visible) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return [...map.entries()]
  }, [visible])

  const today = todayISO()
  const yesterday = new Date(Date.parse(`${today}T12:00:00`) - 86400000).toISOString().slice(0, 10)
  const dayLabel = (date: string) => (date === today ? 'Hoy' : date === yesterday ? 'Ayer' : null)

  return (
    <section aria-label="Cronología del sistema">
      <TabHeader
        icon="list"
        title="Cronología"
        desc="Todos los registros históricos del sistema en una sola línea de tiempo, del más reciente al más antiguo: IPV importados, pagos y movimientos de RH, cuentas y abonos, gastos, cambios de precio y de costo de los productos y boletines. Nada se guarda duplicado: cada evento se lee de su sección de origen."
        badge={TAB_BADGES.cronologia}
      />

      <div className="view-chips" role="group" aria-label="Categoría de la cronología">
        <button type="button" className={`view-chip ${cat === 'todos' ? 'active' : ''}`} aria-pressed={cat === 'todos'} onClick={() => { setCat('todos'); setLimit(80) }}>
          Todos <span className="tabular">{events.length}</span>
        </button>
        {CRONO_CATS.map((c) => (
          <button key={c.id} type="button" className={`view-chip ${cat === c.id ? 'active' : ''}`} aria-pressed={cat === c.id} onClick={() => { setCat(c.id); setLimit(80) }}>
            <Icon name={c.icon} size={13} /> {c.label} <span className="tabular">{counts.get(c.id) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="crono-buscar">Buscar en la cronología</label>
        <input id="crono-buscar" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(80) }} placeholder="Buscar por nombre, concepto, producto…" />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="small muted" style={{ margin: 0 }}>
            {events.length === 0
              ? 'Todavía no hay registros históricos: la cronología se llena sola con cada IPV importado, pago, cuenta, gasto y boletín.'
              : `Sin registros${cat !== 'todos' ? ` en ${CRONO_CAT_LABEL[cat]}` : ''}${query.trim() ? ` que coincidan con «${query.trim()}»` : ''}.`}
          </p>
        </Card>
      ) : (
        <div className="crono-groups">
          {groups.map(([date, dayEvents]) => (
            <div key={date} className="crono-group">
              <p className="crono-day-head">
                <span>{fmtDate(date)}</span>
                {dayLabel(date) ? <span className="chip ok">{dayLabel(date)}</span> : null}
                <span className="small muted">{dayEvents.length} {dayEvents.length === 1 ? 'registro' : 'registros'}</span>
              </p>
              <ul className="crono-list" aria-label={`Registros del ${fmtDate(date)}`}>
                {dayEvents.map((e) => {
                  const open = expandedId === e.id
                  return (
                    <li key={e.id} className="crono-item">
                      <div className="crono-card">
                        <button
                          type="button"
                          className="crono-toggle"
                          onClick={() => setExpandedId(open ? null : e.id)}
                          aria-expanded={open}
                          aria-label={`${e.title}. ${CRONO_CAT_LABEL[e.cat]}. Toca para ${open ? 'plegar' : 'desplegar'}`}
                        >
                          <span className="crono-ico"><Icon name={e.icon} size={15} /></span>
                          <span className="crono-text">
                            <span className="crono-title">{e.title}</span>
                            <span className={`crono-detail ${open ? '' : 'crono-clamp'}`}>{e.detail}</span>
                          </span>
                          <span className="chip">{CRONO_CAT_LABEL[e.cat]}</span>
                        </button>
                        {open && e.go ? (
                          <div className="crono-go">
                            <button type="button" className="btn primary" onClick={() => onNavigate(e.go!)} aria-label={`${e.goLabel}: ${e.title}`}>
                              {e.goLabel} <Icon name="chevronR" size={14} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {filtered.length > limit ? (
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="btn" onClick={() => setLimit((n) => n + 80)}>
                Mostrar más registros ({filtered.length - limit} restantes)
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
