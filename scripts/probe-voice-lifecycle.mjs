#!/usr/bin/env node
/* Reproducción instrumentada del ciclo de vida de la voz de Queen.
 * Registra CADA llamada y evento del reconocimiento (con pila de
 * llamada en abort/stop) y de la síntesis, en el build de producción
 * local de la app. Escenarios:
 *  A: fake sano (onstart → interim → final) — ¿la app aborta sola?
 *  B: fake que dispara onerror('aborted') sin que la app llame abort
 *  C: implementación real de Chromium, sin fake
 *  D: TTS independiente: reconocimiento falla ('aborted') y aun así
 *     una respuesta de texto de Queen debe leerse en voz alta. */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const REPO = '/home/hatch/workspace/queen-sda-app'
const EMAIL = 'yadir.medina900710@gmail.com'
const TEMP = 'Admin1'
const NEWPASS = 'AuditoriaVisual1'

function findChromium() {
  const cands = []
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
    cands.push(path.join(cache, d, 'chrome-linux64/chrome'), path.join(cache, d, 'chrome-linux/chrome'))
  }
  cands.push('/usr/bin/chromium', '/usr/bin/google-chrome')
  return cands.find((c) => fs.existsSync(c)) || null
}
function buildLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-voice-build-'))
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
}
async function goQueen(page) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sidenav .nav-btn, .bottomnav button')]
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes('Queen'))
    if (b) b.click()
  })
  await page.waitForTimeout(900)
}

const INSTRUMENT = (mode) => {
  window.__vlog = []
  const log = (ev, extra) => window.__vlog.push({ t: Math.round(performance.now()), ev, ...(extra || {}) })
  window.__vlogPush = log
  class FakeRec {
    constructor() {
      this.id = (window.__recCount = (window.__recCount || 0) + 1)
      this.lang = ''; this.continuous = false; this.interimResults = false
      this.onresult = null; this.onerror = null; this.onend = null; this.onstart = null
      log('construct', { id: this.id })
    }
    start() {
      log('start()', { id: this.id, lang: this.lang, stack: new Error().stack.split('\n').slice(2, 5).join(' | ') })
      setTimeout(() => {
        if (mode === 'healthy') {
          log('onstart→', { id: this.id }); this.onstart && this.onstart()
          const mk = (t, fin) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: fin, length: 1, 0: { transcript: t, confidence: 0.9 } } } })
          setTimeout(() => { log('onresult interim→', { id: this.id }); this.onresult && this.onresult(mk('cuanto se vendio hoy', false)) }, 120)
          setTimeout(() => { log('onresult final→', { id: this.id }); this.onresult && this.onresult(mk('cuanto se vendio hoy', true)); log('onend→', { id: this.id }); this.onend && this.onend() }, 320)
        } else if (mode === 'aborted') {
          log('onerror aborted→ (plataforma, sin abort de la app)', { id: this.id })
          this.onerror && this.onerror({ error: 'aborted', message: '' })
          log('onend→', { id: this.id }); this.onend && this.onend()
        }
      }, 40)
    }
    stop() { log('stop() LLAMADO POR LA APP', { id: this.id, stack: new Error().stack.split('\n').slice(2, 6).join(' | ') }); setTimeout(() => { this.onend && this.onend() }, 10) }
    abort() { log('abort() LLAMADO POR LA APP', { id: this.id, stack: new Error().stack.split('\n').slice(2, 6).join(' | ') }); setTimeout(() => { this.onend && this.onend() }, 10) }
  }
  window.webkitSpeechRecognition = FakeRec
  window.SpeechRecognition = FakeRec
  // Síntesis instrumentada: registra speak/cancel y completa la lectura.
  const synth = window.speechSynthesis
  if (synth) {
    const origSpeak = synth.speak.bind(synth)
    synth.speak = (u) => {
      log('synth.speak()', { text: (u.text || '').slice(0, 60), lang: u.lang, voice: u.voice ? u.voice.name : null })
      setTimeout(() => { log('utterance.onstart→'); u.onstart && u.onstart(new Event('start')) }, 30)
      setTimeout(() => { log('utterance.onend→'); u.onend && u.onend(new Event('end')) }, 130)
      return origSpeak(u)
    }
    const origCancel = synth.cancel.bind(synth)
    synth.cancel = () => { log('synth.cancel()'); return origCancel() }
  }
}

const buildDir = buildLocal()
const server = await serve(buildDir)
const base = `http://127.0.0.1:${server.address().port}/`
const exe = findChromium()
if (!exe) { console.error('Sin Chromium'); process.exit(2) }
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const R = {}

async function scenario(name, mode, actions) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: 'light', permissions: ['microphone'] })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  if (mode) await page.addInitScript(INSTRUMENT, mode)
  await page.goto(base)
  await seed(page)
  await goQueen(page)
  const out = await actions(page)
  const vlog = mode ? await page.evaluate(() => window.__vlog || []) : undefined
  const status = await page.evaluate(() => document.querySelector('.queen-voice-status')?.innerText?.replace(/\s+/g, ' ').trim() ?? null)
  R[name] = { ...out, vlog, statusFinal: status, pageErrors: errs }
  await ctx.close()
}

// A: fake sano — ciclo completo montar → tocar micrófono → start
await scenario('A-saludable', 'healthy', async (page) => {
  const hasMic = await page.evaluate(() => !!document.querySelector('.queen-mic-btn'))
  await page.click('.queen-mic-btn')
  await page.waitForTimeout(1200)
  const msgs = await page.evaluate(() => [...document.querySelectorAll('.queen-msg, [class*="msg"]')].length)
  return { hasMic, msgs }
})
// B: la plataforma aborta sola tras arrancar
await scenario('B-aborted-plataforma', 'aborted', async (page) => {
  await page.click('.queen-mic-btn')
  await page.waitForTimeout(700)
  return {}
})
// C: implementación real de Chromium (sin fake)
await scenario('C-real-chromium', null, async (page) => {
  const supported = await page.evaluate(() => ({ sr: !!(window.SpeechRecognition || window.webkitSpeechRecognition), synth: 'speechSynthesis' in window, voices: window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1 }))
  const hasMic = await page.evaluate(() => !!document.querySelector('.queen-mic-btn'))
  if (hasMic) { await page.click('.queen-mic-btn'); await page.waitForTimeout(1500) }
  return { supported, hasMic }
})
// D: TTS independiente del reconocimiento
await scenario('D-tts-independiente', 'aborted', async (page) => {
  // Activar «Voz de Queen» (chip TTS)
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('button')]
    const chip = chips.find((b) => (b.textContent || '').includes('Voz de Queen'))
    if (chip && (chip.textContent || '').includes('silenciada')) chip.click()
  })
  await page.waitForTimeout(300)
  // El micrófono falla (aborted)
  await page.click('.queen-mic-btn')
  await page.waitForTimeout(600)
  // Enviar un mensaje de texto y esperar la respuesta de Queen
  const input = page.locator('.queen-composer textarea, .queen-composer input[type="text"]').first()
  await input.fill('hola')
  await input.press('Enter')
  await page.waitForTimeout(2500)
  return {}
})

console.log(JSON.stringify(R, null, 1))
await browser.close()
server.close()
