/* Descargas en el navegador (así funciona el sistema externo):
   los documentos se generan en el propio dispositivo desde los
   datos ya cargados y se descargan en el momento. */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/**
 * Abre el documento HTML en una ventana lista para imprimir o
 * guardar como PDF (el «PDF» del navegador, con el estilo
 * aurora de los documentos del sistema).
 */
export function printHtml(html: string) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.addEventListener('load', () => {
    setTimeout(() => { try { w.focus(); w.print() } catch { /* la ventana queda abierta con el documento */ } }, 350)
  })
  return true
}
