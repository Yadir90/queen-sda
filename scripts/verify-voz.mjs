/* Batería de voz de Queen (verify:voz) — INVERTIDA el 26-oct
   (D-R5-02): la voz de Queen se ELIMINÓ del clon por orden expresa
   del dueño («Elimina lo de escuchar y hablar de Queen, no
   funciona» — el servicio de voz de Google de su A16 abortaba al
   arrancar). Queen queda 100 % texto, como en el sistema original.
   Donde esta batería probaba el comportamiento de la voz con
   fakes, ahora afirma su AUSENCIA: ningún punto de entrada de
   voz (micrófono, síntesis, orbe de voz, ajustes, claves de
   configuración) puede reaparecer en el árbol ni en el bundle, y
   el chat de texto sigue entero. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failures++; };

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|css|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(root, 'src'));
const read = (p) => fs.readFileSync(p, 'utf8');

/* 1) Los dos archivos de la capa de voz no existen. */
check('lib/queenVoice.ts eliminado', !fs.existsSync(path.join(root, 'src/lib/queenVoice.ts')));
check('components/QueenVoiceOrb.tsx eliminado', !fs.existsSync(path.join(root, 'src/components/QueenVoiceOrb.tsx')));

/* 2) Ninguna referencia a las APIs ni a las piezas de voz en src/.
   (La única mención permitida de las claves queen-voice-* es el
   removeItem de limpieza en clearChat de Queen.tsx.) */
const FORBIDDEN = [
  'SpeechRecognition', 'speechSynthesis', 'queenVoice', 'QueenVoiceOrb',
  'queen-mic-btn', 'queen-voice-bar', 'queen-voice-status', 'queen-speaking-tag',
  'speakQueen', 'startRecognition', 'stopQueenSpeech',
];
for (const token of FORBIDDEN) {
  const hits = files.filter((f) => read(f).includes(token)).map((f) => path.relative(root, f));
  check(`sin «${token}» en src/`, hits.length === 0, hits.join(', '));
}
{
  const writes = files.filter((f) => /setItem\('queen-voice|loadJSON\('queen-voice|saveJSON\('queen-voice/.test(read(f)));
  check('sin lecturas/escrituras de ajustes de voz (queen-voice-*)', writes.length === 0, writes.map((f) => path.relative(root, f)).join(', '));
  const queen = read(path.join(root, 'src/screens/Queen.tsx'));
  check('la limpieza de claves de voz huérfanas vive en clearChat', queen.includes("removeItem('queen-voice-tts-v1')"));
}

/* 3) El chat de texto de Queen sigue entero: composer con su
   entrada, send con el determinista y la capa de lenguaje. */
{
  const queen = read(path.join(root, 'src/screens/Queen.tsx'));
  check('composer de texto presente («Mensaje a Queen»)', queen.includes('Mensaje a Queen'));
  check('el send usa el determinista (answerQueen)', queen.includes('answerQueen('));
  check('preguntas rápidas presentes', queen.includes('QUEEN_EXTRA_QUICK'));
  check('sin botón de micrófono en el composer', !queen.includes('queen-mic') && !queen.includes('onMicToggle'));
}

/* 4) permissions.ts ya no ofrece voz. */
{
  const perm = read(path.join(root, 'src/lib/permissions.ts'));
  check('permissions sin «texto y voz»', !perm.includes('texto y voz'));
}

/* 5) El bundle servido tampoco trae la voz (si dist/ existe). */
const distAssets = path.join(root, 'dist', 'assets');
if (fs.existsSync(distAssets)) {
  const js = fs.readdirSync(distAssets).filter((f) => f.endsWith('.js')).map((f) => read(path.join(distAssets, f))).join('\n');
  check('bundle sin SpeechRecognition/speechSynthesis', !js.includes('SpeechRecognition') && !js.includes('speechSynthesis'));
  /* Las claves de limpieza queen-voice-tts-v1/-conv-v1 SÍ viajan (son
     el removeItem de clearChat): lo prohibido son las CLASES de la
     capa de voz. */
  check('bundle sin clases de voz (queen-voice-bar/status, queen-mic-btn)', !js.includes('queen-voice-bar') && !js.includes('queen-voice-status') && !js.includes('queen-mic-btn'));
} else {
  console.log('· dist/ no existe en esta corrida: el punto 5 (bundle) se verifica tras el build de la sonda.');
}

console.log(failures === 0 ? 'VOZ OK (ausencia verificada)' : `VOZ: ${failures} FALLOS`);
process.exit(failures ? 1 : 0);
