// Queen SDA — descarga de los IPV archivados de un día desde la
// media autenticada (kinds 'ipv-original' / 'ipv-actualizado',
// entity_key = fecha, variant = stem del archivo), como hace el
// original con su historial de versiones. Solo se ofrece cuando
// el archivo existe de verdad en la tabla media.

import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { downloadBlob } from '../lib/download'
import { extForMime, loadMediaBlob, loadMediaIndex, type MediaIndexItem } from '../lib/media'
import { fmtDate, fmtInt } from '../lib/utils'
import type { StoredData } from '../types'

export default function IpvDownloads({ date, data }: { date: string; data?: StoredData }) {
  const [files, setFiles] = useState<Array<{ item: MediaIndexItem; clase: string }>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadMediaIndex('ipv-original'), loadMediaIndex('ipv-actualizado')]).then(([orig, act]) => {
      if (cancelled) return
      setFiles([
        ...orig.filter((i) => i.entity_key === date).map((item) => ({ item, clase: 'original' })),
        ...act.filter((i) => i.entity_key === date).map((item) => ({ item, clase: 'actualizado' })),
      ])
    })
    return () => { cancelled = true }
  }, [date])

  if (!files.length) return null

  const originalItem = files.find((f) => f.clase === 'original')?.item ?? null

  // El IPV de vuelta se construye en el dispositivo desde el archivo
  // original guardado: reconciliación del original (solo se AGREGA lo
  // que el sistema tiene y el libro no trae; ninguna cifra se toca).
  const generateUpdated = async () => {
    if (!originalItem || !data) return
    setBusy('generar'); setMsg(null)
    try {
      const found = await loadMediaBlob(originalItem.kind, originalItem.entity_key, originalItem.variant)
      if (!found) { setMsg('No se pudo leer el IPV original guardado.'); return }
      const file = new File([found.blob], `${originalItem.variant || `ipv-${date}`}.xlsx`, { type: found.blob.type })
      const [{ parseDayFile, ipvPayloadToRawDay }, { buildIpvReconciliation }, { buildUpdatedIpv }] = await Promise.all([
        import('../lib/ipvCore.mjs'),
        import('../lib/ipvReconciliation'),
        import('../lib/ipvRoundTrip'),
      ])
      const payload = await parseDayFile(file)
      const rawDay = ipvPayloadToRawDay(payload)
      const reconciliation = buildIpvReconciliation(data, date, rawDay as never, data.extraIncomes.map((x) => ({ date: x.date, concept: x.concept, note: x.note, amount: x.amount, paymentMethod: x.paymentMethod, origin: x.origin })))
      const blob = await buildUpdatedIpv(file, date, reconciliation.additions, reconciliation.productBarcodes, reconciliation.nameCorrections, reconciliation.templateFingerprint)
      downloadBlob(blob, `IPV ${date} actualizado.xlsx`)
      const total = reconciliation.additions.length
      setMsg(total
        ? `IPV actualizado generado: ${fmtInt(total)} fila${total === 1 ? '' : 's'} agregada${total === 1 ? '' : 's'} por el sistema, sin tocar las cifras del archivo.`
        : 'IPV actualizado generado: el sistema no tenía nada que agregarle a este día.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo generar el IPV actualizado.')
    } finally { setBusy(null) }
  }

  const download = async (item: MediaIndexItem, clase: string) => {
    const key = `${item.kind}|${item.variant}`
    setBusy(key); setMsg(null)
    try {
      const found = await loadMediaBlob(item.kind, item.entity_key, item.variant)
      if (!found) { setMsg('No se pudo descargar el archivo.'); return }
      const filename = `${item.variant || `ipv-${clase}-${item.entity_key}`}.${extForMime(found.mime)}`
      downloadBlob(found.blob, filename)
      setMsg(`IPV ${clase} del ${fmtDate(date)} descargado (${filename}).`)
    } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="ipv-downloads" role="group" aria-label={`Archivos del IPV del ${fmtDate(date)}`}>
        {originalItem && data ? (
          <button type="button" className="btn primary" disabled={busy === 'generar'} onClick={() => void generateUpdated()}>
            <Icon name="download" size={15} /> {busy === 'generar' ? 'Generando…' : 'Descargar IPV actualizado'}
          </button>
        ) : null}
        {files.map(({ item, clase }) => {
          const key = `${item.kind}|${item.variant}`
          return (
            <button key={key} type="button" className="btn" disabled={busy === key} onClick={() => void download(item, clase)}>
              <Icon name="download" size={15} /> {busy === key ? 'Descargando…' : clase === 'original' ? 'Descargar IPV original' : 'Descargar IPV actualizado'}
            </button>
          )
        })}
      </div>
      {msg ? <p className="small muted" role="status" style={{ marginTop: 6 }}>{msg}</p> : null}
    </div>
  )
}
