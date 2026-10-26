import { useMemo, useState, type CSSProperties } from 'react'
import type { DayData, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import ImportBackup from '../components/ImportBackup'
import ImportIpv from '../components/ImportIpv'
import { fmtCUP, fmtDate, fmtDateShort, fmtInt, MONTH_NAMES, todayISO } from '../lib/utils'
import { downloadText } from '../lib/download'
import { deleteDay, supabaseConfigured } from '../lib/backend'
import { sbDeleteDay } from '../lib/supabaseBackend'
import IpvDownloads from '../components/IpvDownloads'

const SB_MODE = supabaseConfigured()

/** Días con decimales como en RH (0,5 sin redondear a 1). */
function fmtDias(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

/* Rejilla de cuadrados del mes (DiasMonthGrid del original): calendario
   L–D del mes ENTERO. Intensidad en 4 niveles según la venta frente a la
   mejor del mes; día sin IPV = borde punteado, sin relleno (ausencia, no
   cero); «Punta» = punto dorado en la esquina del mejor día + rótulo;
   hoy = anillo dorado; seleccionado = doble anillo. Al tocar un día con
   IPV se abre su detalle debajo. */
function DiasMonthGrid({ monthKey, days, selectedDay, onSelect }: {
  monthKey: string
  days: DayData[]
  selectedDay: string | null
  onSelect: (date: string) => void
}) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const maxVentas = days.reduce((m, d) => Math.max(m, d.ventasDia), 0)
  const best = days.length ? days.reduce((a, b) => (b.ventasDia > a.ventasDia ? b : a)) : null
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const monthLabel = `${MONTH_NAMES[month - 1]} de ${year}`
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1, 12).getDay() + 6) % 7
  const cells: Array<string | null> = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const levelOf = (v: number) => (maxVentas <= 0 || v <= 0 ? 0 : v / maxVentas <= 0.25 ? 1 : v / maxVentas <= 0.5 ? 2 : v / maxVentas <= 0.75 ? 3 : 4)
  const levelColor = (l: number) => l === 0 ? 'var(--surface-tonal)' : l === 1 ? 'color-mix(in srgb, #23aa70 28%, var(--surface-tonal))' : l === 2 ? 'color-mix(in srgb, #23aa70 52%, var(--surface-tonal))' : l === 3 ? 'color-mix(in srgb, #23aa70 76%, var(--surface-tonal))' : '#23aa70'
  const hoy = todayISO()
  return (
    <div>
      <p className="dias-head">
        <span className="dias-month">{monthLabel}</span>
        <span className="dias-meta">{fmtInt(days.length)} {days.length === 1 ? 'día' : 'días'} con IPV</span>
        {best && maxVentas > 0 ? (
          <span className="dias-meta"><i className="punta-dot-inline" aria-hidden /> Punta: {fmtDateShort(best.date)} · {fmtCUP(best.ventasDia)}</span>
        ) : null}
      </p>
      <div className="dias-dow" aria-hidden="true">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((l) => <span key={l}>{l}</span>)}
      </div>
      <div className="dias-grid" role="group" aria-label={`Días de ${monthLabel}: toca un día con IPV para ver su detalle`}>
        {cells.map((date, i) => {
          if (date === null) return <div key={`vacio-${i}`} aria-hidden="true" />
          const s = byDate.get(date)
          const dayNum = date.slice(8).replace(/^0/, '')
          if (!s) {
            return (
              <div key={date} title={`${fmtDate(date)}: sin IPV importado`} className="dias-cell no-ipv">
                {dayNum}
              </div>
            )
          }
          const level = levelOf(s.ventasDia)
          const selected = selectedDay === date
          /* D-39: el cuadre se anuncia «exacto» con el umbral del
             original (|cuadre| < 0,005, no === 0) y el aria-label
             lleva el conteo de productos del día, como el suyo. */
          const exacto = Math.abs(s.cuadre) < 0.005
          const productCount = s.departments.reduce((n, d) => n + d.products.length, 0)
          const style: CSSProperties = {
            background: levelColor(level),
            boxShadow: selected ? '0 0 0 2px var(--surface), 0 0 0 4px var(--deep)' : date === hoy ? '0 0 0 2px var(--gold)' : undefined,
            color: level >= 3 ? '#fff' : 'var(--text)',
          }
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={selected}
              aria-label={`Ver el IPV del ${fmtDate(date)}: ventas ${fmtCUP(s.ventasDia)}, ganancia neta ${fmtCUP(s.gananciaNeta)}, cuadre ${exacto ? 'exacto' : fmtCUP(s.cuadre)}, ${fmtInt(productCount)} productos`}
              title={`${fmtDateShort(date)} · Ventas ${fmtCUP(s.ventasDia)} · ganancia neta ${fmtCUP(s.gananciaNeta)} · cuadre ${exacto ? 'exacto' : fmtCUP(s.cuadre)}`}
              style={style}
              className="dias-cell"
            >
              {dayNum}
              {best && date === best.date && maxVentas > 0 ? <span aria-hidden="true" className="punta-dot" /> : null}
            </button>
          )
        })}
      </div>
      <div className="dias-legend" aria-label="Leyenda de intensidad por venta del día">
        {[1, 2, 3, 4].map((l) => (
          <span key={l}><i aria-hidden="true" style={{ background: levelColor(l) }} />{l === 1 ? 'Hasta ¼' : l === 2 ? 'Hasta ½' : l === 3 ? 'Hasta ¾' : 'La mayor'} de la mejor venta</span>
        ))}
        <span><i aria-hidden="true" className="legend-no-ipv" />Sin IPV</span>
      </div>
    </div>
  )
}

export default function Dias({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showIpv, setShowIpv] = useState(false)
  const [showIpvEdit, setShowIpvEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const today = todayISO()

  /* Eliminar el día (D-07): acción sensible e irreversible — en el
     original exige autorización reforzada de nivel explícito (ámbito
     «delete-ipv»); aquí la imponen la sesión de administrador y esta
     confirmación expresa con el resumen de lo que se retira. */
  const doDeleteDay = async (date: string) => {
    setDeleting(true)
    setDeleteError(null)
    try {
      if (SB_MODE) await sbDeleteDay(date)
      else deleteDay(date)
      setConfirmDelete(false)
      setSelected(null)
      onChanged()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'No se pudo eliminar el día.')
    } finally {
      setDeleting(false)
    }
  }

  const months = useMemo(() => {
    const map = new Map<string, DayData[]>()
    for (const d of data.days) {
      const key = d.date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data.days])

  // Huecos vencidos: días sin importar entre el primero y el último día
  // importado (y solo hasta ayer: el de hoy puede estar en curso).
  const gaps = useMemo(() => {
    if (data.days.length < 2) return []
    const have = new Set(data.days.map((d) => d.date))
    const sorted = [...have].sort()
    const out: string[] = []
    const cursor = new Date(`${sorted[0]}T12:00:00`)
    const end = new Date(`${sorted[sorted.length - 1]}T12:00:00`)
    while (cursor <= end) {
      /* Sin toISOString() (UTC): la fecha sale de las partes locales
         del mediodía, inmune a la zona del dispositivo (D-04). */
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      if (!have.has(iso) && iso < today) out.push(iso)
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }, [data.days, today])

  // Descargar el día: resumen generado en el dispositivo con los datos
  // reales de ese IPV (la utilidad de descarga existente). No es el
  // Excel del IPV: el archivo original y su versión actualizada se
  // descargan aparte, desde la media autenticada (IpvDownloads),
  // cuando existen para esa fecha.
  const downloadDay = (d: DayData) => {
    const lines = [
      `Resumen del día — ${fmtDate(d.date)}`,
      'Queen SDA — Sistema de Automatización de Datos V2.0 · Restaurante-bar La Reina',
      '',
      `Ventas del día: ${fmtCUP(d.ventasDia)}`,
      `Ganancia bruta: ${fmtCUP(d.gananciaBruta)}`,
      `Ganancia neta: ${fmtCUP(d.gananciaNeta)}`,
      `Cuadre: ${d.cuadre === 0 ? '0 — CUADRE OK' : fmtCUP(d.cuadre)}`,
      `Gastos del IPV: ${fmtCUP(d.gastosIpv)}`,
      '',
      'Fondos',
      `Efectivo (arqueo): ${fmtCUP(d.fondos.efectivo)}`,
      `Transferencias: ${fmtCUP(d.fondos.transferencias)}`,
      `Cuentas por cobrar del día: ${fmtCUP(d.fondos.totalCuentasPorCobrar)}`,
      `Divisas (en CUP): ${fmtCUP(d.fondos.divisasCUP)}`,
      `Zelle: ${fmtCUP(d.fondos.zelle)}`,
      `Total de fondos: ${fmtCUP(d.fondos.totalFondos)}`,
      '',
      'Departamentos',
      ...d.departments.map((dep) => `${dep.name}: ${fmtCUP(dep.ventas)} (ganancia ${fmtCUP(dep.ganancia)})`),
      ...(d.fondos.cuentasDetalle?.length ? ['', 'Cuentas del Desglose', ...d.fondos.cuentasDetalle.map((c) => `${c.nombre}${c.observacion ? ` · ${c.observacion}` : ''}: ${fmtCUP(c.saldo)}`)] : []),
      ...(d.rh?.length ? [
        '',
        `RH del día — foto del IPV${d.rhFechas?.length ? ` (marcas del ${fmtDate(d.rhFechas[0])} al ${fmtDate(d.rhFechas[d.rhFechas.length - 1])})` : ''}`,
        ...d.rh.map((e) => `${e.nombre}${e.ocupacion ? ` · ${e.ocupacion}` : ''}: ${fmtDias(e.dias)} día${e.dias === 1 ? '' : 's'} · ${fmtDias(e.dias * 12)} h · a cobrar ${fmtCUP(e.totalCobrar)}`),
        `Total a cobrar RH: ${fmtCUP(d.rh.reduce((t, e) => t + e.totalCobrar, 0))}`,
      ] : []),
      '',
      'Estas cifras son las del IPV, sin tocar: el IPV es la fuente de verdad.',
    ]
    downloadText(lines.join('\n'), `resumen-dia-${d.date}.txt`)
  }

  const day: DayData | undefined = data.days.find((d) => d.date === selected)
  const todayImported = data.days.some((d) => d.date === today)

  const freshCard = (
    <Card>
      <div className="fresh-ipv">
        <span className="row-ico"><Icon name="calendar" size={22} /></span>
        <div className="grow">
          <h3 style={{ margin: 0 }}>IPV de hoy listo para llenar</h3>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            {todayImported
              ? `El IPV de hoy (${fmtDate(today)}) ya está importado en esta copia.`
              : 'En esta copia puedes subir el Excel del IPV del día tal como salió de la plantilla, o traer los días con el respaldo del SDA.'}
          </p>
        </div>
        {isAdmin ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => setShowIpv((v) => !v)}>Importar IPV (Excel)</button>
            <button className="btn" onClick={() => setShowImport((v) => !v)}>Importar respaldo</button>
          </div>
        ) : null}
      </div>
      {isAdmin && showIpv ? <div style={{ marginTop: 14 }}><ImportIpv onImported={onChanged} existingDays={data.days} data={data} /></div> : null}
      {isAdmin && showImport ? <div style={{ marginTop: 14 }}><ImportBackup onImported={onChanged} /></div> : null}
    </Card>
  )

  if (data.days.length === 0) {
    return (
      <div>
        <TabHeader icon="calendar" title="Días" desc="Respaldos importados y su revisión" badge={TAB_BADGES.dias} />
        {freshCard}
        <Card>
          <EmptyState icon="calendar" title="Sin días importados" text="Los días llegan importando el IPV de cada día en Excel o con el respaldo del SDA." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <TabHeader icon="calendar" title="Días" desc="Respaldos importados y su revisión" badge={TAB_BADGES.dias} />
      {freshCard}

      {gaps.length ? (
        <Card className="warn-card">
          <h3>Huecos vencidos</h3>
          <p className="sub" style={{ margin: 0 }}>
            {fmtInt(gaps.length)} {gaps.length === 1 ? 'día sin importar' : 'días sin importar'} entre el primer y el último día cargado: {gaps.map((g) => fmtDateShort(g)).join(', ')}.
            Un día ausente no cuenta como venta 0 en ningún total.
          </p>
        </Card>
      ) : null}

      {months.map(([month, days]) => (
        <Card key={month}>
          <DiasMonthGrid monthKey={month} days={days} selectedDay={selected} onSelect={(date) => setSelected(date === selected ? null : date)} />
        </Card>
      ))}

      {day ? (
        <Card>
          <p className="eyebrow">Detalle del día</p>
          <h2>{fmtDate(day.date)}</h2>
          <table className="kv">
            <tbody>
              <tr><td>Ventas del día</td><td>{fmtCUP(day.ventasDia)}</td></tr>
              <tr><td>Ganancia bruta</td><td>{fmtCUP(day.gananciaBruta)}</td></tr>
              <tr><td>Ganancia neta</td><td>{fmtCUP(day.gananciaNeta)}</td></tr>
              <tr><td>Cuadre</td><td>{day.cuadre === 0 ? '0 ✓ CUADRE OK' : `${fmtCUP(day.cuadre)} — ${day.fondos.totalFondos > day.ventasDia ? `sobran fondos por ${fmtCUP(day.fondos.totalFondos - day.ventasDia)}` : day.fondos.totalFondos < day.ventasDia ? `faltan fondos por ${fmtCUP(day.ventasDia - day.fondos.totalFondos)}` : 'no cuadrado'}`}</td></tr>
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
          {day.fondos.cuentasDetalle?.length ? (
            <>
              <h3 style={{ marginTop: 18 }}>Cuentas del Desglose</h3>
              {day.fondos.cuentasDetalle.map((c, i) => (
                <div className="level-row" key={`${c.nombre}-${i}`}>
                  <span className="level-name">{c.nombre}{c.observacion ? ` · ${c.observacion}` : ''}</span>
                  <span className="level-val">{fmtCUP(c.saldo)}</span>
                </div>
              ))}
            </>
          ) : null}
          {day.rh?.length ? (
            <>
              <h3 style={{ marginTop: 18 }}>RH del día — por trabajador</h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                Foto de RH de este IPV{day.rhFechas?.length ? ` · marcas del ${fmtDate(day.rhFechas[0])} al ${fmtDate(day.rhFechas[day.rhFechas.length - 1])}` : ''}. Jornada de 12 h por día marcado (10:00 am–10:00 pm), como en RH.
              </p>
              <div className="rh-table-wrap">
                <table className="rh-table">
                  <thead>
                    <tr><th>Trabajador</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>A cobrar</th></tr>
                  </thead>
                  <tbody>
                    {day.rh.map((e, i) => (
                      <tr key={`${e.nombre}-${i}`}>
                        <td>{e.nombre}{e.ocupacion ? <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{e.ocupacion}</span> : null}</td>
                        <td style={{ textAlign: 'right' }}>{fmtDias(e.dias)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtDias(e.dias * 12)} h</td>
                        <td style={{ textAlign: 'right' }}><strong>{fmtCUP(e.totalCobrar)}</strong></td>
                      </tr>
                    ))}
                    <tr>
                      <td><strong>Total RH del día</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmtDias(day.rh.reduce((t, e) => t + e.dias, 0))}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmtDias(day.rh.reduce((t, e) => t + e.dias * 12, 0))} h</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmtCUP(day.rh.reduce((t, e) => t + e.totalCobrar, 0))}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <p className="small muted">Estas cifras son las del IPV, sin tocar: el IPV es la fuente de verdad.{isAdmin ? ' Si el IPV de este día se corrigió, súbelo de nuevo con «Editar este IPV»: el archivo nuevo reemplaza al guardado, misma fecha, sin duplicar.' : ''}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn" onClick={() => downloadDay(day)}>Descargar el día</button>
            {/* IPV original/actualizado de este día desde la media
                autenticada, cuando el archivo existe (como el
                historial de versiones del original). */}
            <IpvDownloads date={day.date} data={data} />
            {isAdmin ? (
              <button className="btn danger" disabled={deleting} onClick={() => { setConfirmDelete((v) => !v); setDeleteError(null) }}>
                Eliminar el día
              </button>
            ) : null}
          </div>
          {isAdmin && confirmDelete ? (
            <div className="error-box" style={{ marginTop: 12 }} role="alert">
              <p style={{ margin: '0 0 6px' }}><strong>Eliminar el IPV del {fmtDate(day.date)} es irreversible.</strong></p>
              <p className="small" style={{ margin: '0 0 10px' }}>
                Se retira el día completo (ventas {fmtCUP(day.ventasDia)}, departamentos, productos, entradas y foto de RH),
                su foto de cuentas, las decisiones de «Cuentas» de ese día y su boletín si aún no se envió.
                Todo lo derivado se recalcula sin ese día; las cuentas ya pagadas no se borran jamás.
                Si el IPV estaba mal, la vía segura es «Editar este IPV» con el archivo corregido.
              </p>
              {deleteError ? <p className="small" style={{ margin: '0 0 10px' }}>{deleteError}</p> : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn danger" disabled={deleting} onClick={() => void doDeleteDay(day.date)}>
                  {deleting ? 'Eliminando…' : 'Sí, eliminar el día definitivamente'}
                </button>
                <button className="btn" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancelar</button>
              </div>
            </div>
          ) : null}
          {isAdmin ? (
            <>
              <button className="btn" onClick={() => setShowIpvEdit((v) => !v)}>Editar este IPV</button>
              {showIpvEdit ? <div style={{ marginTop: 14 }}><ImportIpv onImported={onChanged} existingDays={data.days} data={data} /></div> : null}
            </>
          ) : null}
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
