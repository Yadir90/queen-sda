// Queen SDA — DOCUMENTO ÚNICO DE CONTRATACIÓN de la ficha de RH:
// puerto del WorkerHiringDocuments del original (App.tsx ~5926-6260):
// el asistente en 6 pasos (Datos personales · Salud y contacto ·
// Puesto y currículum · Modalidad · Condiciones · Firmas) que vive
// dentro de la ficha de cada trabajador que no es de Dirección, con
// su autocompletado, su firma y su «Exportar PDF único».
//
// CAUSA DEL DEFECTO D-R2-10 (confirmado por el dueño en producción,
// 26-oct): este componente NUNCA se portó — no existía en el clon ni
// en local ni en producción; la ronda anterior verificó la ficha
// contra la lista de bloques del propio clon (21 campos) y declaró
// los formularios «no reproducibles», sin contrastar contra el
// inventario de secciones del original, donde esta sección existe y
// se renderiza siempre. No era una puerta de datos de Supabase: con
// cualquier vía de datos, la sección no estaba.
//
// Adaptaciones de esta copia, declaradas y sin simular nada:
// - En el original el formulario vive en la fila del trabajador de su
//   servidor (hiringForm/workContract); aquí vive en el extendido de
//   la ficha (app_settings 'workers-extended' en modo Supabase con las
//   claves hiring_form/work_contract; el mismo objeto en modo local).
//   Ninguna fila existente lo trae: el asistente nace del
//   autocompletado, exactamente como en el original sin formulario.
// - Firmas del Administrador y del Director: en el original son
//   trazos (signatureData); aquí son las imágenes de media
//   'firma-trabajador' de cada firmante (la vía de la credencial).
//   La firma del trabajador del paso 6 sí es el lienzo de trazos del
//   original y se guarda en el propio formulario (firmaTrabajador).
// - «Redactar con IA»: en el original lo redacta su servidor; aquí el
//   borrador se compone en el dispositivo SOLO con los datos
//   confirmados de la ficha, sin inventar estudios ni experiencia, y
//   queda editable antes de guardar.
// - El PDF único se abre con la ventana de impresión del navegador
//   (printHtml), la vía de documentos de esta copia, con el contenido
//   íntegro del documento del original: ficha (2 páginas), contrato
//   con sus cláusulas fijas y hoja de firmas y cuño.
// - Sin extracción OCR en esta copia (declarado en la ficha): el
//   autocompletado toma solo el «Registro de RH» y nunca conflictos.

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Worker, WorkerExtended, WorkerHiringForm, WorkerWorkContract } from '../types'
import { Icon } from './icons'
import { InfoHelp } from './ui'
import { fmtDate, todayISO } from '../lib/utils'
import { loadMediaDataUrl, slug } from '../lib/media'
import { printHtml } from '../lib/download'
import { BRAND_CUNO_URL, bundledDataUrl } from '../lib/brandAssets'
import { addDaysISO, diffDays } from '../lib/syncCore.mjs'
import './workerFicha.css'

/* ---------- Ayudantes (puerto del original) ---------- */

function splitWorkerName(fullName: string): { nombre: string; primerApellido: string; segundoApellido: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { nombre: parts[0] ?? '', primerApellido: '', segundoApellido: '' }
  if (parts.length === 2) return { nombre: parts[0] ?? '', primerApellido: parts[1] ?? '', segundoApellido: '' }
  return { nombre: parts.slice(0, -2).join(' '), primerApellido: parts[parts.length - 2] ?? '', segundoApellido: parts[parts.length - 1] ?? '' }
}

function carnetBirthDate(carnet: string): string | null {
  const digits = (carnet ?? '').replace(/\D/g, '')
  if (digits.length < 6) return null
  const yy = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))
  const currentYY = Number(todayISO().slice(2, 4))
  const year = yy <= currentYY ? 2000 + yy : 1900 + yy
  const d = new Date(year, mm - 1, dd, 12)
  if (d.getFullYear() !== year || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
function ageFromCarnet(carnet: string): number | null {
  const birth = carnetBirthDate(carnet)
  if (!birth) return null
  const [year = 0, month = 0, day = 0] = birth.split('-').map(Number)
  const [todayYear = 0, todayMonth = 0, todayDay = 0] = todayISO().split('-').map(Number)
  let age = todayYear - year
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age--
  return age >= 0 && age <= 120 ? age : null
}

function addCalendarMonths(iso: string, months: number): string | null {
  if (!iso) return null
  const [y = 0, m = 0, d = 0] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const first = new Date(y, m - 1 + months, 1, 12)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate()
  const target = new Date(first.getFullYear(), first.getMonth(), Math.min(d, lastDay), 12)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}
type VacationStatus = { kind: 'missing' } | { kind: 'available'; eligibleDate: string } | { kind: 'pending'; eligibleDate: string; days: number }
function vacationStatus(hiringDate: string): VacationStatus {
  const eligibleDate = addCalendarMonths(hiringDate, 6)
  if (!eligibleDate) return { kind: 'missing' }
  const today = todayISO()
  if (today >= eligibleDate) return { kind: 'available', eligibleDate }
  return { kind: 'pending', eligibleDate, days: Math.max(0, diffDays(today, eligibleDate)) }
}

/** Área del organigrama (la misma función del clon en RH.tsx). */
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
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function hiringAutofill(worker: Worker, extended: WorkerExtended | null): { form: WorkerHiringForm; sources: string[] } {
  const names = splitWorkerName(worker.nombre)
  const carnet = worker.carnet || ''
  const age = ageFromCarnet(carnet)
  return {
    sources: ['Registro de RH'],
    form: {
      fechaContratacion: extended?.fechaContratacion || todayISO(), ...names,
      calle: '', numero: '', codigoPostal: '69260', carnet,
      municipio: 'Venezuela', provincia: 'Ciego de Ávila',
      sexo: extended?.genero === 'masculino' ? 'M' : extended?.genero === 'femenino' ? 'F' : '',
      edad: age == null ? '' : String(age),
      estudiosTerminados: '', campoEstudios: '',
      enfermedad: '', medicamentos: '', correo: '', telefono: worker.movil, estadoCivil: '', hijos: '', cantidadHijos: '',
      cuentaBancaria: '', idiomas: '', firmaTrabajador: '',
      institucion: 'Proyecto de Desarrollo Local La Reina Restaurante - Bar',
      direccionInstitucion: 'Calle 8 No 5 Júcaro Ciego de Ávila',
      correoInstitucion: 'lareinarestaurantebar@gmail.com', telefonoInstitucion: '',
      ocupacion: worker.ocupacion, departamento: areaOrganigrama(worker.ocupacion), horasTrabajo: '', salario: '', anosExperiencia: '', evaluacion: '',
      curriculum: '', rhNombre: '', rhPrimerApellido: '', rhSegundoApellido: '', rhCargo: '', firmaRh: '', updatedAt: '',
    },
  }
}

function mergeEmptyForm<T extends object>(current: T, source: T): T {
  const next: Record<string, string> = { ...(current as Record<string, string>) }
  const src = source as Record<string, string>
  for (const key of Object.keys(src)) {
    const currentValue = String(next[key] ?? '')
    const sourceValue = String(src[key] ?? '')
    if (!currentValue.trim() && sourceValue.trim()) next[key] = sourceValue
  }
  return next as T
}

function contractDefaults(worker: Worker, hire: WorkerHiringForm): WorkerWorkContract {
  return {
    nombreTrabajador: [hire.nombre, hire.primerApellido, hire.segundoApellido].filter(Boolean).join(' ') || worker.nombre,
    carnet: hire.carnet || worker.carnet, profesionOficio: hire.ocupacion || worker.ocupacion,
    direccion: [hire.calle, hire.numero].filter(Boolean).join(' No '), municipio: hire.municipio || 'Venezuela', provincia: hire.provincia || 'Ciego de Ávila',
    tipoContrato: '', pruebaDesde: hire.fechaContratacion || todayISO(), pruebaHasta: '', ocupacion: hire.ocupacion || worker.ocupacion,
    grupoEscala: '', escalaSalarial: hire.salario, categoriaOcupacional: '', lugarTrabajo: 'PDL La Reina Restaurante - Bar',
    jornada: '12-diarias', horario: '10:00 a. m.–10:00 p. m.', fechaFirma: hire.fechaContratacion || todayISO(),
    firmaAdministracion: '', firmaTrabajador: hire.firmaTrabajador, updatedAt: '',
  }
}

export interface HiringCiclo {
  cycleStart: string
  cycleEnd: string
  dias: number
  detalleDias: Array<{ fecha: string; valor: number | null; ausenciaMotivo: string | null }>
}

/** La jornada del restaurante es fija: las horas salen de las marcas
 *  de RH del ciclo en pantalla (puerto de workerHoursSummary). */
function workerHoursSummary(ciclo: HiringCiclo | null): { hoursPerDay: number; weekHours: number; fortnightHours: number } {
  const hoursPerDay = 12
  if (!ciclo) return { hoursPerDay, weekHours: 0, fortnightHours: 0 }
  const today = todayISO()
  const referenceDate = today < ciclo.cycleStart ? ciclo.cycleStart : today > ciclo.cycleEnd ? ciclo.cycleEnd : today
  const day = new Date(`${referenceDate}T12:00:00`).getDay()
  const weekStart = addDaysISO(referenceDate, -(day === 0 ? 6 : day - 1))
  const weekEnd = addDaysISO(weekStart, 6)
  const workedDaysThisWeek = (ciclo.detalleDias ?? []).reduce((total, item) => (
    item.fecha >= weekStart && item.fecha <= weekEnd && item.ausenciaMotivo == null
      ? total + Math.max(0, item.valor ?? 0)
      : total
  ), 0)
  return {
    hoursPerDay,
    weekHours: workedDaysThisWeek * hoursPerDay,
    fortnightHours: Math.max(0, ciclo.dias) * hoursPerDay,
  }
}

const fmtHoras = (n: number): string => n.toLocaleString('es-ES', { maximumFractionDigits: 2 })
function fmtContractDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—'
  const [year = '', month = '', day = ''] = value.split('-')
  return `${day}/${month}/${year}`
}

/** Borrador de currículum SOLO con datos confirmados de la ficha
 *  (adaptación declarada de la redacción con IA del original). */
function curriculumDraft(hire: WorkerHiringForm, worker: Worker): string {
  const nombre = [hire.nombre, hire.primerApellido, hire.segundoApellido].filter(Boolean).join(' ') || worker.nombre
  const partes = [`${nombre} — ${hire.ocupacion || worker.ocupacion || 'Trabajador'} del Proyecto de Desarrollo Local La Reina Restaurante - Bar.`]
  if (hire.departamento) partes.push(`Se desempeña en el área de ${hire.departamento}.`)
  if (hire.fechaContratacion) partes.push(`Fecha de contratación: ${fmtContractDate(hire.fechaContratacion)}.`)
  if (hire.idiomas) partes.push(`Idiomas: ${hire.idiomas}.`)
  return partes.join(' ')
}

/* ---------- Firma de trazos (puerto de SignaturePad del original) ---------- */

type SignaturePoint = { x: number; y: number; pressure?: number }
type SignatureStroke = SignaturePoint[]

function parseSignatureData(raw: string): SignatureStroke[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(Array.isArray).map((stroke) => stroke.filter((point): point is SignaturePoint => {
      if (!point || typeof point !== 'object') return false
      const candidate = point as SignaturePoint
      return typeof candidate.x === 'number'
        && typeof candidate.y === 'number'
        && (candidate.pressure == null || (typeof candidate.pressure === 'number' && candidate.pressure >= 0 && candidate.pressure <= 1))
    })).filter((stroke) => stroke.length >= 2)
  } catch { return [] }
}
function signatureLineWidth(point: SignaturePoint): number {
  return point.pressure == null ? 2.2 : 1.25 + Math.max(0.08, Math.min(1, point.pressure)) * 2.35
}

/** Imagen PNG de unos trazos guardados (para el documento impreso). */
function strokesDataUrl(raw: string): string | null {
  const strokes = parseSignatureData(raw)
  if (!strokes.length) return null
  const canvas = document.createElement('canvas')
  canvas.width = 600; canvas.height = 220
  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(2, 0, 0, 2, 0, 0)
  context.strokeStyle = '#10251c'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      const from = stroke[i - 1]!
      const to = stroke[i]!
      context.lineWidth = signatureLineWidth(to)
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
    }
  }
  return canvas.toDataURL('image/png')
}

function HiringSignaturePad(props: {
  initialData: string
  disabled: boolean
  title: string
  description: string
  onSave: (strokes: SignatureStroke[]) => void
  onDelete: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeStroke = useRef<SignatureStroke | null>(null)
  const activePointerId = useRef<number | null>(null)
  const activePointerType = useRef<string | null>(null)
  const preferPenUntil = useRef(0)
  const [strokes, setStrokes] = useState<SignatureStroke[]>(() => parseSignatureData(props.initialData))
  useEffect(() => setStrokes(parseSignatureData(props.initialData)), [props.initialData])

  const prepareContext = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')
    if (!context) return null
    context.setTransform(canvas.width / 300, 0, 0, canvas.height / 110, 0, 0)
    context.strokeStyle = '#10251c'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    return context
  }, [])
  const drawSegment = useCallback((context: CanvasRenderingContext2D, from: SignaturePoint, to: SignaturePoint) => {
    context.lineWidth = signatureLineWidth(to)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }, [])
  const drawAll = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = prepareContext(canvas)
    if (!context) return
    context.clearRect(0, 0, 300, 110)
    for (const stroke of strokes) {
      for (let index = 1; index < stroke.length; index += 1) {
        const previous = stroke[index - 1]
        const point = stroke[index]
        if (previous && point) drawSegment(context, previous, point)
      }
    }
  }, [drawSegment, prepareContext, strokes])
  useEffect(() => drawAll(), [drawAll])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const syncResolution = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 3)
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        drawAll()
      }
    }
    syncResolution()
    const observer = new ResizeObserver(syncResolution)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [drawAll])

  const pointFor = (canvas: HTMLCanvasElement, event: PointerEvent): SignaturePoint => {
    const rect = canvas.getBoundingClientRect()
    const point: SignaturePoint = {
      x: Math.max(0, Math.min(300, ((event.clientX - rect.left) / rect.width) * 300)),
      y: Math.max(0, Math.min(110, ((event.clientY - rect.top) / rect.height) * 110)),
    }
    if (event.pointerType === 'pen') point.pressure = Math.max(0.08, Math.min(1, event.pressure || 0.5))
    return point
  }
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (props.disabled) return
    if (event.pointerType === 'touch' && (Date.now() < preferPenUntil.current || !event.isPrimary || event.width > 28 || event.height > 28)) return
    if (event.pointerType === 'pen') {
      preferPenUntil.current = Date.now() + 1600
      const previousPointer = activePointerId.current
      activeStroke.current = null
      activePointerId.current = null
      activePointerType.current = null
      if (previousPointer != null && previousPointer !== event.pointerId && event.currentTarget.hasPointerCapture(previousPointer)) {
        event.currentTarget.releasePointerCapture(previousPointer)
      }
    } else if (activePointerId.current != null) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointerId.current = event.pointerId
    activePointerType.current = event.pointerType
    activeStroke.current = [pointFor(event.currentTarget, event.nativeEvent)]
  }
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current
    if (!stroke || activePointerId.current !== event.pointerId) return
    if (activePointerType.current === 'pen' && event.pointerType !== 'pen') return
    event.preventDefault()
    if (event.pointerType === 'pen') preferPenUntil.current = Date.now() + 1600
    const nativeEvent = event.nativeEvent
    const samples = typeof nativeEvent.getCoalescedEvents === 'function' ? nativeEvent.getCoalescedEvents() : [nativeEvent]
    const context = prepareContext(event.currentTarget)
    for (const sample of samples) {
      const point = pointFor(event.currentTarget, sample)
      const previous = stroke[stroke.length - 1]
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 0.22) continue
      stroke.push(point)
      if (context) drawSegment(context, previous, point)
    }
  }
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== event.pointerId) return
    const stroke = activeStroke.current
    activeStroke.current = null
    activePointerId.current = null
    activePointerType.current = null
    if (stroke && stroke.length >= 2) setStrokes((current) => [...current, stroke])
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const clear = () => {
    setStrokes([])
    activeStroke.current = null
    activePointerId.current = null
    activePointerType.current = null
  }
  return (
    <div className="wf-signature" aria-label={props.title}>
      <p className="wf-signature-title">{props.title}</p>
      <p className="wf-signature-desc">{props.description}</p>
      <canvas
        ref={canvasRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
        onLostPointerCapture={finish} onContextMenu={(event) => event.preventDefault()}
        className="wf-signature-canvas"
        aria-label="Lienzo para firma digital compatible con lápiz óptico y rechazo de palma"
      />
      <div className="wf-signature-actions">
        <button type="button" onClick={() => props.onSave(strokes)} disabled={props.disabled || !strokes.length} className="btn primary">Guardar firma</button>
        <button type="button" onClick={clear} disabled={props.disabled || !strokes.length} className="btn">Limpiar lienzo</button>
        {props.initialData ? <button type="button" onClick={props.onDelete} disabled={props.disabled} className="btn wf-hire-danger">Eliminar firma guardada</button> : null}
      </div>
    </div>
  )
}

/* ---------- Documento único impreso (contenido del PDF del original) ---------- */

const escHtml = (value: string): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

function buildContractHtml(args: {
  hire: WorkerHiringForm
  contract: WorkerWorkContract
  workerName: string
  workerFirmaImg: string | null
  adminImg: string | null
  directorImg: string | null
  adminName: string
  directorName: string
  cunoImg: string | null
}): string {
  const { hire, contract } = args
  const field = (label: string, value: string) =>
    `<div class="f"><span>${escHtml(label)}</span><strong>${escHtml(value || '—')}</strong></div>`
  const fieldGrid = (items: string) => `<div class="grid">${items}</div>`
  const firmaBox = (img: string | null, caption: string, label?: string) =>
    `<div class="fbox">${label ? `<p class="flabel">${escHtml(label)}</p>` : ''}<div class="fsign">${img ? `<img src="${img}" alt="Firma autorizada" />` : '<span class="fmiss">Firma autorizada pendiente</span>'}</div><p class="fdata">${escHtml(caption)}</p></div>`
  const directorText = contract.tipoContrato === 'prueba'
    ? `PRIMERO: Se concierta a prueba el presente CONTRATO DE TRABAJO por un período de ${contract.pruebaDesde || ''} a ${contract.pruebaHasta || ''}, transcurrido el cual sin que ninguna de las partes haya solicitado su terminación, se considera prorrogado por tiempo indeterminado. En cualquier momento del período de prueba cualquiera de las partes puede dar por terminada la relación laboral, sin responsabilidad alguna y sin necesidad de aviso previo o indemnización.`
    : contract.tipoContrato === 'determinado-obra'
      ? 'PRIMERO: El presente CONTRATO DE TRABAJO se concierta por tiempo determinado, para la ejecución de una obra o servicio determinado.'
      : contract.tipoContrato === 'adiestramiento'
        ? 'PRIMERO: El presente CONTRATO DE TRABAJO se concierta para el adiestramiento del TRABAJADOR, por el período establecido por la legislación vigente.'
        : 'PRIMERO: El presente CONTRATO DE TRABAJO se concierta por tiempo indeterminado.'
  const fechaFirma = fmtContractDate(contract.fechaFirma)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Documento de contratación — ${escHtml(args.workerName)}</title>
<style>
@page { size: A4; margin: 14mm }
body { font-family: Arial, Helvetica, sans-serif; color: #12211b; font-size: 11px; margin: 0 }
h1 { font-size: 17px; margin: 0 } h2 { font-size: 13px; margin: 16px 0 6px; color: #084C5C }
p { margin: 4px 0; line-height: 1.5 } .sub { color: #5c6f68 } .sheet { page-break-after: always } .sheet:last-child { page-break-after: auto }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px }
.f { border: 1px solid #cfe0d8; border-radius: 6px; padding: 6px 8px } .f span { display: block; font-size: 8px; letter-spacing: .08em; color: #5c6f68; text-transform: uppercase } .f strong { font-size: 11px; font-weight: 600 }
.text { border: 1px solid #cfe0d8; border-radius: 6px; padding: 8px; min-height: 60px }
.fbox { border: 1px solid #cfe0d8; border-radius: 6px; padding: 8px; margin-top: 10px } .flabel { font-weight: 700 }
.fsign { height: 74px; display: flex; align-items: center; justify-content: center; background: #f7faf8 } .fsign img { max-height: 70px; max-width: 100% } .fmiss { color: #b3261e; font-style: italic }
.fdata { text-align: center; color: #5c6f68 } .firma2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px }
.clause { margin: 6px 0 } .cuno { text-align: center; margin-top: 14px } .cuno img { width: 120px }
</style></head><body>
<section class="sheet">
<h1>Documento de contratación</h1>
<p class="sub">Formulario único y contrato individual de trabajo de ${escHtml(args.workerName)}. Generado por Queen SDA.</p>
<h2>Datos personales</h2>
${fieldGrid(
  field('Nombre', hire.nombre) + field('Primer apellido', hire.primerApellido) + field('Segundo apellido', hire.segundoApellido)
  + field('Carné de identidad', hire.carnet) + field('Sexo', hire.sexo) + field('Edad', hire.edad)
  + field('Fecha de contratación', fmtContractDate(hire.fechaContratacion)) + field('Calle', hire.calle) + field('Número', hire.numero)
  + field('Código postal', hire.codigoPostal) + field('Municipio', hire.municipio) + field('Provincia', hire.provincia),
)}
<h2>Salud y contacto</h2>
${fieldGrid(
  field('Enfermedad', hire.enfermedad) + field('Medicamentos', hire.medicamentos) + field('Correo', hire.correo)
  + field('Teléfono', hire.telefono) + field('Estado civil', hire.estadoCivil) + field('Hijos', hire.hijos)
  + field('Cantidad de hijos', hire.cantidadHijos) + field('Idiomas', hire.idiomas),
)}
${firmaBox(args.workerFirmaImg, `${args.workerName} · Trabajador`)}
</section>
<section class="sheet">
<h2>Datos de la institución</h2>
${fieldGrid(
  field('Institución', hire.institucion) + field('Dirección de la institución', hire.direccionInstitucion)
  + field('Correo de la institución', hire.correoInstitucion),
)}
<h2>Sobre el puesto</h2>
${fieldGrid(
  field('Ocupación', hire.ocupacion) + field('Departamento', hire.departamento) + field('Salario', `${hire.salario} CUP`),
)}
<h2>Encargado de RH</h2>
${fieldGrid(field('Cargo de RH', hire.rhCargo))}
${firmaBox(args.adminImg, `${args.adminName} · Administrador`)}
<h2>Currículum</h2>
<div class="text">${escHtml(hire.curriculum || '—')}</div>
</section>
<section class="sheet">
<h1>Contrato individual de trabajo</h1>
<p>En el municipio Venezuela, a ${escHtml(fechaFirma)}, comparecen: de una parte, Jesús Mendoza Moreno, Director, a nombre y en representación del PDL La Reina Restaurante - Bar perteneciente al órgano u organismo: Poder Popular. Dirección: Calle 8 No 5 Júcaro, municipio Venezuela, provincia Ciego de Ávila, que en lo adelante se denominará LA ADMINISTRACIÓN, y de la otra, el trabajador identificado en este documento, que en lo adelante se denominará EL TRABAJADOR, quienes convienen suscribir el presente CONTRATO INDIVIDUAL DE TRABAJO.</p>
<p class="clause">${escHtml(directorText)}</p>
<p class="clause">SEGUNDO: EL TRABAJADOR prestará sus servicios desempeñando la ocupación de ${escHtml(contract.ocupacion || '—')}, en el lugar ${escHtml(contract.lugarTrabajo)}, en la jornada ${escHtml(contract.jornada === '12-diarias' ? 'de 12 horas diarias' : contract.jornada || 'de 12 horas diarias')} y el horario ${escHtml(contract.horario)}. La escala salarial correspondiente a esta ocupación es de ${escHtml(contract.escalaSalarial || '—')} CUP.</p>
<p class="clause">TERCERO: EL TRABAJADOR se compromete a: a) Cumplir cabalmente con la legislación laboral vigente, las normas de convivencia, de seguridad y salud del trabajo y la ética y moral socialista, rechazando todo acto de corrupción, delito e indisciplina. b) Cumplir con el Reglamento Disciplinario Interno. c) Velar y evitar robos, pérdidas o deterioro de los medios de protección individual, medios de trabajo y herramientas entregadas. d) Utilizar los medios de protección individual (uniforme, guantes, botas, delantal, gorro, nasobuco y otros). e) Realizar las funciones y el contenido de trabajo correspondientes a su ocupación.</p>
<p class="clause">CUARTO: LA ADMINISTRACIÓN se compromete a crear las condiciones de trabajo necesarias para el desempeño de las funciones del TRABAJADOR.</p>
</section>
<section class="sheet">
<p class="clause">QUINTO: EL TRABAJADOR tiene derecho a recibir, por su trabajo, el salario que le corresponde según la ocupación que desempeña, conforme a la legislación vigente.</p>
<p class="clause">SEXTO: EL TRABAJADOR y LA ADMINISTRACIÓN se comprometen con la seguridad y la salud del trabajo como derecho de los trabajadores y deber de la administración.</p>
<p class="clause">SÉPTIMO: Las relaciones laborales entre las partes se ajustan a lo establecido en la Ley No. 116/2013, Código de Trabajo, y demás disposiciones complementarias aplicables.</p>
<p class="clause">OCTAVO: EL TRABAJADOR tiene derecho a vacaciones pagadas conforme a la legislación vigente.</p>
<p class="clause">NOVENO: La disciplina laboral se rige por el reglamento disciplinario interno de la entidad.</p>
<p>Y PARA QUE ASÍ CONSTE, se expide el presente contrato, firmado por las partes, en el municipio Venezuela, con fecha ${escHtml(fechaFirma)}.</p>
<div class="firma2">
${firmaBox(args.directorImg, 'Jesús Mendoza Moreno · Director', 'POR LA ADMINISTRACIÓN')}
${firmaBox(args.workerFirmaImg, `${args.workerName} · Trabajador`, 'TRABAJADOR')}
</div>
</section>
<section class="sheet">
<h1>Firmas y cuño</h1>
<p class="sub">La firma registrada confirma que el documento fue creado, revisado y autorizado por las personas indicadas.</p>
${firmaBox(args.adminImg, `${args.adminName} · Administrador`, 'CREADO Y REVISADO POR')}
${firmaBox(args.directorImg, `${args.directorName} · Director`, 'AUTORIZADO POR')}
${args.cunoImg ? `<div class="cuno"><img src="${args.cunoImg}" alt="Cuño digital aprobado" /><p class="sub">Cuño digital aprobado</p></div>` : ''}
</section>
</body></html>`
}

/* ---------- El asistente (componente principal) ---------- */

export interface HiringSigners {
  administrator: { name: string } | null
  director: { name: string } | null
}

const DOCUMENT_STEPS = ['Datos personales', 'Salud y contacto', 'Puesto y currículum', 'Modalidad', 'Condiciones', 'Firmas'] as const

export default function WorkerHiringDocuments(props: {
  worker: Worker
  extended: WorkerExtended | null
  isAdmin: boolean
  signers: HiringSigners
  ciclo: HiringCiclo | null
  onSave: (hiringForm: WorkerHiringForm, workContract: WorkerWorkContract) => Promise<void>
  onMessage: (message: string) => void
}) {
  const { worker, isAdmin, signers, ciclo } = props
  const autofill = useMemo(() => hiringAutofill(worker, props.extended), [worker, props.extended])
  const baseHire = props.extended?.hiringForm ? mergeEmptyForm(props.extended.hiringForm, autofill.form) : autofill.form
  const [hire, setHire] = useState<WorkerHiringForm>(baseHire)
  const initialContractSource = contractDefaults(worker, baseHire)
  const [contract, setContract] = useState<WorkerWorkContract>(() => (props.extended?.workContract ? mergeEmptyForm(props.extended.workContract, initialContractSource) : initialContractSource))
  const [documentStep, setDocumentStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [signerImgs, setSignerImgs] = useState<{ admin: string | null; director: string | null }>({ admin: null, director: null })
  const touchedHire = useRef(new Set<string>())
  const touchedContract = useRef(new Set<string>())
  const previousHireAuto = useRef(autofill.form)
  const previousContractAuto = useRef(initialContractSource)
  const curriculumDrafted = useRef(false)
  const hoursSummary = useMemo(() => workerHoursSummary(ciclo), [ciclo])
  const adminName = signers.administrator?.name ?? ''
  const directorName = signers.director?.name ?? ''

  useEffect(() => {
    let alive = true
    void (async () => {
      const admin = signers.administrator ? await loadMediaDataUrl('firma-trabajador', slug(signers.administrator.name)).catch(() => null) : null
      const director = signers.director ? await loadMediaDataUrl('firma-trabajador', slug(signers.director.name)).catch(() => null) : null
      if (alive) setSignerImgs({ admin, director })
    })()
    return () => { alive = false }
  }, [signers.administrator, signers.director])

  // Si RH recibe un dato después de abrir la ficha, se actualizan solo
  // los campos todavía automáticos o vacíos: el autocompletado solo
  // escribe cuando trae un valor, y lo que la persona escribió a mano
  // (o lo que ya venía guardado) nunca se pisa (lógica del original).
  useEffect(() => {
    const previous = previousHireAuto.current
    setHire((current) => {
      const next = { ...current }
      for (const key of Object.keys(autofill.form) as (keyof WorkerHiringForm)[]) {
        if (touchedHire.current.has(key)) continue
        const desired = autofill.form[key]
        if (desired && (!current[key].trim() || current[key] === previous[key])) Object.assign(next, { [key]: desired })
      }
      return next
    })
    previousHireAuto.current = autofill.form
  }, [autofill.form])

  const automaticContract = useMemo(() => contractDefaults(worker, hire), [worker, hire])
  useEffect(() => {
    const previous = previousContractAuto.current
    setContract((current) => {
      const next = { ...current }
      for (const key of Object.keys(automaticContract) as (keyof WorkerWorkContract)[]) {
        if (touchedContract.current.has(key)) continue
        const desired = automaticContract[key]
        if (desired && (!current[key].trim() || current[key] === previous[key])) Object.assign(next, { [key]: desired })
      }
      return next
    })
    previousContractAuto.current = automaticContract
  }, [automaticContract])

  const setH = (key: keyof WorkerHiringForm) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    touchedHire.current.add(key)
    const value = event.target.value
    setHire((current) => ({ ...current, [key]: value }))
  }
  const setC = (key: keyof WorkerWorkContract) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    touchedContract.current.add(key)
    const value = event.target.value
    setContract((current) => ({ ...current, [key]: value }))
  }

  const adminNames = splitWorkerName(adminName)
  const effectiveHire: WorkerHiringForm = {
    ...hire,
    estudiosTerminados: '', campoEstudios: '', cuentaBancaria: '', telefonoInstitucion: '', anosExperiencia: '',
    horasTrabajo: `${fmtHoras(hoursSummary.hoursPerDay)} h por día completo · ${fmtHoras(hoursSummary.weekHours)} h en la semana · ${fmtHoras(hoursSummary.fortnightHours)} h en la quincena`,
    rhNombre: signers.administrator ? adminNames.nombre : hire.rhNombre,
    rhPrimerApellido: signers.administrator ? adminNames.primerApellido : hire.rhPrimerApellido,
    rhSegundoApellido: signers.administrator ? adminNames.segundoApellido : hire.rhSegundoApellido,
    rhCargo: signers.administrator ? 'Administrador' : hire.rhCargo,
  }
  const effectiveContract: WorkerWorkContract = {
    ...contract,
    nombreTrabajador: [effectiveHire.nombre, effectiveHire.primerApellido, effectiveHire.segundoApellido].filter(Boolean).join(' ') || worker.nombre,
    carnet: effectiveHire.carnet || worker.carnet,
    profesionOficio: effectiveHire.ocupacion || worker.ocupacion,
    direccion: [effectiveHire.calle, effectiveHire.numero].filter(Boolean).join(' No '),
    municipio: effectiveHire.municipio, provincia: effectiveHire.provincia, ocupacion: effectiveHire.ocupacion || worker.ocupacion,
    grupoEscala: '', escalaSalarial: effectiveHire.salario, categoriaOcupacional: '', jornada: '12-diarias',
    horario: '10:00 a. m.–10:00 p. m.',
    firmaTrabajador: effectiveHire.firmaTrabajador,
  }

  const generateCurriculum = useCallback(() => {
    touchedHire.current.delete('curriculum')
    setHire((current) => ({ ...current, curriculum: curriculumDraft(current, worker) }))
  }, [worker])
  useEffect(() => {
    if (documentStep !== 2 || curriculumDrafted.current) return
    curriculumDrafted.current = true
    if (hire.curriculum.trim()) return
    generateCurriculum()
  }, [documentStep, hire.curriculum, generateCurriculum])

  const saveDocument = async () => {
    if (saving) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      await props.onSave(
        { ...effectiveHire, evaluacion: '', updatedAt: now },
        { ...effectiveContract, firmaTrabajador: effectiveHire.firmaTrabajador, updatedAt: now },
      )
      props.onMessage('Documento de contratación guardado completo.')
    } catch {
      props.onMessage('No se pudo guardar el documento de contratación.')
    } finally {
      setSaving(false)
    }
  }

  const exportDocument = async () => {
    if (!signerImgs.admin || !signerImgs.director) {
      props.onMessage('Registra primero las firmas autorizadas del Administrador y del Director en RH.')
      return
    }
    const cunoImg = await bundledDataUrl(BRAND_CUNO_URL).catch(() => null)
    const html = buildContractHtml({
      hire: effectiveHire,
      contract: { ...effectiveContract, firmaTrabajador: effectiveHire.firmaTrabajador },
      workerName: effectiveContract.nombreTrabajador || worker.nombre,
      workerFirmaImg: strokesDataUrl(effectiveHire.firmaTrabajador),
      adminImg: signerImgs.admin,
      directorImg: signerImgs.director,
      adminName: adminName || 'Administrador',
      directorName: directorName || 'Director',
      cunoImg,
    })
    const ok = printHtml(html)
    props.onMessage(ok
      ? 'Documento único de contratación abierto para imprimir o guardar como PDF (vía de documentos de esta copia: ventana de impresión del navegador).'
      : 'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes e inténtalo de nuevo.')
  }

  const vacation = vacationStatus(hire.fechaContratacion)
  const base = `hire-${worker.key.replace(/[^a-z0-9_-]+/gi, '-')}`
  const Field = (f: {
    id: string; label: string; value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void
    type?: string; info?: string; span?: boolean; auto?: boolean
  }) => (
    <div className={f.span ? 'wf-hire-span' : undefined}>
      <label className="wf-hire-label" htmlFor={f.id}>{f.label}{f.info ? <InfoHelp label={f.info}>{f.info}</InfoHelp> : null}</label>
      <input id={f.id} type={f.type ?? 'text'} value={f.value} onChange={f.onChange} disabled={!isAdmin} className={`wf-hire-input${f.auto ? ' wf-hire-auto-input' : ''}`} />
    </div>
  )

  return (
    <section className="wf-hire" aria-label="Documento único de contratación">
      <h4 className="wf-hire-title">Contratación y contrato de trabajo</h4>
      <p className="wf-hire-desc">Un solo formulario y un solo PDF. Solo completa lo que todavía falta; lo conocido se rellena automáticamente y queda guardado para la próxima edición.</p>
      <div className="wf-hire-autobox" role="status">
        <span className="wf-hire-autobox-check" aria-hidden="true"><Icon name="check" size={14} /></span>
        <div>
          <p className="wf-hire-autobox-title">Datos enlazados automáticamente</p>
          <p className="wf-hire-autobox-text">No escribas otra vez lo que ya está en la ficha. Cuando falte algo, el formulario lo pide solo en su paso.</p>
          <div className="wf-hire-autobox-srcs">
            {autofill.sources.map((source) => <span key={source} className="wf-hire-source">{source}</span>)}
          </div>
        </div>
      </div>
      <div className="wf-hire-steps" role="group" aria-label="Pasos del formulario">
        {DOCUMENT_STEPS.map((label, index) => (
          <button key={label} type="button" onClick={() => setDocumentStep(index)} aria-current={documentStep === index ? 'step' : undefined} className={`wf-hire-step${documentStep === index ? ' is-on' : ''}`}>
            {index + 1}. {label}
          </button>
        ))}
      </div>

      {documentStep === 0 && (
        <div className="wf-hire-grid">
          <Field id={`${base}-fecha`} label="Fecha de contratación *" type="date" value={hire.fechaContratacion} onChange={setH('fechaContratacion')} />
          <Field id={`${base}-calle`} label="Calle" value={hire.calle} onChange={setH('calle')} />
          <Field id={`${base}-numero`} label="Número" value={hire.numero} onChange={setH('numero')} />
          {!autofill.form.nombre && <Field id={`${base}-nombre`} label="Nombre" value={hire.nombre} onChange={setH('nombre')} />}
          {!autofill.form.primerApellido && <Field id={`${base}-apellido1`} label="Primer apellido" value={hire.primerApellido} onChange={setH('primerApellido')} />}
          {!autofill.form.segundoApellido && <Field id={`${base}-apellido2`} label="Segundo apellido" value={hire.segundoApellido} onChange={setH('segundoApellido')} />}
          {!autofill.form.carnet && <Field id={`${base}-carnet`} label="Carné de identidad" value={hire.carnet} onChange={setH('carnet')} />}
          {!autofill.form.sexo && <Field id={`${base}-sexo`} label="Sexo" value={hire.sexo} onChange={setH('sexo')} />}
          {!autofill.form.edad && <Field id={`${base}-edad`} label="Edad" value={hire.edad} onChange={setH('edad')} />}
        </div>
      )}

      {documentStep === 1 && (
        <div className="wf-hire-grid">
          <div className="wf-hire-span">
            <label className="wf-hire-label" htmlFor={`${base}-enfermedad`}>Padece alguna enfermedad *<InfoHelp label="Cómo responder la enfermedad">Es obligatorio responder. Si no padece ninguna, escribe «No».</InfoHelp></label>
            <textarea id={`${base}-enfermedad`} value={hire.enfermedad} onChange={setH('enfermedad')} disabled={!isAdmin} className="wf-hire-input" rows={3} />
          </div>
          <Field id={`${base}-medicamentos`} label="Medicamentos" value={hire.medicamentos} onChange={setH('medicamentos')} />
          <Field id={`${base}-correo`} label="Correo" value={hire.correo} onChange={setH('correo')} />
          {!autofill.form.telefono && <Field id={`${base}-telefono`} label="Teléfono" value={hire.telefono} onChange={setH('telefono')} />}
          <Field id={`${base}-civil`} label="Estado civil" value={hire.estadoCivil} onChange={setH('estadoCivil')} />
          <div>
            <label className="wf-hire-label" htmlFor={`${base}-hijos`}>¿Tiene hijos?</label>
            <select id={`${base}-hijos`} value={hire.hijos} onChange={setH('hijos')} disabled={!isAdmin} className="wf-hire-input">
              <option value="">Seleccionar</option><option value="si">Sí</option><option value="no">No</option>
            </select>
          </div>
          {hire.hijos === 'si' && <Field id={`${base}-cant-hijos`} label="Cantidad de hijos" value={hire.cantidadHijos} onChange={setH('cantidadHijos')} />}
          <Field id={`${base}-idiomas`} label="Idiomas" value={hire.idiomas} onChange={setH('idiomas')} />
        </div>
      )}

      {documentStep === 2 && (
        <div className="wf-hire-col">
          <div className="wf-hire-grid">
            {!autofill.form.ocupacion && <Field id={`${base}-ocupacion`} label="Ocupación" value={hire.ocupacion} onChange={setH('ocupacion')} />}
            {!autofill.form.departamento && <Field id={`${base}-departamento`} label="Departamento" value={hire.departamento} onChange={setH('departamento')} />}
            <Field id={`${base}-salario`} label="Salario mensual (CUP)" type="number" value={hire.salario} onChange={setH('salario')} />
          </div>
          <div className="wf-hire-box">
            <p className="wf-hire-box-title">Jornada automática · 10:00 a. m.–10:00 p. m.</p>
            <div className="wf-hire-hours">
              <div className="wf-hire-hour"><span>Por día</span><strong>{fmtHoras(hoursSummary.hoursPerDay)} h</strong></div>
              <div className="wf-hire-hour"><span>Semana</span><strong>{fmtHoras(hoursSummary.weekHours)} h</strong></div>
              <div className="wf-hire-hour"><span>Quincena</span><strong>{fmtHoras(hoursSummary.fortnightHours)} h</strong></div>
            </div>
          </div>
          <div>
            <div className="wf-hire-curriculum-head">
              <label className="wf-hire-label" htmlFor={`${base}-curriculum`}>Currículum</label>
              {isAdmin ? (
                <button type="button" onClick={generateCurriculum} className="btn">
                  {hire.curriculum.trim() ? 'Redactar de nuevo' : 'Redactar borrador'}
                </button>
              ) : null}
            </div>
            <textarea id={`${base}-curriculum`} value={hire.curriculum} onChange={setH('curriculum')} disabled={!isAdmin} className="wf-hire-input" rows={7} />
            <p className="wf-hire-note">El borrador se compone solo con los datos confirmados de la ficha (nombre, ocupación, departamento, fecha e idiomas); no inventa estudios ni experiencia. Revísalo y complétalo antes de guardar.</p>
          </div>
        </div>
      )}

      {documentStep === 3 && (
        <div className="wf-hire-col">
          <div>
            <label className="wf-hire-label" htmlFor={`${base}-tipo`}>Tipo de contrato *</label>
            <select id={`${base}-tipo`} value={contract.tipoContrato} onChange={setC('tipoContrato')} disabled={!isAdmin} className="wf-hire-input">
              <option value="">Selecciona la modalidad</option>
              <option value="prueba">Periodo a prueba</option>
              <option value="indeterminado">Tiempo indeterminado</option>
              <option value="determinado-obra">Tiempo determinado / obra</option>
              <option value="adiestramiento">Adiestramiento</option>
            </select>
          </div>
          {contract.tipoContrato === 'prueba' && (
            <div className="wf-hire-grid">
              <Field id={`${base}-prueba-desde`} label="Prueba desde" type="date" value={contract.pruebaDesde} onChange={setC('pruebaDesde')} />
              <Field id={`${base}-prueba-hasta`} label="Prueba hasta" type="date" value={contract.pruebaHasta} onChange={setC('pruebaHasta')} />
            </div>
          )}
        </div>
      )}

      {documentStep === 4 && (
        <div className="wf-hire-col">
          <div className="wf-hire-box">
            <p className="wf-hire-box-title">Jornada calculada</p>
            <p className="wf-hire-text">Cada día completo de 10:00 a. m. a 10:00 p. m. suma 12 horas. Esta semana suma {fmtHoras(hoursSummary.weekHours)} h y la quincena, {fmtHoras(hoursSummary.fortnightHours)} h según las marcas de RH.</p>
          </div>
          {vacation.kind === 'available' ? (
            <div className="wf-hire-box wf-hire-vac-ok">
              <p className="wf-hire-box-title">Vacaciones disponibles</p>
              <p className="wf-hire-text">Cumplió los 6 meses el {fmtDate(vacation.eligibleDate)} y ya puede tomar 1 semana de vacaciones.</p>
            </div>
          ) : vacation.kind === 'pending' ? (
            <div className="wf-hire-box">
              <p className="wf-hire-box-title">Vacaciones en cuenta atrás</p>
              <p className="wf-hire-text">Cumple los 6 meses el {fmtDate(vacation.eligibleDate)} · quedan {vacation.days} día{vacation.days === 1 ? '' : 's'} para poder tomar 1 semana.</p>
            </div>
          ) : (
            <div className="wf-hire-box">
              <p className="wf-hire-box-title">Vacaciones</p>
              <p className="wf-hire-text">Al cumplir 6 meses de contratado podrá tomar 1 semana de vacaciones.</p>
            </div>
          )}
          <div className="wf-hire-clauses">
            <p className="wf-hire-clauses-title">Cláusulas TERCERO a NOVENO <InfoHelp label="Cláusulas TERCERO a NOVENO del contrato">TERCERO: el trabajador cumple la legislación laboral, la disciplina y la ética; usa y cuida los medios de protección y de trabajo, y realiza las funciones de su ocupación. CUARTO: la administración crea las condiciones de trabajo necesarias. QUINTO: salario según la ocupación conforme a la legislación vigente. SEXTO: seguridad y salud del trabajo como derecho del trabajador y deber de la administración. SÉPTIMO: las relaciones se ajustan a la Ley No. 116/2013, Código de Trabajo, y disposiciones complementarias. OCTAVO: derecho a vacaciones pagadas conforme a la legislación. NOVENO: la disciplina se rige por el reglamento disciplinario interno de la entidad.</InfoHelp></p>
            <p className="wf-hire-text">TERCERO (compromisos del trabajador), CUARTO (compromisos de la administración), QUINTO (salario), SEXTO (seguridad y salud), SÉPTIMO (marco legal), OCTAVO (vacaciones) y NOVENO (disciplina).</p>
          </div>
        </div>
      )}

      {documentStep === 5 && (
        <div className="wf-hire-col">
          <Field id={`${base}-firma-fecha`} label="Fecha de firma *" type="date" value={contract.fechaFirma} onChange={setC('fechaFirma')} />
          <div className="wf-hire-signbox">
            <p className="wf-hire-box-title">Creado y revisado por</p>
            <p className="wf-hire-text">{adminName || 'Administrador no identificado'}{signers.administrator ? ' · Administrador' : ''}</p>
            {signerImgs.admin ? (
              <div className="wf-hire-signimg"><img src={signerImgs.admin} alt="Firma autorizada del Administrador" /></div>
            ) : <p className="wf-hire-missing">Falta la firma autorizada del Administrador.</p>}
          </div>
          <div className="wf-hire-signbox">
            <p className="wf-hire-box-title">Autorizado por</p>
            <p className="wf-hire-text">{directorName || 'Director no identificado'}{signers.director ? ' · Director' : ''}</p>
            {signerImgs.director ? (
              <div className="wf-hire-signimg"><img src={signerImgs.director} alt="Firma autorizada del Director" /></div>
            ) : <p className="wf-hire-missing">Falta la firma autorizada del Director.</p>}
          </div>
          <HiringSignaturePad
            initialData={hire.firmaTrabajador}
            disabled={!isAdmin}
            title="Firma del trabajador"
            description="Compatible con lápiz óptico y con rechazo de palma cuando el lápiz está activo."
            onSave={(strokes) => {
              touchedHire.current.add('firmaTrabajador')
              setHire((current) => ({ ...current, firmaTrabajador: JSON.stringify(strokes) }))
            }}
            onDelete={() => {
              touchedHire.current.add('firmaTrabajador')
              setHire((current) => ({ ...current, firmaTrabajador: '' }))
            }}
          />
        </div>
      )}

      <div className="wf-hire-nav">
        <button type="button" disabled={documentStep === 0} onClick={() => setDocumentStep((s) => Math.max(0, s - 1))} className="btn">Paso anterior</button>
        {documentStep < DOCUMENT_STEPS.length - 1 ? (
          <button type="button" onClick={() => setDocumentStep((s) => Math.min(DOCUMENT_STEPS.length - 1, s + 1))} className="btn primary">Continuar</button>
        ) : isAdmin ? (
          <button type="button" onClick={() => void saveDocument()} disabled={saving} className="btn primary">{saving ? 'Guardando…' : 'Guardar documento'}</button>
        ) : null}
        <button type="button" onClick={() => void exportDocument()} className="btn"><Icon name="download" size={14} /> Exportar PDF único</button>
      </div>
    </section>
  )
}
