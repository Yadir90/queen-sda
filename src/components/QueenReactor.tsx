/* Icono oficial de Queen: «Reactor Evolutivo».
   Port fiel de QueenReactorMark (client/src/futureCharts.tsx del sistema
   original, diseño aprobado por el dueño el 2026-10-18): el MISMO reactor
   crece con la etapa — Embrión (verde #22C55E), Infante (azul #3B82F6),
   Joven (rojo #F0564F, etapa de referencia actual), Adulto (amarillo
   #EAB308), Maduro (malva #C084FC). Sin disco de fondo en claro ni en
   oscuro, sin satélites ni círculos sobre el borde, sin halo: el color
   es el de la etapa en TODA la marca. La animación es solo giro de los
   anillos (transform) y opacidad interna del núcleo; el estado solo
   acelera el giro. CSS en index.css (.queen-reactor-*). */

import { useId } from 'react'

export type ReactorStageId = 'celula' | 'infante' | 'juvenil' | 'adulto' | 'maduro'
export type ReactorState = 'idle' | 'thinking' | 'composing' | 'suggestion' | 'positive' | 'alert'
export type ReactorHealth = 'healthy' | 'warning' | 'error' | 'working' | 'expectant'

export const QUEEN_REACTOR_STAGES: Record<ReactorStageId, { color: string; light: string; label: string }> = {
  celula: { color: '#22C55E', light: '#86EFAC', label: 'Embrión' },
  infante: { color: '#3B82F6', light: '#93C5FD', label: 'Infante' },
  juvenil: { color: '#F0564F', light: '#FF999E', label: 'Joven' },
  adulto: { color: '#EAB308', light: '#FDE047', label: 'Adulto' },
  maduro: { color: '#C084FC', light: '#D8B4FE', label: 'Maduro' },
}

/** Etapa actual registrada de Queen: Joven. */
export const QUEEN_STAGE: ReactorStageId = 'juvenil'

export function QueenReactorMark({ stageId, state = 'idle', health = 'healthy', size = 48 }: { stageId: ReactorStageId; state?: ReactorState; health?: ReactorHealth; size?: number }) {
  const reactor = QUEEN_REACTOR_STAGES[stageId]
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '')
  // Sin aro de señal: el estado solo acelera el giro de los anillos.
  const busy = state === 'thinking' || state === 'composing' || health === 'working'
  const coreStops: Array<[string, string]> = stageId === 'celula'
    ? [['0%', '#FFFFFF'], ['30%', '#FFFFFF'], ['62%', reactor.light], ['100%', reactor.color]]
    : stageId === 'infante'
      ? [['0%', '#FFFFFF'], ['38%', '#FFFFFF'], ['70%', reactor.light], ['100%', reactor.color]]
      : stageId === 'adulto'
        ? [['0%', '#FFFFFF'], ['62%', '#FFFFFF'], ['86%', reactor.light], ['100%', reactor.color]]
        : stageId === 'maduro'
          ? [['0%', '#FFFFFF'], ['45%', '#FFFFFF'], ['76%', reactor.light], ['100%', reactor.color]]
          : [['0%', '#FFFFFF'], ['46%', '#FFFFFF'], ['74%', reactor.light], ['100%', reactor.color]]
  const coreRadius = stageId === 'celula' ? 4.4 : stageId === 'infante' ? 5.2 : stageId === 'adulto' ? 6.6 : stageId === 'maduro' ? 7.6 : 5.9
  const corePulseClass = stageId === 'celula' ? ' queen-reactor-core-pulse-slow' : stageId === 'infante' ? ' queen-reactor-core-pulse-soft' : stageId === 'juvenil' ? ' queen-reactor-core-pulse-vibrant' : ''
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="queen-reactor-mark" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`qcore-${gid}`} cx="50%" cy="50%" r="50%">
          {coreStops.map(([offset, stopColor]) => (
            <stop key={offset} offset={offset} stopColor={stopColor} />
          ))}
        </radialGradient>
      </defs>
      {stageId === 'celula' && (
        /* Embrión: un solo anillo tenue, girando muy lento. */
        <g className="queen-reactor-ring slow">
          <circle cx="24" cy="24" r="16.8" fill="none" stroke={reactor.color} strokeWidth="2" strokeDasharray="26 7 18 8 22 9" opacity="0.55" />
        </g>
      )}
      {stageId === 'infante' && (
        /* Infante: dos anillos de arcos con rotación pausada. */
        <>
          <g className={`queen-reactor-ring rev calm${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="18.2" fill="none" stroke={reactor.color} strokeWidth="2.4" strokeDasharray="28 6.5 17 5.5 24 7.5 20 6" opacity="0.82" />
          </g>
          <g className={`queen-reactor-ring calm${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="11.7" fill="none" stroke={reactor.color} strokeWidth="1.8" strokeDasharray="20 5.5 13 5 16 14" opacity="0.75" />
          </g>
        </>
      )}
      {stageId === 'juvenil' && (
        /* Joven: el reactor completo — aro grueso de arcos y aro
           interior, girando al revés (el diseño vigente). */
        <>
          <g className={`queen-reactor-ring rev${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="18.2" fill="none" stroke={reactor.color} strokeWidth="3" strokeDasharray="28 6.5 17 5.5 24 7.5 20 6" opacity="0.95" />
          </g>
          <g className={`queen-reactor-ring rev${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="11.7" fill="none" stroke={reactor.color} strokeWidth="2.1" strokeDasharray="20 5.5 13 5 16 14" opacity="0.9" />
          </g>
        </>
      )}
      {stageId === 'adulto' && (
        /* Adulto: doble capa de anillos con estelas de luz. */
        <>
          <g className={`queen-reactor-ring rev${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="20.6" fill="none" stroke={reactor.light} strokeWidth="2.6" strokeDasharray="12 117" opacity="0.38" />
            <circle cx="24" cy="24" r="20.6" fill="none" stroke={reactor.color} strokeWidth="2.2" strokeDasharray="30 7 18 6 24 8 20 6.4" opacity="0.95" />
            <circle cx="24" cy="24" r="17.2" fill="none" stroke={reactor.light} strokeWidth="2.2" strokeDasharray="9 99" opacity="0.32" />
            <circle cx="24" cy="24" r="17.2" fill="none" stroke={reactor.color} strokeWidth="2.6" strokeDasharray="24 6 15 5 20 7 17 5.1" opacity="0.92" />
          </g>
          <g className={`queen-reactor-ring rev${busy ? ' fast' : ''}`}>
            <circle cx="24" cy="24" r="12.6" fill="none" stroke={reactor.color} strokeWidth="1.7" strokeDasharray="20 5.5 13 5 16 14.7" opacity="0.88" />
            <circle cx="24" cy="24" r="10" fill="none" stroke={reactor.color} strokeWidth="1.4" strokeDasharray="14 5 10 4 12 17.8" opacity="0.8" />
          </g>
        </>
      )}
      {stageId === 'maduro' && (
        /* Maduro: órbitas COMPLETAS (círculos enteros, sin arcos ni
           puntos) y una elipse inclinada que gira muy lento. */
        <>
          <g className="queen-reactor-ring orbit">
            <circle cx="24" cy="24" r="21.6" fill="none" stroke={reactor.color} strokeWidth="1.3" opacity="0.85" />
          </g>
          <g className="queen-reactor-ring orbit rev">
            <ellipse cx="24" cy="24" rx="19.4" ry="8.4" transform="rotate(-18 24 24)" fill="none" stroke={reactor.light} strokeWidth="1.2" opacity="0.75" />
          </g>
          <g className="queen-reactor-ring orbit">
            <circle cx="24" cy="24" r="14.2" fill="none" stroke={reactor.color} strokeWidth="1.1" opacity="0.6" />
          </g>
        </>
      )}
      {/* Núcleo: su tamaño, su luz y su pulso interno son los de la etapa. */}
      <g className={`queen-reactor-core${corePulseClass}`}>
        <circle cx="24" cy="24" r={coreRadius} fill={`url(#qcore-${gid})`} />
        {stageId === 'maduro' && <circle cx="21.3" cy="21.1" r="2.3" fill="#FFFFFF" opacity="0.85" />}
      </g>
    </svg>
  )
}

/** El orbe de la navegación: la marca a 35px (27px en la lateral),
 *  SIN cápsula de fondo ni aro alrededor, con sombra neutra tenue. */
export function QueenOrb({ size = 35, stageId = QUEEN_STAGE, state = 'idle' }: { size?: number; stageId?: ReactorStageId; state?: ReactorState }) {
  return (
    <span className="queen-orb" style={{ width: size, height: size }} aria-hidden="true">
      <QueenReactorMark stageId={stageId} state={state} size={size} />
    </span>
  )
}
