import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Category, Receivable, SmsLog, StoredData } from '../types'
import { ActionMenu, Card, EmptyState, InfoHelp, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { addLocalPayments, saveReceivables, supabaseConfigured } from '../lib/backend'
import { sbAddCobrarPayments, sbSaveReceivables } from '../lib/supabaseBackend'
import { ClientAvatar } from '../components/MediaImage'
import { deleteMedia, pickClientPhoto, saveMedia, slug, useMediaIndex } from '../lib/media'
import { addDaysISO, canonicalPersonKey, clientKeyOf, diffDays, isBuiltinDistinctPair, personaOf, workerKeyForAccount, workerOfficialIdentity } from '../lib/syncCore.mjs'
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
function ContactCard({ c, onOpen, isAdmin = false, hasPhoto = false, onRename, onPhotoFile, onRemovePhoto }: {
  c: ContactInfo
  onOpen: (c: ContactInfo) => void
  isAdmin?: boolean
  hasPhoto?: boolean
  onRename?: (c: ContactInfo, newName: string) => void
  onPhotoFile?: (c: ContactInfo, file: File) => void
  onRemovePhoto?: (c: ContactInfo) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const photoRef = useRef<HTMLInputElement>(null)
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
      {isAdmin ? (
        <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
          <ActionMenu label={`Acciones de ${c.name}`}>
            <button type="button" onClick={() => { setNewName(c.name); setRenaming(true) }}>
              <Icon name="edit" size={14} /> Editar nombre
            </button>
            <button type="button" onClick={() => photoRef.current?.click()}>
              <Icon name="camera" size={14} /> {hasPhoto ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {hasPhoto ? (
              <button type="button" onClick={() => onRemovePhoto?.(c)}>Quitar foto</button>
            ) : null}
          </ActionMenu>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={`Subir foto de ${c.name}`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhotoFile?.(c, f) }}
          />
        </div>
      ) : null}
      {renaming ? (
        <form
          className="acc-edit-form"
          aria-label={`Renombrar a ${c.name}`}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { onRename?.(c, newName.trim()); setRenaming(false) } }}
        >
          <div className="field"><label htmlFor={`contact-rename-${c.clientKey}`}>Nombre del contacto</label>
            <input id={`contact-rename-${c.clientKey}`} value={newName} onChange={(e) => setNewName(e.target.value)} required maxLength={160} /></div>
          <p className="small muted">El nombre nuevo se aplica a todas sus cuentas; ningún importe cambia.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setRenaming(false)}>Cancelar</button>
            <button type="submit" className="btn primary">Guardar nombre</button>
          </div>
        </form>
      ) : null}
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
function AccountCard({ rec, saldo, payments, smsLogs = [], isAdmin, onPay, onReceipt, onEditAccount, onToggleMorosa, onDeleteAccount, groupedTitle }: {
  groupedTitle?: string
  rec: Receivable
  saldo: number
  payments: ReturnType<typeof effectivePayments>
  smsLogs?: SmsLog[]
  isAdmin: boolean
  onPay: (rec: Receivable, saldo: number) => void
  onReceipt: (r: ReceiptPreview) => void
  onEditAccount: (rec: Receivable, patch: { client: string; originalAmount: number; date: string; category: Category; detail: string }) => void
  onToggleMorosa: (rec: Receivable) => void
  onDeleteAccount: (rec: Receivable) => void
}) {
  const [open, setOpen] = useState(false)
  const [dx, setDx] = useState(0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editClient, setEditClient] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCategory, setEditCategory] = useState<Category>('cliente')
  const [editDetail, setEditDetail] = useState('')
  const startX = useRef<number | null>(null)
  const swiped = useRef(false)
  const ref = todayISO()
  const paid = rec.status === 'pagada' || Boolean(rec.closeKind) || saldo <= 0
  const esCasa = rec.category === 'administrativo' || personaOf(rec.clientKey) !== 'general' || personaOf(rec.client) !== 'general'
  const esTrabajador = rec.category === 'trabajador'
  const vig = vigenciaCuenta(rec.date, ref, esTrabajador ? 15 : 7)
  const marcadaMorosa = Boolean(rec.isMorosa) && !paid && !esCasa
  const morosa = !paid && !esCasa && (vig.vencida || marcadaMorosa)
  const marca = paid ? PAID_MARK : esCasa ? HOUSE_MARK : vig
  const colorCuenta = paid ? PAID_MARK.color : morosa ? 'var(--danger)' : marca.color
  const bordeTarjeta = paid ? PAID_MARK.colorBorde : morosa ? 'var(--danger)' : marca.colorBorde
  const diasDebe = Math.max(0, diffDays(rec.date, ref))
  const importeOriginal = Math.max(0, rec.originalAmount || rec.amount)
  const abonado = payments.reduce((s, p) => s + Math.max(0, p.amount), 0)
  const lastPay = payments.length ? payments[payments.length - 1]! : null
  const paidDate = rec.paidDate ?? lastPay?.paidDate ?? null
  const chipText = paid ? PAID_MARK.etiqueta : esCasa ? HOUSE_MARK.etiqueta : morosa ? (vig.vencida ? 'Morosa · plazo vencido' : 'Morosa · en el Archivo') : `${esTrabajador ? 'Trabajador · ' : ''}${vig.etiqueta}`
  const markDetalle = paid
    ? `pagó el ${paidDate ? fmtDate(paidDate) : '—'}${lastPay ? ` · por ${lastPay.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo'}` : ''}`
    : esCasa ? HOUSE_MARK.detalle : marcadaMorosa && !vig.vencida
      ? `en el Archivo de morosas${rec.morosaSince ? ` desde el ${fmtDate(rec.morosaSince)}` : ''} (marca manual)`
      : vig.detalle
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
            <span className="acc-name">{groupedTitle ?? rec.client}</span>
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
      {isAdmin ? (
        <div className="acc-actions">
          <ActionMenu label={`Acciones de ${rec.client}`}>
            {!paid ? (
              <button type="button" onClick={() => onPay(rec, saldo)}>
                <Icon name="receipt" size={14} /> Registrar pago
              </button>
            ) : null}
            <button type="button" onClick={() => { setEditClient(rec.client); setEditAmount(String(Math.max(0, rec.originalAmount || rec.amount))); setEditDate(rec.date); setEditCategory(rec.category); setEditDetail(rec.detail ?? ''); setEditing(true); setConfirmDelete(false) }}>
              <Icon name="edit" size={14} /> Editar cuenta
            </button>
            {!paid && !esCasa ? (
              <button type="button" onClick={() => onToggleMorosa(rec)}>
                {rec.isMorosa ? 'Volver a Cobrar' : 'Mover a morosas'}
              </button>
            ) : null}
            <button type="button" className="danger" onClick={() => { setConfirmDelete(true); setEditing(false) }}>
              <Icon name="trash" size={14} /> Eliminar cuenta
            </button>
          </ActionMenu>
        </div>
      ) : null}
      {editing ? (
        <form
          className="acc-edit-form"
          aria-label={`Editar la cuenta de ${rec.client}`}
          onSubmit={(e) => {
            e.preventDefault()
            const amount = Number(editAmount)
            if (!editClient.trim() || !Number.isFinite(amount) || amount < 0 || !editDate) return
            onEditAccount(rec, { client: editClient.trim(), originalAmount: amount, date: editDate, category: editCategory, detail: editDetail.trim() })
            setEditing(false)
          }}
        >
          <div className="field"><label htmlFor={`acc-edit-client-${rec.id}`}>Nombre</label>
            <input id={`acc-edit-client-${rec.id}`} value={editClient} onChange={(e) => setEditClient(e.target.value)} required maxLength={160} /></div>
          <div className="field"><label htmlFor={`acc-edit-amount-${rec.id}`}>Importe original (CUP)</label>
            <input id={`acc-edit-amount-${rec.id}`} type="number" min="0" step="any" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} required /></div>
          <div className="field"><label htmlFor={`acc-edit-date-${rec.id}`}>Fecha de la cuenta</label>
            <input id={`acc-edit-date-${rec.id}`} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor={`acc-edit-cat-${rec.id}`}>Categoría</label>
            <select id={`acc-edit-cat-${rec.id}`} value={editCategory} onChange={(e) => setEditCategory(e.target.value as Category)}>
              <option value="cliente">Cliente</option><option value="trabajador">Trabajador</option><option value="administrativo">Administrativo</option>
            </select></div>
          <div className="field"><label htmlFor={`acc-edit-detail-${rec.id}`}>Detalle</label>
            <input id={`acc-edit-detail-${rec.id}`} value={editDetail} onChange={(e) => setEditDetail(e.target.value)} maxLength={300} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
            <button type="submit" className="btn primary">Guardar cambios</button>
          </div>
        </form>
      ) : null}
      {confirmDelete ? (
        <div className="inventory-confirm is-danger" role="alertdialog" aria-label={`Eliminar la cuenta de ${rec.client}`}>
          <p><strong>¿Eliminar la cuenta de {rec.client} del {fmtDate(rec.date)}?</strong> Se quitará por completo de Cobrar.</p>
          <div className="inventory-confirm-actions">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            <button type="button" className="btn btn-danger-solid" onClick={() => { setConfirmDelete(false); onDeleteAccount(rec) }}>Sí, eliminar</button>
          </div>
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

export default function Cobrar({ data, isAdmin, onChanged, initialView = 'cuentas' }: {
  data: StoredData
  isAdmin: boolean
  onChanged: () => void
  initialView?: CobrarView
}) {
  const [view, setView] = useState<CobrarView>(initialView)
  const [filter, setFilter] = useState<AccountFilter>('pendientes')
  const [catFilter, setCatFilter] = useState<'todas' | Category>('todas')
  const [query, setQuery] = useState('')
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

  // --- Acciones de contacto (D-10): renombrar y foto, como en el
  //  original. La ficha personal (teléfono/correo/CI/dirección/notas)
  //  no viaja en el respaldo, así que no hay campos que editar aquí;
  //  eliminar el contacto no se ofrece: en esta copia el contacto se
  //  DERIVA de las cuentas (en el original, al borrarlo, el sistema
  //  reconstruye su ficha básica desde ellas: esa es aquí su forma
  //  permanente). ---
  const { items: clientPhotoItems } = useMediaIndex('foto-cliente')
  const contactHasPhoto = (c: ContactInfo) => Boolean(pickClientPhoto(clientPhotoItems, c.name))
  const renameContact = (c: ContactInfo, newName: string) => {
    const key = clientKeyOf(newName)
    const next = data.receivables.map((r) => (r.clientKey === c.clientKey ? { ...r, client: newName, clientKey: key } : r))
    void persistReceivables(next, [], `Contacto «${c.name}» ahora es «${newName}»: sus cuentas quedan bajo el nombre nuevo, sin tocar un importe.`)
  }
  const contactPhotoFile = async (c: ContactInfo, file: File) => {
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('No se pudo leer esa foto.'))
        reader.readAsDataURL(file)
      })
      const dataBase64 = dataUrl.split(',')[1] ?? ''
      if (!dataBase64) throw new Error('No se pudo leer esa foto. Prueba con JPG, PNG o WebP.')
      await saveMedia({ kind: 'foto-cliente', entityKey: slug(c.name), label: `Foto de ${c.name}`, mime: file.type || 'image/jpeg', dataBase64 })
      setMessage(`Foto de «${c.name}» guardada. Volverá a salir cuando esta persona tenga otra cuenta.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la foto.')
    }
  }
  const removeContactPhoto = async (c: ContactInfo) => {
    const item = pickClientPhoto(clientPhotoItems, c.name)
    if (!item) return
    setError(null)
    try {
      await deleteMedia('foto-cliente', item.entity_key, item.variant)
      setMessage(`Foto de «${c.name}» quitada: se muestra el avatar por defecto.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo quitar la foto.')
    }
  }

  // --- Fusión de tarjetas duplicadas (original, ClientesPanel): las
  //  cuentas de cada persona duplicada pasan a su tarjeta canónica
  //  (en trabajadores manda la enlazada a RH) SIN tocar un importe, y
  //  se verifica todo antes de guardar: si los totales no cuadran,
  //  no se aplica nada. «Nelson gordo» es otra persona: los pares
  //  distintos de fábrica nunca se fusionan. ---
  interface MergeGroupReport { canonicalName: string; mergedFrom: string[]; accountsBefore: number; accountsAfter: number; pendingBefore: number; pendingAfter: number; matches: boolean }
  const [mergeReport, setMergeReport] = useState<{ message: string; groups: MergeGroupReport[]; totals: { accounts: number; pending: number; paid: number; calle: number } } | null>(null)
  const [merging, setMerging] = useState(false)
  const totalsOf = (recs: Receivable[]) => {
    let pending = 0
    let paid = 0
    let calle = 0
    for (const r of recs) {
      const saldo = effectiveSaldo(r, data.localPayments)
      paid += effectivePayments(r, data.localPayments).reduce((s, p) => s + Math.max(0, p.amount), 0)
      if (r.status !== 'pagada' && !r.closeKind && saldo > 0) {
        pending += saldo
        if (r.category === 'cliente') calle += saldo
      }
    }
    return { accounts: recs.length, pending, paid, calle }
  }
  const runMergeDuplicates = async () => {
    setMerging(true)
    setError(null)
    try {
      const byCanonical = new Map<string, Receivable[]>()
      for (const r of data.receivables) {
        const key = canonicalPersonKey(null, r.client)
        const arr = byCanonical.get(key) ?? []
        arr.push(r)
        byCanonical.set(key, arr)
      }
      const before = totalsOf(data.receivables)
      const next = [...data.receivables]
      const groups: MergeGroupReport[] = []
      const skipped: string[] = []
      for (const recs of byCanonical.values()) {
        const keys = [...new Set(recs.map((r) => r.clientKey))]
        if (keys.length < 2) continue
        let distinctPair = false
        for (let i = 0; i < keys.length && !distinctPair; i++) for (let j = i + 1; j < keys.length; j++) if (isBuiltinDistinctPair(keys[i]!, keys[j]!)) distinctPair = true
        if (distinctPair) { skipped.push(recs[0]!.client); continue }
        // Canónica: la identidad oficial de RH si alguna tarjeta es de
        // un trabajador; si no, la tarjeta con más cuentas.
        let canonicalKey = keys[0]!
        let canonicalName = recs.find((r) => r.clientKey === canonicalKey)?.client ?? ''
        for (const r of recs) {
          const official = workerOfficialIdentity(r.client, data.workers)
          if (official) { canonicalKey = official.key; canonicalName = official.display; break }
        }
        if (!workerOfficialIdentity(canonicalName, data.workers)) {
          const counts = new Map<string, number>()
          for (const r of recs) counts.set(r.clientKey, (counts.get(r.clientKey) ?? 0) + 1)
          canonicalKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
          canonicalName = recs.find((r) => r.clientKey === canonicalKey)?.client ?? canonicalName
        }
        const groupPendingBefore = recs.reduce((s, r) => s + Math.max(0, effectiveSaldo(r, data.localPayments)), 0)
        const mergedFrom = [...new Set(recs.filter((r) => r.clientKey !== canonicalKey).map((r) => r.client))]
        for (let i = 0; i < next.length; i++) {
          if (recs.includes(next[i]!)) next[i] = { ...next[i]!, client: canonicalName, clientKey: canonicalKey }
        }
        const afterRecs = next.filter((r) => r.clientKey === canonicalKey && recs.some((o) => o.id === r.id))
        const groupPendingAfter = afterRecs.reduce((s, r) => s + Math.max(0, effectiveSaldo(r, data.localPayments)), 0)
        groups.push({
          canonicalName,
          mergedFrom,
          accountsBefore: recs.length,
          accountsAfter: afterRecs.length,
          pendingBefore: groupPendingBefore,
          pendingAfter: groupPendingAfter,
          matches: groupPendingBefore === groupPendingAfter && recs.length === afterRecs.length,
        })
      }
      if (!groups.length) {
        setMergeReport({ message: skipped.length ? `No hay tarjetas duplicadas que fusionar. Se respetaron como personas distintas: ${skipped.join(', ')}.` : 'No hay tarjetas duplicadas que fusionar: cada persona tiene una sola tarjeta.', groups: [], totals: before })
        return
      }
      const after = totalsOf(next)
      const cuadra = groups.every((g) => g.matches) && after.accounts === before.accounts && after.pending === before.pending && after.paid === before.paid && after.calle === before.calle
      if (!cuadra) {
        setError('La verificación de la fusión NO cuadró: no se aplicó ningún cambio.')
        return
      }
      if (SB_MODE) await sbSaveReceivables(next, [])
      else saveReceivables(next)
      setMergeReport({ message: `Fusión aplicada y verificada: ${groups.length} persona${groups.length === 1 ? '' : 's'} con tarjetas duplicadas quedaron en una sola tarjeta, sin tocar un importe.`, groups, totals: after })
      setMessage('Tarjetas duplicadas fusionadas y verificadas: los totales cuadran.')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ejecutar la fusión de tarjetas.')
    } finally {
      setMerging(false)
    }
  }

  const pendingOf = (cat?: Category) =>
    data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0 && (!cat || x.rec.category === cat))
  const dineroCalle = pendingOf('cliente').reduce((s, x) => s + x.saldo, 0)

  const accountRows = useMemo(() => {
    const rows = data.receivables.map((rec) => ({ rec, saldo: effectiveSaldo(rec, data.localPayments) }))
    const q = query.trim().toLowerCase()
    const named = q ? rows.filter((x) => x.rec.client.toLowerCase().includes(q)) : rows
    const byCat = catFilter === 'todas' ? named : named.filter((x) => x.rec.category === catFilter)
    if (filter === 'pagadas') {
      return byCat
        .filter((x) => x.rec.status === 'pagada' || Boolean(x.rec.closeKind) || x.saldo <= 0)
        .sort((a, b) => (b.rec.paidDate ?? b.rec.date).localeCompare(a.rec.paidDate ?? a.rec.date))
    }
    const pend = byCat.filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
    if (filter === 'morosas') return pend.filter((x) => isMorosa(x.rec, x.saldo, ref)).sort((a, b) => a.rec.date.localeCompare(b.rec.date))
    return pend.sort((a, b) => a.rec.date.localeCompare(b.rec.date))
  }, [data, filter, catFilter, query, ref])

  /* Conteos de las filas de píldoras del original: vista
     (pendientes/morosas con su total) y categoría (total
     pendiente y conteo por categoría). */
  const pendientesAll = pendingOf()
  const morosasAll = pendientesAll.filter((x) => isMorosa(x.rec, x.saldo, ref))
  const morosasTotal = morosasAll.reduce((s, x) => s + x.saldo, 0)
  const pagadasCount = data.receivables.filter((r) => r.status === 'pagada' || Boolean(r.closeKind)).length
  const calleMorosas = pendingOf('cliente').filter((x) => isMorosa(x.rec, x.saldo, ref)).reduce((s, x) => s + x.saldo, 0)
  const calleCobrar = dineroCalle - calleMorosas
  const catChipData = (key: 'todas' | Category) => {
    const rows = key === 'todas' ? data.receivables : data.receivables.filter((r) => r.category === key)
    const total = pendingOf(key === 'todas' ? undefined : key).reduce((s, x) => s + x.saldo, 0)
    return { count: rows.length, total }
  }

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
            {(() => {
              const contacto = contacts.find((c) => c.clientKey === g.clientKey)
              return contacto?.rhLinked ? (
                <p className="account-group-rh">
                  <strong>RH enlazado</strong>{contacto.occupation ? ` · ${contacto.occupation}` : ''}{contacto.phone ? ` · ${contacto.phone}` : ''}
                </p>
              ) : null
            })()}
          </div>
        </div>
        <div className="account-list">
          {g.items.map(({ rec, saldo }) => {
            const refSufijo = /[-–]\s*(.+)$/.exec(rec.client)?.[1]?.trim()
            const tituloPartida = refSufijo && rec.client !== g.display ? refSufijo : `Partida del ${fmtDate(rec.date)}`
            return (
              <AccountCard key={rec.id} rec={rec} saldo={saldo} payments={effectivePayments(rec, data.localPayments)} smsLogs={data.smsLogs.filter((l) => String(l.receivableId) === String(rec.id))} isAdmin={isAdmin} onPay={preparePay} onReceipt={setReceiptPreview} onEditAccount={editAccount} onToggleMorosa={toggleMorosa} onDeleteAccount={deleteAccount} groupedTitle={tituloPartida} />
            )
          })}
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

  // Acciones de la tarjeta (ActionMenu del original): editar, mover a
  //  morosas / volver, eliminar — persisten la lista completa de
  //  cuentas (local: saveReceivables; Supabase: sbSaveReceivables con
  //  la cola offline; los borrados van declarados, nunca inferidos).
  const persistReceivables = async (next: Receivable[], deletedIds: string[], okMsg: string) => {
    setBusy(true)
    setError(null)
    try {
      if (SB_MODE) await sbSaveReceivables(next, deletedIds)
      else saveReceivables(next)
      setMessage(okMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio en la cuenta.')
    } finally {
      setBusy(false)
    }
  }
  const editAccount = (rec: Receivable, patch: { client: string; originalAmount: number; date: string; category: Category; detail: string }) => {
    const next = data.receivables.map((r) => (r.id === rec.id
      ? { ...r, client: patch.client, clientKey: clientKeyOf(patch.client), originalAmount: patch.originalAmount, amount: patch.originalAmount, date: patch.date, category: patch.category, detail: patch.detail }
      : r))
    void persistReceivables(next, [], `Cuenta de «${patch.client}» actualizada.`)
  }
  const toggleMorosa = (rec: Receivable) => {
    const toMorosa = !rec.isMorosa
    const next = data.receivables.map((r) => (r.id === rec.id ? { ...r, isMorosa: toMorosa, morosaSince: toMorosa ? ref : null } : r))
    void persistReceivables(next, [], toMorosa
      ? `«${rec.client}» movida al Archivo de morosas: sigue debiendo, no se pagó ni se olvidó.`
      : `«${rec.client}» volvió a Cobrar.`)
  }
  const deleteAccount = (rec: Receivable) => {
    void persistReceivables(data.receivables.filter((r) => r.id !== rec.id), [rec.id], `Cuenta de «${rec.client}» eliminada.`)
  }

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

  /* Fila de secciones del original: una sola fila desplazable
     de píldoras, la activa en verde oscuro relleno y «Clientes»
     con su conteo. Sin iconos. */
  const cuentasTitle = filter === 'morosas' ? 'Cuentas morosas' : 'Cobrar'
  const sectionTabs = (
    <div className="chips-row" role="tablist" aria-label="Cobrar y clientes" style={{ marginTop: 12 }}>
      <button type="button" role="tab" aria-selected={view === 'cuentas'} className={`chip ${view === 'cuentas' ? 'chip-active' : 'chip-idle'}`} onClick={() => setView('cuentas')}>Cuentas</button>
      <button type="button" role="tab" aria-selected={view === 'clientes'} className={`chip ${view === 'clientes' ? 'chip-active' : 'chip-idle'}`} onClick={() => setView('clientes')}>Clientes · {fmtInt(persons.length)}</button>
      <button type="button" role="tab" aria-selected={view === 'entidades'} className={`chip ${view === 'entidades' ? 'chip-active' : 'chip-idle'}`} onClick={() => setView('entidades')}>Entidades</button>
      <button type="button" role="tab" aria-selected={view === 'comprobantes'} className={`chip ${view === 'comprobantes' ? 'chip-active' : 'chip-idle'}`} onClick={() => setView('comprobantes')}>Comprobantes</button>
    </div>
  )

  return (
    <div>
      <TabHeader icon="wallet" title="Cobrar" desc="Cuentas por cobrar y dinero en la calle" badge={TAB_BADGES.cobrar} />

      {view === 'cuentas' ? (
        <>
          <div className="section-big-title" style={{ marginTop: 16 }}>
            <span className="sbt-ico"><Icon name="wallet" size={24} /></span>
            <h2>{cuentasTitle}</h2>
            <InfoHelp label={filter === 'morosas' ? 'Cómo funcionan las morosas' : 'Cómo funciona Cobrar'}>
              {filter === 'morosas'
                ? 'Los clientes tienen 7 días para pagar y los trabajadores 15 días hábiles, porque suelen saldar el día hábil 16. Al superar su propio plazo, la cuenta se ve en rojo: sigue incluida en «Todas pendientes» y también aparece aquí, en «Morosas». Las cuentas de Daya/Dayami, Alejandro y Jesús son consumo de la casa: nunca entran aquí ni se marcan en rojo.'
                : 'Saldo restante en cada cuenta: «Debe X de Y». Pago parcial o total, en efectivo o por transferencia. Cada cuenta del IPV es una partida con su fecha: el «ok» en Observaciones paga solo esa cuenta concreta de ese día, no las demás de la misma persona. Los clientes tienen 7 días naturales y los trabajadores 15 días hábiles. En ambos casos, la cuenta nace en verde claro y su color avanza hacia rojo durante el plazo que le corresponde; si no se paga al terminarlo, pasa automáticamente a morosa. Las cuentas de Daya/Dayami, Alejandro y Jesús son consumo de la casa y permanecen amarillas, sin vencimiento. Las ya pagadas se ven en azul.'}
            </InfoHelp>
          </div>
          {sectionTabs}

          <div className="cobrar-legend" role="img" aria-label="Leyenda: clientes con plazo de 7 días, trabajadores con plazo de 15 días hábiles, consumo de la casa siempre amarillo y pagadas en azul" style={{ marginTop: 12 }}>
            <div className="cobrar-legend-row">
              <span className="cobrar-legend-item"><span aria-hidden="true" className="cobrar-legend-dot" style={{ backgroundColor: 'hsl(142, 72%, 54%)' }} />Recién creada</span>
              <span className="cobrar-legend-note">Cliente 7 días · trabajador 15 hábiles →</span>
              <span className="cobrar-legend-item"><span aria-hidden="true" className="cobrar-legend-dot" style={{ backgroundColor: 'var(--danger)' }} />Plazo superado · morosa</span>
              <span className="cobrar-legend-item"><span aria-hidden="true" className="cobrar-legend-dot" style={{ backgroundColor: HOUSE_MARK.color }} />Casa · siempre amarillo</span>
              <span className="cobrar-legend-item"><span aria-hidden="true" className="cobrar-legend-dot" style={{ backgroundColor: PAID_MARK.color }} />Pagada</span>
            </div>
            <div className="cobrar-legend-bar" aria-hidden="true" />
            <p className="cobrar-legend-text">Clientes y trabajadores cambian de verde a rojo según la parte de su plazo que ya pasó: 7 días naturales para clientes y 15 días hábiles para trabajadores. Al superar su fecha, pasan a morosas. Daya/Dayami, Alejandro y Jesús permanecen amarillos. Las pagadas se marcan en azul.</p>
          </div>

          <div className="chips-row" role="group" aria-label="Vista de cuentas" style={{ marginTop: 12 }}>
            <button type="button" aria-pressed={filter === 'pendientes'} className={`chip ${filter === 'pendientes' ? 'chip-active' : 'chip-idle'}`} onClick={() => setFilter('pendientes')}>Todas pendientes · {fmtInt(pendientesAll.length)}</button>
            <button type="button" aria-pressed={filter === 'morosas'} className={`chip ${filter === 'morosas' ? 'chip-active' : 'chip-idle'}`} onClick={() => setFilter('morosas')}>Morosas · {fmtInt(morosasAll.length)} · {fmtCUP(morosasTotal)}</button>
            <button type="button" aria-pressed={filter === 'pagadas'} className={`chip ${filter === 'pagadas' ? 'chip-active' : 'chip-idle'}`} onClick={() => setFilter('pagadas')}>Pagadas · {fmtInt(pagadasCount)}</button>
          </div>

          <div className="chips-row" role="group" aria-label="Agrupar cuentas por categoría" style={{ marginTop: 4 }}>
            {([['todas', 'Todas'], ['cliente', 'Clientes'], ['trabajador', 'Trabajadores'], ['administrativo', 'Administrativo']] as Array<['todas' | Category, string]>).map(([key, label]) => {
              const d = catChipData(key)
              return (
                <button key={key} type="button" aria-pressed={catFilter === key} className={`chip ${catFilter === key ? 'chip-active' : 'chip-idle'}`} onClick={() => setCatFilter(key)}>
                  {label} · {fmtCUP(d.total)} · {fmtInt(d.count)}
                </button>
              )
            })}
          </div>

          <div className="calle-card" aria-label="Dinero en la calle" style={{ marginTop: 12 }}>
            <p className="calle-title">Dinero en la calle</p>
            <p className="calle-amount">{fmtInt(dineroCalle)} <span>CUP</span></p>
            <p className="calle-break">En Cobrar {fmtCUP(calleCobrar)} · Clientes en morosas {fmtCUP(calleMorosas)}</p>
            <p className="calle-note">Solo cuentas de clientes. Las cuentas de trabajadores y administrativas no entran en este total.</p>
            <div className="calle-details-grid">
              {([['Clientes', 'cliente'], ['Trabajadores', 'trabajador'], ['Administrativo', 'administrativo']] as Array<[string, Category]>).map(([label, cat]) => {
                const rows = pendingOf(cat)
                const total = rows.reduce((s, x) => s + x.saldo, 0)
                return (
                  <details key={cat} className="calle-details">
                    <summary>{label}: {fmtCUP(total)}</summary>
                    {rows.length ? (
                      <ul>{rows.map((x) => <li key={`${x.rec.origin}-${x.rec.id}`}>{x.rec.client}: <strong>{fmtCUP(x.saldo)}</strong></li>)}</ul>
                    ) : (
                      <p className="calle-empty">Sin cuentas pendientes.</p>
                    )}
                  </details>
                )
              })}
            </div>
          </div>

          <div className="cobrar-search" style={{ marginTop: 16 }}>
            <label htmlFor="cobrar-buscar">Buscar cuenta por nombre</label>
            <input id="cobrar-buscar" aria-label="Buscar cuenta por nombre" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query.trim() ? <p className="cobrar-search-status" role="status">Mostrando las cuentas que coinciden con «{query.trim()}» en la pestaña activa.</p> : null}
          </div>

          {data.receivables.length === 0 ? (
            <Card><EmptyState icon="receipt" title="Sin cuentas todavía" text="Las cuentas por cobrar entran con el respaldo del SDA. Sin respaldo importado, esta vista queda vacía a propósito." /></Card>
          ) : accountRows.length === 0 ? (
            <Card><EmptyState icon="search" title="Nada en esta vista" text={query ? 'Ninguna cuenta coincide con esa búsqueda en este filtro.' : filter === 'morosas' ? 'No hay cuentas morosas: ninguna pendiente pasó su plazo.' : filter === 'pagadas' ? 'Todavía no hay cuentas pagadas en el respaldo.' : 'No hay cuentas pendientes.'} /></Card>
          ) : filter === 'pagadas' ? (
            <div className="account-list">
              {accountRows.map(({ rec, saldo }) => (
                <AccountCard key={rec.id} rec={rec} saldo={saldo} payments={effectivePayments(rec, data.localPayments)} smsLogs={data.smsLogs.filter((l) => String(l.receivableId) === String(rec.id))} isAdmin={isAdmin} onPay={preparePay} onReceipt={setReceiptPreview} onEditAccount={editAccount} onToggleMorosa={toggleMorosa} onDeleteAccount={deleteAccount} />
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
          <div className="section-big-title" style={{ marginTop: 16 }}>
            <span className="sbt-ico"><Icon name="people" size={24} /></span>
            <h2>Clientes</h2>
          </div>
          {sectionTabs}
          <div className="contact-search" style={{ marginTop: 12 }}>
            <label htmlFor="buscar-clientes" className="sr-only">Buscar clientes</label>
            <Icon name="search" size={17} className="contact-search-ico" />
            <input id="buscar-clientes" type="search" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o correo" aria-label="Buscar clientes" />
          </div>
          <div className="view-chips" role="group" aria-label="Agrupar personas por categoría" style={{ marginBottom: 12 }}>
            {([['todas', 'Todas'], ['cliente', 'Clientes'], ['trabajador', 'Trabajadores'], ['administrativo', 'Administrativo']] as Array<['todas' | Category, string]>).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={contactCat === id} className={`view-chip${contactCat === id ? ' active' : ''}`} onClick={() => setContactCat(id)}>{label}</button>
            ))}
          </div>
          {isAdmin ? (
            <Card className="merge-card">
              <p style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}><Icon name="people" size={17} /> Tarjetas duplicadas</p>
              <p className="small muted" style={{ margin: 0 }}>
                Si una persona quedó con dos tarjetas (nombre corto y nombre completo de RH), se fusionan en una sola:
                en trabajadores manda la tarjeta enlazada a RH, todas las cuentas pasan a ella sin tocar ningún importe
                y al terminar se verifica todo — totales antes y después y el dinero en la calle. Si la verificación no
                cuadra, no se aplica nada. <strong>«Nelson gordo» es otra persona</strong> y nunca se fusiona con Nelson/Nelsito.
              </p>
              <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={merging} onClick={() => void runMergeDuplicates()}>
                {merging ? 'Fusionando y verificando…' : 'Fusionar duplicadas y verificar montos'}
              </button>
              {mergeReport ? (
                <div role="status" aria-label="Resultado de la fusión y su verificación" style={{ marginTop: 10 }}>
                  <p className="small" style={{ margin: 0 }}>{mergeReport.message}</p>
                  {mergeReport.groups.map((g) => (
                    <p key={g.canonicalName} className="small muted" style={{ margin: '6px 0 0' }}>
                      <strong>{g.canonicalName}</strong> ← {g.mergedFrom.join(' + ')} · Cuentas {g.accountsBefore} → {g.accountsAfter} · Pendiente {fmtCUP(g.pendingBefore)} → {fmtCUP(g.pendingAfter)} ·{' '}
                      <strong style={{ color: g.matches ? 'var(--paid)' : 'var(--danger)' }}>{g.matches ? 'Cuadra ✓' : 'NO cuadra'}</strong>
                    </p>
                  ))}
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    Totales tras la fusión: {fmtInt(mergeReport.totals.accounts)} cuentas · pendiente {fmtCUP(mergeReport.totals.pending)} · abonado {fmtCUP(mergeReport.totals.paid)} · dinero en la calle {fmtCUP(mergeReport.totals.calle)}.
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}
          {contacts.length === 0 ? (
            <Card><EmptyState icon="people" title="Aún no hay clientes" text="Los nombres se guardan automáticamente al aparecer en Cuentas del IPV o al crear una cuenta manual." /></Card>
          ) : visibleContacts.length === 0 ? (
            <Card><EmptyState icon="search" title="Ningún cliente coincide" text="Ningún contacto coincide con esa búsqueda o esa categoría." /></Card>
          ) : (
            <div className="contact-grid">
              {visibleContacts.map((c) => (
                <ContactCard key={c.clientKey} c={c} onOpen={openContact} isAdmin={isAdmin} hasPhoto={contactHasPhoto(c)} onRename={renameContact} onPhotoFile={(cc, f) => void contactPhotoFile(cc, f)} onRemovePhoto={(cc) => void removeContactPhoto(cc)} />
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            La tarjeta muestra solo el total que debe hoy; si saldó todo, no aparece ningún monto. En esta copia, la ficha
            personal del sistema original (teléfono, correo, CI, dirección y notas de los clientes) no viaja en el respaldo:
            el teléfono solo aparece cuando el contacto está enlazado con un trabajador de RH, y el correo se muestra con
            el texto de ausencia del propio original. El contacto se deriva de las cuentas: por eso no se elimina aquí —
            en el original, al eliminarlo, el sistema reconstruye su ficha básica desde las cuentas que queden.
          </p>
        </>
      ) : null}

      {view === 'comprobantes' ? (
        <>
          <div className="section-big-title" style={{ marginTop: 16 }}>
            <span className="sbt-ico"><Icon name="receipt" size={24} /></span>
            <h2>Comprobantes de pago</h2>
          </div>
          {sectionTabs}
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
          <div className="section-big-title" style={{ marginTop: 16 }}>
            <span className="sbt-ico"><Icon name="wallet" size={24} /></span>
            <h2>Entidades</h2>
            <InfoHelp label="Cómo funcionan las entidades">Servicios prestados a empresas e instituciones que no pagan en efectivo, sino por movimientos bancarios. Cada servicio queda pendiente aquí hasta que el banco hace el movimiento: entonces tocas «Registrar cobro bancario» y escribes la fecha y la referencia del movimiento. No son cuentas de clientes: no vencen a los 7 días, no pasan a morosas y no entran en «Dinero en la calle».</InfoHelp>
          </div>
          {sectionTabs}
          <Card>
            <EmptyState icon="grid" title="Sin entidades en esta copia" text="Las entidades (servicios a instituciones con cobro bancario) llegan con su propia fase del sistema externo. No se muestra ningún servicio inventado." />
          </Card>
        </>
      ) : null}
    </div>
  )
}
