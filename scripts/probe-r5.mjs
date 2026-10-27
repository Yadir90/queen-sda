#!/usr/bin/env node
/* Sonda de la oleada R5 (26-oct) — verificación RENDERIZADA de los
 * seis defectos reportados por el dueño sobre el build desplegado:
 *  D-R5-01 Sistema: botones de «Accesos directos» sobre el título.
 *  D-R5-02 Queen sin voz: ningún punto de entrada de voz; el chat
 *          de texto envía y responde.
 *  D-R5-03 «Menú» aterriza en Menú e «Importar» en Importar.
 *  D-R5-04 Otros ingresos: tarjetas por categoría sin estrujar
 *          (una columna a 360 px; ninguna palabra partida).
 *  D-R5-05 Economía: importes del Panel de cierre en UNA línea y
 *          «8.500» con separador de miles.
 *  D-R5-06 Tema oscuro = tokens del theme.css original + capturas
 *          de las 4 pantallas de referencia (Menú, RH·Pagos,
 *          Inicio-calendario, Inicio-pulso).
 * Modo local (sin Supabase): login local, cambio de contraseña y
 * semilla por la vía real NUEVA (Más → Importar → respaldo JSON).
 * Uso: node scripts/probe-r5.mjs [--out audits/r5]
 * Sale 1 si alguna puerta (gate) falla. */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = path.resolve(REPO, opt('--out', 'audits/r5'))
fs.mkdirSync(OUT, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const EMAIL = 'yadir.medina900710@gmail.com'
const PORT = 8917
const CHROME = process.env.CHROME_BIN || fs.globSync(`${os.homedir()}/.cache/ms-playwright/*/chrome-linux64/chrome`)[0]

const results = []
const gate = (id, name, ok, extra = '') => { results.push({ id, name, ok, extra }); console.log(`${ok ? '✓' : '✗'} [${id}] ${name}${extra ? ` — ${extra}` : ''}`) }
const note = (id, name, extra = '') => { results.push({ id, name, ok: null, extra }); console.log(`· [${id}] ${name}${extra ? ` — ${extra}` : ''}`) }

/* ---------- servidor estático del dist del repo ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = path.join(REPO, 'dist', decodeURIComponent(url.pathname))
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(REPO, 'dist', 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise((r) => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'es-ES' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

const waitText = (needle, timeout = 30000) =>
  page.waitForFunction((n) => (document.body?.innerText ?? '').toLowerCase().includes(n), needle.toLowerCase(), { timeout })

async function clickByText(label, selector = 'button, a, .mas-card, .nav-btn') {
  const done = await page.evaluate(({ label, selector }) => {
    const els = [...document.querySelectorAll(selector)]
    const el = els.find((e) => (e.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()) && e.getClientRects().length > 0)
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, { label, selector })
  if (!done) throw new Error(`clickByText: no encontrado «${label}»`)
  await page.waitForTimeout(450)
}

/* ---------- login local + cambio de contraseña ---------- */
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.fill('#lg-email', EMAIL)
await page.fill('#lg-pass', 'Admin1')
await page.click('.login-form .btn.primary, .login-card .btn.primary, button[type="submit"]')
await page.waitForSelector('#cp-temp', { timeout: 20000 })
await page.fill('#cp-temp', 'Admin1')
await page.fill('#cp-new', 'AuditoriaVisual1')
await page.fill('#cp-rep', 'AuditoriaVisual1')
await page.click('button[type="submit"]')
await page.waitForSelector('.app-shell', { timeout: 30000 })

/* ---------- semilla por la vía real nueva: Más → Importar ---------- */
await clickByText('Más', '.bottomnav button')
await clickByText('Importar', '.mas-card')
await waitText('Importar IPV del día')
await page.setInputFiles('main input[type="file"][accept*="json"]', BACKUP)
await waitText('Verificación del archivo')
await clickByText('Confirmar importación')
await page.waitForSelector('.ok-box', { timeout: 30000 })
await waitText('Respaldo importado')
note('seed', 'respaldo del 26-oct importado por Más → Importar (ruta D-R5-03)')

const shot = (name) => page.screenshot({ path: path.join(OUT, name) })
const clipOf = async (locator, name) => { await locator.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await locator.screenshot({ path: path.join(OUT, name) }) }

/* ================= TEMA OSCURO ================= */
await page.emulateMedia({ colorScheme: 'dark' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.app-shell', { timeout: 30000 })

/* — D-R5-06: tokens oscuros computados = theme.css del original — */
{
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const pick = (n) => cs.getPropertyValue(n).trim()
    return { bg: pick('--bg'), surface: pick('--surface'), alt: pick('--surface-alt'), border: pick('--border'), text: pick('--text'), dim: pick('--dim'), deep: pick('--deep') }
  })
  const expected = { bg: '#0a1411', surface: '#15241e', alt: '#1c2f27', border: '#273f33', text: '#eaf5f0', dim: '#9dbcae', deep: '#0b3d2e' }
  const bad = Object.entries(expected).filter(([k, v]) => tokens[k] !== v).map(([k, v]) => `${k}: ${tokens[k]}≠${v}`)
  gate('D-R5-06', 'tokens oscuros computados = bloque oscuro del theme.css original', bad.length === 0, bad.join('; ') || JSON.stringify(tokens))
  /* El chip y el degradado del héroe en oscuro: la base duplicada en
     dos hojas ganaba la cascada (medido: chip #0b3d2e ilegible). */
  const hero = await page.evaluate(() => {
    const chip = document.querySelector('.tab-header-chip')
    const head = document.querySelector('.tab-header')
    return { chip: chip ? getComputedStyle(chip).color : '', bg: head ? getComputedStyle(head).backgroundImage : '' }
  })
  gate('D-R5-06', 'chip del héroe legible en oscuro (color = --text) y degradado con mezcla turquesa', hero.chip === 'rgb(234, 245, 240)' && !hero.bg.includes('rgb(20, 56, 59)'), `chip=${hero.chip}, bg=${hero.bg.slice(0, 90)}`)
}

/* — D-R5-03: Menú aterriza en Menú (oscuro) + captura de referencia — */
await clickByText('Más', '.bottomnav button')
await clickByText('Menú', '.mas-card')
await waitText('Menú del día')
{
  const h2 = await page.evaluate(() => document.querySelector('.tab-header h2')?.textContent?.trim() ?? '')
  const items = await page.locator('main .list.row').count()
  gate('D-R5-03', '«Menú» abre la pantalla Menú (oscuro)', h2 === 'Menú' && items > 0, `h2=${h2}, filas=${items}`)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await shot('d-r5-06-menu-oscuro.png')
}

/* — D-R5-03: Importar aterriza en Importar (oscuro) — */
await clickByText('Más', '.bottomnav button')
await clickByText('Importar', '.mas-card')
await waitText('Importar respaldo del SDA')
{
  const h2 = await page.evaluate(() => document.querySelector('.tab-header h2')?.textContent?.trim() ?? '')
  gate('D-R5-03', '«Importar» abre la pantalla Importar (oscuro)', h2 === 'Importar', `h2=${h2}`)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await shot('d-r5-03-importar-oscuro.png')
}

/* — D-R5-01: Sistema, accesos directos sin solape (oscuro) — */
await clickByText('Sistema', '.bottomnav button')
await waitText('De un vistazo')
{
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.system-shortcuts')
    if (!nav) return { error: 'sin .system-shortcuts' }
    let card = nav.parentElement
    while (card && !card.querySelector('h3')) card = card.parentElement
    const h3 = [...(card?.querySelectorAll('h3') ?? [])].find((t) => t.textContent.includes('Accesos directos'))
    if (!h3) return { error: 'sin h3 Accesos directos' }
    h3.scrollIntoView({ block: 'center' })
    const hr = h3.getBoundingClientRect()
    const btns = [...nav.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim().slice(0, 24), x: r.x, y: r.y, w: r.width, h: r.height } })
    const overlaps = btns.filter((b) => b.y < hr.bottom && b.y + b.h > hr.top && b.x < hr.right && b.x + b.w > hr.left)
    return { h3: { y: hr.y, bottom: hr.bottom, text: h3.textContent.trim() }, btns, overlaps: overlaps.map((b) => b.label), navY: nav.getBoundingClientRect().y }
  })
  gate('D-R5-01', 'Sistema oscuro: el título «Accesos directos» no intersecta ningún botón', !m.error && m.overlaps.length === 0, m.error ?? `botones=${m.btns?.length}, solapes=${JSON.stringify(m.overlaps)}`)
  if (!m.error) {
    const nav = page.locator('.system-shortcuts')
    await clipOf(nav, 'd-r5-01-accesos-oscuro.png')
  }
}

/* — D-R5-02: Queen sin voz y chat de texto vivo (oscuro) — */
await clickByText('Queen', '.bottomnav button')
await page.waitForSelector('#queen-input', { timeout: 20000 })
{
  const counts = await page.evaluate(() => ({
    micBtn: document.querySelectorAll('.queen-mic-btn').length,
    voiceBar: document.querySelectorAll('.queen-voice-bar').length,
    voiceStatus: document.querySelectorAll('.queen-voice-status').length,
    micLabel: [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('micrófono')).length,
  }))
  gate('D-R5-02', 'Queen sin micrófono ni barra/estado de voz', counts.micBtn === 0 && counts.voiceBar === 0 && counts.voiceStatus === 0 && counts.micLabel === 0, JSON.stringify(counts))
  /* Al enviar, el saludo (burbuja de Queen sin historial) se sustituye
     por el hilo real [usuario, respuesta]: el conteo de burbujas de
     Queen NO crece — la señal es la burbuja de usuario y que la
     última de Queen ya no sea el saludo. */
  const greeting = await page.evaluate(() => [...document.querySelectorAll('.queen-bubble-queen')].at(-1)?.textContent?.trim() ?? '')
  await page.click('#queen-input')
  await page.keyboard.type('¿Cómo vamos?')
  await page.click('.queen-send-btn')
  await page.waitForFunction((g) => {
    const users = document.querySelectorAll('.queen-bubble-user').length
    const last = [...document.querySelectorAll('.queen-bubble-queen')].at(-1)?.textContent?.trim() ?? ''
    return users >= 1 && last !== g && !document.querySelector('.queen-typing')
  }, greeting, { timeout: 20000 })
  const lastText = await page.evaluate(() => [...document.querySelectorAll('.queen-bubble-queen')].at(-1)?.textContent?.trim().slice(0, 60) ?? '')
  gate('D-R5-02', 'el chat de texto envía y Queen responde', lastText.length > 3, lastText)
  /* D-R5-07: el panel «Capa de lenguaje» sin narración de obra. */
  const langText = await page.evaluate(() => document.querySelector('.queen-lang')?.textContent ?? '')
  const scaffolding = ['puerta final', 'decisión del dueño', 'esta copia', 'sistema original', 'se despliega'].filter((p) => langText.includes(p))
  gate('D-R5-07', 'panel «Capa de lenguaje» sin narración de obra ni estado falso', scaffolding.length === 0 && langText.includes('Capa de lenguaje'), scaffolding.join(', ') || langText.slice(0, 80))
}

/* — D-R5-04: Otros ingresos sin estrujar (oscuro) — */
await clickByText('Más', '.bottomnav button')
await clickByText('Otros ingresos', '.mas-card')
await page.waitForSelector('.mod-cat-grid', { timeout: 20000 })
{
  const m = await page.evaluate(() => {
    const grid = document.querySelector('.grid-2.mod-cat-grid')
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length
    const mains = [...grid.querySelectorAll('.mod-row-main')].map((e) => e.getBoundingClientRect().width)
    const splitWords = []
    for (const t of grid.querySelectorAll('.mod-row-title')) {
      for (const word of (t.textContent ?? '').trim().split(/\s+/)) {
        if (!word) continue
        const range = document.createRange()
        const node = t.firstChild
        const idx = (node?.textContent ?? '').indexOf(word)
        if (!node || idx < 0) continue
        range.setStart(node, idx); range.setEnd(node, idx + word.length)
        if (range.getClientRects().length > 1) splitWords.push(word)
      }
    }
    return { cols, minMain: Math.min(...mains), rows: mains.length, splitWords }
  })
  gate('D-R5-04', 'Extras oscuro: una columna a 360 px y ninguna palabra partida', m.cols === 1 && m.minMain >= 120 && m.splitWords.length === 0, JSON.stringify(m))
  await clipOf(page.locator('.grid-2.mod-cat-grid'), 'd-r5-04-extras-oscuro.png')
}

/* — D-R5-05: Panel de cierre de Economía (oscuro) — */
await clickByText('Más', '.bottomnav button')
await clickByText('Economía', '.mas-card')
await waitText('Panel de cierre')
{
  const m = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('h3')]
    const h = heads.find((t) => t.textContent.includes('Panel de cierre'))
    const card = h?.closest('section, .card, div')
    const rows = [...(card?.querySelectorAll('.rec-detail .row') ?? [])].map((r) => {
      const strong = r.querySelector('strong')
      return { label: r.querySelector('span')?.textContent?.trim().slice(0, 30) ?? '', value: strong?.textContent?.trim() ?? '', rects: strong ? strong.getClientRects().length : 0 }
    })
    const extras = rows.find((r) => r.label.startsWith('Ingresos extras'))
    return { rows, split: rows.filter((r) => r.value && r.rects !== 1), extras }
  })
  gate('D-R5-05', 'Economía oscuro: ningún importe del cierre partido en dos líneas', m.split.length === 0, m.split.map((r) => `${r.label}=${r.value}`).join('; ') || `${m.rows.length} filas en una línea`)
  gate('D-R5-05', '«Ingresos extras» con separador de miles (8.500)', Boolean(m.extras?.value.includes('8.500')), m.extras?.value ?? 'fila no encontrada')
  const h = page.locator('h3', { hasText: 'Panel de cierre' })
  await clipOf(h.locator('xpath=ancestor::*[contains(@class,"card")][1]'), 'd-r5-05-cierre-oscuro.png')
}

/* — D-R5-06: capturas de referencia oscuras (RH · Pagos, Inicio) — */
await clickByText('Más', '.bottomnav button')
await clickByText('RH · Pagos', '.mas-card')
await waitText('RH · Pagos')
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await shot('d-r5-06-rh-oscuro.png')
await clickByText('Inicio', '.bottomnav button')
await waitText('Resumen de hoy')
{
  const heat = page.locator('text=El mes en calor').first()
  await clipOf(heat.locator('xpath=ancestor::*[contains(@class,"card")][1]'), 'd-r5-06-inicio-calendario-oscuro.png')
  const heatCheck = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.heat-cell')]
    const cs = cells.length ? getComputedStyle(cells[0]) : null
    return { cells: cells.length, fontSize: cs?.fontSize, fontWeight: cs?.fontWeight, nota: (document.body.innerText ?? '').includes('verde más intenso = más venta ese día') }
  })
  gate('D-R5-06', 'calendario de calor: celdas 12px/700 como el original y nota «Cómo leerlo» presente', heatCheck.cells >= 28 && heatCheck.fontSize === '12px' && heatCheck.fontWeight === '700' && heatCheck.nota, JSON.stringify(heatCheck))
  const pulse = page.locator('text=Pulso diario').first()
  await clipOf(pulse.locator('xpath=ancestor::*[contains(@class,"card")][1]'), 'd-r5-06-inicio-pulso-oscuro.png')
}

/* ================= TEMA CLARO ================= */
await page.emulateMedia({ colorScheme: 'light' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.app-shell', { timeout: 30000 })

await clickByText('Sistema', '.bottomnav button')
await waitText('De un vistazo')
{
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.system-shortcuts')
    if (!nav) return { error: 'sin .system-shortcuts' }
    let card = nav.parentElement
    while (card && !card.querySelector('h3')) card = card.parentElement
    const h3 = [...(card?.querySelectorAll('h3') ?? [])].find((t) => t.textContent.includes('Accesos directos'))
    if (!h3) return { error: 'sin h3' }
    h3.scrollIntoView({ block: 'center' })
    const hr = h3.getBoundingClientRect()
    const overlaps = [...nav.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.y < hr.bottom && r.y + r.height > hr.top && r.x < hr.right && r.x + r.width > hr.left }).length
    return { overlaps }
  })
  gate('D-R5-01', 'Sistema claro: sin solape título/botones', !m.error && m.overlaps === 0, m.error ?? `solapes=${m.overlaps}`)
  await clipOf(page.locator('.system-shortcuts'), 'd-r5-01-accesos-claro.png')
}

await clickByText('Más', '.bottomnav button')
await clickByText('Menú', '.mas-card')
await waitText('Menú del día')
{
  const h2 = await page.evaluate(() => document.querySelector('.tab-header h2')?.textContent?.trim() ?? '')
  gate('D-R5-03', '«Menú» abre Menú (claro)', h2 === 'Menú', `h2=${h2}`)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await shot('d-r5-03-menu-claro.png')
}
await clickByText('Más', '.bottomnav button')
await clickByText('Importar', '.mas-card')
await waitText('Importar respaldo del SDA')
{
  const h2 = await page.evaluate(() => document.querySelector('.tab-header h2')?.textContent?.trim() ?? '')
  gate('D-R5-03', '«Importar» abre Importar (claro)', h2 === 'Importar', `h2=${h2}`)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await shot('d-r5-03-importar-claro.png')
}

await clickByText('Más', '.bottomnav button')
await clickByText('Otros ingresos', '.mas-card')
await page.waitForSelector('.mod-cat-grid', { timeout: 20000 })
{
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.grid-2.mod-cat-grid')).gridTemplateColumns.split(' ').length)
  gate('D-R5-04', 'Extras claro: una columna a 360 px', cols === 1, `columnas=${cols}`)
  await clipOf(page.locator('.grid-2.mod-cat-grid'), 'd-r5-04-extras-claro.png')
}

await clickByText('Más', '.bottomnav button')
await clickByText('Economía', '.mas-card')
await waitText('Panel de cierre')
{
  const split = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((t) => t.textContent.includes('Panel de cierre'))
    const card = h?.closest('section, .card, div')
    return [...(card?.querySelectorAll('.rec-detail .row > strong') ?? [])].filter((s) => s.getClientRects().length !== 1).length
  })
  gate('D-R5-05', 'Economía claro: ningún importe partido', split === 0, `partidos=${split}`)
  const h = page.locator('h3', { hasText: 'Panel de cierre' })
  await clipOf(h.locator('xpath=ancestor::*[contains(@class,"card")][1]'), 'd-r5-05-cierre-claro.png')
}

/* — Barrido de desborde horizontal (claro): pantallas principales — */
for (const [label, sel] of [['Inicio', '.bottomnav button'], ['Cobrar', '.bottomnav button'], ['Sistema', '.bottomnav button']]) {
  await clickByText(label, sel)
  await page.waitForTimeout(500)
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  note('overflow', `${label} claro: scrollWidth=${w}`, w <= 361 ? 'sin desborde' : 'DESBORDE')
}

fs.writeFileSync(path.join(OUT, 'mediciones.json'), JSON.stringify(results, null, 2))
await browser.close()
server.close()
const fails = results.filter((r) => r.ok === false)
console.log(fails.length === 0 ? '\nSONDA R5: TODAS LAS PUERTAS EN VERDE' : `\nSONDA R5: ${fails.length} PUERTAS FALLARON`)
process.exit(fails.length ? 1 : 0)
