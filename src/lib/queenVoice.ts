/* Voz de Queen en tiempo real — AÑADIDO DEL DUEÑO en esta copia
   (decisión del 2026-10-26, 12:14). NO forma parte de la paridad
   con el sistema original: allí Queen es 100 % texto. Aquí la voz
   es una CAPA sobre el chat existente y su mismo cerebro (el
   núcleo determinista y, en modo Supabase, la función queen-chat):
   el texto reconocido se envía como un mensaje más y la respuesta
   que se lee en voz alta es la respuesta de siempre.

   Dos piezas del navegador (Web Speech API):
   - Escuchar: SpeechRecognition (webkitSpeechRecognition en
     Chrome/Android) en español. Pulsar para hablar: nada escucha
     hasta que el usuario toca el micrófono, y la transcripción
     provisional se muestra siempre en texto antes de enviarse.
   - Hablar: speechSynthesis con la voz en español disponible en
     el dispositivo. Solo se leen las RESPUESTAS de Queen, nunca
     los textos de la interfaz.

   Degradación honesta: si el navegador no soporta alguna de las
   dos piezas, la pieza no aparece y el chat sigue como siempre.
   La voz nunca bloquea el chat de texto: cualquier error de
   micrófono o de síntesis se reporta como aviso y se sigue
   escribiendo. */

interface SpeechRecognitionAlternativeLike { transcript: string; confidence: number }
interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionErrorEventLike { error: string; message?: string }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

export function recognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export interface RecognitionHandle {
  /** Detiene la escucha (conserva lo reconocido hasta el momento). */
  stop: () => void
  /** Cancela la escucha sin enviar nada. */
  abort: () => void
}

export interface RecognitionCallbacks {
  /** Transcripción provisional (visible en texto mientras se habla). */
  onInterim: (text: string) => void
  /** Transcripción final: la pantalla la envía como mensaje. */
  onFinal: (text: string) => void
  /** Error ya traducido a un aviso legible; la escucha se detiene. */
  onError: (message: string) => void
  /** La escucha terminó (por fin natural, stop o error). */
  onEnd: () => void
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'El micrófono no tiene permiso en este navegador. Toca el candado junto a la dirección y permite el micrófono para esta página; el chat de texto sigue disponible.',
  'service-not-allowed': 'El servicio de voz del navegador no está permitido en este dispositivo. El chat de texto sigue disponible.',
  'audio-capture': 'No se encontró micrófono en este dispositivo. El chat de texto sigue disponible.',
  'no-speech': 'No te escuché. Toca el micrófono e inténtalo de nuevo.',
  network: 'La voz del navegador necesita conexión a internet para reconocer lo que dices. Revisa la conexión e inténtalo de nuevo; el chat de texto sigue disponible.',
  'language-not-supported': 'Este dispositivo no tiene reconocimiento de voz en español. El chat de texto sigue disponible.',
}
/* La escucha se cortó sola antes de empezar (error «aborted» sin que
   el usuario la detuviera): jamás en silencio (defecto del dueño,
   26-oct: «aparece algo que se quita y no pasa nada»). */
const ABORTED_TEXT = 'La escucha se interrumpió antes de empezar. Suele pasar si el micrófono quedó ocupado por otra aplicación o si el servicio de voz del navegador falló al arrancar. Toca el micrófono para intentarlo otra vez; el chat de texto sigue disponible.'
/* La sesión terminó sin error y sin captar nada (onend desnudo):
   tampoco puede quedar en silencio. */
const SILENT_END_TEXT = 'La escucha terminó sin captar nada. Puede que el servicio de voz no esté disponible en este dispositivo o que el micrófono se haya cerrado. Toca el micrófono para intentarlo de nuevo; el chat de texto sigue disponible.'

/** Arranca una sesión de escucha (pulsar para hablar). Devuelve null
 *  si el navegador no soporta reconocimiento. Nunca lanza: los
 *  fallos llegan por onError. */
export function startRecognition(callbacks: RecognitionCallbacks): RecognitionHandle | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null
  let recognition: SpeechRecognitionLike | null = null
  let stopped = false
  let ended = false
  let langIndex = 0
  const langs = ['es-ES', 'es']
  let finalText = ''
  /* Contabilidad de la sesión para que NINGÚN final quede en
     silencio: si la escucha termina sin entregar texto, sin que el
     usuario la detuviera y sin un error ya avisado, se avisa. */
  let delivered = false
  let reported = false
  const report = (message: string) => {
    if (reported) return
    reported = true
    callbacks.onError(message)
  }

  const finish = () => {
    if (ended) return
    ended = true
    if (!stopped && !reported && !delivered) report(SILENT_END_TEXT)
    callbacks.onEnd()
  }

  const launch = () => {
    recognition = new Ctor()
    recognition.lang = langs[langIndex]
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += transcript
        else interim += transcript
      }
      if (finalText.trim()) {
        const text = finalText.trim()
        finalText = ''
        delivered = true
        callbacks.onFinal(text)
      } else if (interim.trim()) {
        callbacks.onInterim(interim.trim())
      }
    }
    recognition.onerror = (event) => {
      // Sin soporte del idioma pedido: se reintenta una vez con el
      // español genérico antes de dar el error por definitivo. Los
      // handlers de la instancia vieja se desconectan ANTES de
      // abortarla: su onend tardío no debe cerrar la sesión nueva.
      if (event.error === 'language-not-supported' && langIndex < langs.length - 1 && !stopped) {
        langIndex += 1
        const old = recognition
        if (old) { old.onresult = null; old.onerror = null; old.onend = null }
        try { old?.abort() } catch { /* noop */ }
        launch()
        return
      }
      // «aborted» solo es silencioso cuando lo pidió el usuario
      // (stop/abort del asa); si llega solo, es un fallo de arranque
      // y se avisa como cualquier otro error.
      if (event.error === 'aborted' && !stopped) { report(ABORTED_TEXT); finish(); return }
      if (event.error === 'aborted') { finish(); return }
      report(ERROR_TEXT[event.error] ?? `La escucha se detuvo (${event.error}). El chat de texto sigue disponible.`)
      finish()
    }
    recognition.onend = () => finish()
    try {
      recognition.start()
    } catch {
      report('La escucha no pudo empezar. El chat de texto sigue disponible.')
      finish()
    }
  }
  launch()

  return {
    stop: () => { stopped = true; try { recognition?.stop() } catch { /* noop */ } },
    abort: () => { stopped = true; try { recognition?.abort() } catch { /* noop */ } finish() },
  }
}

/** Elige la voz en español del dispositivo (es-ES primero, luego
 *  cualquier variante de español; si no hay ninguna, null y el
 *  navegador usa su voz por defecto con lang es-ES). */
export function spanishVoice(): SpeechSynthesisVoice | null {
  if (!synthesisSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang.toLowerCase() === 'es-es') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('es')) ??
    null
  )
}

let resumeTimer: ReturnType<typeof setInterval> | null = null

/** Lee en voz alta la respuesta de Queen. Cancela cualquier lectura
 *  anterior. onDone se llama al terminar (o si la síntesis no está
 *  disponible): el modo conversación lo usa para volver a escuchar.
 *  onStart se llama cuando la voz REAL empieza a sonar
 *  (utterance.onstart): el orbe de voz anima «hablando» solo entre
 *  onStart y onDone — sincronizado con la lectura, no decorativo. */
export function speakQueen(text: string, onDone?: () => void, onStart?: () => void): void {
  if (!synthesisSupported() || !text.trim()) { onDone?.(); return }
  const synth = window.speechSynthesis
  stopQueenSpeech()
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').trim())
  utterance.lang = 'es-ES'
  const voice = spanishVoice()
  if (voice) utterance.voice = voice
  utterance.rate = 1
  let done = false
  const finish = () => {
    if (done) return
    done = true
    if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null }
    onDone?.()
  }
  utterance.onstart = () => { onStart?.() }
  utterance.onend = finish
  utterance.onerror = finish
  // Chrome de escritorio corta las lecturas largas (~15 s): un
  // resume periódico las mantiene vivas mientras Queen habla.
  resumeTimer = setInterval(() => {
    if (!synth.speaking) { finish(); return }
    if (!synth.paused) { synth.pause(); synth.resume() }
  }, 10000)
  synth.speak(utterance)
}

export function stopQueenSpeech(): void {
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null }
  if (synthesisSupported()) {
    try { window.speechSynthesis.cancel() } catch { /* noop */ }
  }
}

export function queenIsSpeaking(): boolean {
  return synthesisSupported() && window.speechSynthesis.speaking
}
