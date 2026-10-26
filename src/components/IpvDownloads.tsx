// Queen SDA — descarga de los IPV archivados de un día desde la
// media autenticada (kinds 'ipv-original' / 'ipv-actualizado',
// entity_key = fecha, variant = stem del archivo), como hace el
// original con su historial de versiones. Solo se ofrece cuando
// el archivo existe de verdad en la tabla media.

import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { downloadBlob } from '../lib/download'
import { extForMime, loadMediaBlob, loadMediaIndex, type MediaIndexItem } from '../lib/media'
import { fmtDate } from '../lib/utils'

export default function IpvDownloads({ date }: { date: string }) {
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
