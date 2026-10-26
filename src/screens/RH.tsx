import { useMemo, useState } from 'react'
import type { PayrollEmployee, StoredData, Worker, WorkerExtended } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { WorkerPhoto } from '../components/MediaImage'
import WorkerRegistry from './WorkerRegistry'
import { extendedByWorker } from '../lib/workersExtended'
import { effectiveSaldo, fmtCUP, fmtDate, fmtDateShort, fmtInt, todayISO } from '../lib/utils'
import { saveRhSettings, supabaseConfigured } from '../lib/backend'
import { sbSaveRhSettings } from '../lib/supabaseBackend'
import {
  addDaysISO, buildMarksByWorker, canonicalPersonKey, cycleIndexFor, cycleWindow,
  deriveCyclePayroll, diffDays, isDirectionPerson, recordedPayroll,
} from '../lib/syncCore.mjs'
import '../components/sectionsMirror.css'

/* RH · Pagos — puerto del módulo de RH del sistema original:
   - Al principio, el organigrama del equipo en flujo de trabajo
     (OrganigramaEquipo, más abajo en este mismo archivo).
   - Ciclos exactos de 15 días desde el ancla configurable (def.
     2026-09-23); el pago cae el día 16. La quincena de RH NO es la
     quincena natural de Contabilidad.
   - La nómina de cada ciclo se lee de la foto de RH del IPV de cierre
     (o del historial registrado, que manda; o del ajuste manual del
     dueño, que manda sobre la foto). El salario nunca se asume del
     ciclo anterior.
   - Pago mixto efectivo/transferencia con la regla del original:
     efectivo + transferencia = total a cobrar de cada quien.
   - Interruptor «No pagado»: la persona sale de la nómina y del
     total; su importe queda visible como excluido.
   - Dirección (Jesús, Dayami): ficha informativa, fuera de nómina.
   - Cuadrados del mes y de la quincena con la clave exacta de la
     especificación: lleno trabajó · medio tono medio día · gris
     descanso · punteado aún sin foto · borde dorado hoy.
   PORT LITERAL (rasero del dueño, 25-oct): la cabecera del ciclo es
   la tarjeta verde profundo de RHTab del original (Inicio / Fin
   día 15 / Pago día 16 en dorado, estado y «faltan N días»), la
   tabla lleva su columna «Salario diario», el banner «Ciclo
   cerrado / Ciclo abierto», el aviso de pago con 0 días y la banda
   verde de total con su desglose efectivo/transferencia — clases
   .rh-hero/.rh-total de sectionsMirror.css con los valores del
   original. Diferencia honesta: la «A» en ámbar de ausencia
   justificada sale del registro de trabajadores del original, que
   no viaja en el respaldo; aquí no se pinta ninguna «A». */

const SB_MODE = supabaseConfigured()

type DerivedEmployee = ReturnType<typeof deriveCyclePayroll>['employees'][number]


/* ============ Organigrama del equipo (puerto de OrganigramaEquipo,
   App.tsx del original ~5617-5750, con sus helpers areaOrganigrama
   ~5536, esJefeDeCocina, ORDEN_AREAS_ORGANIGRAMA/ordenAreaOrganigrama
   ~5563 y EstrellaSvg/EstrellasValor ~5590) ============
   Al PRINCIPIO de RH, en flujo de trabajo: raíz «La Reina · Equipo»,
   de ahí bajan las áreas ordenadas; camareras/cajeras/cocina se
   parten en Turno 1 y Turno 2; en Cocina el jefe de cocina va encima
   de los turnos; cada persona es una cajita y tocarla abre su ficha
   (el mismo setSelectedKey con el que esta pantalla abre la ficha
   desde la nómina y desde el registro). Sin cifras de salario.
   FUENTE DE DATOS en el clon y desviaciones honestas:
   - El turno válido sigue la precedencia del original (corrección
     manual → detectado del IPV → puesto a mano). El puesto a mano,
     su corrección y las estrellas YA viajan en esta copia por
     app_settings 'workers-extended' (extraído del servidor
     original); el detectado se calcula con el MISMO algoritmo del
     servidor del original (detectarTurnoAlterno,
     server/src/actions.ts: patrón alterno de 14 días anclado en el
     martes 2026-09-22 sobre la línea continua de marcas del IPV —
     buildMarksByWorker —, sin inventar días: si las marcas no
     encajan enteras en un turno, no se detecta).
   - Ausencias justificadas: la cajita las pinta si la ficha las
     trae (EstrellasValor no pinta nada con 0, como el original);
     las ausencias no vienen en el estado extendido, así que no se
     pinta ninguna — igual que la «A» de los cuadrados.
   - Foto: llega por la media autenticada (tabla media,
     'foto-trabajador' por slug del nombre); sin foto se usan las
     iniciales con su color, como en Cobrar y en Queen. */

function fmtDias(n: number): string {
  return n % 1 === 0 ? `${fmtInt(n)} días` : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} días`
}

function areaOrganigrama(ocupacion: string): string {
  const raw = (ocupacion ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return 'Sin cargo registrado'
  const n = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/direcci/.test(n)) return 'Dirección'
  if (/econom|contabil/.test(n)) return 'Economía y contabilidad'
  if (/camarer/.test(n)) return 'Camareras'
  if (/cajer/.test(n)) return 'Cajeras'
  if (/cociner|ayudante de cocina|chef|jefe de cocina|jefa de cocina/.test(n)) return 'Cocina'
  if (/bartender|barman|cantina/.test(n)) return 'Bartender'
  if (/limpieza|limpiador/.test(n)) return 'Limpieza'
  if (/seguridad|vigilante|guardi/.test(n)) return 'Seguridad'
  if (/custodi/.test(n)) return 'Custodios'
  if (/pizz/.test(n)) return 'Pizzas'
  if (/apoyo|ayudante|auxiliar/.test(n)) return 'Apoyo'
  if (/administr|encargad|gerente|jefe/.test(n)) return 'Administración'
  // Otro cargo escrito tal cual va: se respeta su texto.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function esJefeDeCocina(ocupacion: string): boolean {
  const n = (ocupacion ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /chef|jefe de cocina|jefa de cocina/.test(n)
}

const ORDEN_AREAS_ORGANIGRAMA = ['Dirección', 'Administración', 'Economía y contabilidad', 'Camareras', 'Cajeras', 'Cocina', 'Bartender', 'Pizzas', 'Limpieza', 'Seguridad', 'Custodios', 'Apoyo', 'Sin cargo registrado']
function ordenAreaOrganigrama(a: string): number {
  const i = ORDEN_AREAS_ORGANIGRAMA.indexOf(a)
  return i >= 0 ? i : ORDEN_AREAS_ORGANIGRAMA.length - 1
}

function compararNombresTrabajador(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }) || a.localeCompare(b, 'es', { numeric: true })
}
function ordenarPorNombre<T extends { nombre: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => compararNombresTrabajador(x.nombre, y.nombre))
}

/* Turnos de camareras, cajeras y cocineras — puerto de esCargoDeTurno,
   trabajaSegunTurno y detectarTurnoAlterno del servidor del original:
   el Turno 1 queda definido por el patrón de 14 días anclado en el
   martes 2026-09-22 (bloque largo martes, miércoles, sábado, domingo
   y lunes una semana; bloque corto jueves y viernes la siguiente);
   el Turno 2 hace siempre lo contrario. */
const TURNO_ANCLA_FECHA = '2026-09-22'
const PATRON_TURNO_UNO: boolean[] = [true, true, false, false, true, true, true, false, false, true, true, false, false, false]
export function esCargoDeTurno(ocupacion: string): boolean {
  const n = (ocupacion ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /(camarer|cajer|cociner)/.test(n)
}
export function trabajaSegunTurno(iso: string, turno: 1 | 2): boolean {
  const idx = (((diffDays(TURNO_ANCLA_FECHA, iso) % 14) + 14) % 14)
  const base = PATRON_TURNO_UNO[idx]!
  return turno === 1 ? base : !base
}
export function detectarTurnoAlterno(obs: Array<{ fecha: string; on: boolean }>): 1 | 2 | null {
  if (obs.length < 7) return null
  const ons = obs.filter((o) => o.on).length
  if (ons === 0 || ons === obs.length) return null
  const encaja1 = obs.every((o) => trabajaSegunTurno(o.fecha, 1) === o.on)
  const encaja2 = obs.every((o) => trabajaSegunTurno(o.fecha, 2) === o.on)
  if (encaja1 === encaja2) return null
  return encaja1 ? 1 : 2
}

function EstrellaSvg({ llena, size }: { llena: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.7l-5.2 2.7 1-5.8L3.6 9.5l5.8-.8z" fill={llena ? '#F59E0B' : 'none'} stroke={llena ? '#D97706' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function EstrellasValor({ value, size = 13 }: { value: number; size?: number }) {
  if (!value) return null
  return (
    <span className="org-stars" role="img" aria-label={`Evaluación del desempeño: ${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => <EstrellaSvg key={n} llena={n <= value} size={size} />)}
    </span>
  )
}

/* Campos de la ficha que el organigrama del original lee: llegan
   del estado extendido (app_settings 'workers-extended') — el
   turno puesto a mano, su corrección y las estrellas son reales
   del servidor original. Las ausencias justificadas no vienen en
   el extendido: quedan vacías y no se pinta ninguna, como la «A»
   de los cuadrados (0 estrellas = no se pinta nada). */
interface OrgFields {
  estrellas: number
  ausencias: Array<{ fecha: string; motivo: string }>
  turnoAsignado: 1 | 2 | null
  turnoCorreccion: 1 | 2 | null
}
function orgFields(w: Worker, ext: WorkerExtended | null): OrgFields {
  const r = w as unknown as Record<string, unknown>
  const turno = (v: unknown): 1 | 2 | null => (v === 1 || v === 2 ? v : null)
  const ausencias = Array.isArray(r.ausencias)
    ? r.ausencias.filter((a): a is { fecha: string; motivo: string } => Boolean(a) && typeof a === 'object' && typeof (a as { fecha?: unknown }).fecha === 'string' && typeof (a as { motivo?: unknown }).motivo === 'string')
    : []
  return {
    estrellas: ext ? ext.estrellas : (typeof r.estrellas === 'number' && Number.isFinite(r.estrellas) ? Math.max(0, Math.min(5, Math.round(r.estrellas))) : 0),
    ausencias,
    turnoAsignado: ext ? ext.turnoAsignado : turno(r.turnoAsignado),
    turnoCorreccion: ext ? ext.turnoCorreccion : turno(r.turnoCorreccion),
  }
}

const ORG_PERSON_COLORS = ['#0e9f6e', '#0ea5bd', '#3b82f6', '#8b5cf6', '#e9a13b', '#287c5c', '#d64541', '#0b7285']
function orgPersonColor(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return ORG_PERSON_COLORS[h % ORG_PERSON_COLORS.length]
}
function orgInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'
}

interface OrgPerson {
  w: Worker
  fields: OrgFields
  turnoAplica: boolean
  turnoValido: 1 | 2 | null
}

export function OrganigramaEquipo({ workers, marks, today, onOpenWorker, extendedMap }: {
  workers: Worker[]
  marks: Record<string, Record<string, number>>
  today: string
  onOpenWorker: (worker: Worker) => void
  extendedMap: Map<string, WorkerExtended>
}) {
  const personas = useMemo<OrgPerson[]>(() => workers.map((w) => {
    const fields = orgFields(w, extendedMap.get(w.key) ?? null)
    const turnoAplica = esCargoDeTurno(w.ocupacion)
    const ausSet = new Set(fields.ausencias.map((a) => a.fecha))
    const obs = Object.entries(marks[w.key] ?? {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([f]) => f <= today && !ausSet.has(f))
      .map(([fecha, v]) => ({ fecha, on: v > 0 }))
    const turnoDetectado = turnoAplica ? detectarTurnoAlterno(obs) : null
    const turnoValido: 1 | 2 | null = !turnoAplica ? null : (fields.turnoCorreccion ?? turnoDetectado ?? fields.turnoAsignado)
    return { w, fields, turnoAplica, turnoValido }
  }), [workers, marks, today, extendedMap])

  const grupos = useMemo(() => {
    const map = new Map<string, OrgPerson[]>()
    for (const p of personas) {
      const area = areaOrganigrama(p.w.ocupacion)
      map.set(area, [...(map.get(area) ?? []), p])
    }
    return [...map.entries()]
      .map(([area, lista]) => ({ area, lista: [...lista].sort((a, b) => compararNombresTrabajador(a.w.nombre, b.w.nombre)) }))
      .sort((a, b) => ordenAreaOrganigrama(a.area) - ordenAreaOrganigrama(b.area) || a.area.localeCompare(b.area, 'es'))
  }, [personas])
  if (!workers.length) return null

  const nodoPersona = (p: OrgPerson) => (
    <>
      <WorkerPhoto nombre={p.w.nombre} className="org-photo" avatarClassName="org-avatar" colorKey={p.w.key} />
      <span className="org-name">{p.w.nombre}</span>
      <EstrellasValor value={p.fields.estrellas} />
      {p.fields.ausencias.length > 0 && (
        <span className="org-aus-chip" title={p.fields.ausencias.map((a) => `${fmtDateShort(a.fecha)}: ${a.motivo}`).join(' · ')}>
          {p.fields.ausencias.length} aus. justif.
        </span>
      )}
    </>
  )
  const flujoPersonas = (arr: OrgPerson[], etiqueta: string) => (
    <ul className="org-flow" aria-label={etiqueta}>
      {arr.map((p) => (
        <li key={p.w.key}>
          <span aria-hidden="true" className="org-flow-branch" />
          <button type="button" onClick={() => onOpenWorker(p.w)} aria-label={`Abrir ficha de ${p.w.nombre}`} className="org-person">
            {nodoPersona(p)}
          </button>
        </li>
      ))}
    </ul>
  )
  const conectorAbajo = (etiqueta: string) => (
    <div aria-hidden="true" className="org-connector" title={etiqueta}>
      <span className="org-connector-line" />
      <span className="org-connector-arrow" />
    </div>
  )

  return (
    <div className="org-root" aria-label="Organigrama del equipo por áreas y turnos, en flujo de trabajo">
      <div className="org-head">
        <h3 className="org-title"><Icon name="people" size={20} className="org-title-icon" /> Organigrama del equipo</h3>
        <span className="org-count-chip">{workers.length} en el equipo</span>
      </div>
      <p className="org-intro">Flujo de trabajo: el equipo baja a cada área, el área a sus turnos (camareras, cajeras y cocina) y el turno a cada persona. El turno que se muestra es el válido: tu corrección a mano si la pusiste; si no, el detectado del IPV; si aún no se detecta, el puesto a mano. (En esta copia el turno puesto a mano, su corrección y las estrellas llegan por el estado extendido del servidor — app_settings — y el detectado sale de las marcas del IPV.)</p>

      {/* Nivel 0: raíz del flujo */}
      <div className="org-rootwrap" aria-label="Raíz del organigrama: La Reina, equipo completo">
        <div className="org-rootbox">
          <p className="org-rootbox-title">La Reina · Equipo</p>
          <p className="org-rootbox-sub">{workers.length} {workers.length === 1 ? 'persona' : 'personas'} · {grupos.length} {grupos.length === 1 ? 'área' : 'áreas'}</p>
        </div>
        {conectorAbajo('Del equipo a las áreas')}
        <span aria-hidden="true" className="org-hbar" />
      </div>

      {/* Nivel 1: áreas; Nivel 2: turnos; Nivel 3: personas */}
      <div className="org-grid">
        {grupos.map(({ area, lista }) => {
          const jefeCocina = area === 'Cocina' ? lista.find((p) => esJefeDeCocina(p.w.ocupacion)) ?? null : null
          const resto = jefeCocina ? lista.filter((p) => p.w.key !== jefeCocina.w.key) : lista
          const conTurno = resto.some((p) => p.turnoAplica)
          const porNombre = (arr: OrgPerson[]) => [...arr].sort((a, b) => compararNombresTrabajador(a.w.nombre, b.w.nombre))
          const t1 = conTurno ? porNombre(resto.filter((p) => p.turnoValido === 1)) : []
          const t2 = conTurno ? porNombre(resto.filter((p) => p.turnoValido === 2)) : []
          const sinTurno = conTurno ? porNombre(resto.filter((p) => p.turnoValido === null)) : resto
          const bloqueTurno = (titulo: string, arr: OrgPerson[], vacio: string) => (
            <div className="org-turno">
              <p className="org-turno-title">
                <span>{titulo}</span>
                <span className="org-turno-count">{arr.length}</span>
              </p>
              {conectorAbajo(`De ${titulo} a las personas`)}
              {arr.length ? flujoPersonas(arr, `${titulo} de ${area}`) : <p className="org-empty">{vacio}</p>}
            </div>
          )
          return (
            <div key={area} className="org-area">
              {/* Ramal que une esta área con la raíz */}
              <span aria-hidden="true" className="org-area-stem" />
              <span aria-hidden="true" className="org-area-dot" />
              <div className="org-area-head">
                <p className="org-area-name">{area}</p>
                <span className="org-area-count">{lista.length}</span>
              </div>
              {conectorAbajo(`De ${area} a ${jefeCocina ? 'su jefe de cocina' : conTurno ? 'sus turnos' : 'las personas'}`)}
              {jefeCocina && (
                <>
                  <div className="org-jefe">
                    <p className="org-jefe-title">Jefe de cocina</p>
                    {flujoPersonas([jefeCocina], `Jefe de cocina de ${area}`)}
                  </div>
                  {conectorAbajo(`Del jefe de cocina a ${conTurno ? 'los turnos de cocina' : 'las cocineras'}`)}
                </>
              )}
              {conTurno ? (
                <div className="org-stack">
                  {bloqueTurno('Turno 1', t1, 'Sin nadie con Turno 1 válido todavía.')}
                  {bloqueTurno('Turno 2', t2, 'Sin nadie con Turno 2 válido todavía.')}
                  {sinTurno.length > 0 && (
                    <div className="org-sinturno">
                      <p className="org-sinturno-title">
                        <span>Sin turno válido aún</span>
                        <span className="org-sinturno-count">{sinTurno.length}</span>
                      </p>
                      {conectorAbajo('De sin turno válido a las personas')}
                      {flujoPersonas(sinTurno, `Sin turno válido aún en ${area}`)}
                      <p className="org-sinturno-note">Pon su turno en la ficha o espera a que el IPV lo detecte de sus días.</p>
                    </div>
                  )}
                </div>
              ) : (
                flujoPersonas(resto, `Personas de ${area}`)
              )}
            </div>
          )
        })}
      </div>
      <p className="org-final">Cómo se lee: <strong>La Reina · Equipo</strong> arriba → cada <strong>área</strong> → sus <strong>turnos</strong> donde aplica → cada <strong>persona</strong>. En <strong>Cocina</strong> manda el jefe de cocina (el chef): su cajita va encima de los turnos y de él bajan las cocineras. Si un cargo está mal, corrígelo en su ficha (ahí manda sobre el IPV, queda guardado y el organigrama se actualiza solo); los datos del IPV no se reescriben.</p>
    </div>
  )
}

export default function RHScreen({
  data, isAdmin, onChanged,
}: {
  data: StoredData
  isAdmin: boolean
  onChanged: () => void
}) {
  const today = todayISO()
  const anchor = data.anchorDate || '2026-09-23'
  const currentIdx = cycleIndexFor(anchor, today)
  const [cycleIdx, setCycleIdx] = useState<number | null>(null)
  const idx = cycleIdx ?? currentIdx
  const win = cycleWindow(anchor, idx)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PayrollEmployee[]>([])
  const [editError, setEditError] = useState<string | null>(null)
  const [anchorDraft, setAnchorDraft] = useState(anchor)
  const [busy, setBusy] = useState(false)

  const marks = useMemo(() => buildMarksByWorker(data.days) as Record<string, Record<string, number>>, [data.days])
  /* Estado extendido del servidor (turnos a mano, estrellas, días
     fijos, contratos cancelados) emparejado por ficha. */
  const extMap = useMemo(() => extendedByWorker(data.workersExtended, data.workers), [data.workersExtended, data.workers])
  const recorded = recordedPayroll(data.payrollHistory, win.start)
  const adjustment = data.payrollAdjustments[win.start] ?? null
  const derived = useMemo(
    () => deriveCyclePayroll(data.days, win.start, { adjustment, unpaidKeys: data.unpaidWorkers }),
    [data.days, win.start, adjustment, data.unpaidWorkers],
  )
  const prevWin = cycleWindow(anchor, idx - 1)
  const prevRecorded = recordedPayroll(data.payrollHistory, prevWin.start)
  const prevDerived = useMemo(
    () => deriveCyclePayroll(data.days, prevWin.start, { adjustment: data.payrollAdjustments[prevWin.start] ?? null, unpaidKeys: data.unpaidWorkers }),
    [data.days, prevWin.start, data.payrollAdjustments, data.unpaidWorkers],
  )
  const prevTotal = prevRecorded ? prevRecorded.total : prevDerived.total

  const persist = async (patch: Parameters<typeof saveRhSettings>[0]) => {
    setBusy(true)
    try {
      if (SB_MODE) await sbSaveRhSettings(patch)
      else saveRhSettings(patch)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const toggleUnpaid = (key: string) => {
    const has = data.unpaidWorkers.includes(key)
    const next = has ? data.unpaidWorkers.filter((k) => k !== key) : [...data.unpaidWorkers, key]
    void persist({ unpaidWorkers: next })
  }

  const cycleStatus = today > win.payDate
    ? 'Pago vencido'
    : today === win.payDate
      ? '¡Hoy es día de pago!'
      : diffDays(today, win.payDate) <= 3
        ? 'Pago cercano'
        : 'En curso'
  const daysToPay = diffDays(today, win.payDate)

  const tableEmployees: Array<{
    key: string; nombre: string; ocupacion: string; dias: number; salarioDiario: number
    totalCobrar: number; pagoEfectivo: number; pagoTransferencia: number; direccion: boolean; noPagado: boolean
  }> = recorded
    ? recorded.employees.map((e) => ({
        key: canonicalPersonKey(null, e.nombre),
        ...e,
        direccion: isDirectionPerson(e.nombre),
        noPagado: data.unpaidWorkers.includes(canonicalPersonKey(null, e.nombre)),
      }))
    : (derived.employees as DerivedEmployee[])

  const startEdit = () => {
    setDraft(
      (derived.employees as DerivedEmployee[])
        .filter((e) => !e.direccion)
        .map((e) => ({
          nombre: e.nombre, ocupacion: e.ocupacion, dias: e.dias, salarioDiario: e.salarioDiario,
          totalCobrar: e.totalCobrar, pagoEfectivo: e.pagoEfectivo, pagoTransferencia: e.pagoTransferencia,
          carnet: e.carnet, cuentaBancaria: e.cuentaBancaria, movil: e.movil,
        })),
    )
    setEditError(null)
    setEditing(true)
  }

  const saveEdit = () => {
    const bad = draft.find((e) => Math.round(e.pagoEfectivo) + Math.round(e.pagoTransferencia) !== Math.round(e.totalCobrar))
    if (bad) {
      setEditError(`En ${bad.nombre}, efectivo + transferencia deben sumar el total a cobrar (${fmtCUP(bad.totalCobrar)}).`)
      return
    }
    void persist({ payrollAdjustment: { cycleStart: win.start, employees: draft } }).then(() => setEditing(false))
  }

  const draftTotal = draft.reduce((s, e) => s + (data.unpaidWorkers.includes(canonicalPersonKey(null, e.nombre)) ? 0 : e.totalCobrar), 0)
  const sinDias = !recorded
    ? (derived.employees as DerivedEmployee[]).filter((e) => !e.direccion && e.totalCobrar > 0 && e.dias === 0)
    : []

  return (
    <div>
      <TabHeader icon="people" title="RH · Pagos" desc="Trabajadores, ciclos de 15 días y nómina" badge={TAB_BADGES.rh} />

      {/* Cabecera de ciclo del original (RHTab): tarjeta verde profundo
          con Inicio / Fin (día 15) / Pago (día 16, en dorado) y el estado. */}
      <div className="rh-hero">
        <div className="rh-hero-nav">
          <button type="button" className="btn" onClick={() => setCycleIdx(idx - 1)} aria-label="Ciclo anterior">← Anterior</button>
          <p className="rh-hero-title">Ciclo {fmtDate(win.start)} — {fmtDate(win.end)}</p>
          <button type="button" className="btn" onClick={() => setCycleIdx(idx + 1)} aria-label="Ciclo siguiente">Siguiente →</button>
        </div>
        <div className="rh-hero-grid">
          <div><p>Inicio</p><strong>{fmtDate(win.start)}</strong></div>
          <div><p>Fin (día 15)</p><strong>{fmtDate(win.end)}</strong></div>
          <div className="is-pay"><p>Pago (día 16)</p><strong>{fmtDate(win.payDate)}</strong></div>
        </div>
        <p className="rh-hero-status">
          {today >= win.start && today <= win.payDate
            ? daysToPay > 0
              ? <>Faltan <strong>{daysToPay} día{daysToPay === 1 ? '' : 's'}</strong> para el pago · {cycleStatus}</>
              : <strong>{cycleStatus}</strong>
            : cycleStatus === 'Pago vencido' && idx === currentIdx
              ? 'Este ciclo ya cerró; revisa el siguiente.'
              : `Estado: ${cycleStatus}`}
        </p>
        {idx !== currentIdx ? (
          <p className="rh-hero-back"><button type="button" className="btn" onClick={() => setCycleIdx(null)}>Volver al ciclo actual</button></p>
        ) : null}
      </div>

      {/* Registro de trabajadores del original (WorkersRegistry):
          organigrama → resumen → escáner → fichas → historial,
          ANTES de la nómina del ciclo, como en el RHTab original. */}
      <WorkerRegistry
        data={data}
        marks={marks}
        today={today}
        win={win}
        derivedEmployees={derived.employees as DerivedEmployee[]}
        recorded={recorded}
        extMap={extMap}
        isAdmin={isAdmin}
        onChanged={onChanged}
      />

      <section className="card">
        <table className="kv" style={{ marginTop: 0 }}>
          <tbody>
            <tr>
              <td>{recorded ? 'Total pagado (registrado)' : 'Total a pagar del ciclo'}</td>
              <td>{fmtCUP(recorded ? recorded.total : derived.total)}</td>
            </tr>
            {!recorded && derived.excludedTotal > 0 ? (
              <tr><td>Excluido por «No pagado»</td><td>{fmtCUP(derived.excludedTotal)}</td></tr>
            ) : null}
            <tr>
              <td>Ciclo anterior</td>
              <td>{fmtCUP(prevTotal)}{prevTotal > 0 && (recorded ? recorded.total : derived.total) > 0
                ? ` · diferencia ${fmtCUP((recorded ? recorded.total : derived.total) - prevTotal)}`
                : ''}</td>
            </tr>
            <tr>
              <td>Fuente de la nómina</td>
              <td>{recorded
                ? 'Historial registrado'
                : adjustment
                  ? 'Ajuste manual (manda sobre la foto)'
                  : derived.photoDate
                    ? `Foto de RH del IPV del ${fmtDate(derived.photoDate)}`
                    : 'Sin foto de RH en este ciclo'}</td>
            </tr>
          </tbody>
        </table>
        <p className="small muted">
          Los ciclos de RH son de 15 días exactos desde el ancla y se pagan el día 16; no son la quincena
          natural del mes de Contabilidad. El salario de cada ciclo se lee de la RH del IPV de cierre de
          ese ciclo, nunca del anterior.
        </p>
        {isAdmin ? (
          <div className="rh-anchor">
            <label htmlFor="rh-anchor">Ancla de los ciclos</label>
            <input id="rh-anchor" type="date" value={anchorDraft} onChange={(e) => setAnchorDraft(e.target.value)} />
            <button type="button" className="btn" disabled={busy || anchorDraft === anchor} onClick={() => void persist({ anchorDate: anchorDraft })}>
              Guardar ancla
            </button>
          </div>
        ) : null}
      </section>

      {/* Nómina del ciclo */}
      <section className="card">
        <h3 className="font-display">Nómina del ciclo</h3>
        {recorded ? (
          <p className="small muted">Nómina registrada en el historial: se pagó el {fmtDate(recorded.payDate)} a {fmtInt(recorded.workersCount)} trabajadores.</p>
        ) : derived.photoDate || adjustment ? (
          <p className="small muted">
            Nómina derivada {adjustment ? 'del ajuste manual' : `de la foto de RH del IPV del ${fmtDate(derived.photoDate!)}`}.
            {isAdmin ? ' Puedes corregir días, totales y el desglose efectivo/transferencia: el ajuste queda guardado y manda sobre la foto.' : ''}
          </p>
        ) : (
          <p className="small muted">Todavía no hay foto de RH importada dentro de este ciclo: la nómina aparecerá sola al importar el IPV de un día del ciclo.</p>
        )}
        {/* Banner del original: ciclo cerrado o abierto */}
        {recorded || derived.photoDate ? (
          win.end < today ? (
            <p className="small" style={{ background: 'var(--surface-tonal)', borderRadius: 16, padding: '8px 12px' }}>
              <strong>Ciclo cerrado.</strong> Las cifras de abajo son el cierre: cuánto se pagó a cada trabajador, por cuántos días y a cuánto por día. El pago correspondía al {fmtDate(win.payDate)}.
            </p>
          ) : (
            <p className="small muted" style={{ background: 'var(--surface-tonal)', borderRadius: 16, padding: '8px 12px' }}>
              <strong style={{ color: 'var(--text)' }}>Ciclo abierto.</strong> Esto es lo acumulado hasta la foto{derived.photoDate ? ` del ${fmtDate(derived.photoDate)}` : ''}: sigue sumando día a día hasta el cierre del {fmtDate(win.end)} y se paga el {fmtDate(win.payDate)}.
            </p>
          )
        ) : null}
        {sinDias.length > 0 ? (
          <div className="error-box" role="alert" style={{ marginBottom: 10 }}>
            Con pago asignado y 0 días trabajados: {sinDias.map((e) => e.nombre).join(', ')}. Revísalo en tu Excel.
          </div>
        ) : null}
        {tableEmployees.length > 0 ? (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr>
                  <th>Trabajador</th><th>Días</th><th>Salario diario</th><th>Total</th><th>Efectivo</th><th>Transferencia</th>
                  {isAdmin && !recorded ? <th>No pagado</th> : null}
                </tr>
              </thead>
              <tbody>
                {tableEmployees.map((e) => (
                  <tr key={e.key} className={e.direccion ? 'is-direccion' : e.noPagado ? 'is-nopagado' : ''}>
                    <td>
                      <span className="rh-name">{e.nombre}</span>
                      {e.ocupacion ? <span className="small muted"> · {e.ocupacion}</span> : null}
                      {e.direccion ? <span className="chip">Dirección · fuera de nómina</span> : null}
                      {e.noPagado ? <span className="chip">No pagado</span> : null}
                    </td>
                    <td>{fmtDias(e.dias)}</td>
                    <td>{fmtCUP(e.salarioDiario)}</td>
                    <td>{fmtCUP(e.totalCobrar)}</td>
                    <td>{fmtCUP(e.pagoEfectivo)}</td>
                    <td>{fmtCUP(e.pagoTransferencia)}</td>
                    {isAdmin && !recorded ? (
                      <td>
                        {!e.direccion ? (
                          <button
                            type="button"
                            className={`btn ${e.noPagado ? '' : 'primary'}`}
                            disabled={busy}
                            onClick={() => toggleUnpaid(e.key)}
                          >
                            {e.noPagado ? 'Reincluir' : 'No pagado'}
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tableEmployees.length > 0 ? (() => {
          const incluidos = tableEmployees.filter((e) => !e.direccion && !e.noPagado)
          const totalBanda = recorded ? recorded.total : incluidos.reduce((s2, e) => s2 + e.totalCobrar, 0)
          const efBanda = incluidos.reduce((s2, e) => s2 + e.pagoEfectivo, 0)
          const trBanda = incluidos.reduce((s2, e) => s2 + e.pagoTransferencia, 0)
          return (
            <div className="rh-total">
              <span className="t-label">{win.end < today ? <>Total pagado en el cierre · pago del {fmtDate(win.payDate)}</> : <>Acumulado hasta la foto · total a pagar el {fmtDate(win.payDate)}</>}</span>
              <span>
                <span className="t-value">{fmtCUP(totalBanda)}</span>
                {trBanda > 0 ? <span className="t-split">Efectivo {fmtCUP(efBanda)} · Transferencia {fmtCUP(trBanda)}</span> : null}
              </span>
            </div>
          )
        })() : null}
        {isAdmin && !recorded && (derived.photoDate || adjustment) ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={startEdit}>Editar nómina del ciclo</button>
            {adjustment ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void persist({ payrollAdjustment: { cycleStart: win.start, employees: null } })}>
                Restablecer a la foto del IPV
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Editor de nómina (ajuste manual) */}
      {editing ? (
        <section className="card">
          <h3 className="font-display">Ajuste de la nómina del ciclo</h3>
          <p className="small muted">Efectivo + transferencia deben sumar el total a cobrar de cada quien. El ajuste manda sobre la foto del IPV y queda guardado por ciclo.</p>
          {editError ? <div className="error-box">{editError}</div> : null}
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr><th>Trabajador</th><th>Días</th><th>Total a cobrar</th><th>Efectivo</th><th>Transferencia</th></tr>
              </thead>
              <tbody>
                {draft.map((e, i) => (
                  <tr key={e.nombre}>
                    <td>{e.nombre}</td>
                    <td>
                      <input type="number" min={0} step="0.5" value={e.dias} aria-label={`Días de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, dias: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.totalCobrar} aria-label={`Total de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, totalCobrar: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.pagoEfectivo} aria-label={`Efectivo de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, pagoEfectivo: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <input type="number" min={0} step="1" value={e.pagoTransferencia} aria-label={`Transferencia de ${e.nombre}`}
                        onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? { ...x, pagoTransferencia: Number(ev.target.value) || 0 } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">Total del ajuste (sin «No pagado»): <strong>{fmtCUP(draftTotal)}</strong></p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={saveEdit}>Guardar ajuste</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </section>
      ) : null}

      {/* Historial de nóminas */}
      <section className="card">
        <h3 className="font-display">Historial de nóminas</h3>
        {data.payrollHistory.length === 0 ? (
          <p className="small muted">Sin nóminas registradas todavía. Llegan con el respaldo del sistema o al registrarse un pago.</p>
        ) : (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead><tr><th>Ciclo</th><th>Día de pago</th><th>Trabajadores</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {data.payrollHistory.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateShort(p.cycleStart)} – {fmtDate(p.cycleEnd)}</td>
                    <td>{fmtDate(p.payDate)}</td>
                    <td>{fmtInt(p.workersCount)}</td>
                    <td>{fmtCUP(p.total)}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => setCycleIdx(cycleIndexFor(anchor, p.cycleStart))}>Ver ciclo</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pagos a trabajadores fuera de nómina (workerPayments del respaldo) */}
      <section className="card">
        <h3 className="font-display">Pagos fuera de nómina (del respaldo)</h3>
        {data.workerPayments.length === 0 ? (
          <p className="small muted">El respaldo cargado no trae pagos a trabajadores fuera de la nómina (workerPayments). La colección viaja íntegra de ida y vuelta desde la oleada 2; si el sistema principal registra uno, aparecerá aquí tal como venga.</p>
        ) : (
          <div className="list">
            {data.workerPayments.map((p, i) => (
              <div className="row" key={`${p.workerKey}-${p.fecha}-${i}`}>
                <span><strong>{p.workerKey}</strong><span className="small muted"> · {fmtDate(p.fecha)}{p.concepto ? ` · ${p.concepto}` : ''}</span></span>
                <span className="mono">{fmtCUP(p.monto)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
