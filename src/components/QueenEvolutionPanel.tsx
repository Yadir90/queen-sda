/* Panel COMPLETO de evolución de Queen — puerto de QueenEvolutionPanel
   (+ QueenStageIcon y QueenOrganism) del original (client/src/App.tsx
   ~23218-23340). En el original se monta UNA sola vez: dentro de la
   tarjeta «Evolución de Queen» de Sistema (SistemaTab), y ahí vive
   también en el clon (screens/Sistema.tsx, tarjeta «evolucion»); la
   consola de Queen solo trae su resumen de cabecera, como el original.
   Estructura del original, en orden: héroe con el Reactor según la
   etapa, «Etapa actual» con la salud en vivo y la fecha de medición,
   progreso hacia la siguiente etapa, «Métricas vivas» (las 7, con
   mini-barras hacia la referencia madura), «Umbrales de evolución»
   (las 5 etapas ordenadas, con la actual marcada) e «Historial de
   evolución».
   Datos: buildQueenEvolution de lib/queenCore.mjs (etapa, índice,
   progreso, métricas y snapshot salen de los datos reales de esta
   copia) y la salud en vivo de buildQueenHealth. Adaptaciones
   honestas de esta copia, sin inventar cifras:
   - El original ilustra cada etapa con una imagen; aquí la imagen es
     el Reactor Evolutivo (QueenReactorMark), el dibujo por etapa del
     clon, como ya hace el resto del sistema.
   - Tres métricas (patrones, acciones autónomas y precisión) viven
     en tablas del original que no viajan en el respaldo: se muestran
     «Sin medir», con su mini-barra a cero y su referencia madura,
     y NO entran en el índice (queenCore renormaliza sobre las
     señales medibles y lo declara en su nota).
   - El historial del original guarda cada cambio de etapa en su
     servidor; esta copia lo lee de app_settings
     ('queen-evolution-history') y lo muestra completo: EL HISTORIAL
     DEL SERVIDOR MANDA sobre la última medición (snapshot de
     queenCore / queenEvolution del respaldo), que solo se usa
     cuando el servidor no trae historial. Si no hay ninguno de los
     dos, se muestra el texto del original.
   - Sin días importados queenCore no declara etapa (score null):
     se pinta el estado vacío del panel con su nota, no una etapa
     inventada. */

import type { QueenEvolutionHistoryEntry } from '../types'
import { QueenReactorMark, type ReactorHealth, type ReactorStageId } from './QueenReactor'
import {
  QUEEN_HEALTH_COPY, QUEEN_STAGES,
  type QueenEvolution, type QueenHealthState,
} from '../lib/queenCore.mjs'

const fmtNum1 = new Intl.NumberFormat('es-CU', { maximumFractionDigits: 1 })

/** fmtSmsTimestamp del original: fecha y hora legibles en hora de La Habana. */
function fmtMedido(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString('es-CU', {
    timeZone: 'America/Havana',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Cada miniatura es el reactor en la forma y el color propios de su etapa. */
function QueenStageIcon({ stageId, current = false }: { stageId: ReactorStageId; current?: boolean }) {
  return (
    <span className={`queen-evolution-stage-image queen-orb-stage-${stageId}${current ? ' is-active' : ''}`} aria-hidden="true">
      <QueenReactorMark stageId={stageId} size={42} />
    </span>
  )
}

function QueenOrganism({ stageId, stageName, health }: { stageId: ReactorStageId; stageName: string; health: QueenHealthState }) {
  return (
    <figure className={`queen-organism queen-organism-${stageId} queen-organism-health-${health}`} aria-label={`Queen en etapa ${stageName}, ${QUEEN_HEALTH_COPY[health].label.toLocaleLowerCase('es')}`}>
      <span className="queen-organism-picture">
        <QueenReactorMark stageId={stageId} health={health as ReactorHealth} size={180} />
      </span>
      {/* Sin luciérnagas ni partículas alrededor del icono
          (corrección del dueño, 2026-10-18): el reactor va solo y
          limpio, con el color de su etapa y el giro de sus anillos. */}
      <span className="queen-organism-expression" aria-hidden="true" />
    </figure>
  )
}

/** Unidad de cada métrica del original: la precisión es porcentaje
 *  y los días de operación se cuentan en días; el resto son conteos. */
function metricUnit(key: string): 'porcentaje' | 'días' | '' {
  if (key === 'precision') return 'porcentaje'
  if (key === 'days') return 'días'
  return ''
}

export default function QueenEvolutionPanel({ evo, health, serverHistory = [] }: {
  evo: QueenEvolution
  health: QueenHealthState
  /** Historial real del servidor original (app_settings ·
   *  'queen-evolution-history'): manda sobre el snapshot local. */
  serverHistory?: QueenEvolutionHistoryEntry[]
}) {
  if (evo.score == null) {
    return (
      <div className="queen-evolution-panel queen-evolution-empty" role="alert">
        <strong>Sin medición todavía.</strong>
        <span>{evo.note}</span>
        {serverHistory.length ? (
          <>
            <ol className="queen-evolution-history" style={{ marginTop: 12, textAlign: 'left' }}>
              {[...serverHistory].reverse().map((h, i) => (
                <li key={`${h.stageId}-${h.reachedAt}-${i}`}>
                  <span />
                  <div>
                    <strong>{h.stageName} · {fmtNum1.format(h.score)} puntos</strong>
                    {h.reason ? <p>{h.reason}</p> : null}
                    {h.reachedAt ? <small>{fmtMedido(h.reachedAt)}</small> : null}
                  </div>
                </li>
              ))}
            </ol>
            <span className="small muted">Historial del servidor original (app_settings · queen-evolution-history).</span>
          </>
        ) : null}
      </div>
    )
  }
  const score = evo.score
  const measuredAt = evo.snapshot?.measuredAt ?? null
  return (
    <div className="queen-evolution-panel" aria-label="Evolución en tiempo real de Queen">
      <div className="queen-evolution-hero">
        <div className="queen-profile-orb-wrap">
          <QueenOrganism stageId={evo.stage.id} stageName={evo.stage.name} health={health} />
        </div>
        <div className="queen-evolution-stage-copy">
          <span className={`queen-evolution-live queen-evolution-live-${health}`}><i /> {QUEEN_HEALTH_COPY[health].label} · en tiempo real</span>
          <p className="queen-evolution-kicker">Etapa actual</p>
          <h3>{evo.stage.name}</h3>
          <p>{evo.stage.description}</p>
          {measuredAt ? <small>Medido {fmtMedido(measuredAt)}</small> : null}
        </div>
      </div>

      <div className="queen-evolution-progress" aria-label={evo.nextStage ? `${evo.progressToNext}% del trayecto hacia ${evo.nextStage.name}` : 'Etapa madura alcanzada'}>
        <div className="queen-evolution-progress-head">
          <strong>{evo.nextStage ? `Camino a ${evo.nextStage.name}` : 'Madurez alcanzada'}</strong>
          <span>{evo.nextStage ? `${evo.progressToNext}%` : '100%'}</span>
        </div>
        <div className="queen-evolution-track"><span style={{ width: `${evo.progressToNext}%` }} /></div>
        <p>Índice de desarrollo: <b>{fmtNum1.format(score)} / 100</b>{evo.nextStage ? ` · ${fmtNum1.format(Math.max(0, evo.nextStage.minScore - score))} puntos para la próxima etapa` : ''}</p>
        <p>{evo.note}</p>
      </div>

      <section className="queen-evolution-section" aria-labelledby="queen-evolution-metrics-title">
        <div className="queen-evolution-section-head">
          <div><h4 id="queen-evolution-metrics-title">Métricas vivas</h4><p>Cada dato se recalcula desde los registros reales del sistema.</p></div>
          <span>{evo.metrics.length}</span>
        </div>
        <div className="queen-evolution-metrics">
          {evo.metrics.map((metric) => {
            const unit = metricUnit(metric.key)
            const metricProgress = metric.measured && metric.value != null
              ? Math.min(100, Math.round((metric.value / metric.target) * 100))
              : 0
            return (
              <article key={metric.key} className="queen-evolution-metric">
                <div>
                  <span>{metric.label}</span>
                  <strong>{metric.measured && metric.value != null
                    ? (unit === 'porcentaje' ? `${fmtNum1.format(metric.value)}%` : fmtNum1.format(metric.value))
                    : 'Sin medir'}</strong>
                </div>
                <div className="queen-evolution-mini-track" aria-label={metric.measured ? `${metricProgress}% de la referencia madura` : 'Sin medir: no viaja en el respaldo'}><span style={{ width: `${metricProgress}%` }} /></div>
                <p>{metric.detail}</p>
                <small>Referencia madura: {fmtNum1.format(metric.target)}{unit === 'porcentaje' ? '%' : unit === 'días' ? ' días' : ''}</small>
              </article>
            )
          })}
        </div>
      </section>

      <section className="queen-evolution-section" aria-labelledby="queen-evolution-stages-title">
        <div className="queen-evolution-section-head">
          <div><h4 id="queen-evolution-stages-title">Umbrales de evolución</h4><p>El índice pondera las siete métricas. La etapa cambia sola al cruzar un umbral.</p></div>
        </div>
        <ol className="queen-evolution-stages">
          {QUEEN_STAGES.map((stage) => (
            <li key={stage.id} className={stage.id === evo.stage.id ? 'is-current' : score >= stage.minScore ? 'is-passed' : ''}>
              <span className="queen-evolution-stage-dot" />
              <QueenStageIcon stageId={stage.id} current={stage.id === evo.stage.id} />
              <div><strong>{stage.name}</strong><p>{stage.description}</p></div>
              <b>≥ {stage.minScore}</b>
            </li>
          ))}
        </ol>
      </section>

      <section className="queen-evolution-section" aria-labelledby="queen-evolution-history-title">
        <div className="queen-evolution-section-head">
          <div><h4 id="queen-evolution-history-title">Historial de evolución</h4><p>Guarda la fecha y el motivo cada vez que Queen cambia de etapa.</p></div>
        </div>
        {serverHistory.length ? (
          <>
            <ol className="queen-evolution-history">
              {[...serverHistory].reverse().map((h, i) => (
                <li key={`${h.stageId}-${h.reachedAt}-${i}`}>
                  <span />
                  <div>
                    <strong>{h.stageName} · {fmtNum1.format(h.score)} puntos</strong>
                    {h.reason ? <p>{h.reason}</p> : null}
                    {h.reachedAt ? <small>{fmtMedido(h.reachedAt)}</small> : null}
                  </div>
                </li>
              ))}
            </ol>
            <p className="small muted">Historial del servidor original (app_settings · queen-evolution-history): manda sobre el snapshot de esta copia.</p>
          </>
        ) : evo.snapshot ? (
          <ol className="queen-evolution-history">
            <li>
              <span />
              <div>
                <strong>{evo.snapshot.stageName} · {fmtNum1.format(evo.snapshot.score)} puntos</strong>
                <p>Última medición guardada en esta copia, calculada de sus datos reales por queenCore.</p>
                {evo.snapshot.measuredAt ? <small>{fmtMedido(evo.snapshot.measuredAt)}</small> : null}
              </div>
            </li>
          </ol>
        ) : <p className="queen-evolution-no-history">La primera medición se registrará automáticamente.</p>}
      </section>
    </div>
  )
}
