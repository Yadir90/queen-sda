import { useMemo, useState, type FormEvent } from 'react'
import type { StoredData, TransferMovement } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { BANK_COMMISSION, conciliationDates, conciliationForDay, isEffectiveMovement, transferSummary } from '../lib/economiaCore.mjs'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { addTransferMovement, deleteTransferMovement, setTransferMovementExcluded, supabaseConfigured, updateTransferMovement } from '../lib/backend'
import { sbAddTransferMovement, sbDeleteTransferMovement, sbSetTransferMovementExcluded, sbUpdateTransferMovement } from '../lib/supabaseBackend'
import '../components/sectionsMirror.css'

/* Transferencias del externo: la tarjeta del negocio como en el
   original. El saldo se DERIVA del historial de movimientos (el del
   respaldo, tal como el original lo registró, más los registrados en
   esta copia): ningún importe se recalcula ni se recompone. La
   comisión del banco es FIJA de 210 CUP por pase — nunca un
   porcentaje — y el importe registrado de un pase es el que afecta a
   la tarjeta. Marcar «No es de La Reina» deja el movimiento visible
   (tachado) pero fuera del saldo y de los totales; es reversible. */

const SB_MODE = supabaseConfigured()

const SOURCE_LABEL: Record<TransferMovement['source'], string> = {
  ipv: 'IPV del día',
  'pago-cuenta': 'Pago de cuenta',
  manual: 'Abono manual',
  pase: 'Pase',
  extra: 'Otro ingreso',
  'gasto-transferencia': 'Gasto por transferencia',
}

type FormKind = 'abono' | 'pase' | 'gasto'

export default function Transferencias({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const movements = data.transferMovements
  const summary = useMemo(() => transferSummary(movements), [movements])

  // Saldo corrido por movimiento (solo los efectivos lo mueven), como
  // el «balanceAfter» del historial del original.
  const balanceAfter = useMemo(() => {
    const map = new Map<string, number>()
    let bal = 0
    for (const m of movements) {
      if (isEffectiveMovement(m)) bal += m.amount
      map.set(m.id, bal)
    }
    return map
  }, [movements])

  const dates = useMemo(() => conciliationDates(data), [data])
  const [concDate, setConcDate] = useState<string>('')
  const activeConcDate = concDate || dates[0] || ''
  const conc = useMemo(
    () => (activeConcDate ? conciliationForDay(data, activeConcDate) : null),
    [data, activeConcDate],
  )

  const [busyId, setBusyId] = useState<string | null>(null)
  const [formKind, setFormKind] = useState<FormKind>('abono')
  const [fDate, setFDate] = useState(todayISO())
  const [fAmount, setFAmount] = useState('')
  const [fKind, setFKind] = useState<'banco' | 'efectivo'>('banco')
  const [fDetail, setFDetail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)

  /* Edición y borrado, como en el original: los movimientos del IPV
     no se tocan aquí (se corrige el Excel); el saldo tras la edición
     no puede quedar negativo en ningún punto del historial. */
  const [editing, setEditing] = useState<{ id: string; date: string; amount: string; detail: string } | null>(null)
  const [editError, setEditError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const EDITABLE: TransferMovement['source'][] = ['pase', 'gasto-transferencia', 'manual']
  const DELETABLE: TransferMovement['source'][] = ['pase', 'gasto-transferencia', 'manual', 'pago-cuenta', 'extra']

  const saveEdit = async (m: TransferMovement) => {
    if (!editing) return
    const abs = Math.round(Number(editing.amount) || 0)
    if (!editing.date || abs <= 0) { setEditError('Pon la fecha y un importe mayor que cero.'); return }
    const signed = m.amount < 0 ? -abs : abs
    const patched = movements
      .map((x) => (x.id === m.id ? { ...x, date: editing.date, amount: signed } : x))
      .sort((a, b) => a.date.localeCompare(b.date))
    let bal = 0
    for (const x of patched) {
      if (isEffectiveMovement(x)) bal += x.amount
      if (bal < -0.005) { setEditError(`El saldo quedaría negativo (${fmtCUP(bal)}) el ${fmtDate(x.date)}: como en el original, no se guarda. Baja el importe o mueve la fecha.`); return }
    }
    setEditError('')
    try {
      const patch = { date: editing.date, amount: signed, detail: editing.detail.trim() || m.detail }
      if (SB_MODE) await sbUpdateTransferMovement(m.id, patch, m)
      else updateTransferMovement(m.id, patch)
      setEditing(null)
      onChanged()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'No se pudo guardar la edición.')
    }
  }

  const removeMovement = async (m: TransferMovement) => {
    setConfirmDeleteId(null)
    try {
      if (SB_MODE) await sbDeleteTransferMovement(m.id)
      else deleteTransferMovement(m.id)
      onChanged()
    } catch { /* sin conexión o sin permiso: el historial queda como estaba */ }
  }

  const toggleExcluded = async (m: TransferMovement) => {
    setBusyId(m.id)
    try {
      if (SB_MODE) await sbSetTransferMovementExcluded(m.id, !m.excluded, m)
      else setTransferMovementExcluded(m.id, !m.excluded)
      onChanged()
    } catch {
      // Sin conexión o sin permiso: el historial queda como estaba.
    } finally {
      setBusyId(null)
    }
  }

  const submitForm = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormOk(null)
    const amount = Math.round(Number(fAmount) || 0)
    if (!fDate) { setFormError('Pon la fecha del movimiento.'); return }
    if (amount <= 0) { setFormError('El importe debe ser mayor que cero.'); return }
    const note = fDetail.trim()
    let movement: Omit<TransferMovement, 'id' | 'local' | 'superseded'>
    if (formKind === 'abono') {
      movement = {
        date: fDate, type: 'abono', source: 'manual', amount,
        detail: note || 'Abono manual a la tarjeta del negocio',
        excluded: false, paseId: null, manualId: null, paymentCreditId: null, extraId: null, transferExpenseId: null, paseKind: null,
      }
    } else if (formKind === 'pase') {
      movement = {
        date: fDate, type: 'pase', source: 'pase', amount: -amount,
        detail: `${fKind === 'banco' ? 'Pase al banco' : 'Efectivo recibido'}${note ? `: ${note}` : ''}`,
        excluded: false, paseId: null, manualId: null, paymentCreditId: null, extraId: null, transferExpenseId: null, paseKind: fKind,
      }
    } else {
      movement = {
        date: fDate, type: 'gasto', source: 'gasto-transferencia', amount: -amount,
        detail: note || 'Gasto pagado por transferencia',
        excluded: false, paseId: null, manualId: null, paymentCreditId: null, extraId: null, transferExpenseId: null, paseKind: null,
      }
    }
    setFormBusy(true)
    try {
      if (SB_MODE) await sbAddTransferMovement(movement)
      else addTransferMovement(movement)
      setFormOk('Movimiento registrado. El saldo y los totales ya lo cuentan.')
      setFAmount('')
      setFDetail('')
      onChanged()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.')
    } finally {
      setFormBusy(false)
    }
  }

  const history = [...movements].reverse()
  const importePase = Math.round(Number(fAmount) || 0)

  return (
    <div>
      <TabHeader icon="transfer" title="Transferencias" desc="Tarjeta del negocio y pases al banco" badge={TAB_BADGES.transferencias} />

      {movements.length === 0 && data.days.length === 0 ? (
        <EmptyState
          icon="transfer"
          title="Sin movimientos de la tarjeta todavía"
          text="Cuando importes el respaldo del SDA, aquí verás el historial de la tarjeta del negocio tal como el sistema lo registró: abonos del IPV, pagos de cuentas por transferencia, abonos manuales y pases al banco, con su saldo derivado."
        />
      ) : (
        <>
          {/* La tarjeta del negocio */}
          <Card>
            <p className="eyebrow">Tarjeta del negocio</p>
            <h3>Saldo de la tarjeta</h3>
            <p className="big-figure">{fmtCUP(summary.balance)}</p>
            <p className="sub">
              Sale del historial: {fmtInt(summary.effectiveCount)} movimientos efectivos de {fmtInt(summary.movementsCount)} registrados.
              {summary.excludedCount > 0 ? ` ${fmtInt(summary.excludedCount)} marcado(s) «No es de La Reina» quedan fuera.` : ''}
              {summary.supersededCount > 0 ? ` ${fmtInt(summary.supersededCount)} anulado(s) por el propio sistema original no suman.` : ''}
            </p>
            <div className="rec-detail" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <div className="row"><span>Total recibido</span><strong>{fmtCUP(summary.totalReceived)}</strong></div>
              <div className="row"><span>· de los IPV (transferencias)</span><strong>{fmtCUP(summary.totalIpvReceived)}</strong></div>
              <div className="row"><span>· de pagos de cuentas por transferencia</span><strong>{fmtCUP(summary.totalPagoCuenta)}</strong></div>
              <div className="row"><span>· abonos manuales y otros ingresos</span><strong>{fmtCUP(summary.totalManualExtra)}</strong></div>
              <div className="row"><span>Total salido (pases y gastos)</span><strong>{fmtCUP(summary.totalOut)}</strong></div>
              <div className="row"><span>Pasado al banco</span><strong>{fmtCUP(summary.totalBankPassed)}</strong></div>
              {summary.lastBankPase ? (
                <div className="row"><span>Último pase al banco</span><strong>{fmtCUP(summary.lastBankPase.amount)} · {fmtDate(summary.lastBankPase.date)}</strong></div>
              ) : null}
            </div>
            {summary.totalManualExtra > 0 ? (
              <div className="error-box" style={{ marginTop: 12 }}>
                Ojo: {fmtCUP(summary.totalManualExtra)} de este saldo vienen de abonos manuales u otros ingresos que no salen de ningún IPV ({fmtInt(summary.manualExtraCount)} movimiento(s)). Su composición es la que quedó registrada; esta pantalla no la ajusta.
              </div>
            ) : null}
          </Card>

          {/* Conciliación del día */}
          {conc ? (
            <Card>
              <h3>Conciliación del día</h3>
              <p className="sub">
                La clave del cuadre: las entradas a la tarjeta deben coincidir, sin duplicar, con las transferencias del IPV del día
                más los pagos de cuentas por transferencia más otras entradas identificadas.
              </p>
              <div className="field" style={{ maxWidth: 260 }}>
                <label htmlFor="tr-fecha">Día a conciliar</label>
                <select id="tr-fecha" value={activeConcDate} onChange={(e) => setConcDate(e.target.value)}>
                  {dates.map((d) => (
                    <option key={d} value={d}>{fmtDate(d)}</option>
                  ))}
                </select>
              </div>
              <div className="rec-detail">
                <div className="row"><span>Entradas registradas en la tarjeta</span><strong>{fmtCUP(conc.registradas)}</strong></div>
                <div className="row"><span>Transferencias del IPV del día</span><strong>{conc.ipv == null ? 'Sin IPV importado' : fmtCUP(conc.ipv)}</strong></div>
                <div className="row"><span>Pagos de cuentas por transferencia</span><strong>{fmtCUP(conc.pagosCuenta)}</strong></div>
                <div className="row"><span>Otras entradas identificadas (manuales / otros ingresos)</span><strong>{fmtCUP(conc.otras)}</strong></div>
                <div className="row"><span>Diferencia</span><strong>{conc.diferencia == null ? '—' : fmtCUP(conc.diferencia)}</strong></div>
              </div>
              {conc.diferencia == null ? (
                <p className="small muted">Ese día no tiene IPV importado en esta copia: no se puede conciliar contra el IPV, y no se inventa la cifra que falta.</p>
              ) : conc.diferencia === 0 ? (
                <div className="ok-box" style={{ marginTop: 12, marginBottom: 0 }}>Cuadra: cada entrada de ese día está identificada (IPV, pago de cuenta u otra entrada registrada).</div>
              ) : (
                <div className="error-box" style={{ marginTop: 12 }}>
                  Descuadre de {fmtCUP(Math.abs(conc.diferencia))}: lo registrado en la tarjeta no coincide con el IPV más los pagos de cuentas y las demás entradas identificadas. Señálalo y revísalo antes de dar el día por cuadrado.
                </div>
              )}
            </Card>
          ) : null}

          {/* Registro de movimientos (solo admin) */}
          {isAdmin ? (
            <Card>
              <h3>Registrar un movimiento</h3>
              <p className="sub">
                Abono manual para días sin IPV importado, un pase, o un gasto pagado por transferencia.
                En los pases al banco la comisión del banco es <strong>fija de {fmtInt(BANK_COMMISSION)} CUP</strong> por pase — nunca un porcentaje — y el importe que registres es el que afecta a la tarjeta.
              </p>
              <div className="method-capsule" role="group" aria-label="Tipo de movimiento" style={{ marginBottom: 14 }}>
                <button type="button" className={formKind === 'abono' ? 'active' : ''} onClick={() => setFormKind('abono')}>Abono manual</button>
                <button type="button" className={formKind === 'pase' ? 'active' : ''} onClick={() => setFormKind('pase')}>Pase</button>
                <button type="button" className={formKind === 'gasto' ? 'active' : ''} onClick={() => setFormKind('gasto')}>Gasto por transferencia</button>
              </div>
              {formError ? <div className="error-box">{formError}</div> : null}
              {formOk ? <div className="ok-box">{formOk}</div> : null}
              <form onSubmit={(e) => void submitForm(e)}>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="tr-f-fecha">Fecha</label>
                    <input id="tr-f-fecha" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="tr-f-importe">Importe (CUP)</label>
                    <input id="tr-f-importe" type="number" min={1} step={1} value={fAmount} onChange={(e) => setFAmount(e.target.value)} required />
                  </div>
                  {formKind === 'pase' ? (
                    <div className="field">
                      <label htmlFor="tr-f-clase">Clase de pase</label>
                      <select id="tr-f-clase" value={fKind} onChange={(e) => setFKind(e.target.value as 'banco' | 'efectivo')}>
                        <option value="banco">Al banco</option>
                        <option value="efectivo">Efectivo a una persona</option>
                      </select>
                    </div>
                  ) : null}
                  <div className="field">
                    <label htmlFor="tr-f-detalle">{formKind === 'gasto' ? 'Concepto' : 'Nota'}</label>
                    <input
                      id="tr-f-detalle"
                      type="text"
                      value={fDetail}
                      onChange={(e) => setFDetail(e.target.value)}
                      placeholder={formKind === 'abono' ? 'De quién / por qué entró' : formKind === 'pase' ? 'Referencia del pase' : 'Qué se pagó'}
                    />
                  </div>
                </div>
                {formKind === 'pase' && summary.balance > 0 ? (
                  <p className="small muted">
                    Como en el original, el pase viene precargado con todo el saldo acumulado: {' '}
                    <button type="button" className="btn" onClick={() => setFAmount(String(summary.balance))}>Usar todo el saldo ({fmtCUP(summary.balance)})</button>
                    {' '}puedes bajarlo si pasas solo una parte.
                  </p>
                ) : null}
                {formKind === 'pase' && fKind === 'banco' && importePase > 0 ? (
                  <p className="small muted">
                    Comisión fija del banco: {fmtCUP(BANK_COMMISSION)} · Neto que acredita el banco con este importe: {fmtCUP(Math.max(0, importePase - BANK_COMMISSION))}.
                  </p>
                ) : null}
                <button className="btn primary" type="submit" disabled={formBusy}>{formBusy ? 'Registrando…' : 'Registrar movimiento'}</button>
              </form>
            </Card>
          ) : (
            <Card>
              <p className="sub" style={{ margin: 0 }}>Solo el administrador registra movimientos de la tarjeta y marca los que no son de La Reina.</p>
            </Card>
          )}

          {/* Historial */}
          <Card>
            <h3>Historial de la tarjeta</h3>
            <p className="sub">Del más reciente al más antiguo. Lo marcado «No es de La Reina» queda visible, tachado, y fuera del saldo.</p>
            <div className="mov-list">
              {history.map((m) => {
                const off = m.excluded || m.superseded
                return (
                  <div key={m.id} className={`mov-row${off ? ' is-off' : ''}`}>
                    <div className="mov-main">
                      <span className={`mov-detail${m.excluded ? ' is-struck' : ''}`}>{m.detail || SOURCE_LABEL[m.source]}</span>
                      <span className="mov-meta">
                        {fmtDate(m.date)} · {SOURCE_LABEL[m.source]}
                        {m.source === 'pase' && m.paseKind ? ` · ${m.paseKind === 'banco' ? 'al banco' : 'efectivo'}` : ''}
                        {' · '}Saldo tras el movimiento: {fmtCUP(balanceAfter.get(m.id) ?? 0)}
                      </span>
                      {m.superseded ? <span className="chip">Anulado en el sistema original</span> : null}
                      {m.excluded ? <span className="chip">No es de La Reina</span> : null}
                      {m.local ? <span className="chip">Registrado en esta copia</span> : null}
                    </div>
                    <span className={`mov-amount ${m.amount >= 0 ? 'pos' : 'neg'}`}>
                      {m.amount >= 0 ? '+' : '−'}{fmtCUP(Math.abs(m.amount))}
                    </span>
                    {/* Acciones como en el original: botones de texto
                        compactos en línea (Editar · No es de La Reina ·
                        Borrar, 12 px). La versión anterior los metía en
                        un ActionMenu cuya etiqueta visible era el detalle
                        COMPLETO del movimiento: el disparador se pintaba
                        como una burbuja gigante con el texto cortado
                        (defecto del dueño, 26-oct). */}
                    {isAdmin && !m.superseded ? (
                      <span className="mov-actions">
                        {EDITABLE.includes(m.source) ? (
                          <button type="button" className="mov-action" onClick={() => { setEditing({ id: m.id, date: m.date, amount: String(Math.abs(m.amount)), detail: m.detail }); setEditError(''); setConfirmDeleteId(null) }} aria-label={`Editar movimiento del ${fmtDate(m.date)}`}>
                            <Icon name="edit" size={13} /> Editar
                          </button>
                        ) : null}
                        <button type="button" className="mov-action" disabled={busyId === m.id} onClick={() => void toggleExcluded(m)} aria-label={m.excluded ? 'Volver a contar este movimiento en el saldo' : 'Marcar como «No es de La Reina»: sale del saldo sin borrarse'}>
                          {m.excluded ? 'Incluir en el cuadre' : 'No es de La Reina'}
                        </button>
                        {DELETABLE.includes(m.source) ? (
                          <button type="button" className="mov-action is-danger" onClick={() => { setConfirmDeleteId(m.id); setEditing(null) }} aria-label={`Borrar movimiento del ${fmtDate(m.date)}`}>
                            <Icon name="trash" size={13} /> Borrar
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                    {isAdmin && editing?.id === m.id ? (
                      <form
                        className="mov-edit"
                        onSubmit={(e) => { e.preventDefault(); void saveEdit(m) }}
                        style={{ flexBasis: '100%', display: 'grid', gap: 8, marginTop: 8 }}
                        aria-label={`Editar movimiento ${m.detail || SOURCE_LABEL[m.source]}`}
                      >
                        <p className="small muted" style={{ margin: 0 }}>El saldo se recalcula antes de guardar y no puede quedar negativo.</p>
                        <div className="field"><label htmlFor={`mv-date-${m.id}`}>Fecha</label>
                          <input id={`mv-date-${m.id}`} type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} required /></div>
                        <div className="field"><label htmlFor={`mv-amount-${m.id}`}>Importe (CUP)</label>
                          <input id={`mv-amount-${m.id}`} type="number" min={1} step={1} value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} required /></div>
                        <div className="field"><label htmlFor={`mv-detail-${m.id}`}>{m.type === 'gasto' ? 'Concepto' : 'Nota'}</label>
                          <input id={`mv-detail-${m.id}`} type="text" maxLength={300} value={editing.detail} onChange={(e) => setEditing({ ...editing, detail: e.target.value })} /></div>
                        {editError ? <div className="error-box">{editError}</div> : null}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="submit" className="btn primary">Guardar cambios</button>
                          <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
                        </div>
                      </form>
                    ) : null}
                    {isAdmin && confirmDeleteId === m.id ? (
                      <div className="confirm-inline" style={{ flexBasis: '100%', marginTop: 8 }}>
                        <span className="small">¿Borrar este movimiento ({m.amount >= 0 ? '+' : '−'}{fmtCUP(Math.abs(m.amount))} del {fmtDate(m.date)})? El saldo se recalcula sin él.</span>
                        <span className="confirm-actions">
                          <button type="button" className="btn" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
                          <button type="button" className="btn btn-danger-solid" onClick={() => void removeMovement(m)}>Borrar</button>
                        </span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Verificado contra: el historial de la tarjeta del respaldo del SDA y los movimientos registrados en esta copia. Sin verificar: los SMS de PAGOxMOVIL (esta copia no los lee; la conciliación compara contra el IPV y los pagos registrados).
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
