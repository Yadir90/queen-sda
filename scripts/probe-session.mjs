// Sonda del defecto de sesión (dueño, 26-oct 19:09): con sesión guardada
// y acceso rápido activado, recargar la app NO debe interponer la
// pantalla de bloqueo ni pedir reingreso: la sesión se mantiene hasta
// que el dueño la cierre. Uso: node scripts/probe-session.mjs <baseUrl>
import { chromium } from 'playwright-core'
const base = process.argv[2] || 'http://127.0.0.1:8907/'
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 360, height: 740 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(base, { waitUntil: 'networkidle' })
// Semilla: sesión local guardada + acceso rápido activado para ese perfil.
await page.evaluate(() => {
  localStorage.setItem('queen-sda:v1:session', JSON.stringify({ profileId: 'yadir', name: 'Yadir Medina Oliva', email: 'yadir.medina900710@gmail.com', role: 'admin' }))
  localStorage.setItem('queen-sda:quick-access-v1', JSON.stringify({ yadir: { pinSalt: null, pinHash: null, pinEnabled: true, biometricEnabled: false, failures: 0 } }))
  // La contraseña temporal ya fue cambiada (no es parte de este defecto).
  const profiles = JSON.parse(localStorage.getItem('queen-sda:v1:profiles') || '[]')
  localStorage.setItem('queen-sda:v1:profiles', JSON.stringify(profiles.map((p) => ({ ...p, mustChange: false }))))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const probe = await page.evaluate(() => ({ text: document.body.innerText, nav: !!document.querySelector('nav, aside') }))
const lockShown = probe.text.includes('Tu sesión sigue guardada')
console.log(JSON.stringify({ lockShown, hasNav: probe.nav, textStart: probe.text.slice(0, 120) }, null, 1))
console.log('RESULT lockShown=' + lockShown)
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
// Fase 2: «Cerrar sesión» es la única salida y vacía el acceso rápido.
let logoutOk = null
if (!lockShown && probe.nav) {
  page.on('dialog', (d) => void d.accept())
  // A 360 la barra lateral va recogida: se dispara el mismo botón por DOM.
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Cerrar sesión')
    if (b) { b.click(); return true }
    return false
  })
  if (clicked) {
    await page.waitForTimeout(900)
    const after = await page.evaluate(() => ({
      session: localStorage.getItem('queen-sda:v1:session'),
      quick: localStorage.getItem('queen-sda:quick-access-v1'),
      text: document.body.innerText.slice(0, 80),
    }))
    logoutOk = after.session === null && !(after.quick ?? '').includes('yadir')
    console.log('LOGOUT sessionGone=' + (after.session === null) + ' quickGone=' + logoutOk + ' backAtLogin=' + after.text.includes('Bienvenido'))
  }
}
console.log('pageerrors=' + errs.length)
const pass = !lockShown && probe.nav && logoutOk === true && errs.length === 0
console.log(pass ? 'SESSION-PROBE OK' : 'SESSION-PROBE FAIL')
await browser.close()
process.exit(pass ? 0 : 1)
