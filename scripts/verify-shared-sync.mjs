/* verify:sync — los núcleos .mjs de src/lib y sus gemelos de
   supabase/functions/_shared deben ser byte a byte idénticos: es la
   convención del repo (el mismo núcleo corre en el navegador y en las
   funciones del servidor). Cualquier divergencia es un fallo. */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(root, 'src', 'lib')
const sharedDir = join(root, 'supabase', 'functions', '_shared')

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
let ok = 0
let fail = 0
const names = readdirSync(libDir).filter((f) => f.endsWith(".mjs")).sort()
/* Par diseñado de la obra de biometría: el núcleo de cliente y el de
   servidor son archivos distintos a propósito (no son gemelos). */
const DESIGNED_SINGLE = new Set(["webauthnClientCore.mjs", "webauthnCore.mjs"])
for (const name of names) {
  const twin = join(sharedDir, name)
  if (DESIGNED_SINGLE.has(name)) { console.log(`  ok  ${name} (par diseñado, sin gemelo)`); ok += 1; continue }
  if (!existsSync(twin)) {
    console.log(`  FALLO  ${name}: sin gemelo en supabase/functions/_shared`)
    fail += 1
    continue
  }
  if (hash(join(libDir, name)) === hash(twin)) { ok += 1; console.log(`  ok  ${name}`) }
  else { fail += 1; console.log(`  FALLO  ${name}: difiere de su gemelo`) }
}
for (const name of readdirSync(sharedDir).filter((f) => f.endsWith('.mjs')).sort()) {
  if (!names.includes(name) && !DESIGNED_SINGLE.has(name)) console.log(`  nota  ${name}: solo existe en _shared (sin gemelo en src/lib)`)
}
console.log(`\nverify:sync — ${ok} ok, ${fail} fallos`)
process.exit(fail ? 1 : 0)
