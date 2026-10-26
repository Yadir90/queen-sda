/* Orbe de voz de Queen (acabado del dueño, 2026-10-26 14:36):
 * el botón para hablar con Queen NO es un micrófono genérico — es
 * un orbe con la identidad del sistema: fondo aurora (esmeralda →
 * turquesa → azul → violeta suave), el núcleo del Reactor de Queen
 * y cinco barras de onda. Tres estados, gobernados por la voz REAL
 * del dispositivo (los eventos del reconocimiento y de la síntesis),
 * nunca por temporizadores decorativos:
 *  - idle: respiración lenta del orbe, barras en reposo.
 *  - listening: anillos que pulsan hacia fuera mientras el dueño habla.
 *  - speaking: las barras bailan como una onda mientras la síntesis
 *    lee la respuesta; arranca con utterance.onstart y se detiene
 *    con onend/onerror (lib/queenVoice.speakQueen).
 * Ligero para el Galaxy A16: solo transform/opacity en SVG, sin
 * desenfoques; la pausa global del sistema (segundo plano,
 * html[data-queen-motion="paused"]) lo detiene como a todo lo demás. */

export type QueenVoiceState = 'idle' | 'listening' | 'speaking'

const BARS = [0, 1, 2, 3, 4]
const BAR_HEIGHTS = [10, 16, 22, 16, 10]

export default function QueenVoiceOrb({ size = 30, state = 'idle' }: { size?: number; state?: QueenVoiceState }) {
  return (
    <svg
      className={`qv-orb qv-orb--${state}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="qv-aurora" cx="32%" cy="28%" r="85%">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="34%" stopColor="#2dd4bf" />
          <stop offset="62%" stopColor="#38bdf8" />
          <stop offset="84%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </radialGradient>
        <radialGradient id="qv-core" cx="42%" cy="38%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#ccfbf1" />
          <stop offset="100%" stopColor="#99f6e4" />
        </radialGradient>
      </defs>
      <circle className="qv-halo" cx="24" cy="24" r="21.5" fill="none" stroke="url(#qv-aurora)" strokeWidth="1.6" />
      <circle className="qv-ring qv-ring--a" cx="24" cy="24" r="21.5" fill="none" stroke="#2dd4bf" strokeWidth="1.4" />
      <circle className="qv-ring qv-ring--b" cx="24" cy="24" r="21.5" fill="none" stroke="#818cf8" strokeWidth="1.4" />
      <circle className="qv-disc" cx="24" cy="24" r="20" fill="url(#qv-aurora)" />
      <circle className="qv-core" cx="24" cy="24" r="3.4" fill="url(#qv-core)" />
      <g className="qv-bars">
        {BARS.map((i) => (
          <rect
            key={i}
            className="qv-bar"
            style={{ ['--i' as string]: i }}
            x={13.4 + i * 4.6}
            y={24 - BAR_HEIGHTS[i] / 2}
            width="2.9"
            height={BAR_HEIGHTS[i]}
            rx="1.45"
            fill="#ffffff"
            fillOpacity="0.92"
          />
        ))}
      </g>
    </svg>
  )
}
