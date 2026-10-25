import { useMemo, useState } from 'react'
import type { Category, Receivable, StoredData } from '../types'
import { Card, EmptyState } from '../components/ui'
import {
  CATEGORY_LABEL, CATEGORY_SINGULAR, agingRatio, dueDate, effectivePayments, effectiveSaldo,
  fmtCUP, fmtDate, fmtInt, isMorosa, todayISO,
} from '../lib/utils'

interface PersonGroup {
  clientKey: string
  name: string
  category: Category
  recs: Array<{ rec: Receivable; saldo: number }>
  pendingTotal: number
  morosa: boolean
}

export default function Cuentas({ data }: { data: StoredData }) {
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const ref = todayISO()

  const groups = useMemo<PersonGroup[]>(() => {
    const map = new Map<string, PersonGroup>()
    for (const rec of data.receivables) {
      const saldo = effectiveSaldo(rec, data.localPayments)
      const key = rec.clientKey
      if (!map.has(key)) map.set(key, { clientKey: key, name: rec.client, category: rec.category, recs: [], pendingTotal: 0, morosa: false })
      const g = map.get(key)!
      g.recs.push({ rec, saldo })
      if (rec.status !== 'pagada' && !rec.closeKind && saldo > 0) {
        g.pendingTotal += saldo
        if (isMorosa(rec, saldo, ref)) g.morosa = true
      }
    }
    return [...map.values()].sort((a, b) => b.pendingTotal - a.pendingTotal || a.name.localeCompare(b.name))
  }, [data, ref])

  const pendingOf = (cat?: Category) =>
    data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0 && (!cat || x.rec.category === cat))
  const totalGeneral = pendingOf().reduce((s, x) => s + x.saldo, 0)

  const visible = groups.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))

  if (data.receivables.length === 0) {
    return (
      <div>
        <h1 className="section-title">Cuentas</h1>
        <Card>
          <EmptyState icon="🧾" title="Sin cuentas todavía" text="Las cuentas por cobrar entran con el respaldo del SDA. Sin respaldo importado, esta pantalla queda vacía a propósito." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <h1 className="section-title">Cuentas por cobrar</h1>
      <Card>
        <h3>Totales pendientes</h3>
        <div className="grid-3">
          {(['cliente', 'trabajador', 'administrativo'] as Category[]).map((cat) => (
            <div className="stat" key={cat}>
              <div className="label">{CATEGORY_LABEL[cat]}</div>
              <div className="value">{fmtCUP(pendingOf(cat).reduce((s, x) => s + x.saldo, 0))}</div>
              <div className="hint">{fmtInt(pendingOf(cat).length)} cuentas</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Total general pendiente: <strong>{fmtCUP(totalGeneral)}</strong> · «Dinero en la calle» son solo los clientes:{' '}
          <strong>{fmtCUP(pendingOf('cliente').reduce((s, x) => s + x.saldo, 0))}</strong>. Plazos: clientes 7 días, trabajadores 15 días; vencida = morosa.
        </p>
      </Card>

      <div className="field">
        <input type="search" placeholder="Buscar por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar por nombre" />
      </div>

      {visible.map((g) => (
        <Card key={g.clientKey} className="person-card">
          <button className="person-head" onClick={() => setOpenKey(openKey === g.clientKey ? null : g.clientKey)} aria-expanded={openKey === g.clientKey}>
            <span className="p-name">{g.name}</span>
            {g.pendingTotal > 0 ? <span className="p-total">{fmtCUP(g.pendingTotal)}</span> : <span className="p-total zero">Sin deuda</span>}
          </button>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="chip">{CATEGORY_SINGULAR[g.category]}</span>
            <span className="chip">{fmtInt(g.recs.length)} {g.recs.length === 1 ? 'cuenta' : 'cuentas'}</span>
            {g.morosa ? <span className="chip morosa">Morosa</span> : null}
          </div>
          {openKey === g.clientKey ? (
            <div>
              {g.recs
                .slice()
                .sort((a, b) => a.rec.date.localeCompare(b.rec.date))
                .map(({ rec, saldo }) => {
                  const paid = rec.status === 'pagada' || Boolean(rec.closeKind) || saldo <= 0
                  const morosa = isMorosa(rec, saldo, ref)
                  const due = dueDate(rec)
                  const pays = effectivePayments(rec, data.localPayments)
                  return (
                    <div className="rec-detail" key={rec.id}>
                      <div className="row"><span>Fecha</span><strong>{fmtDate(rec.date)}</strong></div>
                      <div className="row"><span>Importe original</span><strong>{fmtCUP(rec.originalAmount)}</strong></div>
                      {pays.map((p) => (
                        <div className="row" key={p.id}><span>Abono · {fmtDate(p.paidDate)} · {p.paymentMethod || '—'}{p.local ? ' (local)' : ''}</span><strong>− {fmtCUP(p.amount)}</strong></div>
                      ))}
                      <div className="row"><span>Saldo</span><strong>{paid ? 'Pagada' : fmtCUP(saldo)}</strong></div>
                      <div className="row">
                        <span>Estado</span>
                        {paid ? <span className="chip pagada">Pagada</span> : morosa ? <span className="chip morosa">Morosa{due ? ` · venció el ${fmtDate(due)}` : ''}</span> : <span className="chip">Pendiente{due ? ` · vence el ${fmtDate(due)}` : ''}</span>}
                      </div>
                      {!paid && !morosa ? (
                        <div className="age-track" aria-hidden><div className="age-fill" style={{ width: `${Math.max(4, agingRatio(rec, ref) * 100)}%` }} /></div>
                      ) : null}
                      {rec.detail ? <div className="row"><span>Detalle</span><strong>{rec.detail}</strong></div> : null}
                    </div>
                  )
                })}
            </div>
          ) : null}
        </Card>
      ))}
      {visible.length === 0 ? (
        <Card><EmptyState icon="🔎" title="Sin resultados" text="Ninguna tarjeta coincide con esa búsqueda." /></Card>
      ) : null}
    </div>
  )
}
