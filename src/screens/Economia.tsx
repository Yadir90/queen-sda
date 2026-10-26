import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { ColumnChart, RowChart, ChartCard } from '../components/charts'
import { availableMonths, monthEconomy } from '../lib/economiaCore.mjs'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { addManualExpense, supabaseConfigured } from '../lib/backend'
import { sbAddExpense } from '../lib/supabaseBackend'

/* Economía del externo: análisis del período y panel de cierre del
   mes con LA LISTA del dueño — ganancia, ingresos extras, billar,
   gastos, utilidad neta, venta bruta total, venta en barra, venta en
   cocina, inversión, merma, efectivo en caja, cuentas por cobrar,
   zelle y total cobrado. Cada cifra sale de un registro real del
   núcleo (IPV, gasto, cuenta o pago); lo que no tiene registro se
   muestra como no registrado, nunca estimado.
   La quincena de Economía es la NATURAL del mes (1–15 y 16–fin),
   distinta de los ciclos de RH (15 días desde el ancla, pago el día
   16): no se mezclan. */

const SB_MODE = supabaseConfigured()

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return `${MONTH_NAMES[(m || 1) - 1]} de ${y}`
}

const ORIGIN_LABEL: Record<string, string> = {
  manual: 'Manual',
  'ipv-cuentas': 'Del IPV (Desglose)',
  'auto-rh': 'Nómina (automático)',
}

export default function Economia({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const today = todayISO()
  const months = useMemo(() => availableMonths(data, today), [data, today])
  const [picked, setPicked] = useState<string>('')
  const monthKey = picked || months[0] || today.slice(0, 7)
  const eco = useMemo(() => monthEconomy(data, monthKey, today), [data, monthKey, today])

  const [gDate, setGDate] = useState(today)
  const [gConcept, setGConcept] = useState('')
  const [gCategory, setGCategory] = useState('')
  const [gDept, setGDept] = useState('General / todo el negocio')
  const [gQty, setGQty] = useState('1')
  const [gUnit, setGUnit] = useState('')
  const [gNote, setGNote] = useState('')
  const [gError, setGError] = useState<string | null>(null)
  const [gOk, setGOk] = useState<string | null>(null)
  const [gBusy, setGBusy] = useState(false)

  const gastoTotalPreview = Math.round((Number(gQty) || 0) * (Number(gUnit) || 0))

  const submitGasto = async (e: FormEvent) => {
    e.preventDefault()
    setGError(null)
    setGOk(null)
    if (!gDate) { setGError('Pon la fecha del gasto.'); return }
    if (!gConcept.trim()) { setGError('Pon el concepto del gasto.'); return }
    if (gastoTotalPreview <= 0) { setGError('La cantidad por el valor unitario debe dar un total mayor que cero.'); return }
    setGBusy(true)
    try {
      const input = {
        date: gDate,
        concept: gConcept.trim(),
        category: gCategory.trim() || 'Otros',
        dept: gDept.trim() || 'General / todo el negocio',
        quantity: Number(gQty) || 1,
        unitValue: Number(gUnit) || 0,
        note: gNote.trim(),
      }
      if (SB_MODE) await sbAddExpense(input)
      else addManualExpense(input)
      setGOk('Gasto registrado. Ya cuenta en el cierre del mes.')
      setGConcept('')
      setGUnit('')
      setGNote('')
      onChanged()
    } catch (err) {
      setGError(err instanceof Error ? err.message : 'No se pudo registrar el gasto.')
    } finally {
      setGBusy(false)
    }
  }

  const sinDatos = eco.daysCount === 0 && eco.gastosCount === 0
  const noData = (why: string) => <span className="muted">No registrado — {why}</span>
  const cierreRow = (label: string, value: ReactNode, first = false) => (
    <div className="row" style={first ? { borderTop: 0, marginTop: 0, paddingTop: 0 } : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )

  return (
    <div>
      <TabHeader icon="chart" title="Economía" desc="Análisis del período y cierre de mes" badge={TAB_BADGES.economia} />

      <div className="month-chips" role="group" aria-label="Mes a analizar">
        {months.map((mk) => (
          <button key={mk} type="button" className={`chip-btn${mk === monthKey ? ' active' : ''}`} onClick={() => setPicked(mk)}>
            {monthLabel(mk)}
          </button>
        ))}
      </div>

      {sinDatos ? (
        <EmptyState
          icon="chart"
          title={`Sin datos de ${monthLabel(monthKey)} todavía`}
          text="Este mes no tiene días de IPV ni gastos registrados en esta copia. Las cifras del cierre salen solo de registros reales: sin registro, no hay cifra."
        />
      ) : (
        <>
          {/* Panel de cierre del mes — la lista del dueño */}
          <Card>
            <p className="eyebrow">Cierre del mes · {monthLabel(monthKey)}</p>
            <h3>Panel de cierre</h3>
            <p className="sub">
              {fmtInt(eco.daysCount)} días con IPV{eco.firstDay ? ` (${fmtDate(eco.firstDay)} — ${eco.lastDay ? fmtDate(eco.lastDay) : ''})` : ''}.
              Los días sin IPV no se cuentan como cero.
            </p>
            <div className="rec-detail" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              {cierreRow('Venta bruta total', fmtCUP(eco.ventas), true)}
              {cierreRow('Ganancia bruta', fmtCUP(eco.bruta))}
              {cierreRow('Ganancia neta', fmtCUP(eco.neta))}
              {cierreRow('Ingresos extras', eco.ingresosExtrasCount > 0 ? `${fmtCUP(eco.ingresosExtras)} (${fmtInt(eco.ingresosExtrasCount)} registro(s))` : noData('ningún ingreso extra en los IPV del mes'))}
              {cierreRow('Billar (venta de mesas)', eco.billar.dias > 0 ? `${fmtCUP(eco.billar.venta)} · utilidad ${fmtCUP(eco.billar.utilidad)}` : noData('ningún IPV del mes trae la tabla de billar'))}
              {cierreRow('Gastos', `${fmtCUP(eco.gastos)} (${fmtInt(eco.gastosCount)} registro(s))`)}
              {cierreRow('Utilidad neta (resultado: neta − gastos + extras)', fmtCUP(eco.resultado))}
              {cierreRow('Resultado en efectivo (sin el consumo de la casa)', fmtCUP(eco.resultadoEfectivo))}
              {cierreRow('Venta en barra (bebidas y cantina)', eco.deptSeen ? fmtCUP(eco.barra) : noData('los IPV del mes no traen departamentos'))}
              {cierreRow('Venta en cocina (elaboración y pizzas)', eco.deptSeen ? fmtCUP(eco.cocina) : noData('los IPV del mes no traen departamentos'))}
              {cierreRow('Inversión (entradas a precio de compra)', fmtCUP(eco.inversion))}
              {cierreRow('Merma (costo registrado en el IPV)', fmtCUP(eco.merma))}
              {cierreRow('Total cobrado (cuentas cobradas en el mes)', `${fmtCUP(eco.totalCobrado)} (${fmtInt(eco.cobrosCount)} pago(s))`)}
              {cierreRow(`Efectivo en caja (al cierre del último día${eco.lastDay ? `, ${fmtDate(eco.lastDay)}` : ''})`, eco.efectivoCaja == null ? noData('sin foto de fondos') : fmtCUP(eco.efectivoCaja))}
              {cierreRow('Zelle (al cierre del último día)', eco.zelleCierre == null ? noData('sin foto de fondos') : fmtCUP(eco.zelleCierre))}
              {cierreRow('Cuentas por cobrar (pendiente hoy)', `${fmtCUP(eco.cuentasPorCobrar.total)} en ${fmtInt(eco.cuentasPorCobrar.count)} cuentas`)}
            </div>
            <div className="grid-3" style={{ marginTop: 14 }}>
              <div className="stat">
                <div className="label">Clientes pendientes</div>
                <div className="value">{fmtCUP(eco.cuentasPorCobrar.clientes)}</div>
                <div className="hint">Es el «dinero en la calle» (solo clientes)</div>
              </div>
              <div className="stat">
                <div className="label">Trabajadores pendientes</div>
                <div className="value">{fmtCUP(eco.cuentasPorCobrar.trabajadores)}</div>
                <div className="hint">Plazo de 15 días</div>
              </div>
              <div className="stat">
                <div className="label">Administrativos pendientes</div>
                <div className="value">{fmtCUP(eco.cuentasPorCobrar.administrativos)}</div>
                <div className="hint">Morosas hoy: {fmtCUP(eco.cuentasPorCobrar.morosasTotal)} ({fmtInt(eco.cuentasPorCobrar.morosasCount)})</div>
              </div>
            </div>
            {eco.consumo.total > 0 ? (
              <p className="small muted" style={{ marginBottom: 0 }}>
                Consumo de la casa nacido en el mes y aún pendiente: {fmtCUP(eco.consumo.total)} — Jesús {fmtCUP(eco.consumo.jesus)} · Dayami {fmtCUP(eco.consumo.dayami)} · Alejandro {fmtCUP(eco.consumo.alejandro)}. Ese dinero nunca entró en caja y por eso se descuenta en el resultado en efectivo.
              </p>
            ) : null}
            {eco.extrasList.length > 0 ? (
              <div className="rec-detail">
                {eco.extrasList.map((x, i) => (
                  <div className="row" key={`${x.date}-${i}`}><span>Ingreso extra · {x.concepto} ({fmtDate(x.date)})</span><strong>{fmtCUP(x.importe)}</strong></div>
                ))}
              </div>
            ) : null}
          </Card>

          {/* Quincenas de contabilidad (naturales del mes) */}
          <Card>
            <h3>Quincenas del mes</h3>
            <p className="sub">
              Quincena natural de contabilidad: 1–15 y 16–fin de mes. No es la quincena de RH, que corre por ciclos de 15 días desde su ancla y paga el día 16 del ciclo.
            </p>
            <div className="grid-2">
              {eco.quincenas.map((q, i) => (
                <div className="stat" key={q.from}>
                  <div className="label">{i === 0 ? 'Primera quincena (1–15)' : 'Segunda quincena (16–fin)'}</div>
                  <div className="value">{fmtCUP(q.ventas)}</div>
                  <div className="hint">
                    {fmtInt(q.days)} días con IPV · Bruta {fmtCUP(q.bruta)} · Neta {fmtCUP(q.neta)} · Gastos {fmtCUP(q.gastos)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Fondos / reservas */}
          <Card>
            <h3>Fondos económicos</h3>
            <div className="meter">
              <div className="meter-head"><span className="meter-name">Fondo de ventas del mes</span><span className="meter-pct">10 % de las ventas</span></div>
              <p className="meter-figure">{fmtCUP(eco.reservas.fondoVentasMes)}</p>
              <p className="meter-sub">El 10 % de las ventas de {monthLabel(monthKey)} ({fmtCUP(eco.ventas)} con {fmtInt(eco.reservas.diasConIpv)} días importados).</p>
              <div className="meter-track"><span className="meter-fill" style={{ width: `${Math.min(100, eco.reservas.fondoVentasProgreso)}%` }} /></div>
              <p className="meter-foot">{fmtInt(eco.reservas.diasConIpv)} días con IPV / {fmtInt(eco.reservas.diasDelMes)} días al cierre del mes · avance del mes {Math.round(eco.reservas.fondoVentasProgreso)} %.</p>
            </div>
            <div className="meter">
              <div className="meter-head"><span className="meter-name">Fondo de utilidades del trimestre</span><span className="meter-pct">15 % de las utilidades</span></div>
              <p className="meter-figure">{fmtCUP(eco.reservas.fondoUtilidadesTrimestre)}</p>
              <p className="meter-sub">El 15 % de la ganancia neta del trimestre ({fmtCUP(eco.reservas.trimestreNeta)} con {fmtInt(eco.reservas.trimestreDias)} días importados).</p>
              <div className="meter-track"><span className="meter-fill" style={{ width: `${Math.min(100, eco.reservas.trimestreProgreso)}%` }} /></div>
              <p className="meter-foot">{fmtInt(eco.reservas.trimestreDias)} días con IPV / {fmtInt(eco.reservas.trimestreDiasTotal)} días al cierre del trimestre.</p>
            </div>
          </Card>

          {/* Rentabilidad por departamento */}
          {eco.rentabilidad.length > 0 ? (
            <ChartCard title="Venta por departamento" sub="Toca una fila para ver su detalle. La ganancia y el margen salen de los productos del IPV.">
              <RowChart data={eco.rentabilidad.map((r) => ({ label: r.name, value: r.ventas }))} ariaLabel="Venta por departamento del mes" />
              <div className="rec-detail">
                {eco.rentabilidad.map((r) => (
                  <div className="row" key={r.name}>
                    <span>{r.name}</span>
                    <strong>Ganancia {fmtCUP(r.ganancia)}{r.margen != null ? ` · margen ${r.margen.toFixed(1)} %` : ''}</strong>
                  </div>
                ))}
              </div>
            </ChartCard>
          ) : null}

          {/* Gastos del mes */}
          <Card>
            <h3>Gastos de {monthLabel(monthKey)}</h3>
            <p className="sub">
              {fmtInt(eco.gastosCount)} registro(s) por {fmtCUP(eco.gastos)}: los manuales, los que el IPV trae en su Desglose («ipv-cuentas») y el gasto automático de cada nómina registrada («auto-rh»).
              {eco.gastosPorOrigen.length > 0 ? ` Por origen: ${eco.gastosPorOrigen.map((g) => `${ORIGIN_LABEL[g.name] ?? g.name} ${fmtCUP(g.total)}`).join(' · ')}.` : ''}
            </p>
            {eco.gastosPorCategoria.length > 0 ? (
              <ColumnChart
                data={eco.gastosPorCategoria.map((g) => ({ label: g.name, total: g.total, detail: g.name }))}
                series={[{ key: 'total', label: 'Gastos', color: 'var(--chart-turquoise)' }]}
                ariaLabel="Gastos del mes por categoría"
              />
            ) : (
              <p className="small muted">Sin gastos registrados en este mes.</p>
            )}
            {eco.expenses.length > 0 ? (
              <div className="rec-detail">
                {[...eco.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                  <div className="row" key={e.id}>
                    <span>{fmtDate(e.date)} · {e.concept} <span className="muted">({e.category || 'Otros'} · {ORIGIN_LABEL[e.origin] ?? e.origin})</span></span>
                    <strong>{fmtCUP(e.total)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          {/* Alta manual de gasto (solo admin) */}
          {isAdmin ? (
            <Card>
              <h3>Registrar un gasto</h3>
              <p className="sub">Alta manual del administrador. Los gastos del IPV y los de nómina entran solos por la sincronización; esto es para lo que se registra a mano.</p>
              {gError ? <div className="error-box">{gError}</div> : null}
              {gOk ? <div className="ok-box">{gOk}</div> : null}
              <form onSubmit={(e) => void submitGasto(e)}>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="ec-f-fecha">Fecha</label>
                    <input id="ec-f-fecha" type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-concepto">Concepto</label>
                    <input id="ec-f-concepto" type="text" value={gConcept} onChange={(e) => setGConcept(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-categoria">Categoría</label>
                    <input id="ec-f-categoria" type="text" value={gCategory} onChange={(e) => setGCategory(e.target.value)} placeholder="Insumos, Servicios…" />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-depto">Departamento</label>
                    <input id="ec-f-depto" type="text" value={gDept} onChange={(e) => setGDept(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-cantidad">Cantidad</label>
                    <input id="ec-f-cantidad" type="number" min={0} step="0.5" value={gQty} onChange={(e) => setGQty(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-unitario">Valor unitario (CUP)</label>
                    <input id="ec-f-unitario" type="number" min={0} step={1} value={gUnit} onChange={(e) => setGUnit(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="ec-f-nota">Nota</label>
                    <input id="ec-f-nota" type="text" value={gNote} onChange={(e) => setGNote(e.target.value)} />
                  </div>
                </div>
                <p className="small">Total del gasto: <strong>{fmtCUP(gastoTotalPreview)}</strong> (cantidad × valor unitario).</p>
                <button className="btn primary" type="submit" disabled={gBusy}>{gBusy ? 'Registrando…' : 'Registrar gasto'}</button>
              </form>
              <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>
                Verificado contra: días del IPV, gastos registrados, cuentas y pagos del núcleo. Sin verificar: nada — cada cifra de esta pantalla sale de un registro.
              </p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}
