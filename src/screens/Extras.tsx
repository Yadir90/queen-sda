import { useMemo, useState } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Otros ingresos (oleada 3): espejo del ExtrasTab del original
   (App.tsx:9785) en LECTURA, alimentado de los extras que viajan
   dentro de cada día del respaldo (DayData.extras, la hoja
   «Entrada y mesas» del IPV: cobro de entrada, alquiler de mesas…).
   Las categorías son las cuatro del original (Coctelería,
   Pizzería, Entrada, Mesas) con su misma regla de clasificación
   por el texto del concepto; las ventas de coctelería y pizzería
   del IPV viven como departamentos (Cantina y Pizzas) dentro de
   las ventas del día y NO se duplican aquí — el total de esta
   pantalla cuadra con los «Ingresos extras» de Economía y del
   boletín (8500 en la foto del 26-oct: 4500 + 4000).
   LECTURA HONESTA: el registro manual de otros ingresos del
   original escribe en su servidor; esta copia no tiene esa tabla
   ni la simula, así que aquí no se añade, edita ni borra ningún
   ingreso, y la factura en PDF de extras del original tampoco se
   genera. Todo lo mostrado sale de un registro real del respaldo. */

type ExtraCat = 'cocteleria' | 'pizzeria' | 'entrada' | 'mesas'
const CAT_LABEL: Record<ExtraCat, string> = { cocteleria: 'Coctelería', pizzeria: 'Pizzería', entrada: 'Entrada', mesas: 'Mesas' }
const CAT_ORDER: ExtraCat[] = ['cocteleria', 'pizzeria', 'entrada', 'mesas']

/** Misma heurística del original (extraIncomeCategory) aplicada al
 *  concepto, que es lo único que viaja en el día del respaldo. */
function extraCategory(concepto: string): ExtraCat {
  const text = concepto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  if (/coctel|cantina|trago/.test(text)) return 'cocteleria'
  if (/pizza/.test(text)) return 'pizzeria'
  if (/mesa/.test(text)) return 'mesas'
  return 'entrada'
}

interface ExtraRow { date: string; concepto: string; importe: number; cat: ExtraCat }

export default function ExtrasTab({ data }: { data: StoredData }) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of data.days) set.add(d.date.slice(0, 7))
    return [...set].sort().reverse()
  }, [data.days])
  const [monthKey, setMonthKey] = useState('')
  const activeMonth = monthKey || months[0] || ''

  const allRows = useMemo<ExtraRow[]>(
    () => data.days.flatMap((d) => (d.extras ?? []).map((x) => ({
      date: d.date, concepto: x.concepto, importe: x.importe, cat: extraCategory(x.concepto),
    }))),
    [data.days],
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

  return (
    <div>
      <TabHeader
        icon="plus"
        title="Otros ingresos"
        desc="Dinero que entra sin ser venta de productos: al importar un IPV, los cobros de entrada y alquiler de mesas de su hoja «Entrada y mesas» aparecen aquí solos. Todo suma en su propia línea del Resultado."
        badge={TAB_BADGES.extras}
      />

      {months.length > 1 ? (
        <div className="view-chips" role="group" aria-label="Mes de los otros ingresos">
          {months.map((m) => (
            <button key={m} type="button" className={`view-chip ${m === activeMonth ? 'active' : ''}`} aria-pressed={m === activeMonth} onClick={() => setMonthKey(m)}>
              {fmtDate(`${m}-01`).replace(/^\d+ de /, '').replace(' de ', ' ')}
            </button>
          ))}
        </div>
      ) : null}

      {allRows.length === 0 ? (
        <EmptyState
          icon="plus"
          title="Sin otros ingresos registrados"
          text="Este respaldo no trae ningún ingreso extra: ningún día importado tuvo cobros en la hoja «Entrada y mesas» de su IPV. Sin registro real, la pantalla queda vacía."
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
                          <span className="small muted">{fmtDate(r.date)} · del IPV</span>
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
                    <span className="small muted">{fmtDate(r.date)} · {CAT_LABEL[r.cat]} · detectado del IPV</span>
                  </span>
                  <span className="chip">Del IPV</span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Pantalla de consulta: en el sistema original también se registran otros ingresos a mano y se
              genera su factura en PDF. Esta copia no tiene la tabla de registro manual del original ni su
              constructor de PDF, así que aquí no se añade ni se edita ningún ingreso y no se finge ningún
              documento: lo que ves es exactamente lo que entró por los IPV importados.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
