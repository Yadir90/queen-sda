/* Verificación de PARIDAD ESPEJO (paquete de corrección 25-oct, mandato
   del dueño: «copia exacta de todo el sistema») contra la estructura
   portada del original. No sustituye a la batería de datos: comprueba
   que las piezas espejo existen en el código y en el CSS construido,
   que las desviaciones conocidas están declaradas y que lo que el
   original NO tiene (pestaña Cuentas, TabHeader en Sistema, «De un
   vistazo» en Inicio) no reaparece como elemento renderizado. */

import { readFileSync, readdirSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ok  ${name}`) }
  else { failed += 1; console.log(`  FALLO  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const sistema = read('src/screens/Sistema.tsx')
const systemMirror = read('src/components/systemMirror.tsx')
const systemCss = read('src/components/systemMirror.css')
const queen = read('src/screens/Queen.tsx')
const queenCss = read('src/components/queenMirror.css')
const queenCore = read('src/lib/queenCore.mjs')
const inicio = read('src/screens/Inicio.tsx')
const charts = read('src/components/charts.tsx')
const homeMirror = read('src/components/homeMirror.tsx')
const dias = read('src/screens/Dias.tsx')
const cobrar = read('src/screens/Cobrar.tsx')
const app = read('src/App.tsx')
const indexCss = read('src/index.css')
const secciones = read('src/screens/Secciones.tsx')
const sysReadings = read('src/lib/sysReadings.ts')

console.log('— Sistema —')
for (const piece of ['OrganismMap', 'DnaHelix', 'QueenBrain', 'IpvNeuralMap', 'IntegrationMap', 'runCriticalSimulation', 'StartupTimeline']) {
  check(`pieza espejo ${piece} en systemMirror`, systemMirror.includes(piece))
  check(`${piece} usada en Sistema`, sistema.includes(piece))
}
check('Sistema importa systemMirror.css', sistema.includes('systemMirror.css'))
check('Sistema SIN TabHeader renderizado', !sistema.includes('<TabHeader'))
check('Sistema sin tarjeta de reloj siempre primera (clock-card)', !sistema.includes('clock-card'))
check('actividad y notificaciones reales en Sistema', sistema.includes('system-activity-board') && sistema.includes('system-notification-feed'))
check('organizador declara guardado SOLO en este dispositivo', sistema.includes('localStorage') && /servidor/i.test(sistema))
const sysKeyframes = (systemCss.match(/@keyframes/g) ?? []).length
check(`keyframes portados a systemMirror.css (${sysKeyframes} >= 40)`, sysKeyframes >= 40)
for (const cls of ['organism-heartbeat-line', 'dna-helix', 'system-brain-orbits', 'system-ai-scan', 'ipv-neural', 'integration', 'premium']) {
  check(`clase del original presente: ${cls}*`, systemCss.includes(cls))
}
check('sysReadings siembra lecturas por jornada real', /seed|siembra|jornada/i.test(sysReadings) && sysReadings.length > 2000)

console.log('— Queen (consola) —')
for (const marker of ['Cómo lo comprobé', 'Aprender corrección', 'queen-typing', 'queen-draft', 'Anticipación', 'Memoria']) {
  check(`Queen: ${marker}`, queen.includes(marker))
}
check('Queen: tinte de burbujas por etapa', queen.includes('queen-chat-stage-'))
check('Queen: historial persistido (clave queen-chat)', queen.includes("'queen-chat'") || queen.includes('"queen-chat"'))
check('QueenCore: buildQueenAnticipations portado', queenCore.includes('buildQueenAnticipations'))
check('QueenCore: SMS declarado sin transporte, nunca simulado', queenCore.includes('Sin transporte en esta copia'))
check('queenMirror.css con queen-typing y etapas', queenCss.includes('queen-typing') && queenCss.includes('queen-chat-stage-'))

console.log('— Inicio / Días / Cobrar —')
for (const piece of ['DayTimeline', 'NightCloseConsole']) {
  check(`Inicio: ${piece} portado`, homeMirror.includes(piece) && inicio.includes(piece))
}
for (const piece of ['DeptCompareChart', 'BucketCompareChart', 'CashBars', 'LuminousBars']) {
  check(`gráfico ${piece} portado y usado`, charts.includes(piece) && inicio.includes(piece))
}
check('Inicio: «De dónde salen los totales de cuentas»', inicio.includes('De dónde salen los totales'))
check('Días: descarga del resumen del día', dias.includes('resumen-dia-'))
check('Cobrar: ReceiptPreviewCard + cronología', cobrar.includes('ReceiptPreviewCard') && cobrar.includes('Cronología'))

console.log('— App / navegación —')
check('pantalla de arranque queen-boot-screen', app.includes('queen-boot-screen') && app.includes('Preparando el sistema'))
check('CSS de arranque literal en index.css', indexCss.includes('.queen-boot-progress') && indexCss.includes('@keyframes queen-boot-scan'))
check('sin entrada «Cuentas» en la barra lateral', !app.includes("id: 'cuentas'"))
const items = secciones.match(/\{ name: '/g) ?? []
check(`Más: 19 secciones del original (${items.length})`, items.length === 19)
check('Más: sin tarjeta «Cuentas» y con «Existencias»', !secciones.includes("{ name: 'Cuentas'") && secciones.includes("{ name: 'Existencias'"))

console.log('— CSS construido (dist) —')
const assetsDir = new URL('dist/assets/', root)
if (existsSync(assetsDir)) {
  const css = readdirSync(assetsDir).filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(new URL(`dist/assets/${f}`, root), 'utf8')).join('\n')
  check('dist CSS: clases de Sistema (organism/dna)', css.includes('organism-') && css.includes('dna-'))
  check('dist CSS: queen-typing y etapas', css.includes('queen-typing') && css.includes('queen-chat-stage-'))
  check('dist CSS: arranque queen-boot', css.includes('queen-boot-screen'))
} else {
  check('dist existe (ejecuta npm run build antes)', false)
}

console.log(`\nverify:paridad — ${passed} ok, ${failed} fallos`)
process.exit(failed ? 1 : 0)
