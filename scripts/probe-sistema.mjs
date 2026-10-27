#!/usr/bin/env node
/* Sonda de la oleada SISTEMA-R6 (27-oct) — cierre exhaustivo de la
 * pestaña Sistema contra el original, en lo RENDERIZADO:
 * estructura de cabecera (TabHeader del shell + system-page-heading +
 * LiveClockCard siempre primera), barra de comandos del original,
 * las 16 tarjetas y su organizador, accesos directos (nav, sin
 * tarjeta), cintas del ADN (--helix-ribbon-a/b y --change por tema),
 * radar, animaciones DEMOSTRADAS en movimiento (dos instantes),
 * reloj en vivo que avanza, monitor y cierre con su estructura del
 * original, y desborde a 360 px — en claro Y oscuro, con la semilla
 * real del 26-oct importada por la vía real (Más → Importar).
 * Uso: node scripts/probe-sistema.mjs [--out audits/sistema-r6]
 * Sale 1 si alguna puerta (gate) falla. */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* Build LOCAL sin Supabase (mismo patrón que diag-sistema/probe-round2):
   el dist/ del repo es la build de producción (Supabase) y sin red el
   acceso cae; la sonda trabaja sobre una build local efímera. */
const BUILD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-sistema-probe-'))
execFileSync('npx', ['vite', 'build', '--outDir', BUILD_DIR, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const OUT = path.resolve(REPO, opt('--out', 'audits/sistema-r6'))
fs.mkdirSync(OUT, { recursive: true })
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const EMAIL = 'yadir.medina900710@gmail.com'
const PORT = 8919
const CHROME = process.env.CHROME_BIN || fs.globSync(`${os.homedir()}/.cache/ms-playwright/*/chrome-linux64/chrome`)[0]

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
note('seed', 'respaldo del 26-oct importado por Más → Importar')

const shot = (name) => page.screenshot({ path: path.join(OUT, name) })
const clipOf = async (locator, name) => { await locator.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await locator.screenshot({ path: path.join(OUT, name) }) }

const CARD_LABELS = ['Evolución de Queen', 'De un vistazo', 'Necesita tu atención hoy', 'El SDA como organismo', 'Queen y red neuronal', 'Diagnóstico general', 'ADN operativo', 'Sistema en tiempo real (gráficos)', 'Rutinas y subrutinas de Queen', 'Monitor del sistema', 'Cómo se integra la información', 'Accesos directos', 'Simulación de escenarios críticos', 'Banco de errores · Sistema inmune', 'Tareas y disciplina', 'Cierre técnico e inicio']

async function auditSistema(theme) {
  const T = theme === 'dark' ? 'oscuro' : 'claro'
  await page.emulateMedia({ colorScheme: theme })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await clickByText('Sistema', '.bottomnav button')
  await waitText('De un vistazo')
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400)
  await shot(`sistema-top-${T}.png`)

  /* — Cabecera: TabHeader del shell + heading propio + reloj — */
  {
    const m = await page.evaluate(() => ({
      tabH2: document.querySelector('.tab-header h2')?.textContent?.trim() ?? '',
      tabDesc: document.querySelector('.tab-header p')?.textContent?.trim() ?? '',
      chip: document.querySelector('.tab-header-chip')?.textContent?.trim() ?? '',
      heading: document.querySelector('.system-page-heading') ? { h2: document.querySelector('.system-page-heading h2')?.textContent?.trim(), p: document.querySelector('.system-page-heading p')?.textContent?.trim() } : null,
      clock: document.querySelector('section[aria-label="Fecha y hora actual"]') ? document.querySelector('section[aria-label="Fecha y hora actual"]').innerText.replace(/\n+/g, ' | ') : null,
    }))
    gate('SIS-CAB', `${T}: TabHeader «Sistema» + desc + chip «Núcleo de Queen»`, m.tabH2 === 'Sistema' && m.tabDesc === 'Si todo está bien y qué necesita tu atención hoy' && m.chip.includes('Núcleo de Queen'), JSON.stringify(m).slice(0, 200))
    gate('SIS-CAB', `${T}: system-page-heading con su texto del original`, m.heading?.h2 === 'Sistema' && m.heading?.p === 'Solo lo importante: si todo está bien y qué necesita tu atención hoy.', JSON.stringify(m.heading))
    gate('SIS-CAB', `${T}: LiveClockCard presente («Fecha y hora actual · en vivo», fecha larga y hora 12h)`, Boolean(m.clock) && /fecha y hora actual/i.test(m.clock ?? '') && /(am|pm)/i.test(m.clock ?? ''), (m.clock ?? 'AUSENTE').slice(0, 120))
    /* El reloj AVANZA: dos lecturas separadas deben diferir. */
    const t1 = await page.evaluate(() => document.querySelector('section[aria-label="Fecha y hora actual"]')?.innerText ?? '')
    await page.waitForTimeout(2300)
    const t2 = await page.evaluate(() => document.querySelector('section[aria-label="Fecha y hora actual"]')?.innerText ?? '')
    gate('SIS-CAB', `${T}: el reloj en vivo avanza entre dos instantes`, t1 !== '' && t2 !== '' && t1 !== t2, `"${t1.split('\n').pop()}" → "${t2.split('\n').pop()}"`)
  }

  /* — Barra de comandos del original — */
  {
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.system-command-bar')
      if (!bar) return { bar: false }
      const input = bar.querySelector('.system-search input')
      const ultra = bar.querySelector('.system-ultralight-toggle')
      const org = bar.querySelector('.system-organize-toggle')
      return {
        bar: true,
        placeholder: input?.getAttribute('placeholder') ?? '',
        ir: [...bar.querySelectorAll('.system-search button')].map((b) => b.textContent.trim()),
        ultraStrong: ultra?.querySelector('strong')?.textContent?.trim() ?? '',
        ultraSmall: ultra?.querySelector('small')?.textContent?.trim() ?? '',
        orgStrong: org?.querySelector('strong')?.textContent?.trim() ?? '',
        orgSmall: org?.querySelector('small')?.textContent?.trim() ?? '',
      }
    })
    gate('SIS-CMD', `${T}: barra de comandos del original (buscar + Ir + ultraligero + organizar)`, m.bar && m.placeholder === 'Buscar sección, respaldo o rutina' && m.ir.includes('Ir') && m.ultraStrong === 'Modo ultraligero' && m.ultraSmall === 'Se aplica a todo el sistema y queda activo hasta que lo desactives' && m.orgStrong === 'Organizar tarjetas' && m.orgSmall === 'Pon las tarjetas en el orden que quieras', JSON.stringify(m).slice(0, 260))
  }

  /* — Las 16 tarjetas presentes — */
  {
    const heads = await page.evaluate(() => [...document.querySelectorAll('.sistema-stack h3, .system-dna h3')].map((h) => h.textContent.trim()))
    const missing = CARD_LABELS.filter((l) => !heads.some((h) => h === l || h.includes(l)))
    /* «Accesos directos» en el original es nav con aria-label, sin h3;
       «De un vistazo» es kicker de panel premium, sin h3. */
    const navLabel = await page.evaluate(() => document.querySelector('.system-shortcuts')?.getAttribute('aria-label') ?? '')
    const kicker = await page.evaluate(() => document.querySelector('section[aria-label="¿Cómo está todo?"] .premium-kicker')?.textContent?.trim() ?? '')
    const missingReal = missing.filter((l) => !(l === 'Accesos directos' && navLabel === 'Accesos directos de Sistema') && !(l === 'De un vistazo' && kicker === 'De un vistazo'))
    gate('SIS-16', `${T}: las 16 tarjetas/secciones de Sistema presentes`, missingReal.length === 0, missingReal.length ? `faltan: ${missingReal.join(' · ')}` : `h3s=${heads.length}, nav=${navLabel}, kicker=${kicker}`)
    note('SIS-16', `${T}: encabezados h3 en Sistema`, heads.join(' | ').slice(0, 300))
  }

  /* — Vistazo/Atención: estructura del panel simple del original — */
  {
    const m = await page.evaluate(() => {
      const vis = document.querySelector('section[aria-label="¿Cómo está todo?"]')
      const att = document.querySelector('.sistema-attention-panel')
      return {
        visNoH3: vis ? vis.querySelectorAll('h3').length === 0 : false,
        visBtn: vis?.querySelector('.premium-actions .btn')?.textContent?.trim() ?? '',
        attTitle: att?.querySelector('.sistema-attention-title')?.textContent?.trim() ?? '',
        attInCard: att ? Boolean(att.closest('.card')) && att.tagName !== 'SECTION' ? true : Boolean(att.closest('.card')) : false,
      }
    })
    gate('SIS-VIS', `${T}: vistazo sin h3 (kicker) y atención como panel premium con su título`, m.visNoH3 && m.visBtn === '¿Por qué este número?' && m.attTitle === 'Necesita tu atención hoy', JSON.stringify(m))
    /* La explicación del número, literal del original. */
    await page.evaluate(() => { document.querySelector('section[aria-label="¿Cómo está todo?"] .premium-actions .btn')?.click() })
    await page.waitForTimeout(250)
    const why = await page.evaluate(() => document.querySelector('.why-panel p')?.textContent?.trim() ?? '')
    gate('SIS-VIS', `${T}: explicación «Este número resume todo en uno…» literal del original`, why.startsWith('Este número resume todo en uno: que los días cuadren'), why.slice(0, 90))
  }

  /* — Textos de andamiaje: ninguno visible en la pestaña — */
  {
    const found = await page.evaluate(() => {
      const text = document.body.innerText
      const banned = ['Calculada de esta copia', 'Automatizaciones del sistema externo', 'pendiente de despliegue', 'Copia exacta del sistema externo', 'Adaptación de arquitectura', 'Salud calculada con los puntos', 'vive solo aquí dentro', 'Reglas que este sistema no negocia', 'queenCore.', 'automatizacionesCore', 'En el sistema principal', 'Buscar tarjeta…', 'del clon', 'en el clon']
      return banned.filter((b) => text.includes(b)).map((b) => `${b} ⇐ …${text.slice(Math.max(0, text.indexOf(b) - 70), text.indexOf(b) + 40).replace(/\n/g, ' ')}…`)
    })
    gate('SIS-TEXT', `${T}: ningún texto visible de andamiaje/obra en Sistema`, found.length === 0, found.length ? `presentes: ${found.join(' · ')}` : 'limpio')
    const gastos = await page.evaluate(() => document.body.innerText.includes('275.505 CUP'))
    gate('SIS-TEXT', `${T}: flujo del organismo con Gastos = «275.505 CUP» (total de la semilla, como el original)`, gastos, gastos ? 'presente' : 'AUSENTE')
  }

  /* — Accesos directos: nav del original, 4 botones, sin tarjeta — */
  {
    const m = await page.evaluate(() => {
      const nav = document.querySelector('.system-shortcuts')
      if (!nav) return { nav: false }
      const card = nav.closest('.card')
      return {
        nav: true,
        inCard: Boolean(card),
        buttons: [...nav.querySelectorAll('button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')),
        accessGrid: Boolean(document.querySelector('.system-dna .access-grid')),
      }
    })
    const expected = ['Ver respaldo', 'Ejecutar diagnóstico', 'Simulación crítica', 'Ver notificaciones']
    gate('SIS-ACC', `${T}: accesos = nav (no tarjeta) con los 4 botones del original`, m.nav && !m.inCard && !m.accessGrid && JSON.stringify(m.buttons) === JSON.stringify(expected), JSON.stringify(m))
  }

  /* — ADN: cintas y --change computados por tema — */
  {
    const m = await page.evaluate(() => {
      const helix = document.querySelector('.system-dna-helix')
      if (!helix) return { helix: false }
      const cs = getComputedStyle(helix)
      const pathA = document.querySelector('.dna-helix-ribbon-a')
      /* --change se mide con un elemento sintético dentro de
         .system-area-dna: con la semilla sana no existe ninguna base
         crítica/modificada real en el DOM que medir. */
      const change = (cls) => {
        const host = document.querySelector('.system-area-dna')
        if (!host) return ''
        const probe = document.createElement('span')
        probe.className = `dna-helix-base ${cls}`
        host.appendChild(probe)
        const v = getComputedStyle(probe).getPropertyValue('--change').trim()
        probe.remove()
        return v
      }
      return {
        helix: true,
        a: cs.getPropertyValue('--helix-ribbon-a').trim(),
        b: cs.getPropertyValue('--helix-ribbon-b').trim(),
        strokeA: pathA ? getComputedStyle(pathA).stroke : '',
        added: change('is-added'), modified: change('is-modified'), critical: change('is-critical'),
      }
    })
    const exp = theme === 'dark'
      ? { a: '#5ed6aa', b: '#9ce5ca', added: '#55dda5', modified: '#f0c34b', critical: '#ff657c' }
      : { a: '#52b992', b: '#8bd1b8', added: '#177a57', modified: '#8b6200', critical: '#bc3049' }
    gate('SIS-ADN', `${T}: cintas --helix-ribbon-a/b = valores del original para este tema`, m.helix && m.a === exp.a && m.b === exp.b, JSON.stringify(m))
    gate('SIS-ADN', `${T}: --change (adición/modificación/crítica) = valores del original`, m.helix && m.added === exp.added && m.modified === exp.modified && m.critical === exp.critical, JSON.stringify({ added: m.added, modified: m.modified, critical: m.critical, exp }))
  }

  /* — Radar: el original NO lo monta en Sistema (QueenDiagnosticPanel
     es exportado sin uso en App.tsx). Paridad = ausencia aquí; la
     geometría del componente se verificó regla a regla en código. — */
  {
    const inSistema = await page.evaluate(() => document.querySelectorAll('.system-dna .queen-diagnostic-radar').length)
    gate('SIS-RADAR', `${T}: sin radar dentro de Sistema (el original no monta QueenDiagnosticPanel en esta pestaña)`, inSistema === 0, `radares=${inSistema}`)
  }

  /* — Medidor de salud: la cascada del original deja el halo tardío
     (premium-halo-spin 8s) SOBRE el borde/arco de theme.css:7232. — */
  {
    const m = await page.evaluate(() => {
      const g = document.querySelector('.system-health-gauge')
      if (!g) return { gauge: false }
      const after = getComputedStyle(g, '::after')
      return { gauge: true, anim: after.animationName, dur: after.animationDuration, borderTop: after.borderTopColor, borderW: after.borderTopWidth }
    })
    gate('SIS-GAUGE', `${T}: .system-health-gauge::after = halo premium-halo-spin + arco #35dfb0 de la regla 7232`, m.gauge && m.anim === 'premium-halo-spin' && m.borderTop === 'rgb(53, 223, 176)', JSON.stringify(m))
  }

  /* — Animaciones DEMOSTRADAS: dos instantes — */
  {
    const sample = () => page.evaluate(() => {
      const out = {}
      for (const el of document.querySelectorAll('.system-dna *')) {
        const cs = getComputedStyle(el)
        if (!cs.animationName || cs.animationName === 'none') continue
        const key = `${el.className.baseVal ?? el.className}::${cs.animationName}`
        const r = el.getBoundingClientRect()
        out[key] = `${cs.transform}|${cs.opacity}|${r.x.toFixed(1)},${r.y.toFixed(1)}`
      }
      return out
    })
    const a = await sample()
    await page.waitForTimeout(1300)
    const b = await sample()
    const moved = Object.keys(a).filter((k) => b[k] !== undefined && b[k] !== a[k])
    const still = Object.keys(a).filter((k) => b[k] !== undefined && b[k] === a[k])
    note('SIS-ANIM', `${T}: animaciones con movimiento demostrado (${moved.length})`, moved.slice(0, 10).join(' · '))
    note('SIS-ANIM', `${T}: animaciones declaradas sin cambio en 1,3 s (${still.length})`, still.slice(0, 10).join(' · '))
    gate('SIS-ANIM', `${T}: al menos 3 animaciones de Sistema se mueven de verdad`, moved.length >= 3, `movidas=${moved.length}`)
  }

  /* — Monitor con la estructura del original — */
  {
    const m = await page.evaluate(() => {
      const mon = document.querySelector('.system-monitor')
      if (!mon) return { mon: false }
      return {
        mon: true,
        kicker: mon.querySelector('.system-live-kicker')?.textContent?.trim() ?? '',
        metrics: [...mon.querySelectorAll('.system-metric-grid article')].length,
        metricLabels: [...mon.querySelectorAll('.system-metric-grid article header span')].map((s) => s.textContent.trim()),
        services: [...mon.querySelectorAll('.system-service-grid strong')].map((s) => s.textContent.trim()),
        sections: [...mon.querySelectorAll('.system-monitor-sections summary span')].map((s) => s.textContent.trim()),
        pill: mon.querySelector('.system-connection-pill')?.textContent?.trim() ?? '',
      }
    })
    gate('SIS-MON', `${T}: Monitor = medidor + píldora + 3 métricas + servicios + 5 secciones del original`, m.mon && m.metrics === 3 && JSON.stringify(m.services) === JSON.stringify(['Red', 'Drive', 'Gmail']) && m.sections.length === 5, JSON.stringify(m).slice(0, 280))
    if (m.mon) await clipOf(page.locator('.system-monitor'), `sistema-monitor-${T}.png`)
  }

  /* — Cierre: consola nocturna técnica + línea de inicio — */
  {
    const m = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('h3, h4')].map((h) => h.textContent.trim())
      const nc = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent ?? '').includes('Consola nocturna de cierre · cierre técnico'))
      const steps = [...document.querySelectorAll('.hm-nc-step strong')].map((s) => s.textContent.trim())
      return { nc: Boolean(nc), steps, hasStartup: titles.some((t) => t.includes('Línea de tiempo de inicio')) }
    })
    gate('SIS-CIERRE', `${T}: cierre = Consola nocturna «cierre técnico» con sus 7 pasos + línea de tiempo de inicio`, m.nc && m.steps.length === 7 && m.hasStartup, JSON.stringify(m).slice(0, 300))
  }

  /* — Evolución: sync «En vivo · 20–30 s» — */
  {
    const m = await page.evaluate(() => document.querySelector('.system-evolution-sync')?.textContent?.trim() ?? '')
    gate('SIS-EVO', `${T}: cabecera de Evolución con «En vivo · 20–30 s»`, m === 'En vivo · 20–30 s', m || 'AUSENTE')
  }

  /* — Desborde horizontal — */
  {
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    gate('SIS-OVER', `${T}: sin desborde horizontal a 360 px`, w <= 361, `scrollWidth=${w}`)
  }

  /* — Organizador (solo una vez, en el tema actual) — */
  if (theme === 'dark') {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300)
    const opened = await page.evaluate(() => {
      const b = document.querySelector('.system-organize-toggle')
      if (!b) return false
      b.scrollIntoView({ block: 'center' }); b.click(); return true
    })
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const org = document.querySelector('.system-card-organizer')
      if (!org) return { org: false }
      const rows = [...org.querySelectorAll('.system-card-organizer-row')]
      return {
        org: true,
        headP: org.querySelector('.system-card-organizer-head p')?.textContent?.trim() ?? '',
        rows: rows.length,
        btnsFirst: rows[0] ? [...rows[0].querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
        posFirst: rows[0]?.querySelector('.system-card-organizer-pos')?.textContent?.trim() ?? '',
        reset: org.querySelector('.system-card-organizer-reset')?.textContent?.trim() ?? '',
      }
    })
    gate('SIS-ORG', 'organizador del original: 16 filas numeradas, 4 botones por fila y restablecer', m.org && m.rows === 16 && JSON.stringify(m.btnsFirst) === JSON.stringify(['Al principio', 'Subir', 'Bajar', 'Al final']) && m.posFirst === '1' && m.reset === 'Restablecer el orden original', JSON.stringify(m).slice(0, 280))
    if (m.org) await clipOf(page.locator('.system-card-organizer'), 'sistema-organizador-oscuro.png')
    await page.evaluate(() => { document.querySelector('.system-card-organizer-done')?.click() })
    await page.waitForTimeout(300)
  }
}

await auditSistema('dark')
await auditSistema('light')

fs.writeFileSync(path.join(OUT, 'mediciones.json'), JSON.stringify(results, null, 2))
await browser.close()
server.close()
const fails = results.filter((r) => r.ok === false)
console.log(fails.length === 0 ? '\nSONDA SISTEMA: TODAS LAS PUERTAS EN VERDE' : `\nSONDA SISTEMA: ${fails.length} PUERTAS FALLARON`)
process.exit(fails.length ? 1 : 0)
