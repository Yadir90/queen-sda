import { useMemo, useState } from 'react'
import type { PayrollEmployee, StoredData, Worker } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { effectiveSaldo, fmtCUP, fmtDate, fmtDateShort, fmtInt, todayISO } from '../lib/utils'
import { saveRhSettings, supabaseConfigured } from '../lib/backend'
import { sbSaveRhSettings } from '../lib/supabaseBackend'
import {
  addDaysISO, buildMarksByWorker, canonicalPersonKey, cycleIndexFor, cycleWindow,
  deriveCyclePayroll, diffDays, isDirectionPerson, recordedPayroll,
} from '../lib/syncCore.mjs'
import '../components/sectionsMirror.css'

/* RH · Pagos — puerto del módulo de RH del sistema original:
   - Ciclos exactos de 15 días desde el ancla configurable (def.
     2026-09-23); el pago cae el día 16. La quincena de RH NO es la
     quincena natural de Contabilidad.
   - La nómina de cada ciclo se lee de la foto de RH del IPV de cierre
     (o del historial registrado, que manda; o del ajuste manual del
     dueño, que manda sobre la foto). El salario nunca se asume del
     ciclo anterior.
   - Pago mixto efectivo/transferencia con la regla del original:
     efectivo + transferencia = total a cobrar de cada quien.
   - Interruptor «No pagado»: la persona sale de la nómina y del
     total; su importe queda visible como excluido.
   - Dirección (Jesús, Dayami): ficha informativa, fuera de nómina.
   - Cuadrados del mes y de la quincena con la clave exacta de la
     especificación: lleno trabajó · medio tono medio día · gris
     descanso · punteado aún sin foto · borde dorado hoy.
   PORT LITERAL (rasero del dueño, 25-oct): la cabecera del ciclo es
   la tarjeta verde profundo de RHTab del original (Inicio / Fin
   día 15 / Pago día 16 en dorado, estado y «faltan N días»), la
   tabla lleva su columna «Salario diario», el banner «Ciclo
   cerrado / Ciclo abierto», el aviso de pago con 0 días y la banda
   verde de total con su desglose efectivo/transferencia — clases
   .rh-hero/.rh-total de sectionsMirror.css con los valores del
   original. Diferencia honesta: la «A» en ámbar de ausencia
   justificada sale del registro de trabajadores del original, que
   no viaja en el respaldo; aquí no se pinta ninguna «A». */

const SB_MODE = supabaseConfigured()

type DerivedEmployee = ReturnType<typeof deriveCyclePayroll>['employees'][number]

function fmtDias(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

function RhSquares({
  marks, dates, today, showNumbers = true,
}: {
  marks: Record<string, number> | undefined
  dates: string[]
  today: string
  showNumbers?: boolean
}) {
  return (
    <div className="rh-squares" role="img" aria-label="Días trabajados">
      {dates.map((f) => {
        const v = marks?.[f]
        const dayNum = Number(f.slice(8, 10))
        let cls = 'rh-sq'
        let label = ''
        if (v == null) { cls += ' is-none'; label = 'aún sin foto' }
        else if (v >= 1) { cls += ' is-full'; label = 'trabajó' }
        else if (v > 0) { cls += ' is-half'; label = 'medio día' }
        else { cls += ' is-rest'; label = 'descanso' }
        if (f === today) cls += ' is-today'
        if (f > today) cls += ' is-future'
        return (
          <span key={f} className={cls} title={`${fmtDate(f)} — ${label}`}>
            {showNumbers ? dayNum : ''}
          </span>
        )
      })}
    </div>
  )
}

const SQUARES_LEGEND = 'Cuadrados del mes: lleno trabajó · medio tono, medio día · gris descanso · punteado aún sin foto · borde dorado, hoy. (En el original la «A» en ámbar marca ausencias justificadas del registro de trabajadores; ese registro no viaja en el respaldo, así que aquí no se pinta ninguna «A».)'

function monthDates(yearMonth: string): { dates: string[]; lead: number } {
  const [y, m] = yearMonth.split('-').map(Number)
  const count = new Date(y, m, 0).getDate()
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const dates: string[] = []
  for (let d = 1; d <= count; d++) dates.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  return { dates, lead }
}

export default function RHScreen({
  data, isAdmin, onChanged,
}: {
  data: StoredData
  isAdmin: boolean
  onChanged: () => void
}) {
  const today = todayISO()
  const anchor = data.anchorDate || '2026-09-23'
  const currentIdx = cycleIndexFor(anchor, today)
  const [cycleIdx, setCycleIdx] = useState<number | null>(null)
  const idx = cycleIdx ?? currentIdx
  const win = cycleWindow(anchor, idx)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PayrollEmployee[]>([])
  const [editError, setEditError] = useState<string | null>(null)
  const [anchorDraft, setAnchorDraft] = useState(anchor)
  const [busy, setBusy] = useState(false)

  const marks = useMemo(() => buildMarksByWorker(data.days) as Record<string, Record<string, number>>, [data.days])
  const recorded = recordedPayroll(data.payrollHistory, win.start)
  const adjustment = data.payrollAdjustments[win.start] ?? null
  const derived = useMemo(
    () => deriveCyclePayroll(data.days, win.start, { adjustment, unpaidKeys: data.unpaidWorkers }),
    [data.days, win.start, adjustment, data.unpaidWorkers],
  )
  const prevWin = cycleWindow(anchor, idx - 1)
  const prevRecorded = recordedPayroll(data.payrollHistory, prevWin.start)
  const prevDerived = useMemo(
    () => deriveCyclePayroll(data.days, prevWin.start, { adjustment: data.payrollAdjustments[prevWin.start] ?? null, unpaidKeys: data.unpaidWorkers }),
    [data.days, prevWin.start, data.payrollAdjustments, data.unpaidWorkers],
  )
  const prevTotal = prevRecorded ? prevRecorded.total : prevDerived.total

  const persist = async (patch: Parameters<typeof saveRhSettings>[0]) => {
    setBusy(true)
    try {
      if (SB_MODE) await sbSaveRhSettings(patch)
      else saveRhSettings(patch)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const toggleUnpaid = (key: string) => {
    const has = data.unpaidWorkers.includes(key)
    const next = has ? data.unpaidWorkers.filter((k) => k !== key) : [...data.unpaidWorkers, key]
    void persist({ unpaidWorkers: next })
  }

  const cycleStatus = today > win.payDate
    ? 'Pago vencido'
    : today === win.payDate
      ? '¡Hoy es día de pago!'
      : diffDays(today, win.payDate) <= 3
        ? 'Pago cercano'
        : 'En curso'
  const daysToPay = diffDays(today, win.payDate)

  const tableEmployees: Array<{
    key: string; nombre: string; ocupacion: string; dias: number; salarioDiario: number
    totalCobrar: number; pagoEfectivo: number; pagoTransferencia: number; direccion: boolean; noPagado: boolean
  }> = recorded
    ? recorded.employees.map((e) => ({
        key: canonicalPersonKey(null, e.nombre),
        ...e,
        direccion: isDirectionPerson(e.nombre),
        noPagado: data.unpaidWorkers.includes(canonicalPersonKey(null, e.nombre)),
      }))
    : (derived.employees as DerivedEmployee[])

  const cycleReceivables = (key: string) =>
    data.receivables.filter((r) => canonicalPersonKey(r.clientKey, r.client) === key && r.date >= win.start && r.date <= win.end)

  const selectedWorker: Worker | null = data.workers.find((w) => w.key === selectedKey) ?? null
  const monthOfToday = today.slice(0, 7)
  const { dates: monthDateList, lead } = monthDates(monthOfToday)
  const cycleDates: string[] = []
  for (let i = 0; i < 15; i++) cycleDates.push(addDaysISO(win.start, i))

  const startEdit = () => {
    setDraft(
      (derived.employees as DerivedEmployee[])
        .filter((e) => !e.direccion)
        .map((e) => ({
          nombre: e.nombre, ocupacion: e.ocupacion, dias: e.dias, salarioDiario: e.salarioDiario,
          totalCobrar: e.totalCobrar, pagoEfectivo: e.pagoEfectivo, pagoTransferencia: e.pagoTransferencia,
          carnet: e.carnet, cuentaBancaria: e.cuentaBancaria, movil: e.movil,
        })),
    )
    setEditError(null)
    setEditing(true)
  }

  const saveEdit = () => {
    const bad = draft.find((e) => Math.round(e.pagoEfectivo) + Math.round(e.pagoTransferencia) !== Math.round(e.totalCobrar))
    if (bad) {
      setEditError(`En ${bad.nombre}, efectivo + transferencia deben sumar el total a cobrar (${fmtCUP(bad.totalCobrar)}).`)
      return
    }
    void persist({ payrollAdjustment: { cycleStart: win.start, employees: draft } }).then(() => setEditing(false))
  }

  const draftTotal = draft.reduce((s, e) => s + (data.unpaidWorkers.includes(canonicalPersonKey(null, e.nombre)) ? 0 : e.totalCobrar), 0)
  const sinDias = !recorded
    ? (derived.employees as DerivedEmployee[]).filter((e) => !e.direccion && e.totalCobrar > 0 && e.dias === 0)
    : []

  return (
    <div>
      <TabHeader icon="people" title="RH · Pagos" desc="Trabajadores, ciclos de 15 días y nómina" badge={TAB_BADGES.rh} />

      {/* Cabecera de ciclo del original (RHTab): tarjeta verde profundo
          con Inicio / Fin (día 15) / Pago (día 16, en dorado) y el estado. */}
      <div className="rh-hero">
        <div className="rh-hero-nav">
          <button type="button" className="btn" onClick={() => setCycleIdx(idx - 1)} aria-label="Ciclo anterior">← Anterior</button>
          <p className="rh-hero-title">Ciclo {fmtDate(win.start)} — {fmtDate(win.end)}</p>
          <button type="button" className="btn" onClick={() => setCycleIdx(idx + 1)} aria-label="Ciclo siguiente">Siguiente →</button>
        </div>
        <div className="rh-hero-grid">
          <div><p>Inicio</p><strong>{fmtDate(win.start)}</strong></div>
          <div><p>Fin (día 15)</p><strong>{fmtDate(win.end)}</strong></div>
          <div className="is-pay"><p>Pago (día 16)</p><strong>{fmtDate(win.payDate)}</strong></div>
        </div>
        <p className="rh-hero-status">
          {today >= win.start && today <= win.payDate
            ? daysToPay > 0
              ? <>Faltan <strong>{daysToPay} día{daysToPay === 1 ? '' : 's'}</strong> para el pago · {cycleStatus}</>
              : <strong>{cycleStatus}</strong>
            : cycleStatus === 'Pago vencido' && idx === currentIdx
              ? 'Este ciclo ya cerró; revisa el siguiente.'
              : `Estado: ${cycleStatus}`}
        </p>
        {idx !== currentIdx ? (
          <p className="rh-hero-back"><button type="button" className="btn" onClick={() => setCycleIdx(null)}>Volver al ciclo actual</button></p>
        ) : null}
      </div>

      <section className="card">
        <table className="kv" style={{ marginTop: 0 }}>
          <tbody>
            <tr>
              <td>{recorded ? 'Total pagado (registrado)' : 'Total a pagar del ciclo'}</td>
              <td>{fmtCUP(recorded ? recorded.total : derived.total)}</td>
            </tr>
            {!recorded && derived.excludedTotal > 0 ? (
              <tr><td>Excluido por «No pagado»</td><td>{fmtCUP(derived.excludedTotal)}</td></tr>
            ) : null}
            <tr>
              <td>Ciclo anterior</td>
              <td>{fmtCUP(prevTotal)}{prevTotal > 0 && (recorded ? recorded.total : derived.total) > 0
                ? ` · diferencia ${fmtCUP((recorded ? recorded.total : derived.total) - prevTotal)}`
                : ''}</td>
            </tr>
            <tr>
              <td>Fuente de la nómina</td>
              <td>{recorded
                ? 'Historial registrado'
                : adjustment
                  ? 'Ajuste manual (manda sobre la foto)'
                  : derived.photoDate
                    ? `Foto de RH del IPV del ${fmtDate(derived.photoDate)}`
                    : 'Sin foto de RH en este ciclo'}</td>
            </tr>
          </tbody>
        </table>
        <p className="small muted">
          Los ciclos de RH son de 15 días exactos desde el ancla y se pagan el día 16; no son la quincena
          natural del mes de Contabilidad. El salario de cada ciclo se lee de la RH del IPV de cierre de
          ese ciclo, nunca del anterior.
        </p>
        {isAdmin ? (
          <div className="rh-anchor">
            <label htmlFor="rh-anchor">Ancla de los ciclos</label>
            <input id="rh-anchor" type="date" value={anchorDraft} onChange={(e) => setAnchorDraft(e.target.value)} />
            <button type="button" className="btn" disabled={busy || anchorDraft === anchor} onClick={() => void persist({ anchorDate: anchorDraft })}>
              Guardar ancla
            </button>
          </div>
        ) : null}
      </section>

      {/* Nómina del ciclo */}
      <section className="card">
        <h3 className="font-display">Nómina del ciclo</h3>
        {recorded ? (
          <p className="small muted">Nómina registrada en el historial: se pagó el {fmtDate(recorded.payDate)} a {fmtInt(recorded.workersCount)} trabajadores.</p>
        ) : derived.photoDate || adjustment ? (
          <p className="small muted">
            Nómina derivada {adjustment ? 'del ajuste manual' : `de la foto de RH del IPV del ${fmtDate(derived.photoDate!)}`}.
            {isAdmin ? ' Puedes corregir días, totales y el desglose efectivo/transferencia: el ajuste queda guardado y manda sobre la foto.' : ''}
          </p>
        ) : (
          <p className="small muted">Todavía no hay foto de RH importada dentro de este ciclo: la nómina aparecerá sola al importar el IPV de un día del ciclo.</p>
        )}
        {/* Banner del original: ciclo cerrado o abierto */}
        {recorded || derived.photoDate ? (
          win.end < today ? (
            <p className="small" style={{ background: 'var(--surface-tonal)', borderRadius: 16, padding: '8px 12px' }}>
              <strong>Ciclo cerrado.</strong> Las cifras de abajo son el cierre: cuánto se pagó a cada trabajador, por cuántos días y a cuánto por día. El pago correspondía al {fmtDate(win.payDate)}.
            </p>
          ) : (
            <p className="small muted" style={{ background: 'var(--surface-tonal)', borderRadius: 16, padding: '8px 12px' }}>
              <strong style={{ color: 'var(--text)' }}>Ciclo abierto.</strong> Esto es lo acumulado hasta la foto{derived.photoDate ? ` del ${fmtDate(derived.photoDate)}` : ''}: sigue sumando día a día hasta el cierre del {fmtDate(win.end)} y se paga el {fmtDate(win.payDate)}.
            </p>
          )
        ) : null}
        {sinDias.length > 0 ? (
          <div className="error-box" role="alert" style={{ marginBottom: 10 }}>
            Con pago asignado y 0 días trabajados: {sinDias.map((e) => e.nombre).join(', ')}. Revísalo en tu Excel.
          </div>
        ) : null}
        {tableEmployees.length > 0 ? (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr>
                  <th>Trabajador</th><th>Días</th><th>Salario diario</th><th>Total</th><th>Efectivo</th><th>Transferencia</th>
                  {isAdmin && !recorded ? <th>No pagado</th> : null}
                </tr>
              </thead>
              <tbody>
                {tableEmployees.map((e) => (
                  <tr key={e.key} className={e.direccion ? 'is-direccion' : e.noPagado ? 'is-nopagado' : ''}>
                    <td>
                      <button type="button" className="rh-name" onClick={() => setSelectedKey(e.key)}>{e.nombre}</button>
                      {e.ocupacion ? <span className="small muted"> · {e.ocupacion}</span> : null}
                      {e.direccion ? <span className="chip">Dirección · fuera de nómina</span> : null}
                      {e.noPagado ? <span className="chip">No pagado</span> : null}
                    </td>
                    <td>{fmtDias(e.dias)}</td>
                    <td>{fmtCUP(e.salarioDiario)}</td>
                    <td>{fmtCUP(e.totalCobrar)}</td>
                    <td>{fmtCUP(e.pagoEfectivo)}</td>
                    <td>{fmtCUP(e.pagoTransferencia)}</td>
                    {isAdmin && !recorded ? (
                      <td>
                        {!e.direccion ? (
                          <button
                            type="button"
                            className={`btn ${e.noPagado ? '' : 'primary'}`}
                            disabled={busy}
                            onClick={() => toggleUnpaid(e.key)}
                          >
                            {e.noPagado ? 'Reincluir' : 'No pagado'}
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tableEmployees.length > 0 ? (() => {
          const incluidos = tableEmployees.filter((e) => !e.direccion && !e.noPagado)
          const totalBanda = recorded ? recorded.total : incluidos.reduce((s2, e) => s2 + e.totalCobrar, 0)
          const efBanda = incluidos.reduce((s2, e) => s2 + e.pagoEfectivo, 0)
          const trBanda = incluidos.reduce((s2, e) => s2 + e.pagoTransferencia, 0)
          return (
            <div className="rh-total">
              <span className="t-label">{win.end < today ? <>Total pagado en el cierre · pago del {fmtDate(win.payDate)}</> : <>Acumulado hasta la foto · total a pagar el {fmtDate(win.payDate)}</>}</span>
              <span>
                <span className="t-value">{fmtCUP(totalBanda)}</span>
                {trBanda > 0 ? <span className="t-split">Efectivo {fmtCUP(efBanda)} · Transferencia {fmtCUP(trBanda)}</span> : null}
              </span>
            </div>
          )
        })() : null}
        {isAdmin && !recorded && (derived.photoDate || adjustment) ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={startEdit}>Editar nómina del ciclo</button>
            {adjustment ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void persist({ payrollAdjustment: { cycleStart: win.start, employees: null } })}>
                Restablecer a la foto del IPV
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Editor de nómina (ajuste manual) */}
      {editing ? (
        <section className="card">
          <h3 className="font-display">Ajuste de la nómina del ciclo</h3>
          <p className="small muted">Efectivo + transferencia deben sumar el total a cobrar de cada quien. El ajuste manda sobre la foto del IPV y queda guardado por ciclo.</p>
          {editError ? <div className="error-box">{editError}</div> : null}
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr><th>Trabajador</th><th>Días</th><th>Total a cobrar</th><th>Efectivo</th><th>Transferencia</th></tr>
              </thead>
              <tbody>
                {draft.map((e, i) => (
                  <tr key={e.nombre}>
                    <td>{e.nombre}</td>
                    <td>
                      <input type="number" min={0} step="0.5" value={e.dias} aria-label={`Días de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, dias: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.totalCobrar} aria-label={`Total de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, totalCobrar: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.pagoEfectivo} aria-label={`Efectivo de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, pagoEfectivo: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.pagoTransferencia} aria-label={`Transferencia de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, pagoTransferencia: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">Total del ajuste (sin «No pagado»): <strong>{fmtCUP(draftTotal)}</strong></p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={saveEdit}>Guardar ajuste</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </section>
      ) : null}

      {/* Historial de nóminas */}
      <section className="card">
        <h3 className="font-display">Historial de nóminas</h3>
        {data.payrollHistory.length === 0 ? (
          <p className="small muted">Sin nóminas registradas todavía. Llegan con el respaldo del sistema o al registrarse un pago.</p>
        ) : (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead><tr><th>Ciclo</th><th>Día de pago</th><th>Trabajadores</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {data.payrollHistory.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateShort(p.cycleStart)} – {fmtDate(p.cycleEnd)}</td>
                    <td>{fmtDate(p.payDate)}</td>
                    <td>{fmtInt(p.workersCount)}</td>
                    <td>{fmtCUP(p.total)}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => setCycleIdx(cycleIndexFor(anchor, p.cycleStart))}>Ver ciclo</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Registro de trabajadores */}
      <section className="card">
        <h3 className="font-display">Trabajadores ({fmtInt(data.workers.length)})</h3>
        <p className="small muted">Registro único: las variantes de nombre de los IPV se unifican en una sola ficha. Toca un nombre para ver su ficha, sus cuadrados y sus cuentas del ciclo.</p>
        <div className="rh-workers">
          {data.workers.map((w) => {
            const worked = Object.entries(marks[w.key] ?? {})
              .filter(([f]) => f >= win.start && f <= win.end)
              .reduce((s, [, v]) => s + v, 0)
            return (
              <button key={w.key} type="button" className={`rh-worker ${selectedKey === w.key ? 'active' : ''}`} onClick={() => setSelectedKey(w.key)}>
                <span className="rh-worker-name">{w.nombre}</span>
                <span className="small muted">{w.roleKind === 'direccion' ? 'Dirección' : w.ocupacion || 'Sin ocupación'} · {fmtDias(worked)} días en el ciclo</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Ficha del trabajador */}
      {selectedWorker ? (
        <section className="card">
          <h3 className="font-display">{selectedWorker.nombre}</h3>
          {selectedWorker.roleKind === 'direccion' ? (
            <p className="small muted">Dirección: ficha informativa. No entra en nómina ni en pagos.</p>
          ) : null}
          <table className="kv">
            <tbody>
              <tr><td>Ocupación</td><td>{selectedWorker.ocupacion || '—'}</td></tr>
              <tr><td>Carnet</td><td>{selectedWorker.carnet || '—'}</td></tr>
              <tr><td>Cuenta bancaria</td><td>{selectedWorker.cuentaBancaria || '—'}</td></tr>
              <tr><td>Móvil</td><td>{selectedWorker.movil || '—'}</td></tr>
              {selectedWorker.notas ? <tr><td>Notas</td><td>{selectedWorker.notas}</td></tr> : null}
              <tr>
                <td>Cuentas del ciclo</td>
                <td>{(() => {
                  const list = cycleReceivables(selectedWorker.key)
                  const pend = list.filter((r) => r.status !== 'pagada' && !r.closeKind)
                    .reduce((s, r) => s + effectiveSaldo(r, data.localPayments), 0)
                  return list.length ? `${fmtInt(list.length)} cuenta(s) · pendiente ${fmtCUP(pend)}` : 'Sin cuentas en este ciclo'
                })()}</td>
              </tr>
            </tbody>
          </table>

          {selectedWorker.roleKind !== 'direccion' ? (
            <>
              <h4 className="font-display" style={{ marginTop: 16 }}>Cuadrados del mes</h4>
              <div className="rh-week-head" aria-hidden><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
              <div className="rh-squares rh-squares-month">
                {Array.from({ length: lead }).map((_, i) => <span key={`lead-${i}`} className="rh-sq is-blank" />)}
                {monthDateList.map((f) => {
                  const v = marks[selectedWorker.key]?.[f]
                  let cls = 'rh-sq'
                  if (v == null) cls += ' is-none'
                  else if (v >= 1) cls += ' is-full'
                  else if (v > 0) cls += ' is-half'
                  else cls += ' is-rest'
                  if (f === today) cls += ' is-today'
                  if (f > today) cls += ' is-future'
                  const label = v == null ? 'aún sin foto' : v >= 1 ? 'trabajó' : v > 0 ? 'medio día' : 'descanso'
                  return <span key={f} className={cls} title={`${fmtDate(f)} — ${label}`}>{Number(f.slice(8, 10))}</span>
                })}
              </div>
              <p className="small" style={{ marginTop: 8 }}>
                <span className="chip">
                  {fmtDias(monthDateList.reduce((s, f) => s + (marks[selectedWorker.key]?.[f] ?? 0), 0))} días trabajados
                </span>
              </p>
              <p className="small muted">{SQUARES_LEGEND}</p>

              <h4 className="font-display" style={{ marginTop: 16 }}>Quincena del ciclo</h4>
              <RhSquares marks={marks[selectedWorker.key]} dates={cycleDates} today={today} />
              <p className="small" style={{ marginTop: 8 }}>
                <span className="chip">
                  {fmtDias(cycleDates.reduce((s, f) => s + (marks[selectedWorker.key]?.[f] ?? 0), 0))} días trabajados en el ciclo
                </span>
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
