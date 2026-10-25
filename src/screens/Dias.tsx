import { useMemo, useState } from 'react'
import type { DayData, StoredData } from '../types'
import { Card, EmptyState } from '../components/ui'
import ImportBackup from '../components/ImportBackup'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'

export default function Dias({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  const months = useMemo(() => {
    const map = new Map<string, DayData[]>()
    for (const d of data.days) {
      const key = d.date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data.days])

  const day: DayData | undefined = data.days.find((d) => d.date === selected)

  if (data.days.length === 0) {
    return (
      <div>
        <h1 className="section-title">Días</h1>
        <Card>
          <EmptyState icon="📅" title="Sin días importados" text="Los días llegan con el respaldo del SDA o, en la siguiente fase, importando cada IPV en Excel.">
            {isAdmin ? (
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={() => setShowImport((v) => !v)}>Importar respaldo del SDA</button>
              </div>
            ) : null}
          </EmptyState>
        </Card>
        {isAdmin && showImport ? <ImportBackup onImported={onChanged} /> : null}
      </div>
    )
  }

  return (
    <div>
      <h1 className="section-title">Días</h1>
      {months.map(([month, days]) => {
        const max = Math.max(...days.map((d) => d.ventasDia), 1)
        const best = days.reduce((a, b) => (b.ventasDia > a.ventasDia ? b : a))
        const monthNum = Number(month.slice(5))
        const yearNum = Number(month.slice(0, 4))
        const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
        return (
          <Card key={month}>
            <h3 style={{ textTransform: 'capitalize' }}>{monthNames[monthNum - 1]} de {yearNum}</h3>
            <p className="sub">{fmtInt(days.length)} días · toca un día para ver su detalle tal como entró.</p>
            <div className="day-grid">
              {days.map((d) => {
                const ratio = d.ventasDia / max
                return (
                  <button
                    key={d.date}
                    className={`day-cell ${d.date === best.date ? 'best' : ''}`}
                    style={{ background: `linear-gradient(180deg, rgba(14,159,110,${(0.12 + ratio * 0.4).toFixed(2)}), var(--surface-2))` }}
                    onClick={() => setSelected(d.date === selected ? null : d.date)}
                  >
                    <span className="d-num">{Number(d.date.slice(8))}</span>
                    <span className="d-val">{fmtInt(d.ventasDia)}</span>
                    {d.date === best.date ? <small>Punta</small> : null}
                  </button>
                )
              })}
            </div>
          </Card>
        )
      })}

      {day ? (
        <Card>
          <p className="eyebrow">Detalle del día</p>
          <h2>{fmtDate(day.date)}</h2>
          <table className="kv">
            <tbody>
              <tr><td>Ventas del día</td><td>{fmtCUP(day.ventasDia)}</td></tr>
              <tr><td>Ganancia bruta</td><td>{fmtCUP(day.gananciaBruta)}</td></tr>
              <tr><td>Ganancia neta</td><td>{fmtCUP(day.gananciaNeta)}</td></tr>
              <tr><td>Cuadre</td><td>{day.cuadre === 0 ? '0 ✓ CUADRE OK' : `${fmtCUP(day.cuadre)} — no cuadrado`}</td></tr>
              <tr><td>Efectivo (arqueo)</td><td>{fmtCUP(day.fondos.efectivo)}</td></tr>
              <tr><td>Transferencias</td><td>{fmtCUP(day.fondos.transferencias)}</td></tr>
              <tr><td>Cuentas por cobrar del día</td><td>{fmtCUP(day.fondos.totalCuentasPorCobrar)}</td></tr>
              <tr><td>Divisas (en CUP)</td><td>{fmtCUP(day.fondos.divisasCUP)}</td></tr>
              <tr><td>Total de fondos</td><td>{fmtCUP(day.fondos.totalFondos)}</td></tr>
              <tr><td>Gastos del IPV</td><td>{fmtCUP(day.gastosIpv)}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 18 }}>Departamentos</h3>
          {day.departments.map((dep) => (
            <div className="level-row" key={dep.name}>
              <span className="level-name">{dep.name}</span>
              <span className="level-val">{fmtCUP(dep.ventas)}</span>
            </div>
          ))}
          <p className="small muted">Estas cifras son las del respaldo, sin tocar: el IPV es la fuente de verdad.</p>
        </Card>
      ) : null}

      {isAdmin ? (
        <>
          <button className="btn" onClick={() => setShowImport((v) => !v)}>Importar otro respaldo</button>
          {showImport ? <div style={{ marginTop: 16 }}><ImportBackup onImported={onChanged} /></div> : null}
        </>
      ) : null}
    </div>
  )
}
