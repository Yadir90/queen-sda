#!/usr/bin/env node
/* Prueba del service worker y del modo sin conexión (ronda
   26-oct): la construcción de producción debe registrar el SW,
   este debe ACTIVARSE (la precarga no puede fallar) y, con la
   red cortada tras la primera carga, la app debe abrir y operar
   con sus datos locales. */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const OUT = path.join(REPO, 'audits/audit-2026-10-26/round2-offline')
fs.mkdirSync(OUT, { recursive: true })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-diag-offline-'))
execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let file = path.join(dir, decodeURIComponent(url.pathname))
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`
const cache = path.join(os.homedir(), '.cache/ms-playwright')
const exe = fs.readdirSync(cache).filter((d) => d.startsWith('chromium')).map((d) => path.join(cache, d, 'chrome-linux64/chrome')).find((p) => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const result = { errors }
await page.goto(base)
// El SW debe registrarse y ACTIVARSE (si la precarga falla, nunca activa)
result.sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { soportado: false }
  const reg = await navigator.serviceWorker.getRegistration('/')
  const ready = await Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 8000)),
  ])
  const keys = await caches.keys()
  let shellEntries = []
  if (keys.length) {
    const c = await caches.open(keys[0])
    shellEntries = (await c.keys()).map((r) => new URL(r.url).pathname)
  }
  return {
    soportado: true,
    registrado: Boolean(reg),
    activo: Boolean(reg?.active),
    estadoActivo: reg?.active?.state ?? null,
    instalando: Boolean(reg?.installing),
    esperando: Boolean(reg?.waiting),
    listo: ready,
    caches: keys,
    shellEntries,
  }
})
// Primera carga con red: entrar e importar el respaldo
await page.waitForSelector('#lg-email')
await page.fill('#lg-email', 'yadir.medina900710@gmail.com')
await page.fill('#lg-pass', 'Admin1')
await page.click('.auth-card button[type="submit"]')
await page.waitForSelector('#cp-new')
await page.fill('#cp-temp', 'Admin1'); await page.fill('#cp-new', 'AuditoriaVisual1'); await page.fill('#cp-rep', 'AuditoriaVisual1')
await page.click('.auth-card button[type="submit"]')
await page.waitForSelector('.app-shell')
await page.evaluate(() => { [...document.querySelectorAll('.bottomnav button, .sidenav .nav-btn')].find((b) => b.textContent.includes('Sistema'))?.click() })
await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('De un vistazo'), { timeout: 25000 })
const input = page.locator('main input[type="file"][accept*="json"]').first()
await input.setInputFiles(BACKUP)
await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
await page.click('button:has-text("Confirmar importación")')
await page.locator('.ok-box', { hasText: 'Respaldo importado' }).first().waitFor({ timeout: 60000 })
// Sin conexión: recargar — la carcasa debe salir de la caché
await ctx.setOffline(true)
await page.reload()
await page.waitForTimeout(2500)
result.offline = await page.evaluate(() => ({
  hayShell: Boolean(document.querySelector('.app-shell')),
  hayAuth: Boolean(document.querySelector('.auth-card')),
  titulo: document.title,
  texto: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 140),
}))
await page.screenshot({ path: path.join(OUT, 'offline-tras-recarga.png') })
// Si quedó en bloqueo/acceso, entrar sin conexión (modo local)
if (!result.offline.hayShell) {
  const lockBtn = page.locator('button:has-text("Entrar con contraseña")')
  if (await lockBtn.count()) { await lockBtn.first().click(); await page.waitForTimeout(600) }
  if (await page.locator('#lg-email').count()) {
    await page.fill('#lg-email', 'yadir.medina900710@gmail.com')
    await page.fill('#lg-pass', 'AuditoriaVisual1')
    await page.click('.auth-card button[type="submit"]')
    await page.waitForTimeout(1500)
  }
  result.offline.trasEntrarSinConexion = await page.evaluate(() => ({
    hayShell: Boolean(document.querySelector('.app-shell')),
    texto: (document.querySelector('main')?.textContent || '').replace(/\s+/g, ' ').slice(0, 140),
  }))
  await page.screenshot({ path: path.join(OUT, 'offline-dentro.png') })
}
fs.writeFileSync(path.join(OUT, 'diag-offline.json'), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
await browser.close()
server.close()
