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
const immuneField = read('src/components/ImmuneLiveField.tsx')
const immuneCss = read('src/components/immuneLive.css')

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

console.log('— Sistema inmune en vivo (Banco de errores) —')
check('ImmuneLiveField presente y usado en Sistema (dentro de la tarjeta de errores)', sistema.includes("from '../components/ImmuneLiveField'") && sistema.includes('<ImmuneLiveField'))
check('campo montado en la tarjeta «Banco de errores · Sistema inmune»', sistema.indexOf('Banco de errores · Sistema inmune') < sistema.indexOf('<ImmuneLiveField') && sistema.indexOf('<ImmuneLiveField') < sistema.indexOf("case 'tareas'"))
check('canvas immune en el componente del campo', immuneField.includes('<canvas') && immuneField.includes('immune-canvas') && immuneField.includes('immune-stage'))
check('IMM_LANES con los 5 carriles del original', immuneField.includes('const IMM_LANES = ["IPV", "Cuentas", "RH", "Almacén", "Boletines"]'))
check('botón Pausar/Reanudar del campo', immuneField.includes('setPaused') && immuneField.includes('"Reanudar" : "Pausar"') && immuneField.includes('Pausar la animación del sistema inmune'))
check('botón de etiquetas activas/ocultas', immuneField.includes('setLabels') && immuneField.includes('Etiquetas {labels ? "activas" : "ocultas"}'))
check('registro en vivo immune-log', immuneField.includes('immune-log') && immuneField.includes('Registro en vivo') && immuneField.includes('pushLog'))
check('ficha de célula bajo el lienzo (error, firma, anticuerpo, estado, neutralizaciones)', immuneField.includes('Ficha de la célula tocada') && immuneField.includes('Qué error vigila') && immuneField.includes('Su firma') && immuneField.includes('Su anticuerpo') && immuneField.includes('Su estado') && immuneField.includes('Neutralizaciones:'))
check('anomalías contenidas en ámbar esperando el sí', immuneField.includes('ESPERANDO TU «SÍ»') && immuneField.includes('"contenida"') && immuneField.includes('requiresApproval'))
check('HUD y medidor de amenazas del campo', immuneField.includes('immune-hud') && immuneField.includes('immune-threat-fill') && immuneField.includes('Nivel de amenaza') && immuneField.includes('Banco de memoria'))
check('campo alimentado del banco del clon (buildQueenErrorBank → buildImmuneBankView)', sistema.includes('buildQueenErrorBank(data)') && sistema.includes('buildImmuneBankView(model.errorBank)') && immuneField.includes('export function buildImmuneBankView') && immuneField.includes('bank.knownThreats') && immuneField.includes('bank.cells'))
check('campo SIN banco de datos fijos (nada de células sembradas a mano)', !/cells:\s*\[\s*\{/.test(immuneField) && !immuneField.includes('cuadre-20'))
check('rendimiento A16 del campo (paso fijo 60 Hz, DPR ≤1.5, movimiento reducido)', immuneField.includes('const STEP = 1 / 60') && immuneField.includes('Math.min(1.5, window.devicePixelRatio || 1)') && immuneField.includes('prefers-reduced-motion: reduce') && immuneField.includes('IntersectionObserver'))
check('CSS immune-* portado (escenario, log, tags, oscuro)', immuneCss.includes('.immune-stage') && immuneCss.includes('.immune-canvas') && immuneCss.includes('.immune-log') && immuneCss.includes('.immune-tag-con') && immuneCss.includes('.immune-threat-fill') && immuneCss.includes('@media (prefers-color-scheme: dark)'))
check('componente importa su CSS immuneLive.css', immuneField.includes("import './immuneLive.css'"))

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

console.log('— Oleada 3: las 6 secciones de «Más» conectadas —')
const types = read('src/types.ts')
const archivo = read('src/screens/Archivo.tsx')
const entradas = read('src/screens/Entradas.tsx')
const extras = read('src/screens/Extras.tsx')
const existencias = read('src/screens/Existencias.tsx')
const cronologia = read('src/screens/Cronologia.tsx')
const ajustes = read('src/screens/Ajustes.tsx')
for (const s of ['archivo', 'entradas', 'extras', 'existencias', 'cronologia', 'ajustes']) {
  check(`Section incluye '${s}'`, types.includes(`| '${s}'`))
  check(`Más: tarjeta con destino a '${s}'`, secciones.includes(`go: '${s}'`))
  check(`App renderiza la sección '${s}'`, app.includes(`section === '${s}'`))
}
check('Más: ninguna tarjeta «Siguiente fase»', !secciones.includes('Siguiente fase'))
check('Archivo: resúmenes monthlyArchives + «Lo que NO se archiva»', archivo.includes('monthlyArchives') && archivo.includes('Lo que NO se archiva'))
check('Archivo: archivar mes declarado como acción del servidor, no fingido', archivo.includes('no lo cambia desde aquí'))
check('Entradas: detalle entriesDetail del IPV (EntradasTab)', entradas.includes('entriesDetail') && entradas.includes('EntradasTab'))
check('Entradas: fotos de factura declaradas como no viajeras', entradas.includes('no viajan en el respaldo'))
check('Extras: pantalla ExtrasTab desde los extras del día', extras.includes('ExtrasTab') && extras.includes('d.extras'))
check('Extras: categorías del original (Coctelería/Pizzería/Entrada/Mesas)', extras.includes('Coctelería') && extras.includes('Pizzería') && extras.includes('Mesas'))
check('Existencias: destino propio con el libro de Productos (buildInventoryBook)', existencias.includes('buildInventoryBook') && existencias.includes('ExistenciasTab'))
check('Existencias: ajustes manuales declarados sin puerto', existencias.includes('no los registra'))
check('Cronología: CRONO_CATS con las 6 categorías', cronologia.includes('CRONO_CATS') && cronologia.includes("'boletines'"))
check('Cronología: eventos derivados de registros reales (catálogo, nóminas, boletines)', cronologia.includes('buildProductsCatalog') && cronologia.includes('payrollHistory') && cronologia.includes('workerPayments'))
check('Ajustes: pantalla AjustesTab con ancla real y destinatarios', ajustes.includes('AjustesTab') && ajustes.includes('saveRhSettings') && ajustes.includes('BULLETIN_RECIPIENTS'))
check('Ajustes: PIN/biometría declarados sustituidos por la capa de acceso', ajustes.includes('no tiene PIN ni biometría'))

console.log('— CSS construido (dist) —')
const assetsDir = new URL('dist/assets/', root)
if (existsSync(assetsDir)) {
  const css = readdirSync(assetsDir).filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(new URL(`dist/assets/${f}`, root), 'utf8')).join('\n')
  check('dist CSS: clases de Sistema (organism/dna)', css.includes('organism-') && css.includes('dna-'))
  check('dist CSS: sistema inmune en vivo (immune-stage/canvas/log)', css.includes('immune-stage') && css.includes('immune-canvas') && css.includes('immune-log'))
  check('dist CSS: queen-typing y etapas', css.includes('queen-typing') && css.includes('queen-chat-stage-'))
  check('dist CSS: arranque queen-boot', css.includes('queen-boot-screen'))
  check('dist CSS: oleada 3 (crono-list, mod-table, mod-bar-track)', css.includes('crono-list') && css.includes('mod-table') && css.includes('mod-bar-track'))
} else {
  check('dist existe (ejecuta npm run build antes)', false)
}

/* ===== Oleadas 3b–3e: tarjetas, solar, temas ===== */
{
  const allCss = ['index.css', 'components/systemMirror.css', 'components/sectionsMirror.css', 'components/queenMirror.css', 'components/homeMirror.css', 'components/immuneLive.css']
    .map((f) => read(`src/${f}`)).join('\n')
  const cobrar = read('src/screens/Cobrar.tsx')
  const mediaImg = read('src/components/MediaImage.tsx')
  const sysTsx = read('src/components/systemMirror.tsx')
  const utils = read('src/lib/utils.ts')
  console.log('\n— Oleadas 3b–3e: tarjetas de contacto/cuenta, solar, paridad de temas —')
  check('tarjeta de contacto del original presente (contact-card-oneui + banda RH + stats)',
    cobrar.includes('contact-card-oneui') && cobrar.includes('Enlazado con RH') && cobrar.includes('Días al pagar') && cobrar.includes('Aún no hay clientes'))
  check('avatar del contacto: foto-cliente vía media o avatar genérico del original',
    mediaImg.includes("'default-person-avatar'") && mediaImg.includes('pickClientPhoto'))
  check('tarjeta de cuenta: vigenciaCuenta y marcas portadas del original',
    cobrar.includes('Morosa · plazo vencido') && cobrar.includes('Consumo de la casa') && cobrar.includes('hsl(${hue}, 72%') && cobrar.includes('vigenciaCuenta'))
  check('cuentas pendientes: grupo por deudor con avatar de cabecera de 48 px (debtorAvatar del original, App.tsx:12012)',
    cobrar.includes('renderAccountGroup') && cobrar.includes('account-group-avatar') && indexCss.includes('.account-group-avatar') && indexCss.includes('width: 48px; height: 48px'))
  check('el avatar de las pendientes vive en la cabecera del grupo (ClientAvatar del grupo, no el «paid ?» de la tarjeta)',
    cobrar.includes('<ClientAvatar name={g.display} clientKey={g.clientKey} className="account-group-avatar" />'))
  check('plazo de trabajador en días hábiles (utils: addBusinessDays/businessDaysElapsed)',
    utils.includes('addBusinessDaysISO') && utils.includes('businessDaysElapsed'))
  check('solar: @keyframes ipv-node-orbit dentro de @supports (width: 1cqw)',
    allCss.includes('@keyframes ipv-node-orbit') && allCss.includes('@supports (width: 1cqw)'))
  check('solar: keyframes ipv-planet-float e ipv-heartbeat definidos',
    /@keyframes ipv-planet-float/.test(allCss) && /@keyframes ipv-heartbeat/.test(allCss))
  check('solar: pausa fuera de pantalla (IntersectionObserver) en el mapa de IPV',
    sysTsx.includes('IntersectionObserver') && sysTsx.includes('is-paused'))
  const animNames = new Set()
  for (const m of allCss.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+/)[0]
      if (name && /^[a-zA-Z_][\w-]*$/.test(name) && !/^(none|inherit|initial|unset|linear|ease|ease-in|ease-out|ease-in-out|infinite|both|forwards|backwards|alternate|alternate-reverse|reverse|normal|running|paused)$/.test(name)) animNames.add(name)
    }
  }
  const defined = new Set([...allCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
  const missing = [...animNames].filter((n) => !defined.has(n))
  check(`barrido de animaciones: ${animNames.size} referenciadas, todas definidas (faltan: ${missing.join(', ') || 'ninguna'})`, missing.length === 0)
  check('paleta oscura alineada con el original (fondo pizarra, deep oscuro)',
    read('src/index.css').includes('--bg: #0c141b') && read('src/index.css').includes('--deep: #102b27'))
}

console.log(`\nverify:paridad — ${passed} ok, ${failed} fallos`)
process.exit(failed ? 1 : 0)
