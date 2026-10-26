/* Registro de trabajadores de RH — puerto regla a regla del
   WorkersRegistry del original (App.tsx ~6778-8280), D-RH:
   organigrama al principio del registro → Resumen → escáner QR →
   cabecera «Registro de trabajadores» con su InfoHelp (todo el
   texto explicativo tras el ⓘ, nunca abierto) → paneles (Cuentas,
   cumpleaños, a quién le toca) → añadir trabajador → buscador →
   rejilla de tarjetas-ficha por orden alfabético → Historial de
   trabajadores. Cada tarjeta ES la ficha: resumen siempre visible
   (cuño en su banda, chips, datos, vacaciones, turno comparado,
   ausencias, ciclo con horas y bloques, cuadrados del mes, total
   pagado) y la ficha completa se abre DENTRO de la tarjeta con los
   bloques del original en su orden: Cuentas → Evaluación → Datos
   (con Turno, descanso y días fijos) → Documentos/Firma/Credencial
   → Ausencias → Historial de pagos → Pago a mano → Contrato
   cancelado → Eliminar del registro.
   Persistencia: saveWorkersRegistry / sbSaveWorkersRegistry
   (fichas base, extendido, pagos manuales e historial).
   Declarado: el paso AUTOMÁTICO al historial al importar el primer
   IPV de una quincena nueva vive en el servidor del original; aquí
   el paso es manual con «Eliminar del registro». La foto de la
   tarjeta se cambia desde Documentos/media como en el resto del
   clon (sin el ActionMenu de foto del original). */

import { useMemo, useState } from 'react'
import type { Receivable, StoredData, Worker, WorkerExtended, WorkerHistorialEntry, WorkerPayment } from '../types'
import { InfoHelp } from '../components/ui'
import { Icon } from '../components/icons'
import { WorkerPhoto } from '../components/MediaImage'
import WorkerFichaCompleta, { WorkerQrScanner } from '../components/WorkerFichaCompleta'
import { effectiveSaldo, fmtDate, fmtDateShort, fmtInt, isMorosa, todayISO } from '../lib/utils'
import { saveWorkersRegistry, supabaseConfigured } from '../lib/backend'
import { sbSaveWorkersRegistry } from '../lib/supabaseBackend'
import { addDaysISO, canonicalPersonKey, diffDays } from '../lib/syncCore.mjs'
import {
  OrganigramaEquipo, EstrellasValor, detectarTurnoAlterno, esCargoDeTurno, trabajaSegunTurno,
} from './RH'

const SB_MODE = supabaseConfigured()

type RegistryPatch = Parameters<typeof saveWorkersRegistry>[0] & { removeWorkerKeys?: string[] }

/* ---------- Ayudantes del original (App.tsx 791-858, 5418-5450) ---------- */

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
function birthdayCountdown(carnet: string): { days: number; nextDate: string } | null {
  const birth = carnetBirthDate(carnet)
  if (!birth) return null
  const [, month = '', day = ''] = birth.split('-')
  const today = todayISO()
  const yearNow = Number(today.slice(0, 4))
  for (let year = yearNow; year <= yearNow + 8; year++) {
    const nextDate = `${year}-${month}-${day}`
    const candidate = new Date(`${nextDate}T12:00:00`)
    if (candidate.getFullYear() !== year || String(candidate.getMonth() + 1).padStart(2, '0') !== month || String(candidate.getDate()).padStart(2, '0') !== day) continue
    if (nextDate < today) continue
    return { days: diffDays(today, nextDate), nextDate }
  }
  return null
}
function birthdayIsTomorrow(carnet: string): boolean {
  return birthdayCountdown(carnet)?.days === 1
}
function birthdayCountdownText(carnet: string): string | null {
  const countdown = birthdayCountdown(carnet)
  if (!countdown) return null
  if (countdown.days === 0) return 'Hoy cumple años'
  if (countdown.days === 1) return 'Falta 1 día para su cumpleaños'
  return `Faltan ${countdown.days} días para su cumpleaños`
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
const NOMBRES_DIA_SEMANA_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']
function listaDiasFijos(dias: number[]): string {
  const partes = [1, 2, 3, 4, 5, 6, 0].filter((d) => dias.includes(d)).map((d) => `los ${NOMBRES_DIA_SEMANA_PLURAL[d]}`)
  if (partes.length <= 1) return partes[0] ?? ''
  if (partes.length === 2) return `${partes[0]} y ${partes[1]}`
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}
function textoTurno(t: number | null | undefined): string {
  return t === 1 || t === 2 ? `Turno ${t}` : 'Sin turno'
}
function fmtDias(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/* ---------- Modelo de ficha (equivalente al WorkerCard del servidor) ---------- */

export interface HistorialPago {
  tipo: 'nomina' | 'manual'
  fecha: string
  monto: number
  concepto?: string
  cycleStart?: string
  cycleEnd?: string
  manualIndex?: number
}
interface CicloFicha {
  cycleStart: string
  cycleEnd: string
  payDate: string
  dias: number
  salarioDiario: number
  salarioFijo: number
  acumulado: number
  pagada: boolean
  montoPagado: number
  cerrada: boolean
  fechaFoto: string | null
  detalleDias: Array<{ fecha: string; valor: number | null; ausenciaMotivo: string | null }>
}
export interface FichaModel {
  w: Worker
  ext: WorkerExtended | null
  estrellas: number
  genero: string
  escolaridad: string
  canceladoEl: string | null
  ciclo: CicloFicha | null
  historial: HistorialPago[]
  totalPagado: number
  cuentasPartidas: Array<{ rec: Receivable; saldo: number; morosa: boolean }>
  cuentasSaldo: number
  turno: {
    aplica: boolean
    asignado: 1 | 2 | null
    detectado: 1 | 2 | null
    correccion: 1 | 2 | null
    valido: 1 | 2 | null
    estado: 'coincide' | 'no-cuadra' | 'cuadrado-a-mano' | 'sin-asignar' | 'sin-detectar' | 'sin-datos'
  }
}

interface RegistryProps {
  data: StoredData
  marks: Record<string, Record<string, number>>
  today: string
  win: { start: string; end: string; payDate: string }
  derivedEmployees: Array<{ nombre: string; dias: number; salarioDiario: number; totalCobrar: number; acumulado?: number }>
  recorded: { employees: Array<{ nombre: string; totalCobrar: number }> } | null
  extMap: Map<string, WorkerExtended>
  isAdmin: boolean
  onChanged: () => void
}

/* ---------- Construcción del modelo por trabajador ---------- */

function buildFicha(p: RegistryProps, w: Worker): FichaModel {
  const { data, marks, today, win } = p
  const ext = p.extMap.get(w.key) ?? null
  const emp = p.derivedEmployees.find((e) => canonicalPersonKey(null, e.nombre) === w.key) ?? null
  const recEmp = p.recorded?.employees.find((e) => canonicalPersonKey(null, e.nombre) === w.key) ?? null
  const ausencias = ext?.ausencias ?? []
  const ausByFecha = new Map(ausencias.map((a) => [a.fecha, a]))
  const importedDates = new Set(data.days.map((d) => d.date))
  let ciclo: CicloFicha | null = null
  if (w.roleKind !== 'direccion' && (emp || recEmp)) {
    const detalleDias: CicloFicha['detalleDias'] = []
    for (let i = 0; i < 15; i++) {
      const fecha = addDaysISO(win.start, i)
      const mark = marks[w.key]?.[fecha]
      detalleDias.push({
        fecha,
        valor: mark != null ? mark : importedDates.has(fecha) ? 0 : null,
        ausenciaMotivo: ausByFecha.get(fecha)?.motivo ?? null,
      })
    }
    const dias = recEmp ? (emp?.dias ?? 0) : (emp?.dias ?? 0)
    const salarioDiario = emp?.salarioDiario ?? 0
    const salarioFijo = recEmp ? recEmp.totalCobrar : (emp?.totalCobrar ?? 0)
    ciclo = {
      cycleStart: win.start,
      cycleEnd: win.end,
      payDate: win.payDate,
      dias,
      salarioDiario,
      salarioFijo,
      acumulado: Math.round(dias * salarioDiario),
      pagada: Boolean(recEmp),
      montoPagado: recEmp ? recEmp.totalCobrar : salarioFijo,
      cerrada: win.end < today,
      fechaFoto: [...importedDates].filter((f) => f >= win.start && f <= win.end && f <= today).sort().pop() ?? null,
      detalleDias,
    }
  }
  const historial: HistorialPago[] = []
  for (const pay of data.payrollHistory) {
    const e = pay.employees.find((x) => canonicalPersonKey(null, x.nombre) === w.key)
    if (e) historial.push({ tipo: 'nomina', fecha: pay.payDate, monto: e.totalCobrar, cycleStart: pay.cycleStart, cycleEnd: pay.cycleEnd })
  }
  data.workerPayments.forEach((wp, i) => {
    if (wp.workerKey === w.key) historial.push({ tipo: 'manual', fecha: wp.fecha, monto: wp.monto, concepto: wp.concepto, manualIndex: i })
  })
  historial.sort((a, b) => b.fecha.localeCompare(a.fecha))
  const cuentasPartidas = data.receivables
    .filter((r) => canonicalPersonKey(r.clientKey, r.client) === w.key && r.date >= win.start && r.date <= win.end)
    .map((rec) => ({ rec, saldo: effectiveSaldo(rec, data.localPayments), morosa: false }))
    .filter((x) => x.saldo > 0 && x.rec.status !== 'pagada' && !x.rec.closeKind)
    .map((x) => ({ ...x, morosa: isMorosa(x.rec, x.saldo, today) }))
  const obs = Object.entries(marks[w.key] ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([f]) => f <= today && !ausByFecha.has(f))
    .map(([fecha, v]) => ({ fecha, on: v > 0 }))
  const aplica = esCargoDeTurno(w.ocupacion)
  const detectado = aplica ? detectarTurnoAlterno(obs) : null
  const asignado = ext?.turnoAsignado ?? null
  const correccion = ext?.turnoCorreccion ?? null
  const valido = correccion ?? detectado ?? asignado
  const estado = !aplica
    ? 'sin-datos' as const
    : correccion != null
      ? 'cuadrado-a-mano' as const
      : asignado != null && detectado != null
        ? (asignado === detectado ? 'coincide' as const : 'no-cuadra' as const)
        : asignado != null
          ? 'sin-detectar' as const
          : detectado != null
            ? 'sin-asignar' as const
            : 'sin-datos' as const
  return {
    w,
    ext,
    estrellas: ext?.estrellas ?? 0,
    genero: ext?.genero ?? '',
    escolaridad: ext?.escolaridad ?? '',
    canceladoEl: ext?.contratoCanceladoEl ?? null,
    ciclo,
    historial,
    totalPagado: historial.reduce((s, h) => s + h.monto, 0),
    cuentasPartidas,
    cuentasSaldo: cuentasPartidas.reduce((s, x) => s + x.saldo, 0),
    turno: { aplica, asignado, detectado, correccion, valido, estado },
  }
}

/* ---------- Editor de estrellas (original ~5601) ---------- */

function EstrellasEditor({ value, nombre, disabled, onRate }: {
  value: number
  nombre: string
  disabled?: boolean
  onRate: (n: number) => void
}) {
  return (
    <div className="wr-stars-edit" role="group" aria-label={`Valorar el desempeño de ${nombre} de 1 a 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          aria-label={`${n} estrella${n === 1 ? '' : 's'}`}
          aria-pressed={value === n}
          onClick={() => onRate(value === n ? 0 : n)}
        >
          <svg width={26} height={26} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.7l-5.2 2.7 1-5.8L3.6 9.5l5.8-.8z" fill={n <= value ? '#F59E0B' : 'none'} stroke={n <= value ? '#D97706' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
      <span className="small muted">{value ? `${value} de 5` : 'Sin valorar'}</span>
    </div>
  )
}

/* ---------- Cuadrados del mes (WorkerMonthSquares del original) ---------- */

function WorkerMonthSquares({ model, marks, importedDates, today }: { model: FichaModel; marks: Record<string, number>; importedDates: Set<string>; today: string }) {
  const monthKey = today.slice(0, 7)
  const [y, m] = monthKey.split('-').map(Number)
  const count = new Date(y!, m!, 0).getDate()
  const dias: Array<{ fecha: string; valor: number | null; ausenciaMotivo: string | null }> = []
  for (let d = 1; d <= count; d++) {
    const fecha = `${monthKey}-${String(d).padStart(2, '0')}`
    dias.push({ fecha, valor: null, ausenciaMotivo: null })
  }
  const ausByFecha = new Map((model.ext?.ausencias ?? []).map((a) => [a.fecha, a.motivo]))
  let trabajados = 0
  for (const d of dias) {
    const v = marks[d.fecha]
    d.valor = v != null ? v : importedDates.has(d.fecha) ? 0 : null
    d.ausenciaMotivo = ausByFecha.get(d.fecha) ?? null
    if (d.valor != null && d.ausenciaMotivo == null) trabajados += d.valor
  }
  if (!dias.some((d) => d.valor !== null || d.ausenciaMotivo != null)) return null
  const monthLabelRaw = new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('es-CU', { month: 'long', year: 'numeric' })
  const monthLabel = monthLabelRaw.charAt(0).toUpperCase() + monthLabelRaw.slice(1)
  const lead = (new Date(`${dias[0]!.fecha}T12:00:00`).getDay() + 6) % 7
  const cells: Array<(typeof dias)[number] | null> = [...Array<null>(lead).fill(null), ...dias]
  while (cells.length % 7 !== 0) cells.push(null)
  const trabajadosTxt = fmtDias(trabajados)
  return (
    <div className="wr-month" aria-label={`Días trabajados de ${model.w.nombre} en ${monthLabel}`}>
      <div className="wr-month-head">
        <p className="wr-block-title">Días del mes · {monthLabel}</p>
        <span className="wr-chip wr-chip-ok">{trabajadosTxt} día{trabajados === 1 ? '' : 's'} trabajado{trabajados === 1 ? '' : 's'}</span>
      </div>
      <div className="wr-month-week" aria-hidden="true">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((l) => <span key={l}>{l}</span>)}
      </div>
      <div className="wr-month-grid" role="img" aria-label={`Calendario de ${monthLabel}: ${trabajadosTxt} días trabajados de ${dias.length}`}>
        {cells.map((d, i) => d === null ? (
          <div key={`vacio-${i}`} aria-hidden="true" />
        ) : (
          <div
            key={d.fecha}
            title={d.ausenciaMotivo != null ? `${fmtDateShort(d.fecha)}: ausencia justificada — ${d.ausenciaMotivo || 'sin motivo escrito'}. No cuenta como trabajado.` : d.valor === null ? `${fmtDateShort(d.fecha)}: aún sin marca en la foto` : d.valor > 0 ? `${fmtDateShort(d.fecha)}: trabajó${d.valor < 1 ? ' (medio día)' : ''}` : `${fmtDateShort(d.fecha)}: descanso`}
            className={`wr-sq${d.ausenciaMotivo != null ? ' is-aus' : d.valor === null ? ' is-none' : d.valor >= 1 ? ' is-full' : d.valor > 0 ? ' is-half' : ' is-rest'}${d.fecha === today ? ' is-today' : ''}${d.fecha > today ? ' is-future' : ''}`}
          >
            {d.ausenciaMotivo != null ? 'A' : d.fecha.slice(8).replace(/^0/, '')}
          </div>
        ))}
      </div>
      <p className="wr-legend">Cuadrados del mes: lleno trabajó · medio tono, medio día · gris descanso · punteado aún sin foto · <strong className="wr-amber">A en ámbar = ausencia justificada</strong> · borde dorado, hoy.</p>
    </div>
  )
}

/* ---------- Tarjeta-ficha (resumen siempre visible) ---------- */

interface CardCtx {
  data: StoredData
  marks: Record<string, Record<string, number>>
  today: string
  win: { start: string; end: string; payDate: string }
  isAdmin: boolean
  openKey: string | null
  setOpenKey: (k: string | null) => void
  persist: (patch: RegistryPatch) => Promise<void>
  setMsg: (m: string) => void
}

function TurnoComparacion({ model }: { model: FichaModel }) {
  const t = model.turno
  if (!t.aplica) return null
  const badge = t.estado === 'coincide'
    ? { texto: 'Coincide', cls: 'wr-chip-ok' }
    : t.estado === 'no-cuadra'
      ? { texto: 'No cuadra: corrígelo en la ficha', cls: 'wr-chip-bad' }
      : t.estado === 'cuadrado-a-mano'
        ? { texto: 'Cuadrado a mano: manda tu corrección', cls: 'wr-chip-deep' }
        : t.estado === 'sin-asignar'
          ? { texto: 'Falta poner el turno a mano', cls: 'wr-chip-dim' }
          : t.estado === 'sin-detectar'
            ? { texto: 'Puesto a mano; aún sin detectar del IPV', cls: 'wr-chip-dim' }
            : { texto: 'Sin turno puesto ni detectado', cls: 'wr-chip-dim' }
  return (
    <div className="wr-turno-cmp" aria-label={`Turnos de ${model.w.nombre}`}>
      <div className="wr-turno-cmp-head">
        <p className="wr-block-title">Turno</p>
        <span className={`wr-chip ${badge.cls}`}>{badge.texto}</span>
      </div>
      <p className="wr-text">Puesto a mano: <strong>{textoTurno(t.asignado)}</strong> · Detectado del IPV: <strong>{t.detectado ? textoTurno(t.detectado) : 'aún sin detectar'}</strong></p>
      <p className="wr-text muted">
        Válido: <strong>{t.valido ? textoTurno(t.valido) : '—'}</strong>
        {t.correccion ? <> (corrección manual puesta por ti)</> : t.detectado ? <> (el detectado del IPV)</> : t.asignado ? <> (el puesto a mano)</> : null}
      </p>
    </div>
  )
}

function WorkerCard({ model, ctx, historialEntry }: {
  model: FichaModel
  ctx: CardCtx
  historialEntry?: WorkerHistorialEntry
}) {
  const { w } = model
  const { today } = ctx
  const open = ctx.openKey === w.key
  const enHistorial = Boolean(historialEntry)
  const nacimiento = carnetBirthDate(w.carnet)
  const cuentaAtras = birthdayCountdownText(w.carnet)
  const vacation = vacationStatus(model.ext?.fechaContratacion ?? '')
  const ciclo = model.ciclo
  const horasPorDia = 12
  const generoTxt = model.genero ? model.genero.charAt(0).toUpperCase() + model.genero.slice(1) : ''
  const escolaridadTxt = model.escolaridad === 'preuniversitario' ? 'Preuniversitario' : model.escolaridad === 'tecnico_medio' ? 'Técnico medio' : model.escolaridad === 'maestria' ? 'Maestría' : model.escolaridad ? model.escolaridad.charAt(0).toUpperCase() + model.escolaridad.slice(1) : ''
  const fijos = model.ext ? (model.ext.workWeekdays.length ? model.ext.workWeekdays : model.ext.workWeekday != null ? [model.ext.workWeekday] : []) : []
  const importedDates = useMemo(() => new Set(ctx.data.days.map((d) => d.date)), [ctx.data.days])

  return (
    <article id={`worker-card-${w.key}`} className={`wr-card${model.canceladoEl ? ' worker-card-cancelled' : ''}`} aria-label={`Ficha de ${w.nombre}`}>
      {model.canceladoEl ? (
        <div className="worker-stamp-row" aria-hidden="true"><span className="worker-stamp-cancelled">CANCELADO</span></div>
      ) : w.roleKind !== 'direccion' ? (
        <div className="worker-stamp-row" aria-hidden="true"><span className="worker-stamp-approved">APROBADO</span></div>
      ) : null}
      <div className="wr-card-head">
        <WorkerPhoto nombre={w.nombre} className="wr-photo" avatarClassName="wr-photo" colorKey={w.key} />
        <div className="wr-card-head-main">
          <h4 className="font-display wr-name">{w.nombre}</h4>
          <p className="wr-sub">{w.ocupacion || 'Sin cargo registrado'}</p>
          <div className="wr-chips">
            <span className={`wr-chip ${w.origen === 'ipv' ? 'wr-chip-ok' : 'wr-chip-dim'}`}>{w.origen === 'ipv' ? 'Del IPV' : 'Añadido a mano'}</span>
            {w.roleKind === 'direccion' && <span className="wr-chip wr-chip-dir">Dirección · fuera de nómina</span>}
            {model.canceladoEl ? (
              <span className="wr-chip wr-chip-bad">Contrato cancelado</span>
            ) : w.roleKind !== 'direccion' ? (
              <span className="wr-chip wr-chip-ok">Contrato vigente · aprobado</span>
            ) : null}
          </div>
          <span className="wr-stars-line">
            <EstrellasValor value={model.estrellas} size={14} />
            <span className="wr-dim11">{model.estrellas ? `Desempeño: ${model.estrellas} de 5` : 'Desempeño sin valorar'}</span>
          </span>
        </div>
      </div>

      {w.roleKind !== 'direccion' && (model.ext?.restWeekday != null || fijos.length > 0) && (
        <div className="wr-chips wr-chips-row">
          {model.ext?.restWeekday != null && <span className="wr-chip wr-chip-dim">Descansa los {NOMBRES_DIA_SEMANA_PLURAL[model.ext.restWeekday]}</span>}
          {fijos.length > 0 && <span className="wr-chip wr-chip-ok">{fijos.length === 1 ? `Trabaja solo ${listaDiasFijos(fijos)}` : `Trabaja ${listaDiasFijos(fijos)}`}</span>}
        </div>
      )}

      {(w.carnet || w.cuentaBancaria || w.movil || model.genero || model.escolaridad) ? (
        <dl className="wr-dl">
          {w.carnet && (
            <>
              <div><dt>Carné:</dt><dd className="wr-break">{w.carnet}</dd></div>
              {nacimiento && <div><dt>Nacimiento:</dt><dd>{fmtDate(nacimiento)}{ageFromCarnet(w.carnet) != null ? ` · ${ageFromCarnet(w.carnet)} años` : ''}</dd></div>}
              {cuentaAtras && <div><dt>Cumpleaños:</dt><dd className="wr-deep-bold">{cuentaAtras}</dd></div>}
            </>
          )}
          {w.cuentaBancaria && (<div><dt>Cuenta:</dt><dd className="wr-break">{w.cuentaBancaria}</dd></div>)}
          {w.movil && (<div><dt>Móvil:</dt><dd>{w.movil}</dd></div>)}
          {model.genero && (<div><dt>Género:</dt><dd>{generoTxt}</dd></div>)}
          {model.escolaridad && (<div><dt>Escolaridad:</dt><dd>{escolaridadTxt}</dd></div>)}
        </dl>
      ) : (
        <p className="wr-dim12 wr-mt3">Sin carné, cuenta ni móvil registrados todavía. Puedes escribirlos en su ficha.</p>
      )}

      {w.roleKind !== 'direccion' && (
        <div className={`wr-vac ${vacation.kind === 'available' ? 'is-ok' : ''}`} aria-label={`Vacaciones de ${w.nombre}`}>
          <div className="wr-vac-head">
            <p className="wr-vac-title">Vacaciones · 1 semana</p>
            {vacation.kind === 'available' ? <span className="wr-chip wr-chip-deep">Disponible</span> : vacation.kind === 'pending' ? <span className="wr-chip wr-chip-surface">Faltan {vacation.days} día{vacation.days === 1 ? '' : 's'}</span> : null}
          </div>
          <p className="wr-dim11 wr-mt1">{vacation.kind === 'missing' ? 'Añade la fecha de contratación en el documento para iniciar la cuenta atrás.' : vacation.kind === 'available' ? `Cumplió 6 meses el ${fmtDate(vacation.eligibleDate)}.` : `Disponible el ${fmtDate(vacation.eligibleDate)}, al cumplir 6 meses desde su contratación.`}</p>
        </div>
      )}

      {w.roleKind !== 'direccion' && <TurnoComparacion model={model} />}

      {w.roleKind !== 'direccion' && (model.ext?.ausencias ?? []).length > 0 && (
        <div className="wr-aus-summary" aria-label={`Ausencias justificadas de ${w.nombre}`}>
          <p className="wr-aus-title">Ausencias justificadas · no cuentan como trabajadas</p>
          <ul>
            {(model.ext?.ausencias ?? []).slice(0, 4).map((a) => (
              <li key={a.id}><strong>{fmtDateShort(a.fecha)}:</strong> {a.motivo}</li>
            ))}
          </ul>
          {(model.ext?.ausencias ?? []).length > 4 && <p className="wr-aus-more">…y {(model.ext?.ausencias ?? []).length - 4} más en su ficha.</p>}
        </div>
      )}

      {ciclo ? (
        <div className="wr-ciclo">
          <div className="wr-ciclo-head">
            <p className="wr-block-title">Ciclo {fmtDateShort(ciclo.cycleStart)} — {fmtDateShort(ciclo.cycleEnd)} · pago {fmtDateShort(ciclo.payDate)}</p>
            <span className={`wr-chip ${ciclo.cerrada ? 'wr-chip-deep' : 'wr-chip-ok'}`}>
              {ciclo.cerrada ? (ciclo.pagada ? 'Quincena cerrada · pagada' : 'Quincena cerrada') : 'Quincena abierta · en curso'}
            </span>
          </div>
          <div className="wr-horas" aria-label={`Horas trabajadas de ${w.nombre}`}>
            <div><p>Por día completo</p><strong>{horasPorDia} h</strong></div>
            <div><p>{ciclo.cerrada ? 'Última semana' : 'Esta semana'}</p><strong>{fmtInt(semanaHoras(ciclo, today, horasPorDia))} h</strong></div>
            <div><p>Quincena</p><strong className="wr-deep">{fmtInt(Math.max(0, ciclo.dias) * horasPorDia)} h</strong></div>
          </div>
          <p className="wr-legend">Horario: 10:00 a. m.–10:00 p. m. · Semana {fmtDateShort(inicioSemana(ciclo, today))}–{fmtDateShort(addDaysISO(inicioSemana(ciclo, today), 6))} · cálculo automático, sin entrada manual.</p>
          {ciclo.cerrada ? (
            <>
              <div className="wr-cifras">
                <div><p>Días trabajados</p><strong>{fmtInt(ciclo.dias)}</strong></div>
                <div><p>Pago por día</p><strong>{fmtInt(ciclo.salarioDiario)}</strong></div>
                <div><p>Total a cobrar</p><strong className="wr-deep">{fmtInt(ciclo.salarioFijo > 0 ? ciclo.salarioFijo : ciclo.montoPagado)}</strong></div>
                <div><p>{ciclo.pagada ? 'Pagado (cierre)' : 'Total del cierre'}</p><strong className="wr-deep">{fmtInt(ciclo.montoPagado)}</strong></div>
              </div>
              <p className="wr-dim11 wr-mt2">
                {ciclo.pagada
                  ? <>Cierre de quincena: se pagaron {fmtInt(ciclo.montoPagado)} CUP por {fmtInt(ciclo.dias)} día{ciclo.dias === 1 ? '' : 's'} trabajado{ciclo.dias === 1 ? '' : 's'}; el pago por día de la hoja RH es {fmtInt(ciclo.salarioDiario)} CUP. Pago registrado el {fmtDateShort(ciclo.payDate)}.</>
                  : <>Cierre de quincena: el total a cobrar fue {fmtInt(ciclo.montoPagado)} CUP por {fmtInt(ciclo.dias)} día{ciclo.dias === 1 ? '' : 's'} trabajado{ciclo.dias === 1 ? '' : 's'}; el pago por día de la hoja RH es {fmtInt(ciclo.salarioDiario)} CUP (pago del {fmtDateShort(ciclo.payDate)}). Si el pago real fue otro, corrígelo en «Pagos de este ciclo» y el cierre se actualiza.</>}
                {ciclo.fechaFoto ? <> Foto del {fmtDateShort(ciclo.fechaFoto)}.</> : null}
              </p>
            </>
          ) : (
            <>
              <div className="wr-cifras">
                <div><p>Días trabajados</p><strong>{fmtInt(ciclo.dias)}</strong></div>
                <div><p>Pago por día</p><strong>{fmtInt(ciclo.salarioDiario)}</strong></div>
                <div><p>Total a cobrar</p><strong className="wr-deep">{ciclo.salarioFijo > 0 ? fmtInt(ciclo.salarioFijo) : '—'}</strong></div>
                <div><p>Va acumulando</p><strong className="wr-accent">{fmtInt(ciclo.acumulado)}</strong></div>
              </div>
              <p className="wr-dim11 wr-mt2">
                Hasta la fecha{ciclo.fechaFoto ? <> (foto del {fmtDateShort(ciclo.fechaFoto)})</> : null}: {fmtInt(ciclo.dias)} día{ciclo.dias === 1 ? '' : 's'} trabajado{ciclo.dias === 1 ? '' : 's'} de los 15 que le tocan en la quincena, y {fmtInt(ciclo.acumulado)} CUP acumulados: cada día trabajado suma {fmtInt(ciclo.salarioDiario)} CUP{ciclo.salarioFijo > 0 ? <> contra el total a cobrar de {fmtInt(ciclo.salarioFijo)} CUP (su salario fijo), que es lo que cobra al cerrarse la quincena</> : null}. Sigue sumando hasta el cierre del {fmtDateShort(ciclo.cycleEnd)}; el pago es el {fmtDateShort(ciclo.payDate)}.
              </p>
            </>
          )}
          {ciclo.detalleDias.some((d) => d.valor !== null || d.ausenciaMotivo != null) && (
            <div className="wr-mt3">
              <div className="wr-blocks" role="img" aria-label={`Días trabajados en la quincena: ${ciclo.detalleDias.filter((d) => (d.valor ?? 0) > 0).length} de 15`}>
                {ciclo.detalleDias.map((d) => (
                  <div
                    key={d.fecha}
                    title={d.ausenciaMotivo != null ? `${fmtDateShort(d.fecha)}: ausencia justificada — ${d.ausenciaMotivo || 'sin motivo escrito'}. No cuenta como trabajado.` : d.valor === null ? `${fmtDateShort(d.fecha)}: aún sin marca en la foto` : d.valor > 0 ? `${fmtDateShort(d.fecha)}: ${fmtInt(d.valor * horasPorDia)} h trabajadas${d.valor < 1 ? ' (medio día)' : ''}` : `${fmtDateShort(d.fecha)}: descanso · 0 h`}
                    className={`wr-block${d.ausenciaMotivo != null ? ' is-aus' : d.valor === null ? ' is-none' : d.valor >= 1 ? ' is-full' : d.valor > 0 ? ' is-half' : ' is-rest'}${d.fecha === today ? ' is-today' : ''}`}
                  >
                    {d.ausenciaMotivo != null ? 'A' : ''}
                  </div>
                ))}
              </div>
              <div className="wr-blocks-range"><span>{fmtDateShort(ciclo.detalleDias[0]!.fecha)}</span><span>{fmtDateShort(ciclo.detalleDias[ciclo.detalleDias.length - 1]!.fecha)}</span></div>
              <p className="wr-legend">Bloques de la quincena: lleno trabajó · medio tono, medio día · gris descanso · punteado aún sin foto · <strong className="wr-amber">A en ámbar = ausencia justificada</strong> (no cuenta como trabajado) · borde dorado, hoy.</p>
            </div>
          )}
          {model.turno.valido != null && (
            <div className="wr-rotacion">
              <p className="wr-text">
                <span className="wr-deep-bold">{model.turno.correccion ? 'Rotación válida (puesta a mano, manda): ' : 'Rotación (detectada del IPV): '}</span>
                {textoTurno(model.turno.valido)} · patrón alterno semanal (bloque largo martes, miércoles, sábado, domingo y lunes; bloque corto jueves y viernes; se alternan cada semana).
              </p>
              <p className="wr-text muted">
                {trabajaSegunTurno(today, model.turno.valido) ? 'Hoy le toca trabajar. ' : 'Hoy descansa. '}
                <>Próximos días que le tocan: {proximosDiasQueTocan(today, model.turno.valido).map((f) => fmtDateShort(f)).join(', ')}.</>
              </p>
              {model.turno.correccion != null && (
                <p className="wr-text wr-rotacion-det">
                  <span className="wr-dim-bold">Lo que detecta el IPV: </span>
                  {model.turno.detectado ? <>{textoTurno(model.turno.detectado)} detectado de sus marcas.</> : <>Aún no se puede detectar su turno de las marcas.</>}
                </p>
              )}
            </div>
          )}
        </div>
      ) : w.roleKind === 'direccion' ? (
        <p className="wr-note"><strong>Perfil de Dirección:</strong> conserva sus datos y el enlace con sus cuentas administrativas, sin días, salario, nómina ni pagos acumulados.</p>
      ) : (
        <p className="wr-note">Sin foto de RH en este ciclo: aquí saldrán sus días y su salario cuando un IPV del ciclo lo traiga.</p>
      )}

      {w.roleKind !== 'direccion' && <WorkerMonthSquares model={model} marks={ctx.marks[w.key] ?? {}} importedDates={importedDates} today={today} />}

      {w.roleKind !== 'direccion' && (
        <>
          <div className="wr-total-pagado">
            <span className="muted">Total pagado guardado</span>
            <span className="font-display wr-total-num">{fmtInt(model.totalPagado)} CUP</span>
          </div>
          {model.historial[0] && <p className="wr-dim12">Último pago: {fmtDate(model.historial[0].fecha)} · {fmtInt(model.historial[0].monto)} CUP ({model.historial[0].tipo === 'nomina' ? 'nómina' : 'manual'})</p>}
          <button
            type="button"
            className="btn primary wr-btn-block"
            aria-label={`Ver los registros de pago de ${w.nombre}`}
            onClick={() => {
              ctx.setOpenKey(w.key)
              requestAnimationFrame(() => document.getElementById(`ficha-historial-${w.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
            }}
          >
            Registros de pago
          </button>
        </>
      )}

      <button
        type="button"
        className="btn wr-btn-block wr-btn-open"
        aria-expanded={open}
        aria-label={open ? `Cerrar la ficha de ${w.nombre}` : `Abrir la ficha de ${w.nombre}`}
        onClick={() => ctx.setOpenKey(open ? null : w.key)}
      >
        {open ? 'Cerrar ficha' : w.roleKind === 'direccion' ? 'Ver ficha y cuentas' : 'Ver ficha, pagos e historial'}
      </button>

      {open && (
        enHistorial && historialEntry ? (
          <HistorialFicha model={model} ctx={ctx} entry={historialEntry} />
        ) : (
          <FichaEditor model={model} ctx={ctx} />
        )
      )}
    </article>
  )
}

function inicioSemana(ciclo: CicloFicha, today: string): string {
  const fechaHoras = today < ciclo.cycleStart ? ciclo.cycleStart : today > ciclo.cycleEnd ? ciclo.cycleEnd : today
  const d = new Date(`${fechaHoras}T12:00:00`)
  const dow = d.getDay()
  return addDaysISO(fechaHoras, -(dow === 0 ? 6 : dow - 1))
}
function semanaHoras(ciclo: CicloFicha, today: string, horasPorDia: number): number {
  const ini = inicioSemana(ciclo, today)
  const fin = addDaysISO(ini, 6)
  const dias = ciclo.detalleDias.reduce((t, dia) => (
    dia.fecha >= ini && dia.fecha <= fin && dia.ausenciaMotivo == null ? t + Math.max(0, dia.valor ?? 0) : t
  ), 0)
  return dias * horasPorDia
}
function proximosDiasQueTocan(today: string, turno: 1 | 2): string[] {
  const out: string[] = []
  for (let i = 1; i <= 14 && out.length < 5; i++) {
    const f = addDaysISO(today, i)
    if (trabajaSegunTurno(f, turno)) out.push(f)
  }
  return out
}

/* ---------- Ficha abierta (bloques del original, en su orden) ---------- */

function upsertExtendedList(data: StoredData, w: Worker, current: WorkerExtended | null, patch: Partial<WorkerExtended>): WorkerExtended[] {
  const base: WorkerExtended = current ?? {
    id: 0, workerKey: w.key, nombre: w.nombre, ocupacion: w.ocupacion,
    restWeekday: null, workWeekday: null, workWeekdays: [],
    turnoAsignado: null, turnoCorreccion: null, estrellas: 0,
    genero: '', escolaridad: '', contratoCanceladoEl: null, contratoCanceladoCiclo: null,
    ausencias: [], fechaContratacion: '',
  }
  const next: WorkerExtended = { ...base, ...patch }
  if (!current) return [...data.workersExtended, next]
  return data.workersExtended.map((e) => (e === current ? next : e))
}

function FichaEditor({ model, ctx }: { model: FichaModel; ctx: CardCtx }) {
  const { w, ext } = model
  const { data, isAdmin, today } = ctx
  const [draft, setDraft] = useState({
    nombre: w.nombre,
    ocupacion: w.ocupacion,
    carnet: w.carnet,
    cuentaBancaria: w.cuentaBancaria,
    movil: w.movil,
    genero: model.genero,
    escolaridad: model.escolaridad,
    notas: w.notas,
    diaDescanso: ext?.restWeekday ?? null as number | null,
    diasTrabajoFijos: ext ? (ext.workWeekdays.length ? [...ext.workWeekdays] : ext.workWeekday != null ? [ext.workWeekday] : []) : [] as number[],
    turnoAsignado: ext?.turnoAsignado ?? null as 1 | 2 | null,
    turnoCorreccion: ext?.turnoCorreccion ?? null as 1 | 2 | null,
    fechaContratacion: ext?.fechaContratacion ?? '',
  })
  const [payFecha, setPayFecha] = useState(today)
  const [payMonto, setPayMonto] = useState('')
  const [payConcepto, setPayConcepto] = useState('')
  const [ausFecha, setAusFecha] = useState(today)
  const [ausMotivo, setAusMotivo] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmHide, setConfirmHide] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (patch: RegistryPatch, msg: string) => {
    setBusy(true)
    try { await ctx.persist(patch); ctx.setMsg(msg) } finally { setBusy(false) }
  }
  const saveDatos = () => {
    const workers = data.workers.map((x) => x.key === w.key ? { ...x, nombre: draft.nombre.trim() || x.nombre, ocupacion: draft.ocupacion, carnet: draft.carnet, cuentaBancaria: draft.cuentaBancaria, movil: draft.movil, notas: draft.notas } : x)
    const workersExtended = upsertExtendedList(data, w, ext, {
      nombre: draft.nombre.trim() || w.nombre, ocupacion: draft.ocupacion,
      genero: draft.genero, escolaridad: draft.escolaridad,
      restWeekday: draft.diaDescanso, workWeekdays: draft.diasTrabajoFijos, workWeekday: draft.diasTrabajoFijos[0] ?? null,
      turnoAsignado: draft.turnoAsignado, turnoCorreccion: draft.turnoCorreccion,
      fechaContratacion: draft.fechaContratacion,
    })
    void run({ workers, workersExtended }, `Ficha de ${draft.nombre || w.nombre} guardada: manda sobre el IPV y queda aprendida.`)
  }
  const rate = (n: number) => {
    const workersExtended = upsertExtendedList(data, w, ext, { estrellas: n })
    void run({ workersExtended }, n ? `Evaluación guardada: ${n} de 5 estrellas. Es solo una marca de desempeño: no cambia salarios, pagos ni días.` : 'Evaluación retirada: queda sin valorar.')
  }
  const addAusencia = () => {
    if (!ausFecha || !ausMotivo.trim()) return
    const nueva = { id: `aus-${Date.now()}`, fecha: ausFecha, motivo: ausMotivo.trim() }
    const workersExtended = upsertExtendedList(data, w, ext, { ausencias: [...(ext?.ausencias ?? []), nueva] })
    setAusMotivo('')
    void run({ workersExtended }, `Ausencia del ${fmtDate(ausFecha)} registrada para ${w.nombre}: no cuenta como trabajada.`)
  }
  const delAusencia = (id: string) => {
    const workersExtended = upsertExtendedList(data, w, ext, { ausencias: (ext?.ausencias ?? []).filter((a) => a.id !== id) })
    void run({ workersExtended }, 'Ausencia eliminada de la ficha.')
  }
  const addPago = () => {
    const monto = Number(payMonto)
    if (!(monto > 0) || !payFecha) return
    const wp: WorkerPayment = { workerKey: w.key, fecha: payFecha, monto, concepto: payConcepto.trim() }
    setPayMonto(''); setPayConcepto('')
    void run({ workerPayments: [...data.workerPayments, wp] }, `Pago a mano de ${fmtInt(monto)} CUP registrado para ${w.nombre}.`)
  }
  const delPago = (h: HistorialPago) => {
    const idx = data.workerPayments.findIndex((x, i) => i === h.manualIndex && x.workerKey === w.key)
    if (idx < 0) return
    void run({ workerPayments: data.workerPayments.filter((_, i) => i !== idx) }, 'Pago manual eliminado del historial.')
  }
  const cancelarContrato = () => {
    const workersExtended = upsertExtendedList(data, w, ext, { contratoCanceladoEl: today, contratoCanceladoCiclo: ctx.win.start })
    setConfirmCancel(false)
    void run({ workersExtended }, `Contrato de ${w.nombre} marcado como cancelado.`)
  }
  const reactivarContrato = () => {
    const workersExtended = upsertExtendedList(data, w, ext, { contratoCanceladoEl: null, contratoCanceladoCiclo: null })
    void run({ workersExtended }, `Contrato de ${w.nombre} reactivado.`)
  }
  const pasarAlHistorial = () => {
    const entry: WorkerHistorialEntry = { key: w.key, worker: w, extended: ext, removedAt: today }
    setConfirmHide(false)
    ctx.setOpenKey(null)
    void run({
      workers: data.workers.filter((x) => x.key !== w.key),
      removeWorkerKeys: [w.key],
      workersHistorial: [...data.workersHistorial, entry],
    }, `${w.nombre} pasó al historial de trabajadores: no se borró nada.`)
  }

  const algunaMorosa = model.cuentasPartidas.some((x) => x.morosa)
  const turnoAplicaDraft = model.turno.aplica || esCargoDeTurno(draft.ocupacion)

  return (
    <div className="wr-ficha">
      <section className={`wr-cuentas${algunaMorosa ? ' is-morosa' : ''}`} aria-label={`Cuentas por cobrar de ${w.nombre}`}>
        <div className="wr-cuentas-head">
          <div>
            <p className="wr-section-title">{w.roleKind === 'direccion' ? 'Cuentas administrativas enlazadas' : 'Cuentas del trabajador'}</p>
            <p className="wr-dim11">{w.roleKind === 'direccion' ? 'Son las mismas cuentas de la casa; no entran en nómina' : `Quincena ${fmtDateShort(ctx.win.start)}–${fmtDateShort(ctx.win.end)} · pago ${fmtDateShort(ctx.win.payDate)}`}</p>
          </div>
          <div className="wr-cuentas-total">
            <p className="font-display">{fmtInt(model.cuentasSaldo)} CUP</p>
            <p className="wr-dim11">saldo pendiente</p>
          </div>
        </div>
        {model.cuentasPartidas.length === 0 ? (
          <p className="wr-dim12 wr-mt2">No tiene cuentas pendientes registradas.</p>
        ) : (
          <ul className="wr-cuentas-list">
            {model.cuentasPartidas.map(({ rec, saldo, morosa }) => {
              const abonado = Math.max(0, (rec.originalAmount || rec.saldoBase) - saldo)
              return (
                <li key={rec.id}>
                  <div className="wr-cuenta-row">
                    <span className="wr-cuenta-detail">{fmtDateShort(rec.date)} · {rec.detail || 'Cuenta'}</span>
                    <span className={`wr-cuenta-saldo${morosa ? ' is-morosa' : ''}`}>{fmtInt(saldo)} CUP</span>
                  </div>
                  <p className="wr-dim11">Debe {fmtInt(saldo)} de {fmtInt(rec.originalAmount || rec.saldoBase)}{abonado ? ` · abonado ${fmtInt(abonado)}` : ''}{morosa ? ' · pago atrasado' : ''}</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="wr-eval">
        <p className="wr-section-title-flex">Evaluación del desempeño <InfoHelp label="Cómo funciona la evaluación del desempeño">Valora a esta persona de 1 a 5 estrellas, como cuando se valora una app: toca la estrella que quieras y queda guardado al momento; toca la misma que ya tiene otra vez para dejarla sin valorar. Sus estrellas se ven en su tarjeta y en su cajita del organigrama, junto a su nombre. Es solo tu marca de evaluación: no cambia su salario, sus pagos ni sus días, y ningún IPV la borra.</InfoHelp></p>
        <div className="wr-mt1">
          {isAdmin
            ? <EstrellasEditor value={model.estrellas} nombre={w.nombre} disabled={busy} onRate={rate} />
            : <EstrellasValor value={model.estrellas} size={20} />}
        </div>
      </div>

      <p className="font-display wr-datos-title">Datos de la ficha</p>
      {isAdmin ? (
        <>
          <div className="wr-form">
            <div>
              <label className="wr-label" htmlFor={`w-nombre-${w.key}`}>Nombre y apellidos</label>
              <input id={`w-nombre-${w.key}`} type="text" value={draft.nombre} onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-ocup-${w.key}`}>Cargo / ocupación</label>
              <input id={`w-ocup-${w.key}`} type="text" value={draft.ocupacion} onChange={(e) => setDraft((d) => ({ ...d, ocupacion: e.target.value }))} className="wr-input" />
              <p className="wr-dim11 wr-mt1">Este cargo decide su área en el organigrama (Seguridad y Custodios van separados). Al corregirlo aquí y guardar, queda como válido y aprendido: el sistema no lo vuelve a cambiar con el IPV y ningún dato del IPV se reescribe.</p>
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-carnet-${w.key}`}>Número de carné</label>
              <input id={`w-carnet-${w.key}`} type="text" value={draft.carnet} onChange={(e) => setDraft((d) => ({ ...d, carnet: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-cuenta-${w.key}`}>Cuenta bancaria</label>
              <input id={`w-cuenta-${w.key}`} type="text" value={draft.cuentaBancaria} onChange={(e) => setDraft((d) => ({ ...d, cuentaBancaria: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-movil-${w.key}`}>Móvil</label>
              <input id={`w-movil-${w.key}`} type="text" value={draft.movil} onChange={(e) => setDraft((d) => ({ ...d, movil: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-genero-${w.key}`}>Género</label>
              <select id={`w-genero-${w.key}`} value={draft.genero} onChange={(e) => setDraft((d) => ({ ...d, genero: e.target.value }))} className="wr-input"><option value="">Sin completar</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option></select>
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-escolaridad-${w.key}`}>Nivel de escolaridad</label>
              <select id={`w-escolaridad-${w.key}`} value={draft.escolaridad} onChange={(e) => setDraft((d) => ({ ...d, escolaridad: e.target.value }))} className="wr-input"><option value="">Sin completar</option><option value="primaria">Primaria</option><option value="secundaria">Secundaria</option><option value="preuniversitario">Preuniversitario</option><option value="tecnico_medio">Técnico medio</option><option value="universitario">Universitario</option><option value="maestria">Maestría</option><option value="doctorado">Doctorado</option></select>
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-notas-${w.key}`}>Notas</label>
              <input id={`w-notas-${w.key}`} type="text" value={draft.notas} onChange={(e) => setDraft((d) => ({ ...d, notas: e.target.value }))} className="wr-input" placeholder="Opcional" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`w-alta-${w.key}`}>Fecha de contratación (para las vacaciones)</label>
              <input id={`w-alta-${w.key}`} type="date" value={draft.fechaContratacion} onChange={(e) => setDraft((d) => ({ ...d, fechaContratacion: e.target.value }))} className="wr-input" />
            </div>
            {w.roleKind !== 'direccion' && turnoAplicaDraft && (
              <div className="wr-turno-box" aria-label={`Turno de ${w.nombre}`}>
                <p className="font-display wr-turno-title">Turno (camareras, cajeras y cocineras)</p>
                <p className="wr-text">
                  Puesto a mano: <strong>{textoTurno(draft.turnoAsignado)}</strong> · Detectado del IPV: <strong>{model.turno.detectado ? textoTurno(model.turno.detectado) : 'aún sin detectar'}</strong>
                </p>
                {draft.turnoAsignado != null && model.turno.detectado != null && draft.turnoAsignado !== model.turno.detectado && draft.turnoCorreccion == null ? (
                  <p className="wr-text wr-bad-bold">No cuadra: pusiste {textoTurno(draft.turnoAsignado)} y el IPV detecta {textoTurno(model.turno.detectado)}. Cuádralo abajo: cambia el turno puesto o haz válido el puesto con la corrección manual.</p>
                ) : draft.turnoCorreccion != null ? (
                  <p className="wr-text wr-deep-bold">Cuadrado a mano: manda tu corrección ({textoTurno(draft.turnoCorreccion)}). Lo detectado del IPV se sigue mostrando para comparar.</p>
                ) : draft.turnoAsignado != null && model.turno.detectado != null ? (
                  <p className="wr-text wr-deep-bold">Coincide con lo detectado del IPV.</p>
                ) : null}
                <div className="wr-form wr-mt2">
                  <div>
                    <label className="wr-label" htmlFor={`w-turno-${w.key}`}>Turno puesto a mano</label>
                    <select id={`w-turno-${w.key}`} value={draft.turnoAsignado == null ? '' : String(draft.turnoAsignado)} onChange={(e) => setDraft((d) => ({ ...d, turnoAsignado: e.target.value === '' ? null : (Number(e.target.value) as 1 | 2) }))} className="wr-input">
                      <option value="">Sin turno puesto</option>
                      <option value="1">Turno 1</option>
                      <option value="2">Turno 2</option>
                    </select>
                  </div>
                  <div>
                    <label className="wr-label" htmlFor={`w-turno-correccion-${w.key}`}>Corrección manual que manda (si no cuadra)</label>
                    <select id={`w-turno-correccion-${w.key}`} value={draft.turnoCorreccion == null ? '' : String(draft.turnoCorreccion)} onChange={(e) => setDraft((d) => ({ ...d, turnoCorreccion: e.target.value === '' ? null : (Number(e.target.value) as 1 | 2) }))} className="wr-input">
                      <option value="">Sin corrección (manda lo detectado del IPV)</option>
                      <option value="1">Turno 1</option>
                      <option value="2">Turno 2</option>
                    </select>
                    <p className="wr-dim11 wr-mt1">Si pusiste un turno y el IPV detecta otro, aquí lo cuadras tú: elige el turno que debe valer y queda como válido — manda en su rotación, en los días que le tocan y en «hoy le toca» — aunque la tarjeta siga mostrando lo que detecta el IPV. O cambia el «Turno puesto a mano» hasta que coincida con el detectado.</p>
                    {draft.turnoAsignado != null && draft.turnoCorreccion !== draft.turnoAsignado ? (
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, turnoCorreccion: d.turnoAsignado }))} aria-label={`Cuadrar a mano el turno de ${draft.nombre || w.nombre}: hacer válido ${textoTurno(draft.turnoAsignado)}`} className="btn primary wr-btn-sm wr-mt2">Cuadrar a mano: hacer válido el {textoTurno(draft.turnoAsignado)} puesto</button>
                    ) : null}
                    {draft.turnoCorreccion != null ? (
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, turnoCorreccion: null }))} aria-label={`Quitar la corrección manual de turno de ${draft.nombre || w.nombre}`} className="btn wr-btn-sm wr-mt2">Quitar corrección</button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {w.roleKind !== 'direccion' && (
              <>
                <div>
                  <span className="wr-label-flex"><label className="wr-label" htmlFor={`w-descanso-${w.key}`}>Día de descanso semanal</label><InfoHelp label="Qué hace el día de descanso semanal">Ese día no cuenta como día que debería haber trabajado: el salario fijo se reparte entre los días que sí le tocan, y ese día nunca le salta el aviso de 0 días.</InfoHelp></span>
                  <select id={`w-descanso-${w.key}`} value={draft.diaDescanso == null ? '' : String(draft.diaDescanso)} onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); setDraft((d) => ({ ...d, diaDescanso: v, diasTrabajoFijos: v == null ? d.diasTrabajoFijos : [] })) }} className="wr-input">
                    <option value="">Sin día fijo (lo detecta el IPV)</option>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (<option key={d} value={d}>Descansa los {NOMBRES_DIA_SEMANA_PLURAL[d]}</option>))}
                  </select>
                </div>
                <div>
                  <span className="wr-label-flex"><span className="wr-label" id={`w-fijos-label-${w.key}`}>Días fijos de trabajo a la semana</span><InfoHelp label="Qué son los días fijos de trabajo">Toca los días que trabaja siempre — puede ser uno solo o varios, por si un día trabaja otro día por alguna razón. Para quien cobra por esos días (ej.: los viernes a tanto por viernes): la quincena le cuenta todos los días marcados que traiga el ciclo, y cada uno suma su pago por día. Sin días marcados, trabaja según su rotación.</InfoHelp></span>
                  <div className="wr-fijos" role="group" aria-labelledby={`w-fijos-label-${w.key}`}>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const marcado = draft.diasTrabajoFijos.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={marcado}
                          aria-label={marcado ? `Quitar los ${NOMBRES_DIA_SEMANA_PLURAL[d]} de los días fijos de ${draft.nombre || 'este trabajador'}` : `Marcar los ${NOMBRES_DIA_SEMANA_PLURAL[d]} como día fijo de trabajo de ${draft.nombre || 'este trabajador'}`}
                          onClick={() => setDraft((prev) => {
                            const tiene = prev.diasTrabajoFijos.includes(d)
                            const diasTrabajoFijos = tiene ? prev.diasTrabajoFijos.filter((x) => x !== d) : [...prev.diasTrabajoFijos, d]
                            return { ...prev, diasTrabajoFijos, diaDescanso: diasTrabajoFijos.length ? null : prev.diaDescanso }
                          })}
                          className={`wr-fijo${marcado ? ' is-on' : ''}`}
                        >
                          {NOMBRES_DIA_SEMANA_PLURAL[d]}
                        </button>
                      )
                    })}
                  </div>
                  {draft.diasTrabajoFijos.length > 0 && (
                    <p className="wr-dim11 wr-mt1">
                      Marcado: trabaja {listaDiasFijos(draft.diasTrabajoFijos)}. Toca un día marcado para quitarlo o toca otro para añadirlo.
                      <button type="button" onClick={() => setDraft((prev) => ({ ...prev, diasTrabajoFijos: [] }))} aria-label={`Quitar todos los días fijos de ${draft.nombre || 'este trabajador'}`} className="wr-quitar-todos">Quitar todos</button>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="wr-actions">
            <button type="button" disabled={busy || !draft.nombre.trim()} onClick={saveDatos} className="btn primary">{busy ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </>
      ) : (
        <dl className="wr-dl">
          <div><dt>Ocupación:</dt><dd>{w.ocupacion || '—'}</dd></div>
          <div><dt>Carné:</dt><dd>{w.carnet || '—'}</dd></div>
          <div><dt>Cuenta:</dt><dd>{w.cuentaBancaria || '—'}</dd></div>
          <div><dt>Móvil:</dt><dd>{w.movil || '—'}</dd></div>
          <div><dt>Notas:</dt><dd>{w.notas || '—'}</dd></div>
        </dl>
      )}

      <WorkerFichaCompleta worker={w} extended={ext} isAdmin={isAdmin} />

      {w.roleKind !== 'direccion' && (
        <div className="wr-aus-box" aria-label={`Ausencias justificadas de ${w.nombre}`}>
          <p className="font-display wr-aus-box-title">Ausencias justificadas — no trabajó <InfoHelp label="Cómo funcionan las ausencias justificadas">Cuando un día no trabaja por enfermedad u otra causa, márcalo aquí con su motivo. Ese día <strong>no cuenta como trabajado</strong>, queda guardado en su ficha con fecha y causa, y no se trata como falta sin causa: ni en el aviso de «pago asignado con 0 días» ni en su rotación. Solo queda lo que tú marques.</InfoHelp></p>
          {(ext?.ausencias ?? []).length === 0 ? (
            <p className="wr-aus-empty">Sin ausencias registradas todavía.</p>
          ) : (
            <ul className="wr-aus-list">
              {(ext?.ausencias ?? []).map((a) => (
                <li key={a.id}>
                  <div>
                    <p className="wr-aus-fecha">{fmtDate(a.fecha)}</p>
                    <p className="wr-aus-motivo">{a.motivo}</p>
                  </div>
                  {isAdmin && <button type="button" disabled={busy} onClick={() => delAusencia(a.id)} aria-label={`Eliminar la ausencia del ${fmtDate(a.fecha)} de ${w.nombre}: ${a.motivo}`} className="btn wr-btn-danger-sm">Eliminar</button>}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <>
              <div className="wr-form wr-mt3">
                <div>
                  <label className="wr-label" htmlFor={`aus-fecha-${w.key}`}>Día que no trabajó</label>
                  <input id={`aus-fecha-${w.key}`} type="date" value={ausFecha} onChange={(e) => setAusFecha(e.target.value)} className="wr-input" />
                </div>
                <div>
                  <label className="wr-label" htmlFor={`aus-motivo-${w.key}`}>Motivo (enfermedad u otra causa)</label>
                  <input id={`aus-motivo-${w.key}`} type="text" value={ausMotivo} onChange={(e) => setAusMotivo(e.target.value)} className="wr-input" placeholder="Motivo de la ausencia" />
                </div>
              </div>
              <button type="button" disabled={busy || !ausFecha || !ausMotivo.trim()} onClick={addAusencia} className="btn primary wr-mt3">
                {busy ? 'Registrando…' : 'Registrar ausencia — no trabajó'}
              </button>
            </>
          )}
        </div>
      )}

      <p className="font-display wr-hist-title" id={`ficha-historial-${w.key}`}>Historial de pagos</p>
      {model.historial.length === 0 ? (
        <p className="wr-dim14">Todavía no hay pagos guardados de esta persona: ni nóminas por quincena ni pagos a mano.</p>
      ) : (
        <ul className="wr-hist">
          {model.historial.map((h) => (
            <li key={`${h.tipo}-${h.manualIndex ?? ''}-${h.cycleStart ?? ''}-${h.fecha}-${h.monto}`}>
              <div>
                <p className="wr-hist-monto">{fmtInt(h.monto)} CUP <span className={`wr-chip ${h.tipo === 'nomina' ? 'wr-chip-ok' : 'wr-chip-dim'}`}>{h.tipo === 'nomina' ? 'Nómina' : 'Manual'}</span></p>
                <p className="wr-dim12">{h.tipo === 'nomina' && h.cycleStart && h.cycleEnd ? `Ciclo ${fmtDateShort(h.cycleStart)} — ${fmtDateShort(h.cycleEnd)} · pagado el ${fmtDate(h.fecha)}` : `${h.concepto ?? ''} · ${fmtDate(h.fecha)}`}</p>
              </div>
              {h.tipo === 'manual' && isAdmin && (
                <button type="button" disabled={busy} onClick={() => delPago(h)} aria-label={`Eliminar el pago manual de ${fmtInt(h.monto)} CUP del ${fmtDate(h.fecha)} de ${w.nombre}`} className="btn wr-btn-danger-sm">Eliminar</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {w.roleKind !== 'direccion' && isAdmin && (
        <>
          <p className="font-display wr-hist-title wr-flex-gap">Registrar un pago a mano <InfoHelp label="Qué es un pago a mano">Para pagos que no salen en la nómina del IPV. Queda como constancia en este historial; no se mezcla con «Gastos».</InfoHelp></p>
          <div className="wr-form">
            <div>
              <label className="wr-label" htmlFor={`wp-fecha-${w.key}`}>Fecha del pago</label>
              <input id={`wp-fecha-${w.key}`} type="date" value={payFecha} onChange={(e) => setPayFecha(e.target.value)} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`wp-monto-${w.key}`}>Monto (CUP)</label>
              <input id={`wp-monto-${w.key}`} type="text" value={payMonto} onChange={(e) => setPayMonto(e.target.value)} className="wr-input" placeholder="0" />
            </div>
            <div>
              <label className="wr-label" htmlFor={`wp-concepto-${w.key}`}>Concepto</label>
              <input id={`wp-concepto-${w.key}`} type="text" value={payConcepto} onChange={(e) => setPayConcepto(e.target.value)} className="wr-input" placeholder="Por qué se pagó" />
            </div>
          </div>
          <button type="button" disabled={busy || !(Number(payMonto) > 0) || !payFecha} onClick={addPago} className="btn primary wr-mt3">
            {busy ? 'Registrando…' : 'Registrar pago'}
          </button>
        </>
      )}

      {w.roleKind !== 'direccion' && isAdmin && (
        <div className="wr-contrato">
          {model.canceladoEl ? (
            <div>
              <p className="wr-contrato-bad">Contrato cancelado el {fmtDate(model.canceladoEl)}</p>
              <p className="wr-dim14 wr-mt1">
                {model.ciclo && !model.ciclo.cerrada && model.ciclo.dias > 0
                  ? <>Todavía tiene acumulado en este ciclo: se mantiene en la nómina del ciclo {fmtDateShort(ctx.win.start)} — {fmtDateShort(ctx.win.end)}, cuyo pago del {fmtDate(ctx.win.payDate)} es su <strong>liquidación</strong>. Después de ese pago su ficha pasa automáticamente al historial de trabajadores y ya no aparece en nóminas posteriores.</>
                  : <>Su liquidación ya quedó resuelta: su ficha pasa al historial de trabajadores y ya no aparece en nóminas posteriores.</>}
              </p>
              <button type="button" disabled={busy} onClick={reactivarContrato} className="btn wr-mt3">{busy ? 'Reactivando…' : 'Reactivar contrato'}</button>
            </div>
          ) : confirmCancel ? (
            <div>
              <p className="wr-contrato-q">¿Marcar el contrato de {w.nombre} como cancelado?</p>
              <p className="wr-dim14 wr-mt1">
                Su ficha llevará el cuño rojo <strong className="wr-bad">«CANCELADO»</strong>. Si aún tiene días acumulados en este ciclo, se mantiene en la nómina de este ciclo — el pago en que se liquida lo que se le debe — y después pasa automáticamente al <strong>historial de trabajadores</strong>. No aparecerá en nóminas posteriores y las nóminas ya cerradas no cambian. Puedes deshacerlo con «Reactivar contrato».
              </p>
              <div className="wr-actions">
                <button type="button" disabled={busy} onClick={cancelarContrato} className="btn wr-btn-danger-solid">{busy ? 'Marcando…' : 'Sí, contrato cancelado'}</button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="btn">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmCancel(true)} className="btn wr-btn-danger">Contrato cancelado</button>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="wr-contrato">
          {confirmHide ? (
            <div>
              <p className="wr-contrato-q">¿Eliminar a {w.nombre} del registro activo?</p>
              <p className="wr-dim14 wr-mt1">
                No se borra nada: su ficha completa — datos personales, foto, historial de pagos por quincena, pagos manuales, rotación y gráfico de días — pasa al <strong>historial de trabajadores</strong>, donde puedes seguir consultándola cuando quieras y restaurarla si vuelve. Las nóminas ya cerradas no cambian.
              </p>
              <div className="wr-actions">
                <button type="button" disabled={busy} onClick={pasarAlHistorial} className="btn wr-btn-danger-solid">{busy ? 'Pasando al historial…' : 'Sí, pasar al historial'}</button>
                <button type="button" onClick={() => setConfirmHide(false)} className="btn">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmHide(true)} className="btn wr-btn-danger">Eliminar del registro</button>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Ficha en el historial (consulta + restaurar/eliminar) ---------- */

function HistorialFicha({ model, ctx, entry }: { model: FichaModel; ctx: CardCtx; entry: WorkerHistorialEntry }) {
  const { w } = model
  const { data, isAdmin } = ctx
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (patch: RegistryPatch, msg: string) => {
    setBusy(true)
    try { await ctx.persist(patch); ctx.setMsg(msg) } finally { setBusy(false) }
  }
  const restaurar = () => {
    ctx.setOpenKey(null)
    void run({
      workers: [...data.workers, entry.worker],
      workersExtended: entry.extended ? [...data.workersExtended, entry.extended] : undefined,
      workersHistorial: data.workersHistorial.filter((h) => h.key !== entry.key),
    }, `${w.nombre} volvió al registro de trabajadores.`)
  }
  const eliminarPermanente = () => {
    ctx.setOpenKey(null)
    void run({
      workersHistorial: data.workersHistorial.filter((h) => h.key !== entry.key),
      workerPayments: data.workerPayments.filter((p) => p.workerKey !== entry.key),
    }, `La ficha de ${w.nombre} se eliminó permanentemente del historial.`)
  }
  return (
    <div className="wr-ficha">
      <dl className="wr-dl">
        <div><dt>Ocupación:</dt><dd>{w.ocupacion || '—'}</dd></div>
        <div><dt>Carné:</dt><dd>{w.carnet || '—'}</dd></div>
        <div><dt>Cuenta:</dt><dd>{w.cuentaBancaria || '—'}</dd></div>
        <div><dt>Móvil:</dt><dd>{w.movil || '—'}</dd></div>
        {model.historial[0] && <div><dt>Último pago:</dt><dd>{fmtDate(model.historial[0].fecha)} · {fmtInt(model.historial[0].monto)} CUP ({model.historial[0].tipo === 'nomina' ? 'nómina' : 'manual'})</dd></div>}
      </dl>
      <p className="font-display wr-hist-title">Historial de pagos</p>
      {model.historial.length === 0 ? (
        <p className="wr-dim14">Sin pagos guardados.</p>
      ) : (
        <ul className="wr-hist">
          {model.historial.map((h) => (
            <li key={`${h.tipo}-${h.manualIndex ?? ''}-${h.cycleStart ?? ''}-${h.fecha}-${h.monto}`}>
              <div>
                <p className="wr-hist-monto">{fmtInt(h.monto)} CUP <span className={`wr-chip ${h.tipo === 'nomina' ? 'wr-chip-ok' : 'wr-chip-dim'}`}>{h.tipo === 'nomina' ? 'Nómina' : 'Manual'}</span></p>
                <p className="wr-dim12">{h.tipo === 'nomina' && h.cycleStart && h.cycleEnd ? `Ciclo ${fmtDateShort(h.cycleStart)} — ${fmtDateShort(h.cycleEnd)} · pagado el ${fmtDate(h.fecha)}` : `${h.concepto ?? ''} · ${fmtDate(h.fecha)}`}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <div className="wr-contrato">
          {confirmDelete ? (
            <div>
              <p className="wr-contrato-q">¿Eliminar a {w.nombre} del historial para siempre?</p>
              <p className="wr-dim14 wr-mt1">
                Esto sí es <strong>para siempre y no se puede deshacer</strong>: se borran su ficha, su foto y sus pagos manuales, y no volverá a aparecer aunque reimportes IPV viejos. Los registros de nómina ya cerrados del negocio (las quincenas pagadas y su gasto «Nómina RH») no cambian.
              </p>
              <div className="wr-actions">
                <button type="button" disabled={busy} onClick={eliminarPermanente} className="btn wr-btn-danger-solid">{busy ? 'Eliminando…' : 'Eliminar permanentemente'}</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="wr-actions">
              <button type="button" disabled={busy} onClick={restaurar} className="btn primary">Restaurar en el registro</button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="btn wr-btn-danger">Eliminar a un trabajador del historial</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Sección completa del registro ---------- */

const REGISTRO_INFO = [
  'Una ficha por persona, alimentada de la hoja RH de cada IPV que importes (nombre, cargo, carné, cuenta bancaria y móvil). Las fichas salen siempre por orden alfabético. Todo se puede corregir aquí, y lo que corrijas manda sobre el IPV. Toca una tarjeta para ver su historial de pagos por quincena o registrarle un pago a mano (por ejemplo, a quien no sale en el IPV).',
  'Si alguien deja de trabajar, en su ficha tienes «Eliminar del registro»: no se borra nada — su ficha completa (datos, foto, pagos por quincena, pagos manuales, rotación y gráfico de días) pasa al historial de trabajadores, al final de esta sección, donde sigue pudiendo consultarse, restaurarse o eliminarse permanentemente con «Eliminar del historial». Las nóminas ya cerradas no cambian.',
  'La rotación se detecta sobre todos los IPV seguidos, sin cortarse al cerrar la quincena: si alguien trabajó 2 días al final de una y 1 al inicio de la siguiente, cuentan como sus 3 días seguidos. En camareras, cocineras y cajeras los dos turnos se alternan por semana: una semana uno hace el bloque largo (martes, miércoles, sábado, domingo y lunes) y el otro jueves-viernes; a la siguiente se intercambian, y así lo detecta y lo proyecta el sistema.',
  'En cada ficha puedes fijar dos cosas que mandan sobre lo detectado: su día de descanso semanal (ese día no cuenta como día que debería haber trabajado, y el salario fijo se reparte entre los días que sí le tocan), y sus días fijos de trabajo a la semana: puede ser uno solo o varios (la quincena le cuenta todos los de esos días que traiga).',
  'En camareras, cajeras y cocineras la ficha trae además su turno: tú pones a mano el Turno 1 o el Turno 2, y el sistema detecta, por su nombre y los días que trabajó según las marcas del IPV, a qué turno pertenece. La tarjeta muestra a la vez el turno puesto a mano y el detectado, y si no cuadran lo marca en rojo; lo cuadras a mano con la corrección que manda. La detección nunca inventa días: si sus marcas aún no encajan en un turno, dice «aún sin detectar».',
  'Al principio de RH tienes el organigrama del equipo en flujo de trabajo: arriba «La Reina · Equipo», de ahí bajan las áreas, de cada área sus Turno 1 y Turno 2 (solo camareras, cajeras y cocina) y de ahí cada persona en su cajita. Sin cifras de salario: solo quién está dónde. Seguridad y Custodios son áreas distintas. Sale de las fichas activas, así que al corregir un cargo o un turno aquí, el organigrama se actualiza solo.',
  'Ausencias justificadas: si un día alguien no trabaja por enfermedad u otra causa, abre su ficha y en «Ausencias justificadas — no trabajó» elige el día y escribe el motivo tal cual. Ese día no cuenta como trabajado (en su gráfico sale con una A en ámbar), queda guardado en su ficha con fecha y causa, y no se trata como falta sin causa. Solo existe lo que tú marques; puedes eliminarlo desde la misma lista.',
  'Si una ficha sale sin carné, cuenta o móvil es porque sus días se importaron antes de esta mejora: esos datos se completan solos al importar el próximo IPV (o al reimportar uno con hoja RH), y también puedes escribirlos tú en la ficha.',
  'Cada ficha tiene su evaluación del desempeño en estrellas (de 1 a 5, como cuando se valora una app): ábrela, toca las estrellas y queda guardado; se ve en su tarjeta y en su cajita del organigrama. Es solo tu marca de evaluación: no cambia salarios, pagos ni días.',
  'Contrato cancelado: si una persona se va definitivamente, en su ficha tienes el botón «Contrato cancelado». Su ficha lleva desde ese momento un cuño rojo «CANCELADO» y el degradado de su tarjeta se tiñe de rojo. Si aún tiene días acumulados, se mantiene en la nómina del ciclo en curso — ese pago es su liquidación. Puedes deshacerlo con «Reactivar contrato» en la misma ficha. Y las fichas con el contrato vigente llevan el cuño verde «APROBADO». Las fichas de Dirección (Dayami y Jesús) no llevan ningún cuño: son perfiles de datos, sin contrato ni nómina.',
]

export default function WorkerRegistry(props: RegistryProps) {
  const { data, today, isAdmin } = props
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCuentas, setShowCuentas] = useState(false)
  const [msg, setMsg] = useState('')
  const [newDraft, setNewDraft] = useState({ nombre: '', ocupacion: '', carnet: '', cuentaBancaria: '', movil: '', genero: '', escolaridad: '', notas: '', turnoAsignado: null as 1 | 2 | null, turnoCorreccion: null as 1 | 2 | null })
  const [busy, setBusy] = useState(false)

  const persist = async (patch: RegistryPatch) => {
    if (SB_MODE) await sbSaveWorkersRegistry(patch)
    else saveWorkersRegistry(patch)
    props.onChanged()
  }
  const ctx: CardCtx = {
    data, marks: props.marks, today, win: props.win, isAdmin,
    openKey, setOpenKey, persist, setMsg,
  }

  const activos = useMemo(() => data.workers.filter((w) => !data.workersHistorial.some((h) => h.key === w.key)), [data.workers, data.workersHistorial])
  const models = useMemo(() => {
    const map = new Map<string, FichaModel>()
    for (const w of activos) map.set(w.key, buildFicha(props, w))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, props.marks, props.derivedEmployees, props.recorded, props.extMap, today, props.win])
  const ordenados = useMemo(() => [...activos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true })), [activos])
  const q = query.trim().toLowerCase()
  const visibles = q ? ordenados.filter((w) => `${w.nombre} ${w.ocupacion}`.toLowerCase().includes(q)) : ordenados

  const payrollWorkers = activos.filter((w) => w.roleKind === 'trabajador')
  const knownAges = payrollWorkers.map((w) => ageFromCarnet(w.carnet)).filter((a): a is number => a != null)
  const averageAge = knownAges.length ? Math.round(knownAges.reduce((s, a) => s + a, 0) / knownAges.length) : null
  const genderCounts = {
    femenino: payrollWorkers.filter((w) => (props.extMap.get(w.key)?.genero ?? '') === 'femenino').length,
    masculino: payrollWorkers.filter((w) => (props.extMap.get(w.key)?.genero ?? '') === 'masculino').length,
    pendiente: payrollWorkers.filter((w) => !(props.extMap.get(w.key)?.genero ?? '')).length,
  }
  const educationOrder = ['primaria', 'secundaria', 'preuniversitario', 'tecnico_medio', 'universitario', 'maestria', 'doctorado'] as const
  const educationLabel: Record<string, string> = { primaria: 'Primaria', secundaria: 'Secundaria', preuniversitario: 'Preuniversitario', tecnico_medio: 'Técnico medio', universitario: 'Universitario', maestria: 'Maestría', doctorado: 'Doctorado' }

  const conCuentas = ordenados.filter((w) => w.roleKind === 'trabajador' && (models.get(w.key)?.cuentasPartidas.length ?? 0) > 0)
  const cumpleManana = ordenados.filter((w) => birthdayIsTomorrow(w.carnet))
  const manana = addDaysISO(today, 1)
  const tocaHoy = ordenados.filter((w) => { const t = models.get(w.key)?.turno; return t?.valido != null && trabajaSegunTurno(today, t.valido) })
  const tocaManana = ordenados.filter((w) => { const t = models.get(w.key)?.turno; return t?.valido != null && trabajaSegunTurno(manana, t.valido) })

  const addWorker = async () => {
    if (!newDraft.nombre.trim()) return
    setBusy(true)
    try {
      const nombre = newDraft.nombre.trim()
      const worker: Worker = {
        key: canonicalPersonKey(null, nombre),
        nombre,
        ocupacion: newDraft.ocupacion.trim(),
        carnet: newDraft.carnet.trim(),
        cuentaBancaria: newDraft.cuentaBancaria.trim(),
        movil: newDraft.movil.trim(),
        notas: newDraft.notas.trim(),
        origen: 'manual',
        roleKind: 'trabajador',
      }
      const patch: RegistryPatch = { workers: [...data.workers, worker] }
      if (newDraft.genero || newDraft.escolaridad || newDraft.turnoAsignado != null || newDraft.turnoCorreccion != null) {
        patch.workersExtended = [...data.workersExtended, {
          id: 0, workerKey: worker.key, nombre, ocupacion: worker.ocupacion,
          restWeekday: null, workWeekday: null, workWeekdays: [],
          turnoAsignado: newDraft.turnoAsignado, turnoCorreccion: newDraft.turnoCorreccion,
          estrellas: 0, genero: newDraft.genero, escolaridad: newDraft.escolaridad,
          contratoCanceladoEl: null, contratoCanceladoCiclo: null, ausencias: [], fechaContratacion: '',
        }]
      }
      await persist(patch)
      setNewDraft({ nombre: '', ocupacion: '', carnet: '', cuentaBancaria: '', movil: '', genero: '', escolaridad: '', notas: '', turnoAsignado: null, turnoCorreccion: null })
      setShowAdd(false)
      setMsg(`Ficha de ${nombre} creada en el registro.`)
    } finally { setBusy(false) }
  }

  const openWorker = (w: Worker) => {
    setQuery('')
    setOpenKey(w.key)
    requestAnimationFrame(() => document.getElementById(`worker-card-${w.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <section aria-label="Registro de trabajadores" className="wr-section">
      <OrganigramaEquipo
        workers={activos}
        marks={props.marks}
        today={today}
        extendedMap={props.extMap}
        onOpenWorker={openWorker}
      />

      <section className="card wr-resumen" aria-label="Resumen de trabajadores">
        <h3 className="font-display">Resumen de trabajadores</h3>
        <div className="wr-resumen-grid">
          <div className="wr-resumen-cell"><p>Total</p><strong>{fmtInt(payrollWorkers.length)}</strong></div>
          <div className="wr-resumen-cell"><p>Edad</p><strong>{averageAge == null ? '—' : `${fmtInt(averageAge)} años`}</strong><p className="wr-resumen-sub">{knownAges.length ? `promedio · rango ${Math.min(...knownAges)}–${Math.max(...knownAges)}` : 'sin edades completas'}</p></div>
          <div className="wr-resumen-cell"><p>Femenino</p><strong>{fmtInt(genderCounts.femenino)}</strong></div>
          <div className="wr-resumen-cell"><p>Masculino</p><strong>{fmtInt(genderCounts.masculino)}</strong></div>
        </div>
        <p className="wr-dim12 wr-mt2">Género sin completar: {genderCounts.pendiente} · Edad sin carné válido: {payrollWorkers.length - knownAges.length}</p>
        <div className="wr-mt4">
          <div className="wr-edu-head">
            <p className="wr-edu-title">Nivel de escolaridad</p>
            <p className="wr-dim11">{payrollWorkers.length} en total</p>
          </div>
          <div className="wr-edu-list">
            {educationOrder.map((level) => {
              const count = payrollWorkers.filter((w) => (props.extMap.get(w.key)?.escolaridad ?? '') === level).length
              const percentage = payrollWorkers.length ? (count / payrollWorkers.length) * 100 : 0
              return (
                <div key={level}>
                  <div className="wr-edu-row">
                    <span>{educationLabel[level]}</span>
                    <strong>{count}</strong>
                  </div>
                  <div role="progressbar" aria-label={`${educationLabel[level]}: ${count} de ${payrollWorkers.length} trabajadores`} aria-valuemin={0} aria-valuemax={Math.max(payrollWorkers.length, 1)} aria-valuenow={count} className="wr-edu-bar">
                    <div style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="wr-dim11 wr-mt2">Sin completar: <strong>{payrollWorkers.filter((w) => !(props.extMap.get(w.key)?.escolaridad ?? '')).length}</strong></p>
        </div>
      </section>

      <WorkerQrScanner workers={activos} extendedList={data.workersExtended} onOpenWorker={openWorker} />

      <div className="wr-reg-head">
        <h3 className="font-display wr-reg-title">
          <Icon name="people" size={20} /> Registro de trabajadores{' '}
          <InfoHelp label="Cómo funciona el Registro de trabajadores">
            {REGISTRO_INFO.map((t, i) => <span key={i} className="block mb-2">{t}</span>)}
          </InfoHelp>
        </h3>
        <div className="wr-reg-actions">
          <button type="button" className="btn wr-btn-rel" onClick={() => setShowCuentas((v) => !v)} aria-expanded={showCuentas} aria-label="Ver historial de cuentas de trabajadores">
            <Icon name="alert" size={14} /> Cuentas
            {conCuentas.length > 0 && <span className="wr-count-badge">{conCuentas.length}</span>}
          </button>
          {isAdmin && (
            <button type="button" className="btn primary" onClick={() => setShowAdd((s) => !s)}>
              <Icon name="plus" size={14} /> Añadir trabajador
            </button>
          )}
        </div>
      </div>

      {showCuentas && (
        <div className="card wr-panel" aria-label="Historial de cuentas de trabajadores">
          <p className="wr-section-title">Trabajadores con historial de cuentas</p>
          {conCuentas.length === 0 ? <p className="wr-dim12 wr-mt1">Ningún trabajador tiene cuentas registradas.</p> : (
            <ul className="wr-cuentas-panel-list">
              {conCuentas.map((w) => {
                const m = models.get(w.key)!
                return (
                  <li key={w.key}>
                    <button type="button" className="wr-cuenta-btn" onClick={() => { setShowCuentas(false); openWorker(w) }}>
                      <span>{w.nombre} · {m.cuentasPartidas.length} movimiento{m.cuentasPartidas.length === 1 ? '' : 's'}</span>
                      <strong>{fmtInt(m.cuentasSaldo)} CUP</strong>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {cumpleManana.length > 0 && (
        <div className="wr-panel wr-panel-warn" role="status" aria-label="Cumpleaños de trabajadores mañana">
          <p className="wr-section-title">Cumpleaños mañana</p>
          <p className="wr-text wr-mt1">{cumpleManana.map((w) => w.nombre).join(', ')} cumple{cumpleManana.length === 1 ? '' : 'n'} años mañana.</p>
        </div>
      )}

      {(tocaHoy.length > 0 || tocaManana.length > 0) && (
        <div className="card wr-panel" aria-label="A quién le toca trabajar">
          <p className="wr-block-title">Según la rotación válida (detectada del IPV o corregida a mano)</p>
          {tocaHoy.length ? <p className="wr-text"><span className="wr-deep-bold">Hoy le toca a:</span> {tocaHoy.map((w) => w.nombre).join(', ')}.</p> : null}
          {tocaManana.length ? <p className="wr-text"><span className="wr-deep-bold">Mañana le toca a:</span> {tocaManana.map((w) => w.nombre).join(', ')}.</p> : null}
        </div>
      )}

      {showAdd && isAdmin && (
        <div className="card wr-panel" aria-label="Añadir trabajador al registro">
          <p className="font-display wr-datos-title">Nueva ficha (no hace falta que salga en el IPV)</p>
          <div className="wr-form wr-form-2">
            <div className="wr-span2">
              <label className="wr-label" htmlFor="new-worker-nombre">Nombre y apellidos *</label>
              <input id="new-worker-nombre" type="text" value={newDraft.nombre} onChange={(e) => setNewDraft((d) => ({ ...d, nombre: e.target.value }))} className="wr-input" placeholder="Nombre y apellidos" />
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-ocupacion">Cargo / ocupación</label>
              <input id="new-worker-ocupacion" type="text" value={newDraft.ocupacion} onChange={(e) => setNewDraft((d) => ({ ...d, ocupacion: e.target.value }))} className="wr-input" placeholder="Cargo u ocupación" />
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-carnet">Número de carné</label>
              <input id="new-worker-carnet" type="text" value={newDraft.carnet} onChange={(e) => setNewDraft((d) => ({ ...d, carnet: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-cuenta">Cuenta bancaria</label>
              <input id="new-worker-cuenta" type="text" value={newDraft.cuentaBancaria} onChange={(e) => setNewDraft((d) => ({ ...d, cuentaBancaria: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-movil">Móvil</label>
              <input id="new-worker-movil" type="text" value={newDraft.movil} onChange={(e) => setNewDraft((d) => ({ ...d, movil: e.target.value }))} className="wr-input" />
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-genero">Género</label>
              <select id="new-worker-genero" value={newDraft.genero} onChange={(e) => setNewDraft((d) => ({ ...d, genero: e.target.value }))} className="wr-input"><option value="">Sin completar</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option></select>
            </div>
            <div>
              <label className="wr-label" htmlFor="new-worker-escolaridad">Nivel de escolaridad</label>
              <select id="new-worker-escolaridad" value={newDraft.escolaridad} onChange={(e) => setNewDraft((d) => ({ ...d, escolaridad: e.target.value }))} className="wr-input"><option value="">Sin completar</option><option value="primaria">Primaria</option><option value="secundaria">Secundaria</option><option value="preuniversitario">Preuniversitario</option><option value="tecnico_medio">Técnico medio</option><option value="universitario">Universitario</option><option value="maestria">Maestría</option><option value="doctorado">Doctorado</option></select>
            </div>
            <div className="wr-span2">
              <label className="wr-label" htmlFor="new-worker-notas">Notas</label>
              <input id="new-worker-notas" type="text" value={newDraft.notas} onChange={(e) => setNewDraft((d) => ({ ...d, notas: e.target.value }))} className="wr-input" placeholder="Opcional" />
            </div>
            {esCargoDeTurno(newDraft.ocupacion) && (
              <>
                <div>
                  <label className="wr-label" htmlFor="new-worker-turno">Turno puesto a mano (camareras, cajeras y cocineras)</label>
                  <select id="new-worker-turno" value={newDraft.turnoAsignado == null ? '' : String(newDraft.turnoAsignado)} onChange={(e) => setNewDraft((d) => ({ ...d, turnoAsignado: e.target.value === '' ? null : (Number(e.target.value) as 1 | 2) }))} className="wr-input">
                    <option value="">Sin turno puesto</option>
                    <option value="1">Turno 1</option>
                    <option value="2">Turno 2</option>
                  </select>
                </div>
                <div>
                  <label className="wr-label" htmlFor="new-worker-turno-correccion">Corrección manual que manda (si no cuadra con el IPV)</label>
                  <select id="new-worker-turno-correccion" value={newDraft.turnoCorreccion == null ? '' : String(newDraft.turnoCorreccion)} onChange={(e) => setNewDraft((d) => ({ ...d, turnoCorreccion: e.target.value === '' ? null : (Number(e.target.value) as 1 | 2) }))} className="wr-input">
                    <option value="">Sin corrección (manda lo detectado)</option>
                    <option value="1">Turno 1</option>
                    <option value="2">Turno 2</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div className="wr-actions">
            <button type="button" disabled={busy || !newDraft.nombre.trim()} onClick={() => void addWorker()} className="btn primary">{busy ? 'Guardando…' : 'Guardar ficha'}</button>
            <button type="button" onClick={() => setShowAdd(false)} className="btn">Cancelar</button>
          </div>
        </div>
      )}

      <div className="wr-search">
        <label className="wr-label" htmlFor="worker-search">Buscar en el registro</label>
        <input id="worker-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o cargo…" className="wr-input" />
      </div>

      {msg && (
        <div className="wr-msg" role="status">
          <p>{msg}</p>
          <button type="button" onClick={() => setMsg('')} aria-label="Quitar este aviso del registro de trabajadores" className="btn wr-btn-sm">
            <Icon name="x" size={13} /> Quitar aviso
          </button>
        </div>
      )}

      {activos.length === 0 ? (
        <div className="card wr-empty">
          <p className="wr-dim14">{data.workersHistorial.length > 0 ? 'Ahora mismo no hay fichas activas: las que había están en el historial de trabajadores, justo debajo, y puedes consultarlas, restaurarlas o eliminarlas permanentemente.' : 'Todavía no hay fichas. Cuando importes un IPV con su hoja RH, cada trabajador aparece aquí solo con sus datos; también puedes añadir a alguien a mano con «Añadir trabajador».'}</p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="card wr-empty">
          <p className="wr-dim14">Nadie coincide con «{query}» en el registro.</p>
        </div>
      ) : (
        <div className="wr-grid">
          {visibles.map((w) => (
            <WorkerCard key={w.key} model={models.get(w.key)!} ctx={ctx} />
          ))}
        </div>
      )}

      {data.workersHistorial.length > 0 && (
        <section className="wr-historial" aria-label="Historial de trabajadores">
          <h4 className="font-display wr-historial-title"><Icon name="people" size={19} /> Historial de trabajadores</h4>
          <p className="wr-dim14 wr-mt1">
            Quienes salieron del registro activo con «Eliminar del registro». Salen siempre por orden alfabético, igual que el registro activo. No se borró nada: cada ficha conserva sus datos, su foto, sus pagos por quincena, sus pagos manuales, su rotación y su gráfico de días. Toca una tarjeta para consultarla completa o restaura la ficha si la persona vuelve. Y si ya no debe quedar ni en el historial, cada tarjeta tiene «Eliminar a un trabajador del historial» («Eliminar permanentemente»): eso sí lo borra todo para siempre, con confirmación.
          </p>
          <div className="wr-grid">
            {[...data.workersHistorial]
              .sort((a, b) => a.worker.nombre.localeCompare(b.worker.nombre, 'es', { sensitivity: 'base', numeric: true }))
              .map((entry) => {
                const modelProps: RegistryProps = {
                  ...props,
                  extMap: new Map(props.extMap),
                }
                if (entry.extended) modelProps.extMap.set(entry.key, entry.extended)
                const model = buildFicha(modelProps, entry.worker)
                return <WorkerCard key={entry.key} model={model} ctx={ctx} historialEntry={entry} />
              })}
          </div>
        </section>
      )}
    </section>
  )
}
