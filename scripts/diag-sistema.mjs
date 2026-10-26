import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'; import http from 'node:http'; import os from 'node:os'; import path from 'node:path'
const REPO = process.cwd()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'))
execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: REPO, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, stdio: 'pipe' })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); let f = path.join(dir, decodeURIComponent(u.pathname)); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html'); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`
const exe = fs.readdirSync(path.join(os.homedir(), '.cache/ms-playwright')).filter((d) => d.startsWith('chromium')).map((d) => path.join(os.homedir(), '.cache/ms-playwright', d, 'chrome-linux64/chrome')).find((p) => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage()
await page.goto(base)
await page.waitForSelector('#lg-email'); await page.fill('#lg-email', 'yadir.medina900710@gmail.com'); await page.fill('#lg-pass', 'Admin1')
await page.click('.auth-card button[type="submit"]')
await page.waitForSelector('#cp-new'); await page.fill('#cp-temp', 'Admin1'); await page.fill('#cp-new', 'AuditoriaVisual1'); await page.fill('#cp-rep', 'AuditoriaVisual1')
await page.click('.auth-card button[type="submit"]')
await page.waitForSelector('.app-shell')
await page.evaluate(() => { [...document.querySelectorAll('.bottomnav button, .sidenav .nav-btn')].find((b) => b.textContent.includes('Sistema'))?.click() })
await page.waitForTimeout(2500)
const diag = await page.evaluate(() => {
  const main = document.querySelector('main')
  const slots = [...document.querySelectorAll('.sistema-slot')]
  return {
    winScrollH: document.documentElement.scrollHeight, bodyScrollH: document.body.scrollHeight,
    mainScrollH: main?.scrollHeight, mainClientH: main?.clientHeight, mainOverflowY: main ? getComputedStyle(main).overflowY : null,
    docScrollingEl: document.scrollingElement?.tagName,
    slots: slots.length,
    slotTexts: slots.map((s) => (s.textContent || '').replace(/\s+/g, ' ').slice(0, 42)),
    mainTextHasVistazo: (main?.textContent || '').includes('De un vistazo'),
    mainInnerHasVistazo: (main?.innerText || '').includes('De un vistazo'),
  }
})
console.log(JSON.stringify(diag, null, 1))
await browser.close(); server.close()
