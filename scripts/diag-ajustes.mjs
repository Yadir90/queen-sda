#!/usr/bin/env node
/* Diagnóstico funcional de Ajustes (ronda 26-oct): perfil que
   persiste, PIN de acceso rápido y cierre de sesión completo. */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const OUT = path.join(REPO, 'audits/audit-2026-10-26/round2-ajustes')
fs.mkdirSync(OUT, { recursive: true })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-diag-ajustes-'))
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
await page.waitForSelector('#lg-email')
result.acceso = await page.evaluate(() => ({
  bienvenida: (document.body.textContent || '').includes('Bienvenido a Queen SDA el Sistema de Automatización de Datos del PDL La Reina V2.0'),
  linea: (document.body.textContent || '').includes('El negocio, día a día: IPV, gastos, cobrar, RH y Queen.'),
  reactor: (document.body.textContent || '').includes('Queen · Núcleo del reactor'),
  ultra: Boolean(document.querySelector('.system-ultralight-toggle')),
  logo: Boolean(document.querySelector('img.auth-logo')),
}))
await page.screenshot({ path: path.join(OUT, 'acceso-light-360.png') })
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

await page.evaluate(() => { [...document.querySelectorAll('.bottomnav button')].find((b) => b.textContent.includes('Más'))?.click() })
await page.waitForTimeout(600)
await page.evaluate(() => { [...document.querySelectorAll('.mas-card')].find((b) => b.textContent.includes('Ajustes'))?.click() })
await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('Perfil del administrador'), { timeout: 15000 })
await page.waitForTimeout(500)
result.estructura = await page.evaluate(() => {
  const main = document.querySelector('main')
  const t = main?.textContent || ''
  const logout = [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cerrar sesión')
  const lr = logout?.getBoundingClientRect()
  const ls = logout ? getComputedStyle(logout) : null
  return {
    perfil: t.includes('Perfil del administrador'),
    pin: t.includes('PIN de seguridad'),
    huella: t.includes('Huella o cara en este dispositivo'),
    informes: t.includes('Informes por correo'),
    ancla: t.includes('Fecha ancla de los ciclos de RH'),
    respaldo: t.includes('Respaldo completo'),
    borrar: t.includes('Borrar todos los datos'),
    entrarComo: t.includes('Entrar como otro usuario'),
    logoutVisible: Boolean(logout), logoutW: lr ? Math.round(lr.width) : 0,
    logoutColor: ls?.color, logoutBorder: ls?.borderColor,
  }
})
await page.screenshot({ path: path.join(OUT, 'ajustes-light-360.png') })
// Guardar perfil: cambiar el nombre visible y comprobar persistencia
await page.fill('#perfil-nombre', 'Yadir Medina (prueba)')
await page.click('button:has-text("Guardar perfil y acceso")')
await page.waitForTimeout(800)
result.guardarMsg = await page.evaluate(() => document.querySelector('.ajustes-profile-card .ok-box, .ajustes-profile-card [role="status"]')?.textContent?.trim() ?? null)
// PIN: configurar 2468 con la contraseña actual
await page.fill('#pin-nuevo', '2468')
await page.fill('#pin-confirmar', '2468')
await page.fill('#pin-clave', 'AuditoriaVisual1')
await page.click('button:has-text("Configurar PIN")')
await page.waitForTimeout(800)
result.pinTrasConfigurar = await page.evaluate(() => {
  const chip = document.querySelector('.ajustes-pin-actions .chip, .ajustes-subhead .chip')
  return chip?.textContent?.trim() ?? null
})
// Recargar: con acceso rápido activo la app pide desbloqueo
// (pantalla de bloqueo); se entra con el PIN recién configurado.
await page.reload()
await page.waitForSelector('#lock-pin', { timeout: 20000 })
result.bloqueoTrasRecarga = true
await page.fill('#lock-pin', '2468')
await page.click('button:has-text("Desbloquear con PIN")')
await page.waitForSelector('.app-shell', { timeout: 20000 })
await page.waitForTimeout(600)
await page.evaluate(() => { [...document.querySelectorAll('.bottomnav button')].find((b) => b.textContent.includes('Más'))?.click() })
await page.waitForTimeout(500)
await page.evaluate(() => { [...document.querySelectorAll('.mas-card')].find((b) => b.textContent.includes('Ajustes'))?.click() })
await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('Perfil del administrador'), { timeout: 15000 })
result.nombrePersistido = await page.evaluate(() => document.querySelector('#perfil-nombre')?.value ?? null)
result.pinChipTrasRecarga = await page.evaluate(() => document.querySelector('.ajustes-subhead .chip')?.textContent?.trim() ?? null)
// Cerrar sesión: debe volver a la pantalla de acceso y apagar el acceso rápido
await page.evaluate(() => window.scrollTo(0, 0))
await page.locator('main button', { hasText: 'Cerrar sesión' }).click()
await page.waitForTimeout(1200)
result.trasCerrar = await page.evaluate(() => {
  const quick = Object.keys(localStorage).filter((k) => /quick|pin/i.test(k)).map((k) => [k, (localStorage.getItem(k) || '').slice(0, 40)])
  return {
    hayShell: Boolean(document.querySelector('.app-shell')),
    hayAuth: Boolean(document.querySelector('#lg-email, .auth-card, [class*="account"]')),
    bodyInicio: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 160),
    quickKeys: quick,
    sessionKeys: Object.keys(localStorage).filter((k) => /session|queen-sda-session/i.test(k)),
  }
})
await page.screenshot({ path: path.join(OUT, 'tras-cerrar-sesion-light-360.png') })
fs.writeFileSync(path.join(OUT, 'diag-ajustes.json'), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
await browser.close()
server.close()
