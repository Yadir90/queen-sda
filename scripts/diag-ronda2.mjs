#!/usr/bin/env node
/* Diagnóstico focalizado ronda 2 (26-oct): ficha de costo (toque
 * real sobre «Crear ficha»), ficha RH completa, filas de Almacén,
 * cadena de desborde de Cobrar y Sistema tras el contenedor.
 * Uso: node scripts/diag-ronda2.mjs --out <dir> */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = path.resolve(REPO, opt('--out', 'audits/audit-2026-10-26/round2-diag'))
fs.mkdirSync(OUT, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const EMAIL = 'yadir.medina900710@gmail.com'
const TEMP = 'Admin1'
const NEWPASS = 'AuditoriaVisual1'

function findChromium() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const cands = []
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
    cands.push(path.join(cache, d, 'chrome-linux64/chrome'), path.join(cache, d, 'chrome-linux/chrome'))
  }
  cands.push('/usr/bin/chromium', '/usr/bin/google-chrome')
  return cands.find((c) => fs.existsSync(c)) || null
}
function buildLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-diag-build-'))
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
  return dir
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(dir, decodeURIComponent(url.pathname))
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}
async function clickByLabel(page, label) {
  return page.evaluate((lbl) => {
    const btns = [...document.querySelectorAll('.sidenav .nav-btn, .bottomnav button, .mas-card, .quick-action')]
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes(lbl))
    if (b) { b.click(); return true }
    return false
  }, label)
}
async function goScreen(page, label, waitText) {
  const viaMas = ['Almacén', 'Economía', 'Inventario', 'Laboratorio', 'Productos', 'Elaboración', 'Existencias', 'Entradas', 'Transferencias', 'Días', 'Historial', 'Ajustes', 'Archivo', 'Cronología', 'Documentos', 'Otros ingresos', 'RH']
  let ok = await clickByLabel(page, label)
  if (!ok && viaMas.includes(label)) { await clickByLabel(page, 'Más'); await page.waitForTimeout(500); ok = await clickByLabel(page, label) }
  if (waitText) await page.waitForFunction((t) => (document.querySelector('main')?.textContent || '').includes(t), waitText, { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(700)
  return ok
}
async function seed(page) {
  await page.waitForSelector('#lg-email', { timeout: 20000 })
  await page.fill('#lg-email', EMAIL)
  await page.fill('#lg-pass', TEMP)
  await page.click('.auth-card button[type="submit"]')
  await page.waitForSelector('#cp-new', { timeout: 10000 })
  await page.fill('#cp-temp', TEMP)
  await page.fill('#cp-new', NEWPASS)
  await page.fill('#cp-rep', NEWPASS)
  await page.click('.auth-card button[type="submit"]')
  await page.waitForSelector('.app-shell', { timeout: 10000 })
  await clickByLabel(page, 'Sistema')
  await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('De un vistazo'), { timeout: 25000 })
  const input = page.locator('main input[type="file"][accept*="json"]').first()
  await input.setInputFiles(BACKUP)
  await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
  await page.click('button:has-text("Confirmar importación")')
  await page.locator('.ok-box', { hasText: 'Respaldo importado' }).first().waitFor({ timeout: 60000 })
}

const buildDir = buildLocal()
const server = await serve(buildDir)
const base = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const R = { ficha: {}, rh: {}, almacen: {}, cobrar: {}, sistema: {}, errors: [] }
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'light', reducedMotion: 'no-preference' })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`) })
await page.goto(base)
await seed(page)

/* ---------- SISTEMA tras el contenedor ---------- */
await goScreen(page, 'Sistema', 'De un vistazo')
R.sistema = await page.evaluate(() => {
  const ai = document.querySelector('.system-ai-activity')
  const dna = document.querySelector('.system-dna-detail')
  const map = document.querySelector('.ipv-neural-map')
  const wrap = document.querySelector('.system-network-system')
  return {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    wrapperFound: !!wrap,
    aiBg: ai ? getComputedStyle(ai).backgroundColor : null,
    dnaBg: dna ? getComputedStyle(dna).backgroundColor : null,
    mapBg: map ? getComputedStyle(map).backgroundColor : null,
    wrapBg: wrap ? getComputedStyle(wrap).backgroundColor : null,
  }
})
await page.evaluate(() => { document.querySelector('.ipv-neural-constellation')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(700)
const t0 = await page.evaluate(() => [...document.querySelectorAll('.ipv-orbit-item')].map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] }))
await page.waitForTimeout(1600)
const t1 = await page.evaluate(() => [...document.querySelectorAll('.ipv-orbit-item')].map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] }))
R.sistema.nodesTotal = t0.length
R.sistema.nodesMoved = t0.filter((p, i) => t1[i] && (Math.abs(p[0] - t1[i][0]) > 2 || Math.abs(p[1] - t1[i][1]) > 2)).length
R.sistema.constellationClass = await page.evaluate(() => document.querySelector('.ipv-neural-constellation')?.className ?? null)
R.sistema.planetCode = await page.evaluate(() => document.querySelector('.ipv-planet-code')?.textContent ?? null)
await page.screenshot({ path: path.join(OUT, 'sistema-neural-after-light-360.png') })
await page.evaluate(() => { document.querySelector('.system-ai-activity')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'sistema-diagnostico-after-light-360.png') })

/* ---------- COBRAR: cadena de desborde ---------- */
await goScreen(page, 'Cobrar', 'PENDIENTE')
R.cobrar = await page.evaluate(() => {
  const docSW = document.documentElement.scrollWidth
  const group = document.querySelector('.account-group')
  const chain = []
  let el = group
  // bajar por el hijo que más desborda en cada nivel
  for (let depth = 0; depth < 8 && el; depth++) {
    const kids = [...el.children]
    const bad = kids.map((k) => ({ k, sw: k.scrollWidth, w: k.getBoundingClientRect().width, right: k.getBoundingClientRect().right }))
      .sort((a, b) => b.right - a.right)[0]
    chain.push({ sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.split(' ').join('.') : ''), sw: el.scrollWidth, w: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right) })
    if (!bad || bad.right <= el.getBoundingClientRect().right + 1) break
    el = bad.k
  }
  return { docSW, chain }
})
await page.screenshot({ path: path.join(OUT, 'cobrar-after-light-360.png') })

/* ---------- ALMACÉN: filas reales ---------- */
await goScreen(page, 'Almacén', 'Registro de movimientos')
R.almacen = await page.evaluate(() => {
  const all = [...document.querySelectorAll('main *')].filter((el) => el.children.length && [...el.querySelectorAll(':scope > button, :scope button')].some((b) => b.textContent.trim() === 'Eliminar'))
  const sample = all.slice(0, 3).map((row) => {
    const r = row.getBoundingClientRect()
    const card = row.closest('.card')
    const cr = card?.getBoundingClientRect()
    return {
      cls: typeof row.className === 'string' ? row.className : row.tagName,
      rowRight: Math.round(r.right), rowW: Math.round(r.width),
      cardRight: cr ? Math.round(cr.right) : null,
      buttons: [...row.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), right: Math.round(b.getBoundingClientRect().right) })),
      text: (row.textContent || '').replace(/\s+/g, ' ').slice(0, 90),
    }
  })
  return { rowsFound: all.length, sample, docSW: document.documentElement.scrollWidth }
})
await page.screenshot({ path: path.join(OUT, 'almacen-after-light-360.png') })

/* ---------- ELABORACIÓN: ficha con el toque correcto ---------- */
await goScreen(page, 'Elaboración', 'Elaboración')
const fichaBefore = errs.length
R.ficha.clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('main button')].find((x) => /crear ficha/i.test(x.getAttribute('aria-label') || ''))
  if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return b.getAttribute('aria-label') }
  return null
})
await page.waitForTimeout(1000)
R.ficha.visible = await page.evaluate(() => !!document.querySelector('.elab-ficha'))
R.ficha.title = await page.evaluate(() => document.querySelector('.elab-ficha h2, .elab-ficha h3')?.textContent?.trim() ?? null)
R.ficha.newErrors = errs.slice(fichaBefore)
await page.screenshot({ path: path.join(OUT, 'ficha-abierta-light-360.png') })

/* ---------- RH: ficha completa de un trabajador ---------- */
await goScreen(page, 'RH', 'trabajador')
const rhBefore = errs.length
R.rh.opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('main button')].find((x) => /abrir la ficha|ver ficha/i.test(x.getAttribute('aria-label') || '') || /^Ver ficha/.test(x.textContent.trim()))
  if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 60) }
  return null
})
await page.waitForTimeout(900)
R.rh.state = await page.evaluate(() => {
  const ficha = document.querySelector('.wr-ficha')
  const main = document.querySelector('main')
  return {
    fichaFound: !!ficha,
    datosTitle: (main?.textContent || '').includes('Datos de la ficha'),
    inputs: ficha ? ficha.querySelectorAll('input, select, textarea').length : 0,
    inputIds: ficha ? [...ficha.querySelectorAll('input, select')].slice(0, 14).map((i) => i.id || i.getAttribute('aria-label') || i.type) : [],
    hasGuardar: [...(ficha?.querySelectorAll('button') || [])].some((b) => /guardar cambios/i.test(b.textContent)),
    hasDescanso: (ficha?.textContent || '').includes('descanso'),
    hasCuadrados: (main?.textContent || '').includes('cuadrados') || !!document.querySelector('.wr-squares, [class*="square"]'),
    textSample: (ficha?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
  }
})
if (R.rh.state.inputs > 0) {
  // Operar un campo y un chip: escribir en Nombre y tocar un día fijo
  await page.evaluate(() => {
    const inp = document.querySelector('.wr-ficha input[type="text"]')
    if (inp) { inp.focus() }
  })
  await page.keyboard.type(' (prueba)')
  R.rh.typedValue = await page.evaluate(() => document.querySelector('.wr-ficha input[type="text"]')?.value ?? null)
  await page.evaluate(() => {
    const inp = document.querySelector('.wr-ficha input[type="text"]')
    if (inp) { inp.value = inp.value.replace(' (prueba)', ''); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })) }
  })
}
await page.evaluate(() => { document.querySelector('.wr-ficha')?.scrollIntoView({ block: 'start' }) })
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'rh-ficha-light-360.png') })
R.rh.newErrors = errs.slice(rhBefore)
R.errors = errs
fs.writeFileSync(path.join(OUT, 'diag.json'), JSON.stringify(R, null, 1))
console.log(JSON.stringify(R, null, 1))
await browser.close()
server.close()
