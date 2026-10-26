/* Espejo de Inicio: DayTimeline y NightCloseConsole portados TAL CUAL
   de client/src/futureCharts.tsx del sistema original (estructura,
   textos, tonos y comportamiento). Diferencia de arquitectura,
   documentada: el original los envuelve en su FutureCard con clases
   Tailwind; el clon no tiene Tailwind, así que la envoltura usa las
   clases hm-future-* de homeMirror.css, cuyos valores copian los de
   Tailwind/FutureCard (rounded-3xl = 24px, border 1px, p-4 = 16px,
   título font-display 18px/700, subtítulo 13px). El contenido, los
   estados y las interacciones son los del original. */

import { useState, type ReactNode } from 'react'

export const FX = { deep: '#0B3D2E', emerald: '#0E9F6E', turquoise: '#0EA5BD', gold: '#C9A227', amber: '#E9A13B', red: '#D64541' } as const

function HmFutureCard({ title, subtitle, children, nota }: { title: string; subtitle: string; children: ReactNode; nota?: string }) {
  return (
    <section aria-label={title} className="hm-future-card">
      <h3 className="hm-future-title">{title}</h3>
      <p className="hm-future-sub">{subtitle}</p>
      <div className="hm-future-body">{children}</div>
      {nota ? <p className="hm-future-nota"><strong>Cómo leerlo:</strong> {nota}</p> : null}
    </section>
  )
}

function HmDetailLine({ text }: { text: string | null }) {
  if (!text) return null
  return <p role="status" aria-live="polite" className="hm-detail-line">{text}</p>
}

/* ================= Línea de tiempo del día (original) =================
 * Cinta de 10:00 a 22:00 (el horario de La Reina). Solo se colocan en
 * su hora los eventos que tienen una hora real registrada. Lo del día
 * sin hora registrada NO se inventa una hora: va en el carril «Del
 * día» bajo la cinta. */

export type TimelineEvent = { id: string; label: string; detail: string; minutes: number | null; tone: 'ok' | 'warn' | 'bad' | 'info' }

export function DayTimeline({ events, dayLabel }: { events: TimelineEvent[]; dayLabel: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const timed = events.filter((e) => e.minutes != null)
  const untimed = events.filter((e) => e.minutes == null)
  const selE = events.find((e) => e.id === sel) ?? null
  const toneColor = (t: TimelineEvent['tone']) => (t === 'bad' ? FX.red : t === 'warn' ? FX.amber : t === 'ok' ? FX.emerald : FX.turquoise)
  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return (
    <HmFutureCard title={`Línea de tiempo · ${dayLabel}`} subtitle="El día sobre la cinta del horario de La Reina, de 10:00 am a 10:00 pm."
      nota="en su hora exacta solo va lo que tiene hora real registrada (por ejemplo, la hora en que salió un correo). Lo demás del día va en el carril de abajo, sin hora inventada. Toca cualquier punto para ver su detalle. Arrastra la cinta si no cabe.">
      <div className="hm-tl-scroll">
        <div className="hm-tl-strip" role="list" aria-label="Eventos del día con hora">
          <div className="hm-tl-line">
            {timed.map((e) => {
              const pct = ((e.minutes! - 600) / 720) * 100
              if (pct < 0 || pct > 100) return null
              return (
                <button key={e.id} type="button" role="listitem" onClick={() => setSel(sel === e.id ? null : e.id)}
                  aria-label={`${e.label}, a las ${fmtMin(e.minutes!)}`}
                  className="hm-tl-dot"
                  style={{ left: `${pct}%`, backgroundColor: toneColor(e.tone) }} />
              )
            })}
          </div>
          <div className="hm-tl-hours">
            {['10 am', '12 pm', '2 pm', '4 pm', '6 pm', '8 pm', '10 pm'].map((h) => <span key={h}>{h}</span>)}
          </div>
        </div>
      </div>
      {untimed.length ? (
        <div className="hm-tl-untimed">
          <p className="hm-tl-untimed-title">Del día, sin hora registrada</p>
          <div className="hm-tl-chips">
            {untimed.map((e) => (
              <button key={e.id} type="button" onClick={() => setSel(sel === e.id ? null : e.id)} aria-label={`${e.label}. Toca para ver el detalle.`}
                className={`hm-tl-chip${sel === e.id ? ' is-sel' : ''}`}>
                <span aria-hidden="true" className="hm-tl-chip-dot" style={{ backgroundColor: toneColor(e.tone) }} />
                {e.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!events.length ? <p className="hm-empty">Sin eventos registrados hoy todavía: cuando entre el IPV, salga un correo o Queen detecte algo, aparecerá aquí.</p> : null}
      <HmDetailLine text={selE ? `${selE.label}${selE.minutes != null ? ` · ${fmtMin(selE.minutes)}` : ''} — ${selE.detail}` : null} />
    </HmFutureCard>
  )
}

/* ================= Consola nocturna de cierre (original) ==============
 * Guía paso a paso del cierre de jornada con estados reales: cada paso
 * se marca solo cuando su registro existe. Nada se da por hecho sin
 * su respaldo. */

export type CloseStep = { key: string; label: string; done: boolean; detail: string; actionLabel?: string }

export function NightCloseConsole({ steps, dayLabel, onAction, nota, subtitle, completeSubtitle }: {
  steps: CloseStep[]; dayLabel: string; onAction: (key: string) => void; nota?: string; subtitle?: string; completeSubtitle?: string
}) {
  const done = steps.filter((s) => s.done).length
  const pct = steps.length ? (done / steps.length) * 100 : 0
  const complete = done === steps.length && steps.length > 0
  return (
    <HmFutureCard title={`Consola nocturna de cierre · ${dayLabel}`} subtitle={complete ? (completeSubtitle ?? 'Cierre completo: la jornada quedó cerrada con todo su respaldo.') : (subtitle ?? 'El cierre de la jornada, paso a paso. Cada paso se enciende solo cuando su registro existe.')}
      nota={nota ?? 'la barra luminosa es el cierre real: ventas, gastos e IPV del día, cuadre en cero y boletín enviado. Si falta un paso, su botón te lleva justo donde se resuelve.'}>
      <div className="hm-nc-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`Cierre del día: ${done} de ${steps.length} pasos`}>
        <span className="hm-nc-fill" style={{ width: `${pct}%` }} />
      </div>
      <ol className="hm-nc-steps">
        {steps.map((s, i) => (
          <li key={s.key} className="hm-nc-step">
            <span aria-hidden="true" className="hm-nc-badge" style={{ backgroundColor: s.done ? FX.emerald : 'var(--dim)' }}>
              {s.done ? '✓' : i + 1}
            </span>
            <span className="hm-nc-text">
              <strong>{s.label}</strong>
              <span>{s.detail}</span>
            </span>
            {!s.done && s.actionLabel ? (
              <button type="button" onClick={() => onAction(s.key)} className="hm-nc-action">{s.actionLabel}</button>
            ) : null}
          </li>
        ))}
      </ol>
    </HmFutureCard>
  )
}
