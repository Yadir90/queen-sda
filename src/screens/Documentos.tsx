import { useMemo, useState } from 'react'
import {
  buildBackupExport, buildInformeData, buildMenuData, buildNominaDocumento,
  buildPptxBlob, informeHtml, menuHtml, nominaHtml, payrollCyclesAvailable,
  withStampImage, DOC_STYLE,
} from '../lib/documentosCore.mjs'
import { downloadBlob, downloadText, printHtml } from '../lib/download'
import { requireBiometricUnlock } from '../lib/webauthn'
import { canExportBackup, exportNeedsBiometric } from '../lib/permissions'
import { logActivity } from '../lib/activityLog'
import type { StoredData } from '../types'
import { fmtCUP, fmtDate } from '../lib/utils'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import { MediaImage } from '../components/MediaImage'
import { useMediaUrl } from '../lib/media'
import { BRAND_CUNO_URL, BRAND_LOGO_URL } from '../lib/brandAssets'

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
 *  - El CUÑO APROBADO es un activo fijo del cliente y SÍ viaja
 *    por la media autenticada (tabla media · activo-sistema ·
 *    cuno-la-reina-aprobado): cuando está cargado, openDoc lo
 *    incrusta en el bloque de certificación sustituyendo el texto
 *    «Cuño no disponible en este dispositivo.» — el mismo cuño
 *    que el original usa para certificar. En modo local (sin
 *    Supabase) o sin la fila en media, el bloque queda con ese
 *    texto del original. Los trazos de firma personales siguen
 *    marcados «Firma autorizada pendiente»: la firma de cada
 *    persona se guarda en su ficha de RH (media · firma-trabajador)
 *    y el bloque de documentos no la sustituye por su cuenta.
 *  - El menú queda EXCLUIDO de firma y cuño (regla del dueño)
 *    y la regla de cocina deja fuera camarón, langosta, res y
 *    tortuga: los productos señalados se reportan, no se sirven.
 *  - Candado biométrico (AÑADIDO DEL DUEÑO en esta copia,
 *    2026-10-26): todas las exportaciones pasan por runExport →
 *    lib/webauthn.requireBiometricUnlock; con credencial WebAuthn
 *    registrada, el servidor verifica la huella/cara antes de
 *    exportar. Sin credencial, la exportación sigue como siempre.
 */
export default function Documentos({ data, today, isAdmin }: { data: StoredData; today: string; isAdmin: boolean }) {
  /* Rol de esta sesión para las capacidades de permissions.ts:
     admin o lectura (Jesús, Dayami y Yan). */
  const role = isAdmin ? 'admin' : 'lectura'
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

  // Cuño APROBADO real: primero la media autenticada (activo fijo);
  // si no está cargada, el activo EMPAQUETADO byte a byte (D-30,
  // brandAssets): el cuño existe siempre, también en modo local.
  const mediaStampUrl = useMediaUrl('activo-sistema', 'cuno-la-reina-aprobado')
  const stampUrl = mediaStampUrl ?? BRAND_CUNO_URL

  /* Candado biométrico (AÑADIDO DEL DUEÑO en esta copia,
     2026-10-26): toda exportación de documentos pasa por aquí. Si
     el usuario tiene credencial WebAuthn registrada, el servidor
     verifica su huella/cara antes de exportar; sin credencial (o
     sin el despliegue de la pieza), la exportación sigue como
     siempre y este guardián deja pasar sin pedir nada. */
  const runExport = async (action: () => void, label = 'un documento') => {
    /* Permiso del dueño (2026-10-26): el rol lectura exporta SIN
       candado biométrico; el candado sigue guardando las
       exportaciones del administrador (exportNeedsBiometric). */
    if (!exportNeedsBiometric(role)) {
      action()
      /* Registro de actividad (dueño, 15:02): la exportación de un
         usuario del equipo queda en la Cronología del admin. */
      logActivity('exportacion', `Exportó ${label}`, { section: 'documentos' })
      return
    }
    const unlock = await requireBiometricUnlock()
    if (!unlock.ok) {
      setMsg(`Exportación cancelada: ${unlock.reason ?? 'la verificación biométrica no se completó.'}`)
      logActivity('fallido', `Exportación de ${label} cancelada: la verificación biométrica no se completó`, { section: 'documentos' })
      return
    }
    action()
  }

  const openDoc = (html: string, label: string) => {
    // Con el cuño cargado, la zona del cuño del documento se
    // sustituye entera por la imagen real (withStampImage): sin
    // el anillo dibujado del núcleo ni el texto de ausencia
    // apilados sobre la imagen, como salía antes.
    const finalHtml = stampUrl ? withStampImage(html, stampUrl) : html
    setMsg(printHtml(finalHtml) ? `${label}: se abrió la vista del documento — desde ahí se imprime o se guarda como PDF.` : 'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
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
        <p className="eyebrow">Certificación</p>
        <h2>Firmas y cuño</h2>
        <p className="sub">
          El cuño APROBADO es el activo real del sistema original: llega por la media autenticada
          y, si esta no está cargada, por el activo empaquetado byte a byte en la propia app (D-30);
          se incrusta en el bloque de certificación de la nómina y el informe. Las firmas personales
          se firman en la ficha de cada persona en RH; sin firma registrada, el documento lo declara.
        </p>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <MediaImage
            kind="activo-sistema" entityKey="cuno-la-reina-aprobado" alt="Cuño APROBADO de La Reina"
            className="stamp-preview"
            fallback={<img src={BRAND_CUNO_URL} alt="Cuño APROBADO de La Reina" className="stamp-preview" />}
          />
          <MediaImage
            kind="activo-sistema" entityKey="la-reina-logo" alt="Logotipo de La Reina"
            style={{ width: 120, height: 120, objectFit: 'contain' }}
            fallback={<img src={BRAND_LOGO_URL} alt="Logotipo de La Reina" style={{ width: 120, height: 120, objectFit: 'contain' }} />}
          />
        </div>
      </Card>

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
              {['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][Number(mk.slice(5, 7)) - 1]} de {mk.slice(0, 4)}
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
              <button className="btn primary" onClick={() => void runExport(() => openDoc(informeHtml(informe), 'Informe'), 'el informe (PDF)')}>Abrir informe (PDF)</button>
              <button className="btn" onClick={() => void runExport(() => { downloadBlob(buildPptxBlob(informe), `presentacion-economia-${activeMonth}.pptx`); setMsg('Presentación descargada (.pptx) con las cifras del mes.') }, 'la presentación (.pptx)')}>Descargar presentación (.pptx)</button>
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
              <button className="btn primary" onClick={() => void runExport(() => openDoc(nominaHtml(nomina), 'Nómina'), 'la nómina (PDF)')}>Abrir nómina (PDF)</button>
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
          <button className="btn primary" disabled={!menu.itemCount} onClick={() => void runExport(() => openDoc(menuHtml(menu), 'Menú'), 'el menú (PDF)')}>Abrir menú (PDF)</button>
        </div>
      </Card>

      {canExportBackup(role) ? (
      <Card>
        <p className="eyebrow">Respaldo · Ida y vuelta</p>
        <h2>Exportar respaldo del sistema</h2>
        <p className="sub">
          El formato JSON del respaldo ({'{'}backupOf, exportedAt, data{'}'}): se
          puede reimportar aquí mismo desde «Importar» y reproduce los mismos totales. Incluye días,
          cuentas, gastos, nóminas, trabajadores y el estado de transferencias reconstruido.
        </p>
        <button
          className="btn primary"
          onClick={() => void runExport(() => {
            const backup = buildBackupExport(data, today)
            downloadText(JSON.stringify(backup, null, 2), `backup-sda-${today}.json`, 'application/json;charset=utf-8')
            setMsg(`Respaldo exportado: ${data.days.length} días. Guárdalo donde guardas los respaldos diarios.`)
          }, 'el respaldo del sistema')}
        >
          Descargar respaldo (.json)
        </button>
        <p className="small muted" style={{ marginTop: 10 }}>
          {DOC_STYLE.systemName} · {DOC_STYLE.business}
        </p>
      </Card>
      ) : null}
    </section>
  )
}
