import { useMemo, useState } from 'react'
import {
  buildBackupExport, buildInformeData, buildMenuData, buildNominaDocumento,
  buildPptxBlob, informeHtml, menuHtml, nominaHtml, payrollCyclesAvailable,
  DOC_STYLE,
} from '../lib/documentosCore.mjs'
import { downloadBlob, downloadText, printHtml } from '../lib/download'
import type { StoredData } from '../types'
import { fmtCUP, fmtDate } from '../lib/utils'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'

/**
 * Documentos del sistema: nómina, informe de Economía, menú de
 * clientes, presentación y respaldo — generados EN EL NAVEGADOR
 * desde los mismos datos del núcleo, con el estilo premium de
 * los documentos del original (franja y fondo aurora de
 * docStyle) y su bloque de «Firmas y cuño».
 *
 * Diferencias honestas con el original:
 *  - El original genera el PDF en el servidor y lo entrega por
 *    «Archivo listo»; aquí el documento se descarga en el
 *    momento (vista imprimible que el navegador guarda como PDF).
 *  - Los trazos de firma y la foto del cuño NO viajan en el
 *    respaldo: el bloque lleva nombres y roles reales con las
 *    marcas «Firma autorizada pendiente» / «Cuño no disponible
 *    en este dispositivo.», los mismos textos del original
 *    cuando el trazo no está en el dispositivo.
 *  - El menú queda EXCLUIDO de firma y cuño (regla del dueño)
 *    y la regla de cocina deja fuera camarón, langosta, res y
 *    tortuga: los productos señalados se reportan, no se sirven.
 */
export default function Documentos({ data, today }: { data: StoredData; today: string }) {
  const months = useMemo(() => {
    const set = new Set(data.days.map((d) => d.date.slice(0, 7)))
    return [...set].sort().reverse()
  }, [data.days])
  const [monthKey, setMonthKey] = useState<string>('')
  const activeMonth = monthKey || months[0] || today.slice(0, 7)
  const cycles = useMemo(() => payrollCyclesAvailable(data), [data])
  const [cycleStart, setCycleStart] = useState<string>('')
  const activeCycle = cycleStart || cycles[0]?.cycleStart || ''

  const informe = useMemo(
    () => (data.days.length ? buildInformeData(data, activeMonth, today) : null),
    [data, activeMonth, today],
  )
  const nomina = useMemo(
    () => (activeCycle ? buildNominaDocumento(data, activeCycle) : null),
    [data, activeCycle],
  )
  const menu = useMemo(() => buildMenuData(data, today), [data, today])
  const [msg, setMsg] = useState<string | null>(null)

  const openDoc = (html: string, label: string) => {
    setMsg(printHtml(html) ? `${label}: se abrió la vista del documento — desde ahí se imprime o se guarda como PDF.` : 'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
  }

  return (
    <section>
      <TabHeader
        icon="doc"
        title="Documentos"
        desc="Nómina, informe, menú, presentación y respaldo, generados desde los mismos datos del sistema y descargables en el momento. Nada se calcula aparte: lo que no está registrado, no se inventa."
        badge={TAB_BADGES.documentos}
      />
      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}

      <Card>
        <p className="eyebrow">Economía · Cierre del mes</p>
        <h2>Informe de Economía</h2>
        <p className="sub">
          La lista completa del cierre: venta bruta, ganancias, gastos, extras, utilidad, barra, cocina,
          billar, inversión, merma, efectivo, zelle, total cobrado y cuentas por cobrar con el dinero en
          la calle (solo clientes). Con bloque de firmas: administrador y dirección, y cuño.
        </p>
        <div className="month-chips" role="group" aria-label="Mes del informe">
          {months.map((mk) => (
            <button key={mk} type="button" className={`chip-btn${mk === activeMonth ? ' active' : ''}`} onClick={() => setMonthKey(mk)}>
              {mk}
            </button>
          ))}
        </div>
        {informe ? (
          <>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <div className="stat"><div className="label">Venta bruta total</div><div className="value">{fmtCUP(informe.eco.ventas)}</div></div>
              <div className="stat"><div className="label">Ganancia neta</div><div className="value">{fmtCUP(informe.eco.neta)}</div></div>
              <div className="stat"><div className="label">Resultado del mes</div><div className="value">{fmtCUP(informe.eco.resultado)}</div></div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <button className="btn primary" onClick={() => openDoc(informeHtml(informe), 'Informe')}>Abrir informe (PDF)</button>
              <button className="btn" onClick={() => { downloadBlob(buildPptxBlob(informe), `presentacion-economia-${activeMonth}.pptx`); setMsg('Presentación descargada (.pptx) con las cifras del mes.') }}>Descargar presentación (.pptx)</button>
            </div>
          </>
        ) : <p className="small muted">Sin días importados todavía: el informe se genera cuando haya IPV cargados.</p>}
      </Card>

      <Card>
        <p className="eyebrow">RH · Nómina del ciclo</p>
        <h2>Nómina de salarios</h2>
        <p className="sub">
          La nómina del ciclo con su desglose de pago mixto (efectivo y transferencia) y el flujo de
          firmas completo: creada y revisada por el administrador, revisada por Economía y autorizada
          por la dirección, con cuño.
        </p>
        {cycles.length ? (
          <div className="field">
            <label htmlFor="doc-ciclo">Ciclo de RH</label>
            <select id="doc-ciclo" value={activeCycle} onChange={(e) => setCycleStart(e.target.value)}>
              {cycles.map((c) => (
                <option key={c.cycleStart} value={c.cycleStart}>
                  {fmtDate(c.cycleStart)} — {fmtDate(c.cycleEnd)} · {fmtCUP(c.total)} · {c.recorded ? 'registrada' : 'derivada'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {nomina ? (
          <>
            <table className="kv"><tbody>
              <tr><td>Trabajadores</td><td>{nomina.employees.length}</td></tr>
              <tr><td>Total a pagar</td><td>{fmtCUP(nomina.total)}</td></tr>
              <tr><td>En efectivo</td><td>{fmtCUP(nomina.totalEfectivo)}</td></tr>
              <tr><td>Por transferencia</td><td>{fmtCUP(nomina.totalTransferencia)}</td></tr>
              <tr><td>Estado</td><td>{nomina.recorded ? `Registrada · pago ${fmtDate(nomina.payDate)}` : 'Derivada del ciclo (aún sin registrar como pagada)'}</td></tr>
            </tbody></table>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn primary" onClick={() => openDoc(nominaHtml(nomina), 'Nómina')}>Abrir nómina (PDF)</button>
            </div>
          </>
        ) : <p className="small muted">Sin ciclos de RH con datos todavía.</p>}
      </Card>

      <Card>
        <p className="eyebrow">Para clientes · Sin firmas</p>
        <h2>Menú del día</h2>
        <p className="sub">
          Se genera solo desde Productos: lo que tiene existencia, a su precio de venta vigente. El menú
          no lleva firma ni cuño. La regla de cocina deja fuera camarón, langosta, res y tortuga.
        </p>
        <table className="kv"><tbody>
          <tr><td>Productos en el menú de hoy</td><td>{menu.itemCount}</td></tr>
          <tr><td>Secciones</td><td>{menu.sections.map((s) => s.section).join(' · ') || '—'}</td></tr>
        </tbody></table>
        {menu.excluded.length ? (
          <div className="error-box" style={{ marginTop: 12 }}>
            <strong>Excluidos por la regla de cocina</strong> (no salen en el menú):{' '}
            {menu.excluded.map((x) => `${x.name} (${x.rule})`).join(' · ')}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn primary" disabled={!menu.itemCount} onClick={() => openDoc(menuHtml(menu), 'Menú')}>Abrir menú (PDF)</button>
        </div>
      </Card>

      <Card>
        <p className="eyebrow">Respaldo · Ida y vuelta</p>
        <h2>Exportar respaldo del sistema</h2>
        <p className="sub">
          El mismo formato JSON del respaldo del original ({'{'}backupOf, exportedAt, data{'}'}): se
          puede reimportar aquí mismo desde «Sistema» y reproduce los mismos totales. Incluye días,
          cuentas, gastos, nóminas, trabajadores y el estado de transferencias reconstruido.
        </p>
        <button
          className="btn primary"
          onClick={() => {
            const backup = buildBackupExport(data, today)
            downloadText(JSON.stringify(backup, null, 2), `backup-sda-${today}.json`, 'application/json;charset=utf-8')
            setMsg(`Respaldo exportado: ${data.days.length} días. Guárdalo donde guardas los respaldos diarios.`)
          }}
        >
          Descargar respaldo (.json)
        </button>
        <p className="small muted" style={{ marginTop: 10 }}>
          {DOC_STYLE.systemName} · {DOC_STYLE.business}
        </p>
      </Card>
    </section>
  )
}
