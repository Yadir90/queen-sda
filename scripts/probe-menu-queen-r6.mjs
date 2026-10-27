#!/usr/bin/env node
/* Sonda de la oleada MENÚ+QUEEN-R6 (27-oct) — en lo RENDERIZADO:
 * Menú reconstruido regla a regla contra el MenuTab del original
 * (título con ⓘ, tarjeta de fecha con sus 5 acciones, etiqueta de
 * origen, editor por plato, Historial, textos, plato a mano y
 * vista previa blanca) con comportamiento DEMOSTRADO (editar →
 * aviso de cambios → guardar día/base → recargar y persiste →
 * ojo que oculta de la previa → Historial que devuelve → plato
 * manual que entra), y Queen SIN el panel «Capa de lenguaje» con
 * el chat respondiendo. Claro Y oscuro, 360 px, semilla real del
 * 26-oct importada por la vía real (Más → Importar). Las cifras
 * esperadas se calculan en Node con los MISMOS núcleos y la MISMA
 * semilla (mismo estado).
 * Uso: node scripts/probe-menu-queen-r6.mjs
 * Sale 1 si alguna puerta (gate) falla. */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { buildProductsCatalog, findMenuRuleConflicts } from '../src/lib/productosCore.mjs'
import { buildMenuCatalog, menuHistoryCount, resolveMenuDoc } from '../src/lib/menuCore.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-menu-probe-'))
execFileSync('npx', ['vite', 'build', '--outDir', BUILD_DIR, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
const OUT_MENU = path.join(REPO, 'audits/menu-r6')
const OUT_QUEEN = path.join(REPO, 'audits/queen-lenguaje-r6')
fs.mkdirSync(OUT_MENU, { recursive: true })
fs.mkdirSync(OUT_QUEEN, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const EMAIL = 'yadir.medina900710@gmail.com'
const PORT = 8921
const CHROME = process.env.CHROME_BIN || fs.globSync(`${os.homedir()}/.cache/ms-playwright/*/chrome-linux64/chrome`)[0]

/* Expectativas desde el MISMO estado (semilla + núcleos). */
const parsed = parseBackup(JSON.parse(fs.readFileSync(BACKUP, 'utf8')))
const seedData = { days: parsed.days, inventoryAdjustments: parsed.inventoryAdjustments ?? [] }
const menuCatalog = buildMenuCatalog(seedData, {})
const emptyState = { base: null, days: {}, availability: {}, profiles: {} }
const expectedDoc = resolveMenuDoc(emptyState, '2026-10-27', menuCatalog.products).doc
const expectedIncluded = expectedDoc.items.filter((i) => i.included).length
const expectedHistory = menuHistoryCount(expectedDoc, menuCatalog.products)
const rawCatalog = buildProductsCatalog(seedData.days, seedData.inventoryAdjustments)
const conflictNames = [...new Set(findMenuRuleConflicts(rawCatalog.products.map((p) => p.name)).map((c) => c.name))]
  .map((n) => rawCatalog.products.find((p) => p.name === n)?.name ?? n)

const results = []
const gate = (id, name, ok, extra = '') => { results.push({ id, name, ok, extra }); console.log(`${ok ? '✓' : '✗'} [${id}] ${name}${extra ? ` — ${extra}` : ''}`) }
const note = (id, name, extra = '') => { results.push({ id, name, ok: null, extra }); console.log(`· [${id}] ${name}${extra ? ` — ${extra}` : ''}`) }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = path.join(BUILD_DIR, decodeURIComponent(url.pathname))
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(BUILD_DIR, 'index.html')
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

async function gotoSection(label) {
  const inNav = await page.evaluate((l) => [...document.querySelectorAll('.bottomnav button')].some((b) => (b.textContent ?? '').trim().toLowerCase().includes(l)), label.toLowerCase())
  if (inNav) { await clickByText(label, '.bottomnav button'); return }
  await clickByText('Más', '.bottomnav button')
  await clickByText(label, '.mas-card')
}

/* ---------- login local + semilla por la vía real ---------- */
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.fill('#lg-email', EMAIL)
await page.fill('#lg-pass', 'Admin1')
await page.click('.auth-card button[type="submit"]')
await page.waitForSelector('#cp-temp', { timeout: 20000 })
await page.fill('#cp-temp', 'Admin1')
await page.fill('#cp-new', 'AuditoriaVisual1')
await page.fill('#cp-rep', 'AuditoriaVisual1')
await page.click('button[type="submit"]')
await page.waitForSelector('.app-shell', { timeout: 30000 })
await clickByText('Más', '.bottomnav button')
await clickByText('Importar', '.mas-card')
await waitText('Importar IPV del día')
await page.setInputFiles('main input[type="file"][accept*="json"]', BACKUP)
await waitText('Verificación del archivo')
await clickByText('Confirmar importación')
await page.waitForSelector('.ok-box', { timeout: 30000 })
await waitText('Respaldo importado')
note('seed', 'respaldo del 26-oct importado por Más → Importar', `incluidos esperados=${expectedIncluded}, historial esperado=${expectedHistory}`)

const shot = (dir, name) => page.screenshot({ path: path.join(dir, name) })

async function auditMenu(theme) {
  const T = theme === 'dark' ? 'oscuro' : 'claro'
  await page.emulateMedia({ colorScheme: theme })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await gotoSection('Menú')
  await waitText('Menú del día')
  await page.waitForSelector('.menu-item-card', { timeout: 30000 })
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400)
  await shot(OUT_MENU, `menu-top-${T}.png`)

  /* — Título con ⓘ y tarjeta de fecha con las 5 acciones — */
  {
    const m = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.menu-actions-row button')].map((b) => b.textContent.trim().replace(/\s+/g, ' '))
      return {
        tabH2: document.querySelector('.tab-header h2')?.textContent?.trim() ?? '',
        title: document.querySelector('.menu-title')?.textContent?.trim() ?? '',
        infoBtn: Boolean(document.querySelector('.menu-title .info-help-btn')),
        btns,
        source: document.querySelector('.menu-source-line')?.textContent?.trim() ?? '',
        dateVal: document.querySelector('#menu-fecha')?.value ?? '',
      }
    })
    gate('MEN-CAB', `${T}: TabHeader «Menú» + título «Menú del día» con su ⓘ`, m.tabH2 === 'Menú' && m.title.startsWith('Menú del día') && m.infoBtn, JSON.stringify(m).slice(0, 160))
    gate('MEN-ACT', `${T}: las 5 acciones del original en la tarjeta de fecha`, ['Guardar menú de hoy', 'Guardar como base', 'Restablecer desde Productos', 'Enviar menú por correo'].every((b) => m.btns.includes(b)) && m.btns.some((b) => b.startsWith('Historial')), m.btns.join(' · '))
    gate('MEN-ACT', `${T}: Historial con el conteo del mismo estado (${expectedHistory})`, m.btns.some((b) => b === `Historial (${expectedHistory})`), m.btns.find((b) => b.startsWith('Historial')) ?? 'sin botón')
    gate('MEN-ORIGEN', `${T}: etiqueta de origen «Generado desde Productos» al abrir sin estado guardado`, m.source.includes('En pantalla:') && m.source.includes('Generado desde Productos (existencia y precio vigente)'), m.source.slice(0, 110))
    /* El ⓘ abre la explicación literal del original. */
    await page.evaluate(() => document.querySelector('.menu-title .info-help-btn')?.click())
    await page.waitForTimeout(300)
    const panel = await page.evaluate(() => document.querySelector('.menu-title .info-help-panel')?.innerText ?? '')
    gate('MEN-CAB', `${T}: el ⓘ abre «Cómo funciona el Menú» con el texto del original`, panel.includes('Se genera solo desde') && panel.includes('no toca') && panel.includes('ojo'), panel.slice(0, 90))
    await page.evaluate(() => document.querySelector('.menu-title .info-help-btn')?.click())
  }

  /* — Editor y vista previa: mismas cifras del mismo estado — */
  {
    const m = await page.evaluate(() => ({
      editorCards: document.querySelectorAll('.menu-item-card').length,
      previewItems: document.querySelectorAll('.menu-preview-item').length,
      previewBrand: document.querySelector('.menu-preview-brand')?.textContent?.trim() ?? '',
      previewDocTitle: document.querySelector('.menu-preview-doctitle')?.textContent?.trim() ?? '',
      previewDate: document.querySelector('.menu-preview-date')?.textContent?.trim() ?? '',
      previewFooter: document.querySelector('.menu-preview-footer')?.textContent?.trim() ?? '',
      previewBg: getComputedStyle(document.querySelector('.menu-preview')).backgroundColor,
      hasTextsCard: Boolean(document.querySelector('#menu-subtitulo')),
      hasManualForm: Boolean(document.querySelector('form[aria-label="Añadir plato manual al menú"]')),
      sections: [...document.querySelectorAll('.menu-section-title')].map((s) => s.textContent.trim()),
    }))
    gate('MEN-ED', `${T}: filas del editor = platos incluidos del estado (${expectedIncluded})`, m.editorCards === expectedIncluded, `editor=${m.editorCards}`)
    gate('MEN-PREV', `${T}: la vista previa trae los mismos ítems que el editor`, m.previewItems === m.editorCards, `previa=${m.previewItems}`)
    gate('MEN-PREV', `${T}: previa blanca del PDF (marca, título, fecha con «Precios en CUP», pie)`, m.previewBrand === 'La Reina' && m.previewDocTitle === 'Menú del día' && m.previewDate.includes('Precios en CUP') && m.previewFooter === 'La Reina Restaurante-Bar' && m.previewBg === 'rgb(255, 255, 255)', JSON.stringify(m).slice(0, 220))
    gate('MEN-ED', `${T}: textos del menú y formulario de plato a mano presentes`, m.hasTextsCard && m.hasManualForm)
    gate('MEN-ED', `${T}: secciones con la etiqueta del original (Cocina/Coctelería…)`, m.sections.length > 0 && m.sections.every((s) => !['Elaboración', 'Cantina'].includes(s) || s.includes('(')), m.sections.join(' · '))
    const prev = page.locator('.menu-preview-wrap')
    await prev.scrollIntoViewIfNeeded(); await page.waitForTimeout(250)
    await prev.screenshot({ path: path.join(OUT_MENU, `menu-previa-${T}.png`) })
  }

  /* — Contraste oscuro del original: texto --deep → menta — */
  {
    const m = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.menu-btn-outline-deep')][0]
      if (!b) return { btn: false }
      const cs = getComputedStyle(b)
      return { btn: true, color: cs.color, border: cs.borderTopColor }
    })
    const exp = theme === 'dark' ? { color: 'rgb(167, 215, 188)', border: 'rgb(61, 122, 94)' } : { color: 'rgb(11, 61, 46)', border: 'rgb(11, 61, 46)' }
    gate('MEN-ESTILO', `${T}: botón outline-deep con el contraste del original (texto/borde --deep)`, m.btn && m.color === exp.color && m.border === exp.border, JSON.stringify(m))
  }

  /* — Regla de cocina y textos de andamiaje — */
  {
    const bodyText = await page.evaluate(() => document.body.innerText)
    const present = conflictNames.filter((n) => bodyText.includes(n))
    gate('MEN-REGLA', `${T}: ningún producto de la regla de cocina aparece en la pestaña`, present.length === 0, present.length ? `presentes: ${present.join(', ')}` : `fuera: ${conflictNames.join(', ')}`)
    const banned = ['Excluidos por la regla de cocina', 'del clon', 'en el clon', 'Capa de lenguaje', 'solo lectura']
    const found = banned.filter((b) => bodyText.toLowerCase().includes(b.toLowerCase()))
    gate('MEN-TEXT', `${T}: sin caja de excluidos ni textos de andamiaje`, found.length === 0, found.join(' · '))
  }

  /* — Desborde — */
  {
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    gate('MEN-OVER', `${T}: sin desborde horizontal a 360 px`, w <= 361, `scrollWidth=${w}`)
  }
}

await auditMenu('dark')
await auditMenu('light')

/* ---------- Comportamiento demostrado (oscuro) ---------- */
await page.emulateMedia({ colorScheme: 'dark' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.app-shell', { timeout: 30000 })
await gotoSection('Menú')
await page.waitForSelector('.menu-item-card', { timeout: 30000 })
const date0 = await page.evaluate(() => document.querySelector('#menu-fecha')?.value ?? '')
const nextDay = (() => { const d = new Date(`${date0}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()

/* Editar un precio → aviso de cambios sin guardar. */
const firstPrice = page.locator('.menu-item-card .menu-item-price').first()
await firstPrice.scrollIntoViewIfNeeded()
await firstPrice.fill('777')
await page.waitForTimeout(300)
{
  const dirty = await page.evaluate(() => document.querySelector('.menu-source-line')?.textContent?.includes('Tienes cambios sin guardar.') ?? false)
  gate('MEN-COMP', 'editar un precio del menú enciende «Tienes cambios sin guardar»', dirty)
}
/* Guardar el día → etiqueta de origen del día; guardar como base. */
await clickByText('Guardar menú de hoy', '.menu-actions-row button')
await page.waitForFunction(() => (document.querySelector('.menu-source-line')?.textContent ?? '').includes('Menú guardado para este día'), null, { timeout: 20000 })
gate('MEN-COMP', '«Guardar menú de hoy» deja la etiqueta «Menú guardado para este día»', true)
await clickByText('Guardar como base', '.menu-actions-row button')
await page.waitForTimeout(600)
/* Recargar: el día guardado y el precio 777 persisten (ida y vuelta real). */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.app-shell', { timeout: 30000 })
await gotoSection('Menú')
await page.waitForSelector('.menu-item-card', { timeout: 30000 })
{
  const m = await page.evaluate(() => ({
    source: document.querySelector('.menu-source-line')?.textContent ?? '',
    price: document.querySelector('.menu-item-card .menu-item-price')?.value ?? '',
  }))
  gate('MEN-COMP', 'tras recargar manda el día guardado y el precio editado persiste (777)', m.source.includes('Menú guardado para este día') && m.price === '777', JSON.stringify(m).slice(0, 140))
}
/* Cambiar de fecha: manda la base. */
await page.fill('#menu-fecha', nextDay)
await page.waitForTimeout(700)
{
  const source = await page.evaluate(() => document.querySelector('.menu-source-line')?.textContent ?? '')
  gate('MEN-COMP', 'en otra fecha manda «Desde tu menú base guardado»', source.includes('Desde tu menú base guardado'), source.slice(0, 110))
  await page.fill('#menu-fecha', date0)
  await page.waitForTimeout(700)
}
/* Ojo: ocultar saca el plato de la previa; el Historial lo devuelve. */
const prevCount = async () => page.evaluate(() => document.querySelectorAll('.menu-preview-item').length)
const before = await prevCount()
await page.evaluate(() => { document.querySelector('.menu-item-card .menu-eye-btn')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(250)
await page.evaluate(() => document.querySelector('.menu-item-card .menu-eye-btn')?.click())
await page.waitForTimeout(700)
{
  const after = await prevCount()
  gate('MEN-COMP', 'el ojo oculta el plato de la vista previa (previa −1)', after === before - 1, `${before} → ${after}`)
}
await shot(OUT_MENU, 'menu-ojo-oscuro.png')
await clickByText('Historial', '.menu-actions-row button')
await page.waitForSelector('#menu-historial', { timeout: 15000 })
await page.evaluate(() => { document.querySelector('#menu-historial button')?.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(300)
{
  const m = await page.evaluate(() => ({
    entries: document.querySelectorAll('#menu-historial .menu-history-card').length,
    hasVisibleBtn: [...document.querySelectorAll('#menu-historial button')].some((b) => b.textContent.includes('Hacer visible')),
    hasSearch: Boolean(document.querySelector('#menu-historial input[type="search"]')),
  }))
  gate('MEN-COMP', 'el Historial abre con buscador y el oculto ofrece «Hacer visible»', m.entries > 0 && m.hasVisibleBtn && m.hasSearch, JSON.stringify(m))
  await shot(OUT_MENU, 'menu-historial-oscuro.png')
  await page.evaluate(() => { [...document.querySelectorAll('#menu-historial button')].find((b) => b.textContent.includes('Hacer visible'))?.click() })
  await page.waitForTimeout(700)
  const restored = await prevCount()
  gate('MEN-COMP', '«Hacer visible» devuelve el plato a la vista previa', restored === before, `${restored} vs ${before}`)
}
/* Quitar del editor → el Historial lo guarda → Disponible hoy lo devuelve. */
const editorCount = async () => page.evaluate(() => document.querySelectorAll('.menu-item-card').length)
const edBefore = await editorCount()
await page.evaluate(() => window.scrollTo(0, 0))
await page.evaluate(() => { [...document.querySelectorAll('.menu-item-card button')].find((b) => b.textContent.trim() === 'Quitar')?.click() })
await page.waitForTimeout(400)
{
  const edAfter = await editorCount()
  gate('MEN-COMP', '«Quitar» saca el plato del editor (editor −1)', edAfter === edBefore - 1, `${edBefore} → ${edAfter}`)
  await page.evaluate(() => { [...document.querySelectorAll('#menu-historial button')].find((b) => b.textContent.includes('Disponible hoy'))?.click() })
  await page.waitForTimeout(500)
  const edBack = await editorCount()
  gate('MEN-COMP', '«Disponible hoy» del Historial lo devuelve al editor', edBack === edBefore, `${edBack} vs ${edBefore}`)
}
/* Plato a mano: entra en el editor y en la previa. */
await page.fill('input[aria-label="Nombre del plato manual"]', 'Plato sonda del día')
await page.fill('input[aria-label="Precio del plato manual"]', '1234')
await clickByText('Añadir al menú', 'form[aria-label="Añadir plato manual al menú"] button')
await page.waitForTimeout(500)
{
  const m = await page.evaluate(() => ({
    inEditor: [...document.querySelectorAll('.menu-item-card .menu-item-name')].some((i) => i.value === 'Plato sonda del día'),
    inPreview: [...document.querySelectorAll('.menu-preview-item-name')].some((s) => s.textContent === 'Plato sonda del día'),
  }))
  gate('MEN-COMP', 'el plato a mano entra en el editor y en la vista previa', m.inEditor && m.inPreview, JSON.stringify(m))
  await shot(OUT_MENU, 'menu-manual-oscuro.png')
}
/* Restablecer: vuelve el generado desde Productos. */
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300)
await clickByText('Restablecer desde Productos', '.menu-actions-row button')
await page.waitForFunction(() => (document.querySelector('.menu-source-line')?.textContent ?? '').includes('Generado desde Productos'), null, { timeout: 20000 })
gate('MEN-COMP', '«Restablecer desde Productos» vuelve al generado', true)

/* ---------- Queen: sin panel de lenguaje, con chat vivo ---------- */
async function auditQueen(theme) {
  const T = theme === 'dark' ? 'oscuro' : 'claro'
  await page.emulateMedia({ colorScheme: theme })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await gotoSection('Queen')
  await page.waitForSelector('.queen-composer-input', { timeout: 30000 })
  await page.waitForTimeout(600)
  const m = await page.evaluate(() => ({
    langEls: document.querySelectorAll('.queen-lang').length,
    body: document.body.innerText,
  }))
  gate('QUEEN-AUS', `${T}: ningún elemento .queen-lang en la pestaña`, m.langEls === 0, `els=${m.langEls}`)
  gate('QUEEN-AUS', `${T}: sin «Capa de lenguaje», sin botón de redactar ni caja de redacción`, !m.body.includes('Capa de lenguaje') && !m.body.includes('Redactar la última respuesta') && !m.body.includes('Redacción de la capa'))
  await shot(OUT_QUEEN, `queen-sin-panel-${T}.png`)
}
await auditQueen('dark')
await auditQueen('light')

/* El chat sigue respondiendo (determinista) tras la retirada. */
await page.emulateMedia({ colorScheme: 'dark' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.app-shell', { timeout: 30000 })
await gotoSection('Queen')
await page.waitForSelector('.queen-composer-input', { timeout: 30000 })
await page.fill('#queen-input', '¿Cómo va el mes?')
await page.click('.queen-send-btn')
await page.waitForFunction(() => {
  const bubbles = [...document.querySelectorAll('.queen-bubble-queen')]
  const last = bubbles[bubbles.length - 1]
  return last && !last.classList.contains('queen-typing') && (last.textContent ?? '').trim().length > 30
}, null, { timeout: 30000 })
{
  const answer = await page.evaluate(() => [...document.querySelectorAll('.queen-bubble-queen')].pop()?.textContent?.trim() ?? '')
  gate('QUEEN-CHAT', 'el chat responde tras la retirada del panel', answer.length > 30, answer.slice(0, 110))
  await shot(OUT_QUEEN, 'queen-chat-oscuro.png')
}

fs.writeFileSync(path.join(OUT_MENU, 'mediciones.json'), JSON.stringify(results.filter((r) => r.id.startsWith('MEN') || r.id === 'seed'), null, 2))
fs.writeFileSync(path.join(OUT_QUEEN, 'mediciones.json'), JSON.stringify(results.filter((r) => r.id.startsWith('QUEEN')), null, 2))
await browser.close()
server.close()
const fails = results.filter((r) => r.ok === false)
console.log(fails.length === 0 ? '\nSONDA MENÚ+QUEEN: TODAS LAS PUERTAS EN VERDE' : `\nSONDA MENÚ+QUEEN: ${fails.length} PUERTAS FALLARON`)
process.exit(fails.length ? 1 : 0)
