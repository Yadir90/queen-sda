/* Verificación del INVENTARIO CERRADO de paridad (INVENTARIO-PARIDAD.md)
   contra el código del clon. Recorre cada línea de tabla del inventario:
   - PRESENTE: el token de comprobación DEBE aparecer en src/.
   - AUSENTE: el token NO debe aparecer en src/ (si aparece, la línea
     quedó desactualizada: hay que actualizar el inventario).
   - PARCIAL: solo se cuenta (su evidencia es manual).
   Uso: node scripts/verify-inventario.mjs [--verbose]
   Sale con código 1 si hay inconsistencias. */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)
const verbose = process.argv.includes('--verbose')

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(tsx?|mjs|css)$/.test(e.name)) acc.push(p)
  }
  return acc
}
const srcText = walk(new URL('src/', root).pathname)
  .map((p) => readFileSync(p, 'utf8')).join('\n')

const inv = readFileSync(new URL('INVENTARIO-PARIDAD.md', root), 'utf8').split('\n')
let presente = 0, parcial = 0, ausente = 0, fallos = 0
const problemas = []
inv.forEach((line, i) => {
  if (!line.startsWith('|')) return
  const cols = line.replace(/\\\|/g, '').split('|').map((c) => c.trim().replace(//g, '|'))
  // cols: ['', '#', 'Elemento', 'Original', 'Destino', 'Estado', 'Token', 'Evidencia', '']
  if (cols.length < 8) return
  const estadoM = /\*\*(PRESENTE|PARCIAL|AUSENTE)\*\*/.exec(cols[5] ?? '')
  if (!estadoM) return
  const estado = estadoM[1]
  const tokM = /`([^`]+)`/.exec(cols[6] ?? '')
  if (!tokM) { problemas.push(`línea ${i + 1}: sin token (${cols[2]})`); fallos += 1; return }
  const token = tokM[1]
  const found = srcText.includes(token)
  if (estado === 'PRESENTE') {
    presente += 1
    if (!found) { problemas.push(`línea ${i + 1} [PRESENTE sin token] ${cols[2]} — token: ${token}`); fallos += 1 }
  } else if (estado === 'AUSENTE') {
    ausente += 1
    if (found) { problemas.push(`línea ${i + 1} [AUSENTE pero el token EXISTE en src] ${cols[2]} — token: ${token} → actualizar inventario`); fallos += 1 }
  } else {
    parcial += 1
    if (verbose) console.log(`  parcial: ${cols[2]} (token ${found ? 'presente' : 'ausente'})`)
  }
})
console.log(`Inventario: PRESENTE ${presente} · PARCIAL ${parcial} · AUSENTE ${ausente}`)
for (const p of problemas) console.log(`  FALLO  ${p}`)
console.log(fallos ? `\nRESULTADO: ${fallos} inconsistencias inventario↔código.` : '\nRESULTADO: OK — inventario y código coinciden.')
process.exit(fallos ? 1 : 0)
