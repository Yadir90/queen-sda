import { useMemo, useState, type FormEvent } from 'react'
import type { ExtraIncome, StoredData } from '../types'
import { ActionMenu, Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { saveExtraIncomes, supabaseConfigured } from '../lib/backend'
import { sbSaveExtraIncomes } from '../lib/supabaseBackend'
import { printHtml } from '../lib/download'
import { BRAND_CUNO_URL } from '../lib/brandAssets'
import '../components/sectionsMirror.css'

const SB_MODE = supabaseConfigured()

/* Otros ingresos: espejo del ExtrasTab del original (App.tsx:9785).
   Dos fuentes reales, una sola cifra (la de Economía y el boletín):
   (1) los extras que viajan dentro de cada día del respaldo
   (DayData.extras, la hoja «Entrada y mesas» del IPV: cobro de
   entrada, alquiler de mesas…) y (2) el registro manual de esta
   copia — el registro del original vive en su servidor y no viaja
   en el respaldo; aquí se guarda en app_settings 'extra-incomes'
   (o en el StoredData local), como las fichas de Elaboración, y
   alimenta Economía, Inicio y la reconciliación del IPV de vuelta
   con la misma regla del original. Las categorías son las cuatro
   del original (Coctelería, Pizzería, Entrada, Mesas) con su misma
   regla de clasificación por el texto del concepto; las ventas de
   coctelería y pizzería del IPV viven como departamentos (Cantina y
   Pizzas) dentro de las ventas del día y NO se duplican aquí.
   La factura del mes se genera con el constructor de documentos
   (documentosCore.extrasInvoiceHtml) y se abre como vista de
   impresión/PDF, como los demás documentos de esta copia. */

type ExtraCat = 'cocteleria' | 'pizzeria' | 'entrada' | 'mesas'
const CAT_LABEL: Record<ExtraCat, string> = { cocteleria: 'Coctelería', pizzeria: 'Pizzería', entrada: 'Entrada', mesas: 'Mesas' }
const CAT_ORDER: ExtraCat[] = ['cocteleria', 'pizzeria', 'entrada', 'mesas']

/** Misma heurística del original (extraIncomeCategory). */
function extraCategory(concepto: string): ExtraCat {
  const text = concepto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  if (/coctel|cantina|trago/.test(text)) return 'cocteleria'
  if (/pizza/.test(text)) return 'pizzeria'
  if (/mesa/.test(text)) return 'mesas'
  return 'entrada'
}

interface ExtraRow { date: string; concepto: string; importe: number; cat: ExtraCat; source: 'ipv' | 'manual'; manual?: ExtraIncome }

interface Draft { date: string; concept: string; amount: string; method: 'efectivo' | 'transferencia'; note: string }
const emptyDraft = (): Draft => ({ date: todayISO(), concept: '', amount: '', method: 'efectivo', note: '' })

export default function ExtrasTab({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of data.days) set.add(d.date.slice(0, 7))
    for (const x of data.extraIncomes) set.add(x.date.slice(0, 7))
    return [...set].sort().reverse()
  }, [data.days, data.extraIncomes])
  const [monthKey, setMonthKey] = useState('')
  const activeMonth = monthKey || months[0] || ''
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editing, setEditing] = useState<ExtraIncome | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ExtraIncome | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const allRows = useMemo<ExtraRow[]>(
    () => [
      ...data.days.flatMap((d) => (d.extras ?? []).map((x) => ({
        date: d.date, concepto: x.concepto, importe: x.importe, cat: extraCategory(x.concepto), source: 'ipv' as const,
      }))),
      ...data.extraIncomes.map((x) => ({
        date: x.date, concepto: x.concept, importe: x.amount, cat: extraCategory(x.concept), source: 'manual' as const, manual: x,
      })),
    ],
    [data.days, data.extraIncomes],
  )
  const rows = useMemo(
    () => allRows.filter((r) => r.date.startsWith(activeMonth)).sort((a, b) => b.date.localeCompare(a.date)),
    [allRows, activeMonth],
  )
  const total = rows.reduce((s, r) => s + r.importe, 0)
  const sections = useMemo(
    () => CAT_ORDER.map((key) => {
      const catRows = rows.filter((r) => r.cat === key)
      return { key, title: CAT_LABEL[key], rows: catRows, total: catRows.reduce((s, r) => s + r.importe, 0) }
    }),
    [rows],
  )

  const persist = async (next: ExtraIncome[], okMsg: string) => {
    setBusy(true); setError(''); setMsg('')
    try {
      if (SB_MODE) await sbSaveExtraIncomes(next)
      else saveExtraIncomes(next)
      setMsg(okMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el ingreso.')
    } finally { setBusy(false) }
  }

  const submitForm = (ev: FormEvent) => {
    ev.preventDefault()
    const amount = Number(draft.amount)
    if (!draft.concept.trim() || !draft.date || !Number.isFinite(amount) || amount <= 0) return
    if (editing) {
      const updated: ExtraIncome = { ...editing, date: draft.date, concept: draft.concept.trim(), amount, paymentMethod: draft.method, note: draft.note.trim() }
      setEditing(null); setShowForm(false); setDraft(emptyDraft())
      void persist(data.extraIncomes.map((x) => (x.id === editing.id ? updated : x)), 'Ingreso actualizado.')
    } else {
      const item: ExtraIncome = {
        id: `extra-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        date: draft.date, concept: draft.concept.trim(), amount,
        paymentMethod: draft.method, note: draft.note.trim(), origin: 'manual',
      }
      setShowForm(false); setDraft(emptyDraft())
      void persist([...data.extraIncomes, item], 'Ingreso registrado: ya suma en Otros ingresos, en Economía y en el IPV de vuelta de su fecha.')
    }
  }

  const openInvoice = async () => {
    const { buildExtrasInvoiceData, extrasInvoiceHtml, withStampImage } = await import('../lib/documentosCore.mjs')
    const rep = buildExtrasInvoiceData(data, activeMonth)
    if (!rep.rows.length) { setError('Este mes no tiene otros ingresos que facturar.'); return }
    setError('')
    if (!printHtml(withStampImage(extrasInvoiceHtml(rep), BRAND_CUNO_URL))) setError('El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
  }

  return (
    <div>
      <TabHeader
        icon="plus"
        title="Otros ingresos"
        desc="Dinero que entra sin ser venta de productos: los cobros de entrada y alquiler de mesas de la hoja «Entrada y mesas» del IPV aparecen aquí solos, y lo que se registra a mano también. Todo suma en su propia línea del Resultado."
        badge={TAB_BADGES.extras}
      />

      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}
      {error ? <div className="error-box" style={{ marginBottom: 14 }}>{error}</div> : null}

      {months.length > 1 ? (
        <div className="view-chips" role="group" aria-label="Mes de los otros ingresos">
          {months.map((m) => (
            <button key={m} type="button" className={`view-chip ${m === activeMonth ? 'active' : ''}`} aria-pressed={m === activeMonth} onClick={() => setMonthKey(m)}>
              {fmtDate(`${m}-01`).replace(/^\d+ de /, '').replace(' de ', ' ')}
            </button>
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" className="btn primary" onClick={() => { setEditing(null); setDraft(emptyDraft()); setShowForm((v) => !v); setMsg('') }}>
            <Icon name="plus" size={16} /> Registrar otro ingreso
          </button>
          <button type="button" className="btn" onClick={() => void openInvoice()}>
            <Icon name="doc" size={16} /> Factura del mes
          </button>
        </div>
      ) : null}

      {showForm && isAdmin ? (
        <Card>
          <form onSubmit={submitForm}>
            <h3>{editing ? 'Editar ingreso' : 'Registrar otro ingreso'}</h3>
            <div className="field"><label htmlFor="extra-date">Fecha</label>
              <input id="extra-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></div>
            <div className="field"><label htmlFor="extra-concept">Concepto</label>
              <input id="extra-concept" value={draft.concept} onChange={(e) => setDraft({ ...draft, concept: e.target.value })} required maxLength={200} placeholder="Ej.: Alquiler de mesas" /></div>
            <div className="field"><label htmlFor="extra-amount">Importe (CUP)</label>
              <input id="extra-amount" type="number" min="0" step="any" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required /></div>
            <div className="field"><label htmlFor="extra-method">Método</label>
              <select id="extra-method" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as Draft['method'] })}>
                <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
              </select></div>
            <div className="field"><label htmlFor="extra-note">Nota</label>
              <input id="extra-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={300} /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => { setShowForm(false); setEditing(null) }}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={busy || !draft.concept.trim() || !(Number(draft.amount) > 0)}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar ingreso'}</button>
            </div>
          </form>
        </Card>
      ) : null}

      {allRows.length === 0 ? (
        <EmptyState
          icon="plus"
          title="Sin otros ingresos registrados"
          text="Ningún día importado tuvo cobros en la hoja «Entrada y mesas» de su IPV y no hay ingresos registrados a mano. Sin registro real, la pantalla queda vacía."
        />
      ) : (
        <>
          <Card>
            <p className="eyebrow">Otros ingresos del mes</p>
            <div className="big-figure">{fmtCUP(total)}</div>
            <p className="small muted" style={{ margin: 0 }}>
              {fmtInt(rows.length)} registro{rows.length === 1 ? '' : 's'} · línea «Otros ingresos: +{fmtCUP(total)}» en el Resultado
            </p>
          </Card>

          <div className="grid-2 mod-cat-grid">
            {sections.map((s) => (
              <Card key={s.key}>
                <div className="mod-cat-head">
                  <h3>{s.title}</h3>
                  <strong>{fmtCUP(s.total)}</strong>
                </div>
                {s.rows.length === 0 ? (
                  <p className="small muted" style={{ margin: 0 }}>Sin registros en este mes.</p>
                ) : (
                  <div className="list">
                    {s.rows.map((r, i) => (
                      <div className="row" key={`${r.date}-${r.concepto}-${i}`}>
                        <span className="mod-row-main">
                          <span className="mod-row-title">{r.concepto}</span>
                          <span className="small muted">{fmtDate(r.date)} · {r.source === 'ipv' ? 'del IPV' : 'registrado a mano'}</span>
                        </span>
                        <strong>{fmtCUP(r.importe)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>

          <Card>
            <h3>Todos los registros del mes</h3>
            <div className="list">
              {rows.map((r, i) => (
                <div className="row" key={`${r.date}-${r.concepto}-${i}`}>
                  <span className="mod-row-main">
                    <span className="mod-row-title">{r.concepto} · {fmtCUP(r.importe)}</span>
                    <span className="small muted">{fmtDate(r.date)} · {CAT_LABEL[r.cat]} · {r.source === 'ipv' ? 'detectado del IPV' : `registrado a mano · ${r.manual?.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo'}${r.manual?.note ? ` · ${r.manual.note}` : ''}`}</span>
                  </span>
                  {r.source === 'ipv' || !isAdmin ? (
                    <span className="chip">{r.source === 'ipv' ? 'Del IPV' : 'Registrado'}</span>
                  ) : (
                    <ActionMenu label={`Acciones de ${r.concepto}`}>
                      <button type="button" onClick={() => { const m = r.manual!; setEditing(m); setDraft({ date: m.date, concept: m.concept, amount: String(m.amount), method: m.paymentMethod, note: m.note }); setShowForm(true); setConfirmDelete(null) }}>
                        <Icon name="edit" size={14} /> Editar
                      </button>
                      <button type="button" className="danger" onClick={() => setConfirmDelete(r.manual!)}>
                        <Icon name="trash" size={14} /> Eliminar
                      </button>
                    </ActionMenu>
                  )}
                </div>
              ))}
            </div>
            {confirmDelete ? (
              <div className="inventory-confirm is-danger" role="alertdialog" aria-label={`Eliminar el ingreso ${confirmDelete.concept}`}>
                <p><strong>¿Eliminar «{confirmDelete.concept}» ({fmtCUP(confirmDelete.amount)})?</strong> Dejará de sumar en Otros ingresos y en Economía.</p>
                <div className="inventory-confirm-actions">
                  <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                  <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => { const target = confirmDelete; setConfirmDelete(null); void persist(data.extraIncomes.filter((x) => x.id !== target.id), 'Ingreso eliminado.') }}>Sí, eliminar</button>
                </div>
              </div>
            ) : null}
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Los ingresos del IPV no se editan aquí: son la foto del archivo importado. Los registrados a mano
              viven en el sistema y se agregan solos al IPV de vuelta de su fecha.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
