// Generador del icono de app (pieza del dueño, 2026-10-26): la marca de
// Queen en su última etapa, Maduro, en estilo premium. La geometría es la
// literal de QueenReactorMark 'maduro' (src/components/QueenReactor.tsx):
// órbitas completas, elipse inclinada -18°, núcleo con degradado blanco →
// malva #C084FC y su punto de luz; sobre el fondo profundo del sistema con
// la aurora tenue aprobada. Salida: public/icons/queen-maduro-{512,192}.png
// (full-bleed; la órbita mayor queda dentro de la zona segura maskable).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="85%">
      <stop offset="0%" stop-color="#17453B"/>
      <stop offset="55%" stop-color="#102B27"/>
      <stop offset="100%" stop-color="#0C141B"/>
    </radialGradient>
    <radialGradient id="qcore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="45%" stop-color="#FFFFFF"/>
      <stop offset="76%" stop-color="#D8B4FE"/>
      <stop offset="100%" stop-color="#C084FC"/>
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="34"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- Aurora tenue aprobada del sistema: turquesa y malva, sin competir con la marca -->
  <ellipse cx="118" cy="96" rx="150" ry="110" fill="#2DD4BF" opacity="0.16" filter="url(#soft)"/>
  <ellipse cx="404" cy="420" rx="170" ry="120" fill="#C084FC" opacity="0.20" filter="url(#soft)"/>
  <ellipse cx="392" cy="92" rx="110" ry="80" fill="#38BDF8" opacity="0.10" filter="url(#soft)"/>
  <!-- Marca Maduro del Reactor Evolutivo (QueenReactor.tsx): la marca de
       48×48 escalada ×7.4 y centrada; su órbita mayor queda a 160px del
       centro, dentro de la zona segura maskable (radio 204px). -->
  <g transform="translate(256 256) scale(7.4) translate(-24 -24)">
    <g>
      <circle cx="24" cy="24" r="21.6" fill="none" stroke="#C084FC" stroke-width="1.3" opacity="0.85"/>
    </g>
    <g>
      <ellipse cx="24" cy="24" rx="19.4" ry="8.4" transform="rotate(-18 24 24)" fill="none" stroke="#D8B4FE" stroke-width="1.2" opacity="0.75"/>
    </g>
    <g>
      <circle cx="24" cy="24" r="14.2" fill="none" stroke="#C084FC" stroke-width="1.1" opacity="0.6"/>
    </g>
    <g>
      <circle cx="24" cy="24" r="7.6" fill="url(#qcore)"/>
      <circle cx="21.3" cy="21.1" r="2.3" fill="#FFFFFF" opacity="0.85"/>
    </g>
  </g>
</svg>
`

function findChromium() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const cands = [process.env.CHROME_PATH].filter(Boolean)
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
    cands.push(path.join(cache, d, 'chrome-linux64/chrome'), path.join(cache, d, 'chrome-linux/chrome'))
  }
  cands.push('/usr/bin/chromium', '/usr/bin/google-chrome')
  return cands.find((c) => c && fs.existsSync(c))
}

const exe = findChromium()
if (!exe) { console.error('SIN CHROMIUM'); process.exit(2) }
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
for (const size of [512, 192]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;padding:0">${SVG.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`)
  await page.screenshot({ path: new URL(`../public/icons/queen-maduro-${size}.png`, import.meta.url).pathname, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  console.log('icono', size, 'renderizado')
}
await browser.close()
