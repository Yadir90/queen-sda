/* Escáner de códigos de barras con la cámara (D-12): getUserMedia +
   jsQR sobre los fotogramas, sin librerías de pago ni servicios. El
   original escanea igual en el navegador; el código leído se entrega
   al formulario y la búsqueda del producto va por barcodeLookup.
   Sin cámara o sin permiso se dice claro y se puede escribir el
   código a mano: el escáner nunca bloquea el registro. */

import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Icon } from './icons'

export function BarcodeScanner({ onScanned, onClose }: {
  onScanned: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const doneRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false
    const canvas = document.createElement('canvas')
    const tick = () => {
      if (cancelled || doneRef.current) return
      const video = videoRef.current
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (found && found.data.trim()) {
            doneRef.current = true
            onScanned(found.data.trim())
            return
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => { /* el tick reintenta al estar listo */ })
          raf = requestAnimationFrame(tick)
        }
      } catch {
        if (!cancelled) setError('No se pudo abrir la cámara. Revisa el permiso de cámara del navegador o escribe el código a mano.')
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onScanned])

  return (
    <div className="barcode-scanner" role="dialog" aria-modal="true" aria-label="Escanear código de barras">
      <div className="barcode-scanner-head">
        <strong><Icon name="camera" size={16} /> Escanear código de barras</strong>
        <button type="button" className="btn" onClick={onClose}>Cerrar</button>
      </div>
      {error ? (
        <div className="error-box">{error}</div>
      ) : (
        <>
          <div className="barcode-scanner-frame">
            <video ref={videoRef} playsInline muted aria-label="Vista de la cámara para escanear" />
            <span className="ipv-scanner-beam" aria-hidden="true" />
          </div>
          <p className="small muted">Apunta al código de barras del producto: al leerlo se rellena solo y se busca el producto.</p>
        </>
      )}
    </div>
  )
}
