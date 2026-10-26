#!/usr/bin/env node
/* Micro-diagnóstico: cadena de desborde en Cobrar (account-group). */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP = path.join(os.homedir(), 'workspace/goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queen-diag-cobrar-'))
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
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage()
await page.goto(base)
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
await page.evaluate(() => { [...document.querySelectorAll('.bottomnav button, .sidenav .nav-btn')].find((b) => b.textContent.includes('Cobrar'))?.click() })
await page.waitForTimeout(1500)
const out = await page.evaluate(() => {
  const describe = (el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').join('.') : ''),
      sw: el.scrollWidth, w: Math.round(r.width), right: Math.round(r.right),
      display: s.display, minWidth: s.minWidth, whiteSpace: s.whiteSpace, flexWrap: s.flexWrap,
      gridCols: s.gridTemplateColumns, overflowX: s.overflowX,
      text: (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) : ''),
    }
  }
  const group = document.querySelector('.account-group')
  if (!group) return { error: 'sin account-group', main: (document.querySelector('main')?.textContent || '').slice(0, 120) }
  const chain = [describe(group)]
  let el = group
  for (let i = 0; i < 10; i++) {
    const kids = [...el.children].map((k) => ({ k, sw: k.scrollWidth, right: k.getBoundingClientRect().right }))
      .sort((a, b) => b.sw - a.sw)
    const worst = kids[0]
    if (!worst || worst.sw <= Math.max(el.clientWidth, 360) + 2) break
    chain.push(describe(worst.k))
    el = worst.k
    if (el.children.length === 0) break
  }
  // Todos los descendientes con scrollWidth > 400, los 8 peores
  const wide = [...group.querySelectorAll('*')].map((k) => ({ k, sw: k.scrollWidth }))
    .filter((x) => x.sw > 400).sort((a, b) => b.sw - a.sw).slice(0, 8).map((x) => describe(x.k))
  // Global: elementos más anchos que el viewport en todo el documento
  const globalWide = [...document.querySelectorAll('body *')]
    .map((k) => ({ k, w: k.getBoundingClientRect().width, right: k.getBoundingClientRect().right }))
    .filter((x) => x.w > 362)
    .sort((a, b) => b.w - a.w).slice(0, 10)
    .map((x) => {
      const chain = []
      let p = x.k
      for (let i = 0; i < 5 && p; i++) { chain.push(p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className ? '.' + p.className.split(' ')[0] : '')); p = p.parentElement }
      return { sel: describe(x.k).sel, w: Math.round(x.w), right: Math.round(x.right), chain: chain.join(' < ') }
    })
  // Constreñir la primera tarjeta a 300px y nombrar lo que desborda
  const card = group.querySelector('.account-card')
  let constrained = []
  if (card) {
    card.style.width = '300px'
    constrained = [...card.querySelectorAll('*')]
      .map((k) => ({ k, sw: k.scrollWidth, w: Math.round(k.getBoundingClientRect().width), right: Math.round(k.getBoundingClientRect().right) }))
      .filter((x) => x.sw > 302 || x.right > 330)
      .sort((a, b) => b.sw - a.sw).slice(0, 10)
      .map((x) => ({ ...describe(x.k), text2: (x.k.textContent || '').replace(/\s+/g, ' ').slice(0, 100) }))
    card.style.width = ''
  }
  return { docSW: document.documentElement.scrollWidth, chain, wide, constrained, globalWide }
})
fs.writeFileSync('/tmp/cobrar-chain.json', JSON.stringify(out, null, 1)); console.log('docSW', out.docSW)
await browser.close()
server.close()
