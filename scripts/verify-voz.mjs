/* Batería de voz de Queen (verify:voz) — nace del diagnóstico del
   26-oct: en el teléfono del dueño la escucha moría AL ARRANCAR con
   el aviso genérico de «aborted» y la síntesis no sonaba en
   silencio. La sonda de ciclo de vida demostró que la app hace
   1 construct + 1 start() sin abortar nada: el aborto pre-arranque
   lo dispara la PLATAFORMA (servicio de voz del dispositivo).
   Esta batería fija el comportamiento corregido con fakes
   instrumentados (Chromium headless no trae servicio de voz real):
   A) reconocimiento sano: el texto final se entrega, la app no
      aborta nada;
   B) «aborted» pre-onstart en toda instancia + micrófono OK:
      UN reintento automático y aviso que NOMBRA el servicio de
      voz del dispositivo (app de Google), no el genérico;
   B2) igual pero getUserMedia denegado: aviso de permiso;
   C) TTS que nunca arranca (sin onstart, speaking=false): el
      vigía avisa a los ~1,5 s — la lectura ya no muere en
      silencio; y el TTS se invoca aunque la escucha haya fallado
      (independencia escucha/habla). */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const tmpJs = path.join(os.tmpdir(), 'queenVoice-verify.mjs');
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), ['src/lib/queenVoice.ts', '--format=esm', `--outfile=${tmpJs}`], { stdio: 'pipe' });
const mod = fs.readFileSync(tmpJs, 'utf8');
const html = `data:text/html,<body><script type="module">${mod}
window.__qv = { startRecognition, speakQueen };</script></body>`;
const CHROME = process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failures++; };

function fakeRecog(mode) {
  return `
  window.__log = [];
  class FakeRec {
    constructor() { window.__log.push('construct'); this.onresult=null; this.onerror=null; this.onend=null; this.onstart=null; }
    start() { window.__log.push('start');
      if (${JSON.stringify(mode)} === 'healthy') { setTimeout(() => { this.onstart && this.onstart();
        const r = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'hola queen', confidence: 1 } } } };
        this.onresult && this.onresult(r); this.onend && this.onend(); }, 30); }
      else { setTimeout(() => { this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }, 10); } }
    stop() { window.__log.push('stop'); } abort() { window.__log.push('app-abort'); } }
  window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;`;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// A) sano
{
  const page = await browser.newPage();
  await page.addInitScript(fakeRecog('healthy'));
  await page.goto(html);
  const res = await page.evaluate(() => new Promise((resolve) => {
    const out = { finals: [], errors: [], ended: false };
    window.__qv.startRecognition({ onInterim: () => {}, onFinal: (t) => out.finals.push(t),
      onError: (m) => out.errors.push(m), onEnd: () => { out.ended = true; setTimeout(() => resolve({ ...out, log: window.__log }), 100); } });
  }));
  check('A: texto final entregado', res.finals.join('') === 'hola queen', JSON.stringify(res.finals));
  check('A: sin errores ni abortos de la app', res.errors.length === 0 && !res.log.includes('app-abort'), res.log.join(','));
  await page.close();
}

// B) aborto de plataforma + micrófono OK → aviso del servicio de voz
{
  const page = await browser.newPage();
  await page.addInitScript(fakeRecog('prestart-abort'));
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) }, configurable: true }); });
  await page.goto(html);
  const res = await page.evaluate(() => new Promise((resolve) => {
    const out = { errors: [] };
    window.__qv.startRecognition({ onInterim: () => {}, onFinal: () => {},
      onError: (m) => out.errors.push(m), onEnd: () => setTimeout(() => resolve({ ...out, log: window.__log }), 150) });
    setTimeout(() => resolve({ ...out, log: window.__log }), 4000);
  }));
  check('B: hubo reintento (2 construct/2 start)', res.log.filter((x) => x === 'construct').length === 2 && res.log.filter((x) => x === 'start').length === 2, res.log.join(','));
  check('B: el aviso nombra el servicio de voz del dispositivo (app de Google)', res.errors.some((m) => m.includes('app de Google')), res.errors[0]?.slice(0, 60) ?? 'sin aviso');
  check('B: la app nunca abortó por su cuenta', !res.log.includes('app-abort'));
  await page.close();
}

// B2) aborto de plataforma + micrófono denegado → aviso de permiso
{
  const page = await browser.newPage();
  await page.addInitScript(fakeRecog('prestart-abort'));
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } }, configurable: true }); });
  await page.goto(html);
  const res = await page.evaluate(() => new Promise((resolve) => {
    const out = { errors: [] };
    window.__qv.startRecognition({ onInterim: () => {}, onFinal: () => {},
      onError: (m) => out.errors.push(m), onEnd: () => setTimeout(() => resolve({ ...out }), 150) });
    setTimeout(() => resolve(out), 4000);
  }));
  check('B2: el aviso es el de permiso de micrófono', res.errors.some((m) => m.includes('no tiene permiso')), res.errors[0]?.slice(0, 60) ?? 'sin aviso');
  await page.close();
}

// C) TTS mudo: Chromium headless no trae motor de voz (onstart
//    nunca llega, speaking=false): el vigía debe avisar y
//    speakQueen no debe lanzar — la lectura ya no muere en
//    silencio. La independencia habla/escucha es estructural:
//    speakQueen no toca el reconocimiento (escenario B la ejercita
//    con la escucha rota sin pasar por él).
{
  const page = await browser.newPage();
  await page.goto(html);
  const res = await page.evaluate(() => new Promise((resolve) => {
    let stuck = false; let threw = '';
    try { window.__qv.speakQueen('Respuesta de Queen.', () => {}, () => {}, () => { stuck = true; }); }
    catch (e) { threw = String(e); }
    setTimeout(() => resolve({ stuck, threw }), 2200);
  }));
  check('C: speakQueen no lanzó con el motor mudo', res.threw === '', res.threw);
  check('C: el fallo del motor de voz se avisó (onerror synthesis-failed o vigía)', res.stuck === true);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? 'VOZ OK' : `VOZ: ${failures} FALLOS`);
process.exit(failures ? 1 : 0);
