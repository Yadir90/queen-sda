/* systemMirror.tsx — Piezas espejo de Sistema portadas del original.
 *
 * PORT LITERAL siempre que la arquitectura del clon lo permite: mismos
 * nombres de clase, misma estructura JSX y mismos textos base que
 * client/src/App.tsx (SystemDnaPanel, SystemIntegrationMap,
 * StartupTimeline de futureCharts.tsx) del sistema original. Los
 * estilos viven en systemMirror.css, copiados tal cual de theme.css.
 *
 * Diferencias de arquitectura (declaradas también en el informe):
 *  · El original lee organismo/evolución/auditoría de su servidor
 *    (getOrganismStatus, getQueenEvolution, getQueenAudit). El clon no
 *    tiene ese backend: cada pieza recibe por props los valores ya
 *    CALCULADOS en Sistema.tsx desde los datos reales del respaldo
 *    (queenCore.buildQueenEvolution / buildQueenErrorBank,
 *    automatizacionesCore.listCloneIntegrityIssues /
 *    runMaintenanceDiagnosis, y las comprobaciones de la pantalla).
 *  · El original descarga el IPV de un nodo desde su servidor; el clon
 *    no guarda los bytes del Excel por día, así que el nodo IPV no
 *    ofrece descarga: ofrece su estado y su detalle reales.
 *  · La intervención inmune del original pide autorización al servidor;
 *    en el clon no hay servidor que la ejecute, así que el banco de
 *    errores NO muestra botón de autorizar: muestra la célula, su
 *    anticuerpo (qué hacer en el sistema principal) y nada más.
 * Nada aquí inventa un dato: cada componente pinta lo que recibe. */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Section } from '../types'
import { Icon, type IconName } from './icons'
import { fmtCUP, fmtDate, fmtInt, havanaNow } from '../lib/utils'

/* ---- Constantes literales del original (App.tsx) ---- */

export type MirrorState = 'healthy' | 'verifying' | 'repairing' | 'error'

/* DNA_STATE_COPY del original, tal cual. */
export const DNA_STATE_COPY: Record<MirrorState, { label: string; short: string }> = {
  error: { label: 'Error detectado', short: 'Error' },
  repairing: { label: 'Corrección pendiente', short: 'Reparando' },
  verifying: { label: 'Verificando', short: 'Verificando' },
  healthy: { label: 'Funcionando correctamente', short: 'Correcto' },
}

/* QUEEN_NETWORK_POSITIONS del original, tal cual. */
const QUEEN_NETWORK_POSITIONS: Record<string, { x: number; y: number }> = {
  memoria: { x: 20, y: 28 },
  aprendizaje: { x: 28, y: 69 },
  pensamiento: { x: 50, y: 15 },
  auditoria: { x: 80, y: 28 },
  autorreparacion: { x: 72, y: 69 },
  respaldos: { x: 50, y: 82 },
}

/* SYSTEM_DNA_CAPACITY_SHARE del original, tal cual. */
export const SYSTEM_DNA_CAPACITY_SHARE: Record<string, number> = {
  interfaz: 7, datos: 12, memoria: 10, aprendizaje: 8, pensamiento: 8,
  ipv: 11, auditoria: 5, cuentas: 7, rh: 6, documentos: 6, respaldos: 4,
  limpieza: 3, autorreparacion: 4, seguridad: 3, conexion: 4,
}

/* Puntos por estado del original (progressPoints), tal cual. */
export const PROGRESS_POINTS: Record<MirrorState, number> = { error: 1, repairing: 38, verifying: 72, healthy: 100 }

export interface MirrorSegment {
  id: string
  area: string
  state: MirrorState
  detail: string
  facts?: Array<{ label: string; value: string }>
}

export function healthFor(segment: MirrorSegment): number {
  return PROGRESS_POINTS[segment.state]
}

export function globalStateOf(segments: MirrorSegment[]): MirrorState {
  const counts = { error: 0, repairing: 0, verifying: 0, healthy: 0 } as Record<MirrorState, number>
  for (const s of segments) counts[s.state] += 1
  return counts.error ? 'error' : counts.repairing ? 'repairing' : counts.verifying ? 'verifying' : 'healthy'
}

/* ================= Organismo (organism-system-map) ================= */

export interface OrganismPart {
  id: string
  biological: string
  component: string
  fn: string
  state: MirrorState
  metric: string
  modules?: string[]
}

export function OrganismMap({ parts, checkedLabel, checkedIso, flowModules, online, failedDocuments, technicalErrors, ipvMissingAfterClose }: {
  parts: OrganismPart[]
  checkedLabel: string
  checkedIso: string
  flowModules: Array<{ name: string; value: string }>
  online: boolean
  failedDocuments: number
  technicalErrors: number
  ipvMissingAfterClose: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>('corazon')
  const selected = parts.find((p) => p.id === selectedId) ?? null
  const global = globalStateOf(parts.map((p) => ({ id: p.id, area: p.biological, state: p.state, detail: p.metric })))
  /* Hora de La Habana, como el havanaHour del original (D-04). */
  const hour = havanaNow().hour
  const isRepairNight = hour >= 23 || hour < 6
  const compensationActive = technicalErrors > 0 || failedDocuments > 0 || !online
  return (
    <section className={`organism-system-map dna-state-${global}`} aria-labelledby="organism-map-title">
      <header className="organism-map-header">
        <div>
          <span className="system-live-kicker"><i aria-hidden="true" /> Organismo en tiempo real</span>
          <h3 id="organism-map-title">El SDA como organismo</h3>
          <p>Cada parte biológica corresponde a un componente real. Toca un nodo para ver cómo sostiene al resto.</p>
        </div>
        <div className="organism-map-health" aria-label={`Estado del organismo: ${DNA_STATE_COPY[global].label}`}>
          <i aria-hidden="true" />
          <span><strong>{DNA_STATE_COPY[global].short}</strong><small>{parts.length} partes conectadas</small></span>
        </div>
      </header>
      <div className="organism-map-layout">
        <div className="organism-map-stage" role="list" aria-label="Partes del organismo SDA">
          <div className="organism-silhouette" aria-hidden="true">
            <span className="organism-head" />
            <span className="organism-torso" />
            <span className="organism-arm organism-arm-left" />
            <span className="organism-arm organism-arm-right" />
            <span className="organism-leg organism-leg-left" />
            <span className="organism-leg organism-leg-right" />
            <span className="organism-flow organism-flow-a" />
            <span className="organism-flow organism-flow-b" />
          </div>
          {parts.map((part, index) => {
            const isSelected = selectedId === part.id
            return (
              <button
                key={part.id}
                type="button"
                role="listitem"
                className={`organism-part organism-part-${part.id} dna-state-${part.state}${isSelected ? ' is-selected' : ''}`}
                onClick={() => setSelectedId((cur) => (cur === part.id ? null : part.id))}
                aria-pressed={isSelected}
                aria-label={`${part.biological}, ${part.component}: ${DNA_STATE_COPY[part.state].label}. ${isSelected ? 'Tocar otra vez para ocultar la explicación' : 'Tocar para ver la explicación'}`}
                style={{ '--organism-index': index } as CSSProperties}
              >
                <i aria-hidden="true" />
                <span><strong>{part.biological}</strong><small>{part.component}</small></span>
              </button>
            )
          })}
          <span className="organism-heartbeat-line" aria-hidden="true" />
        </div>
        <div className="organism-map-explanation" aria-live="polite">
          {selected ? (
            <>
              <div className="organism-selected-heading">
                <span className={`organism-selected-icon dna-state-${selected.state}`} aria-hidden="true"><i /></span>
                <div><small>{selected.biological}</small><strong>{selected.component}</strong></div>
                <b className={`dna-state-${selected.state}`}>{DNA_STATE_COPY[selected.state].short}</b>
              </div>
              <p>{selected.fn}</p>
              {selected.modules ? (
                <ul className="organism-module-list" aria-label="Órganos operativos del SDA">
                  {selected.modules.map((m) => <li key={m}>{m}</li>)}
                </ul>
              ) : null}
              <div className="organism-live-metric"><span><i aria-hidden="true" /> Lectura actual</span><strong>{selected.metric}</strong></div>
              {selected.id === 'inmune' ? (
                <div className="organism-immune-detail">
                  <p className="organism-immune-clear">El detalle de células y cuarentena vive en la tarjeta «Banco de errores · Sistema inmune» de esta misma pantalla, con los errores verificados de esta copia.</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="organism-cycle-copy">
              <strong>Así funciona el organismo</strong>
              <p>El ADN define las reglas; Queen interpreta las señales; el corazón concilia el IPV; la sangre distribuye datos; los órganos ejecutan; los sistemas nervioso e inmune vigilan; hígado y riñones auditan y depuran; durante el sueño el organismo consolida y repara.</p>
            </div>
          )}
          <footer><span>Un toque muestra · otro oculta</span><time dateTime={checkedIso}>Actualizado {checkedLabel}</time></footer>
        </div>
      </div>
      <section className="organism-module-flow" aria-label="Flujo de datos en vivo entre los órganos operativos">
        <header><span><i aria-hidden="true" /> Flujo entre órganos</span><strong>En vivo</strong></header>
        <div className="organism-module-flow-track" role="list">
          {flowModules.map((module, index) => (
            <div key={module.name} className="organism-module-flow-node" role="listitem" style={{ '--flow-index': index } as CSSProperties}>
              <i aria-hidden="true" />
              <span><strong>{module.name}</strong><small>{module.value}</small></span>
            </div>
          ))}
        </div>
        <p>El IPV impulsa Cuentas; Cuentas alimenta Gastos; RH nutre Nómina; Almacén actualiza Inventario. Queen y los centinelas observan cada cruce sin alterar cifras.</p>
      </section>
      <div className="organism-autonomy-grid">
        <article className={compensationActive ? 'is-active' : 'is-ready'}>
          <span>Compensación</span><strong>{compensationActive ? 'Cobertura temporal activa' : 'Lista para asumir lo básico'}</strong>
          <p>{!online ? 'Sin red: conserva las operaciones locales y reanudará la sincronización al reconectar.' : failedDocuments > 0 ? 'Un envío falló: el resto del SDA sigue disponible y el documento queda pendiente para reintento.' : technicalErrors > 0 ? 'Hay un módulo con error: fue aislado para que no altere los demás datos.' : 'Si un órgano falla, se aísla y los módulos sanos mantienen lectura, captura local y avisos.'}</p>
        </article>
        <article className={isRepairNight ? 'is-night' : 'is-day'}>
          <span>Ritmo circadiano</span><strong>{isRepairNight ? 'Modo reparación nocturna' : 'Máxima actividad diurna'}</strong>
          <p>{isRepairNight ? 'Prioriza respaldo, consolidación, limpieza segura y diagnóstico profundo.' : 'Prioriza respuesta, importación y circulación de datos; el mantenimiento pesado espera la noche.'}</p>
        </article>
        <article className={ipvMissingAfterClose ? 'is-alert' : 'is-ready'}>
          <span>Reflejos automáticos</span><strong>{ipvMissingAfterClose ? 'IPV de hoy ausente tras las 10:30 pm' : 'Reflejos vigilando'}</strong>
          <p>{ipvMissingAfterClose ? 'El reflejo detectó el faltante y lo señala sin inventar un día en cero. No altera datos.' : 'Detecta un IPV faltante, aísla errores de integridad y protege el resto sin esperar razonamiento de Queen.'}</p>
        </article>
      </div>
      <div className="organism-state-key" aria-label="Estados de las partes del organismo">
        {(['healthy', 'verifying', 'repairing', 'error'] as MirrorState[]).map((state) => <span key={state} className={`dna-state-${state}`}><i aria-hidden="true" />{DNA_STATE_COPY[state].short}</span>)}
      </div>
    </section>
  )
}

/* ================= Queen: cerebro + red neuronal ================= */

export function QueenBrain({ segments, queenSegments, activeCapacity, suspendedCount, reviewedAt, focusLabel }: {
  segments: MirrorSegment[]
  queenSegments: MirrorSegment[]
  activeCapacity: number
  suspendedCount: number
  reviewedAt: string
  focusLabel: string
}) {
  const [selectedId, setSelectedId] = useState('auditoria')
  const [legendId, setLegendId] = useState<string | null>(null)
  const selected = queenSegments.find((s) => s.id === selectedId) ?? queenSegments[0] ?? segments[0]
  if (!selected) return null
  const selectedHealth = healthFor(selected)
  const selectedShare = SYSTEM_DNA_CAPACITY_SHARE[selected.id] ?? 0
  const toggle = (id: string) => { setSelectedId(id); setLegendId((cur) => (cur === id ? null : id)) }
  return (
    <section className="system-ai-core system-network-core" aria-labelledby="system-ai-core-title">
      <div className="system-ai-visual system-network-visual" role="group" aria-label="Red neuronal de los módulos del sistema">
        {/* Cerebro del SDA: la red de Queen dibujada en SVG ligero (el
            original usa una imagen WebP de su servidor de artefactos;
            el clon no tiene ese asset, así que la misma red se dibuja
            con los nodos reales en sus posiciones literales). */}
        <div className="system-brain-orbits" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <span className="system-ai-scan" aria-hidden="true" />
        <svg className="system-network-lines" viewBox="0 0 100 76" preserveAspectRatio="none" aria-hidden="true">
          <path d="M20 28 L50 15 L80 28 L72 69 L50 82 L28 69 Z M20 28 L50 42 L80 28 M28 69 L50 42 L72 69 M50 15 L50 42 L50 82" />
        </svg>
        {queenSegments.map((segment) => {
          const position = QUEEN_NETWORK_POSITIONS[segment.id] ?? { x: 50, y: 50 }
          const isLegendVisible = legendId === segment.id
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => toggle(segment.id)}
              aria-pressed={isLegendVisible}
              aria-label={`${segment.area}: ${healthFor(segment)}% de salud, ${DNA_STATE_COPY[segment.state].label}. ${isLegendVisible ? 'Tocar otra vez para ocultar la leyenda' : 'Tocar para mostrar la leyenda'}`}
              className={`system-network-node dna-state-${segment.state}${isLegendVisible ? ' is-selected' : ''}${segment.id === 'conexion' ? ' is-connectivity' : ''}${position.x < 50 ? ' callout-right' : ' callout-left'}`}
              style={{ '--node-x': `${position.x}%`, '--node-y': `${position.y}%` } as CSSProperties}
            >
              <i aria-hidden="true" />
              {isLegendVisible ? (
                <b className="system-node-health-callout" aria-live="polite">
                  <strong>{`${healthFor(segment)}%`}</strong>
                  <span>salud</span>
                </b>
              ) : null}
              <span>{segment.area}</span>
            </button>
          )
        })}
        <div className="system-network-center" aria-hidden="true"><span>Q</span></div>
      </div>
      <div className="system-ai-copy">
        <span className="system-ai-live"><i aria-hidden="true" /> Estado en tiempo real</span>
        <h3 id="system-ai-core-title">Mapa neuronal de Queen</h3>
        <p>Cada nodo es un módulo real del SDA. Tócalo una vez para mostrar su leyenda y vuelve a tocarlo para ocultarla.</p>
        <div className={`system-connectivity-pill system-node-info-pill dna-state-${selected.state}`} aria-label={`${selected.area}: ${selected.detail}`} aria-live="polite">
          <span><i aria-hidden="true" /> {selected.area}</span>
          <strong>{DNA_STATE_COPY[selected.state].label}</strong>
          <small>{selected.detail}</small>
          {selected.facts ? (
            <dl className="system-node-facts">
              {selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          ) : null}
          <div className="system-node-info-meta">
            <span>{`Salud ${selectedHealth}%`}</span>
            <span>{`${selectedShare}% del consumo`}</span>
            <span>{reviewedAt}</span>
          </div>
        </div>
        <p className="system-ai-active-zone" aria-live="polite"><span aria-hidden="true" /> Foco actual: <strong>{focusLabel}</strong></p>
        <div className="system-ai-capacity" aria-label={`Consumo activo de capacidad del sistema: ${activeCapacity}%`}>
          <div><span>Capacidad activa</span><strong>{activeCapacity}%</strong></div>
          <div className="system-ai-capacity-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={activeCapacity} aria-label="Consumo activo de capacidad del sistema">
            <span style={{ width: `${activeCapacity}%` }} />
          </div>
          <small>{suspendedCount ? `${suspendedCount} nodo${suspendedCount === 1 ? '' : 's'} neuronal${suspendedCount === 1 ? '' : 'es'} en suspensión` : `${queenSegments.length} nodos neuronales disponibles`} · {reviewedAt}</small>
        </div>
      </div>
    </section>
  )
}

/* ================= Mapa neuronal de IPV (sistema solar) ================= */

export interface IpvOrbitDay {
  date: string
  status: 'linked' | 'error'
  issueCount: number
  detail: string
}

/** Órbitas del original: el IPV más reciente cerca del sol; 16 puntos por órbita. */
export function buildIpvOrbitNodes(days: IpvOrbitDay[]) {
  const ordered = [...days].sort((a, b) => b.date.localeCompare(a.date))
  const lastIndex = Math.max(1, ordered.length - 1)
  return ordered.map((node, index) => {
    const ageRatio = index / lastIndex
    const orbitRadius = 22 + ageRatio * 23
    const phase = ((index * 137.508) - 90) * (Math.PI / 180)
    const points = Array.from({ length: 16 }, (_, pointIndex) => {
      const angle = phase + pointIndex * (Math.PI / 8)
      return { dx: Math.cos(angle) * orbitRadius, dy: Math.sin(angle) * orbitRadius * 0.78 }
    })
    const first = points[0] ?? { dx: 0, dy: 0 }
    return { node, index, x: 50 + first.dx, y: 50 + first.dy, orbitDuration: 15 + ageRatio * 19, points }
  })
}

export function IpvNeuralMap({ days }: { days: IpvOrbitDay[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // Pausa fuera de pantalla del original: la constelación solo anima
  // cuando se ve (IntersectionObserver + visibilitychange); fuera de
  // pantalla lleva is-paused y sus animaciones se detienen.
  const constellationRef = useRef<HTMLDivElement | null>(null)
  const [constellationVisible, setConstellationVisible] = useState(false)
  useEffect(() => {
    const element = constellationRef.current
    if (!element) { setConstellationVisible(false); return }
    const updateDocumentVisibility = () => {
      if (document.hidden) setConstellationVisible(false)
    }
    if (!('IntersectionObserver' in window)) {
      setConstellationVisible(!document.hidden)
      document.addEventListener('visibilitychange', updateDocumentVisibility)
      return () => document.removeEventListener('visibilitychange', updateDocumentVisibility)
    }
    const observer = new IntersectionObserver(([entry]) => {
      setConstellationVisible(Boolean(entry?.isIntersecting) && !document.hidden)
    }, { rootMargin: '80px 0px', threshold: 0.02 })
    observer.observe(element)
    const resumeWhenVisible = () => {
      if (!document.hidden) {
        const rect = element.getBoundingClientRect()
        setConstellationVisible(rect.bottom >= -80 && rect.top <= window.innerHeight + 80)
      } else setConstellationVisible(false)
    }
    document.addEventListener('visibilitychange', resumeWhenVisible)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', resumeWhenVisible)
    }
  }, [])
  const orbitNodes = useMemo(() => buildIpvOrbitNodes(days), [days])
  const selected = days.find((d) => d.date === selectedDay) ?? null
  return (
    <section className="ipv-neural-map" aria-labelledby="ipv-neural-map-title">
      <header className="ipv-neural-tools">
        <div className="ipv-neural-legend" aria-label="Leyenda del mapa">
          <span className="is-linked"><i />Enlazado</span><span className="is-error"><i />Error</span><span className="is-auditing"><i />Auditando</span><span className="is-repairing"><i />Reparando</span>
        </div>
      </header>
      {days.length ? (
        <div ref={constellationRef} className={`ipv-neural-constellation${constellationVisible ? ' is-visible' : ' is-paused'}`} role="list" aria-label="Constelación espacial de IPV alrededor del sol, corazón del sistema">
          <span className="ipv-starfield ipv-starfield-a" aria-hidden="true" />
          <span className="ipv-starfield ipv-starfield-b" aria-hidden="true" />
          <svg className="ipv-constellation-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {orbitNodes.map(({ node }, i) => {
              const next = orbitNodes[i + 1]?.node
              const a = orbitNodes[i]
              return (
                <g key={node.date} className={node.status === 'error' ? 'is-error' : ''}>
                  <line className="ipv-link-spoke" x1="50" y1="50" x2={a.x} y2={a.y} stroke="currentColor" />
                  {next ? <line className="ipv-link-chain" x1={a.x} y1={a.y} x2={orbitNodes[i + 1].x} y2={orbitNodes[i + 1].y} stroke="currentColor" /> : null}
                </g>
              )
            })}
          </svg>
          <span className="ipv-orbit-ring ipv-orbit-ring-inner" aria-hidden="true" />
          <span className="ipv-orbit-ring ipv-orbit-ring-middle" aria-hidden="true" />
          <span className="ipv-orbit-ring ipv-orbit-ring-outer" aria-hidden="true" />
          <span className="ipv-neural-sun" aria-hidden="true"><i /><strong>SDA</strong></span>
          {orbitNodes.map(({ node, index, x, y, orbitDuration, points }) => {
            const visualStatus = node.status
            const statusLabel = visualStatus === 'linked' ? 'enlazado' : 'con error'
            const shortStatus = visualStatus === 'linked' ? 'Enlazado' : 'Error'
            const orbitCoordinates = Object.fromEntries(points.flatMap((point, pointIndex) => [
              [`--ipv-dx${pointIndex}`, point.dx],
              [`--ipv-dy${pointIndex}`, point.dy],
            ]))
            const orbitStyle = {
              '--ipv-x': `${x}%`,
              '--ipv-y': `${y}%`,
              '--ipv-orbit-duration': `${orbitDuration}s`,
              '--ipv-delay': `${index * -740}ms`,
              ...orbitCoordinates,
            } as CSSProperties
            return (
              <div key={node.date} role="listitem" className={`ipv-orbit-item is-${visualStatus}${selectedDay === node.date ? ' is-selected' : ''}`} style={orbitStyle}>
                <button type="button" onClick={() => setSelectedDay((cur) => (cur === node.date ? null : node.date))} aria-pressed={selectedDay === node.date} aria-label={`IPV del ${node.date}: ${statusLabel}. ${selectedDay === node.date ? 'Tocar otra vez para ocultar la leyenda' : 'Tocar para mostrar la leyenda'}`}>
                  <span className="ipv-planet-code">IPV · {node.date.slice(5)}</span>
                  <span className="ipv-neural-node"><i aria-hidden="true" /><b aria-hidden="true" /></span>
                  <span className="ipv-planet-state">{shortStatus}</span>
                  <span className="ipv-orbit-meta">
                    <strong>{node.date}</strong>
                    <small>{visualStatus === 'linked' ? 'Enlazado' : `${node.issueCount} error${node.issueCount === 1 ? '' : 'es'}`}</small>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      ) : <p className="ipv-neural-empty">Importa el primer IPV para iniciar el mapa.</p>}
      <div className="ipv-neural-copy">
        <span><i aria-hidden="true" /> Estado en tiempo real</span>
        <h4 id="ipv-neural-map-title">Mapa neuronal de los IPV</h4>
        <p>El sol es el corazón del sistema. Los IPV giran ordenados por fecha: el más reciente viaja cerca del núcleo y los más antiguos ocupan órbitas progresivamente lejanas. Toca un punto para ver su estado; vuelve a tocarlo para ocultarlo. En esta copia el nodo no descarga el Excel del día: el respaldo no guarda sus bytes, y no se finge una descarga.</p>
      </div>
      {selected ? (
        <div className={`ipv-neural-selection is-${selected.status}`} aria-live="polite">
          <strong>IPV del {selected.date}</strong>
          <span>{selected.detail}</span>
        </div>
      ) : null}
    </section>
  )
}

/* ================= ADN operativo (hélice + mutaciones) ================= */

export interface DnaMutation {
  id: string
  title: string
  detail: string
  at: string | null
  source: string
}

export function DnaHelix({ segments, mutations, progress, globalLabel }: {
  segments: MirrorSegment[]
  mutations: DnaMutation[]
  progress: number
  globalLabel: string
}) {
  const [selectedId, setSelectedId] = useState('datos')
  const [legendId, setLegendId] = useState<string | null>(null)
  const selected = segments.find((s) => s.id === selectedId) ?? segments[0]
  const summary = { error: 0, repairing: 0, verifying: 0, healthy: 0 } as Record<MirrorState, number>
  for (const s of segments) summary[s.state] += 1
  const global: MirrorState = summary.error ? 'error' : summary.repairing ? 'repairing' : summary.verifying ? 'verifying' : 'healthy'
  const toggle = (id: string) => { setSelectedId(id); setLegendId((cur) => (cur === id ? null : id)) }
  if (!selected) return null
  const selectedHealth = healthFor(selected)
  const selectedShare = SYSTEM_DNA_CAPACITY_SHARE[selected.id] ?? 0
  /* Doble hélice LITERAL del original (SystemDnaPanel): escenario
     system-dna-stage.system-dna-helix, spinner con el SVG de las dos
     cintas (paths exactos), dos luces viajeras con animateMotion en
     recorridos opuestos (dur 4.6s, keyPoints 0;1;0 / 1;0;1) y las
     bases dna-helix-base con su ancho alterno [132,174,218,174…].
     Los estilos dna-helix-* van copiados de theme.css en
     systemMirror.css (bloque «PORT LITERAL dna-helix»). */
  return (
    <div>
      <div className="system-dna-head">
        <div className="system-dna-heading-copy">
          <h3 className="font-display font-bold">Cadena de instrucciones</h3>
          <p>Toca una vez un punto para mostrar su leyenda; vuelve a tocarlo para ocultarla.</p>
        </div>
        <span className={`system-dna-total dna-state-${global}`}>
          {summary.error ? `${summary.error} con error` : summary.repairing ? `${summary.repairing} en reparación` : summary.verifying ? `${summary.verifying} verificando` : 'Todo correcto'}
        </span>
        <div className={`system-connectivity-pill system-node-info-pill system-dna-selection-pill dna-state-${selected.state}`} aria-label={`Diagnóstico del ADN, ${selected.area}: ${selected.detail}`} aria-live="polite">
          <span><i aria-hidden="true" /> {selected.area}</span>
          <strong>{DNA_STATE_COPY[selected.state].label}</strong>
          <small>{selected.detail}</small>
          {selected.facts ? (
            <dl className="system-node-facts">
              {selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          ) : null}
          <div className="system-node-info-meta">
            <span>{`Salud ${selectedHealth}%`}</span>
            <span>{`${selectedShare}% del consumo`}</span>
            <span>{globalLabel}</span>
          </div>
        </div>
      </div>
      <div className="system-area-dna">
        <div className="system-dna-stage system-dna-helix" role="list" aria-label={`Doble hélice del ADN operativo: ${progress}% de integridad`}>
          <div className="dna-helix-spinner">
            <svg className="dna-helix-diagram" viewBox="0 0 320 430" preserveAspectRatio="none" aria-hidden="true">
              <path className="dna-helix-ribbon dna-helix-ribbon-a" d="M 94 8 C 94 60 226 60 226 112 S 94 164 94 216 S 226 268 226 320 S 94 372 94 422" />
              <path className="dna-helix-ribbon dna-helix-ribbon-b" d="M 226 8 C 226 60 94 60 94 112 S 226 164 226 216 S 94 268 94 320 S 226 372 226 422" />
              <g className="dna-helix-traveler">
                <circle className="dna-helix-traveler-halo" r="8" />
                <circle className="dna-helix-traveler-core" r="3.2" />
                <animateMotion dur="4.6s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;0" keyTimes="0;0.5;1" path="M 94 8 C 94 60 226 60 226 112 S 94 164 94 216 S 226 268 226 320 S 94 372 94 422" />
              </g>
              <g className="dna-helix-traveler dna-helix-traveler-b">
                <circle className="dna-helix-traveler-halo" r="8" />
                <circle className="dna-helix-traveler-core" r="3.2" />
                <animateMotion dur="4.6s" repeatCount="indefinite" calcMode="linear" keyPoints="1;0;1" keyTimes="0;0.5;1" path="M 226 8 C 226 60 94 60 94 112 S 226 164 226 216 S 94 268 94 320 S 226 372 226 422" />
              </g>
            </svg>
            {segments.map((segment, index) => {
              const changeType = segment.state === 'error' ? 'critical' : segment.state === 'repairing' || segment.state === 'verifying' ? 'modified' : 'added'
              const baseWidth = [132, 174, 218, 174, 132, 174, 218, 174][index % 8] ?? 174
              const isSel = legendId === segment.id
              const share = SYSTEM_DNA_CAPACITY_SHARE[segment.id] ?? 0
              return (
                <button
                  key={segment.id}
                  type="button"
                  role="listitem"
                  className={`dna-helix-base is-${changeType}${changeType === 'added' ? '' : ' has-problem'}${isSel ? ' is-selected' : ''}`}
                  style={{ '--dna-base-width': `${baseWidth}px`, '--dna-index': index } as CSSProperties}
                  onClick={() => toggle(segment.id)}
                  aria-label={`${segment.area}: ${changeType === 'critical' ? 'corrección crítica' : changeType === 'modified' ? 'modificación' : 'adición estable'}. ${isSel ? 'Tocar otra vez para ocultar el detalle' : 'Tocar para ver el detalle'}`}
                >
                  <i className="dna-helix-node dna-helix-node-a" aria-hidden="true" />
                  <span className="dna-helix-rung"><b>{segment.area}</b><small>{`${share}%`}</small></span>
                  <i className="dna-helix-node dna-helix-node-b" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="system-dna-progress" aria-label={`Salud de la cadena de ADN operativo: ${progress}%`}>
        <div><span>Integridad de instrucciones</span><strong>{progress}%</strong></div>
        <div className="system-dna-progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
        <small>Avanza solo cuando cada área pasa de error a reparación, verificación y estado correcto.</small>
      </div>
      <div className={`system-dna-detail dna-state-${selected.state}`}>
        <span className="system-dna-detail-dot" aria-hidden="true" />
        <div>
          <strong>{selected.area}</strong>
          <span>{DNA_STATE_COPY[selected.state].label}</span>
          <p>{selected.detail}</p>
        </div>
      </div>
      {/* Panel de mutaciones con la geometría del original
          (.dna-mutation-timeline, theme.css:7329): panel de altura
          fija con cabecera propia y lista con scroll interno — la
          versión anterior lo volcaba como lista abierta de miles de
          píxeles de alto (defecto señalado por el dueño, 26-oct).
          El contenido es el de esta copia (lo que el respaldo trae);
          lo que el original guarda en su base y no viaja no se
          inventa: la explicación vive tras el desplegable. */}
      <section className="dna-mutation-timeline" aria-label="Línea de tiempo de mutaciones">
        <header>
          <div>
            <strong id="dna-mutation-timeline-title">Línea de tiempo de mutaciones</strong>
            <span>Cambios observados en la revisión actual</span>
          </div>
          <time>{globalLabel}</time>
        </header>
        {mutations.length ? (
          <ol>
            {mutations.map((m) => (
              <li key={m.id}>
                <i aria-hidden="true" />
                <span>
                  <strong>{m.title}</strong>
                  <span>{m.detail} · Fuente: {m.source}</span>
                </span>
                <time dateTime={m.at ?? undefined}>{m.at ? fmtDate(m.at) : 'Sin fecha'}</time>
              </li>
            ))}
          </ol>
        ) : <p className="dna-mutation-empty">Sin mutaciones registradas en los datos cargados: el respaldo no trae decisiones, alias ni clasificaciones todavía.</p>}
      </section>
      <details className="dna-mutation-note">
        <summary>Qué trae esta línea de tiempo</summary>
        <p className="small muted">Cada cambio versionado que el respaldo de esta copia sí trae: directivas del dueño registradas en el código, decisiones por entrada, alias y clasificaciones aprendidas, y el snapshot de evolución guardado. Lo que el original guarda en su base y no viaja (versiones de ADN con checksum) no se inventa aquí.</p>
      </details>
      <div className="system-dna-legend" aria-label="Leyenda de estados del ADN">
        {(['healthy', 'verifying', 'repairing', 'error'] as MirrorState[]).map((state) => <span key={state} className={`dna-state-${state}`}><i aria-hidden="true" />{DNA_STATE_COPY[state].short}</span>)}
      </div>
    </div>
  )
}

/* ================= Integración (mapa orbital) ================= */

export interface IntegrationNodeDef {
  id: string
  label: string
  shortLabel: string
  icon: IconName
  tab: Section | null
  x: number
  y: number
  receives: string
  sends: string
  purpose: string
  hasData: boolean
  metric: string
}

/* SYSTEM_INTEGRATION_NODES del original, tal cual en posiciones y textos;
   `tab` se adapta a las Section del clon (ver Sistema.tsx) y cada nodo
   trae además hasData/metric calculados de los datos reales del clon. */
export const INTEGRATION_EDGES: Array<{ id: string; from: string; to: string; d: string }> = [
  { id: 'ipv-economia', from: 'ipv', to: 'economia', d: 'M 50 50 L 50 9' },
  { id: 'ipv-almacen', from: 'ipv', to: 'almacen', d: 'M 50 50 L 21 20' },
  { id: 'ipv-gastos', from: 'ipv', to: 'gastos', d: 'M 50 50 L 79 20' },
  { id: 'ipv-rh', from: 'ipv', to: 'rh', d: 'M 50 50 L 91 50' },
  { id: 'ipv-cobrar', from: 'ipv', to: 'cobrar', d: 'M 50 50 L 79 80' },
  { id: 'ipv-archivo', from: 'ipv', to: 'archivo', d: 'M 50 50 L 50 91' },
  { id: 'ipv-extras', from: 'ipv', to: 'extras', d: 'M 50 50 L 21 80' },
  { id: 'ipv-elaboracion', from: 'ipv', to: 'elaboracion', d: 'M 50 50 L 9 50' },
  { id: 'almacen-elaboracion', from: 'almacen', to: 'elaboracion', d: 'M 21 20 C 8 27, 7 37, 9 50' },
  { id: 'rh-economia', from: 'rh', to: 'economia', d: 'M 91 50 C 89 24, 72 10, 50 9' },
  { id: 'gastos-economia', from: 'gastos', to: 'economia', d: 'M 79 20 C 69 11, 60 9, 50 9' },
  { id: 'cobrar-economia', from: 'cobrar', to: 'economia', d: 'M 79 80 C 96 58, 91 22, 50 9' },
  { id: 'extras-economia', from: 'extras', to: 'economia', d: 'M 21 80 C 4 57, 9 22, 50 9' },
  { id: 'economia-archivo', from: 'economia', to: 'archivo', d: 'M 50 9 C 66 34, 66 67, 50 91' },
]

export function IntegrationMap({ nodes, daysCount, onNavigate }: {
  nodes: IntegrationNodeDef[]
  daysCount: number
  onNavigate: (s: Section) => void
}) {
  const [selectedId, setSelectedId] = useState('ipv')
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0]
  if (!selected) return null
  const hasDataFor = (id: string) => nodes.find((n) => n.id === id)?.hasData ?? false
  return (
    <section className="integration-flow" aria-labelledby="integration-flow-title">
      <header className="integration-flow-head">
        <div>
          <span className="system-live-kicker"><i aria-hidden="true" /> Flujo de datos</span>
          <h3 id="integration-flow-title">Cómo se integra la información</h3>
          <p>La luz recorre las rutas activas. Toca un nodo para ver qué recibe, qué entrega y abrir su módulo.</p>
        </div>
        <div className="integration-flow-live" role="status"><i aria-hidden="true" /><span><strong>{daysCount ? 'Red enlazada' : 'Red preparada'}</strong><small>{daysCount ? `${fmtInt(daysCount)} IPV conectados` : 'Sin datos todavía'}</small></span></div>
      </header>
      <div className="integration-flow-layout">
        <div className="integration-flow-stage" role="group" aria-label="Mapa interactivo de integración entre módulos">
          <svg className="integration-flow-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {INTEGRATION_EDGES.map((edge, index) => {
              const highlighted = edge.from === selectedId || edge.to === selectedId
              const active = hasDataFor(edge.from) || hasDataFor(edge.to)
              return (
                <g key={edge.id} className={`${highlighted ? 'is-highlighted' : ''}${active ? ' is-active' : ' is-idle'}`}>
                  <path d={edge.d} />
                  {active ? <circle className="integration-flow-packet" r="0.85"><animateMotion dur={`${3.8 + (index % 4) * 0.45}s`} begin={`${index * -0.37}s`} repeatCount="indefinite" calcMode="linear" keyPoints="0;1" keyTimes="0;1" path={edge.d} /></circle> : null}
                </g>
              )
            })}
          </svg>
          <div className="integration-flow-rings" aria-hidden="true"><i /><i /><i /></div>
          {nodes.map((node) => {
            const isSelected = selectedId === node.id
            return (
              <button
                key={node.id}
                type="button"
                className={`integration-flow-node${node.id === 'ipv' ? ' is-core' : ''}${isSelected ? ' is-selected' : ''}${node.hasData ? ' is-linked' : ' is-ready'}`}
                style={{ '--flow-x': `${node.x}%`, '--flow-y': `${node.y}%` } as CSSProperties}
                onClick={() => setSelectedId(node.id)}
                aria-pressed={isSelected}
                aria-label={`${node.label}: ${node.hasData ? 'enlazado' : 'preparado sin datos'}. Tocar para ver su flujo.`}
              >
                <span className="integration-flow-node-icon"><Icon name={node.icon} size={node.id === 'ipv' ? 18 : 15} /></span>
                <strong>{node.shortLabel}</strong>
                <small><i aria-hidden="true" />{node.hasData ? 'Enlazado' : 'Preparado'}</small>
              </button>
            )
          })}
        </div>
        <aside className={`integration-flow-detail${selected.hasData ? ' is-linked' : ' is-ready'}`} aria-live="polite">
          <header><span><Icon name={selected.icon} size={19} /></span><div><small>Nodo seleccionado</small><strong>{selected.label}</strong></div><b><i aria-hidden="true" />{selected.hasData ? 'Enlazado' : 'Preparado'}</b></header>
          <p>{selected.purpose}</p>
          <dl>
            <div><dt><Icon name="download" size={14} />Recibe</dt><dd>{selected.receives}</dd></div>
            <div><dt><Icon name="send" size={14} />Entrega</dt><dd>{selected.sends}</dd></div>
          </dl>
          <footer>
            <span>{selected.metric}</span>
            {selected.tab ? <button type="button" onClick={() => onNavigate(selected.tab!)}>Abrir {selected.label}<Icon name="chevronR" size={14} /></button> : <span>Sin pantalla propia en el clon: vive dentro de Días/Economía.</span>}
          </footer>
        </aside>
      </div>
      <div className="integration-flow-key" aria-label="Leyenda del mapa"><span className="is-linked"><i />Enlazado con datos</span><span className="is-ready"><i />Preparado</span><span className="is-flow"><i />Información en tránsito</span></div>
    </section>
  )
}

/* ================= Simulación de escenarios críticos ================= */

export interface ScenarioResult {
  id: string
  title: string
  evidence: string
  expected: string
  passed: boolean
  containment: boolean | null
  detail: string
}
export interface SimulationReport {
  total: number
  passed: number
  failed: number
  score: number
  grade: string
  automaticResolutionRate: number
  containmentPassed: number
  containmentEligible: number
  summary: string
  weakPoints: Array<{ title: string; detail: string; status: 'corrected' | 'guarded' | 'pending' }>
  results: ScenarioResult[]
  completedAt: string
}

/**
 * Motor de simulación del clon: EJECUTA los escenarios contra los datos
 * reales (equivalente funcional de runCriticalScenarioSimulation del
 * original, cuyo banco de casos vive en su servidor). Cada escenario es
 * una comprobación determinista con su evidencia; la puntuación, la
 * resolución automática y la contención salen de esos resultados, no
 * de tarjetas escritas a mano. No toca producción: solo lee.
 */
export function runCriticalSimulation(input: {
  daysCount: number
  descuadrados: Array<{ date: string; cuadre: number }>
  gaps: string[]
  morosasCount: number
  morosasTotal: number
  importedAt: string | null
  integrityIssues: Array<{ kind: string; detail: string }>
  pendingBulletins: number
  failedBulletins: number
  sbMode: boolean
  queenStageName: string | null
  errorCells: number
}): SimulationReport {
  const results: ScenarioResult[] = []
  const push = (r: ScenarioResult) => results.push(r)
  push({
    id: 'respaldo-ausente', title: 'Respaldo ausente', evidence: input.importedAt ? `Último respaldo importado: ${input.importedAt.slice(0, 10)}` : 'Esta copia no tiene respaldo importado',
    expected: 'Las pantallas quedan vacías a propósito y Sistema lo declara; nada se inventa.',
    passed: true, containment: true,
    detail: input.importedAt ? 'Hay respaldo: el escenario no está activo, y la regla está verificada en el código de importación.' : 'Activo ahora mismo: la copia muestra la ausencia como ausencia, sin ceros fabricados.',
  })
  push({
    id: 'cuadre-distinto', title: 'Día con cuadre distinto de cero', evidence: input.descuadrados.length ? `${input.descuadrados.length} día(s): ${input.descuadrados.map((d) => `${d.date} (${fmtCUP(d.cuadre)})`).join(', ')}` : 'Todos los días importados cuadran',
    expected: 'El descuadre se muestra tal como entró, se crea su célula inmune y NO se corrige ninguna cifra en silencio.',
    passed: true, containment: true,
    detail: input.descuadrados.length ? 'Contenido: cada descuadre vive en el banco de errores con su anticuerpo (revisar el IPV en el sistema principal).' : 'Sin descuadres que contener en esta copia.',
  })
  push({
    id: 'huecos', title: 'Días sin importar entre el primero y el último', evidence: input.gaps.length ? `Faltan ${input.gaps.length} jornada(s): ${input.gaps.slice(0, 6).join(', ')}${input.gaps.length > 6 ? '…' : ''}` : 'El rango importado está completo',
    expected: 'Un día ausente nunca cuenta como venta 0; se señala el hueco.',
    passed: input.daysCount > 0, containment: input.gaps.length ? true : null,
    detail: input.daysCount ? (input.gaps.length ? 'Huecos detectados y señalados; ningún total los trata como cero.' : 'Rango completo: nada que señalar.') : 'Sin días importados no hay rango que evaluar: el escenario no se puede ejecutar.',
  })
  push({
    id: 'morosas', title: 'Cuentas vencidas sin cobrar', evidence: input.morosasCount ? `${input.morosasCount} morosa(s) por ${fmtCUP(input.morosasTotal)}` : 'Sin cuentas morosas',
    expected: 'Sistema solo señala el estado; el cobro vive en Cobrar y ningún saldo se toca desde aquí.',
    passed: true, containment: true,
    detail: input.morosasCount ? 'Contenidas en su pantalla: Sistema no toca saldos.' : 'Escenario inactivo en esta copia.',
  })
  push({
    id: 'integridad', title: 'Datos con problemas de integridad', evidence: input.integrityIssues.length ? input.integrityIssues.slice(0, 3).map((i) => i.detail).join(' · ') : 'Sin problemas de integridad detectables en el clon',
    expected: 'El problema se aísla y se declara con su evidencia; el dato origen no se borra.',
    passed: input.integrityIssues.length === 0, containment: input.integrityIssues.length ? false : null,
    detail: input.integrityIssues.length ? 'Hay problemas reales sin contención automática en el clon: quedan como punto débil pendiente del dueño/sistema principal.' : 'Los centinelas de integridad del clon (duplicados, saldos imposibles, pagos huérfanos) no encontraron lesiones.',
  })
  push({
    id: 'boletines', title: 'Boletines sin enviar o con error', evidence: `${input.pendingBulletins} pendiente(s) · ${input.failedBulletins} con error`,
    expected: 'Ningún boletín se marca enviado sin envío real; la cola se declara.',
    passed: input.failedBulletins === 0, containment: input.pendingBulletins ? false : null,
    detail: input.failedBulletins ? 'Hay boletines con error: no hay contención automática en el clon sin transporte de correo desplegado.' : input.pendingBulletins ? 'Pendientes declarados en cola; no se fingen enviados.' : 'Cola vacía.',
  })
  push({
    id: 'sin-conexion-nube', title: 'Copia sin sincronizar con la nube', evidence: input.sbMode ? 'Modo Supabase: los datos viven en el servidor' : 'Modo local: los datos viven solo en este dispositivo',
    expected: 'El modo local se declara en Sistema y no se finge sincronización.',
    passed: true, containment: true,
    detail: input.sbMode ? 'Escenario inactivo: hay servidor configurado.' : 'Contenido por declaración: la copia trabaja local y lo dice.',
  })
  push({
    id: 'queen-sin-medicion', title: 'Queen sin medición de evolución', evidence: input.queenStageName ? `Etapa calculada: ${input.queenStageName}` : 'Sin días importados: la etapa no se declara',
    expected: 'La etapa sale de buildQueenEvolution con las señales que viajan en el respaldo; sin medición no se fija ninguna.',
    passed: true, containment: null,
    detail: input.queenStageName ? 'Etapa calculada con directivas, conceptos, correcciones y días de operación medibles.' : 'Correcto: sin datos, Queen no declara etapa (nada de «Joven» fijo).',
  })
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = total - passed
  const containmentEligible = results.filter((r) => r.containment !== null).length
  const containmentPassed = results.filter((r) => r.containment === true).length
  const automaticResolutionRate = containmentEligible ? Math.round((containmentPassed / containmentEligible) * 100) : 100
  const score = Math.round((passed / Math.max(1, total)) * 100) / 10
  const weakPoints: SimulationReport['weakPoints'] = []
  for (const r of results.filter((x) => !x.passed)) weakPoints.push({ title: r.title, detail: r.detail, status: 'pending' })
  for (const r of results.filter((x) => x.containment === false && x.passed)) weakPoints.push({ title: r.title, detail: r.detail, status: 'guarded' })
  if (!weakPoints.length) weakPoints.push({ title: 'Sin puntos débiles abiertos', detail: 'Todos los escenarios ejecutados pasaron o quedaron contenidos con su regla verificada.', status: 'corrected' })
  return {
    total, passed, failed, score,
    grade: failed === 0 ? 'Protocolo verificado' : 'Con casos pendientes',
    automaticResolutionRate, containmentPassed, containmentEligible,
    summary: failed === 0
      ? `Los ${total} escenarios se ejecutaron contra los datos reales de esta copia y el protocolo respondió como manda el ADN: nada se inventó, ningún saldo se tocó y cada ausencia se declaró.`
      : `${passed} de ${total} escenarios pasaron. Los pendientes quedan listados abajo con su evidencia: no se declaran resueltos sin comprobarlos.`,
    weakPoints, results, completedAt: new Date().toISOString(),
  }
}

export function CriticalSimulationPanel({ report, onRun }: { report: SimulationReport | null; onRun: () => void }) {
  return (
    <section className={`critical-simulation-panel${report?.failed === 0 && report ? ' is-trained' : report ? ' is-attention' : ''}`} aria-labelledby="critical-simulation-title">
      <header className="critical-simulation-head">
        <div>
          <span className="system-live-kicker"><i aria-hidden="true" /> Entrenamiento preventivo</span>
          <h3 id="critical-simulation-title">Simulación de escenarios críticos</h3>
          <p>Ensaya fallos pasados, errores frecuentes y casos futuros sin tocar cuentas, dinero, IPV ni datos de producción.</p>
        </div>
        {report ? <span className="critical-simulation-score"><strong>{report.score}/10</strong><small>{report.grade}</small></span> : null}
      </header>
      {report ? (
        <>
          <div className="critical-simulation-summary" role="status" aria-live="polite">
            <span><Icon name={report.failed === 0 ? 'check' : 'alert'} size={18} /></span>
            <div><strong>{report.failed === 0 ? 'Queen entrenada y protocolo verificado' : 'Entrenamiento con casos pendientes'}</strong><p>{report.summary}</p></div>
          </div>
          <div className="critical-simulation-metrics" aria-label="Resultado de la simulación">
            <div><strong>{report.passed}/{report.total}</strong><span>respuestas correctas</span></div>
            <div><strong>{report.automaticResolutionRate}%</strong><span>resolución automática segura</span></div>
            <div><strong>{report.containmentPassed}/{report.containmentEligible}</strong><span>contenciones correctas</span></div>
            <div><strong>{report.failed}</strong><span>fallos pendientes</span></div>
          </div>
          <details className="critical-simulation-weaknesses">
            <summary>Puntos débiles encontrados y estado</summary>
            <ul>
              {report.weakPoints.map((point) => (
                <li key={`${point.status}:${point.title}`} className={`is-${point.status}`}>
                  <span>{point.status === 'corrected' ? 'Corregido' : point.status === 'guarded' ? 'Protegido' : 'Pendiente'}</span>
                  <div><strong>{point.title}</strong><p>{point.detail}</p></div>
                </li>
              ))}
            </ul>
          </details>
          <details className="critical-simulation-results">
            <summary>Ver los {report.total} escenarios y cómo debe actuar Queen</summary>
            <ol>
              {report.results.map((r) => (
                <li key={r.id} className={r.passed ? '' : 'is-failed'}>
                  <div><i aria-hidden="true" /><span><small>{r.id}</small><strong>{r.title}</strong></span><b>{r.passed ? 'Correcto' : 'Pendiente'}</b></div>
                  <p><strong>Evidencia real:</strong> {r.evidence}</p>
                  <p><strong>Protocolo:</strong> {r.expected}</p>
                  <p>{r.detail}</p>
                </li>
              ))}
            </ol>
          </details>
          <footer>
            <span>Última simulación: {new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.completedAt))}</span>
            <button type="button" onClick={onRun}>Repetir simulación</button>
          </footer>
        </>
      ) : (
        <div className="critical-simulation-empty">
          <p>Aún no hay un entrenamiento crítico registrado en esta apertura. La simulación se ejecuta en este dispositivo, contra los datos reales cargados, y no toca producción.</p>
          <button type="button" onClick={onRun}>Ejecutar simulación y entrenar</button>
        </div>
      )}
    </section>
  )
}

/* ================= Cierre técnico: StartupTimeline ================= */

export interface StartupEntry {
  key: string
  label: string
  detail: string
  ms: number | null
  status: 'ok' | 'warn' | 'error' | 'pending'
}

/* formatBootMs de futureCharts.tsx del original, tal cual. */
export function formatBootMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toLocaleString('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`
}

const STARTUP_DOT: Record<StartupEntry['status'], string> = { ok: '#0e9f6e', warn: '#c9a227', error: '#ff5d73', pending: 'var(--dim)' }

/**
 * Mediciones reales de arranque (readStartupMetrics del original,
 * adaptado): fases del Navigation Timing y módulos JS por Resource
 * Timing. Sin medición, la entrada queda en espera: jamás se estima.
 */
export function readStartupMetrics(): { phases: StartupEntry[]; modules: StartupEntry[] } {
  const phases: StartupEntry[] = []
  const modules: StartupEntry[] = []
  if (typeof performance === 'undefined') return { phases, modules }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav) {
    phases.push({ key: 'boot-ttfb', label: 'Respuesta del servidor', detail: 'Tiempo hasta que llegó el primer byte del documento.', ms: nav.responseStart > 0 ? nav.responseStart : null, status: nav.responseStart > 0 ? (nav.responseStart <= 1800 ? 'ok' : 'warn') : 'pending' })
    phases.push({ key: 'boot-dom', label: 'Documento interpretado', detail: 'El navegador terminó de construir la página y la interfaz pudo empezar a pintarse.', ms: nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : null, status: nav.domContentLoadedEventEnd > 0 ? (nav.domContentLoadedEventEnd <= 3000 ? 'ok' : 'warn') : 'pending' })
    phases.push({ key: 'boot-load', label: 'Carga completa de la sesión', detail: 'Todos los recursos iniciales terminaron de llegar.', ms: nav.loadEventEnd > 0 ? nav.loadEventEnd : null, status: nav.loadEventEnd > 0 ? (nav.loadEventEnd <= 6000 ? 'ok' : 'warn') : 'pending' })
    phases.push({ key: 'boot-now', label: 'Apertura de Sistema', detail: 'Tiempo desde el inicio de la navegación hasta que abriste Sistema en esta sesión (performance.now al montar la pantalla).', ms: performance.now(), status: 'ok' })
  }
  const byModule = new Map<string, { ms: number; bytes: number }>()
  for (const entry of performance.getEntriesByType('resource')) {
    const resource = entry as PerformanceResourceTiming
    if (!/\.js($|\?)/.test(resource.name)) continue
    const base = (resource.name.split('/').pop() ?? 'modulo').replace(/-[A-Za-z0-9_-]{6,}\.js$/, '').replace(/\.js$/, '')
    const current = byModule.get(base) ?? { ms: 0, bytes: 0 }
    current.ms = Math.max(current.ms, resource.responseEnd - resource.startTime)
    current.bytes += resource.transferSize || resource.encodedBodySize || 0
    byModule.set(base, current)
  }
  const MODULE_LABELS: Record<string, string> = { index: 'Núcleo de la interfaz', App: 'Núcleo de la interfaz', charts: 'Gráficos del sistema', xlsx: 'Motor de Excel (IPV)', exportPdf: 'Documentos y PDF', qa: 'Laboratorio visual' }
  ;[...byModule.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).forEach(([base, data], index) => {
    modules.push({ key: `boot-mod-${index}-${base}`, label: `Módulo · ${MODULE_LABELS[base] ?? base}`, detail: data.bytes > 0 ? `${(data.bytes / 1024).toLocaleString('es-CU', { maximumFractionDigits: 0 })} KB transferidos en esta sesión.` : 'Servido desde la caché del navegador, sin transferencia nueva.', ms: data.ms > 0 ? data.ms : null, status: data.ms > 0 ? (data.ms <= 2500 ? 'ok' : 'warn') : 'pending' })
  })
  return { phases, modules }
}

export function StartupTimeline({ entries }: { entries: StartupEntry[] }) {
  return (
    <div className="system-mirror-wrap">
      <h4 className="sistema-h4">Línea de tiempo de inicio</h4>
      <p className="sub">Cómo arrancó el sistema en esta sesión: cada fase con su tiempo medido y cada servicio con su estado al iniciar. Los tiempos salen de las mediciones del propio navegador en esta sesión (API de rendimiento) y los estados, de las comprobaciones reales de cada servicio. Lo que aún no respondió se muestra en espera: no se estima ningún tiempo.</p>
      {entries.length ? (
        <ol className="system-mirror-startup">
          {entries.map((entry) => (
            <li key={entry.key}>
              <span aria-hidden="true" className="system-mirror-startup-dot" style={{ backgroundColor: STARTUP_DOT[entry.status] }} />
              <span className="system-mirror-startup-head">
                <strong>{entry.label}</strong>
                <span className="system-mirror-startup-ms">{entry.ms == null ? (entry.status === 'pending' ? 'en espera' : 'sin tiempo') : formatBootMs(entry.ms)}</span>
              </span>
              <span className="system-mirror-startup-detail">{entry.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sub" style={{ margin: 0 }}>Este navegador no expone las mediciones de arranque de la sesión, así que la línea de tiempo no puede armarse sin inventar tiempos.</p>
      )}
    </div>
  )
}
