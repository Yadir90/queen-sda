#!/usr/bin/env node
/* Queen SDA — Auditoría visual sintética (harness reconstruido, 2026-10-26).
 *
 * QUÉ HACE
 *   Renderiza la app en un Chromium headless real, en MODO LOCAL (sin
 *   Supabase: build propio con VITE_SUPABASE_URL/ANON_KEY vacías, cuyo
 *   CSS sale byte-idéntico al de dist/ — se comprueba en la corrida),
 *   sembrada por la vía real de la app: login local → cambio de
 *   contraseña → «Importar respaldo del SDA» con la foto fresca.
 *   Recorre TODAS las pantallas en claro/oscuro × 360 px y 1280 px y
 *   mide, por combinación: desborde horizontal de página, elementos
 *   que se salen del viewport (descontando los recortados por un
 *   ancestro con overflow), texto cortado (candidatos), solapes entre
 *   elementos fijos, errores de consola y que la pantalla renderice.
 *   Además: chequeo dedicado del «Sistema inmune en vivo» (estructura
 *   DOM, píxeles del canvas y toque que abre la tarjeta de la célula)
 *   y chequeos estáticos sobre el CSS ENTREGADO (dist/): paridad de
 *   tokens claro/oscuro, reglas de ancho (≤360 y banda tablet) y
 *   animaciones de entrada sin transform en contenedores.
 *
 * USO
 *   node scripts/audit-visual.mjs [--backup <json>] [--out <dir>]
 *                                 [--build <dir>] [--no-build]
 *   Requiere playwright-core (devDependency) y un Chromium: el de la
 *   caché de Playwright (~/.cache/ms-playwright), CHROME_PATH o uno
 *   del sistema. Sin Chromium, el script lo dice y sale con código 2:
 *   NUNCA simula la auditoría.
 *
 * SALIDA
 *   <out>/report.json + capturas en <out>/screens/ e <out>/immune/.
 *   Código 1 si hay defectos duros; 0 si todo pasa (los candidatos de
 *   texto cortado y avisos quedan en el informe para revisión).
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const OUT = path.resolve(REPO, opt('--out', 'audits/audit-2026-10-26'))
const NO_BUILD = args.includes('--no-build')
const BUILD_DIR = opt('--build', null)

function defaultBackup() {
  const dir = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups')
  const fresh = path.join(dir, 'backup-sda-2026-10-26.json')
  if (fs.existsSync(fresh)) return fresh
  if (fs.existsSync(dir)) {
    const all = fs.readdirSync(dir).filter((f) => /^backup-sda-.*\.json$/.test(f)).sort()
    if (all.length) return path.join(dir, all[all.length - 1])
  }
  return null
}
const BACKUP = opt('--backup', null) || defaultBackup()

/* Las vistas de la app (App.tsx): las 17 de la matriz original
   (15 pantallas + «cuentas» y «mas») más las 6 que la oleada 3
   conectó desde «Más» = 23 vistas × 2 temas × 2 anchos = 92
   combinaciones. */
const SCREENS = [
  { id: 'inicio', label: 'Inicio', sel: '[aria-label="Tipo de período"]', text: 'Resumen de hoy' },
  { id: 'dias', label: 'Días', sel: '[aria-label="Leyenda de intensidad por venta del día"]', text: 'días importados' },
  { id: 'cobrar', label: 'Cobrar', sel: '[aria-label="Cobrar y clientes"]', text: 'Comprobantes' },
  { id: 'cuentas', label: 'Ver cuentas', via: 'inicio', sel: '[aria-label="Cobrar y clientes"]', text: 'Días al pagar', chipActivo: 'Clientes' },
  { id: 'queen', label: 'Queen', sel: '[aria-label="Conversación con Queen"]', text: 'Queen' },
  { id: 'sistema', label: 'Sistema', sel: '[aria-label="De un vistazo"]', text: 'De un vistazo' },
  { id: 'rh', label: 'RH · Pagos', sel: '[aria-label="Organigrama del equipo por áreas y turnos, en flujo de trabajo"]', text: 'Organigrama del equipo' },
  { id: 'economia', label: 'Economía', sel: '[aria-label="Mes a analizar"]', text: 'Flujo operativo proyectado' },
  { id: 'transferencias', label: 'Transferencias', sel: '[aria-label="Tipo de movimiento"]', text: 'Transferencias' },
  { id: 'productos', label: 'Productos', sel: '[aria-label="Vista de productos"]', text: 'Productos' },
  { id: 'elaboracion', label: 'Elaboración', sel: '[aria-label="Secciones de Elaboración"]', text: 'Elaboración' },
  { id: 'almacen', label: 'Almacén', sel: '[aria-label="Tipo de movimiento de almacén"]', text: 'Almacén' },
  { id: 'inventario', label: 'Inventario', sel: null, text: 'bienes del local' },
  { id: 'laboratorio', label: 'Laboratorio', sel: '[aria-label="Filtrar productos por categoría"]', text: 'Laboratorio' },
  { id: 'documentos', label: 'Documentos', sel: null, text: 'Firmas y cuño' },
  { id: 'historial', label: 'Historial', sel: null, text: 'Meses del archivo' },
  { id: 'mas', label: 'Más', sel: '.mas-grid', text: 'días importados' },
  /* Oleada 3: las 6 secciones que «Más» conectó (Ajustes, Archivo,
     Cronología, Entradas, Existencias, Otros ingresos) se auditan
     como vistas propias, llegando por su tarjeta de la rejilla. */
  { id: 'ajustes', label: 'Ajustes', via: 'mas', sel: '[aria-label="Ajustes"]', text: 'Perfil y acceso' },
  { id: 'archivo', label: 'Archivo', via: 'mas', sel: '[aria-label="Archivo mensual"]', text: 'Lo que NO se archiva' },
  { id: 'cronologia', label: 'Cronología', via: 'mas', sel: '[aria-label="Cronología del sistema"]', text: 'línea de tiempo' },
  { id: 'entradas', label: 'Entradas', via: 'mas', sel: null, text: 'Inversión del mes' },
  { id: 'existencias', label: 'Existencias', via: 'mas', sel: null, text: 'Libro al día con el IPV del' },
  { id: 'extras', label: 'Otros ingresos', via: 'mas', sel: null, text: 'en el Resultado' },
]
const WIDTHS = [
  { w: 360, h: 780 },   // Galaxy A16 (SM-A165M)
  { w: 1280, h: 800 },  // pantalla grande
]
const THEMES = ['light', 'dark']

// ---------- utilidades ----------
function findChromium() {
  const cands = []
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH)
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
      cands.push(path.join(cache, d, 'chrome-linux64/chrome'))
      cands.push(path.join(cache, d, 'chrome-linux/chrome'))
      cands.push(path.join(cache, d, 'chrome-linux64/headless_shell'))
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable')
  return cands.find((c) => fs.existsSync(c)) || null
}

function buildLocalVariant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-audit-build-'))
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
    cwd: REPO,
    env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    stdio: 'pipe',
  })
  return dir
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(dir, decodeURIComponent(url.pathname))
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dir, 'index.html')
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function cssHashes(dir) {
  const out = {}
  const assets = path.join(dir, 'assets')
  if (!fs.existsSync(assets)) return out
  for (const f of fs.readdirSync(assets).filter((x) => x.endsWith('.css'))) {
    out[f] = execFileSync('sha256sum', [path.join(assets, f)]).toString().split(' ')[0]
  }
  return out
}

// ---------- chequeos estáticos sobre el CSS entregado (dist/) ----------
function splitMediaBlocks(css) {
  const media = []
  let base = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@media', i)
    if (at < 0) { base += css.slice(i); break }
    base += css.slice(i, at)
    const brace = css.indexOf('{', at)
    const header = css.slice(at, brace).trim()
    let depth = 0
    let j = brace
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    media.push({ header, body: css.slice(brace + 1, j) })
    i = j + 1
  }
  return { base, media }
}
function rootTokens(css) {
  const tokens = {}
  const re = /:root\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    for (const decl of m[1].split(';')) {
      const d = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/)
      if (d) tokens[d[1]] = d[2]
    }
  }
  return tokens
}
const isColorish = (name, value) =>
  !value.startsWith('var(') &&
  !/radius|font|shadow/.test(name) &&
  /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix|gradient/.test(value)
function staticChecks() {
  const distAssets = path.join(REPO, 'dist/assets')
  const css = fs.readdirSync(distAssets).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(distAssets, f), 'utf8')).join('\n')
  const { base, media } = splitMediaBlocks(css)
  // El CSS minificado escribe «@media(prefers-color-scheme:dark)» sin
  // espacios: la detección del bloque oscuro ha de tolerarlo.
  const lightCss = media.filter((b) => /prefers-color-scheme:\s*light/.test(b.header)).map((b) => b.body).join('\n')
  const light = { ...rootTokens(lightCss), ...rootTokens(base) }
  const darkCss = media.filter((b) => /prefers-color-scheme:\s*dark/.test(b.header)).map((b) => b.body).join('\n')
  const dark = rootTokens(darkCss)
  // Acentos constantes a propósito: el propio bloque oscuro del
  // theme.css original TAMPOCO redefine --accent-ink, --gold ni
  // --on-accent (heredan el claro allí igual que aquí); la skill
  // permite heredar acentos constantes. Se listan aparte.
  const CONSTANT_OK = new Set(['--accent-ink', '--gold', '--on-accent'])
  const missingDark = Object.entries(light)
    .filter(([n, v]) => isColorish(n, v) && !(n in dark) && !CONSTANT_OK.has(n)).map(([n]) => n)
  const constantesHeredados = Object.keys(light).filter((n) => CONSTANT_OK.has(n) && !(n in dark))
  const shadowNote = ('--card-shadow' in light && !('--card-shadow' in dark))
    ? '--card-shadow conserva en oscuro el valor claro (sombra con rgb(11 61 46 / …) de día): señalado por la skill como token a vigilar, no bloquea.'
    : null
  const maxW = new Set(); const minW = new Set()
  for (const b of media) {
    for (const m of b.header.matchAll(/max-width:\s*(\d+)px/g)) maxW.add(+m[1])
    for (const m of b.header.matchAll(/min-width:\s*(\d+)px/g)) minW.add(+m[1])
  }
  // Keyframes con transform y a qué selectores se aplican.
  const kfTransform = []
  const kfRe = /@keyframes\s+([\w-]+)\s*\{/g
  let km
  while ((km = kfRe.exec(css))) {
    let depth = 0; let j = kfRe.lastIndex - 1
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break }
    if (/transform/.test(css.slice(kfRe.lastIndex, j))) kfTransform.push(km[1])
    kfRe.lastIndex = j + 1
  }
  const containerAnimations = []
  for (const name of kfTransform) {
    const useRe = new RegExp(`([^{}]+)\\{[^{}]*animation[^;{}]*\\b${name}\\b`, 'g')
    let um
    while ((um = useRe.exec(css))) {
      const sel = um[1].trim().split(',').pop().trim()
      if (/(^|[\s.])(main|app-shell|layout|scroll)/.test(sel)) containerAnimations.push(`${sel} → ${name}`)
    }
  }
  // Inmune: evidencia en fuente (CSS + campo en vivo).
  const immuneCss = fs.readFileSync(path.join(REPO, 'src/components/immuneLive.css'), 'utf8')
  const field = fs.readFileSync(path.join(REPO, 'src/components/ImmuneLiveField.tsx'), 'utf8')
  const lineOf = (txt, needle) => { const i = txt.indexOf(needle); return i < 0 ? null : txt.slice(0, i).split('\n').length }
  const immune = {
    stageBgClaroSolido: /\.immune-stage\s*\{[^}]*background:\s*#[0-9a-f]{6}/i.test(immuneCss),
    stageBgOscuroSolido: /prefers-color-scheme: dark\)\s*\{\s*\.immune-stage\s*\{\s*background:\s*#[0-9a-f]{6}/i.test(immuneCss),
    fondoSolidoEnCanvas: lineOf(field, '"#0a1e26"') != null && lineOf(field, '"#e9f3ee"') != null,
    bandasAlternasPorCarril: /bandas alternas por carril/i.test(field) && (field.match(/fillStyle = darkNow/g) || []).length >= 2,
    rotulosDeCarrilEnPastilla: lineOf(field, 'Rótulo del carril sobre pastilla') != null,
    celulaCuerpoBordeNucleo: lineOf(field, 'createRadialGradient') != null && lineOf(field, 'R * 0.42') != null,
    anomaliaContornoYPunto: lineOf(field, '#e0524a') != null && lineOf(field, 'R * 0.13') != null,
    etiquetasEnPastillaSolida: /fillStyle = darkNow \? "rgba\(3,14,19,.82\)" : "rgba\(255,255,255,.88\)"/.test(field),
  }
  return {
    tokensClaro: Object.keys(light).length,
    tokensOscuro: Object.keys(dark).length,
    tokensColorSinRedefinirEnOscuro: missingDark,
    constantesHeredados,
    shadowNote,
    breakpoints: { maxWidth: [...maxW].sort((a, b) => a - b), minWidth: [...minW].sort((a, b) => a - b) },
    hayReglaHasta390: [...maxW].some((v) => v >= 320 && v <= 420),
    hayBandaTablet: [...minW].some((v) => v >= 700 && v <= 1100),
    keyframesConTransform: kfTransform.length,
    animacionesEnContenedores: containerAnimations,
    immune,
  }
}

// ---------- auditoría dentro de la página ----------
function pageAuditFn() {
  const vw = window.innerWidth
  const main = document.querySelector('main') || document.body
  const describe = (el) => {
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)
    return `${el.tagName.toLowerCase()}${cls} «${txt}»`
  }
  const clippedByAncestor = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      const cs = getComputedStyle(p)
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) {
        const pr = p.getBoundingClientRect()
        if (pr.left >= -2 && pr.right <= vw + 2) return true
      }
      p = p.parentElement
    }
    return false
  }
  const offenders = []; const truncated = []; const vcut = []; const fixed = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof Element)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if ((r.right > vw + 2 || r.left < -2) && !clippedByAncestor(el)) {
      const d = describe(el) + ` [${Math.round(r.left)}..${Math.round(r.right)} vs ${vw}]`
      if (!seen.has(d)) { seen.add(d); offenders.push(d) }
    }
    if (cs.position === 'fixed') fixed.push({ d: describe(el), x: r.left, y: r.top, w: r.width, h: r.height })
    if (el instanceof HTMLElement && el.clientWidth > 0 && (el.textContent || '').trim().length > 0) {
      if (el.scrollWidth > el.clientWidth + 1 && (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden')) {
        truncated.push(describe(el) + ` [sw ${el.scrollWidth} > cw ${el.clientWidth}]`)
      } else if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2 && cs.overflowY === 'hidden') {
        vcut.push(describe(el) + ` [sh ${el.scrollHeight} > ch ${el.clientHeight}]`)
      }
    }
  }
  const fixedOverlaps = []
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i]; const b = fixed[j]
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (ix > 2 && iy > 2) fixedOverlaps.push(`${a.d} × ${b.d}`)
  }
  return {
    innerWidth: vw,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    offenders: offenders.slice(0, 12),
    truncated: [...new Set(truncated)].slice(0, 12),
    vcut: [...new Set(vcut)].slice(0, 8),
    fixedOverlaps,
    mainTextLen: (main.innerText || '').trim().length,
    mainSnippet: (main.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 110),
  }
}

// ---------- flujo principal ----------
const EMAIL = 'yadir.medina900710@gmail.com'
const TEMP = 'Admin1'
const NEWPASS = 'AuditoriaVisual1'

async function clickByLabel(page, label) {
  return page.evaluate((lbl) => {
    const btns = [...document.querySelectorAll('.sidenav .nav-btn, .bottomnav button, .mas-card, .quick-action')]
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes(lbl))
    if (b) { b.click(); return true }
    return false
  }, label)
}

async function waitScreen(page, conf) {
  try {
    await page.waitForFunction(({ sel, text, chip }) => {
      const main = document.querySelector('main')
      if (!main || (main.innerText || '').includes('Cargando la sección')) return false
      let ok = false
      if (sel && main.querySelector(sel)) ok = true
      if (!ok && text && (main.innerText || '').includes(text)) ok = true
      if (ok && chip) {
        const active = main.querySelector('.view-chip.active, .chip-btn.active, .chip.chip-active, [aria-pressed="true"]')
        return active ? (active.textContent || '').includes(chip) : false
      }
      return ok
    }, { sel: conf.sel, text: conf.text, chip: conf.chipActivo || null }, { timeout: 9000 })
    return true
  } catch {
    return false
  }
}

async function seedContext(page, backupPath) {
  await page.waitForSelector('#lg-email', { timeout: 15000 })
  await page.fill('#lg-email', EMAIL)
  await page.fill('#lg-pass', TEMP)
  await page.click('.auth-card button[type="submit"]')
  await page.waitForSelector('#cp-new', { timeout: 10000 })
  await page.fill('#cp-temp', TEMP)
  await page.fill('#cp-new', NEWPASS)
  await page.fill('#cp-rep', NEWPASS)
  await page.click('.auth-card button[type="submit"]')
  await page.waitForSelector('.app-shell', { timeout: 10000 })
  // Semilla de datos por la vía real: Sistema → Importar respaldo.
  await clickByLabel(page, 'Sistema')
  const sis = SCREENS.find((s) => s.id === 'sistema')
  await waitScreen(page, sis)
  const input = page.locator('main input[type="file"][accept*="json"]').first()
  await input.setInputFiles(backupPath)
  await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
  await page.click('button:has-text("Confirmar importación")')
  const okBox = page.locator('.ok-box', { hasText: 'Respaldo importado' }).first()
  await okBox.waitFor({ timeout: 60000 })
  return (await okBox.innerText()).trim()
}

async function immuneRuntime(page, outDir, theme, width) {
  const dom = await page.evaluate(() => {
    const stage = document.querySelector('.immune-stage')
    const info = document.querySelector('.immune-info')
    if (stage) stage.scrollIntoView({ block: 'center' })
    return {
      stage: !!stage,
      info: !!info,
      infoDentroDelCampo: !!(stage && info && stage.contains(info)),
      canvas: !!document.querySelector('canvas.immune-canvas'),
      chips: document.querySelectorAll('.immune-chip').length,
      barraAmenaza: !!document.querySelector('.immune-threat'),
      entradasRegistro: document.querySelectorAll('.immune-log li').length,
    }
  })
  await page.waitForTimeout(1800)
  const px = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.immune-canvas')
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = new Set()
    let total = 0; let nonBg = 0; let verdes = 0; let calidos = 0
    for (let i = 0; i < img.length; i += 16) {
      const r = img[i]; const g = img[i + 1]; const b = img[i + 2]
      total++
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`)
      const esFondo = (r > 225 && g > 235 && b > 225) || (r < 30 && g >= 20 && g <= 48 && b > 25 && b < 60)
      if (!esFondo) nonBg++
      if (g > 120 && g > r + 20) verdes++
      if (r > 170 && g >= 90 && g < 195 && b < 110) calidos++
    }
    return { coloresDistintos: colors.size, ratioNoFondo: +(nonBg / total).toFixed(3), pixelesVerdes: verdes, pixelesCalidos: calidos }
  })
  const stageEl = page.locator('.immune-stage')
  if (await stageEl.count()) {
    await stageEl.screenshot({ path: path.join(outDir, `immune__${theme}__${width}.png`) })
  }
  let toqueAbreTarjeta = false
  const box = await stageEl.boundingBox().catch(() => null)
  if (box) {
    for (const [fx, fy] of [[0.3, 0.3], [0.6, 0.5], [0.45, 0.7], [0.75, 0.35], [0.25, 0.6], [0.5, 0.25]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
      await page.waitForTimeout(450)
      if (await page.locator('.immune-cell-card').count()) { toqueAbreTarjeta = true; break }
    }
  }
  return { ...dom, pixeles: px, toqueAbreTarjeta }
}

async function main() {
  if (!BACKUP || !fs.existsSync(BACKUP)) {
    console.error('SIN RESPALDO: no se encontró la foto de datos para sembrar la auditoría.')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('SIN CHROMIUM: no hay navegador headless disponible (ni caché de Playwright, ni CHROME_PATH, ni sistema). Auditoría NO ejecutada.')
    process.exit(2)
  }
  const buildDir = BUILD_DIR || (NO_BUILD ? path.join(REPO, 'dist') : buildLocalVariant())
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true })
  fs.mkdirSync(path.join(OUT, 'immune'), { recursive: true })
  const server = await serve(buildDir)
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const report = {
    fecha: new Date().toISOString(),
    motor: `Chromium headless (playwright-core) · ${await browser.version()} · ${exe}`,
    buildDir, backup: BACKUP,
    cssAuditado: cssHashes(buildDir),
    cssEntregadoDist: cssHashes(path.join(REPO, 'dist')),
    semilla: {}, combinaciones: [], immune: {}, estaticos: staticChecks(),
    resumen: {},
  }
  report.cssIdenticoAlEntregado = JSON.stringify(report.cssAuditado) === JSON.stringify(report.cssEntregadoDist)
  try {
    for (const { w, h } of WIDTHS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme })
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
        report.semilla[`${theme}-${w}`] = await seedContext(page, BACKUP)
        for (const conf of SCREENS) {
          const errsBefore = errors.length
          if (conf.via) {
            await clickByLabel(page, SCREENS.find((s) => s.id === conf.via).label)
            await waitScreen(page, SCREENS.find((s) => s.id === conf.via))
          }
          const clicked = await clickByLabel(page, conf.label)
          const rendered = clicked && await waitScreen(page, conf)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(500)
          const audit = await page.evaluate(pageAuditFn)
          await page.screenshot({ path: path.join(OUT, 'screens', `${conf.id}__${theme}__${w}.png`) })
          report.combinaciones.push({
            pantalla: conf.id, tema: theme, ancho: w,
            navegacionOk: !!clicked, renderOk: !!rendered,
            ...audit, errores: errors.slice(errsBefore),
          })
          if (conf.id === 'sistema') {
            report.immune[`${theme}-${w}`] = await immuneRuntime(page, path.join(OUT, 'immune'), theme, w)
          }
          if (conf.id === 'sistema' && w === 360) {
            /* Prueba de movimiento del sistema solar (oleada 3c): los
               centros de los .ipv-orbit-item deben diferir entre dos
               instantes separados 1200 ms, con la constelación en
               pantalla (el observador la despausa al ser visible). */
            report.solarMovimiento ??= {}
            report.solarMovimiento[theme] = await page.evaluate(async () => {
              const el = document.querySelector('.ipv-neural-constellation')
              if (!el) return { found: false }
              el.scrollIntoView({ block: 'center' })
              await new Promise((r) => setTimeout(r, 500))
              const item = el.querySelector('.ipv-orbit-item')
              const animName = item ? getComputedStyle(item).animationName : null
              const sample = () => [...el.querySelectorAll('.ipv-orbit-item')].slice(0, 8).map((n) => {
                const b = n.getBoundingClientRect()
                return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]
              })
              const a = sample()
              await new Promise((r) => setTimeout(r, 1200))
              const b = sample()
              const moved = a.some((p, i) => b[i] && (Math.abs(p[0] - b[i][0]) > 1 || Math.abs(p[1] - b[i][1]) > 1))
              return { found: true, items: a.length, animName, moved, antes: a, despues: b }
            })
          }
        }
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
  // Veredicto
  const duros = []
  const avisos = []
  for (const c of report.combinaciones) {
    const tag = `${c.pantalla}/${c.tema}/${c.ancho}px`
    if (!c.navegacionOk || !c.renderOk) duros.push(`${tag}: la pantalla no renderizó (navegación=${c.navegacionOk}, render=${c.renderOk}, texto=${c.mainTextLen})`)
    if (c.docScrollWidth > c.innerWidth + 2 || c.bodyScrollWidth > c.innerWidth + 2) duros.push(`${tag}: desborde horizontal de página (doc ${c.docScrollWidth} / body ${c.bodyScrollWidth} > ${c.innerWidth})`)
    if (c.offenders.length) duros.push(`${tag}: ${c.offenders.length} elemento(s) fuera del viewport: ${c.offenders.slice(0, 3).join(' | ')}`)
    if (c.errores.length) duros.push(`${tag}: errores JS: ${c.errores.slice(0, 2).join(' | ')}`)
    if (c.mainTextLen < 80) duros.push(`${tag}: contenido principal casi vacío (${c.mainTextLen} caracteres)`)
    if (c.truncated.length) avisos.push(`${tag}: texto posiblemente cortado: ${c.truncated.slice(0, 3).join(' | ')}`)
    if (c.vcut.length) avisos.push(`${tag}: posible corte vertical: ${c.vcut.slice(0, 2).join(' | ')}`)
    if (c.fixedOverlaps.length) avisos.push(`${tag}: solape de fijos: ${c.fixedOverlaps.slice(0, 2).join(' | ')}`)
  }
  const est = report.estaticos
  if (est.tokensColorSinRedefinirEnOscuro.length) duros.push(`CSS: tokens de color sin redefinir en oscuro: ${est.tokensColorSinRedefinirEnOscuro.join(', ')}`)
  if (!est.hayReglaHasta390) avisos.push('CSS: no se encontró regla max-width en la banda 320–420px')
  if (!est.hayBandaTablet) avisos.push('CSS: no se encontró regla min-width en la banda tablet 700–1100px')
  if (est.animacionesEnContenedores.length) duros.push(`CSS: animación con transform en contenedor: ${est.animacionesEnContenedores.join(' | ')}`)
  for (const [k, v] of Object.entries(report.immune)) {
    if (!v.canvas || v.infoDentroDelCampo) duros.push(`Inmune ${k}: estructura incorrecta (canvas=${v.canvas}, infoDentro=${v.infoDentroDelCampo})`)
    if (v.pixeles && v.pixeles.ratioNoFondo <= 0.02) duros.push(`Inmune ${k}: el campo parece vacío (ratioNoFondo=${v.pixeles.ratioNoFondo})`)
    if (!v.toqueAbreTarjeta) avisos.push(`Inmune ${k}: ningún toque abrió la tarjeta de célula (revisar a mano)`)
  }
  for (const [k, v] of Object.entries(est.immune)) if (!v) duros.push(`Inmune (fuente): falta ${k}`)
  for (const [k, v] of Object.entries(report.solarMovimiento ?? {})) {
    if (!v.found) duros.push(`Solar ${k}: no se encontró .ipv-neural-constellation en Sistema`)
    else if (!v.moved) duros.push(`Solar ${k}: los nodos orbitales NO se movieron en 1200 ms (animation-name=${v.animName}, nodos=${v.items})`)
  }
  report.resumen = { combinaciones: report.combinaciones.length, defectosDuros: duros, avisos }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Auditoría: ${report.combinaciones.length} combinaciones · CSS idéntico a dist: ${report.cssIdenticoAlEntregado}`)
  console.log(`Defectos duros: ${duros.length}`)
  for (const d of duros) console.log(`  ✗ ${d}`)
  console.log(`Avisos (revisión): ${avisos.length}`)
  for (const a of avisos) console.log(`  ! ${a}`)
  console.log(`Informe: ${path.join(OUT, 'report.json')}`)
  process.exit(duros.length ? 1 : 0)
}

main().catch((e) => { console.error('FALLO DEL HARNESS:', e); process.exit(2) })
