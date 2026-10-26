import { useRef, useState } from 'react'
import { parseBackup } from '../lib/backupCore.mjs'
import { importBackup, supabaseConfigured } from '../lib/backend'
import { sbImportBackup } from '../lib/supabaseBackend'
import type { BackupSummary } from '../types'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { Card } from './ui'

const SB_MODE = supabaseConfigured()

interface Parsed {
  raw: unknown
  summary: BackupSummary
  receivablesCount: number
  exportedAt: string
}

/**
 * Importador de respaldo del SDA (solo admin).
 * Muestra la verificación ANTES de guardar y solo guarda tras confirmación.
 * El respaldo es la fuente de verdad: aquí no se ajusta ninguna cifra.
 */
export default function ImportBackup({ onImported, bare = false }: { onImported: () => void; bare?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File) => {
    setError(null)
    setDone(null)
    setParsed(null)
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const result = parseBackup(raw)
      setParsed({ raw, summary: result.summary, receivablesCount: result.receivables.length, exportedAt: result.meta.exportedAt })
    } catch (e) {
      setError(e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    }
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      if (SB_MODE) {
        // Modo Supabase: upsert idempotente en el servidor (RLS: solo admin).
        await sbImportBackup(parsed.raw)
        setDone(`Respaldo importado en Supabase: ${parsed.summary.count} días (${fmtDate(parsed.summary.from)} — ${fmtDate(parsed.summary.to)}) y ${fmtInt(parsed.receivablesCount)} cuentas. Reimportarlo no duplica datos.`)
      } else {
        importBackup(parsed.raw)
        setDone(`Respaldo importado: ${parsed.summary.count} días (${fmtDate(parsed.summary.from)} — ${fmtDate(parsed.summary.to)}). Reimportarlo no duplica datos.`)
      }
      setParsed(null)
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar el respaldo.')
    } finally {
      setBusy(false)
    }
  }

  const inner = (
    <>
      {bare ? null : (
        <>
          <p className="eyebrow">Datos · Solo administrador</p>
          <h2>Importar respaldo del SDA</h2>
        </>
      )}
      <p className="sub">
        Sube el archivo JSON de respaldo diario del sistema original. Antes de guardar verás la verificación
        completa del archivo; nada se guarda sin tu confirmación y ninguna cifra se ajusta en silencio.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      <button className="btn primary" onClick={() => fileRef.current?.click()}>Elegir archivo de respaldo</button>

      {error ? <div className="error-box" style={{ marginTop: 14 }}>{error}</div> : null}
      {done ? <div className="ok-box" style={{ marginTop: 14 }}>{done}</div> : null}

      {parsed ? (
        <div style={{ marginTop: 16 }}>
          <h3>Verificación del archivo — todavía NO se ha guardado nada</h3>
          <table className="kv">
            <tbody>
              <tr><td>Días en el respaldo</td><td>{fmtInt(parsed.summary.count)}</td></tr>
              <tr><td>Rango de fechas</td><td>{fmtDate(parsed.summary.from)} — {fmtDate(parsed.summary.to)}</td></tr>
              <tr><td>Ventas totales (suma de ventasDia)</td><td>{fmtCUP(parsed.summary.ventas)}</td></tr>
              <tr><td>Ganancia bruta total</td><td>{fmtCUP(parsed.summary.gananciaBruta)}</td></tr>
              <tr><td>Ganancia neta total</td><td>{fmtCUP(parsed.summary.gananciaNeta)}</td></tr>
              <tr><td>Cuadre</td><td>{parsed.summary.allSquared ? '0 en todos los días ✓' : `Descuadre total: ${fmtCUP(parsed.summary.cuadreTotal)}`}</td></tr>
              <tr><td>Cuentas en el respaldo</td><td>{fmtInt(parsed.receivablesCount)}</td></tr>
              {parsed.exportedAt ? <tr><td>Respaldo exportado</td><td>{parsed.exportedAt}</td></tr> : null}
            </tbody>
          </table>
          {!parsed.summary.allSquared ? (
            <div className="error-box" style={{ marginTop: 12 }}>
              Ojo: no todos los días cuadran a 0. Se importarán tal como vienen en el archivo — el sistema no corrige cifras del respaldo.
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Importando…' : 'Confirmar importación'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setParsed(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </>
  )
  return bare ? inner : <Card>{inner}</Card>
}
