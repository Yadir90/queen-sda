#!/usr/bin/env node
/* Queen SDA — Evidencia de la corrección del icono de Queen
 * (Pieza 0, señalada por el dueño el 2026-10-26 12:15: «el icono
 * del perfil de Queen está dentro de un cuadrado»).
 *
 * QUÉ HACE
 *   Renderiza la app en Chromium headless (modo local, sembrada por
 *   la vía real como scripts/audit-visual.mjs) y MIDE los estilos
 *   computados de cada aparición del icono de perfil de Queen, en
 *   claro y oscuro × 360 y 1280 px:
 *   - .queen-organism (héroe del panel de evolución en Sistema):
 *     radio = mitad del ancho (círculo), borde 0, fondo
 *     transparente, sin sombra y ancho = alto.
 *   - .queen-evolution-stage-image de la etapa actual: círculo de
 *     48 px sin fondo ni anillo cuadrado.
 *   - .queen-orb (barra inferior / cabecera): círculo y, en
 *     oscuro, sin el fondo degradado cuadrado que pintaba antes.
 *   - .side-brand .brand-mark (≥1280): sin cuadrado tintado.
 *   Guarda capturas del organismo en audits/audit-2026-10-26/pieza0/.
 *   Sale 0 si todo cuadra; 1 si algo falla; 2 sin Chromium/respaldo.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'audits/audit-2026-10-26/pieza0')

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
const BACKUP = defaultBackup()

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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(dir, decodeURIComponent(url.pathname))
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const EMAIL = 'yadir.medina900710@gmail.com'
const TEMP = 'Admin1'
const NEWPASS = 'AuditoriaVisual1'

async function seed(page, backupPath) {
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
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sidenav .nav-btn, .bottomnav button')]
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes('Sistema'))
    if (b) b.click()
  })
  const input = page.locator('main input[type="file"][accept*="json"]').first()
  await input.setInputFiles(backupPath)
  await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
  await page.click('button:has-text("Confirmar importación")')
  await page.locator('.ok-box', { hasText: 'Respaldo importado' }).first().waitFor({ timeout: 60000 })
}

function measureFn() {
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      width: +r.width.toFixed(1), height: +r.height.toFixed(1),
      borderRadius: cs.borderTopLeftRadius,
      borderTopWidth: cs.borderTopWidth,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      boxShadow: cs.boxShadow,
    }
  }
  const organism = document.querySelector('.system-evolution .queen-organism')
  if (organism) organism.scrollIntoView({ block: 'center' })
  // El orbe: la primera instancia VISIBLE (la barra lateral está
  // oculta por debajo de 1280 px y su rect sale a 0).
  const visibleOrb = [...document.querySelectorAll('.queen-orb')].find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && getComputedStyle(el).visibility !== 'hidden'
  })
  return {
    organism: pick(organism),
    stageCurrent: pick(document.querySelector('.queen-evolution-stages li.is-current .queen-evolution-stage-image')),
    orb: pick(visibleOrb),
    brandMark: pick(document.querySelector('.side-brand .brand-mark')),
  }
}

/* getComputedStyle puede devolver el radio como «50%» sin resolver:
   se convierte a px contra el ancho del elemento. */
const radiusPx = (m) => {
  const raw = m.borderRadius
  if (raw.endsWith('%')) return (parseFloat(raw) / 100) * m.width
  return parseFloat(raw)
}

const failures = []
const check = (label, cond, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures.push(`${label}: ${detail}`)
}
const isTransparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'

const exe = findChromium()
if (!exe) { console.error('SIN CHROMIUM: evidencia NO generada.'); process.exit(2) }
if (!BACKUP || !fs.existsSync(BACKUP)) { console.error('SIN RESPALDO: evidencia NO generada.'); process.exit(2) }

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-pieza0-'))
execFileSync('npx', ['vite', 'build', '--outDir', buildDir, '--emptyOutDir'], {
  cwd: REPO,
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  stdio: 'pipe',
})
fs.mkdirSync(OUT, { recursive: true })
const server = await serve(buildDir)
const port = server.address().port
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [360, 1280]) {
      console.log(`— ${theme} · ${width}px`)
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
      await seed(page, BACKUP)
      await page.waitForSelector('.system-evolution .queen-organism', { timeout: 20000 })
      // Asentamiento: las animaciones de entrada de la vista no deben
      // contaminar las medidas (una corrida temprana midió en plena
      // transición y el radio parecía no cuadrar).
      await page.waitForTimeout(1400)
      await page.evaluate(measureFn)
      const m = await page.evaluate(measureFn)
      const org = m.organism
      check('organismo presente', !!org)
      if (org) {
        check('organismo circular (radio = mitad del ancho)', Math.abs(radiusPx(org) - org.width / 2) <= 1.5, `radio ${org.borderRadius} · ancho ${org.width}`)
        check('organismo sin borde', org.borderTopWidth === '0px', org.borderTopWidth)
        check('organismo sin fondo', isTransparent(org.backgroundColor) && org.backgroundImage === 'none', `${org.backgroundColor} / ${org.backgroundImage}`)
        check('organismo sin sombra', org.boxShadow === 'none', org.boxShadow)
        check('organismo cuadrado en medidas (ancho = alto)', Math.abs(org.width - org.height) <= 1, `${org.width}×${org.height}`)
        const expected = width === 360 ? 190 : 288
        check(`organismo con el tamaño del original (${expected}px)`, Math.abs(org.width - expected) <= 1.5, `${org.width}`)
      }
      const st = m.stageCurrent
      check('miniatura de etapa presente', !!st)
      if (st) {
        check('miniatura circular 48px sin fondo ni anillo', Math.abs(radiusPx(st) - 24) <= 1.5 && isTransparent(st.backgroundColor) && st.backgroundImage === 'none' && st.boxShadow === 'none',
          `radio ${st.borderRadius} (=${radiusPx(st)}px) · caja ${st.width}×${st.height} · fondo ${st.backgroundColor}/${st.backgroundImage} · sombra ${st.boxShadow}`)
      }
      const orb = m.orb
      check('orbe presente', !!orb)
      if (orb) {
        check('orbe circular y sin fondo (también en oscuro)', Math.abs(radiusPx(orb) - orb.width / 2) <= 1.5 && isTransparent(orb.backgroundColor) && orb.backgroundImage === 'none',
          `radio ${orb.borderRadius} (=${radiusPx(orb)}px) · caja ${orb.width}×${orb.height} · fondo ${orb.backgroundColor}/${orb.backgroundImage}`)
      }
      if (width === 1280) {
        const bm = m.brandMark
        check('marca lateral presente', !!bm)
        if (bm) {
          check('marca lateral sin cuadrado tintado', isTransparent(bm.backgroundColor) && (bm.borderRadius === '0px' || parseFloat(bm.borderRadius) === 0), `fondo ${bm.backgroundColor} · radio ${bm.borderRadius}`)
        }
      }
      const orgEl = page.locator('.system-evolution .queen-organism')
      if (await orgEl.count()) {
        await orgEl.first().screenshot({ path: path.join(OUT, `organismo__${theme}__${width}.png`) })
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failures.length ? `\nPIEZA 0: ${failures.length} FALLOS\n- ${failures.join('\n- ')}` : '\nPIEZA 0: TODAS LAS MEDICIONES CUADRAN (icono circular, sin cuadrado, en claro y oscuro)')
process.exit(failures.length ? 1 : 0)
