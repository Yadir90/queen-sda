#!/usr/bin/env node
/* Sonda D-R2-10 (26-oct): el asistente de contratación en 6 pasos de
 * la ficha de RH con datos en FORMA DE PRODUCCIÓN: la app se construye
 * en modo Supabase contra un servidor falso local que responde Auth +
 * REST con fixtures convertidos del respaldo real (trabajadores como
 * filas de la tabla workers con payload; app_settings
 * 'workers-extended' con las filas CRUDAS snake_case y SIN claves
 * hiring_form/work_contract, como están hoy en producción). Se abre
 * RH, se entra a la ficha, se recorren los 6 pasos, se escribe, se
 * guarda (el servidor captura el upsert y se comprueba el
 * hiring_form), se recarga y se verifica que lo guardado persiste.
 * Si la vía simulada no levanta la sesión, cae a la sonda en modo
 * local con el mismo respaldo (cuyos extendidos tampoco traen los
 * campos) y lo declara en el resultado.
 * Uso: node scripts/diag-d7.mjs --out <dir> */
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
const OUT = path.resolve(REPO, opt('--out', 'audits/audit-2026-10-26/round3-d7'))
fs.mkdirSync(OUT, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const SB_PORT = 8799
const SB_URL = `http://127.0.0.1:${SB_PORT}`
const ADMIN_ID = 'e30de24f-61df-4cea-8dac-b219f68f0415'
const ADMIN_EMAIL = 'yadir.medina900710@gmail.com'

/* ---------- Fixtures desde el respaldo real ---------- */
const backupJson = JSON.parse(fs.readFileSync(BACKUP, 'utf8'))
const stored = backupJson.data ?? backupJson
const fxWorkers = Array.isArray(stored.workers) ? stored.workers : []
const fxDays = Array.isArray(stored.days) ? stored.days : []
const fxPayroll = Array.isArray(stored.payrollHistory) ? stored.payrollHistory : []
const fxExtended = Array.isArray(stored.workersExtended) ? stored.workersExtended : []

/* El extendido CRUDO tal como vive en app_settings de producción:
 * snake_case y, clave del defecto, SIN hiring_form/work_contract. */
function extendedToRawFixture(e) {
  return {
    worker_key: e.workerKey, nombre: e.nombre, ocupacion: e.ocupacion,
    rest_weekday: e.restWeekday ?? null, work_weekday: e.workWeekday ?? null,
    work_weekdays: e.workWeekdays ?? [], turno_asignado: e.turnoAsignado ?? null,
    turno_correccion: e.turnoCorreccion ?? null, estrellas: e.estrellas ?? 0,
    genero: e.genero ?? '', escolaridad: e.escolaridad ?? '',
    contrato_cancelado_el: e.contratoCanceladoEl ?? null,
    contrato_cancelado_ciclo: e.contratoCanceladoCiclo ?? null,
    ausencias: e.ausencias ?? [], fecha_contratacion: e.fechaContratacion || null,
  }
}
const settingsState = new Map()
settingsState.set('core', {})
settingsState.set('workers-extended', { workers: fxExtended.map(extendedToRawFixture) })
const capturedUpserts = []

const workerRows = fxWorkers.map((w) => ({
  key: w.key, nombre: w.nombre, ocupacion: w.ocupacion ?? '', carnet: w.carnet ?? '',
  cuenta_bancaria: w.cuentaBancaria ?? '', movil: w.movil ?? '', notas: w.notas ?? '',
  origen: w.origen ?? 'ipv', role_kind: w.roleKind === 'direccion' ? 'direccion' : 'trabajador',
  payload: w,
}))
const dayRows = fxDays.map((d) => ({
  date: d.date, ventas_dia: d.ventasDia ?? null, ganancia_bruta: d.gananciaBruta ?? null,
  ganancia_neta: d.gananciaNeta ?? null, cuadre: d.cuadre ?? null, payload: d, imported_at: null,
}))
const payrollRows = fxPayroll.map((p) => ({
  cycle_start: p.cycleStart, cycle_end: p.cycleEnd, pay_date: p.payDate, total: p.total ?? 0, payload: p,
}))
const targetWorker = fxWorkers.find((w) => w.roleKind !== 'direccion') ?? fxWorkers[0]

const authUser = {
  id: ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: ADMIN_EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
}
const authSession = {
  access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'fake-refresh-token', user: authUser,
}

/* ---------- Servidor: estáticos + Supabase falso ---------- */
function findChromium() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const cands = []
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
    cands.push(path.join(cache, d, 'chrome-linux64/chrome'), path.join(cache, d, 'chrome-linux/chrome'))
  }
  cands.push('/usr/bin/chromium', '/usr/bin/google-chrome')
  return cands.find((c) => fs.existsSync(c)) || null
}
function buildWithEnv(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-d7-build-'))
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, ...env }, stdio: 'pipe' })
  return dir
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}
function settingsRowsFor(url) {
  const keyParam = url.searchParams.get('key') ?? ''
  let keys = null
  if (keyParam.startsWith('in.(')) keys = keyParam.slice(4, -1).split(',').map((s) => s.trim())
  else if (keyParam.startsWith('eq.')) keys = [keyParam.slice(3)]
  const rows = []
  for (const [k, v] of settingsState) {
    if (keys && !keys.includes(k)) continue
    rows.push(url.pathname.endsWith('app_settings') && url.searchParams.get('select') === 'value' ? { value: v } : { key: k, value: v })
  }
  return rows
}
function serveAll(staticDir) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)) }
    if (p.startsWith('/auth/v1/')) {
      if (p === '/auth/v1/token') { await readBody(req); return json(200, authSession) }
      if (p === '/auth/v1/user') return json(200, authUser)
      if (p === '/auth/v1/logout') { await readBody(req); res.writeHead(204); return res.end() }
      return json(200, {})
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length)
      const wantsObject = (req.headers.accept || '').includes('vnd.pgrst.object')
      if (req.method === 'GET') {
        let rows = []
        if (table === 'profiles') rows = [{ display_name: 'Yadir Medina Oliva', email: ADMIN_EMAIL, must_change_password: false }]
        else if (table === 'user_roles') rows = [{ role: 'admin' }]
        else if (table === 'app_settings') rows = settingsRowsFor(url)
        else if (table === 'workers') rows = workerRows
        else if (table === 'days') rows = dayRows
        else if (table === 'payroll_history') rows = payrollRows
        else rows = []
        if (wantsObject) {
          if (!rows.length) { res.writeHead(406, { 'Content-Type': 'application/json' }); return res.end('{}') }
          return json(200, rows[0])
        }
        return json(200, rows)
      }
      const body = await readBody(req)
      if (table === 'app_settings' && body) {
        try {
          const parsed = JSON.parse(body)
          const items = Array.isArray(parsed) ? parsed : [parsed]
          for (const item of items) {
            if (item && typeof item.key === 'string') {
              settingsState.set(item.key, item.value)
              capturedUpserts.push({ key: item.key, value: item.value })
            }
          }
        } catch { /* cuerpo no JSON: se ignora */ }
        res.writeHead(201); return res.end()
      }
      res.writeHead(201, { 'Content-Type': 'application/json' }); return res.end('{}')
    }
    if (p.startsWith('/storage/v1/')) return json(200, [])
    let file = path.join(staticDir, decodeURIComponent(p))
    if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((r) => server.listen(SB_PORT, '127.0.0.1', () => r(server)))
}

/* ---------- Navegación compartida ---------- */
async function clickByLabel(page, label) {
  return page.evaluate((lbl) => {
    const btns = [...document.querySelectorAll('.sidenav .nav-btn, .bottomnav button, .mas-card, .quick-action')]
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes(lbl))
    if (b) { b.click(); return true }
    return false
  }, label)
}
async function goRH(page) {
  let ok = await clickByLabel(page, 'RH')
  if (!ok) { await clickByLabel(page, 'Más'); await page.waitForTimeout(500); ok = await clickByLabel(page, 'RH') }
  await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('Registro de trabajadores'), { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  return ok
}
async function openFicha(page, nombre) {
  return page.evaluate((name) => {
    const cards = [...document.querySelectorAll('article[id^="worker-card-"]')]
    const card = cards.find((c) => (c.getAttribute('aria-label') || '').includes(name))
    if (!card) return 'sin tarjeta'
    const b = [...card.querySelectorAll('button')].find((x) => /ficha/i.test(x.getAttribute('aria-label') || '') || /ficha/i.test(x.textContent))
    if (!b) return 'sin botón de ficha'
    b.scrollIntoView({ block: 'center' }); b.click()
    return 'ok'
  }, nombre)
}

async function runWizardAssertions(page, R, tag) {
  await page.waitForSelector('.wf-hire', { timeout: 15000 })
  R[tag].wizardPresent = await page.evaluate(() => {
    const s = document.querySelector('.wf-hire')
    return Boolean(s) && (s.textContent || '').includes('Contratación y contrato de trabajo')
  })
  R[tag].steps = await page.evaluate(() => [...document.querySelectorAll('.wf-hire-step')].map((b) => b.textContent.trim()))
  const hire = page.locator('.wf-hire')
  await hire.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `d7-wizard-step1-${tag}-360.png`) })
  // Paso 1: escribir calle y número
  await page.fill('.wf-hire input[id$="-calle"]', 'Calle 10')
  await page.fill('.wf-hire input[id$="-numero"]', '5')
  R[tag].calleValue = await page.evaluate(() => document.querySelector('.wf-hire input[id$="-calle"]')?.value ?? null)
  // Paso 2
  await page.click('.wf-hire-step:nth-child(2)')
  await page.waitForTimeout(300)
  await page.fill('.wf-hire textarea[id$="-enfermedad"]', 'No')
  await page.fill('.wf-hire input[id$="-correo"]', 'prueba@correo.cu')
  await page.screenshot({ path: path.join(OUT, `d7-wizard-step2-${tag}-360.png`) })
  // Paso 3: salario y borrador de currículum automático
  await page.click('.wf-hire-step:nth-child(3)')
  await page.waitForTimeout(400)
  await page.fill('.wf-hire input[id$="-salario"]', '6500')
  R[tag].curriculumLen = await page.evaluate(() => (document.querySelector('.wf-hire textarea[id$="-curriculum"]')?.value ?? '').length)
  R[tag].horasBox = await page.evaluate(() => document.querySelector('.wf-hire-box')?.textContent?.replace(/\s+/g, ' ').slice(0, 120) ?? null)
  // Paso 4: modalidad
  await page.click('.wf-hire-step:nth-child(4)')
  await page.waitForTimeout(300)
  await page.selectOption('.wf-hire select[id$="-tipo"]', 'indeterminado')
  // Paso 5: condiciones
  await page.click('.wf-hire-step:nth-child(5)')
  await page.waitForTimeout(300)
  R[tag].step5Text = await page.evaluate(() => document.querySelector('.wf-hire')?.textContent?.replace(/\s+/g, ' ').slice(0, 220) ?? null)
  // Paso 6: firmas
  await page.click('.wf-hire-step:nth-child(6)')
  await page.waitForTimeout(300)
  R[tag].step6 = await page.evaluate(() => {
    const t = document.querySelector('.wf-hire')?.textContent || ''
    return {
      fechaFirma: Boolean(document.querySelector('.wf-hire input[id$="-firma-fecha"]')),
      faltaAdmin: t.includes('Falta la firma autorizada del Administrador.'),
      faltaDirector: t.includes('Falta la firma autorizada del Director.'),
      padFirma: Boolean(document.querySelector('.wf-hire canvas.wf-signature-canvas')),
      guardar: [...document.querySelectorAll('.wf-hire button')].some((b) => b.textContent.includes('Guardar documento')),
    }
  })
  await page.screenshot({ path: path.join(OUT, `d7-wizard-step6-${tag}-360.png`) })
}

/* ---------- Vía A: Supabase simulado (forma de producción) ---------- */
const R = { mode: null, sb: {}, local: {}, errors: [], realtimeNoise: [] }
const sbBuild = buildWithEnv({ VITE_SUPABASE_URL: SB_URL, VITE_SUPABASE_ANON_KEY: 'fake-anon-key' })
const server = await serveAll(sbBuild)
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

async function sbContext(colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme, serviceWorkers: 'block' })
  await ctx.addInitScript((session) => {
    try { localStorage.setItem('sb-127-auth-token', JSON.stringify(session)) } catch { /* sin almacenamiento */ }
  }, authSession)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => R.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/websocket|realtime/i.test(t)) R.realtimeNoise.push(t.slice(0, 160))
    else R.errors.push(`console: ${t.slice(0, 300)}`)
  })
  return { ctx, page }
}

let sbOk = false
try {
  const { ctx, page } = await sbContext('light')
  await page.goto(`${SB_URL}/`)
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  R.sb.shell = true
  await goRH(page)
  R.sb.openFicha = await openFicha(page, targetWorker.nombre)
  await page.waitForTimeout(900)
  await runWizardAssertions(page, R, 'sb')
  // Guardar: el servidor falso captura el upsert de workers-extended
  const before = capturedUpserts.length
  await page.click('.wf-hire button:has-text("Guardar documento")')
  let saved = null
  for (let i = 0; i < 24 && !saved; i++) {
    await page.waitForTimeout(500)
    for (const u of capturedUpserts.slice(before)) {
      if (u.key !== 'workers-extended') continue
      const w = (u.value?.workers ?? []).find((x) => x.hiring_form)
      if (w) saved = w
    }
  }
  R.sb.savedToServer = saved ? {
    calle: saved.hiring_form.calle, numero: saved.hiring_form.numero,
    enfermedad: saved.hiring_form.enfermedad, salario: saved.hiring_form.salario,
    curriculumLen: (saved.hiring_form.curriculum || '').length,
    tipoContrato: saved.work_contract?.tipoContrato, lugarTrabajo: saved.work_contract?.lugarTrabajo,
  } : null
  R.sb.msgGuardado = await page.evaluate(() => (document.querySelector('main')?.textContent || '').includes('Documento de contratación guardado completo.'))
  // Recargar: la sesión y los datos vuelven del servidor falso
  await page.reload()
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await goRH(page)
  R.sb.openFichaTrasRecarga = await openFicha(page, targetWorker.nombre)
  await page.waitForTimeout(900)
  await page.waitForSelector('.wf-hire', { timeout: 15000 })
  R.sb.persistedCalle = await page.evaluate(() => document.querySelector('.wf-hire input[id$="-calle"]')?.value ?? null)
  R.sb.persistedSteps = await page.evaluate(() => document.querySelectorAll('.wf-hire-step').length)
  await ctx.close()
  // Tema oscuro: sesión nueva, mismo servidor
  const dark = await sbContext('dark')
  await dark.page.goto(`${SB_URL}/`)
  await dark.page.waitForSelector('.app-shell', { timeout: 30000 })
  await goRH(dark.page)
  await openFicha(dark.page, targetWorker.nombre)
  await dark.page.waitForTimeout(900)
  await dark.page.waitForSelector('.wf-hire', { timeout: 15000 })
  const hireEl = dark.page.locator('.wf-hire')
  await hireEl.scrollIntoViewIfNeeded().catch(() => {})
  await dark.page.waitForTimeout(300)
  R.sb.darkWizard = await dark.page.evaluate(() => {
    const s = document.querySelector('.wf-hire')
    const step = document.querySelector('.wf-hire-step.is-on')
    return { present: Boolean(s), stepBg: step ? getComputedStyle(step).backgroundColor : null, calle: document.querySelector('.wf-hire input[id$="-calle"]')?.value ?? null }
  })
  await dark.page.screenshot({ path: path.join(OUT, 'd7-wizard-step1-dark-sb-360.png') })
  await dark.ctx.close()
  sbOk = Boolean(R.sb.wizardPresent && R.sb.savedToServer && R.sb.persistedCalle === 'Calle 10')
  R.mode = 'supabase-simulado'
} catch (err) {
  R.sb.error = String(err && err.message ? err.message : err).slice(0, 300)
}

/* ---------- Vía B (solo si la A falla): modo local, mismo respaldo ---------- */
if (!sbOk) {
  try {
    const localBuild = buildWithEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })
    const localServer = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x')
        let file = path.join(localBuild, decodeURIComponent(url.pathname))
        if (!file.startsWith(localBuild) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(localBuild, 'index.html')
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        fs.createReadStream(file).pipe(res)
      })
      s.listen(0, '127.0.0.1', () => resolve(s))
    })
    const base = `http://127.0.0.1:${localServer.address().port}/`
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'light', serviceWorkers: 'block' })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => R.errors.push(`local pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') R.errors.push(`local console: ${m.text().slice(0, 300)}`) })
    await page.goto(base)
    await page.waitForSelector('#lg-email', { timeout: 20000 })
    await page.fill('#lg-email', ADMIN_EMAIL)
    await page.fill('#lg-pass', 'Admin1')
    await page.click('.auth-card button[type="submit"]')
    await page.waitForSelector('#cp-new', { timeout: 10000 })
    await page.fill('#cp-temp', 'Admin1')
    await page.fill('#cp-new', 'AuditoriaVisual1')
    await page.fill('#cp-rep', 'AuditoriaVisual1')
    await page.click('.auth-card button[type="submit"]')
    await page.waitForSelector('.app-shell', { timeout: 10000 })
    await clickByLabel(page, 'Sistema')
    await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').includes('De un vistazo'), { timeout: 25000 })
    const input = page.locator('main input[type="file"][accept*="json"]').first()
    await input.setInputFiles(BACKUP)
    await page.waitForSelector('text=Verificación del archivo', { timeout: 20000 })
    await page.click('button:has-text("Confirmar importación")')
    await page.locator('.ok-box', { hasText: 'Respaldo importado' }).first().waitFor({ timeout: 60000 })
    await goRH(page)
    R.local.openFicha = await openFicha(page, targetWorker.nombre)
    await page.waitForTimeout(900)
    await runWizardAssertions(page, R, 'local')
    await page.click('.wf-hire button:has-text("Guardar documento")')
    await page.waitForTimeout(1500)
    R.local.msgGuardado = await page.evaluate(() => (document.querySelector('main')?.textContent || '').includes('Documento de contratación guardado completo.'))
    await page.reload()
    await page.waitForSelector('.app-shell', { timeout: 20000 })
    await goRH(page)
    await openFicha(page, targetWorker.nombre)
    await page.waitForTimeout(900)
    await page.waitForSelector('.wf-hire', { timeout: 15000 })
    R.local.persistedCalle = await page.evaluate(() => document.querySelector('.wf-hire input[id$="-calle"]')?.value ?? null)
    await ctx.close()
    localServer.close()
    R.mode = R.mode ? `${R.mode}+local-respaldo` : 'local-respaldo'
  } catch (err) {
    R.local.error = String(err && err.message ? err.message : err).slice(0, 300)
  }
}

R.targetWorker = targetWorker.nombre
R.errorsTotal = R.errors.length
fs.writeFileSync(path.join(OUT, 'diag-d7.json'), JSON.stringify(R, null, 1))
console.log(JSON.stringify(R, null, 1))
await browser.close()
server.close()
