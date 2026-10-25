import { useMemo, useState } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState } from '../components/ui'
import { addLocalPayments, supabaseConfigured } from '../lib/backend'
import { sbAddCobrarPayments } from '../lib/supabaseBackend'
import { effectiveSaldo, fmtCUP, fmtDate, todayISO } from '../lib/utils'

const SB_MODE = supabaseConfigured()

interface PersonPending {
  clientKey: string
  name: string
  total: number
}

export default function Cobrar({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
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
        // Modo Supabase: el abono se inserta en payments (RLS: solo admin) y
        // al refrescar vuelve como capa sobre el saldo del respaldo.
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

  if (!isAdmin) {
    return (
      <div>
        <h1 className="section-title">Cobrar</h1>
        <Card>
          <EmptyState icon="🔒" title="Solo lectura" text="Tu perfil es de solo lectura: puedes ver las cuentas, pero registrar abonos es una acción del administrador." />
        </Card>
      </div>
    )
  }

  if (data.receivables.length === 0) {
    return (
      <div>
        <h1 className="section-title">Cobrar</h1>
        <Card>
          <EmptyState icon="🧾" title="Sin cuentas todavía" text="Cuando se importe el respaldo del SDA, aquí podrás registrar abonos sobre las cuentas reales." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <h1 className="section-title">Cobrar</h1>
      <Card>
        <h2>Registrar un abono</h2>
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
            <label htmlFor="cb-method">Método</label>
            <select id="cb-method" value={method} onChange={(e) => setMethod(e.target.value as 'efectivo' | 'transferencia')}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cb-date">Fecha del abono</label>
          <input id="cb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {!confirming ? (
          <button className="btn primary block" onClick={submit}>Revisar abono</button>
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
      </Card>

      {data.localPayments.length > 0 ? (
        <Card>
          <h3>{SB_MODE ? 'Abonos registrados (en el servidor)' : 'Abonos registrados en este dispositivo'}</h3>
          <p className="sub">{SB_MODE
            ? 'Guardados en Supabase (tabla payments): se aplican como capa sobre el saldo del respaldo y se ven en todos los dispositivos.'
            : 'Capa local sobre los datos importados; se conservan aunque se reimporte el respaldo.'}</p>
          {data.localPayments.slice().reverse().map((p) => {
            const rec = data.receivables.find((r) => r.id === p.receivableId)
            return (
              <div className="list-row" key={p.id}>
                <span className="grow">{rec?.client ?? p.clientKey}<span className="muted">Cuenta del {rec ? fmtDate(rec.date) : '—'} · {p.method}</span></span>
                <strong>{fmtCUP(p.amount)}</strong>
              </div>
            )
          })}
        </Card>
      ) : null}
    </div>
  )
}
