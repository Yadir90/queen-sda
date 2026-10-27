import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { StoredData } from '../types'
import { Icon } from '../components/icons'
import { QueenOrb, QueenReactorMark, QUEEN_REACTOR_STAGES } from '../components/QueenReactor'
import QueenVoiceOrb from '../components/QueenVoiceOrb'
import { MediaImage } from '../components/MediaImage'
import { fmtInt, todayISO } from '../lib/utils'
import { logActivity } from '../lib/activityLog'
import {
  answerQueen, applyQueenLearnedCorrections, buildQueenAnticipations, buildQueenErrorBank,
  buildQueenEvolution, buildQueenHealth, buildQueenMemory, buildQueenObservations,
  buildQueenOperationModes, buildQueenSmsDue, buildQueenSuggestions, deriveQueenAnswerMeta,
  fmtQueenCUP, queenLanguageStatus, queenQuestionPattern, QUEEN_HEALTH_COPY,
  type QueenAnswer, type QueenLearnedCorrection,
} from '../lib/queenCore.mjs'
import type { QueenChatResult } from '../lib/supabaseBackend'
import {
  recognitionSupported, synthesisSupported, startRecognition,
  speakQueen, stopQueenSpeech, type RecognitionHandle,
} from '../lib/queenVoice'
import '../components/queenMirror.css'

/* Consola de Queen — puerto de QueenTab + QueenThread + QueenComposer
   del SDA original (client/src/App.tsx) con sus clases de theme.css
   portadas tal cual a components/queenMirror.css. NO es una página
   de tarjetas: cabecera propia con el orbe Reactor en su etapa
   CALCULADA y su salud, barra de chips que abre UN panel cada vez
   (Anticipación · Sugerencias · SMS · Memoria, con contadores
   reales), hilo con cita, «Cómo lo comprobé», tarjetas accionables
   y feedback con corrección aprendida, y composer fijo con
   preguntas rápidas en popover junto a la entrada.
   Persistencia (equivalente honesto a loadQueenState/queen-draft
   del original en este clon sin backend de chat): localStorage
   «queen-chat» (hilo, últimos 30), «queen-freq» (patrones),
   «queen-draft» (borrador), «queen-feedback-local-v1» (feedback),
   «queen-sda-corrections-v1» (correcciones aprendidas del feedback)
   y «queen-sda-suggestion-status-v1» (estados de la bandeja).
   El determinista (queenCore) responde siempre; la capa de lenguaje
   (Edge Function queen-chat) solo redacta en modo Supabase.
   AÑADIDO DEL DUEÑO en esta copia (2026-10-26): la VOZ en tiempo
   real (lib/queenVoice) — micrófono Web Speech en español sobre
   este mismo chat y lectura de las respuestas con la voz del
   dispositivo. No es paridad: en el sistema original Queen es
   100 % texto. La voz nunca bloquea el chat de texto. */

interface QueenReplyRef { role: 'user' | 'queen'; text: string; key: string }
interface QueenMsg {
  role: 'user' | 'queen'
  text: string
  key?: string
  ts?: number
  replyTo?: QueenReplyRef
  answer?: QueenAnswer
  feedback?: 'util' | 'no-util' | 'corregida'
}
type Panel = 'ninguno' | 'anticipacion' | 'sugerencias' | 'sms' | 'memoria'
type SuggestionStatus = 'nuevo' | 'revision' | 'resuelto' | 'no-error'
const SUGGESTION_LABEL: Record<SuggestionStatus, string> = { nuevo: 'Nuevo', revision: 'En revisión', resuelto: 'Resuelto', 'no-error': 'No es un error' }
interface LanguageTry { state: 'idle' | 'busy' | 'done'; text?: string; provider?: string; reason?: string }

function loadQueenState(): { msgs: QueenMsg[]; freq: Record<string, number> } {
  try {
    const msgs = JSON.parse(localStorage.getItem('queen-chat') ?? '[]') as QueenMsg[]
    const freq = JSON.parse(localStorage.getItem('queen-freq') ?? '{}') as Record<string, number>
    const ordered = Array.isArray(msgs) ? msgs.slice(-30).map((m, index) => (typeof m.ts === 'number' ? m : { ...m, ts: index })) : []
    return { msgs: ordered, freq: freq && typeof freq === 'object' ? freq : {} }
  } catch { return { msgs: [], freq: {} } }
}
function loadJSON<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; return v ?? fallback } catch { return fallback }
}
function saveJSON(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* sin almacenamiento */ } }

/* ============ QueenThread (puerto del original, memo) ============ */
const QueenThread = memo(function QueenThread(props: {
  shown: QueenMsg[]
  sending: boolean
  stageId: 'celula' | 'infante' | 'juvenil' | 'adulto' | 'maduro'
  threadRef: React.RefObject<HTMLDivElement | null>
  onReply: (message: QueenMsg, messageKey: string) => void
  onFeedback: (messageKey: string, helpful: boolean, correction?: string) => void
  onAsk: (question: string) => void
}) {
  return (
    <div ref={props.threadRef} className="queen-thread" aria-label="Conversación con Queen" aria-live="polite">
      <div className="queenm-stack">
        {props.shown.map((m, i) => {
          const messageKey = m.key ?? `${m.role}-${i}-${m.text.slice(0, 48)}`
          const quoted = m.replyTo
          const meta = m.role === 'queen' && m.answer ? deriveQueenAnswerMeta(m.answer) : null
          return m.role === 'user' ? (
            <div key={messageKey} className="queen-message-row queen-message-row-user">
              <div className="queenm-minw0 queen-message-content queen-message-content-user" style={{ maxWidth: 'min(82%, 680px)' }}>
                <div className="queen-bubble queen-bubble-user">
                  {quoted && (<div className="queen-reply-quote"><strong>{quoted.role === 'queen' ? 'Queen' : 'Tú'}</strong><span>{quoted.text}</span></div>)}
                  {m.text}
                </div>
                <button type="button" onClick={() => props.onReply(m, messageKey)} className="queen-reply-action" aria-label={`Responder a tu mensaje: ${m.text.slice(0, 80)}`}>
                  <Icon name="message" size={14} /> Responder
                </button>
              </div>
              {/* Foto de perfil del usuario desde la media autenticada ('foto-perfil' · perfil-admin); sin foto, la inicial «T», con las medidas del original. No se inventa foto. */}
              <MediaImage
                kind="foto-perfil" entityKey="perfil-admin" alt="Tu foto de perfil"
                className="queen-user-initials" style={{ objectFit: 'cover', padding: 0 }}
                fallback={<span className="queen-user-initials" aria-label="Tu avatar">T</span>}
              />
            </div>
          ) : (
            <div key={messageKey} className="queen-message-row queen-message-row-queen">
              <span className="queen-bubble-avatar"><QueenOrb size={26} stageId={props.stageId} /></span>
              <div className="queenm-minw0 queen-message-content" style={{ maxWidth: 'min(82%, 680px)' }}>
                <span className="queen-bubble-name">Queen</span>
                <div className="queen-bubble queen-bubble-queen">
                  {quoted && (<div className="queen-reply-quote"><strong>{quoted.role === 'queen' ? 'Queen' : 'Tú'}</strong><span>{quoted.text}</span></div>)}
                  {m.text}
                </div>
                {meta && m.answer && (
                  <details className="queen-reasoning">
                    <summary><span>Cómo lo comprobé</span><b className={`is-${meta.confidence}`}>Confianza {meta.confidence}</b></summary>
                    <p>{meta.confidenceReason}</p>
                    <ol>{meta.reasoningSteps.map((step, stepIndex) => <li key={`${messageKey}-step-${stepIndex}`}>{step}</li>)}</ol>
                    {(m.answer.verifiedAgainst.length || m.answer.unverified.length) ? (
                      <p>Verificado contra: {m.answer.verifiedAgainst.length ? m.answer.verifiedAgainst.join(' · ') : '—'} · Sin verificar: {m.answer.unverified.length ? m.answer.unverified.join(' · ') : 'nada'}</p>
                    ) : null}
                    {!!meta.dataUsed.length && <div className="queen-data-used"><strong>Datos usados</strong>{meta.dataUsed.map((item) => <span key={item}>{item}</span>)}</div>}
                  </details>
                )}
                {meta?.connectedInsight && <button type="button" className="queen-insight-card" onClick={() => props.onAsk(meta.connectedInsight ?? '')}><strong>Conexión entre datos</strong><span>{meta.connectedInsight}</span></button>}
                {meta?.proactiveSuggestion && <button type="button" className="queen-insight-card is-proactive" onClick={() => props.onAsk(meta.proactiveSuggestion ?? '')}><strong>Queen propone</strong><span>{meta.proactiveSuggestion}</span></button>}
                {meta?.followUp && <button type="button" className="queen-followup" onClick={() => props.onAsk(meta.followUp ?? '')}>{meta.followUp}</button>}
                <div className="queen-message-actions">
                  <button type="button" onClick={() => props.onReply(m, messageKey)} className="queen-reply-action" aria-label={`Responder al mensaje de Queen: ${m.text.slice(0, 80)}`}>
                    <Icon name="message" size={14} /> Responder
                  </button>
                  {m.key && !m.feedback && <><span>¿Te sirvió?</span><button type="button" onClick={() => props.onFeedback(messageKey, true)} className="queen-feedback-chip">Sí</button><button type="button" onClick={() => props.onFeedback(messageKey, false)} className="queen-feedback-chip">No</button></>}
                  {m.feedback && <span className="queen-feedback-done">{m.feedback === 'util' ? 'Me sirvió' : m.feedback === 'corregida' ? 'Corrección aprendida' : 'Lo revisaré mejor'}</span>}
                </div>
                {m.key && m.feedback === 'no-util' && (
                  <form className="queen-correction-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const correction = String(form.get('correction') ?? '').trim(); if (correction) props.onFeedback(messageKey, false, correction) }}>
                    <label><span>¿Cómo debo tratarlo la próxima vez?</span><input name="correction" maxLength={1000} required placeholder="Escribe la corrección exacta" /></label>
                    <button type="submit">Aprender corrección</button>
                  </form>
                )}
              </div>
            </div>
          )
        })}
        {props.sending && (
          <div className="queen-message-row queen-message-row-queen" role="status" aria-live="polite" aria-label="Queen está procesando la respuesta y escribiendo">
            <span className="queen-bubble-avatar"><QueenOrb size={26} stageId={props.stageId} state="thinking" /></span>
            <div className="queenm-minw0 queen-message-content">
              <span className="queen-bubble-name">Queen</span>
              <div className="queen-bubble queen-bubble-queen queen-typing">
                <span className="queen-typing-dots" aria-hidden="true"><span /><span /><span /></span>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>Queen está procesando la respuesta y escribiendo</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

/* ============ QueenComposer (puerto del original) ============ */
function QueenComposer(props: {
  sending: boolean
  quickOpen: boolean
  hasQuickActions: boolean
  onToggleQuick: () => void
  onSend: (text: string, replyTo?: QueenReplyRef) => void
  onHasTextChange: (hasText: boolean) => void
  replyTo: QueenReplyRef | null
  onCancelReply: () => void
  /** Voz (añadido del dueño): null si el navegador no reconoce voz. */
  voice: { listening: boolean; speaking: boolean; onMicToggle: () => void } | null
}) {
  const [text, setText] = useState(() => { try { return localStorage.getItem('queen-draft') ?? '' } catch { return '' } })
  const inputRef = useRef<HTMLInputElement>(null)
  const hasRef = useRef(false)
  useEffect(() => { if (props.replyTo) inputRef.current?.focus() }, [props.replyTo?.key])
  const reportHas = (value: string) => {
    const has = value.trim().length > 0
    if (has !== hasRef.current) { hasRef.current = has; props.onHasTextChange(has) }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = text
    if (!value.trim() || props.sending) return
    setText('')
    try { localStorage.removeItem('queen-draft') } catch { /* noop */ }
    if (hasRef.current) { hasRef.current = false; props.onHasTextChange(false) }
    const reply = props.replyTo ?? undefined
    props.onCancelReply()
    props.onSend(value, reply)
  }
  return (
    <>
      {props.replyTo && (
        <div className="queen-composer-reply" role="status" aria-label={`Respondiendo a ${props.replyTo.role === 'queen' ? 'Queen' : 'tu mensaje'}`}>
          <div className="queenm-minw0" style={{ display: 'grid', gap: 2, flex: 1 }}>
            <strong>Respondiendo a {props.replyTo.role === 'queen' ? 'Queen' : 'ti'}</strong>
            <span>{props.replyTo.text}</span>
          </div>
          <button type="button" onClick={props.onCancelReply} aria-label="Cancelar respuesta citada"><Icon name="x" size={17} /></button>
        </div>
      )}
      <form onSubmit={submit} className="queen-composer">
        <button type="button" disabled={props.sending || !props.hasQuickActions} onClick={props.onToggleQuick} aria-label={props.quickOpen ? 'Cerrar preguntas rápidas' : 'Abrir preguntas rápidas'} aria-expanded={props.quickOpen} aria-controls="queen-quick-options" className="queen-composer-tool">
          <Icon name={props.quickOpen ? 'x' : 'plus'} size={20} />
        </button>
        <label htmlFor="queen-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>Pregúntale a Queen</label>
        <input ref={inputRef} id="queen-input" type="text" lang="es" spellCheck value={text} maxLength={1000} className="queen-composer-input" placeholder="Mensaje a Queen"
          onChange={(e) => { setText(e.target.value); try { localStorage.setItem('queen-draft', e.target.value) } catch { /* noop */ } reportHas(e.target.value) }} />
        {props.voice && (
          <button type="button" disabled={props.sending} onClick={props.voice.onMicToggle} aria-pressed={props.voice.listening}
            aria-label={props.voice.speaking ? 'Queen está hablando' : props.voice.listening ? 'Detener la escucha y enviar lo dicho' : 'Hablar con Queen por micrófono'}
            title={props.voice.speaking ? 'Queen está hablando…' : props.voice.listening ? 'Escuchando… toca para enviar' : 'Hablar'} className={`queen-composer-tool queen-mic-btn${props.voice.listening ? ' is-listening' : ''}${props.voice.speaking ? ' is-speaking' : ''}`}>
            <QueenVoiceOrb size={30} state={props.voice.speaking ? 'speaking' : props.voice.listening ? 'listening' : 'idle'} />
          </button>
        )}
        <button type="submit" disabled={props.sending || !text.trim()} aria-label={props.sending ? 'Queen está pensando' : 'Enviar mensaje a Queen'} title="Enviar" className="queen-send-btn">
          <Icon name="send" size={19} />
        </button>
      </form>
    </>
  )
}

/* ============ QueenTab (puerto del original) ============ */
export default function QueenScreen({ data, supabaseMode, onTestLanguage, chatOnly = false }: {
  data: StoredData
  supabaseMode: boolean
  onTestLanguage?: (question: string, figures: Array<{ label: string; value: number | string }>) => Promise<QueenChatResult>
  chatOnly?: boolean
}) {
  const ref = todayISO()
  const evo = useMemo(() => buildQueenEvolution(data, ref), [data, ref])
  const memory = useMemo(() => buildQueenMemory(data), [data])
  const bank = useMemo(() => buildQueenErrorBank(data), [data])
  const modes = useMemo(() => buildQueenOperationModes(data), [data])
  const seeing = useMemo(() => buildQueenObservations(data, ref), [data, ref])
  const suggestions = useMemo(() => buildQueenSuggestions(data, ref), [data, ref])
  const smsDue = useMemo(() => buildQueenSmsDue(data, ref), [data, ref])
  const baseHealth = useMemo(() => buildQueenHealth(data, ref), [data, ref])
  const lang = useMemo(() => queenLanguageStatus(supabaseMode), [supabaseMode])

  const [{ msgs, freq }, setState] = useState(loadQueenState)
  const [feedbackByKey, setFeedbackByKey] = useState<Record<string, NonNullable<QueenMsg['feedback']>>>(() => loadJSON('queen-feedback-local-v1', {}))
  const [learnedCorrections, setLearnedCorrections] = useState<QueenLearnedCorrection[]>(() => loadJSON('queen-sda-corrections-v1', []))
  const [suggestionStatus, setSuggestionStatus] = useState<Record<string, SuggestionStatus>>(() => loadJSON('queen-sda-suggestion-status-v1', {}))
  const [panel, setPanel] = useState<Panel>('ninguno')
  /* Matriz de Yan (dueño, 2026-10-26): con chatOnly, Queen es SOLO
     el chat — sin barra de paneles ni panel alguno (anticipación,
     sugerencias, SMS, memoria): el panel efectivo queda cerrado. */
  const effectivePanel: Panel = chatOnly ? 'ninguno' : panel
  const [quickOpen, setQuickOpen] = useState(false)
  const [replyTarget, setReplyTarget] = useState<QueenReplyRef | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasText, setHasText] = useState(false)
  const [chatNotice, setChatNotice] = useState('')
  const [smsTab, setSmsTab] = useState<'enviados' | 'pendientes' | 'cancelados' | 'reenvios'>('pendientes')
  const [smsNotice, setSmsNotice] = useState('')
  const [languageTry, setLanguageTry] = useState<LanguageTry>({ state: 'idle' })
  const [composerKey, setComposerKey] = useState(0)
  const sendingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastAnswer = useRef<{ question: string; answer: QueenAnswer } | null>(null)
  const handleHasText = useCallback((h: boolean) => setHasText(h), [])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  /* ===== Voz en tiempo real (AÑADIDO DEL DUEÑO, 2026-10-26) =====
     Capa sobre este mismo chat: el micrófono transcribe y el texto
     se envía con el send de siempre; la lectura en voz alta lee la
     respuesta de Queen (la de siempre), nunca la interfaz. Por
     defecto se pulsa para hablar; el modo conversación vuelve a
     escuchar tras cada respuesta leída. Si el navegador no soporta
     una pieza, esa pieza no aparece y el chat sigue como siempre. */
  const recogOk = useMemo(() => recognitionSupported(), [])
  const synthOk = useMemo(() => synthesisSupported(), [])
  const [ttsOn, setTtsOn] = useState<boolean>(() => loadJSON('queen-voice-tts-v1', false))
  const [convMode, setConvMode] = useState<boolean>(() => loadJSON('queen-voice-conv-v1', false))
  const [listening, setListening] = useState(false)
  /* «Hablando» lo mandan los eventos reales de la síntesis
     (onstart/onend de speakQueen): el orbe de voz anima solo
     mientras la lectura suena de verdad. */
  const [speaking, setSpeaking] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceMsg, setVoiceMsg] = useState('')
  const recogRef = useRef<RecognitionHandle | null>(null)
  const convRef = useRef(convMode)
  convRef.current = convMode
  const ttsRef = useRef(ttsOn)
  ttsRef.current = ttsOn
  const sendRef = useRef<(text: string) => void>(() => {})
  const spokenKeysRef = useRef<Set<string> | null>(null)
  const prevSendingRef = useRef(false)
  useEffect(() => { saveJSON('queen-voice-tts-v1', ttsOn) }, [ttsOn])
  useEffect(() => { saveJSON('queen-voice-conv-v1', convMode) }, [convMode])

  const stopListening = useCallback((cancel = false) => {
    const handle = recogRef.current
    recogRef.current = null
    if (handle) { if (cancel) handle.abort(); else handle.stop() }
    setListening(false)
    setInterim('')
  }, [])

  const startListening = useCallback(() => {
    if (!recogOk || recogRef.current || sendingRef.current) return
    setVoiceMsg('')
    setInterim('')
    const handle = startRecognition({
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        recogRef.current = null
        setListening(false)
        setInterim('')
        sendRef.current(text)
      },
      onError: (message) => {
        recogRef.current = null
        setListening(false)
        setInterim('')
        // El aviso queda visible hasta que el dueño lo cierre, y si
        // el modo conversación estaba activo se dice que se detuvo:
        // nada se apaga en silencio.
        setVoiceMsg(convRef.current ? `${message} El modo conversación quedó desactivado.` : message)
        // Un error de escucha detiene el modo conversación: sin
        // esto, un «no te escuché» repetido reabriría el micrófono
        // en bucle en un local con ruido.
        setConvMode(false)
      },
      onEnd: () => {
        recogRef.current = null
        setListening(false)
        setInterim('')
      },
    })
    if (handle) {
      recogRef.current = handle
      setListening(true)
    }
  }, [recogOk])

  const toggleMic = useCallback(() => {
    if (listening) stopListening()
    else startListening()
  }, [listening, startListening, stopListening])

  const toggleConv = useCallback(() => {
    if (convMode) {
      setConvMode(false)
      stopListening()
    } else {
      setConvMode(true)
      setTtsOn(true)
      // El toque es el gesto del usuario: la escucha arranca ya.
      startListening()
    }
  }, [convMode, startListening, stopListening])

  const toggleTts = useCallback(() => {
    if (ttsOn) { stopQueenSpeech(); setSpeaking(false) }
    setTtsOn(!ttsOn)
  }, [ttsOn])

  /* Al salir de la pantalla, la escucha y la lectura se paran. */
  useEffect(() => () => {
    recogRef.current?.abort()
    recogRef.current = null
    stopQueenSpeech()
  }, [])

  /* Lectura de la respuesta nueva: al terminar de «pensar», si la
     voz está activada se lee la respuesta; al acabar de leerla, el
     modo conversación vuelve a escuchar. Las respuestas ya
     presentes al abrir la pantalla no se leen (quedan marcadas). */
  useEffect(() => {
    if (spokenKeysRef.current === null) {
      spokenKeysRef.current = new Set(msgs.filter((m) => m.key).map((m) => m.key as string))
      prevSendingRef.current = sending
      return
    }
    const wasSending = prevSendingRef.current
    prevSendingRef.current = sending
    if (!wasSending || sending) return
    const last = [...msgs].reverse().find((m) => m.role === 'queen' && m.key)
    if (!last || !last.key || spokenKeysRef.current.has(last.key)) return
    spokenKeysRef.current.add(last.key)
    if (ttsRef.current) {
      speakQueen(
        last.text,
        () => { setSpeaking(false); if (convRef.current) startListening() },
        () => setSpeaking(true),
        // Vigía de TTS: si el motor de voz del dispositivo no
        // empieza a sonar, se avisa con la causa — antes la lectura
        // moría en silencio y el dueño solo veía que «no habla».
        () => setVoiceMsg('Queen escribió su respuesta, pero la voz de este dispositivo no empezó a sonar. Revisa que el teléfono tenga una voz en español instalada y el motor de texto a voz activo (Ajustes → Idioma → Salida de texto a voz). La respuesta está escrita arriba.'),
      )
    } else if (convRef.current) {
      startListening()
    }
  }, [sending, msgs, startListening])

  /* Persistencia del hilo y de los patrones (loadQueenState del original). */
  useEffect(() => {
    try {
      if (msgs.length) localStorage.setItem('queen-chat', JSON.stringify(msgs.slice(-30)))
      else localStorage.removeItem('queen-chat')
      if (Object.keys(freq).length) localStorage.setItem('queen-freq', JSON.stringify(freq))
      else localStorage.removeItem('queen-freq')
    } catch { /* sin almacenamiento */ }
  }, [msgs, freq])
  useEffect(() => { saveJSON('queen-feedback-local-v1', feedbackByKey) }, [feedbackByKey])
  useEffect(() => { saveJSON('queen-sda-corrections-v1', learnedCorrections) }, [learnedCorrections])
  useEffect(() => { saveJSON('queen-sda-suggestion-status-v1', suggestionStatus) }, [suggestionStatus])

  const days = useMemo(() => [...data.days].sort((a, b) => a.date.localeCompare(b.date)), [data])
  const hasData = days.length > 0
  const openCorrections = bank.cells.filter((c) => {
    const st = suggestionStatus[c.cellKey] ?? 'nuevo'
    return st !== 'resuelto' && st !== 'no-error'
  })
  const anticipations = useMemo(
    () => buildQueenAnticipations(data, ref, { freq, openCorrections: openCorrections.length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, ref, freq, openCorrections.length],
  )
  const suggestionsCount = suggestions.length + openCorrections.length
  const memoryCount = memory.learnedKinds.length + memory.aliases.length
  const patterns = useMemo(() => Object.entries(freq).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count), [freq])

  const greeting: QueenMsg = useMemo(() => {
    const latest = days[days.length - 1]
    const squareOk = hasData && days.every((d) => d.cuadre === 0)
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    const periodLabelText = latest ? `${MESES[Number(latest.date.slice(5, 7)) - 1]} de ${latest.date.slice(0, 4)}` : ''
    return {
      role: 'queen',
      text: hasData
        ? openCorrections.length
          ? `Hola, soy Queen. Tienes ${openCorrections.length} sugerencia${openCorrections.length === 1 ? '' : 's'} en «Sugerencias». ¿Por dónde empezamos?`
          : squareOk
            ? `Hola, soy Queen. «${periodLabelText}» va cuadrado hasta hoy. ¿En qué te ayudo?`
            : 'Hola, soy Queen. ¿En qué te ayudo hoy?'
        : 'Hola, soy Queen. Importa tu primer IPV y empezamos a revisar juntos.',
    }
  }, [hasData, days, openCorrections.length])
  const shown = useMemo(
    () => (msgs.length ? msgs : [greeting]).map((message) => (message.key && feedbackByKey[message.key] ? { ...message, feedback: feedbackByKey[message.key] } : message)),
    [msgs, greeting, feedbackByKey],
  )

  const send = useCallback((raw: string, replyTo?: QueenReplyRef) => {
    const question = raw.trim()
    if (!question || sendingRef.current) return
    /* Registro de actividad (dueño, 15:02): el uso del chat de
       Queen por el equipo queda en la Cronología del administrador
       (la pregunta recortada; el registro no guarda respuestas). */
    logActivity('queen', `Preguntó a Queen: «${question.slice(0, 90)}${question.length > 90 ? '…' : ''}»`, { section: 'queen' })
    stopQueenSpeech()
    setSpeaking(false)
    setChatNotice('')
    const patternLabel = queenQuestionPattern(question)
    const nextFreq = { ...freq, [patternLabel]: Math.min(9999, (freq[patternLabel] ?? 0) + 1) }
    const citedReply = replyTo ? { role: replyTo.role, text: replyTo.text.slice(0, 800), key: replyTo.key } : undefined
    const withUser: QueenMsg[] = [...msgs, { role: 'user', text: question, ts: Date.now(), replyTo: citedReply }]
    setState({ msgs: withUser, freq: nextFreq })
    setQuickOpen(false)
    sendingRef.current = true
    setSending(true)
    /* El determinista calcula al momento; el indicador de escritura
       (queen-typing) se muestra antes de publicar la respuesta,
       como el estado «pensando» del original. */
    timerRef.current = setTimeout(() => {
      const rawAns = answerQueen(data, question, { refDate: ref })
      const ans = applyQueenLearnedCorrections(rawAns, question, learnedCorrections)
      const turnKey = `queen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      lastAnswer.current = { question, answer: ans }
      setLanguageTry({ state: 'idle' })
      setState({ msgs: [...withUser, { role: 'queen', text: ans.text, key: turnKey, ts: Date.now(), answer: ans }], freq: nextFreq })
      sendingRef.current = false
      setSending(false)
    }, 550)
  }, [data, freq, msgs, ref, learnedCorrections])
  /* La voz envía por el mismo send (su referencia viva). */
  useEffect(() => { sendRef.current = (text: string) => send(text) }, [send])

  const recordFeedback = useCallback((turnKey: string, helpful: boolean, correction = '') => {
    const nextFeedback: NonNullable<QueenMsg['feedback']> = correction ? 'corregida' : helpful ? 'util' : 'no-util'
    setFeedbackByKey((current) => ({ ...current, [turnKey]: nextFeedback }))
    setState((current) => ({ ...current, msgs: current.msgs.map((message) => (message.key === turnKey ? { ...message, feedback: nextFeedback } : message)) }))
    if (correction) {
      const msg = msgs.find((m) => m.key === turnKey)
      const question = [...msgs].reverse().find((m) => m.role === 'user')?.text ?? ''
      void msg
      setLearnedCorrections((current) => [{
        id: `corr-${Date.now()}`, turnKey, question, pattern: queenQuestionPattern(question),
        correction, createdAt: new Date().toISOString(), status: 'aprendida',
      }, ...current].slice(0, 100))
      setChatNotice('Aprendido: en adelante lo trato así.')
    } else {
      setChatNotice(helpful ? 'Guardado: sí te sirvió.' : 'Guardado: no te sirvió. Escribe la corrección y la aprendo.')
    }
  }, [msgs])

  const clearChat = () => {
    setState({ msgs: [], freq: {} })
    setFeedbackByKey({})
    setReplyTarget(null)
    setPanel('ninguno')
    setClearArmed(false)
    lastAnswer.current = null
    setLanguageTry({ state: 'idle' })
    try { localStorage.removeItem('queen-chat'); localStorage.removeItem('queen-freq'); localStorage.removeItem('queen-feedback-local-v1'); localStorage.removeItem('queen-draft') } catch { /* noop */ }
    setComposerKey((k) => k + 1)
    setChatNotice('Historial completo borrado. No se tocó lo que Queen ha aprendido, ni las correcciones ya resueltas, ni ningún dato contable.')
  }

  const handleThreadReply = useCallback((message: QueenMsg, messageKey: string) => {
    setReplyTarget({ role: message.role, text: message.text, key: messageKey })
    setQuickOpen(false)
  }, [])

  const tryLanguage = async () => {
    if (!onTestLanguage || !lastAnswer.current) return
    setLanguageTry({ state: 'busy' })
    const res = await onTestLanguage(lastAnswer.current.question, lastAnswer.current.answer.figures)
    if (res.ok && res.text) setLanguageTry({ state: 'done', text: res.text, provider: res.provider })
    else setLanguageTry({ state: 'done', reason: res.reason ?? 'La capa de lenguaje no está configurada todavía.' })
  }

  const visibleHealth = sending ? 'working' : baseHealth.state
  const healthCopy = QUEEN_HEALTH_COPY[visibleHealth]
  const orbState = sending ? 'thinking' : hasText ? 'composing' : baseHealth.state === 'error' ? 'alert' : baseHealth.state === 'warning' || baseHealth.state === 'expectant' ? 'suggestion' : baseHealth.state === 'healthy' ? 'positive' : 'idle'
  const statusLine = sending ? 'concentrada · pensando…' : hasText ? 'atenta · leyendo…' : `${healthCopy.label.toLocaleLowerCase('es')} · ${healthCopy.detail.toLocaleLowerCase('es')}`
  const hasQueenHistory = msgs.length > 0 || Object.keys(freq).length > 0
  const stageDef = QUEEN_REACTOR_STAGES[evo.stage.id]

  return (
    <section aria-label="Queen, compañera de trabajo" className={`queen-chat queen-layout queen-chat-stage-${evo.stage.id}`}>
      <div className="queen-chat-header">
        <div className="queenm-flex">
          <span className="queen-chat-avatar"><QueenOrb size={46} stageId={evo.stage.id} state={orbState} /></span>
          <div className="queenm-minw0">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, lineHeight: 1.15, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Queen</h2>
            <p style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.25, margin: 0 }}>
              <span className={`queen-status-dot queen-status-dot-${visibleHealth}`} aria-hidden="true" />
              {statusLine}
            </p>
          </div>
        </div>
        {hasQueenHistory && (
          <button type="button" onClick={() => { setClearArmed((v) => !v); setChatNotice('') }} aria-expanded={clearArmed} aria-label="Borrar todo el historial de Queen" title="Borrar historial" className="queen-icon-btn">
            <Icon name="trash" size={19} />
          </button>
        )}
      </div>

      {/* Etapa y salud visibles (el Reactor Evolutivo del original, resumido en la cabecera de la consola; su panel completo vive en Sistema). Con chatOnly (matriz de Yan) este bloque es un panel y no se muestra. */}
      {!chatOnly && (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <QueenReactorMark stageId={evo.stage.id} state={baseHealth.state === 'error' ? 'alert' : 'idle'} size={56} />
        <div className="queenm-minw0" style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13 }}><strong>Etapa {evo.stage.name}</strong>{evo.score != null ? <> · índice {evo.score} de 100{evo.nextStage ? <> · hacia {evo.nextStage.name}: {fmtInt(evo.progressToNext)} %</> : ' · etapa máxima'}</> : ''} · salud: {healthCopy.label}</p>
          <p className="queenm-sub" style={{ marginTop: 2 }}>{evo.score != null ? `${evo.stage.description} ${stageDef ? '' : ''}`.trim() : evo.note}</p>
          {evo.score != null && <div className="queenm-evo-track" aria-hidden="true"><span style={{ width: `${evo.progressToNext}%` }} /></div>}
        </div>
      </div>
      )}
      {!chatOnly && evo.score != null && (
        <div className="queen-metrics" style={{ margin: '0 0 10px' }}>
          {evo.metrics.map((m) => (
            <div className="queen-metric" key={m.key}>
              <span className="queen-metric-label">{m.label}</span>
              <strong>{m.measured ? (m.key === 'precision' ? `${m.value} %` : fmtInt(m.value ?? 0)) : 'Sin medir'}</strong>
              <span className="small muted">{m.measured ? `meta ${fmtInt(m.target)}` : 'no viaja en el respaldo'}</span>
            </div>
          ))}
        </div>
      )}

      {clearArmed && hasQueenHistory && (
        <div className="queen-clear-bar" role="alert">
          <p style={{ fontSize: 14, margin: 0 }}>
            <strong>¿Borrar todo el historial?</strong> Se borran la conversación y tus consultas frecuentes de esta copia.
            No se toca lo que Queen ha aprendido, ni las correcciones ya resueltas, ni ningún dato contable.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={clearChat} style={{ borderRadius: 999, background: '#ba1a1a', color: '#fff', padding: '0 16px', minHeight: 40, fontSize: 14, fontWeight: 600, border: 0 }}>Borrar historial</button>
            <button type="button" onClick={() => setClearArmed(false)} style={{ borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '0 16px', minHeight: 40, fontSize: 14, fontWeight: 600 }}>Cancelar</button>
          </div>
        </div>
      )}

      {!chatOnly && (
      <div className="queen-panel-bar">
        <button type="button" onClick={() => setPanel((p) => (p === 'anticipacion' ? 'ninguno' : 'anticipacion'))} aria-expanded={effectivePanel === 'anticipacion'} aria-label={`Anticipación de Queen, ${anticipations.length} acciones sugeridas`} className={`queen-panel-chip${effectivePanel === 'anticipacion' ? ' queen-panel-chip-on' : ''}`}>
          <Icon name="clock" size={15} /> Anticipación
          {anticipations.length > 0 && <span className="queen-panel-count">{anticipations.length}</span>}
        </button>
        <button type="button" onClick={() => setPanel((p) => (p === 'sugerencias' ? 'ninguno' : 'sugerencias'))} aria-expanded={effectivePanel === 'sugerencias'} aria-label={suggestionsCount > 0 ? `Sugerencias de Queen, ${suggestionsCount} pendientes` : 'Sugerencias de Queen'} className={`queen-panel-chip${effectivePanel === 'sugerencias' ? ' queen-panel-chip-on' : ''}`}>
          <Icon name="sparkle" size={15} /> Sugerencias
          {suggestionsCount > 0 && <span className="queen-panel-count queen-panel-count-warn">{suggestionsCount}</span>}
        </button>
        <button type="button" onClick={() => setPanel((p) => (p === 'sms' ? 'ninguno' : 'sms'))} aria-expanded={effectivePanel === 'sms'} aria-label={`SMS de cobro, ${smsDue.length} cuentas morosas`} className={`queen-panel-chip${effectivePanel === 'sms' ? ' queen-panel-chip-on' : ''}`}>
          <Icon name="message" size={15} /> SMS
          {smsDue.length > 0 && <span className="queen-panel-count queen-panel-count-warn">{smsDue.length}</span>}
        </button>
        <button type="button" onClick={() => setPanel((p) => (p === 'memoria' ? 'ninguno' : 'memoria'))} aria-expanded={effectivePanel === 'memoria'} aria-label="Memoria de Queen" className={`queen-panel-chip${effectivePanel === 'memoria' ? ' queen-panel-chip-on' : ''}`}>
          <Icon name="star" size={15} /> Memoria
          {memoryCount > 0 && <span className="queen-panel-count">{memoryCount}</span>}
        </button>
      </div>
      )}

      {effectivePanel === 'anticipacion' && (
        <div className="queen-anticipation" aria-label="Anticipaciones de Queen">
          <div className="queen-anticipation-head">
            <div>
              <h3 className="queenm-title">Lo próximo</h3>
              <p>Queen cruza hora de La Habana, IPV, cuentas, correcciones y patrones reales de uso.</p>
            </div>
            <QueenOrb size={40} stageId={evo.stage.id} state={anticipations.some((item) => item.level === 'prioridad') ? 'alert' : 'suggestion'} />
          </div>
          {anticipations.length > 0 ? (
            <ul className="queen-anticipation-list">
              {anticipations.map((item) => (
                <li key={item.id} className={`queen-anticipation-item queen-anticipation-${item.level}`}>
                  <span className="queen-anticipation-mark" aria-hidden="true" />
                  <div className="queenm-minw0">
                    <span className="queen-anticipation-level">{item.level === 'prioridad' ? 'Prioridad' : item.level === 'atencion' ? 'Atención' : 'Rutina aprendida'}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <button type="button" disabled={sending} onClick={() => { if (item.question) send(item.question); else setPanel('sugerencias') }} className="queen-anticipation-action">
                      {item.actionLabel} <Icon name="chevronR" size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--dim)', margin: 0 }}>Todo está al corriente. Queen seguirá observando los próximos cambios sin inventar pendientes.</p>
          )}
        </div>
      )}

      {effectivePanel === 'sugerencias' && suggestions.length > 0 && (
        <div className="queenm-panel" aria-label="Sugerencias: lo que Queen está viendo">
          <h3 className="queenm-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><QueenOrb size={24} stageId={evo.stage.id} state={suggestions.some((ins) => ins.level === 'alert') ? 'alert' : 'suggestion'} /> Lo que estoy viendo</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {suggestions.map((ins) => (
              <li key={ins.kind} style={{ display: 'flex', gap: 8, fontSize: 14, color: ins.level === 'alert' ? 'var(--danger)' : 'var(--text)' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, marginTop: 6, flex: 'none', background: ins.level === 'alert' ? 'var(--danger)' : ins.level === 'suggestion' ? '#d97706' : '#168b70' }} /><span>{ins.text}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '8px 0 0' }}>Todo sale de tus días guardados. Si falta base para concluir, te lo digo en vez de adornarlo.</p>
        </div>
      )}

      {effectivePanel === 'sugerencias' && (
        <div className="queenm-panel" aria-label="Sugerencias: consultas y correcciones de Queen">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <h3 className="queenm-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><QueenOrb size={24} stageId={evo.stage.id} state={openCorrections.length ? 'alert' : 'positive'} /> Bandeja de correcciones</h3>
            <span className="queenm-chipstate">{openCorrections.length} sin resolver</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>Queen nunca cambia un dato financiero sin tu confirmación dentro del aviso. Al cerrar uno, queda la fecha y la nota de qué se hizo.</p>
          {bank.cells.length === 0 && learnedCorrections.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--dim)', margin: 0 }}>Sin avisos registrados en esta copia: ningún día cargado trae descuadre verificado y todavía no hay correcciones aprendidas del chat. Cuando detecte algo, lo dejo aquí hasta que lo cerremos.</p>
          ) : (
            <>
              {bank.cells.length > 0 && (
                <ul className="queenm-list">
                  {bank.cells.map((c) => {
                    const st = suggestionStatus[c.cellKey] ?? 'nuevo'
                    return (
                      <li key={c.cellKey} style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px' }}>
                        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}><span className="queenm-rowtext" style={{ flex: 1 }}>{c.topic}: {c.symptoms}</span><span className="queenm-chipstate">{SUGGESTION_LABEL[st]}</span></span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 4 }}><strong>Qué pasó:</strong> {c.cause} <strong>Guía:</strong> {c.antibody}</span>
                        {st !== 'resuelto' && st !== 'no-error' && (
                          <span className="queenm-actions">
                            <button type="button" className="queenm-btn is-primary" onClick={() => setSuggestionStatus((s) => ({ ...s, [c.cellKey]: 'resuelto' }))}>Resuelto</button>
                            <button type="button" className="queenm-btn" onClick={() => setSuggestionStatus((s) => ({ ...s, [c.cellKey]: 'no-error' }))}>No es un error</button>
                            {st === 'nuevo' && <button type="button" className="queenm-btn" onClick={() => setSuggestionStatus((s) => ({ ...s, [c.cellKey]: 'revision' }))}>En revisión</button>}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {learnedCorrections.length > 0 && (
                <>
                  <h4 style={{ margin: '14px 0 6px', fontSize: 14 }}>Consultas y correcciones aprendidas del chat</h4>
                  <ul className="queenm-list">
                    {learnedCorrections.map((c) => (
                      <li key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '10px 12px' }}>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span className="queenm-rowtext" style={{ flex: 1 }}>«{c.question}» → {c.correction}</span><span className="queenm-chipstate is-ok">Corrección aprendida</span></span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>Guardada el {c.createdAt.slice(0, 10)} en la memoria local de esta copia; se aplica vía queenCore cuando la consulta coincide.</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {effectivePanel === 'sms' && (
        <section className="queen-sms-panel" aria-label="SMS de cobro gestionados por Queen">
          <div className="queen-sms-head">
            <div>
              <h3><Icon name="message" size={18} /> SMS de cobro</h3>
              <p>Cada movimiento queda en Enviados, Pendientes, Cancelados o Reenvíos. En esta copia no hay buzón ni transporte SMS desplegado, así que ningún mensaje se marca enviado sin envío real.</p>
            </div>
            <span className="queen-sms-count">{smsDue.length} listos</span>
          </div>
          <p className="queen-sms-notice" role="status">Estado real: sin transporte en esta copia para enviar SMS NUEVOS. El original encola el SMS y lo despacha desde el Galaxy A16 con aprobación de Android; esa función en la nube no está desplegada aquí. El historial de abajo SÍ es real: es el buzón (smsOutbox) y el registro de envíos (smsLogs) que trae el respaldo (oleada 2: antes se descartaban al importar). Abajo están también las cuentas que el original usaría — solo morosas, nunca una cuenta pagada — con su saldo verificado.</p>
          {smsNotice && <p className="queen-sms-notice" role="status">{smsNotice}</p>}
          <div className="queen-sms-outbox" aria-label="Historial de SMS de cobro">
            <strong>Historial de SMS</strong>
            {(() => {
              const outbox = data.smsOutbox
              const isResend = (o: typeof outbox[number]) => o.requestKind === 'reenvio' || o.resendOfId != null
              const cats: Record<typeof smsTab, typeof outbox> = {
                reenvios: outbox.filter(isResend),
                enviados: outbox.filter((o) => !isResend(o) && o.status === 'enviado'),
                pendientes: outbox.filter((o) => !isResend(o) && (o.status === 'pendiente' || o.status === 'enviando' || o.status === 'fallido')),
                cancelados: outbox.filter((o) => !isResend(o) && o.status === 'cancelado'),
              }
              const list = cats[smsTab]
              return (
                <>
                  <div className="queen-sms-history-tabs" role="tablist" aria-label="Categorías del historial de SMS">
                    {([['enviados', 'Enviados'], ['pendientes', 'Pendientes'], ['cancelados', 'Cancelados'], ['reenvios', 'Reenvíos']] as const).map(([key, label]) => (
                      <button key={key} type="button" role="tab" aria-selected={smsTab === key} className={smsTab === key ? 'is-active' : ''} onClick={() => setSmsTab(key)}>{label}<span>{cats[key].length}</span></button>
                    ))}
                  </div>
                  {list.length === 0 && !(smsTab === 'enviados' && data.smsLogs.length > 0) ? (
                    <p className="queen-sms-empty">No hay SMS en esta categoría.</p>
                  ) : (
                    <ul className="queen-sms-list">
                      {list.map((o) => (
                        <li key={`outbox-${o.id}`}>
                          <span className="queen-sms-initials" aria-hidden="true">{String(o.clientName ?? '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'}</span>
                          <div className="queenm-minw0">
                            <strong>{o.clientName}</strong>
                            <span>{o.status} · {o.requestKind} · {String(o.sentAt ?? o.createdAt ?? '').slice(0, 10)}</span>
                            <small>{o.message}</small>
                            {o.lastError ? <small>{String(o.lastError)}</small> : null}
                          </div>
                        </li>
                      ))}
                      {smsTab === 'enviados' ? data.smsLogs.map((log, i) => (
                        <li key={`log-${i}-${log.sentAt}`}>
                          <span className="queen-sms-initials" aria-hidden="true">{String(log.client ?? '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'}</span>
                          <div className="queenm-minw0">
                            <strong>{log.client}</strong>
                            <span>enviado · registro del respaldo · {String(log.sentAt ?? '').slice(0, 10)}</span>
                            <small>{log.message}</small>
                          </div>
                        </li>
                      )) : null}
                    </ul>
                  )}
                  <p className="queen-sms-empty" style={{ marginTop: 8 }}>
                    Buzón del respaldo: {outbox.length} solicitudes · Registro de envíos: {data.smsLogs.length} SMS.
                  </p>
                </>
              )
            })()}
          </div>
          {smsDue.length > 0 ? (
            <ul className="queen-sms-list">
              {smsDue.map((c) => (
                <li key={c.clientKey}>
                  <span className="queen-sms-initials" aria-hidden="true">{c.client.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <div className="queenm-minw0">
                    <strong>{c.client}</strong>
                    <span>debe {fmtQueenCUP(c.morosasTotal)} en {fmtInt(c.morosas)} cuenta{c.morosas === 1 ? '' : 's'} morosa{c.morosas === 1 ? '' : 's'} · {c.category}</span>
                    <small>{c.transportLabel}</small>
                  </div>
                  <button type="button" onClick={() => setSmsNotice(`Para ${c.client}: el SMS no puede salir de esta copia — no hay transporte desplegado. Su saldo moroso verificado es ${fmtQueenCUP(c.morosasTotal)}.`)} aria-label={`Revisar SMS para ${c.client}`}>Revisar</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="queen-sms-empty">No hay primeros avisos listos: ninguna tarjeta tiene cuentas morosas en los datos cargados.</p>
          )}
        </section>
      )}

      {effectivePanel === 'memoria' && (
        <div className="queen-memory queenm-panel" aria-label="Memoria y ADN operativo de Queen">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div className="queenm-minw0">
              <h3 className="queenm-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><QueenOrb size={24} stageId={evo.stage.id} /> Memoria de Queen</h3>
              <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>Tus reglas confirmadas guían mis decisiones; los datos contables permanecen separados.</p>
            </div>
            {data.exportedAt && <span className="queen-memory-date" style={{ flex: 'none' }}>Respaldo {data.exportedAt.slice(0, 10)}</span>}
          </div>
          <div className="queen-memory-summary" role="status">
            <strong>{memory.directives.length} reglas permanentes</strong><span> · </span>
            <span>{memory.learnedKinds.length} clasificación{memory.learnedKinds.length === 1 ? '' : 'es'} aprendida{memory.learnedKinds.length === 1 ? '' : 's'}</span>
            <span> · {patterns.length} patrón{patterns.length === 1 ? '' : 'es'} de uso</span>
            <span> · {fmtInt(memory.decisionsCount)} decisiones tuyas por entrada</span>
          </div>

          <details className="queen-memory-section" open>
            <summary>ADN operativo y preferencias</summary>
            <ul className="queen-directive-list">
              {memory.directives.map((directive) => (
                <li key={directive.id}>
                  <span className="queen-directive-category">{directive.category}</span>
                  <div className="queenm-minw0"><strong>{directive.title}</strong><p>{directive.rule}</p><small>Integrada en el ADN; se registrará su uso al responder.</small></div>
                </li>
              ))}
            </ul>
          </details>

          <details className="queen-memory-section" open={memory.learnedKinds.length > 0}>
            <summary>Clasificaciones que me enseñaste ({memory.learnedKinds.length})</summary>
            {memory.learnedKinds.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                {memory.learnedKinds.slice(0, 12).map((l) => (
                  <li key={l.key} className="queen-learned-row"><span className="queenm-minw0">Aprendido: en adelante lo trato así — «{l.key}» = {l.kind}</span></li>
                ))}
              </ul>
            ) : (<p style={{ fontSize: 14, color: 'var(--dim)', marginTop: 8 }}>Aún no has clasificado un concepto nuevo. La primera corrección quedará aquí y se aplicará sola después.</p>)}
            {memory.aliases.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>Alias: {memory.aliases.map((a) => `${a.variant} → ${a.canonicalDisplay}`).join(' · ')}</p>
            )}
            {learnedCorrections.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>Correcciones del chat guardadas en esta copia: {learnedCorrections.length} (detalle en «Sugerencias»).</p>
            )}
          </details>

          <details className="queen-memory-section" open={patterns.length > 0}>
            <summary>Patrones que reconocí ({patterns.length})</summary>
            {patterns.length > 0 ? (
              <ul className="queen-pattern-list">
                {patterns.slice(0, 8).map((pattern) => (<li key={pattern.label}><span>{pattern.label}</span><strong>{pattern.count} vez{pattern.count === 1 ? '' : 'es'}</strong></li>))}
              </ul>
            ) : (<p style={{ fontSize: 14, color: 'var(--dim)', marginTop: 8 }}>Todavía no hay suficiente uso registrado. Cada consulta guardará solo su categoría, frecuencia y última vez para anticiparme mejor.</p>)}
          </details>

          <details className="queen-memory-section">
            <summary>Lo que no viaja en el respaldo</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {memory.notTraveling.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </details>

          <details className="queen-memory-section">
            <summary>Banco de errores · Sistema inmune ({bank.cells.length})</summary>
            {bank.cells.length ? (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {bank.cells.map((c) => (<li key={c.cellKey}><strong>{c.topic}:</strong> {c.symptoms} Anticuerpo: {c.antibody}</li>))}
              </ul>
            ) : (<p style={{ fontSize: 14, color: 'var(--dim)', marginTop: 8 }}>Sin células: ningún error verificado en los datos cargados. No se siembran células de ejemplo.</p>)}
          </details>

          <details className="queen-memory-section">
            <summary>Permisos por modo ({modes.length})</summary>
            <div className="queen-modes" style={{ marginTop: 8 }}>
              {modes.map((m) => (
                <div className="queen-mode" key={m.key}>
                  <strong>{m.title}</strong>
                  <p className="small" style={{ margin: '4px 0' }}>{m.description}</p>
                  <p className="small" style={{ margin: '2px 0' }}>Puede: {m.canDo.join(' · ')}</p>
                  <p className="small" style={{ margin: '2px 0' }}>No puede: {m.cannotDo.join(' · ')}</p>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>{m.liveSignal}</p>
                </div>
              ))}
            </div>
          </details>

          <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 12 }}>También se reaplican la familia de cada producto, los alias al unificar, el archivo de productos sin existencia y las reclasificaciones por fecha. Solo lo genuinamente nuevo llega a «Sugerencias».</p>
        </div>
      )}

      {chatNotice && (<p className="queen-chat-notice" role="status">{chatNotice}</p>)}

      <QueenThread shown={shown} sending={sending} stageId={evo.stage.id} threadRef={listRef} onReply={handleThreadReply} onFeedback={recordFeedback} onAsk={(question) => send(question)} />

      <div className="queen-lang" style={{ marginBottom: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          <strong>Capa de lenguaje:</strong> {lang.configured ? 'configurada' : 'sin configurar'}. {lang.note} Queen no escribe desde el chat: su escritura está denegada en dinero, cuentas, IPV, ADN y permisos. (En el sistema original Queen es 100 % texto; la voz de abajo es un añadido de esta copia, decisión del dueño del 26-oct.)
        </p>
        {lastAnswer.current && supabaseMode ? (
          <button type="button" className="chip-btn" disabled={languageTry.state === 'busy'} onClick={() => void tryLanguage()}>
            {languageTry.state === 'busy' ? 'Probando la capa…' : 'Redactar la última respuesta con IA'}
          </button>
        ) : null}
        {languageTry.state === 'done' && languageTry.text ? (
          <div className="ok-box" style={{ marginTop: 8 }}>
            <strong>Redacción de la capa{languageTry.provider ? ` (${languageTry.provider})` : ''}:</strong>
            <p style={{ margin: '4px 0 0' }}>{languageTry.text}</p>
            <p className="small muted" style={{ margin: '4px 0 0' }}>Solo redacta sobre las cifras verificadas de arriba; no calcula nada nuevo.</p>
          </div>
        ) : null}
        {languageTry.state === 'done' && languageTry.reason ? (<p className="small muted" style={{ margin: '8px 0 0' }}>{languageTry.reason}</p>) : null}
      </div>

      {hasData && quickOpen && (
        <div className="queen-quick-menu is-open" onKeyDown={(event) => { if (event.key === 'Escape') setQuickOpen(false) }}>
          <div className="queen-quick-heading"><span><Icon name="sparkle" size={15} /> Preguntas rápidas</span><button type="button" onClick={() => setQuickOpen(false)} aria-label="Cerrar preguntas rápidas"><Icon name="x" size={16} /></button></div>
          <div id="queen-quick-options" className="queen-quick-popover" role="menu" aria-label="Preguntas rápidas">
            {['¿Cómo vamos?', '¿Quién me debe?', '¿Qué hay en la calle?', '¿Qué avisos hay?'].map((q) => (
              <button key={q} type="button" role="menuitem" disabled={sending} onClick={() => { setQuickOpen(false); send(q) }} className="queen-quick-option">
                <span>{q}</span><Icon name="chevronR" size={14} />
              </button>
            ))}
            {QUEEN_EXTRA_QUICK.map((q) => (
              <button key={q} type="button" role="menuitem" disabled={sending} onClick={() => { setQuickOpen(false); send(q) }} className="queen-quick-option">
                <span>{q}</span><Icon name="chevronR" size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Voz en tiempo real (añadido del dueño en esta copia): los
          interruptores solo aparecen si el navegador soporta la
          pieza; sin soporte, el chat queda exactamente como hoy. */}
      {(recogOk || synthOk) && (
        <div className="queen-voice-bar">
          {synthOk && (
            <button type="button" className={`chip-btn${ttsOn ? ' active' : ''}`} aria-pressed={ttsOn} onClick={toggleTts}>
              <Icon name={ttsOn ? 'volume' : 'volumeOff'} size={14} /> Voz de Queen {ttsOn ? 'activada' : 'silenciada'}
            </button>
          )}
          {recogOk && (
            <button type="button" className={`chip-btn${convMode ? ' active' : ''}`} aria-pressed={convMode} onClick={toggleConv}>
              <Icon name="mic" size={14} /> Conversación {convMode ? 'activada' : 'desactivada'}
            </button>
          )}
          <span className="queen-voice-note">La voz es una capa sobre este mismo chat: lo que dictes se envía como un mensaje más y se lee la respuesta de Queen. Nada se escucha hasta tocar el micrófono.</span>
        </div>
      )}
      {(speaking || listening || voiceMsg) && (
        <div className="queen-voice-status" role="status" aria-live="polite">
          <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {speaking
              ? <span className="queen-speaking-tag"><QueenVoiceOrb size={22} state="speaking" /> Queen está hablando…</span>
              : listening
                ? <><QueenVoiceOrb size={22} state="listening" /> Escuchando… {interim ? <span className="queen-voice-interim">«{interim}»</span> : 'habla ahora; toca el micrófono para enviar.'}</>
                : voiceMsg}
          </span>
          {/* El aviso de un fallo de voz NO se quita solo: queda hasta
              que el dueño lo cierre (defecto del dueño, 26-oct). */}
          {!speaking && !listening && voiceMsg ? (
            <button type="button" className="queen-voice-dismiss" onClick={() => setVoiceMsg('')} aria-label="Cerrar el aviso de voz">✕</button>
          ) : null}
        </div>
      )}

      <div className="queen-composer-wrap">
        <QueenComposer key={composerKey} sending={sending} quickOpen={quickOpen} hasQuickActions={hasData} onToggleQuick={() => setQuickOpen((open) => !open)} onSend={send} onHasTextChange={handleHasText} replyTo={replyTarget} onCancelReply={() => setReplyTarget(null)} voice={recogOk ? { listening, speaking, onMicToggle: toggleMic } : null} />
      </div>
    </section>
  )
}
const QUEEN_EXTRA_QUICK = ['¿Quién debe más?', '¿Cuánto se vendió ayer?', '¿Qué días faltan por importar?', '¿Cuál fue el último cambio de precio?', '¿Cómo está la tarjeta del negocio?', '¿En qué etapa estás?']
