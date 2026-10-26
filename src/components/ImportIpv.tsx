import { useRef, useState, type CSSProperties } from 'react'
import type { IpvDayPayload } from '../lib/ipvCore.mjs'
import { importIpvDay, supabaseConfigured } from '../lib/backend'
import { sbImportIpvDay } from '../lib/supabaseBackend'
import { downloadBlob } from '../lib/download'
import type { DayData, StoredData } from '../types'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { Card } from './ui'

const SB_MODE = supabaseConfigured()

const warnBoxStyle: CSSProperties = {
  background: 'var(--warn-soft)',
  border: '1px solid var(--gold)',
  borderRadius: 16,
  padding: '12px 14px',
  fontSize: '0.88rem',
  marginTop: 12,
}

interface Parsed {
  payload: IpvDayPayload
  rawDay: Record<string, unknown>
  existing: DayData | null
  file: File
}

/**
 * Importador del IPV del día en Excel (solo admin) — la vía diaria real,
 * como en el sistema original: el archivo se lee en el propio dispositivo
 * (puerto del lector original, src/lib/ipvCore.mjs), se muestra el
 * resumen de verificación ANTES de guardar y nada se guarda sin
 * confirmación. Las cifras del IPV jamás se modifican: si el cuadre no
 * es cero, se avisa y el día entra con su descuadre visible.
 *
 * Si la fecha ya existe, el flujo es el de «Editar este IPV»: aviso de
 * que ese día ya está importado y reemplazo con confirmación expresa
 * (misma fecha, sin duplicar).
 */
export default function ImportIpv({ onImported, existingDays, bare = false, data }: {
  onImported: () => void
  existingDays: DayData[]
  bare?: boolean
  /** Datos del sistema para la reconciliación del IPV de vuelta. */
  data?: StoredData
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [returnTrip, setReturnTrip] = useState<{ file: File; rawDay: Record<string, unknown>; date: string } | null>(null)
  const [buildingReturn, setBuildingReturn] = useState(false)
  const [returnMsg, setReturnMsg] = useState<string | null>(null)

  const downloadUpdated = async () => {
    if (!returnTrip || !data) return
    setBuildingReturn(true)
    setReturnMsg(null)
    try {
      const [{ buildIpvReconciliation }, { buildUpdatedIpv }] = await Promise.all([
        import('../lib/ipvReconciliation'),
        import('../lib/ipvRoundTrip'),
      ])
      const reconciliation = buildIpvReconciliation(data, returnTrip.date, returnTrip.rawDay as never, data.extraIncomes.map((x) => ({ date: x.date, concept: x.concept, note: x.note, amount: x.amount, paymentMethod: x.paymentMethod, origin: x.origin })))
      const blob = await buildUpdatedIpv(returnTrip.file, returnTrip.date, reconciliation.additions, reconciliation.productBarcodes, reconciliation.nameCorrections, reconciliation.templateFingerprint)
      downloadBlob(blob, `IPV ${returnTrip.date} actualizado.xlsx`)
      const total = reconciliation.additions.length
      setReturnMsg(total
        ? `IPV actualizado descargado: ${fmtInt(total)} fila${total === 1 ? '' : 's'} agregada${total === 1 ? '' : 's'} por el sistema (RH ${reconciliation.counts.rh} · Gastos ${reconciliation.counts.gastos} · Almacén ${reconciliation.counts.almacen} · Cuentas pagadas ${reconciliation.counts.cuentasPagadas}), sin tocar las cifras del archivo.`
        : 'IPV actualizado descargado: el sistema no tenía nada que agregarle a este día.')
    } catch (e) {
      setReturnMsg(e instanceof Error ? e.message : 'No se pudo construir el IPV actualizado.')
    } finally {
      setBuildingReturn(false)
    }
  }

  const onFile = async (file: File) => {
    setError(null)
    setDone(null)
    setParsed(null)
    setReturnTrip(null)
    setReturnMsg(null)
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Selecciona un archivo .xlsx de la plantilla IPV mejorada.')
      return
    }
    setReading(true)
    try {
      // El lector de Excel llega bajo demanda, igual que en el original:
      // no forma parte del arranque, solo de este gesto de importar.
      const { parseDayFile, ipvPayloadToRawDay } = await import('../lib/ipvCore.mjs')
      const payload = await parseDayFile(file)
      const rawDay = ipvPayloadToRawDay(payload)
      const existing = existingDays.find((d) => d.date === payload.date) ?? null
      setParsed({ payload, rawDay, existing, file })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setReading(false)
    }
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      if (SB_MODE) {
        await sbImportIpvDay(parsed.rawDay)
      } else {
        importIpvDay(parsed.rawDay)
      }
      const { payload, existing } = parsed
      setDone(existing
        ? `IPV del ${fmtDate(payload.date)} reemplazado: esta es ahora la versión vigente · venta ${fmtCUP(payload.ventasDia)} · ${fmtInt(payload.productCount)} productos · ganancia neta ${fmtCUP(payload.gananciaNeta)}.`
        : `IPV del ${fmtDate(payload.date)} registrado · venta ${fmtCUP(payload.ventasDia)} · ${fmtInt(payload.productCount)} productos · ganancia neta ${fmtCUP(payload.gananciaNeta)}.`)
      // El IPV de vuelta queda disponible: el mismo archivo, con lo que
      // el sistema le agrega (RH, gastos, almacén, cuentas pagadas) y
      // SIN tocar una cifra suya (reconciliación del original).
      setReturnTrip({ file: parsed.file, rawDay: parsed.rawDay, date: payload.date })
      setReturnMsg(null)
      setParsed(null)
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar el IPV.')
    } finally {
      setBusy(false)
    }
  }

  const p = parsed?.payload ?? null
  const fondos = p?.fondos ?? null
  const diff = fondos ? fondos.totalFondos - (p?.ventasDia ?? 0) : 0
  const cuentasDetalle = fondos?.cuentasDetalle ?? []
  const cuentasTotal = cuentasDetalle.reduce((s, c) => s + c.saldo, 0)
  const gastosTotal = (p?.gastosIpv ?? []).reduce((s, g) => s + g.total, 0)

  const inner = (
    <>
      {bare ? null : (
        <>
          <p className="eyebrow">Datos · Solo administrador</p>
          <h2>Importar IPV del día (Excel)</h2>
        </>
      )}
      <p className="sub">
        Sube el Excel del IPV del día, tal como salió de la plantilla. Se lee aquí mismo, en tu
        dispositivo; antes de guardar verás su verificación completa y nada se guarda sin tu
        confirmación. Ninguna cifra del IPV se ajusta: si el día no cuadra, entra con su
        descuadre visible.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      <button className="btn primary" disabled={reading} onClick={() => fileRef.current?.click()}>
        {reading ? 'Leyendo el IPV…' : 'Elegir archivo Excel del IPV'}
      </button>

      {error ? <div className="error-box" style={{ marginTop: 14 }}>{error}</div> : null}
      {done ? <div className="ok-box" style={{ marginTop: 14 }}>{done}</div> : null}
      {returnTrip && data ? (
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={buildingReturn} onClick={() => void downloadUpdated()}>
            {buildingReturn ? 'Construyendo el IPV actualizado…' : 'Descargar IPV actualizado'}
          </button>
          <p className="small muted" style={{ marginTop: 6 }}>
            El mismo libro que subiste, con lo que el sistema le agrega (RH, gastos, existencias y
            cuentas pagadas) en sus hojas — listo para enviar. El archivo original no se modifica.
          </p>
          {returnMsg ? <p className="small" role="status" style={{ marginTop: 6 }}>{returnMsg}</p> : null}
        </div>
      ) : null}

      {parsed && p ? (
        <div style={{ marginTop: 16 }}>
          <h3>Verificación del archivo — todavía NO se ha guardado nada</h3>
          <table className="kv">
            <tbody>
              <tr><td>Fecha detectada (hoja «Parámetros»)</td><td>{fmtDate(p.date)}</td></tr>
              <tr><td>Ventas del día</td><td>{fmtCUP(p.ventasDia)}</td></tr>
              <tr><td>Total de fondos</td><td>{fondos ? fmtCUP(fondos.totalFondos) : '—'}</td></tr>
              <tr>
                <td>Cuadre</td>
                <td>{p.cuadre === 0
                  ? '0 ✓ CUADRE OK'
                  : `${fmtCUP(p.cuadre)} — ${diff > 0 ? `SOBRANTE: sobran fondos por ${fmtCUP(diff)}` : `FALTANTE: faltan fondos por ${fmtCUP(-diff)}`}`}</td>
              </tr>
              <tr><td>Ganancia bruta</td><td>{fmtCUP(p.gananciaBruta)}</td></tr>
              <tr><td>Ganancia neta</td><td>{fmtCUP(p.gananciaNeta)}</td></tr>
              <tr><td>Productos leídos</td><td>{fmtInt(p.productCount)}</td></tr>
              {(p.departments ?? []).map((d) => (
                <tr key={d.name}><td>{d.name}</td><td>{fmtCUP(d.venta)}</td></tr>
              ))}
              <tr><td>Cuentas del Desglose</td><td>{fmtInt(cuentasDetalle.length)} · {fmtCUP(cuentasTotal)}</td></tr>
              <tr><td>Gastos del IPV</td><td>{fmtInt((p.gastosIpv ?? []).length)} · {fmtCUP(gastosTotal)}</td></tr>
              <tr><td>Cuentas pagadas que trae la hoja</td><td>{fmtInt((p.cuentasPagadas ?? []).length)}</td></tr>
              <tr>
                <td>Foto de RH</td>
                <td>{fmtInt((p.rh ?? []).length)} trabajadores · a cobrar {fmtCUP(p.totalRH ?? 0)}
                  {(p.rhFechas ?? []).length ? ` · marcas del ${fmtDate(p.rhFechas![0])} al ${fmtDate(p.rhFechas![p.rhFechas!.length - 1])}` : ''}</td>
              </tr>
            </tbody>
          </table>

          {p.cuadre !== 0 ? (
            <div style={warnBoxStyle}>
              Ojo: este IPV <strong>no cuadra a 0</strong> ({diff > 0 ? `sobran fondos por ${fmtCUP(diff)}` : `faltan fondos por ${fmtCUP(-diff)}`},
              según su propio Desglose). Se importará tal como viene — el sistema no corrige cifras del IPV.
            </div>
          ) : null}

          {parsed.existing ? (
            <div style={warnBoxStyle}>
              Ya existe un día importado para el <strong>{fmtDate(p.date)}</strong> (venta registrada:{' '}
              {fmtCUP(parsed.existing.ventasDia)}). Si confirmas, este archivo lo <strong>reemplaza</strong> por
              completo — misma fecha, sin duplicar — como el «Editar este IPV» del sistema original.
            </div>
          ) : null}

          {(p.warnings ?? []).length ? (
            <div style={warnBoxStyle}>
              <strong>Avisos de lectura del archivo:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {(p.warnings ?? []).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          ) : null}

          <p className="small muted" style={{ marginTop: 12 }}>
            Las cuentas del Desglose y la foto de RH quedan guardadas dentro del día. Las cuentas
            de Cobrar de esta copia se siguen alimentando del respaldo del SDA.
          </p>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Guardando…' : parsed.existing ? 'Reemplazar el día existente' : 'Confirmar importación'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setParsed(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </>
  )
  return bare ? inner : <Card>{inner}</Card>
}
