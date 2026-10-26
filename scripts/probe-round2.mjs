#!/usr/bin/env node
/* Sonda de la ronda 2 (26-oct): reproduce y mide los defectos del dueño
 * en el arnés local (build sin Supabase + semilla real por la vía de la
 * app). Uso: node scripts/probe-round2.mjs --out <dir> [--build <dir>]
 * [--voice-only] [--ficha-only]
 * Escribe <out>/probe.json y capturas PNG. No toca producción. */
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
const OUT = path.resolve(REPO, opt('--out', 'audits/audit-2026-10-26/round2-probe'))
fs.mkdirSync(OUT, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const EMAIL = 'yadir.medina900710@gmail.com'
const TEMP = 'Admin1'
const NEWPASS = 'AuditoriaVisual1'

function findChromium() {
  const cands = []
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH)
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
    cands.push(path.join(cache, d, 'chrome-linux64/chrome'), path.join(cache, d, 'chrome-linux/chrome'), path.join(cache, d, 'chrome-linux64/headless_shell'))
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome')
  return cands.find((c) => fs.existsSync(c)) || null
}
function buildLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-probe-build-'))
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
  return dir
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
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
async function seed(page, withData = true) {
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
  if (!withData) return
  await clickByLabel(page, 'Sistema')
  // Las secciones de Sistema se montan al hacerse visibles: se
  // recorre la página como haría el dueño antes de exigir textos.
  await page.evaluate(async () => {
    const step = Math.floor(innerHeight * 0.8)
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      scrollTo(0, y); await new Promise((r) => setTimeout(r, 120))
    }
    scrollTo(0, 0)
  })
  try {
    await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('De un vistazo'), { timeout: 25000 })
  } catch {
    const txt = await page.evaluate(() => (document.querySelector('main')?.innerText || document.body.innerText || '').slice(0, 300))
    throw new Error(`Sistema no cargó tras el login. main: ${txt}`)
  }
  const input = page.locator('main input[type="file"][accept*="json"]').first()
  await input.setInputFiles(BACKUP)
  await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
  await page.click('button:has-text("Confirmar importación")')
  await page.locator('.ok-box', { hasText: 'Respaldo importado' }).first().waitFor({ timeout: 60000 })
}
async function goScreen(page, label, waitText) {
  const viaMas = ['Almacén', 'Economía', 'Inventario', 'Laboratorio', 'Productos', 'Elaboración', 'Existencias', 'Entradas', 'Transferencias', 'Días', 'Historial', 'Ajustes', 'Archivo', 'Cronología', 'Documentos', 'Otros ingresos', 'RH']
  let ok = await clickByLabel(page, label)
  if (!ok && viaMas.includes(label)) { await clickByLabel(page, 'Más'); await page.waitForTimeout(500); ok = await clickByLabel(page, label) }
  if (waitText) await page.waitForFunction((t) => (document.querySelector('main')?.textContent || '').includes(t), waitText, { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(700)
  return ok
}
const rect = (r) => r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null

const buildDir = opt('--build', null) || buildLocal()
const server = await serve(buildDir)
const base = `http://127.0.0.1:${server.address().port}/`
const exe = findChromium()
if (!exe) { console.error('Sin Chromium'); process.exit(2) }
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const R = { buildDir, screens: {}, voice: {}, ficha: {}, errors: [] }

/* ============ Contexto principal: 360 claro, con datos ============ */
async function mainContext(theme, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`) })
  await page.goto(base)
  await seed(page, true)
  return { ctx, page, errs }
}

let page, errs
try {
;({ page, errs } = await mainContext('light', 360, 780))
R.errors.push(...errs)

/* ---------- SISTEMA ---------- */
await goScreen(page, 'Sistema', 'De un vistazo')
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400)
R.screens.sistema = await page.evaluate(() => {
  const out = {}
  const cs = (el, props) => { const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s[p]; return o }
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
  // Métricas de Queen (Sin medir)
  out.metrics = [...document.querySelectorAll('.queen-evolution-metric')].map((card) => {
    const strong = card.querySelector('strong')
    const cr = card.getBoundingClientRect(); const sr = strong?.getBoundingClientRect()
    return { label: card.querySelector('span')?.textContent?.trim(), value: strong?.textContent?.trim(), overflowRightPx: sr ? Math.round(sr.right - cr.right) : null, strongSW: strong?.scrollWidth, strongCW: strong?.clientWidth }
  })
  // Actividad de IA y detalle ADN: fondo computado + ancestros
  const ai = document.querySelector('.system-ai-activity')
  out.aiActivity = ai ? { bg: cs(ai, ['backgroundColor']).backgroundColor, ancestors: (() => { const a = []; let p = ai; while (p && a.length < 6) { a.push(p.className && typeof p.className === 'string' ? p.className.split(' ')[0] : p.tagName); p = p.parentElement } return a })() } : null
  const dna = document.querySelector('.system-dna-detail')
  out.dnaDetail = dna ? { bg: cs(dna, ['backgroundColor']).backgroundColor } : null
  const gauge = document.querySelector('.system-health-gauge > span')
  out.gaugeInner = gauge ? { bg: cs(gauge, ['backgroundColor']).backgroundColor } : null
  const prog = document.querySelector('.system-dna-progress-track')
  out.dnaTrack = prog ? { bg: cs(prog, ['backgroundColor']).backgroundColor } : null
  // Línea de tiempo de mutaciones
  const tl = document.querySelector('.dna-mutation-timeline')
  if (tl) {
    const ol = tl.querySelector('ol'); const li = ol?.querySelector('li')
    out.timeline = { panel: box(tl), olScrollTop: ol?.scrollTop, olBox: ol ? box(ol) : null, firstLi: li ? box(li) : null, firstLiText: li?.innerText?.slice(0, 80) }
  }
  // Mapa neuronal
  const con = document.querySelector('.ipv-neural-constellation')
  if (con) {
    out.constellation = { box: box(con), bgImage: cs(con, ['backgroundImage']).backgroundImage.slice(0, 160), bgColor: cs(con, ['backgroundColor']).backgroundColor }
    const copy = document.querySelector('.ipv-neural-copy > span')
    out.copySpan = copy ? { box: box(copy), text: copy.textContent?.trim() } : null
    out.orbitCount = document.querySelectorAll('.ipv-orbit-item').length
  }
  // Píldora de conectividad del ADN
  out.pills = [...document.querySelectorAll('.system-connectivity-pill')].map((p) => ({ cls: p.className, box: box(p), text: p.innerText?.replace(/\s+/g, ' ').slice(0, 60) }))
  const dp = document.querySelector('.system-dna-progress')
  out.dnaProgress = dp ? box(dp) : null
  return out
})
await page.evaluate(() => { document.querySelector('.ipv-neural-constellation')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(500)
const nodesT0 = await page.evaluate(() => [...document.querySelectorAll('.ipv-orbit-item')].map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] }))
await page.screenshot({ path: path.join(OUT, 'sistema-neural-t0.png') })
await page.waitForTimeout(1500)
const nodesT1 = await page.evaluate(() => [...document.querySelectorAll('.ipv-orbit-item')].map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] }))
await page.screenshot({ path: path.join(OUT, 'sistema-neural-t1.png') })
R.screens.sistema.nodesMoved = nodesT0.filter((p, i) => nodesT1[i] && (Math.abs(p[0] - nodesT1[i][0]) > 2 || Math.abs(p[1] - nodesT1[i][1]) > 2)).length
R.screens.sistema.nodesTotal = nodesT0.length
// Toque en un nodo del mapa
const tapped = await page.evaluate(() => { const b = document.querySelector('.ipv-orbit-item button'); if (b) { b.click(); return true } return false })
await page.waitForTimeout(500)
R.screens.sistema.nodeTapOpensSelection = tapped ? await page.evaluate(() => !!document.querySelector('.ipv-neural-selection')) : false
await page.evaluate(() => { document.querySelector('.dna-mutation-timeline')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'sistema-timeline-light-360.png') })
await page.evaluate(() => { document.querySelector('.queen-evolution-metrics')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'sistema-metrics-light-360.png') })
await page.evaluate(() => { document.querySelector('.system-ai-activity')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(OUT, 'sistema-diagnostico-light-360.png') })

/* ---------- ALMACÉN: filas de movimientos ---------- */
await goScreen(page, 'Almacén', 'Registro de movimientos')
R.screens.almacen = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) } }
  const rows = [...document.querySelectorAll('.list .row')].filter((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.includes('Editar')))
  return rows.slice(0, 4).map((row) => {
    const card = row.closest('.card')
    return { row: box(row), card: card ? box(card) : null, buttons: [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...box(b) })) }
  })
})
await page.evaluate(() => { document.querySelector('.list .row')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(OUT, 'almacen-rows-light-360.png') })

/* ---------- COBRAR / CUENTAS: desbordes ---------- */
async function widest(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const out = []
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 2 && r.width > 0) out.push({ sel: `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join('.')}`, right: Math.round(r.right), w: Math.round(r.width), sw: el.scrollWidth })
    }
    return { docSW: document.documentElement.scrollWidth, top: out.sort((a, b) => b.right - a.right).slice(0, 5) }
  })
}
await goScreen(page, 'Cobrar', 'Comprobantes')
R.screens.cobrar = await widest(page)
await page.screenshot({ path: path.join(OUT, 'cobrar-light-360.png') })
await goScreen(page, 'Ver cuentas', 'Días al pagar').catch(() => {})
R.screens.cuentas = await widest(page)

/* ---------- ECONOMÍA ---------- */
await goScreen(page, 'Economía', 'Panel de cierre')
R.screens.economia = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
  const out = {}
  const grids = [...document.querySelectorAll('.grid-2')]
  out.grid2 = grids.map((g) => ({ cols: getComputedStyle(g).gridTemplateColumns, children: [...g.children].map((c) => ({ title: c.querySelector('h3,h4')?.textContent?.trim() || c.textContent.trim().slice(0, 30), w: Math.round(c.getBoundingClientRect().width) })) }))
  out.articles = [...document.querySelectorAll('.economy-category-profitability article')].map((a) => ({ text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 90), box: box(a) }))
  const big = document.querySelector('.big-figure')
  out.bigFigure = big ? { text: big.textContent.trim(), box: box(big) } : null
  const nav = document.querySelector('.bottomnav')
  out.bottomnav = nav ? box(nav) : null
  return out
})
await page.evaluate(() => { document.querySelector('.big-figure')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(400)
R.screens.economia.bigFigureAfterScroll = await page.evaluate(() => {
  const big = document.querySelector('.big-figure'); const nav = document.querySelector('.bottomnav')
  if (!big || !nav) return null
  const b = big.getBoundingClientRect(); const n = nav.getBoundingClientRect()
  return { bigBottom: Math.round(b.bottom), navTop: Math.round(n.top), overlapPx: Math.round(b.bottom - n.top) }
})
await page.screenshot({ path: path.join(OUT, 'economia-light-360.png') })

/* ---------- TRANSFERENCIAS: ActionMenu + títulos ---------- */
await goScreen(page, 'Transferencias', 'Historial de la tarjeta')
R.screens.transferencias = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const trig = document.querySelector('.action-menu-trigger')
  const det = document.querySelector('.mov-detail')
  return {
    trigger: trig ? { box: box(trig), text: trig.textContent.replace(/\s+/g, ' ').trim().slice(0, 110), fontSize: getComputedStyle(trig).fontSize } : null,
    detail: det ? { fontSize: getComputedStyle(det).fontSize, fontWeight: getComputedStyle(det).fontWeight, text: det.textContent.trim().slice(0, 60) } : null,
    menus: document.querySelectorAll('.action-menu').length,
  }
})
if (R.screens.transferencias.trigger) {
  await page.evaluate(() => { document.querySelector('.action-menu-trigger')?.scrollIntoView({ block: 'center' }) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'transferencias-menu-cerrado-light-360.png') })
  await page.evaluate(() => { document.querySelector('.action-menu-trigger')?.click() })
  await page.waitForTimeout(600)
  R.screens.transferencias.popover = await page.evaluate(() => { const p = document.querySelector('.action-menu-popover'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: p.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) } })
  await page.screenshot({ path: path.join(OUT, 'transferencias-menu-abierto-light-360.png') })
  await page.keyboard.press('Escape')
}

/* ---------- ELABORACIÓN: toque que abre la ficha (Defecto 4) ---------- */
if (!args.includes('--voice-only')) {
  await goScreen(page, 'Elaboración', 'Elaboración')
  const before = errs.length
  const clickInfo = await page.evaluate(() => {
    const cand = [...document.querySelectorAll('main button, main [role="button"], main article, main li')]
      .find((el) => /ficha|ver costo|costo/i.test(el.getAttribute('aria-label') || '') || (el.textContent || '').includes('Ficha'))
    const cards = [...document.querySelectorAll('main [class*="product"], main [class*="elab"]')]
    return { fichaBtn: cand ? (cand.getAttribute('aria-label') || cand.textContent.trim().slice(0, 60)) : null, elabClasses: [...new Set(cards.map((c) => c.className.split(' ')[0]))].slice(0, 12) }
  })
  R.ficha.candidates = clickInfo
  // La lista de productos: cada tarjeta/botón de producto abre la ficha.
  const opened = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('main button')]
    const prod = btns.find((b) => /pollo|cerdo|res|pescado|arroz|pizza|refresco|cerveza|ron|plátano|yuca|ensalada/i.test(b.textContent || '') && b.textContent.length < 300)
    if (prod) { prod.click(); return prod.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) }
    return null
  })
  await page.waitForTimeout(900)
  R.ficha.clickedProduct = opened
  R.ficha.fichaVisible = await page.evaluate(() => !!document.querySelector('.elab-ficha'))
  R.ficha.newErrors = errs.slice(before)
  R.ficha.mainTextAfter = await page.evaluate(() => (document.querySelector('main')?.innerText || '').trim().slice(0, 120))
  await page.screenshot({ path: path.join(OUT, 'elaboracion-tras-toque-light-360.png') })
}

} catch (e) { R.errors.push(`main-context: ${e.message}`) }

/* ---------- Oscuro 360: Sistema (tarjetas) ---------- */
try {
  const dark = await mainContext('dark', 360, 780)
  R.errors.push(...dark.errs)
  await goScreen(dark.page, 'Sistema', 'De un vistazo')
  R.screens.sistemaDark = await dark.page.evaluate(() => {
    const ai = document.querySelector('.system-ai-activity')
    const dna = document.querySelector('.system-dna-detail')
    return { aiBg: ai ? getComputedStyle(ai).backgroundColor : null, dnaBg: dna ? getComputedStyle(dna).backgroundColor : null }
  })
  await dark.ctx.close()
} catch (e) { R.errors.push(`dark-context: ${e.message}`) }

/* ============ VOZ DE QUEEN (Defecto 5): escenarios ============ */
if (!args.includes('--ficha-only')) {
  const scenarios = {
    real: null,
    'not-allowed': 'not-allowed',
    aborted: 'aborted',
    network: 'network',
    'silent-end': 'silent-end',
    success: 'success',
  }
  for (const [name, mode] of Object.entries(scenarios)) {
    const vctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'light' })
    const vpage = await vctx.newPage()
    const verrs = []
    vpage.on('pageerror', (e) => verrs.push(e.message))
    if (mode) {
      await vpage.addInitScript((m) => {
        class FakeRec {
          constructor() { this.lang = ''; this.onresult = null; this.onerror = null; this.onend = null }
          start() {
            setTimeout(() => {
              if (m === 'success') {
                const mk = (t, fin) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: fin, length: 1, 0: { transcript: t, confidence: 0.9 } } } })
                this.onresult && this.onresult(mk('cuánto se vendió hoy', false))
                setTimeout(() => { this.onresult && this.onresult(mk('cuánto se vendió hoy', true)); this.onend && this.onend() }, 250)
              } else if (m === 'silent-end') { this.onend && this.onend() }
              else { this.onerror && this.onerror({ error: m, message: '' }); this.onend && this.onend() }
            }, 60)
          }
          stop() { this.onend && this.onend() }
          abort() { this.onend && this.onend() }
        }
        window.webkitSpeechRecognition = FakeRec
        window.SpeechRecognition = FakeRec
      }, mode)
    }
    await vpage.goto(base)
    try { await seed(vpage, false) } catch (e) { R.voice[name] = { seedError: e.message }; await vctx.close(); continue }
    await goScreen(vpage, 'Queen', 'Queen')
    const samples = {}
    const micSel = '.queen-mic-btn'
    const hasMic = await vpage.evaluate((s) => !!document.querySelector(s), micSel)
    if (hasMic) {
      await vpage.click(micSel)
      for (const t of [250, 900, 2200]) {
        await vpage.waitForTimeout(t === 250 ? 250 : t - (t === 900 ? 250 : 900))
        samples[`t${t}`] = await vpage.evaluate(() => {
          const st = document.querySelector('.queen-voice-status')
          const mic = document.querySelector('.queen-mic-btn')
          return { statusVisible: !!st, statusText: st ? st.innerText.replace(/\s+/g, ' ').trim().slice(0, 130) : null, micPressed: mic?.getAttribute('aria-pressed'), micClass: mic?.className }
        })
      }
      if (name === 'not-allowed') await vpage.screenshot({ path: path.join(OUT, 'voz-not-allowed-light-360.png') })
      if (name === 'real') await vpage.screenshot({ path: path.join(OUT, 'voz-real-light-360.png') })
    }
    R.voice[name] = { hasMic, samples, errors: verrs }
    await vctx.close()
  }
}

if (errs) R.errors.push(...errs)
fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(R, null, 1))
console.log(JSON.stringify({ metrics: R.screens.sistema?.metrics, nodesMoved: R.screens.sistema?.nodesMoved, ficha: R.ficha, voiceReal: R.voice.real, errors: R.errors.slice(0, 8) }, null, 1))
await browser.close()
server.close()
