import { useMemo, useRef, useState, type FormEvent } from 'react'
import type { StoredData } from '../types'
import { Card, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { QueenOrb, QueenReactorMark, QUEEN_REACTOR_STAGES } from '../components/QueenReactor'
import { fmtInt, todayISO } from '../lib/utils'
import {
  answerQueen, buildQueenErrorBank, buildQueenEvolution, buildQueenMemory,
  buildQueenObservations, buildQueenOperationModes, queenLanguageStatus,
  QUEEN_QUICK_QUESTIONS, type QueenAnswer,
} from '../lib/queenCore.mjs'
import type { QueenChatResult } from '../lib/supabaseBackend'

interface ChatTurn { role: 'user' | 'queen'; text: string; answer?: QueenAnswer }
interface LanguageTry { state: 'idle' | 'busy' | 'done'; text?: string; provider?: string; reason?: string }

/* Consola de Queen (igualada al original): cabecera con el orbe
   Reactor en su etapa CALCULADA, conversación en burbujas con el
   núcleo determinista (queenCore) — cada respuesta con cifras lleva
   su línea de verificación —, «Lo que estoy viendo» desde los datos
   reales, «Lo próximo», «Memoria de Queen» con directivas, memoria
   aprendida, banco de errores y los 3 modos de permisos, y la capa
   de lenguaje opcional (Gemini con respaldo Cloudflare) con su
   estado honesto. Queen es 100 % texto y NO escribe desde el chat:
   su escritura está denegada en dinero, cuentas, IPV, ADN y
   permisos. La conversación vive en la sesión de esta pantalla. */
export default function QueenScreen({ data, supabaseMode, onTestLanguage }: {
  data: StoredData
  supabaseMode: boolean
  onTestLanguage?: (question: string, figures: Array<{ label: string; value: number | string }>) => Promise<QueenChatResult>
}) {
  const ref = todayISO()
  const evo = useMemo(() => buildQueenEvolution(data, ref), [data, ref])
  const memory = useMemo(() => buildQueenMemory(data), [data])
  const bank = useMemo(() => buildQueenErrorBank(data), [data])
  const modes = useMemo(() => buildQueenOperationModes(data), [data])
  const seeing = useMemo(() => buildQueenObservations(data, ref), [data, ref])
  const lang = useMemo(() => queenLanguageStatus(supabaseMode), [supabaseMode])

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [languageTry, setLanguageTry] = useState<LanguageTry>({ state: 'idle' })
  const lastAnswer = useRef<{ question: string; answer: QueenAnswer } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const ask = (question: string) => {
    const q = question.trim()
    if (!q) return
    const ans = answerQueen(data, q, { refDate: ref })
    lastAnswer.current = { question: q, answer: ans }
    setTurns((t) => [...t, { role: 'user', text: q }, { role: 'queen', text: ans.text, answer: ans }])
    setDraft('')
    setLanguageTry({ state: 'idle' })
    requestAnimationFrame(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) })
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask(draft) }

  const tryLanguage = async () => {
    if (!onTestLanguage || !lastAnswer.current) return
    setLanguageTry({ state: 'busy' })
    const res = await onTestLanguage(lastAnswer.current.question, lastAnswer.current.answer.figures)
    if (res.ok && res.text) setLanguageTry({ state: 'done', text: res.text, provider: res.provider })
    else setLanguageTry({ state: 'done', reason: res.reason ?? 'La capa de lenguaje no está configurada todavía.' })
  }

  const reactorState = bank.cells.length ? 'alert' : seeing.some((o) => o.level === 'alert') ? 'alert' : 'idle'
  const stageDef = QUEEN_REACTOR_STAGES[evo.stage.id]

  return (
    <div>
      <header className="tab-header">
        <span className="tab-header-icon" aria-hidden><QueenOrb size={26} stageId={evo.stage.id} /></span>
        <div className="tab-header-text">
          <h2 className="tab-header-title">Queen</h2>
          <p className="tab-header-desc">Organismo central del sistema · preguntas y acciones</p>
        </div>
        <span className="tab-header-chip">{TAB_BADGES.queen}</span>
      </header>

      <Card>
        <div className="evo-wrap">
          <QueenReactorMark stageId={evo.stage.id} state={reactorState} size={64} />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Reactor Evolutivo</p>
            <h3 className="evo-stage">Etapa {evo.stage.name}</h3>
            <p className="sub" style={{ margin: 0 }}>
              {evo.score != null
                ? <>Índice {evo.score} de 100{stageDef ? '' : ''}{evo.nextStage ? <> · hacia {evo.nextStage.name}: {fmtInt(evo.progressToNext)} %</> : ' · etapa máxima'}. {evo.stage.description}</>
                : evo.note}
            </p>
          </div>
        </div>
        {evo.score != null ? (
          <>
            <div className="queen-metrics">
              {evo.metrics.map((m) => (
                <div className="queen-metric" key={m.key}>
                  <span className="queen-metric-label">{m.label}</span>
                  <strong>{m.measured ? (m.key === 'precision' ? `${m.value} %` : fmtInt(m.value ?? 0)) : 'Sin medir'}</strong>
                  <span className="small muted">{m.measured ? `meta ${fmtInt(m.target)}` : 'no viaja en el respaldo'}</span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>{evo.note}</p>
          </>
        ) : null}
        <p className="small muted" style={{ margin: '8px 0 0' }}>Queen es 100 % texto, sin voz ni micrófono. Cuando responda con cifras, cada respuesta llevará su línea de verificación («Verificado contra: … · Sin verificar: …»).</p>
      </Card>

      <Card>
        <div className="queen-panel-head">
          <h3 style={{ margin: 0 }}>Conversación</h3>
          {turns.length ? (
            <button type="button" className="chip-btn" onClick={() => { setTurns([]); lastAnswer.current = null; setLanguageTry({ state: 'idle' }) }}>Borrar historial</button>
          ) : null}
        </div>
        <div className="queen-chat" ref={listRef}>
          {turns.length === 0 ? (
            <p className="sub" style={{ margin: 0 }}>Pregúntame por los datos reales de esta copia: ventas, ganancia, quién debe, morosas, cuadres, días sin IPV, nómina, gastos, la tarjeta y su conciliación, cambios y sugerencias de precio. Respondo en determinista — el código calcula, yo narro — y lo que no conste te lo digo: «no tengo ese dato».</p>
          ) : turns.map((t, i) => (
            <div key={i} className={`queen-bubble ${t.role}`}>
              <p>{t.text}</p>
              {t.answer && (t.answer.verifiedAgainst.length || t.answer.unverified.length) ? (
                <p className="queen-verify">
                  Verificado contra: {t.answer.verifiedAgainst.length ? t.answer.verifiedAgainst.join(' · ') : '—'}
                  {' · '}Sin verificar: {t.answer.unverified.length ? t.answer.unverified.join(' · ') : 'nada'}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <form className="queen-input-bar is-live" onSubmit={submit}>
          <input
            className="queen-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pregúntale a Queen…"
            aria-label="Pregúntale a Queen"
          />
          <button type="submit" className="queen-send" aria-label="Enviar pregunta"><Icon name="send" size={17} /></button>
        </form>

        <div className="queen-lang">
          <p className="small" style={{ margin: 0 }}>
            <strong>Capa de lenguaje:</strong> {lang.configured ? 'configurada' : 'sin configurar'}.
            {' '}{lang.note}
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
          {languageTry.state === 'done' && languageTry.reason ? (
            <p className="small muted" style={{ margin: '8px 0 0' }}>{languageTry.reason}</p>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="queen-panel-head">
          <QueenOrb size={26} stageId={evo.stage.id} state="suggestion" />
          <h3 style={{ margin: 0 }}>Lo que estoy viendo</h3>
        </div>
        {seeing.length ? (
          <ul className="queen-seeing">
            {seeing.map((o) => <li key={o.kind}>{o.text}</li>)}
          </ul>
        ) : (
          <p className="sub" style={{ margin: 0 }}>Todavía no hay datos que observar en esta copia: cuando se importe el respaldo, aquí aparecerán las observaciones calculadas de esos datos, sin inventar nada.</p>
        )}
      </Card>

      <Card>
        <h3>Lo próximo</h3>
        <p className="sub" style={{ margin: 0 }}>Las anticipaciones salen de las mismas observaciones verificadas: IPV que falta dentro del rango, cuentas que vencen y boletines en cola ya aparecen arriba en cuanto existen. No adelanto ninguna anticipación sin su dato.</p>
      </Card>

      <Card>
        <h3>Consultas y correcciones</h3>
        <p className="sub" style={{ margin: 0 }}>Si detecto algo que corregir, te lo propongo aquí y en el chat con su verificación contra el IPV; el cambio lo aplicas tú en su pantalla, con tu confirmación. Desde el chat no ejecuto correcciones: mi escritura está denegada en dinero, cuentas e IPV.</p>
      </Card>

      <Card>
        <h3>SMS de cobro</h3>
        <p className="sub" style={{ margin: 0 }}>Ningún SMS sale de esta copia: la bandeja de cobro del original exige verificar primero que la cuenta no esté pagada y tu confirmación antes de enviar. Si me preguntas por una cuenta, te respondo su saldo real y si está morosa.</p>
      </Card>

      <Card>
        <h3>Memoria de Queen</h3>
        <div className="queen-memory-rows">
          <div className="list-row" style={{ cursor: 'default' }}>
            <span className="grow">Directivas del dueño registradas</span>
            <span className="chip">{fmtInt(memory.directives.length)}</span>
          </div>
          <div className="list-row" style={{ cursor: 'default' }}>
            <span className="grow">Conceptos clasificados aprendidos</span>
            <span className="chip">{fmtInt(memory.learnedKinds.length)}</span>
          </div>
          <div className="list-row" style={{ cursor: 'default' }}>
            <span className="grow">Alias de identidad aprendidos</span>
            <span className="chip">{fmtInt(memory.aliases.length)}</span>
          </div>
          <div className="list-row" style={{ cursor: 'default' }}>
            <span className="grow">Decisiones tuyas por entrada (aplicadas)</span>
            <span className="chip">{fmtInt(memory.decisionsCount)}</span>
          </div>
        </div>
        <details className="queen-details">
          <summary>Directivas registradas</summary>
          <ul className="queen-seeing">
            {memory.directives.map((d) => <li key={d.id}><strong>{d.title}:</strong> {d.rule}</li>)}
          </ul>
        </details>
        {memory.learnedKinds.length ? (
          <details className="queen-details">
            <summary>Conceptos aprendidos (se aplican solos)</summary>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {memory.learnedKinds.map((c) => `${c.key} → ${c.kind}`).join(' · ')}
            </p>
            {memory.aliases.length ? (
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                Alias: {memory.aliases.map((a) => `${a.variant} → ${a.canonicalDisplay}`).join(' · ')}
              </p>
            ) : null}
          </details>
        ) : null}
        <details className="queen-details">
          <summary>Lo que no viaja en el respaldo</summary>
          <ul className="queen-seeing">
            {memory.notTraveling.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </details>

        <h4 style={{ margin: '14px 0 6px' }}>Banco de errores · Sistema inmune</h4>
        {bank.cells.length ? (
          <ul className="queen-seeing">
            {bank.cells.map((c) => (
              <li key={c.cellKey}><strong>{c.topic}:</strong> {c.symptoms} Anticuerpo: {c.antibody}</li>
            ))}
          </ul>
        ) : (
          <p className="sub" style={{ margin: 0 }}>Sin células: ningún error verificado en los datos cargados. No se siembran células de ejemplo.</p>
        )}

        <h4 style={{ margin: '14px 0 6px' }}>Permisos por modo</h4>
        <div className="queen-modes">
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
        <p className="small muted" style={{ margin: '8px 0 0' }}>La memoria de Queen es persistente y auditable: lo clasificado, unificado o corregido una vez queda aprendido y se aplica solo, con su confirmación visible («Aprendido: en adelante lo trato así»).</p>
      </Card>

      <Card>
        <h3>Preguntas rápidas</h3>
        <div className="quick-chips">
          {QUEEN_QUICK_QUESTIONS.map((q) => (
            <button key={q} type="button" className="view-chip" onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
      </Card>
    </div>
  )
}
