/* Genera supabase/media-import.sql desde media-export/manifest.json
   (extracción verificada del almacenamiento del sistema original).
   La media queda en la tabla public.media, tras el login (RLS:
   lectura con rol, escritura admin). NADA se publica como archivo
   estático: firmas, carnets y documentos personales no salen de la
   vía autenticada.
   Contrato de claves (entity_key / variant): ver el bloque MEDIA
   de supabase/schema.sql. Uso: node scripts/generate-media-sql.mjs */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('media-export/manifest.json', root), 'utf8'))

const slug = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const stem = (archivo) => archivo.split('/').pop().replace(/\.[a-z0-9]+$/i, '')
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`

function keysFor(e) {
  const st = stem(e.archivo)
  switch (e.tipo) {
    case 'foto-producto':
    case 'foto-almacen':
    case 'activo-sistema':
      return { entity_key: st, variant: '' }
    case 'foto-trabajador':
      return { entity_key: slug(e.entidad.replace(/\s*\(trabajador #\d+\)\s*$/, '')), variant: '' }
    case 'documento-trabajador': {
      const [nombre, doc] = e.entidad.split(' — ')
      return { entity_key: slug((nombre ?? '').replace(/\s*\(trabajador #\d+\)\s*$/, '')), variant: slug(doc ?? '') }
    }
    case 'foto-cliente':
      return { entity_key: slug(e.entidad), variant: '' }
    case 'foto-perfil':
      return { entity_key: 'perfil-admin', variant: '' }
    case 'ipv-original':
    case 'ipv-actualizado': {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(e.entidad)
      return { entity_key: m ? m[1] : st, variant: st }
    }
    case 'adjunto-correo':
      return { entity_key: st.replace(/\.pdf$/i, ''), variant: st }
    case 'grafico-correo': {
      const id = e.entidad.split(' · ')[0]
      return { entity_key: slug(id), variant: st }
    }
    default:
      return { entity_key: st, variant: '' }
  }
}

const rows = []
for (const e of manifest) {
  const buf = readFileSync(new URL(`media-export/${e.archivo}`, root))
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== e.sha256) throw new Error(`sha256 no coincide: ${e.archivo}`)
  if (buf.length !== e.bytes) throw new Error(`bytes no coinciden: ${e.archivo}`)
  const { entity_key, variant } = keysFor(e)
  rows.push({ kind: e.tipo, entity_key, variant, label: e.entidad, mime: e.mime, bytes: buf.length, sha256: sha, b64: buf.toString('base64') })
}

const seen = new Set()
for (const r of rows) {
  const k = `${r.kind}|${r.entity_key}|${r.variant}`
  if (seen.has(k)) throw new Error(`clave duplicada: ${k}`)
  seen.add(k)
}

let out = `-- Queen SDA — importación de media autenticada (tabla public.media).\n`
out += `-- Generado por scripts/generate-media-sql.mjs desde media-export/ (extracción\n`
out += `-- verificada del almacenamiento del original: sha256 y bytes por archivo).\n`
out += `-- ${rows.length} filas. Aplicar DESPUÉS de supabase/schema.sql. Idempotente:\n`
out += `-- sustituye el contenido completo de public.media.\nbegin;\ndelete from public.media;\n`
for (const r of rows) {
  out += `insert into public.media (kind, entity_key, variant, label, mime, bytes, sha256, data_base64) values (${sqlStr(r.kind)}, ${sqlStr(r.entity_key)}, ${sqlStr(r.variant)}, ${sqlStr(r.label)}, ${sqlStr(r.mime)}, ${r.bytes}, ${sqlStr(r.sha256)}, ${sqlStr(r.b64)});\n`
}
out += `commit;\n`
writeFileSync(new URL('supabase/media-import.sql', root), out)
console.log(`media-import.sql: ${rows.length} filas, ${(out.length / 1048576).toFixed(2)} MiB`)
const byKind = {}
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
console.log(byKind)
