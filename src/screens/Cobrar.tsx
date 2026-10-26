import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Category, Receivable, SmsLog, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { addLocalPayments, supabaseConfigured } from '../lib/backend'
import { sbAddCobrarPayments } from '../lib/supabaseBackend'
import { ClientAvatar } from '../components/MediaImage'
import { addDaysISO, canonicalPersonKey, diffDays, personaOf, workerKeyForAccount } from '../lib/syncCore.mjs'
import '../components/sectionsMirror.css'
import {
  CATEGORY_LABEL, CATEGORY_SINGULAR, addBusinessDaysISO, businessDaysElapsed, effectivePayments, effectiveSaldo,
  fmtCUP, fmtDate, fmtInt, isMorosa, todayISO,
} from '../lib/utils'

const SB_MODE = supabaseConfigured()

export type CobrarView = 'cuentas' | 'clientes' | 'comprobantes' | 'entidades'
type AccountFilter = 'pendientes' | 'morosas' | 'pagadas'

interface PersonPending { clientKey: string; name: string; total: number }

type PaymentStatus = 'verde' | 'rojo' | 'amarillo' | 'morado' | 'neutral'
interface ContactInfo {
  clientKey: string
  name: string
  category: Category
  accountCount: number
  pendingCount: number
  pendingAmount: number
  averageDaysToPay: number | null
  status: PaymentStatus
  label: string
  color: string
  phone: string
  occupation: string
  rhLinked: boolean
  workerIdentity: string
  workerBank: string
}

const STATUS_COLOR: Record<PaymentStatus, string> = {
  amarillo: 'var(--gold)', morado: '#7c3aed', verde: '#16a34a', rojo: 'var(--danger)', neutral: '#94a3b8',
}

/** Contactos de Cobrar: la derivación del servidor del original
 *  (loadClientProfiles) portada tal cual sobre lo que viaja en esta
 *  copia — cuentas (conteos, pendiente de hoy, días medios al pagar,
 *  estado y etiqueta de pago con la misma regla y los mismos textos)
 *  y, para trabajadores, el enlace con RH por workerKeyForAccount
 *  (móvil, ocupación, CI y cuenta bancaria de la ficha). La ficha
 *  personal del original (teléfono/correo/CI/dirección/notas de
 *  clientes) NO viaja en el respaldo: por eso el correo se muestra
 *  con el texto de ausencia del propio original y el teléfono solo
 *  aparece cuando sale del enlace con RH. */
function buildContacts(data: StoredData, ref: string): ContactInfo[] {
  const byKey = new Map<string, { name: string; category: Category; recs: Array<{ rec: Receivable; saldo: number }> }>()
  for (const rec of data.receivables) {
    const saldo = effectiveSaldo(rec, data.localPayments)
    const g = byKey.get(rec.clientKey) ?? { name: rec.client, category: rec.category, recs: [] }
    g.recs.push({ rec, saldo })
    byKey.set(rec.clientKey, g)
  }
  const out: ContactInfo[] = []
  for (const [clientKey, g] of byKey) {
    const pending = g.recs.filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
    const paymentDays: number[] = []
    for (const x of g.recs) {
      if (x.saldo > 0) continue
      const lastPay = effectivePayments(x.rec, data.localPayments).map((p) => p.paidDate).sort().pop()
      const paidDate = x.rec.paidDate ?? lastPay
      if (paidDate) paymentDays.push(Math.max(0, diffDays(x.rec.date, paidDate)))
    }
    const averageDaysToPay = paymentDays.length ? Math.round((paymentDays.reduce((s, v) => s + v, 0) / paymentDays.length) * 10) / 10 : null
    const isHouse = personaOf(clientKey) !== 'general' || personaOf(g.name) !== 'general'
    const category: Category = isHouse ? 'administrativo' : g.category
    const hasOverdue = !isHouse && pending.some((x) => isMorosa(x.rec, x.saldo, ref))
    const workerKey = !isHouse && g.category === 'trabajador' ? workerKeyForAccount(g.name, data.workers) : null
    const worker = workerKey ? data.workers.find((w) => canonicalPersonKey(w.key, w.nombre) === workerKey) : undefined
    const status: PaymentStatus = isHouse
      ? 'amarillo'
      : g.category === 'trabajador'
        ? hasOverdue ? 'rojo' : 'morado'
        : hasOverdue || (averageDaysToPay != null && averageDaysToPay > 7)
          ? 'rojo'
          : averageDaysToPay != null && averageDaysToPay <= 7 ? 'verde' : 'neutral'
    const label = status === 'amarillo'
      ? 'Administrativo · consumo de la casa'
      : status === 'morado'
        ? worker ? 'Trabajador · datos enlazados con RH · plazo de 15 días hábiles' : 'Trabajador · plazo de 15 días hábiles para pagar'
        : status === 'verde'
          ? 'Buena paga: suele pagar dentro del plazo de 7 días'
          : status === 'rojo'
            ? g.category === 'trabajador' ? 'Trabajador con saldo vencido tras superar 15 días hábiles' : 'Superó el plazo de 7 días: tiene una cuenta morosa'
            : category === 'administrativo' ? 'Administrativo' : 'Sin historial suficiente para clasificar'
    out.push({
      clientKey, name: g.name, category,
      accountCount: g.recs.length,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, x) => s + x.saldo, 0),
      averageDaysToPay, status, label, color: STATUS_COLOR[status],
      phone: worker?.movil ?? '', occupation: worker?.ocupacion ?? '',
      rhLinked: Boolean(worker), workerIdentity: worker?.carnet ?? '', workerBank: worker?.cuentaBancaria ?? '',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Tarjeta de contacto del original (ClientesPanel): fila de llamada
 *  con avatar de 64px, botón de llamada, identidad centrada (nombre,
 *  Móvil, Correo, estado con su punto de color y categoría, ocupación
 *  si es de RH), botón de SMS, banda de enlace con RH, las tres
 *  cifras (Cuentas · Pendientes · Días al pagar) y «Debe ahora» SOLO
 *  si debe algo hoy. El degradado ambiental usa --card-accent con el
 *  color exacto de su estado de pago (account-tinted-card). Tocar la
 *  tarjeta (fuera de los botones) filtra sus cuentas, como en la
 *  copia hasta ahora. Sin teléfono, los botones van deshabilitados,
 *  igual que en el original; con teléfono, llamada y SMS abren las
 *  apps del teléfono (el original prepara el SMS dentro de la app:
 *  esa cola no existe en esta copia). */
function ContactCard({ c, onOpen }: { c: ContactInfo; onOpen: (c: ContactInfo) => void }) {
  const phoneTarget = c.phone.replace(/[^+\d]/g, '')
  const hasPhone = phoneTarget.length > 0
  const catLabel = c.category === 'cliente' ? 'Cliente' : c.category === 'trabajador' ? 'Trabajador' : 'Administrativo'
  return (
    <article
      className="contact-card-oneui account-tinted-card"
      style={{ '--card-accent': c.color } as CSSProperties}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; onOpen(c) }}
      aria-label={`Contacto ${c.name}. Toca para ver sus cuentas.`}
    >
      <div className="contact-call-row">
        <ClientAvatar name={c.name} clientKey={c.clientKey} className="contact-call-avatar" />
        {hasPhone
          ? <a href={`tel:${phoneTarget}`} className="contact-call-button contact-call-button-phone" aria-label={`Llamar a ${c.name} al ${c.phone}`} onClick={(e) => e.stopPropagation()}><Icon name="phone" size={21} /></a>
          : <span className="contact-call-button contact-call-button-disabled" aria-label={`${c.name} no tiene número para llamar`}><Icon name="phone" size={21} /></span>}
        <div className="contact-call-identity">
          <h3 className="contact-call-name">{c.name}</h3>
          <p className="contact-call-number"><span>Móvil</span>{hasPhone ? <a className="contact-call-value" href={`tel:${phoneTarget}`} aria-label={`Llamar a ${c.name} al ${c.phone}`}>{c.phone}</a> : <span className="contact-call-value">Sin número</span>}</p>
          <p className="contact-call-number"><span>Correo</span><span className="contact-call-value">Sin correo</span></p>
          <div className="contact-call-meta">
            <span aria-hidden="true" className="contact-status-dot" style={{ backgroundColor: c.color }} />
            <span>{c.label}</span>
            <span aria-hidden="true">·</span>
            <span>{catLabel}</span>
          </div>
          {c.occupation ? <p className="contact-occupation">{c.occupation}</p> : null}
        </div>
        {hasPhone
          ? <a href={`sms:${phoneTarget}`} className="contact-call-button contact-call-button-sms" aria-label={`Enviar SMS a ${c.name} al ${c.phone}`} onClick={(e) => e.stopPropagation()}><Icon name="message" size={21} /></a>
          : <span className="contact-call-button contact-call-button-disabled" aria-label={`${c.name} no tiene número para enviar SMS`}><Icon name="message" size={21} /></span>}
      </div>
      {c.rhLinked ? (
        <div className="contact-rh-band" aria-label={`Datos de Recursos Humanos enlazados con ${c.name}`}>
          <strong>Enlazado con RH</strong>{c.workerIdentity ? ` · CI ${c.workerIdentity}` : ''}{c.workerBank ? ` · Cuenta ${c.workerBank}` : ''}
        </div>
      ) : null}
      <div className="contact-stats">
        <div className="contact-stat"><strong>{c.accountCount}</strong>Cuentas</div>
        <div className="contact-stat"><strong>{c.pendingCount}</strong>Pendientes</div>
        <div className="contact-stat"><strong>{c.averageDaysToPay == null ? '—' : c.averageDaysToPay}</strong>Días al pagar</div>
      </div>
      {c.pendingAmount > 0 ? <p className="contact-debe">Debe ahora: <strong>{fmtInt(c.pendingAmount)} CUP</strong></p> : null}
    </article>
  )
}

const PERSON_COLORS = ['#0e9f6e', '#0ea5bd', '#3b82f6', '#8b5cf6', '#e9a13b', '#287c5c', '#d64541', '#0b7285']
function personColor(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PERSON_COLORS[h % PERSON_COLORS.length]
}
function initialsOf(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'
}

/* ===== Marcas y vigencia de la tarjeta de cuenta: puerto literal
 *  de vigenciaCuenta y de PAID_MARK / HOUSE_MARK / WORKER_MARK del
 *  original (App.tsx:886-958). El color de vigencia sale de la
 *  fórmula del original: hue 142→0 y lightness 54→48 según el
 *  progreso dentro del plazo (7 días naturales cliente, 15 días
 *  HÁBILES trabajador). ===== */
const PAID_MARK = { color: 'var(--paid)', colorSuave: 'var(--paid-soft)', colorBorde: 'var(--paid-border)', etiqueta: 'Pagada' } as const
const HOUSE_MARK = { color: 'var(--gold)', colorSuave: 'var(--warn-soft)', colorBorde: 'var(--gold)', etiqueta: 'Consumo de la casa', detalle: 'sin vencimiento ni aviso de demora' } as const
const WORKER_MARK = { color: '#7c3aed', colorSuave: 'rgba(124, 58, 237, 0.14)', colorBorde: 'rgba(124, 58, 237, 0.62)' } as const

interface Vigencia {
  progreso: number; vencida: boolean; venceISO: string; diasRestantes: number
  etiqueta: string; detalle: string; color: string; colorSuave: string; colorBorde: string
}

function vigenciaCuenta(desdeISO: string, hoyISO: string, ventanaDias: number): Vigencia {
  const esPlazoTrabajador = ventanaDias === 15
  const venceISO = esPlazoTrabajador ? addBusinessDaysISO(desdeISO, ventanaDias) : addDaysISO(desdeISO, ventanaDias)
  const transcurridos = Math.max(0, esPlazoTrabajador ? businessDaysElapsed(desdeISO, hoyISO) : diffDays(desdeISO, hoyISO))
  const vencida = hoyISO > venceISO
  const progreso = vencida ? 1 : Math.min(1, Math.max(0, transcurridos / ventanaDias))
  const diasRestantes = vencida ? 0 : Math.max(0, diffDays(hoyISO, venceISO))
  const diasDesdeCierre = vencida ? Math.max(0, diffDays(venceISO, hoyISO)) : 0
  const hue = Math.round(142 * (1 - progreso))
  const lightness = Math.round(54 - progreso * 6)
  const color = `hsl(${hue}, 72%, ${lightness}%)`
  const colorSuave = `hsla(${hue}, 72%, 48%, 0.14)`
  const colorBorde = `hsla(${hue}, 72%, 44%, 0.6)`
  const etiqueta = vencida
    ? 'Morosa · plazo vencido'
    : progreso < 0.28
      ? 'Vigente · recién creada'
      : diasRestantes === 0
        ? 'Vence hoy'
        : progreso < 0.62
          ? 'Vigente'
          : progreso < 0.88
            ? 'Vigente · por vencer'
            : 'Vigente · vence pronto'
  const tipoDias = esPlazoTrabajador ? 'días hábiles' : 'días'
  const detalle = vencida
    ? `venció el ${fmtDate(venceISO)} · pasó el plazo de ${ventanaDias} ${tipoDias} hace ${diasDesdeCierre} día${diasDesdeCierre === 1 ? '' : 's'}: pasa a morosa`
    : `vence el ${fmtDate(venceISO)} · quedan ${diasRestantes} día${diasRestantes === 1 ? '' : 's'} naturales · día ${Math.min(transcurridos, ventanaDias) + 1} de ${ventanaDias + 1}${esPlazoTrabajador ? ' hábiles' : ''}`
  return { progreso, vencida, venceISO, diasRestantes, etiqueta, detalle, color, colorSuave, colorBorde }
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
 *  original): «Cuenta creada», cada abono y cada SMS de cobro
 *  enviado, en orden, con el saldo que quedaba tras cada paso. Los
 *  SMS salen de data.smsLogs del respaldo (oleada 2: antes esa
 *  colección se descartaba al importar), enlazados por receivableId
 *  como en el original. El evento de arrastre a nueva quincena sigue
 *  sin aparecer: el ciclo de arrastre no viaja en el respaldo. */
function accountTimeline(rec: Receivable, payments: ReturnType<typeof effectivePayments>, smsLogs: SmsLog[] = []) {
  const original = Math.max(0, rec.originalAmount || rec.amount)
  type Ev = { key: string; date: string; kind: 'creada' | 'abono' | 'sms'; amount?: number; method?: string; local?: boolean; balance: number; order: number }
  let balance = original
  const events: Ev[] = [{ key: `created-${rec.id}`, date: rec.date, kind: 'creada', amount: original, balance, order: 0 }]
  // Un SMS no mueve el saldo: lleva el saldo vigente en su fecha.
  const sortedPays = [...payments].sort((a, b) => a.paidDate.localeCompare(b.paidDate))
  balance = original
  for (const pay of sortedPays) {
    balance = Math.max(0, balance - Math.max(0, pay.amount))
    events.push({ key: `payment-${pay.id}`, date: pay.paidDate, kind: 'abono', amount: pay.amount, method: pay.paymentMethod, local: pay.local, balance, order: 1 })
  }
  const balAfter = (iso: string): number => {
    let b = original
    for (const pay of sortedPays) if (pay.paidDate <= iso) b = Math.max(0, b - Math.max(0, pay.amount))
    return b
  }
  for (const log of smsLogs) {
    const d = String(log.sentAt ?? '').slice(0, 10)
    if (!d) continue
    events.push({ key: `sms-${log.receivableId}-${log.sentAt}`, date: d, kind: 'sms', balance: balAfter(d), order: 3 })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
}

/** Hora legible de un SMS (sentAt ISO del registro real). */
function fmtSmsTime(sentAt: string): string {
  const d = String(sentAt ?? '')
  return d.length >= 16 ? `${fmtDate(d.slice(0, 10))} · ${d.slice(11, 16)}` : fmtDate(d.slice(0, 10))
}

/* Tarjeta de cuenta del original (account-swipe-card): acento de color
   por persona (borde interior izquierdo de 3px), «Debe X de Y», marca
   de antigüedad que envejece con el plazo propio; tocar abre su
   cronología, deslizar → prepara el pago, deslizar ← detalles. */
function AccountCard({ rec, saldo, payments, smsLogs = [], isAdmin, onPay, onReceipt }: {
  rec: Receivable
  saldo: number
  payments: ReturnType<typeof effectivePayments>
  smsLogs?: SmsLog[]
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
  const esCasa = rec.category === 'administrativo' || personaOf(rec.clientKey) !== 'general' || personaOf(rec.client) !== 'general'
  const esTrabajador = rec.category === 'trabajador'
  const vig = vigenciaCuenta(rec.date, ref, esTrabajador ? 15 : 7)
  const morosa = !paid && !esCasa && vig.vencida
  const marca = paid ? PAID_MARK : esCasa ? HOUSE_MARK : vig
  const colorCuenta = paid ? PAID_MARK.color : morosa ? 'var(--danger)' : marca.color
  const bordeTarjeta = paid ? PAID_MARK.colorBorde : morosa ? 'var(--danger)' : marca.colorBorde
  const diasDebe = Math.max(0, diffDays(rec.date, ref))
  const importeOriginal = Math.max(0, rec.originalAmount || rec.amount)
  const abonado = payments.reduce((s, p) => s + Math.max(0, p.amount), 0)
  const lastPay = payments.length ? payments[payments.length - 1]! : null
  const paidDate = rec.paidDate ?? lastPay?.paidDate ?? null
  const chipText = paid ? PAID_MARK.etiqueta : esCasa ? HOUSE_MARK.etiqueta : morosa ? 'Morosa · plazo vencido' : `${esTrabajador ? 'Trabajador · ' : ''}${vig.etiqueta}`
  const markDetalle = paid
    ? `pagó el ${paidDate ? fmtDate(paidDate) : '—'}${lastPay ? ` · por ${lastPay.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo'}` : ''}`
    : esCasa ? HOUSE_MARK.detalle : vig.detalle
  const catChip = esTrabajador
    ? { text: 'Trabajador', style: { color: WORKER_MARK.color, background: WORKER_MARK.colorSuave } as CSSProperties }
    : rec.category === 'administrativo'
      ? { text: 'Administrativo', style: { color: 'var(--gold)', background: HOUSE_MARK.colorSuave } as CSSProperties }
      : { text: 'Cliente', style: { color: 'var(--dim)', background: 'var(--surface-tonal)' } as CSSProperties }

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
      className={`account-card account-tinted-card${morosa ? ' is-morosa' : ''}${paid ? ' is-paid' : ''}`}
      style={{ '--card-accent': colorCuenta, borderColor: bordeTarjeta, boxShadow: `inset 3px 0 0 ${colorCuenta}`, transform: dx ? `translateX(${dx}px)` : undefined } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { startX.current = null; setDx(0) }}
    >
      <button type="button" className="account-main" onClick={onMainClick} aria-expanded={open} aria-label={`${rec.client}: ${paid ? 'cuenta pagada' : `debe ${fmtCUP(saldo)} de ${fmtCUP(importeOriginal)}`}. Toca para ver su cronología.`}>
        {paid ? <ClientAvatar name={rec.client} clientKey={rec.clientKey} /> : null}
        <span className="account-info">
          <span className="acc-name-row">
            <span className="acc-name">{rec.client}</span>
            {rec.origin === 'ipv' ? <span className="acc-badge ipv">Del IPV</span> : <span className="acc-badge manual">Manual</span>}
            <span className="acc-cat-chip" style={catChip.style}>{catChip.text}</span>
          </span>
          <span className="account-sub">{paid
            ? `Debía ${fmtInt(importeOriginal)} desde el ${fmtDate(rec.date)} · se cobró el ${paidDate ? fmtDate(paidDate) : '—'}${lastPay ? ` · ${lastPay.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo'}` : ''}${payments.length > 1 ? ` · en ${payments.length} abonos` : ''}`
            : `${fmtDate(rec.date)} · hace ${diasDebe} día${diasDebe === 1 ? '' : 's'}${rec.detail ? ` · ${rec.detail}` : ''}`}</span>
        </span>
        <span className="acc-amount">
          <span className="acc-amount-big">{fmtInt(paid ? importeOriginal : saldo)} <small>CUP</small></span>
          <span className="acc-amount-sub">{paid ? `Debía ${fmtInt(importeOriginal)}` : `Debe ${fmtInt(saldo)} de ${fmtInt(importeOriginal)}${abonado > 0 ? ` · abonado ${fmtInt(abonado)}` : ''}`}</span>
        </span>
      </button>
      <div className="mark-block" role="img" aria-label={paid ? `Cuenta pagada de ${rec.client}: ${markDetalle}` : esCasa ? `${HOUSE_MARK.etiqueta}: ${HOUSE_MARK.detalle}` : `${chipText}: ${markDetalle}`}>
        <div className="mark-row">
          <span className="mark-chip" style={{ background: paid ? PAID_MARK.colorSuave : morosa ? 'var(--danger-soft)' : marca.colorSuave, borderColor: paid ? PAID_MARK.colorBorde : morosa ? 'var(--danger)' : marca.colorBorde }}>
            <span className="mark-dot" style={{ background: paid ? PAID_MARK.color : morosa ? 'var(--danger)' : marca.color }} />
            {chipText}
          </span>
          <span className="mark-detalle">{markDetalle}</span>
        </div>
        <div className="mark-bar" aria-hidden="true">
          <span className="mark-fill" style={{ width: paid || esCasa ? '100%' : `${Math.round(vig.progreso * 100)}%`, background: paid ? PAID_MARK.color : morosa ? 'var(--danger)' : marca.color }} />
        </div>
      </div>
      {morosa ? (
        smsLogs.length > 0 ? (
          <p className="acc-sms-line">
            <Icon name="message" size={13} /> SMS enviado: {fmtSmsTime(smsLogs[smsLogs.length - 1]!.sentAt)}{smsLogs.length > 1 ? ` · ${smsLogs.length} envíos` : ''}
          </p>
        ) : (
          <p className="acc-sms-none"><Icon name="message" size={13} /> Sin SMS registrado</p>
        )
      ) : null}
      {isAdmin && !paid ? (
        <div className="acc-actions">
          <button type="button" className="btn account-pay-btn" onClick={() => onPay(rec, saldo)}>Abonar</button>
        </div>
      ) : null}
      {open ? (
        <div className="rec-detail" aria-label={`Cronología de la cuenta de ${rec.client}`}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--dim)' }}>Cronología de la cuenta</p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {accountTimeline(rec, payments, smsLogs).map((event, index, all) => (
              <li key={event.key} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', gap: 8, paddingBottom: index < all.length - 1 ? 12 : 0 }}>
                {index < all.length - 1 ? <span aria-hidden="true" style={{ position: 'absolute', left: 5, top: 12, bottom: 0, width: 1, background: 'var(--border)' }} /> : null}
                <span aria-hidden="true" style={{ position: 'relative', zIndex: 1, marginTop: 4, width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--surface)', background: event.kind === 'abono' ? 'var(--paid)' : event.kind === 'sms' ? 'var(--gold)' : 'var(--accent)' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '2px 12px', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{event.kind === 'creada' ? 'Cuenta creada' : event.kind === 'sms' ? 'SMS enviado' : 'Abono'} · {fmtDate(event.date)}</span>
                    <span style={{ fontWeight: 700 }}>Saldo {fmtCUP(event.balance)}</span>
                  </div>
                  <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', fontSize: 11, color: 'var(--dim)' }}>
                    {event.kind === 'creada' ? <span>Importe inicial {fmtCUP(event.amount ?? 0)}</span> : null}
                    {event.kind === 'sms' ? <span>SMS de cobro enviado (registro del respaldo)</span> : null}
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

  const contacts = useMemo<ContactInfo[]>(() => buildContacts(data, ref), [data, ref])
  const [contactQuery, setContactQuery] = useState('')
  const [contactCat, setContactCat] = useState<'todas' | Category>('todas')
  const visibleContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase()
    return contacts.filter((c) =>
      (contactCat === 'todas' || c.category === contactCat) &&
      (!q || c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))))
  }, [contacts, contactQuery, contactCat])
  const openContact = (c: ContactInfo) => { setQuery(c.name); setFilter('pendientes'); setView('cuentas') }

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

  /* Grupos por deudor de la vista de cuentas pendientes/morosas:
     puerto de `gruposPendientes` del original (App.tsx:11990+). En
     el original las pendientes NO se listan sueltas: van agrupadas
     por persona y cada bloque lleva su cabecera con el avatar del
     deudor (`debtorAvatar(grupo.display)`, 48 px por defecto,
     App.tsx:12012), el nombre, «N partidas · desde el … · deuda
     original …» y la marca del grupo (vigenciaGrupo = la vigencia
     de la partida más envejecida). La tarjeta individual pendiente
     del original NO lleva avatar (el de 44 px es solo de la pagada,
     paidItem App.tsx:11669) — por eso el avatar vive aquí, en la
     cabecera, y no dentro de AccountCard. Corrección 3f: la oleada
     3e dejó la lista plana sin esta cabecera y la foto del deudor no
     salía en las cuentas pendientes; Yadir lo detectó en línea. */
  const accountGroups = useMemo(() => {
    if (filter === 'pagadas') return []
    const map = new Map<string, Array<{ rec: Receivable; saldo: number }>>()
    for (const row of accountRows) {
      const arr = map.get(row.rec.clientKey)
      if (arr) arr.push(row)
      else map.set(row.rec.clientKey, [row])
    }
    return [...map.entries()].map(([clientKey, items]) => ({
      clientKey,
      items,
      display: persons.find((p) => p.clientKey === clientKey)?.name ?? items[0]!.rec.client,
      desde: items.reduce((min, x) => (x.rec.date < min ? x.rec.date : min), items[0]!.rec.date),
      totalOriginal: items.reduce((s, x) => s + Math.max(0, x.rec.originalAmount || x.rec.amount), 0),
    }))
  }, [accountRows, filter, persons])

  const renderAccountGroup = (g: (typeof accountGroups)[number]) => {
    const esCasaGrupo = g.items.every(({ rec }) => rec.category === 'administrativo' || personaOf(rec.clientKey) !== 'general' || personaOf(rec.client) !== 'general')
    const esTrabajadorGrupo = !esCasaGrupo && g.items.every(({ rec }) => rec.category === 'trabajador')
    let vigGrupo: Vigencia | null = null
    for (const { rec } of g.items) {
      const v = vigenciaCuenta(rec.date, ref, esTrabajadorGrupo ? 15 : 7)
      if (!vigGrupo || v.progreso > vigGrupo.progreso) vigGrupo = v
    }
    const grupoMorosa = filter === 'morosas'
    const grupoVencida = !esCasaGrupo && !grupoMorosa && Boolean(vigGrupo?.vencida)
    const marcaGrupo: { color: string; colorSuave: string; colorBorde: string } = esCasaGrupo ? HOUSE_MARK : vigGrupo!
    const colorGrupo = grupoMorosa || grupoVencida ? 'var(--danger)' : marcaGrupo.color
    const chipText = esCasaGrupo ? HOUSE_MARK.etiqueta : grupoMorosa ? 'Morosa' : `${esTrabajadorGrupo ? 'Trabajador · ' : ''}${vigGrupo!.etiqueta}`
    const chipDetalle = esCasaGrupo ? HOUSE_MARK.detalle : grupoMorosa ? 'en el Archivo de morosas' : `partida más urgente: ${vigGrupo!.detalle}`
    return (
      <section key={g.clientKey} className="account-group account-tinted-card" style={{ '--card-accent': colorGrupo, borderColor: grupoMorosa || grupoVencida ? 'var(--danger)' : marcaGrupo.colorBorde } as CSSProperties} aria-label={`Cuentas pendientes de ${g.display}`}>
        <div className="account-group-head">
          <ClientAvatar name={g.display} clientKey={g.clientKey} className="account-group-avatar" />
          <div className="account-group-info">
            <h4 className="account-group-name">{g.display}</h4>
            <p className="account-group-sub">{g.items.length} partida{g.items.length === 1 ? '' : 's'} · desde el {fmtDate(g.desde)} · deuda original {fmtCUP(g.totalOriginal)}</p>
            <p className="account-group-mark">
              <span className="mark-chip" style={{ background: grupoMorosa || grupoVencida ? 'var(--danger-soft)' : marcaGrupo.colorSuave, borderColor: grupoMorosa || grupoVencida ? 'var(--danger)' : marcaGrupo.colorBorde }}>
                <span className="mark-dot" style={{ background: colorGrupo }} />
                {chipText}
              </span>
              <span className="account-group-detalle">{chipDetalle}</span>
            </p>
          </div>
        </div>
        <div className="account-list">
          {g.items.map(({ rec, saldo }) => (
            <AccountCard key={rec.id} rec={rec} saldo={saldo} payments={effectivePayments(rec, data.localPayments)} smsLogs={data.smsLogs.filter((l) => String(l.receivableId) === String(rec.id))} isAdmin={isAdmin} onPay={preparePay} onReceipt={setReceiptPreview} />
          ))}
        </div>
      </section>
    )
  }

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
          ) : filter === 'pagadas' ? (
            <div className="account-list">
              {accountRows.map(({ rec, saldo }) => (
                <AccountCard key={rec.id} rec={rec} saldo={saldo} payments={effectivePayments(rec, data.localPayments)} smsLogs={data.smsLogs.filter((l) => String(l.receivableId) === String(rec.id))} isAdmin={isAdmin} onPay={preparePay} onReceipt={setReceiptPreview} />
              ))}
            </div>
          ) : (
            <div className="account-groups">
              {accountGroups.map(renderAccountGroup)}
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

          {data.receivablePhotos.length > 0 ? (
            <Card>
              <h3>Foto de cuentas por día (del respaldo)</h3>
              <p className="sub">
                Las {fmtInt(data.receivablePhotos.length)} fotos contables diarias que trae el respaldo
                (receivablePhotos: no son imágenes, son el resumen de cuentas del IPV de cada día). Última foto:{' '}
                {fmtDate(data.receivablePhotos[data.receivablePhotos.length - 1]!.date)} · total{' '}
                {fmtCUP(data.receivablePhotos[data.receivablePhotos.length - 1]!.total)} en{' '}
                {fmtInt(data.receivablePhotos[data.receivablePhotos.length - 1]!.items.length)} cuentas.
              </p>
              <div className="list">
                {data.receivablePhotos[data.receivablePhotos.length - 1]!.items.map((it, i) => (
                  <div className="row" key={`${it.client}-${i}`}>
                    <span>{it.client}</span>
                    <span className="mono">{fmtCUP(it.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
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
          <div className="contact-search">
            <label htmlFor="buscar-clientes" className="sr-only">Buscar clientes</label>
            <Icon name="search" size={17} className="contact-search-ico" />
            <input id="buscar-clientes" type="search" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o correo" aria-label="Buscar clientes" />
          </div>
          <div className="view-chips" role="group" aria-label="Agrupar personas por categoría" style={{ marginBottom: 12 }}>
            {([['todas', 'Todas'], ['cliente', 'Clientes'], ['trabajador', 'Trabajadores'], ['administrativo', 'Administrativo']] as Array<['todas' | Category, string]>).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={contactCat === id} className={`view-chip${contactCat === id ? ' active' : ''}`} onClick={() => setContactCat(id)}>{label}</button>
            ))}
          </div>
          {contacts.length === 0 ? (
            <Card><EmptyState icon="people" title="Aún no hay clientes" text="Los nombres se guardan automáticamente al aparecer en Cuentas del IPV o al crear una cuenta manual." /></Card>
          ) : visibleContacts.length === 0 ? (
            <Card><EmptyState icon="search" title="Ningún cliente coincide" text="Ningún contacto coincide con esa búsqueda o esa categoría." /></Card>
          ) : (
            <div className="contact-grid">
              {visibleContacts.map((c) => (
                <ContactCard key={c.clientKey} c={c} onOpen={openContact} />
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            La tarjeta muestra solo el total que debe hoy; si saldó todo, no aparece ningún monto. En esta copia, la ficha
            personal del sistema original (teléfono, correo, CI, dirección y notas de los clientes) no viaja en el respaldo:
            el teléfono solo aparece cuando el contacto está enlazado con un trabajador de RH, y el correo se muestra con
            el texto de ausencia del propio original. Editar la ficha, cambiar su foto, fusionar duplicadas y eliminar el
            contacto son acciones del servidor del original y no están en esta copia.
          </p>
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
