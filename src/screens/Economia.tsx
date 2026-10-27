import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { ChartCard } from '../components/charts'
import { availableMonths, daysInMonthOf, monthEconomy } from '../lib/economiaCore.mjs'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { addManualExpense, supabaseConfigured } from '../lib/backend'
import { sbAddExpense } from '../lib/supabaseBackend'
import '../components/sectionsMirror.css'

/* Economía del externo: análisis del período y panel de cierre del
   mes con LA LISTA del dueño — ganancia, ingresos extras, billar,
   gastos, utilidad neta, venta bruta total, venta en barra, venta en
   cocina, inversión, merma, efectivo en caja, cuentas por cobrar,
   zelle y total cobrado. Cada cifra sale de un registro real del
   núcleo (IPV, gasto, cuenta o pago); lo que no tiene registro se
   muestra como no registrado, nunca estimado.
   La quincena de Economía es la NATURAL del mes (1–15 y 16–fin),
   distinta de los ciclos de RH (15 días desde el ancla, pago el día
   16): no se mezclan.
   PORT DEL ORIGINAL (rasero del dueño, 25-oct): además del cierre,
   esta pantalla lleva los bloques de EconomiaTab del original EN SU
   ORDEN y con sus clases .economy-* de theme.css (portadas tal cual
   a sectionsMirror.css): Fondos económicos (EconomyMeters) →
   Flujo operativo proyectado → Punto de equilibrio → Rentabilidad
   por categoría → Anomalías detectadas por Queen → Indicadores de
   eficiencia → Impacto administrativo → Participación de gastos
   por categoría → Evolución de márgenes. Las fórmulas son las del
   código del original, calculadas con monthEconomy del mes y del
   mes anterior. Diferencias de arquitectura: el original navega
   por PeriodNav (día/semana/quincena/mes/trimestre) sobre stats de
   servidor y aquí el selector es el mes (el núcleo local solo
   agrega por mes); el análisis de anomalías del original llama al
   endpoint de Queen del artefacto, no desplegado en el externo —
   la tarjeta se muestra con su botón deshabilitado y el motivo,
   sin fingir análisis; el botón «Ver el detalle en Cobrar» del
   Impacto administrativo no se pinta porque esta pantalla no
   recibe navegación (App.tsx está fuera de esta área). */

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

export default function Economia({ data, isAdmin, onChanged, onGoCobrar }: { data: StoredData; isAdmin: boolean; onChanged: () => void; onGoCobrar?: () => void }) {
  const today = todayISO()
  const months = useMemo(() => availableMonths(data, today), [data, today])
  const [picked, setPicked] = useState<string>('')
  const monthKey = picked || months[0] || today.slice(0, 7)
  const eco = useMemo(() => monthEconomy(data, monthKey, today), [data, monthKey, today])

  /* === Bloques de EconomiaTab del original, con sus fórmulas === */
  const prevMonthKey = (() => {
    const [yy, mm] = monthKey.split('-').map(Number)
    return mm === 1 ? `${yy - 1}-12` : `${yy}-${String((mm || 1) - 1).padStart(2, '0')}`
  })()
  const ecoPrev = useMemo(() => monthEconomy(data, prevMonthKey, today), [data, prevMonthKey, today])
  const ratio = (value: number, base: number) => (base > 0 ? (value / base) * 100 : null)
  const pctTxt = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`)
  const costOfSales = Math.max(0, eco.ventas - eco.bruta)
  const currentRatios = {
    grossMargin: ratio(eco.bruta, eco.ventas),
    netMargin: ratio(eco.neta, eco.ventas),
    expenseBurden: ratio(eco.gastos, eco.neta),
    resultMargin: ratio(eco.resultado, eco.ventas),
    costShare: ratio(costOfSales, eco.ventas),
    shrinkShare: ratio(eco.merma, costOfSales),
  }
  const prevCost = Math.max(0, ecoPrev.ventas - ecoPrev.bruta)
  const comparisonRows: Array<{ label: string; current: number | null; previous: number | null; lowerBetter?: boolean }> = [
    { label: 'Margen bruto', current: currentRatios.grossMargin, previous: ratio(ecoPrev.bruta, ecoPrev.ventas) },
    { label: 'Margen neto', current: currentRatios.netMargin, previous: ratio(ecoPrev.neta, ecoPrev.ventas) },
    { label: 'Costo sobre ventas', current: currentRatios.costShare, previous: ratio(prevCost, ecoPrev.ventas), lowerBetter: true },
    { label: 'Gastos sobre ganancia neta', current: currentRatios.expenseBurden, previous: ratio(ecoPrev.gastos, ecoPrev.neta), lowerBetter: true },
    { label: 'Resultado sobre ventas', current: currentRatios.resultMargin, previous: ratio(ecoPrev.resultado, ecoPrev.ventas) },
  ]
  const isCurrentMonth = monthKey === today.slice(0, 7)
  const totalCalendarDays = daysInMonthOf(monthKey)
  const elapsedCalendarDays = isCurrentMonth ? Math.max(1, Number(today.slice(8, 10))) : totalCalendarDays
  const projectedSales = isCurrentMonth && eco.daysCount > 0 ? (eco.ventas / eco.daysCount) * totalCalendarDays : eco.ventas
  const projectedCost = isCurrentMonth && eco.daysCount > 0 ? (costOfSales / eco.daysCount) * totalCalendarDays : costOfSales
  const projectedExpenses = isCurrentMonth ? (eco.gastos / elapsedCalendarDays) * totalCalendarDays : eco.gastos
  const projectedExtraIncome = isCurrentMonth ? (eco.ingresosExtras / elapsedCalendarDays) * totalCalendarDays : eco.ingresosExtras
  const projectedFlow = projectedSales + projectedExtraIncome - projectedCost - projectedExpenses
  const contributionRatio = eco.ventas > 0 ? eco.bruta / eco.ventas : 0
  const breakEvenSales = contributionRatio > 0 && eco.gastos > 0 ? eco.gastos / contributionRatio : null
  const breakEvenProgress = breakEvenSales != null && breakEvenSales > 0 ? (eco.ventas / breakEvenSales) * 100 : null
  const profitabilityByCategory = [...eco.rentabilidad].sort((a, b) => (b.margen ?? 0) - (a.margen ?? 0) || b.ganancia - a.ganancia)
  const expenseCatCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of eco.expenses) map.set((e.category || '').trim() || 'Otros', (map.get((e.category || '').trim() || 'Otros') ?? 0) + 1)
    return map
  }, [eco.expenses])
  const maxExpenseCat = eco.gastosPorCategoria[0]?.total ?? 0

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
      {/* D-R5-05: el importe (string) va en <strong> sin corte; la nota
          «No registrado — …» es prosa y SÍ envuelve, alineada a la
          derecha. Antes ambas iban en el mismo <strong>. */}
      {typeof value === 'string' ? <strong>{value}</strong> : <span className="cierre-note">{value}</span>}
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

      <p className="eco-period-note">Márgenes, costos, fondos y relaciones económicas del período. Los totales generales de ventas y ganancias permanecen en Inicio.</p>

      {sinDatos ? (
        <EmptyState
          icon="chart"
          title={`Sin datos de ${monthLabel(monthKey)} todavía`}
          text="Este mes no tiene días de IPV ni gastos registrados. Las cifras del cierre salen solo de registros reales: sin registro, no hay cifra."
        />
      ) : (
        <>
          {/* Fondos económicos — EconomyMeters del original: va primero,
              justo tras el selector de período, como en EconomiaTab. */}
          <Card>
            <h3>Fondos económicos</h3>
            <p className="sub">Cada IPV importado actualiza los importes y el avance. Los días sin importar no se cuentan como cero.</p>
            <div className="meter">
              <div className="meter-head"><span className="meter-name">De las ventas mensuales</span><span className="meter-pct">10%</span></div>
              <p className="meter-figure">{fmtCUP(eco.reservas.fondoVentasMes)}</p>
              <p className="meter-sub">10% de ventas acumuladas: <strong>{fmtCUP(eco.ventas)} CUP</strong></p>
              <div className="meter-track"><span className="meter-fill" style={{ width: `${eco.reservas.diasDelMes > 0 ? Math.min(100, (eco.reservas.diasConIpv / eco.reservas.diasDelMes) * 100) : 0}%` }} /></div>
              <p className="meter-foot">Avance del período {(eco.reservas.diasDelMes > 0 ? (eco.reservas.diasConIpv / eco.reservas.diasDelMes) * 100 : 0).toFixed(1)}% · {fmtInt(eco.reservas.diasConIpv)} días con IPV · {fmtInt(eco.reservas.diasDelMes)} días al cierre</p>
            </div>
            <div className="meter">
              <div className="meter-head"><span className="meter-name">De las utilidades trimestrales</span><span className="meter-pct">15%</span></div>
              <p className="meter-figure">{fmtCUP(eco.reservas.fondoUtilidadesTrimestre)}</p>
              <p className="meter-sub">15% de ganancia neta acumulada: <strong>{fmtCUP(eco.reservas.trimestreNeta)} CUP</strong></p>
              <div className="meter-track"><span className="meter-fill" style={{ width: `${eco.reservas.trimestreDiasTotal > 0 ? Math.min(100, (eco.reservas.trimestreDias / eco.reservas.trimestreDiasTotal) * 100) : 0}%` }} /></div>
              <p className="meter-foot">Avance del período {(eco.reservas.trimestreDiasTotal > 0 ? (eco.reservas.trimestreDias / eco.reservas.trimestreDiasTotal) * 100 : 0).toFixed(1)}% · {fmtInt(eco.reservas.trimestreDias)} días con IPV · {fmtInt(eco.reservas.trimestreDiasTotal)} días al cierre</p>
            </div>
          </Card>

          {/* === Bloques de EconomiaTab del original (orden y clases literales) === */}
          <div className="economy-decision-grid">
            <ChartCard title="Flujo operativo proyectado">
              <p className="economy-explainer">Escenario lineal aproximado a partir de los días con IPV y los movimientos registrados. No modifica el flujo real ni completa días ausentes.</p>
              <div className="economy-flow-equation" aria-label="Cálculo del flujo operativo proyectado">
                <div><span>Entradas</span><strong>{fmtCUP(projectedSales + projectedExtraIncome)}</strong><small>ventas + otros ingresos</small></div>
                <i aria-hidden="true">−</i>
                <div><span>Salidas</span><strong>{fmtCUP(projectedCost + projectedExpenses)}</strong><small>costo vendido + gastos</small></div>
                <i aria-hidden="true">=</i>
                <div className={projectedFlow < 0 ? 'is-negative' : 'is-positive'}><span>Flujo estimado</span><strong>{fmtCUP(projectedFlow)}</strong><small>{isCurrentMonth ? `al cierre de ${monthLabel(monthKey)}` : 'resultado del período cerrado'}</small></div>
              </div>
              <dl className="economy-detail-list">
                <div><dt>Ventas consideradas</dt><dd>{fmtCUP(projectedSales)}</dd></div>
                <div><dt>Otros ingresos</dt><dd>{fmtCUP(projectedExtraIncome)}</dd></div>
                <div><dt>Costo de lo vendido</dt><dd>{fmtCUP(projectedCost)}</dd></div>
                <div><dt>Gastos operativos</dt><dd>{fmtCUP(projectedExpenses)}</dd></div>
              </dl>
              {isCurrentMonth ? <p className="economy-footnote">Base: {fmtInt(eco.daysCount)} día{eco.daysCount === 1 ? '' : 's'} con IPV de {fmtInt(totalCalendarDays)} días del período. Los gastos se proyectan por días transcurridos.</p> : null}
            </ChartCard>

            <ChartCard title="Punto de equilibrio">
              {breakEvenSales == null ? (
                <p className="small muted">No puede estimarse todavía: hacen falta ventas con margen bruto positivo y gastos registrados.</p>
              ) : (
                <>
                  <div className="economy-break-even">
                    <div><span>Ventas necesarias</span><strong>{fmtCUP(breakEvenSales)}</strong></div>
                    <div><span>Margen de contribución</span><strong>{(contributionRatio * 100).toFixed(1)}%</strong></div>
                  </div>
                  <div className="economy-progress-track" role="progressbar" aria-label="Avance hacia el punto de equilibrio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, breakEvenProgress ?? 0))}><span style={{ width: `${Math.min(100, Math.max(0, breakEvenProgress ?? 0))}%` }} /></div>
                  <p className="economy-balance-status">{(breakEvenProgress ?? 0) >= 100 ? `Superado por ${fmtCUP(Math.max(0, eco.ventas - breakEvenSales))}` : `Faltan aproximadamente ${fmtCUP(Math.max(0, breakEvenSales - eco.ventas))} en ventas`} <small>· avance {(breakEvenProgress ?? 0).toFixed(1)}%</small></p>
                  <p className="economy-footnote">Aproximación: gastos registrados ÷ margen bruto del período. Revisa la clasificación de gastos antes de decidir.</p>
                </>
              )}
            </ChartCard>
          </div>

          <div className="economy-pair-grid">
            <ChartCard title="Rentabilidad por categoría">
              {profitabilityByCategory.length === 0 ? (
                <p className="small muted">Los IPV de este período no tienen categorías con ventas para analizar.</p>
              ) : (
                <div className="economy-category-profitability">
                  {profitabilityByCategory.map((category) => (
                    <article key={category.name} className={category.ganancia < 0 ? 'is-negative' : ''}>
                      <div><strong>{category.name}</strong><small>{fmtCUP(category.ventas)} vendidos</small></div>
                      <div><strong>{category.margen != null ? `${category.margen.toFixed(1)}%` : '—'}</strong><small>{fmtCUP(category.ganancia)} de ganancia</small></div>
                      <div className="economy-category-bar" aria-label={`${category.name}: margen ${category.margen != null ? category.margen.toFixed(1) : '—'}%`}><span style={{ width: `${Math.min(100, Math.max(0, category.margen ?? 0))}%` }} /></div>
                    </article>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Anomalías detectadas por Queen">
              <p className="economy-explainer">Queen compara los días de este período y señala variaciones que necesitan revisión. Nunca corrige cifras por su cuenta.</p>
              <button type="button" className="economy-queen-button" disabled>Analizar con Queen</button>
              {eco.daysCount < 2 ? <p className="economy-footnote">Se necesitan al menos dos días con IPV para comparar patrones.</p> : null}
              <p className="economy-footnote">El análisis de anomalías del original llama al servicio de Queen del artefacto, que aún no está desplegado en el sistema externo: el botón queda deshabilitado y no se finge ningún resultado.</p>
            </ChartCard>
          </div>

          <div className="economy-pair-grid">
            <ChartCard title="Indicadores de eficiencia">
              <div className="rec-detail" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
                <div className="row" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}><span>Costo de lo vendido</span><strong>{fmtCUP(costOfSales)}<span className="small muted"> · {pctTxt(currentRatios.costShare)} de las ventas</span></strong></div>
                <div className="row"><span>Margen bruto</span><strong>{pctTxt(currentRatios.grossMargin)}</strong></div>
                <div className="row"><span>Margen neto del IPV</span><strong>{pctTxt(currentRatios.netMargin)}</strong></div>
                <div className="row"><span>Gastos / ganancia neta</span><strong>{pctTxt(currentRatios.expenseBurden)}</strong></div>
                <div className="row"><span>Resultado económico / ventas</span><strong>{pctTxt(currentRatios.resultMargin)}</strong></div>
                <div className="row"><span>Merma a costo</span><strong>{fmtCUP(eco.merma)}<span className="small muted"> · {pctTxt(currentRatios.shrinkShare)} del costo vendido</span></strong></div>
              </div>
            </ChartCard>

            <ChartCard title="Impacto administrativo">
              <div style={{ background: 'var(--surface-tonal)', borderRadius: 20, padding: 20, textAlign: 'center' }}>
                <p className="small" style={{ fontWeight: 600, color: 'var(--dim)', margin: 0 }}>Pendiente administrativo / ganancia neta</p>
                <p className="big-figure" style={{ margin: '8px 0 0' }}>{pctTxt(ratio(eco.cuentasPorCobrar.administrativos, eco.neta))}</p>
                <p className="small muted" style={{ margin: '8px auto 0', maxWidth: 340 }}>Relación de las cuentas pendientes de Dayami, Jesús y Alejandro con la ganancia neta. Es una lectura económica: no se resta otra vez del resultado oficial.</p>
              </div>
              {onGoCobrar ? (
                <button type="button" onClick={onGoCobrar} style={{ marginTop: 12, background: 'none', border: 0, padding: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>
                  Ver el detalle en Cobrar →
                </button>
              ) : null}
            </ChartCard>
          </div>

          <div className="economy-pair-grid">
            <ChartCard title="Participación de gastos por categoría">
              {eco.gastosPorCategoria.length === 0 ? (
                <p className="small muted">No hay gastos registrados en este período.</p>
              ) : (
                <div>
                  {eco.gastosPorCategoria.map((category) => {
                    const pctOfTotal = eco.gastos > 0 ? (category.total / eco.gastos) * 100 : 0
                    return (
                      <div key={category.name} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, fontSize: '.9rem' }}>
                          <span>{category.name} <span className="small muted">({fmtInt(expenseCatCounts.get(category.name) ?? 0)})</span></span>
                          <strong>{pctOfTotal.toFixed(1)}%</strong>
                        </div>
                        <div style={{ marginTop: 6, height: 10, overflow: 'hidden', borderRadius: 999, background: 'var(--surface-tonal)' }}>
                          <div style={{ height: '100%', borderRadius: 999, background: 'var(--gold)', width: `${maxExpenseCat > 0 ? (category.total / maxExpenseCat) * 100 : 0}%` }} />
                        </div>
                        <p className="small muted" style={{ margin: '4px 0 0', textAlign: 'right' }}>{fmtCUP(category.total)}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </ChartCard>

            <ChartCard title={`Evolución de márgenes · ${monthLabel(prevMonthKey)}`}>
              {eco.daysCount === 0 || ecoPrev.daysCount === 0 ? (
                <p className="small muted">El análisis necesita al menos un día importado en ambos períodos. Actual: {fmtInt(eco.daysCount)}; anterior: {fmtInt(ecoPrev.daysCount)}.</p>
              ) : (
                <>
                  <p className="small muted">Compara porcentajes, no los totales que ya están en Inicio. Actual: {fmtInt(eco.daysCount)} día{eco.daysCount === 1 ? '' : 's'} con datos · anterior: {fmtInt(ecoPrev.daysCount)}.</p>
                  <div className="rec-detail">
                    {comparisonRows.map((row) => {
                      const difference = row.current != null && row.previous != null ? row.current - row.previous : null
                      const favorable = difference == null ? null : row.lowerBetter ? difference <= 0 : difference >= 0
                      return (
                        <div className="row" key={row.label}>
                          <span>{row.label}</span>
                          <strong>{pctTxt(row.current)} <span className="small" style={{ color: favorable == null ? 'var(--dim)' : favorable ? 'var(--accent)' : 'var(--danger)' }}>{difference == null ? 'sin base comparable' : `${difference >= 0 ? '+' : ''}${difference.toFixed(1)} puntos`}</span></strong>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </ChartCard>
          </div>

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
              {cierreRow('Utilidad neta (resultado: neta − gastos)', fmtCUP(eco.resultado))}
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

          {/* Gastos del mes */}
          <Card>
            <h3>Gastos de {monthLabel(monthKey)}</h3>
            <p className="sub">
              {fmtInt(eco.gastosCount)} registro(s) por {fmtCUP(eco.gastos)}: los manuales, los que el IPV trae en su Desglose («ipv-cuentas») y el gasto automático de cada nómina registrada («auto-rh»).
              {eco.gastosPorOrigen.length > 0 ? ` Por origen: ${eco.gastosPorOrigen.map((g) => `${ORIGIN_LABEL[g.name] ?? g.name} ${fmtCUP(g.total)}`).join(' · ')}.` : ''}
            </p>
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
