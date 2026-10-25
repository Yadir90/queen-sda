import type { StoredData } from '../types'
import { Card, EmptyState, LevelRow, PillBars } from '../components/ui'
import { effectiveSaldo, fmtCUP, fmtDate, fmtDateShort, fmtInt, isMorosa, todayISO } from '../lib/utils'

export default function Inicio({ data, isAdmin, onImportClick }: { data: StoredData; isAdmin: boolean; onImportClick: () => void }) {
  if (data.days.length === 0) {
    return (
      <div>
        <h1 className="section-title">Inicio</h1>
        <Card>
          <p className="eyebrow">De un vistazo</p>
          <EmptyState icon="📭" title="Sin datos todavía" text="Este sistema externo aún no tiene días importados. Los datos reales entran importando el respaldo diario del SDA; aquí nunca verás cifras de ejemplo.">
            {isAdmin ? (
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={onImportClick}>Importar respaldo del SDA</button>
              </div>
            ) : (
              <p className="small muted" style={{ marginTop: 12 }}>Pídele al administrador que importe el respaldo para ver los datos.</p>
            )}
          </EmptyState>
        </Card>
      </div>
    )
  }

  const ref = todayISO()
  const ventas = data.days.reduce((s, d) => s + d.ventasDia, 0)
  const bruta = data.days.reduce((s, d) => s + d.gananciaBruta, 0)
  const neta = data.days.reduce((s, d) => s + d.gananciaNeta, 0)
  const last = data.days[data.days.length - 1]
  const pending = data.receivables
    .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
    .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
  const dineroCalle = pending.filter((x) => x.rec.category === 'cliente').reduce((s, x) => s + x.saldo, 0)
  const vencidas = pending.filter((x) => isMorosa(x.rec, x.saldo, ref))
  const vencidasTotal = vencidas.reduce((s, x) => s + x.saldo, 0)

  // Ventas por departamento (suma de importeVenta de los productos de cada día importado)
  const deptMap = new Map<string, number>()
  for (const d of data.days) for (const dep of d.departments) deptMap.set(dep.name, (deptMap.get(dep.name) ?? 0) + dep.ventas)
  const depts = [...deptMap.entries()].sort((a, b) => b[1] - a[1])
  const deptMax = Math.max(...depts.map((d) => d[1]), 1)

  // Quincena contable (natural del mes del último día): 1–15 y 16–fin de mes
  const [ly, lm] = last.date.split('-').map(Number)
  const inMonth = data.days.filter((d) => {
    const [y, m] = d.date.split('-').map(Number)
    return y === ly && m === lm
  })
  const q1 = inMonth.filter((d) => Number(d.date.slice(8)) <= 15).reduce((s, d) => s + d.ventasDia, 0)
  const q2 = inMonth.filter((d) => Number(d.date.slice(8)) > 15).reduce((s, d) => s + d.ventasDia, 0)

  return (
    <div>
      <h1 className="section-title">Inicio</h1>
      <Card>
        <p className="eyebrow">De un vistazo</p>
        <h2>{fmtDate(data.days[0].date)} — {fmtDate(last.date)}</h2>
        <p className="sub">{fmtInt(data.days.length)} días importados desde el respaldo del SDA{data.exportedAt ? ` (exportado el ${data.exportedAt})` : ''}.</p>
        <div className="grid-3">
          <div className="stat"><div className="label">Ventas del período</div><div className="value">{fmtCUP(ventas)}</div></div>
          <div className="stat"><div className="label">Ganancia bruta</div><div className="value">{fmtCUP(bruta)}</div></div>
          <div className="stat"><div className="label">Ganancia neta</div><div className="value">{fmtCUP(neta)}</div></div>
          <div className="stat"><div className="label">Dinero en la calle (solo clientes)</div><div className="value">{fmtCUP(dineroCalle)}</div></div>
          <div className="stat"><div className="label">Cuentas vencidas</div><div className="value">{fmtInt(vencidas.length)}</div><div className="hint">{fmtCUP(vencidasTotal)} fuera de plazo</div></div>
          <div className="stat"><div className="label">Último día · {fmtDate(last.date)}</div><div className="value">{fmtCUP(last.ventasDia)}</div><div className="hint">Cuadre: {last.cuadre === 0 ? '0 ✓ cuadrado' : fmtCUP(last.cuadre)}</div></div>
        </div>
      </Card>

      <Card>
        <h3>Ventas por día</h3>
        <p className="sub">Cada barra es un día importado, tal como viene en el respaldo.</p>
        <PillBars values={data.days.map((d) => d.ventasDia)} labels={data.days.map((d) => fmtDateShort(d.date))} />
      </Card>

      <Card>
        <h3>Ventas por departamento</h3>
        {depts.map(([name, value]) => (
          <LevelRow key={name} name={name} value={value} max={deptMax} display={`${fmtCUP(value)} · ${ventas > 0 ? Math.round((value / ventas) * 100) : 0} %`} />
        ))}
      </Card>

      <Card>
        <h3>Quincena contable del mes del último día</h3>
        <p className="sub">Quincena natural del mes (1–15 y 16–fin de mes). No confundir con los ciclos de RH, que son de 15 días exactos y viven en su módulo.</p>
        <div className="grid-2">
          <div className="stat"><div className="label">1 – 15</div><div className="value">{fmtCUP(q1)}</div></div>
          <div className="stat"><div className="label">16 – fin de mes</div><div className="value">{fmtCUP(q2)}</div></div>
        </div>
      </Card>
    </div>
  )
}
