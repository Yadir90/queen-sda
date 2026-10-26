// Queen SDA — FICHA COMPLETA del trabajador (puerto del original):
// documentos del trabajador, lienzo de firma, credencial digital
// con QR y escáner de credenciales. Se monta dentro de la ficha de
// RH (screens/RH.tsx), en el mismo orden del original: Documentos,
// Firma digital y Credencial de identificación.
//
// Adaptaciones de esta copia, declaradas y sin simular nada:
// - La FIRMA del original son trazos vectoriales (signature_data)
//   guardados en su servidor; en el clon se guarda la imagen PNG
//   del lienzo en public.media (kind 'firma-trabajador',
//   entity_key = slug(nombre), mime image/png), solo admin (RLS).
//   Hoy NO existe ninguna firma en el original (verificado:
//   signature_data vacío en las 25 fichas): la ficha parte sin
//   firma, como en el original.
// - La verificación automática del carnet del original usa la
//   extracción de su servidor (document_extracts): aquí se muestran
//   los datos de la ficha junto al documento y se declara «sin
//   extracción automática en esta copia»; no se simula extracción.
// - El PDF de la credencial del original lo dibuja su motor en
//   canvas (export.ts); aquí se genera desde la propia tarjeta con
//   la ventana de impresión del navegador (printHtml), con la foto,
//   el logo, el QR y la firma reales ya cargados de media.
// - qrcode y jsqr se cargan SOLO como import dinámico perezoso
//   (igual que el original): no pesan en el arranque de la app.
// - Documento único de contratación (WorkerHiringDocuments.tsx): el
//   asistente en 6 pasos del original con su formulario y su contrato
//   guardados en el extendido de la ficha; sus adaptaciones (firmas
//   de los firmantes por media, borrador de currículum en el
//   dispositivo, PDF por impresión) están declaradas en su cabecera.

import {
  useCallback, useEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Worker, WorkerExtended, WorkerHiringForm, WorkerWorkContract } from '../types'
import WorkerHiringDocuments, { type HiringCiclo, type HiringSigners } from './WorkerHiringDocuments'
import { Icon } from './icons'
import { WorkerPhoto } from './MediaImage'
import { printHtml } from '../lib/download'
import {
  deleteMedia, fileToBase64, loadMediaBlob, loadMediaDataUrl, loadMediaIndex,
  saveMedia, slug, type MediaIndexItem,
} from '../lib/media'
import {
  credentialNumericId, extendedForWorker, workerCredentialId, workerCredentialPayload,
  workerIdFromCredentialPayload, workerIdFromManualCode,
} from '../lib/workersExtended'
import './workerFicha.css'

/* ================= Firma (puerto de SignaturePad, original
   ~5750-5910): coordenadas 300×110, presión del lápiz en el grosor,
   rechazo de palma (el lápiz manda 1,6 s tras usarse), trazos con
   eventos coalescidos y resolución sincronizada al tamaño real. */

type SignaturePoint = { x: number; y: number; pressure?: number }
type SignatureStroke = SignaturePoint[]

function signatureLineWidth(point: SignaturePoint): number {
  return point.pressure == null ? 2.2 : 1.25 + Math.max(0.08, Math.min(1, point.pressure)) * 2.35
}

function FirmaPad({ worker, isAdmin, onSaved }: {
  worker: Worker
  isAdmin: boolean
  onSaved: () => void
}) {
  const entityKey = slug(worker.nombre)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeStroke = useRef<SignatureStroke | null>(null)
  const activePointerId = useRef<number | null>(null)
  const activePointerType = useRef<string | null>(null)
  const preferPenUntil = useRef(0)
  const [strokes, setStrokes] = useState<SignatureStroke[]>([])
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const reloadSaved = useCallback(() => {
    void loadMediaDataUrl('firma-trabajador', entityKey).then(setSavedUrl)
  }, [entityKey])
  useEffect(() => { setStrokes([]); setMsg(null); reloadSaved() }, [entityKey, reloadSaved])

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
      for (let i = 1; i < stroke.length; i++) {
        const prev = stroke[i - 1]; const point = stroke[i]
        if (prev && point) drawSegment(context, prev, point)
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
        canvas.width = width; canvas.height = height; drawAll()
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
    if (!isAdmin) return
    if (event.pointerType === 'touch' && (Date.now() < preferPenUntil.current || !event.isPrimary || event.width > 28 || event.height > 28)) return
    if (event.pointerType === 'pen') {
      preferPenUntil.current = Date.now() + 1600
      const previousPointer = activePointerId.current
      activeStroke.current = null; activePointerId.current = null; activePointerType.current = null
      if (previousPointer != null && previousPointer !== event.pointerId && event.currentTarget.hasPointerCapture(previousPointer)) {
        event.currentTarget.releasePointerCapture(previousPointer)
      }
    } else if (activePointerId.current != null) return
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
    activeStroke.current = null; activePointerId.current = null; activePointerType.current = null
    if (stroke && stroke.length >= 2) setStrokes((current) => [...current, stroke])
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const clear = () => { setStrokes([]); activeStroke.current = null; activePointerId.current = null; activePointerType.current = null }

  const save = async () => {
    if (!strokes.length || busy) return
    setBusy(true); setMsg(null)
    try {
      // La firma se guarda como imagen PNG del lienzo (media
      // 'firma-trabajador'): se rasterizan los trazos a 600×220.
      const off = document.createElement('canvas')
      off.width = 600; off.height = 220
      const ctx = off.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 600, 220)
      ctx.setTransform(2, 0, 0, 2, 0, 0)
      ctx.strokeStyle = '#10251c'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      for (const stroke of strokes) {
        for (let i = 1; i < stroke.length; i++) {
          const prev = stroke[i - 1]; const point = stroke[i]
          if (!prev || !point) continue
          ctx.lineWidth = signatureLineWidth(point)
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(point.x, point.y); ctx.stroke()
        }
      }
      const dataUrl = off.toDataURL('image/png')
      await saveMedia({
        kind: 'firma-trabajador', entityKey, variant: '', label: worker.nombre,
        mime: 'image/png', dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      })
      setStrokes([])
      reloadSaved()
      onSaved()
      setMsg('Firma guardada: aparecerá en su credencial y, cuando corresponda, en la nómina.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo guardar la firma.')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      await deleteMedia('firma-trabajador', entityKey)
      reloadSaved()
      onSaved()
      setMsg('Firma guardada eliminada.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo eliminar la firma.')
    } finally { setBusy(false) }
  }

  return (
    <div className="wf-signature" aria-label="Firma digital del trabajador">
      <p className="wf-signature-title">Firma digital</p>
      <p className="wf-signature-desc">Firma con el lápiz óptico o con el dedo. Con lápiz, el grosor responde a la presión y el lienzo descarta el apoyo de la palma. Al guardar, aparecerá en su credencial y, cuando corresponda, en la nómina.</p>
      {savedUrl ? (
        <div className="wf-signature-saved">
          <img src={savedUrl} alt={`Firma digital de ${worker.nombre}`} />
          <span className="small muted">Firma guardada en esta copia (media del servidor).</span>
        </div>
      ) : <p className="small muted" style={{ marginTop: 6 }}>Sin firma guardada todavía: parte sin firma, como en el sistema original.</p>}
      {isAdmin ? (
        <>
          <canvas
            ref={canvasRef}
            onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
            onLostPointerCapture={finish} onContextMenu={(e) => e.preventDefault()}
            className="wf-signature-canvas"
            aria-label="Lienzo para firma digital compatible con lápiz óptico y rechazo de palma"
          />
          <div className="wf-signature-actions">
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !strokes.length}>{busy ? 'Guardando…' : 'Guardar firma'}</button>
            <button type="button" className="btn" onClick={clear} disabled={busy || !strokes.length}>Limpiar lienzo</button>
            {savedUrl ? <button type="button" className="btn" style={{ color: 'var(--danger)' }} onClick={() => void remove()} disabled={busy}>Eliminar firma guardada</button> : null}
          </div>
        </>
      ) : <p className="small muted" style={{ marginTop: 6 }}>Solo el administrador puede registrar o cambiar la firma.</p>}
      {msg ? <p className="small" role="status" style={{ marginTop: 6 }}>{msg}</p> : null}
    </div>
  )
}

/* ================= Documentos del trabajador (puerto de la UI de
   la ficha del original ~7749-7830): carné anverso/reverso, tarjeta
   bancaria, título y otros documentos, en media
   'documento-trabajador' con su variant. ================= */

const FIXED_DOCS: Array<{ variant: string; label: string }> = [
  { variant: 'carnet-frente', label: 'Carné · anverso' },
  { variant: 'carnet-reverso', label: 'Carné · reverso' },
  { variant: 'tarjeta-bancaria', label: 'Tarjeta bancaria · una cara' },
  { variant: 'titulo', label: 'Título de escolaridad' },
]

function WorkerDocuments({ worker, isAdmin }: { worker: Worker; isAdmin: boolean }) {
  const entityKey = slug(worker.nombre)
  const [items, setItems] = useState<MediaIndexItem[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [extraLabel, setExtraLabel] = useState('')
  const fileRefs = useRef(new Map<string, HTMLInputElement | null>())
  const extraFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadMediaIndex('documento-trabajador').then((list) => {
      if (!cancelled) setItems(list.filter((i) => i.entity_key === entityKey))
    })
    return () => { cancelled = true }
  }, [entityKey, reloadKey])

  const openItem = async (item: MediaIndexItem) => {
    const found = await loadMediaBlob('documento-trabajador', item.entity_key, item.variant)
    if (!found) { setMsg('No se pudo abrir el documento.'); return }
    const url = URL.createObjectURL(found.blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  const upload = async (variant: string, label: string, file: File | null) => {
    if (!file || busy) return
    setBusy(true); setMsg(null)
    try {
      const { base64, mime } = await fileToBase64(file)
      await saveMedia({ kind: 'documento-trabajador', entityKey, variant, label, mime, dataBase64: base64 })
      setReloadKey((k) => k + 1)
      setMsg(`«${label}» guardado.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo guardar el documento.')
    } finally { setBusy(false) }
  }

  const remove = async (item: MediaIndexItem, label: string) => {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      await deleteMedia('documento-trabajador', item.entity_key, item.variant)
      setReloadKey((k) => k + 1)
      setMsg(`«${label}» eliminado.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo eliminar el documento.')
    } finally { setBusy(false) }
  }

  const byVariant = new Map(items.map((i) => [i.variant, i]))
  const extras = items.filter((i) => i.variant.startsWith('extra-'))

  const docCell = (variant: string, label: string) => {
    const item = byVariant.get(variant)
    const isPdf = item?.mime === 'application/pdf'
    return (
      <div key={variant} className="wf-doc">
        <p className="wf-doc-label">{label}</p>
        {item ? (
          isPdf ? (
            <button type="button" className="wf-doc-pdf" onClick={() => void openItem(item)}>
              <span><Icon name="doc" size={26} /><strong className="block">PDF guardado</strong><span className="small">Toca para verlo</span></span>
            </button>
          ) : (
            <DocThumb item={item} label={label} onOpen={() => void openItem(item)} />
          )
        ) : <div className="wf-doc-empty">Sin documento</div>}
        {isAdmin ? (
          <div className="wf-doc-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => fileRefs.current.get(variant)?.click()}>
              {item ? 'Reemplazar' : 'Subir imagen o PDF'}
            </button>
            {item ? <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => void remove(item, label)}>Eliminar</button> : null}
            <input
              ref={(el) => { fileRefs.current.set(variant, el) }}
              type="file" accept="image/*,application/pdf" hidden
              onChange={(e) => { void upload(variant, label, e.target.files?.[0] ?? null); e.target.value = '' }}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="wf-docs" aria-label={`Documentos de ${worker.nombre}`}>
      <p className="wf-docs-title">Documentos</p>
      <p className="small muted">Puedes escanear con la cámara o elegir una imagen o PDF del dispositivo. Los documentos viven en la media autenticada del servidor (tabla media), nunca como archivos públicos.</p>
      <div className="wf-docs-grid">
        {FIXED_DOCS.map((d) => docCell(d.variant, d.label))}
      </div>

      <div className="wf-docs-extra">
        <p className="wf-docs-title" style={{ fontSize: '0.9rem' }}>Otros documentos</p>
        <p className="small muted">Pon un nombre claro y sube una imagen o un PDF.</p>
        {extras.length ? (
          <ul className="wf-docs-extra-list">
            {extras.map((item) => (
              <li key={item.variant}>
                <button type="button" className="wf-docs-extra-open" onClick={() => void openItem(item)}>
                  <span className="block" style={{ fontWeight: 600 }}>{item.label}</span>
                  <span className="small muted">{item.mime === 'application/pdf' ? 'PDF' : 'Imagen'} · {Math.max(1, Math.round(item.bytes / 1024))} KB</span>
                </button>
                {isAdmin ? <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => void remove(item, item.label)}>Eliminar</button> : null}
              </li>
            ))}
          </ul>
        ) : <p className="small muted">Sin otros documentos todavía.</p>}
        {isAdmin ? (
          <div className="wf-docs-extra-form">
            <input
              type="text" value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)}
              placeholder="Ej.: certificado médico" aria-label="Nombre del otro documento"
            />
            <button
              type="button" className="btn primary" disabled={busy || !extraLabel.trim()}
              onClick={() => extraFileRef.current?.click()}
            >Subir imagen o PDF</button>
            <input
              ref={extraFileRef} type="file" accept="image/*,application/pdf" hidden
              onChange={(e) => {
                const label = extraLabel.trim()
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                if (label && file) { void upload(`extra-${slug(label)}`, label, file); setExtraLabel('') }
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Comparación ficha ↔ documento SIN extracción automática:
          el original extrae los datos del carnet en su servidor
          (document_extracts) y los contrasta; esta copia no tiene
          ese extractor y lo declara: la comparación es visual. */}
      <div className="wf-docs-compare">
        <p style={{ fontWeight: 700, fontSize: '0.9rem', margin: '0 0 4px' }}>Datos de la ficha frente a los documentos</p>
        <table className="kv" style={{ marginTop: 0 }}>
          <tbody>
            <tr><td>Nombre en la ficha</td><td>{worker.nombre}</td></tr>
            <tr><td>Carné en la ficha</td><td>{worker.carnet || '—'}</td></tr>
            <tr><td>Cuenta bancaria en la ficha</td><td>{worker.cuentaBancaria || '—'}</td></tr>
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 6 }}>
          Sin extracción automática en esta copia: en el sistema original el servidor lee el carné
          y la tarjeta (document_extracts) y muestra aquí el resultado de esa extracción comparado
          con la ficha. Aquí la comprobación es visual, abriendo el documento; no se simula
          ninguna lectura automática.
        </p>
      </div>
      {msg ? <p className="small" role="status" style={{ marginTop: 6 }}>{msg}</p> : null}
    </div>
  )
}

function DocThumb({ item, label, onOpen }: { item: MediaIndexItem; label: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadMediaDataUrl('documento-trabajador', item.entity_key, item.variant).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [item])
  if (!url) return <div className="wf-doc-empty">Cargando…</div>
  return (
    <button type="button" className="wf-doc-thumb" onClick={onOpen} aria-label={`Ver ${label}`}>
      <img src={url} alt={label} loading="lazy" decoding="async" />
    </button>
  )
}

/* ================= Credencial digital (puerto de
   WorkerCredentialCardFace / WorkerCredentialPreview del original
   ~6387-6530): tarjeta 638/1011 con las ondas SVG literales, logo
   blanco de La Reina (activo-sistema), foto, nombre, cargo, CI, QR
   del identificador workerCredentialId y la firma guardada. */

type QrMatrix = { size: number; get: (row: number, col: number) => boolean }
let qrModulePromise: Promise<typeof import('qrcode')> | null = null
let qrReaderPromise: Promise<typeof import('jsqr')['default']> | null = null

async function createQrMatrix(payload: string): Promise<QrMatrix> {
  const module = await (qrModulePromise ??= import('qrcode'))
  const code = module.create(payload, { errorCorrectionLevel: 'M' })
  return code.modules as unknown as QrMatrix
}

async function getQrReader() {
  return (qrReaderPromise ??= import('jsqr').then((module) => module.default))
}

function CredentialQr({ payload }: { payload: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    void createQrMatrix(payload).then((matrix) => {
      if (cancelled || !ref.current) return
      const canvas = ref.current
      const quiet = 4
      const count = matrix.size + quiet * 2
      const scale = Math.max(1, Math.floor(240 / count))
      canvas.width = count * scale
      canvas.height = count * scale
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#071e24'
      for (let row = 0; row < matrix.size; row++) {
        for (let col = 0; col < matrix.size; col++) {
          if (matrix.get(row, col)) context.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale)
        }
      }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [payload])
  if (failed) return <span className="small muted">QR no disponible en este dispositivo.</span>
  return <canvas ref={ref} className="wf-cred-qr" aria-label="Código QR de identificación" />
}

function CredencialCara({ worker, numericId, photoUrl, logoUrl, defaultUrl, firmaUrl }: {
  worker: Worker
  numericId: number
  photoUrl: string | null
  logoUrl: string | null
  defaultUrl: string | null
  firmaUrl: string | null
}) {
  return (
    <div className="wf-cred" role="img" aria-label={`Credencial digital de ${worker.nombre}`}>
      <svg aria-hidden="true" viewBox="0 0 638 1011" preserveAspectRatio="none" className="wf-cred-bg">
        <path d="M0 0H638V178C557 232 470 255 366 236C246 214 154 167 0 173Z" fill="#006cbe" />
        <path d="M0 0H638V76C511 137 425 171 294 139C185 112 102 69 0 53Z" fill="#12b7dd" />
        <path d="M0 19C90 111 166 147 287 151C410 155 506 103 638 20V107C518 196 393 220 266 187C154 158 78 112 0 79Z" fill="#00a59d" opacity=".72" />
        <path d="M0 176C87 212 142 255 186 335L123 875H0Z" fill="#33b965" />
        <path d="M0 230C81 311 112 422 102 557C94 680 53 781 0 873Z" fill="#76c82a" />
        <path d="M0 181C94 224 152 304 196 417L111 535C90 391 53 290 0 244Z" fill="#009a77" opacity=".8" />
        <path d="M0 856C132 918 235 914 345 874C469 829 548 837 638 880V1011H0Z" fill="#0077c8" />
        <path d="M0 931C146 878 248 930 348 956C457 985 538 947 638 889V1011H0Z" fill="#10b8d2" />
        <path d="M355 1011C468 936 551 894 638 871V1011Z" fill="#72bf2a" />
        <path d="M440 1011C502 948 558 920 638 905V1011Z" fill="#00986f" opacity=".85" />
        <path d="M88 835C207 790 285 741 363 669C455 583 541 546 638 548V805C535 806 457 834 357 887C262 937 166 953 76 921Z" fill="#e7eaed" opacity=".72" />
      </svg>
      <div className="wf-cred-logo">
        {logoUrl ? <img src={logoUrl} alt="Logo oficial blanco de La Reina" /> : null}
      </div>
      <p className="wf-cred-brand">PDL La Reina<br /><span>Restaurante · Bar</span></p>
      <div className="wf-cred-photo">
        {photoUrl || defaultUrl
          ? <img src={photoUrl ?? defaultUrl ?? ''} alt={photoUrl ? `Foto de ${worker.nombre}` : 'Foto pendiente'} />
          : <span className="wf-cred-photo-fallback">{worker.nombre.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="wf-cred-data">
        <p className="wf-cred-name">{worker.nombre}</p>
        <p className="wf-cred-role">{worker.ocupacion || 'Ocupación pendiente'}</p>
        <p className="wf-cred-ci">CI: <strong>{worker.carnet || 'Pendiente'}</strong></p>
      </div>
      <div className="wf-cred-qrbox">
        <CredentialQr payload={workerCredentialPayload(numericId)} />
      </div>
      <div className="wf-cred-sign">
        <div className="wf-cred-sign-line">
          {firmaUrl ? <img src={firmaUrl} alt={`Firma digital de ${worker.nombre}`} /> : null}
        </div>
        <p>Firma</p>
      </div>
    </div>
  )
}

function WorkerCredential({ worker, extended, firmaVersion }: {
  worker: Worker
  extended: WorkerExtended | null
  firmaVersion: number
}) {
  const numericId = credentialNumericId(worker, extended)
  const payload = workerCredentialPayload(numericId)
  const [media, setMedia] = useState<{ photo: string | null; logo: string | null; def: string | null; firma: string | null; loaded: boolean }>(
    { photo: null, logo: null, def: null, firma: null, loaded: false },
  )
  const [screenOpen, setScreenOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadMediaDataUrl('foto-trabajador', slug(worker.nombre)),
      loadMediaDataUrl('activo-sistema', 'la-reina-logo-blanco-transparente'),
      loadMediaDataUrl('activo-sistema', 'default-person-avatar'),
      loadMediaDataUrl('firma-trabajador', slug(worker.nombre)),
    ]).then(([photo, logo, def, firma]) => {
      if (!cancelled) setMedia({ photo, logo, def, firma, loaded: true })
    })
    return () => { cancelled = true }
  }, [worker.nombre, firmaVersion])

  const missing = media.loaded
    ? [!media.photo ? 'foto' : '', !worker.ocupacion.trim() ? 'ocupación' : '', !worker.carnet.trim() ? 'carné' : '', !media.firma ? 'firma' : ''].filter(Boolean)
    : []

  const generatePdf = async () => {
    if (busy || missing.length) return
    setBusy(true); setMsg(null)
    try {
      // PDF desde la propia tarjeta: se reconstruye la credencial
      // en HTML con los binarios reales (foto, logo, firma y el QR
      // dibujado desde la misma matriz) y se abre la ventana de
      // impresión del navegador, la vía de documentos de esta copia.
      const matrix = await createQrMatrix(payload)
      const qrCanvas = document.createElement('canvas')
      const quiet = 4
      const count = matrix.size + quiet * 2
      const scale = Math.max(2, Math.floor(256 / count))
      qrCanvas.width = count * scale; qrCanvas.height = count * scale
      const qctx = qrCanvas.getContext('2d')
      if (qctx) {
        qctx.fillStyle = '#ffffff'; qctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height)
        qctx.fillStyle = '#071e24'
        for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
          if (matrix.get(r, c)) qctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale)
        }
      }
      const qrUrl = qrCanvas.toDataURL('image/png')
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Credencial de ${esc(worker.nombre)}</title>
<style>@page{size:A4;margin:14mm}body{margin:0;font-family:Arial,Helvetica,sans-serif;display:flex;justify-content:center;padding:24px}
.card{position:relative;width:390px;aspect-ratio:638/1011;border-radius:28px;overflow:hidden;background:linear-gradient(180deg,#006cbe 0 18%,#ffffff 18% 86%,#0077c8 86%);border:1px solid #ddd;text-align:center;color:#16223a}
.logo{height:150px;display:flex;align-items:center;justify-content:center}.logo img{max-height:140px;max-width:60%}
.brand{font-weight:800;letter-spacing:.06em;color:#12323f;margin:6px 0 0}
.photo{width:140px;height:140px;border-radius:50%;border:6px solid #45bd54;object-fit:cover;margin:26px auto 0;background:#fff}
.name{font-size:26px;font-weight:900;text-transform:uppercase;margin:120px 24px 0}
.role{font-size:16px;font-weight:600;margin:6px 24px 0}.ci{font-size:14px;margin:6px 24px 0}
.bottom{position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:space-between;align-items:flex-end;padding:0 34px}
.qr{background:#fff;padding:4px}.qr img{width:86px;height:86px;display:block}
.sign{width:150px}.sign img{max-width:100%;max-height:64px}.sign .line{border-bottom:1.5px solid #182239}.sign p{margin:4px 0 0;font-size:11px;font-weight:600}
.id{position:absolute;bottom:6px;left:0;right:0;font-size:9px;color:#5b6f63}</style></head>
<body><div class="card">
<div class="logo">${media.logo ? `<img src="${media.logo}" alt="">` : ''}</div>
<p class="brand">PDL LA REINA · RESTAURANTE · BAR</p>
${media.photo ? `<img class="photo" src="${media.photo}" alt="">` : ''}
<p class="name">${esc(worker.nombre)}</p>
<p class="role">${esc(worker.ocupacion)}</p>
<p class="ci">CI: <strong>${esc(worker.carnet)}</strong></p>
<div class="bottom"><div class="qr"><img src="${qrUrl}" alt="QR"></div>
<div class="sign">${media.firma ? `<img src="${media.firma}" alt="">` : ''}<div class="line"></div><p>Firma</p></div></div>
<p class="id">${esc(workerCredentialId(numericId))}</p>
</div></body></html>`
      const ok = printHtml(html)
      setMsg(ok
        ? 'Credencial abierta para imprimir o guardar como PDF (vía de documentos de esta copia: ventana de impresión del navegador, desde la propia tarjeta).'
        : 'El navegador bloqueó la ventana de la credencial. Permite las ventanas emergentes e inténtalo de nuevo.')
    } catch {
      setMsg('No se pudo generar la credencial en este dispositivo.')
    } finally { setBusy(false) }
  }

  return (
    <section className="wf-cred-wrap" aria-label={`Credencial de identificación de ${worker.nombre}`}>
      <div>
        <p className="wf-cred-title">Credencial de identificación digital</p>
        <p className="small muted">El identificador único del sistema está dentro del QR y no aparece impreso en la tarjeta.</p>
      </div>
      <div className="wf-cred-holder">
        <CredencialCara worker={worker} numericId={numericId} photoUrl={media.photo} logoUrl={media.logo} defaultUrl={media.def} firmaUrl={media.firma} />
      </div>
      {screenOpen ? (
        <div className="wf-cred-overlay" role="dialog" aria-modal="true" aria-label={`Credencial digital de ${worker.nombre}`}>
          <div style={{ width: '100%', maxWidth: 390 }}>
            <CredencialCara worker={worker} numericId={numericId} photoUrl={media.photo} logoUrl={media.logo} defaultUrl={media.def} firmaUrl={media.firma} />
          </div>
          <div className="wf-cred-overlay-actions">
            <p>Credencial digital lista para mostrar desde el móvil. Para que el QR se lea mejor, sube el brillo de la pantalla.</p>
            <button type="button" className="btn primary" onClick={() => setScreenOpen(false)}><Icon name="x" size={16} /> Cerrar</button>
          </div>
        </div>
      ) : null}
      {missing.length ? (
        <p className="wf-cred-missing">Completa {missing.join(', ')} para generar la credencial final.</p>
      ) : null}
      <div className="wf-cred-actions">
        <button type="button" className="btn" onClick={() => setScreenOpen(true)} disabled={missing.length > 0}>
          <Icon name="eye" size={15} /> Mostrar credencial digital
        </button>
        <button type="button" className="btn primary" onClick={() => void generatePdf()} disabled={busy || missing.length > 0}>
          <Icon name="download" size={15} /> {busy ? 'Generando credencial…' : 'Descargar credencial en PDF'}
        </button>
      </div>
      {msg ? <p className="small" role="status" style={{ marginTop: 6 }}>{msg}</p> : null}
    </section>
  )
}

/* ================= Escáner de credenciales (puerto de
   WorkerQrScanner del original ~6674-6760): cámara con jsqr en
   import dinámico, foto del QR como respaldo y, en esta copia,
   entrada manual del código como respaldo sin cámara/permiso. */

export function WorkerQrScanner({ workers, extendedList, onOpenWorker }: {
  workers: Worker[]
  extendedList: WorkerExtended[]
  onOpenWorker: (worker: Worker) => void
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [foundId, setFoundId] = useState<number | null>(null)
  const [manual, setManual] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastReadRef = useRef(0)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const byNumericId = useCallback((numericId: number): { worker: Worker; extended: WorkerExtended | null } | null => {
    for (const w of workers) {
      const ext = extendedForWorker(w, extendedList)
      if (credentialNumericId(w, ext) === numericId) return { worker: w, extended: ext }
    }
    return null
  }, [workers, extendedList])

  const found = foundId == null ? null : byNumericId(foundId)

  const stop = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const acceptDecoded = useCallback((raw: string): boolean => {
    const id = workerIdFromCredentialPayload(raw)
    if (id == null) { setStatus('Ese QR no es una credencial de PDL La Reina.'); return false }
    if (!byNumericId(id)) { setStatus(`Identificación ${workerCredentialId(id)} no encontrada en el registro activo.`); return false }
    setFoundId(id)
    setStatus('Trabajador identificado.')
    stop()
    return true
  }, [byNumericId, stop])

  const readImageData = useCallback(async (imageData: ImageData): Promise<boolean> => {
    const reader = await getQrReader()
    const result = reader(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
    return result?.data ? acceptDecoded(result.data) : false
  }, [acceptDecoded])

  const start = useCallback(async () => {
    stop()
    setFoundId(null)
    setStatus('Solicitando acceso a la cámara…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stop(); return }
      video.srcObject = stream
      await video.play()
      setStatus('Apunta al QR de la credencial.')
      const canvas = document.createElement('canvas')
      const tick = async (time: number) => {
        if (!streamRef.current) return
        if (time - lastReadRef.current > 220 && video.readyState >= 2) {
          lastReadRef.current = time
          const width = Math.min(720, video.videoWidth || 720)
          const scale = width / Math.max(1, video.videoWidth || width)
          const height = Math.max(1, Math.round((video.videoHeight || 540) * scale))
          canvas.width = width; canvas.height = height
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (context) {
            context.drawImage(video, 0, 0, width, height)
            try {
              if (await readImageData(context.getImageData(0, 0, width, height))) return
            } catch { setStatus('No se pudo leer este cuadro. Mantén el QR dentro del marco.') }
          }
        }
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)
    } catch {
      setStatus('No se pudo abrir la cámara. Puedes elegir una foto del QR o escribir el código de la credencial.')
    }
  }, [readImageData, stop])

  useEffect(() => () => stop(), [stop])

  const readPhoto = async (file: File | null) => {
    if (!file) return
    stop()
    setFoundId(null)
    setStatus('Leyendo la foto del QR…')
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('image')); image.src = url })
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('canvas')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const ok = await readImageData(context.getImageData(0, 0, canvas.width, canvas.height))
      if (!ok) setStatus('No se encontró un QR legible en la foto.')
    } catch { setStatus('No se pudo leer esa foto. Prueba de nuevo con más luz y el QR completo.') } finally {
      URL.revokeObjectURL(url)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submitManual = () => {
    const id = workerIdFromManualCode(manual)
    if (id == null) { setStatus('Escribe el código de la credencial (LR-TRAB-000016) o su número.'); return }
    if (!byNumericId(id)) { setStatus(`Identificación ${workerCredentialId(id)} no encontrada en el registro activo.`); return }
    stop()
    setFoundId(id)
    setStatus('Trabajador identificado.')
  }

  return (
    <section className="card wf-scanner" aria-label="Escáner de credenciales de trabajadores">
      <div className="wf-scanner-head">
        <div>
          <h3 className="font-display" style={{ margin: 0 }}>Escáner de credenciales</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Lee el QR con la cámara y muestra la ficha que corresponde.</p>
        </div>
        <button
          type="button" className="btn primary" aria-expanded={open}
          onClick={() => { if (open) { stop(); setOpen(false); setFoundId(null) } else { setOpen(true); requestAnimationFrame(() => void start()) } }}
        >
          <Icon name="camera" size={15} /> {open ? 'Cerrar escáner' : 'Escanear QR'}
        </button>
      </div>
      {open ? (
        <div style={{ marginTop: 12 }}>
          <div className="wf-scanner-video">
            <video ref={videoRef} playsInline muted aria-label="Cámara para escanear el código QR" />
            {!found ? <div aria-hidden="true" className="wf-scanner-frame" /> : null}
          </div>
          {status ? <p className="small" role="status" style={{ marginTop: 8 }}>{status}</p> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {!found ? <button type="button" className="btn" onClick={() => void start()}>Reiniciar cámara</button> : null}
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Elegir foto del QR</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void readPhoto(e.target.files?.[0] ?? null)} />
          </div>
          <form
            className="wf-scanner-manual"
            onSubmit={(e) => { e.preventDefault(); submitManual() }}
          >
            <label htmlFor="wf-manual-code">Sin cámara: escribe el código de la credencial</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                id="wf-manual-code" type="text" value={manual} onChange={(e) => setManual(e.target.value)}
                placeholder="LR-TRAB-000016" autoComplete="off"
              />
              <button type="submit" className="btn primary">Buscar ficha</button>
            </div>
          </form>
          {found ? (
            <div className="wf-scanner-found" aria-label={`Resultado: ${found.worker.nombre}`}>
              <WorkerPhoto nombre={found.worker.nombre} className="wf-scanner-found-photo" avatarClassName="wf-scanner-found-avatar" colorKey={found.worker.key} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="font-display" style={{ fontWeight: 700, margin: 0 }}>{found.worker.nombre}</p>
                <p className="small muted" style={{ margin: '2px 0 0' }}>{found.worker.ocupacion || 'Sin ocupación registrada'}</p>
                <p className="small" style={{ margin: '4px 0 0' }}>Carné: <strong>{found.worker.carnet || 'Sin completar'}</strong></p>
                <p className="small muted" style={{ margin: '2px 0 0' }}>{workerCredentialId(credentialNumericId(found.worker, found.extended))}</p>
                <button type="button" className="btn primary" style={{ marginTop: 8 }} onClick={() => onOpenWorker(found.worker)}>Abrir ficha del trabajador</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** La ficha completa de RH: documentos, firma y credencial, en el
 *  orden del original, con la firma compartida entre el lienzo y
 *  la credencial (al guardarla, la credencial la repinta). */
export default function WorkerFichaCompleta({ worker, extended, isAdmin, signers, ciclo, onSaveHiring, onMessage }: {
  worker: Worker
  extended: WorkerExtended | null
  isAdmin: boolean
  /** Firmantes del documento (Administrador/Director) detectados en
   *  el registro; sin ellos el asistente muestra los avisos del
   *  original y no exporta. */
  signers?: HiringSigners
  ciclo?: HiringCiclo | null
  onSaveHiring?: (hiringForm: WorkerHiringForm, workContract: WorkerWorkContract) => Promise<void>
  onMessage?: (message: string) => void
}) {
  const [firmaVersion, setFirmaVersion] = useState(0)
  return (
    <>
      <WorkerDocuments worker={worker} isAdmin={isAdmin} />
      <FirmaPad worker={worker} isAdmin={isAdmin} onSaved={() => setFirmaVersion((v) => v + 1)} />
      <WorkerCredential worker={worker} extended={extended} firmaVersion={firmaVersion} />
      {/* El asistente de contratación vive dentro de la ficha de cada
          trabajador que no es de Dirección, como en el original. */}
      {worker.roleKind !== 'direccion' && onSaveHiring ? (
        <WorkerHiringDocuments
          key={`${worker.key}-${extended?.hiringForm?.updatedAt ?? 'new'}-${extended?.workContract?.updatedAt ?? 'new'}`}
          worker={worker}
          extended={extended}
          isAdmin={isAdmin}
          signers={signers ?? { administrator: null, director: null }}
          ciclo={ciclo ?? null}
          onSave={onSaveHiring}
          onMessage={onMessage ?? (() => {})}
        />
      ) : null}
    </>
  )
}
