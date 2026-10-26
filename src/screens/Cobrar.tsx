import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Category, Receivable, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { addLocalPayments, supabaseConfigured } from '../lib/backend'
import { sbAddCobrarPayments } from '../lib/supabaseBackend'
import {
  CATEGORY_LABEL, CATEGORY_SINGULAR, agingRatio, dueDate, effectivePayments, effectiveSaldo,
  fmtCUP, fmtDate, fmtInt, isMorosa, todayISO,
} from '../lib/utils'

const SB_MODE = supabaseConfigured()

export type CobrarView = 'cuentas' | 'clientes' | 'comprobantes' | 'entidades'
type AccountFilter = 'pendientes' | 'morosas' | 'pagadas'

interface PersonPending { clientKey: string; name: string; total: number }
interface PersonGroup { clientKey: string; name: string; category: Category; pendingTotal: number }

const PERSON_COLORS = ['#0e9f6e', '#0ea5bd', '#3b82f6', '#8b5cf6', '#e9a13b', '#287c5c', '#d64541', '#0b7285']
function personColor(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PERSON_COLORS[h % PERSON_COLORS.length]
}
function initialsOf(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'
}

/** Color con el que una cuenta pendiente envejece dentro de su plazo:
 *  verde claro al nacer → rojo al vencer (la marca del original). */
function agingColor(rec: Receivable, saldo: number, ref: string, paid: boolean): string {
  if (paid) return 'var(--paid)'
  if (isMorosa(rec, saldo, ref)) return 'var(--danger)'
  const r = agingRatio(rec, ref)
  return `hsl(${Math.round(145 - 145 * r)} 62% ${Math.round(66 - 24 * r)}%)`
}

/** Comprobante de un abono, con los datos reales de la cuenta.
 *  En el original lo genera el servidor (listPaymentReceipts) y su
 *  tarjeta es ReceiptPreviewCard; el clon no tiene esa tabla ni ese
 *  generador en documentosCore/backend, así que la vista previa se
 *  dibuja aquí con la MISMA tarjeta y los datos reales del abono
 *  (persona, cuenta, fechas, importe, resto y método). */
export interface ReceiptPreview {
  key: string; person: string; amount: number; paidDate: string; method: string
  recDate: string; totalAmount: number; remaining: number
}

function ReceiptPreviewCard({ receipt }: { receipt: ReceiptPreview }) {
  const isPartial = receipt.remaining > 0
  const row = (label: string, value: string, opts: { strong?: boolean; warn?: boolean } = {}) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--dim)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 700, fontSize: opts.strong ? 16 : 14, color: opts.warn ? '#a16207' : 'var(--deep)' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ overflow: 'hidden', borderRadius: 26, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}>
      <div style={{ padding: '24px 24px 20px', color: '#fff', background: 'linear-gradient(135deg, var(--deep) 0%, var(--deep-2) 100%)' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, lineHeight: 1.25, margin: 0 }}>Restaurante - Bar La Reina</p>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#bfe3ce', margin: '2px 0 0' }}>Júcaro</p>
        <p style={{ marginTop: 6, fontSize: 11, color: '#8fc7a5' }}>Queen SDA — Sistema de Automatización de Datos V2.0</p>
        <span style={{ marginTop: 16, display: 'inline-block', borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fff', background: isPartial ? '#c9a227' : '#16a34a' }}>{isPartial ? 'Comprobante · Pago parcial' : 'Comprobante · Pago total'}</span>
      </div>
      <div aria-hidden="true"><div style={{ height: 3, background: '#16a34a' }} /><div style={{ height: 2, background: 'var(--turquoise)' }} /><div style={{ height: 1, background: 'var(--gold)' }} /></div>
      <div style={{ padding: '20px 24px' }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Comprobante de pago</h3>
        <p style={{ marginTop: 2, fontSize: 13, color: 'var(--dim)' }}>Hola, {receipt.person}: confirmamos el pago de tu cuenta en Restaurante - Bar La Reina.</p>
        <div style={{ marginTop: 8 }}>
          {row('Cuenta creada el', fmtDate(receipt.recDate))}
          {row('Pagado el', fmtDate(receipt.paidDate))}
          {row('Monto total de la cuenta', fmtCUP(receipt.totalAmount))}
          {row(isPartial ? 'Pagó en este abono' : 'Pagó', fmtCUP(receipt.amount), { strong: true })}
          {isPartial ? row('Queda por pagar', fmtCUP(receipt.remaining), { strong: true, warn: true }) : null}
          {row('Forma de pago', receipt.method === 'transferencia' ? 'Transferencia' : 'Efectivo')}
        </div>
        <p style={{ marginTop: 16, fontSize: 15, fontWeight: 700, color: 'var(--deep)' }}>Gracias por confiar en nosotros.</p>
        <p style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, color: 'var(--dim)' }}>Este comprobante lo generó automáticamente Queen SDA — Sistema de Automatización de Datos V2.0 al registrarse tu pago.</p>
      </div>
      <div style={{ padding: '12px 24px', fontSize: 11, color: '#8fc7a5', background: 'var(--deep)' }}>Queen SDA — Sistema de Automatización de Datos V2.0 · Restaurante - Bar La Reina</div>
    </div>
  )
}

/** Cronología de la cuenta (timelineBlock / receivableTimeline del
 *  original): «Cuenta creada» y cada abono, en orden, con el saldo que
 *  quedaba tras cada paso. El clon no trae smsLogs ni ciclo de arrastre
 *  en la cuenta, así que esos dos tipos de evento no aparecen. */
function accountTimeline(rec: Receivable, payments: ReturnType<typeof effectivePayments>) {
  const original = Math.max(0, rec.originalAmount || rec.amount)
  type Ev = { key: string; date: string; kind: 'creada' | 'abono'; amount?: number; method?: string; local?: boolean; balance: number }
  let balance = original
  const events: Ev[] = [{ key: `created-${rec.id}`, date: rec.date, kind: 'creada', amount: original, balance }]
  for (const pay of [...payments].sort((a, b) => a.paidDate.localeCompare(b.paidDate))) {
    balance = Math.max(0, balance - Math.max(0, pay.amount))
    events.push({ key: `payment-${pay.id}`, date: pay.paidDate, kind: 'abono', amount: pay.amount, method: pay.paymentMethod, local: pay.local, balance })
  }
  return events
}

/* Tarjeta de cuenta del original (account-swipe-card): acento de color
   por persona (borde interior izquierdo de 3px), «Debe X de Y», marca
   de antigüedad que envejece con el plazo propio; tocar abre su
   cronología, deslizar → prepara el pago, deslizar ← detalles. */
function AccountCard({ rec, saldo, payments, isAdmin, onPay, onReceipt }: {
  rec: Receivable
  saldo: number
  payments: ReturnType<typeof effectivePayments>
  isAdmin: boolean
  onPay: (rec: Receivable, saldo: number) => void
  onReceipt: (r: ReceiptPreview) => void
}) {
  const [open, setOpen] = useState(false)
  const [dx, setDx] = useState(0)
  const startX = useRef<number | null>(null)
  const swiped = useRef(false)
  const ref = todayISO()
  const paid = rec.status === 'pagada' || Boolean(rec.closeKind) || saldo <= 0
  const morosa = isMorosa(rec, saldo, ref)
  const due = dueDate(rec)
  const accent = agingColor(rec, saldo, ref, paid)

  const onPointerDown = (e: ReactPointerEvent) => { startX.current = e.clientX }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (startX.current === null) return
    const delta = e.clientX - startX.current
    if (Math.abs(delta) > 8) setDx(Math.max(-96, Math.min(96, delta)))
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (startX.current === null) return
    const delta = e.clientX - startX.current
    startX.current = null
    setDx(0)
    if (Math.abs(delta) > 10) swiped.current = true
    if (delta > 64 && isAdmin && !paid) onPay(rec, saldo)
    else if (delta < -64) setOpen((v) => !v)
  }
  const onMainClick = () => {
    if (swiped.current) { swiped.current = false; return }
    setOpen((v) => !v)
  }

  return (
    <article
      className={`account-card${morosa ? ' is-morosa' : ''}${paid ? ' is-paid' : ''}`}
      style={{ boxShadow: `inset 3px 0 0 ${accent}`, transform: dx ? `translateX(${dx}px)` : undefined } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { startX.current = null; setDx(0) }}
    >
      <button type="button" className="account-main" onClick={onMainClick} aria-expanded={open} aria-label={`${rec.client}: ${paid ? 'cuenta pagada' : `debe ${fmtCUP(saldo)} de ${fmtCUP(rec.originalAmount)}`}. Toca para ver su cronología.`}>
        <span className="account-avatar" style={{ background: personColor(rec.clientKey) }} aria-hidden>{initialsOf(rec.client)}</span>
        <span className="account-info">
          <span className="account-name">{rec.client}</span>
          <span className="account-sub">{fmtDate(rec.date)} · {CATEGORY_SINGULAR[rec.category]}{rec.detail ? ` · ${rec.detail}` : ''}</span>
        </span>
        <span className="account-amount">
          {paid ? <span className="chip pagada">Pagada</span> : (
            <>
              <small>Debe</small>
              <strong>{fmtCUP(saldo)}</strong>
              <small>de {fmtCUP(rec.originalAmount)}</small>
            </>
          )}
        </span>
      </button>
      <div className="account-meta">
        {paid
          ? <span className="chip pagada">Pagada{rec.paidDate ? ` · ${fmtDate(rec.paidDate)}` : ''}</span>
          : morosa
            ? <span className="chip morosa">Morosa{due ? ` · venció el ${fmtDate(due)}` : ''}</span>
            : <span className="chip">Pendiente{due ? ` · vence el ${fmtDate(due)}` : ''}</span>}
        {!paid && !morosa ? (
          <span className="age-track grow" aria-hidden><span className="age-fill" style={{ width: `${Math.max(4, agingRatio(rec, ref) * 100)}%` }} /></span>
        ) : null}
        {isAdmin && !paid ? <button type="button" className="btn account-pay-btn" onClick={() => onPay(rec, saldo)}>Abonar</button> : null}
      </div>
      {open ? (
        <div className="rec-detail" aria-label={`Cronología de la cuenta de ${rec.client}`}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--dim)' }}>Cronología de la cuenta</p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {accountTimeline(rec, payments).map((event, index, all) => (
              <li key={event.key} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', gap: 8, paddingBottom: index < all.length - 1 ? 12 : 0 }}>
                {index < all.length - 1 ? <span aria-hidden="true" style={{ position: 'absolute', left: 5, top: 12, bottom: 0, width: 1, background: 'var(--border)' }} /> : null}
                <span aria-hidden="true" style={{ position: 'relative', zIndex: 1, marginTop: 4, width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--surface)', background: event.kind === 'abono' ? 'var(--paid)' : 'var(--accent)' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '2px 12px', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{event.kind === 'creada' ? 'Cuenta creada' : 'Abono'} · {fmtDate(event.date)}</span>
                    <span style={{ fontWeight: 700 }}>Saldo {fmtCUP(event.balance)}</span>
                  </div>
                  <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', fontSize: 11, color: 'var(--dim)' }}>
                    {event.kind === 'creada' ? <span>Importe inicial {fmtCUP(event.amount ?? 0)}</span> : null}
                    {event.kind === 'abono' ? (
                      <>
                        <span>Pagó {fmtCUP(event.amount ?? 0)} · {event.method === 'transferencia' ? 'Transferencia' : 'Efectivo'}{event.local ? ' (en esta copia)' : ''}</span>
                        <button type="button" className="btn" style={{ minHeight: 30, padding: '3px 10px', fontSize: '0.75rem' }}
                          onClick={() => onReceipt({ key: `${rec.id}-${event.key}`, person: rec.client, amount: event.amount ?? 0, paidDate: event.date, method: event.method || 'efectivo', recDate: rec.date, totalAmount: Math.max(0, rec.originalAmount || rec.amount), remaining: event.balance })}>
                          Comprobante
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {isAdmin && !paid ? <p className="small muted" style={{ margin: '8px 0 0' }}>Desliza la tarjeta a la derecha o toca «Abonar» para preparar el pago de esta cuenta.</p> : null}
        </div>
      ) : null}
    </article>
  )
}

const VIEW_TABS: Array<{ id: CobrarView; label: string; icon: IconName }> = [
  { id: 'cuentas', label: 'Cuentas', icon: 'receipt' },
  { id: 'clientes', label: 'Clientes', icon: 'people' },
  { id: 'comprobantes', label: 'Comprobantes de pago', icon: 'doc' },
  { id: 'entidades', label: 'Entidades', icon: 'grid' },
]

export default function Cobrar({ data, isAdmin, onChanged, initialView = 'cuentas' }: {
  data: StoredData
  isAdmin: boolean
  onChanged: () => void
  initialView?: CobrarView
}) {
  const [view, setView] = useState<CobrarView>(initialView)
  const [filter, setFilter] = useState<AccountFilter>('pendientes')
  const [query, setQuery] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null)
  const ref = todayISO()

  // --- Panel de pago (la lógica de abono de siempre, sin tocar) ---
  const [payOpen, setPayOpen] = useState(false)
  const [personKey, setPersonKey] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [date, setDate] = useState(todayISO())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const persons = useMemo<PersonPending[]>(() => {
    const map = new Map<string, PersonPending>()
    for (const rec of data.receivables) {
      const saldo = effectiveSaldo(rec, data.localPayments)
      if (rec.status === 'pagada' || rec.closeKind || saldo <= 0) continue
      const cur = map.get(rec.clientKey) ?? { clientKey: rec.clientKey, name: rec.client, total: 0 }
      cur.total += saldo
      map.set(rec.clientKey, cur)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [data])

  const groups = useMemo<PersonGroup[]>(() => {
    const map = new Map<string, PersonGroup>()
    for (const rec of data.receivables) {
      const saldo = effectiveSaldo(rec, data.localPayments)
      if (!map.has(rec.clientKey)) map.set(rec.clientKey, { clientKey: rec.clientKey, name: rec.client, category: rec.category, pendingTotal: 0 })
      const g = map.get(rec.clientKey)!
      if (rec.status !== 'pagada' && !rec.closeKind && saldo > 0) g.pendingTotal += saldo
    }
    return [...map.values()].sort((a, b) => b.pendingTotal - a.pendingTotal || a.name.localeCompare(b.name))
  }, [data])

  const pendingOf = (cat?: Category) =>
    data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0 && (!cat || x.rec.category === cat))
  const dineroCalle = pendingOf('cliente').reduce((s, x) => s + x.saldo, 0)

  const accountRows = useMemo(() => {
    const rows = data.receivables.map((rec) => ({ rec, saldo: effectiveSaldo(rec, data.localPayments) }))
    const q = query.trim().toLowerCase()
    const named = q ? rows.filter((x) => x.rec.client.toLowerCase().includes(q)) : rows
    if (filter === 'pagadas') {
      return named
        .filter((x) => x.rec.status === 'pagada' || Boolean(x.rec.closeKind) || x.saldo <= 0)
        .sort((a, b) => (b.rec.paidDate ?? b.rec.date).localeCompare(a.rec.paidDate ?? a.rec.date))
    }
    const pend = named.filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
    if (filter === 'morosas') return pend.filter((x) => isMorosa(x.rec, x.saldo, ref)).sort((a, b) => a.rec.date.localeCompare(b.rec.date))
    return pend.sort((a, b) => a.rec.date.localeCompare(b.rec.date))
  }, [data, filter, query, ref])

  const receipts = useMemo<ReceiptPreview[]>(() => {
    const out: ReceiptPreview[] = []
    for (const rec of data.receivables) {
      const totalAmount = Math.max(0, rec.originalAmount || rec.amount)
      let balance = totalAmount
      for (const pay of [...effectivePayments(rec, data.localPayments)].sort((a, b) => a.paidDate.localeCompare(b.paidDate))) {
        balance = Math.max(0, balance - Math.max(0, pay.amount))
        out.push({ key: `${rec.id}-${pay.id}`, person: rec.client, amount: pay.amount, paidDate: pay.paidDate, method: pay.paymentMethod || 'efectivo', recDate: rec.date, totalAmount, remaining: balance })
      }
    }
    return out.sort((a, b) => b.paidDate.localeCompare(a.paidDate))
  }, [data])

  // Reparto del abono: a la cuenta más antigua primero.
  const allocation = useMemo(() => {
    const value = Number(amount)
    if (!personKey || !Number.isFinite(value) || value <= 0) return []
    let remaining = value
    const recs = data.receivables
      .filter((r) => r.clientKey === personKey)
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
      .sort((a, b) => a.rec.date.localeCompare(b.rec.date))
    const out: Array<{ receivableId: string; date: string; saldo: number; applied: number }> = []
    for (const x of recs) {
      if (remaining <= 0) break
      const applied = Math.min(remaining, x.saldo)
      out.push({ receivableId: x.rec.id, date: x.rec.date, saldo: x.saldo, applied })
      remaining -= applied
    }
    return out
  }, [amount, personKey, data])

  const person = persons.find((p) => p.clientKey === personKey)
  const value = Number(amount)
  const overpays = person !== undefined && Number.isFinite(value) && value > person.total

  const preparePay = (rec: Receivable, saldo: number) => {
    setPersonKey(rec.clientKey)
    setAmount(String(saldo))
    setConfirming(false)
    setError(null)
    setMessage(null)
    setPayOpen(true)
    requestAnimationFrame(() => document.getElementById('cobrar-pay-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const submit = () => {
    setError(null)
    setMessage(null)
    if (!person) { setError('Elige primero a la persona que paga.'); return }
    if (!Number.isFinite(value) || value <= 0) { setError('Escribe un importe válido mayor que cero.'); return }
    if (overpays) { setError(`El importe supera lo que debe ${person.name} (${fmtCUP(person.total)}).`); return }
    setConfirming(true)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (SB_MODE) {
        await sbAddCobrarPayments(allocation.map((a) => ({ receivableId: a.receivableId, amount: a.applied, date, method })))
      } else {
        addLocalPayments(allocation.map((a) => ({ receivableId: a.receivableId, clientKey: personKey, amount: a.applied, date, method })))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el abono.')
      setBusy(false)
      return
    }
    setBusy(false)
    setMessage(`Abono registrado: ${fmtCUP(value)} de ${person?.name} (${method}, ${fmtDate(date)}), aplicado a ${allocation.length} ${allocation.length === 1 ? 'cuenta' : 'cuentas'}, la más antigua primero.`)
    setAmount('')
    setConfirming(false)
    onChanged()
  }

  const cuentasTitle = filter === 'morosas' ? 'Cuentas morosas' : filter === 'pagadas' ? 'Cuentas pagadas' : 'Cuentas pendientes'

  return (
    <div>
      <TabHeader icon="wallet" title="Cobrar" desc="Cuentas pendientes y vencidas" badge={TAB_BADGES.cobrar} />

      <div className="view-chips" role="tablist" aria-label="Cobrar y clientes">
        {VIEW_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={view === t.id} className={`view-chip${view === t.id ? ' active' : ''}`} onClick={() => setView(t.id)}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>

      {view === 'cuentas' ? (
        <>
          <Card>
            <div className="legend-head">
              <h3 style={{ margin: 0 }}>Plazos y estados</h3>
              <button type="button" className="icon-btn" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp} aria-label="Ayuda sobre plazos y estados">
                <Icon name="info" size={18} />
              </button>
            </div>
            <div className="legend-chips">
              <span className="chip">Clientes · 7 días</span>
              <span className="chip">Trabajadores · 15 días hábiles</span>
              <span className="chip casa">Casa · siempre amarillo</span>
              <span className="chip pagada">Pagadas · azul</span>
            </div>
            {showHelp ? (
              <div className="help-box">
                <p>Cada cuenta vence según su categoría: los clientes a los 7 días y los trabajadores a los 15 días hábiles; pasada la fecha, la cuenta es <strong>morosa</strong>. La marca de antigüedad de cada tarjeta envejece de verde claro a rojo dentro de su propio plazo.</p>
                <p>«Dinero en la calle» son solo las cuentas de clientes. Un abono se aplica siempre a la cuenta más antigua primero, y registrarlo es una acción del administrador{SB_MODE ? ' (el servidor lo impone)' : ''}. El saldo sale del respaldo del SDA: esta pantalla no ajusta cifras.</p>
              </div>
            ) : null}
            <div className="grid-3" style={{ marginTop: 14 }}>
              {(['cliente', 'trabajador', 'administrativo'] as Category[]).map((cat) => (
                <div className="stat" key={cat}>
                  <div className="label">{CATEGORY_LABEL[cat]}</div>
                  <div className="value">{fmtCUP(pendingOf(cat).reduce((s, x) => s + x.saldo, 0))}</div>
                  <div className="hint">{fmtInt(pendingOf(cat).length)} cuentas</div>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Dinero en la calle (solo clientes): <strong>{fmtCUP(dineroCalle)}</strong>
              {!isAdmin ? ' · Tu perfil es de solo lectura: puedes ver las cuentas, pero registrar abonos es del administrador.' : ''}
            </p>
          </Card>

          <div className="view-chips sub" role="tablist" aria-label="Filtro de cuentas">
            {([['pendientes', 'Todas pendientes'], ['morosas', 'Morosas'], ['pagadas', 'Pagadas']] as Array<[AccountFilter, string]>).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`view-chip${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>

          <h3 className="cuentas-title">{cuentasTitle}</h3>
          <div className="field">
            <input type="search" placeholder="Buscar por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar por nombre" />
          </div>

          {data.receivables.length === 0 ? (
            <Card><EmptyState icon="receipt" title="Sin cuentas todavía" text="Las cuentas por cobrar entran con el respaldo del SDA. Sin respaldo importado, esta vista queda vacía a propósito." /></Card>
          ) : accountRows.length === 0 ? (
            <Card><EmptyState icon="search" title="Nada en esta vista" text={query ? 'Ninguna cuenta coincide con esa búsqueda en este filtro.' : filter === 'morosas' ? 'No hay cuentas morosas: ninguna pendiente pasó su plazo.' : filter === 'pagadas' ? 'Todavía no hay cuentas pagadas en el respaldo.' : 'No hay cuentas pendientes.'} /></Card>
          ) : (
            <div className="account-list">
              {accountRows.map(({ rec, saldo }) => (
                <AccountCard key={rec.id} rec={rec} saldo={saldo} payments={effectivePayments(rec, data.localPayments)} isAdmin={isAdmin} onPay={preparePay} onReceipt={setReceiptPreview} />
              ))}
            </div>
          )}

          {isAdmin ? (
            <>
              {!payOpen ? (
                <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => { setPayOpen(true); setError(null); setMessage(null) }}>Registrar un abono</button>
              ) : (
                <Card className="pay-panel" >
                  <div id="cobrar-pay-panel">
                    <h3>Registrar un abono</h3>
                    <p className="sub">El abono se aplica a la cuenta más antigua primero. Antes de guardarlo verás el reparto exacto y tendrás que confirmarlo.</p>
                    {error ? <div className="error-box">{error}</div> : null}
                    {message ? <div className="ok-box">{message}</div> : null}
                    <div className="field">
                      <label htmlFor="cb-person">Persona que paga</label>
                      <select id="cb-person" value={personKey} onChange={(e) => { setPersonKey(e.target.value); setConfirming(false) }}>
                        <option value="">— Elegir persona —</option>
                        {persons.map((p) => (
                          <option key={p.clientKey} value={p.clientKey}>{p.name} · debe {fmtCUP(p.total)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="cb-amount">Importe del abono (CUP)</label>
                        <input id="cb-amount" type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false) }} placeholder="0" />
                      </div>
                      <div className="field">
                        <label>Método</label>
                        <div className="method-capsule" role="group" aria-label="Método de pago">
                          <button type="button" className={method === 'efectivo' ? 'active' : ''} aria-pressed={method === 'efectivo'} onClick={() => { setMethod('efectivo'); setConfirming(false) }}>Efectivo</button>
                          <button type="button" className={method === 'transferencia' ? 'active' : ''} aria-pressed={method === 'transferencia'} onClick={() => { setMethod('transferencia'); setConfirming(false) }}>Transferencia</button>
                        </div>
                      </div>
                    </div>
                    {person ? (
                      <button type="button" className="btn" style={{ marginBottom: 12 }} onClick={() => { setAmount(String(person.total)); setConfirming(false) }}>Pago total: {fmtCUP(person.total)}</button>
                    ) : null}
                    <div className="field">
                      <label htmlFor="cb-date">Fecha del abono</label>
                      <input id="cb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>

                    {!confirming ? (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button className="btn primary" onClick={submit}>Revisar abono</button>
                        <button className="btn" onClick={() => setPayOpen(false)}>Cerrar</button>
                      </div>
                    ) : (
                      <div>
                        <h3>Confirma el abono — todavía no se ha guardado</h3>
                        <table className="kv">
                          <tbody>
                            <tr><td>Persona</td><td>{person?.name}</td></tr>
                            <tr><td>Importe</td><td>{fmtCUP(value)}</td></tr>
                            <tr><td>Método y fecha</td><td>{method} · {fmtDate(date)}</td></tr>
                            {allocation.map((a) => (
                              <tr key={a.receivableId}><td>Cuenta del {fmtDate(a.date)} (saldo {fmtCUP(a.saldo)})</td><td>− {fmtCUP(a.applied)}</td></tr>
                            ))}
                            <tr><td>Saldo restante de la persona</td><td>{fmtCUP((person?.total ?? 0) - value)}</td></tr>
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                          <button className="btn primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Guardando…' : 'Confirmar y guardar'}</button>
                          <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Volver</button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </>
          ) : null}

          {data.localPayments.length > 0 ? (
            <Card>
              <h3>{SB_MODE ? 'Abonos registrados (en el servidor)' : 'Abonos registrados en este dispositivo'}</h3>
              <p className="sub">{SB_MODE
                ? 'Guardados en Supabase (tabla payments): se aplican como capa sobre el saldo del respaldo y se ven en todos los dispositivos.'
                : 'Capa local sobre los datos importados; se conservan aunque se reimporte el respaldo.'}</p>
              {data.localPayments.slice().reverse().map((p) => {
                const rec = data.receivables.find((r) => r.id === p.receivableId)
                return (
                  <div className="list-row" key={p.id} style={{ cursor: 'default' }}>
                    <span className="grow">{rec?.client ?? p.clientKey}<span className="muted">Cuenta del {rec ? fmtDate(rec.date) : '—'} · {p.method}</span></span>
                    <strong>{fmtCUP(p.amount)}</strong>
                  </div>
                )
              })}
            </Card>
          ) : null}
        </>
      ) : null}

      {view === 'clientes' ? (
        <>
          <p className="sub" style={{ margin: '2px 0 12px' }}>La tarjeta de cada contacto muestra solo el total que debe hoy; si saldó todo, no aparece ningún monto. Toca una tarjeta para ver sus cuentas.</p>
          {groups.length === 0 ? (
            <Card><EmptyState icon="people" title="Sin contactos todavía" text="Los contactos llegan con las cuentas del respaldo del SDA." /></Card>
          ) : (
            <div className="account-list">
              {groups.map((g) => (
                <button key={g.clientKey} type="button" className="contact-card" onClick={() => { setQuery(g.name); setFilter('pendientes'); setView('cuentas') }}>
                  <span className="account-avatar" style={{ background: personColor(g.clientKey) }} aria-hidden>{initialsOf(g.name)}</span>
                  <span className="account-info">
                    <span className="account-name">{g.name}</span>
                    <span className="account-sub">{CATEGORY_SINGULAR[g.category]}</span>
                  </span>
                  {g.pendingTotal > 0 ? <span className="contact-total">{fmtCUP(g.pendingTotal)}</span> : null}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {view === 'comprobantes' ? (
        <>
          <div className="section-big-title">
            <span className="sbt-ico"><Icon name="doc" size={24} /></span>
            <h2>Comprobantes de pago</h2>
          </div>
          {receipts.length === 0 ? (
            <Card><EmptyState icon="doc" title="Sin comprobantes todavía" text="Aquí se listan los abonos reales registrados en las cuentas (del respaldo y de Cobrar). Sin abonos, no hay comprobantes que mostrar." /></Card>
          ) : (
            <Card>
              {receipts.map((r) => (
                <div className="list-row" key={r.key} style={{ cursor: 'default' }}>
                  <span className="row-ico"><Icon name="receipt" size={20} /></span>
                  <span className="grow">{r.person}<span className="muted">Cuenta del {fmtDate(r.recDate)} · {r.method === 'transferencia' ? 'Transferencia' : 'Efectivo'} · {fmtDate(r.paidDate)}</span></span>
                  <strong>{fmtCUP(r.amount)}</strong>
                  <button type="button" className="btn" onClick={() => setReceiptPreview(r)} aria-label={`Ver vista previa del comprobante de ${r.person}`}>Vista previa</button>
                </div>
              ))}
            </Card>
          )}
        </>
      ) : null}

      {receiptPreview ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setReceiptPreview(null) }}>
          <div style={{ maxHeight: '92dvh', width: '100%', maxWidth: 600, overflowY: 'auto', borderRadius: '28px 28px 0 0', background: 'var(--bg)', padding: 16 }} role="dialog" aria-modal="true" aria-label={`Vista previa del comprobante de pago de ${receiptPreview.person}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Vista previa del comprobante</h3>
              <button type="button" className="btn" onClick={() => setReceiptPreview(null)} aria-label="Cerrar vista previa">Cerrar</button>
            </div>
            <ReceiptPreviewCard receipt={receiptPreview} />
            <p className="small muted" style={{ marginTop: 12 }}>
              Este comprobante se dibuja con los datos reales de ese abono tal como quedaron registrados. En el sistema original además se envía por correo si el cliente tiene correo en su ficha; en esta copia no hay envío de comprobantes, así que no se muestra ningún estado de envío inventado.
            </p>
          </div>
        </div>
      ) : null}

      {view === 'entidades' ? (
        <>
          <div className="section-big-title">
            <span className="sbt-ico"><Icon name="grid" size={24} /></span>
            <h2>Entidades</h2>
          </div>
          <Card>
            <EmptyState icon="grid" title="Sin entidades en esta copia" text="Las entidades (servicios a instituciones con cobro bancario) llegan con su propia fase del sistema externo. No se muestra ningún servicio inventado." />
          </Card>
        </>
      ) : null}
    </div>
  )
}
