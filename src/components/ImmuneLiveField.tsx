/* ImmuneLiveField.tsx — «Sistema inmune en vivo» del clon Queen SDA.
 *
 * PORT del componente ImmuneLiveField del original
 * (client/src/App.tsx, dentro de la tarjeta «Banco de errores ·
 * Sistema inmune») y de su comentario de diseño, que sigue más abajo
 * tal cual. El CSS vive en immuneLive.css, portado de las clases
 * immune-* de client/src/theme.css del original.
 *
 * MAPEO DEL BANCO DEL CLON AL CAMPO (buildImmuneBankView, abajo):
 * el banco real del clon es queenCore.buildQueenErrorBank(data), que
 * SOLO trae { cells, knownThreats }, con células { cellKey, module,
 * topic, symptoms, cause, antibody, status, detections }. De ahí:
 *  · HUD «Anticuerpos» y semilla del registro: bank.knownThreats
 *    (real, = número de células verificadas).
 *  · Anomalías y fichas: bank.cells tal cual — symptoms es el tipo
 *    que entra al campo y el error que la ficha dice vigilar;
 *    cellKey es su firma; antibody/cause/topic/module alimentan la
 *    ficha; la célula del campo nº i representa a bank.cells[i]
 *    (índice, como en el original; si no hay célula del banco para
 *    ese índice, la ficha es la de patrulla del original).
 *  · Contenidas en ámbar «Esperando tu sí»: status === 'conflicto'
 *    (semilla, como en el original) o requiresApproval DERIVADO de
 *    campos reales: módulo/tema que toca un dominio sensible
 *    (IPV, cuentas, dinero, ADN o permisos) — las células actuales
 *    del clon son de módulo IPV (cuadre = dinero), así que entran
 *    como críticas/contenidas y nunca se corrigen solas.
 *  · conflictCells: DERIVADO contando status === 'conflicto'
 *    (el constructor del clon emite 'activa': da 0, sin inventar).
 *  · Lo que el clon NO registra — neutralizaciones, recurrencias,
 *    última lección, última neutralización, respuesta en ms —
 *    queda en su estado de reposo honesto (0 / null): el HUD lee 0,
 *    la «respuesta más rápida» lee «—», el registro no siembra
 *    neutralizaciones ni lecciones que no existen y ninguna
 *    anomalía nace de esas cifras. El contador real por célula
 *    que SÍ trae el clon, detections, se muestra en la ficha y su
 *    cambio forma parte de la firma de actividad que dispara la
 *    entrada de anomalías mientras la pestaña está abierta.
 *  · firstSeenAt: DERIVADO de la fecha real embebida en el cellKey
 *    del clon (`cuadre-AAAA-MM-DD`); sin fecha en la firma, null.
 * NUNCA se inventan cifras ni anomalías: sin células verificadas el
 * campo queda en patrulla tranquila, como en el original.
 *
 * Adaptaciones de arquitectura (sin Tailwind en el clon): las
 * clases utilitarias del JSX original se sustituyen por clases
 * immune-* equivalentes en immuneLive.css; fmtFull es el fmtDayLong
 * del original (Intl es, fecha larga) sobre la fecha ISO.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueenErrorCell } from '../lib/queenCore.mjs'
import './immuneLive.css'

/** fmtFull del original (= fmtDayLong): fecha larga en español. */
function fmtFull(iso: string): string {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso.slice(0, 10)}T12:00:00`))
}

/* Vista del campo: la forma del banco del original, alimentada
 * SOLO del banco real del clon por buildImmuneBankView. */
export interface ImmuneBankCellView extends QueenErrorCell {
  neutralizations: number
  recurrences: number
  requiresApproval: boolean
  lastNeutralizedAt: string | null
  lastResponseMs: number | null
  firstSeenAt: string | null
}
export interface ImmuneBankView {
  cells: ImmuneBankCellView[]
  knownThreats: number
  neutralizations: number
  recurrences: number
  conflictCells: number
  lastLessonAt: string | null
  lastNeutralizationAt: string | null
}

/** Dominio sensible según la regla literal del original: dinero,
 *  cuentas, IPV, ADN o permisos. Se lee del módulo/tema REALES de
 *  la célula del clon. */
function touchesSensitiveDomain(cell: QueenErrorCell): boolean {
  return /ipv|cuenta|dinero|adn|permiso/i.test(`${cell.module} ${cell.topic}`)
}

export function buildImmuneBankView(bank: { cells: QueenErrorCell[]; knownThreats: number }): ImmuneBankView {
  const cells: ImmuneBankCellView[] = bank.cells.map((cell) => {
    const dateInKey = /\d{4}-\d{2}-\d{2}/.exec(cell.cellKey)
    return {
      ...cell,
      neutralizations: 0,
      recurrences: 0,
      requiresApproval: touchesSensitiveDomain(cell),
      lastNeutralizedAt: null,
      lastResponseMs: null,
      firstSeenAt: dateInKey ? dateInKey[0] : null,
    }
  })
  return {
    cells,
    knownThreats: bank.knownThreats,
    neutralizations: 0,
    recurrences: 0,
    conflictCells: cells.filter((c) => c.status === 'conflicto').length,
    lastLessonAt: null,
    lastNeutralizationAt: null,
  }
}

/* ---------- Sistema inmune en vivo (dentro del Banco de errores) ----------
 * Campo animado aprobado por el dueño (diseño «sistema-inmune-en-vivo»),
 * integrado en la propia tarjeta del banco de errores de Sistema — no
 * es una tarjeta suelta ni repite sus cifras: el HUD y el medidor se
 * alimentan del MISMO banco real (amenazas conocidas, neutralizaciones,
 * última lección) que la lista de células de abajo. En reposo muestra
 * la patrulla tranquila sobre los cinco carriles del flujo (IPV,
 * cuentas, RH, almacén, boletines); cuando el banco registra una
 * neutralización o recurrencia NUEVA mientras la pestaña está abierta,
 * esa anomalía entra al campo y la patrulla la neutraliza en pantalla;
 * las que tocan dinero (requiresApproval) o están en conflicto quedan
 * CONTENIDAS en ámbar con «Esperando tu sí», sin corregirse solas, y se
 * liberan solo cuando el banco real deja de marcarlas en conflicto.
 * Al tocar una célula del campo se abre su ficha (bajo el lienzo)
 * con los datos reales de su célula del banco: error que vigila,
 * firma, anticuerpo, estado y neutralizaciones; la selección se
 * pinta en el lienzo por ref, sin re-renderizar el campo.
 * Rendimiento en tiempo real (Galaxy A16): simulación con paso fijo
 * de 60 Hz y velocidades en px/s (fluida igual a 30, 60 o 120 Hz: a
 * 120 Hz el paso anterior duplicaba el coste de simulación por cuadro
 * sin que el ojo lo notara), fondo, células Y anomalías
 * pre-renderizados fuera de pantalla (la anomalía ya no traza su
 * polígono de 18 vértices en cada cuadro), anchos de etiqueta
 * cacheados (nada de measureText por cuadro), paquetes como
 * rectángulos (nada de arcos por paquete), reparto de objetivos
 * entre células, DPR limitado a 1.5, ≤7 células y ≤18 paquetes; si el
 * cuadro medio supera ~24 ms de forma sostenida, la calidad baja
 * sola un escalón (resolución interna, luego paquetes alternos) en
 * vez de ir a tirones; el bucle se detiene por completo cuando la
 * tarjeta sale de pantalla, el documento pasa a segundo plano, la
 * patrulla está en pausa o con «reducir movimiento» (arranca en
 * pausa), y los contadores del HUD se actualizan por refs del DOM
 * como máximo cada 200 ms y solo si cambiaron, sin re-renderizar
 * React por frame.
 * Tema: el escenario usa variables propias que siguen el tema activo —
 * fondo claro en modo claro (sin disco oscuro) y oscuro en modo
 * oscuro — y los colores del lienzo se releen al cambiar el esquema.
 * Legibilidad (corrección tras la foto del dueño: «apenas y se
 * distingue»): el fondo se pinta SÓLIDO en la capa del lienzo con
 * bandas alternas por carril, los rótulos de carril y las etiquetas
 * de anomalía van sobre pastilla, y las células llevan cuerpo
 * saturado, borde y núcleo definidos — nada de gamas translúcidas
 * fundidas entre sí, para que cada elemento se distinga de un
 * vistazo en ambos temas y con reflejo sobre la pantalla. */
interface ImmCell { x: number; y: number; vx: number; vy: number; r: number; fase: number; wagX: number; wagY: number; wagT: number; memT: number; target: ImmAnomaly | null }
interface ImmAnomaly { x: number; y: number; vx: number; vy: number; r: number; tipo: string; critico: boolean; estado: "libre" | "atacada" | "contenida"; vida: number; rot: number; detectada: boolean; cellKey: string }
interface ImmPacket { x: number; lane: number; sp: number; r: number; fase: number }
interface ImmParticle { x: number; y: number; vx: number; vy: number; vida: number; t: number; color: string; r: number }
interface ImmRing { x: number; y: number; r: number; t: number }
interface ImmWorld { cells: ImmCell[]; anomalies: ImmAnomaly[]; packets: ImmPacket[]; particles: ImmParticle[]; rings: ImmRing[]; queue: { tipo: string; critico: boolean; cellKey: string }[] }
interface ImmLogEntry { id: number; time: string; tag: string; kind: "det" | "neu" | "con" | "mem" | "err"; text: string }
const IMM_LANES = ["IPV", "Cuentas", "RH", "Almacén", "Boletines"];

export default function ImmuneLiveField(props: { bank: ImmuneBankView }) {
  const { bank } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudFieldRef = useRef<HTMLElement>(null);
  const hudStatusRef = useRef<HTMLElement>(null);
  const threatFillRef = useRef<HTMLDivElement>(null);
  const threatValRef = useRef<HTMLElement>(null);
  const worldRef = useRef<ImmWorld>({ cells: [], anomalies: [], packets: [], particles: [], rings: [], queue: [] });
  const pausedRef = useRef(false);
  const labelsRef = useRef(true);
  const darkRef = useRef(false);
  const bankRef = useRef(bank);
  bankRef.current = bank;
  const logIdRef = useRef(0);
  const [log, setLog] = useState<ImmLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  // Célula tocada en el campo: su ficha se muestra bajo el lienzo con
  // los datos reales de su célula del banco; el índice vive también
  // en una ref para que el lienzo pinte el anillo de selección sin
  // re-renderizar el campo.
  const [selectedCell, setSelectedCell] = useState<{ idx: number; activity: string } | null>(null);
  const selectedIdxRef = useRef(-1);
  const [labels, setLabels] = useState(true);
  const [dark, setDark] = useState<boolean>(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  darkRef.current = dark;
  labelsRef.current = labels;
  pausedRef.current = paused;
  const pushLog = useCallback((tag: string, kind: ImmLogEntry["kind"], text: string) => {
    const entry: ImmLogEntry = { id: ++logIdRef.current, time: new Date().toLocaleTimeString("es-CU", { hour12: false }), tag, kind, text };
    setLog((prev) => [entry, ...prev].slice(0, 10));
  }, []);
  const logFnRef = useRef(pushLog);
  logFnRef.current = pushLog;

  // Esquema de color del sistema: el lienzo se repinta con la paleta
  // del tema activo cuando este cambia.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Movimiento reducido: la patrulla arranca en pausa (queda el campo
  // dibujado, sin bucle de movimiento).
  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPaused(true);
      pushLog("Patrulla", "det", "Movimiento reducido activado en tu dispositivo: la animación arranca en pausa.");
    }
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Semilla del registro con los hechos REALES del banco y contención
  // inicial de las células en conflicto (pendientes de la palabra de
  // Yadir): son las anomalías ámbar que el campo muestra al abrir.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    pushLog("Patrulla", "det", `Patrulla inmune en recorrido: ${IMM_LANES.join(", ")}. ${bank.knownThreats} amenaza${bank.knownThreats === 1 ? "" : "s"} conocida${bank.knownThreats === 1 ? "" : "s"} en el banco de memoria.`);
    const lastNeut = [...bank.cells].filter((c) => c.lastNeutralizedAt).sort((a, b) => String(b.lastNeutralizedAt).localeCompare(String(a.lastNeutralizedAt)))[0];
    if (lastNeut) pushLog("Neutralizada", "neu", `Última neutralización real: «${lastNeut.symptoms}»${lastNeut.lastResponseMs != null ? ` en ${lastNeut.lastResponseMs} ms` : ""} (${lastNeut.neutralizations} en total de su célula).`);
    if (bank.lastLessonAt) pushLog("Memoria", "mem", `Última lección aprendida: ${fmtFull(bank.lastLessonAt.slice(0, 10))}. El banco guarda ${bank.neutralizations} neutralizaciones y ${bank.recurrences} recurrencias reconocidas.`);
    for (const cell of bank.cells.filter((c) => c.status === "conflicto").slice(0, 2)) {
      worldRef.current.queue.push({ tipo: cell.symptoms, critico: true, cellKey: cell.cellKey });
      pushLog("Contenida", "con", `«${cell.symptoms}» está en conflicto en el banco: queda contenida, esperando tu palabra.`);
    }
  }, [bank, pushLog]);

  // Eventos reales mientras la pestaña está abierta: si el banco
  // registra una neutralización/recurrencia nueva (la lectura se
  // renueva sola cada 30 s), la anomalía entra al campo y se anima su
  // neutralización o su contención; si una célula en conflicto deja
  // de estarlo, su anomalía contenida se libera y se neutraliza.
  const prevCellsRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const current = new Map(bank.cells.map((c) => [c.cellKey, `${c.lastNeutralizedAt ?? ""}|${c.recurrences}|${c.neutralizations}|${c.status}|${c.detections}`]));
    const prev = prevCellsRef.current;
    prevCellsRef.current = current;
    if (!prev) return;
    for (const cell of bank.cells) {
      const before = prev.get(cell.cellKey);
      if (before === current.get(cell.cellKey)) continue;
      const wasConflict = before?.endsWith("|conflicto");
      if (cell.status === "conflicto" && !wasConflict) {
        worldRef.current.queue.push({ tipo: cell.symptoms, critico: true, cellKey: cell.cellKey });
        pushLog("Contenida", "con", `«${cell.symptoms}» entró en conflicto en el banco: contenida, esperando tu palabra.`);
      } else if (wasConflict && cell.status !== "conflicto") {
        const held = worldRef.current.anomalies.find((a) => a.cellKey === cell.cellKey && a.estado === "contenida");
        if (held) { held.estado = "atacada"; held.vida = 0.9; }
        pushLog("Resuelta", "neu", `«${cell.symptoms}» salió de conflicto en el banco: la contención se libera y se neutraliza.`);
      } else if (before != null) {
        worldRef.current.queue.push({ tipo: cell.symptoms, critico: cell.requiresApproval, cellKey: cell.cellKey });
        pushLog("Detección", "det", `El banco registró actividad nueva de «${cell.symptoms}»${cell.requiresApproval ? " — toca un dominio sensible: se contiene, no se corrige sola" : " — reconocida por su célula de memoria"}.`);
      }
    }
  }, [bank, pushLog]);

  // Arranque/repintado del campo desde fuera del bucle (botón de
  // pausa, cambio de tema): el efecto del motor registra aquí sus
  // controles para no recrear el bucle en cada render.
  const kickRef = useRef<(() => void) | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);

  // Motor de animación en tiempo real: un solo efecto al montar y
  // todo el estado vive en refs (cero re-renders de React por frame).
  // · Paso fijo de simulación (60 Hz con acumulador y dt real
  //   acotado): la velocidad en px/s es idéntica a 30, 60 o 120 Hz y
  //   un tirón de red o de CPU no teletransporta a nadie.
  // · Fondo (rejilla, carriles y rótulos), células y anomalías
  //   pre-renderizados en lienzos fuera de pantalla: por frame solo
  //   se copia el fondo y se estampan sprites, sin gradientes,
  //   polígonos ni medidas de texto repetidas por cuadro.
  // · Reparto de objetivos: cada anomalía libre la persigue UNA sola
  //   célula; las demás siguen patrullando (antes todas se amontonaban
  //   sobre la misma y el resto del campo quedaba sin vigilancia).
  // · El bucle se DETIENE (no solo se salta el frame) cuando la
  //   tarjeta sale de pantalla, el documento pasa a segundo plano o
  //   la patrulla está en pausa; se rearma solo al volver a verse.
  // · El HUD se escribe como máximo cada 200 ms y solo si el valor
  //   cambió; la barra de amenaza se mueve con transform (sin layout).
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const world = worldRef.current;
    const STEP = 1 / 60;
    let width = 0;
    let height = 264;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;
    let acc = 0;
    let hudAt = 0;
    let tGlobal = 0;
    // Calidad adaptativa: 0 = completa, 1 = resolución interna al
    // 70 %, 2 = además se dibuja un paquete de cada dos. Baja sola si
    // el coste medio del cuadro se sostiene por encima de ~24 ms
    // (menos de ~42 fps): en un A16 con calor o poca batería el campo
    // sigue fluido en vez de degradarse a tirones.
    let quality = 0;
    let dprScale = 1;
    let emaFrameMs = 16;
    let slowFrames = 0;
    const labelWidthCache = new Map<string, number>();
    let bgLayer: HTMLCanvasElement | null = null;
    let spriteCell: HTMLCanvasElement | null = null;
    let spriteMem: HTMLCanvasElement | null = null;
    let spriteAnomaly: HTMLCanvasElement | null = null;
    let spriteAnomalyCrit: HTMLCanvasElement | null = null;
    const hudCache = { field: "", status: "", peso: -1 };
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    function paintBackground() {
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(width * dpr));
      cv.height = Math.max(1, Math.round(height * dpr));
      const g = cv.getContext("2d");
      if (!g) { bgLayer = cv; return; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const darkNow = darkRef.current;
      // Fondo sólido pintado en la propia capa y bandas alternas por
      // carril: el contraste del campo no depende del CSS detrás del
      // lienzo ni del brillo de la pantalla — antes todo quedaba en
      // una misma gama turquesa translúcida y «apenas se distinguía».
      g.fillStyle = darkNow ? "#0a1e26" : "#e9f3ee";
      g.fillRect(0, 0, width, height);
      for (let i = 0; i < IMM_LANES.length; i++) {
        if (i % 2 === 0) continue;
        g.fillStyle = darkNow ? "rgba(120,220,205,.055)" : "rgba(11,125,140,.05)";
        g.fillRect(0, (i * height) / IMM_LANES.length, width, height / IMM_LANES.length);
      }
      g.strokeStyle = darkNow ? "rgba(120,220,205,.13)" : "rgba(11,125,140,.12)";
      g.lineWidth = 1;
      g.beginPath();
      for (let gx = 0.5; gx <= width; gx += 44) { g.moveTo(gx, 0); g.lineTo(gx, height); }
      for (let gy = 0.5; gy <= height; gy += 44) { g.moveTo(0, gy); g.lineTo(width, gy); }
      g.stroke();
      g.font = "800 11px system-ui, sans-serif";
      g.textAlign = "left";
      for (let i = 0; i < IMM_LANES.length; i++) {
        const y = ((i + 0.5) * height) / IMM_LANES.length;
        g.strokeStyle = darkNow ? "rgba(120,220,205,.10)" : "rgba(11,125,140,.09)";
        g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke();
        // Rótulo del carril sobre pastilla: se lee de un vistazo en
        // ambos temas, también con reflejo sobre la pantalla.
        const label = (IMM_LANES[i] ?? "").toUpperCase();
        const tw = g.measureText(label).width;
        g.fillStyle = darkNow ? "rgba(3,14,19,.78)" : "rgba(255,255,255,.8)";
        g.fillRect(5, y - 20, tw + 10, 15);
        g.fillStyle = darkNow ? "rgba(208,246,240,.95)" : "rgba(13,58,50,.92)";
        g.fillText(label, 10, y - 8.5);
      }
      bgLayer = cv;
    }
    function paintSprite(mem: boolean) {
      const S = 64;
      const R = 17;
      const cv = document.createElement("canvas");
      cv.width = Math.round(S * dpr);
      cv.height = Math.round(S * dpr);
      const g = cv.getContext("2d");
      if (!g) return cv;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = S / 2;
      const cy = S / 2;
      // Cuerpo saturado con borde definido y núcleo marcado: la
      // célula se distingue del fondo y de la rejilla de un vistazo
      // (antes el gradiente pálido sin borde se fundía con el campo).
      const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, 2, cx, cy, R);
      if (mem) { grad.addColorStop(0, "#fff3b0"); grad.addColorStop(0.55, "#f2c93c"); grad.addColorStop(1, "#c79a17"); }
      else { grad.addColorStop(0, "#d2fff3"); grad.addColorStop(0.55, "#3fe0c3"); grad.addColorStop(1, "#0b9b85"); }
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = mem ? "rgba(110,76,0,.85)" : "rgba(2,64,54,.9)";
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(cx, cy, R - 1, 0, Math.PI * 2); g.stroke();
      g.fillStyle = mem ? "rgba(96,66,0,.8)" : "rgba(2,58,50,.85)";
      g.beginPath(); g.arc(cx, cy, R * 0.42, 0, Math.PI * 2); g.fill();
      g.strokeStyle = mem ? "rgba(255,226,120,.95)" : "rgba(160,255,238,.95)";
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(cx, cy, R * 0.42, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = mem ? "rgba(230,190,70,.95)" : "rgba(46,204,178,.95)";
      g.lineWidth = 2.5;
      for (let f = 0; f < 5; f++) {
        const a = (f * Math.PI * 2) / 5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
        g.lineTo(cx + Math.cos(a) * R * 1.28, cy + Math.sin(a) * R * 1.28);
        g.stroke();
      }
      return cv;
    }
    function paintAnomalySprite(critico: boolean) {
      // La anomalía (estrella de 9 puntas con contorno, centro oscuro
      // y núcleo blanco) se pinta UNA vez aquí: por cuadro solo se
      // estampa girando, en vez de trazar 18 vértices con path.
      const S = 64;
      const R = 15;
      const cv = document.createElement("canvas");
      cv.width = Math.round(S * dpr);
      cv.height = Math.round(S * dpr);
      const g = cv.getContext("2d");
      if (!g) return cv;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = S / 2;
      const cy = S / 2;
      g.fillStyle = critico ? "#e8930c" : "#e0524a";
      g.beginPath();
      const spikes = 9;
      for (let s = 0; s < spikes * 2; s++) {
        const ang = (s / (spikes * 2)) * Math.PI * 2;
        const rr = R * (s % 2 === 0 ? 1.25 : 0.8);
        const px = cx + Math.cos(ang) * rr;
        const py = cy + Math.sin(ang) * rr;
        if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(46,8,4,.65)";
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = "rgba(0,0,0,.4)";
      g.beginPath(); g.arc(cx, cy, R * 0.38, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,.85)";
      g.beginPath(); g.arc(cx, cy, R * 0.13, 0, Math.PI * 2); g.fill();
      return cv;
    }
    function buildSprites() {
      spriteCell = paintSprite(false);
      spriteMem = paintSprite(true);
      spriteAnomaly = paintAnomalySprite(false);
      spriteAnomalyCrit = paintAnomalySprite(true);
    }
    function buildField() {
      const rect = stage!.getBoundingClientRect();
      const newWidth = Math.max(280, rect.width);
      const widthChanged = Math.abs(newWidth - width) > 1;
      dpr = Math.min(1.5, window.devicePixelRatio || 1) * dprScale;
      width = newWidth;
      height = 264;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx2d!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!world.cells.length) {
        for (let i = 0; i < 7; i++) {
          world.cells.push({ x: rnd(40, width - 40), y: rnd(40, height - 40), vx: 0, vy: 0, r: rnd(12, 16), fase: rnd(0, Math.PI * 2), wagX: rnd(30, width - 30), wagY: rnd(30, height - 30), wagT: rnd(0.5, 3), memT: 0, target: null });
        }
      } else if (widthChanged) {
        for (const c of world.cells) { c.x = Math.min(c.x, width - c.r); c.wagX = Math.min(c.wagX, width - 30); }
        for (const an of world.anomalies) an.x = Math.min(an.x, width - an.r);
      }
      if (!world.packets.length) {
        const n = Math.min(18, Math.max(10, Math.floor(width / 52)));
        for (let i = 0; i < n; i++) world.packets.push({ x: rnd(0, width), lane: Math.floor(rnd(0, IMM_LANES.length)), sp: rnd(26, 70), r: rnd(2.2, 3.4), fase: rnd(0, 9) });
      }
      paintBackground();
      buildSprites();
    }
    function burst(x: number, y: number, color: string, count: number) {
      for (let i = 0; i < count; i++) {
        const ang = rnd(0, Math.PI * 2);
        const sp = rnd(35, 140);
        world.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vida: rnd(0.4, 0.9), t: 0, color, r: rnd(1.5, 3) });
      }
      if (world.particles.length > 80) world.particles.splice(0, world.particles.length - 80);
      world.rings.push({ x, y, r: 6, t: 0 });
    }
    function spawnQueued() {
      while (world.queue.length && world.anomalies.length < 6) {
        const next = world.queue.shift()!;
        const edge = Math.floor(rnd(0, 4));
        const r = rnd(11, 14);
        const x = edge === 0 ? r + 3 : edge === 1 ? width - r - 3 : rnd(30, width - 30);
        const y = edge === 2 ? r + 3 : edge === 3 ? height - r - 3 : rnd(30, height - 30);
        world.anomalies.push({ x, y, vx: rnd(-16, 16), vy: rnd(-16, 16), r, tipo: next.tipo, critico: next.critico, estado: "libre", vida: 0.9, rot: rnd(0, Math.PI * 2), detectada: false, cellKey: next.cellKey });
      }
    }
    function step(dt: number) {
      tGlobal += dt;
      spawnQueued();
      for (const p of world.packets) {
        p.x += p.sp * dt;
        if (p.x > width + 8) { p.x = -8; p.lane = Math.floor(rnd(0, IMM_LANES.length)); }
      }
      for (let j = world.anomalies.length - 1; j >= 0; j--) {
        const an = world.anomalies[j]!;
        an.rot += dt * 0.8;
        if (an.estado === "libre") {
          an.x += an.vx * dt;
          an.y += an.vy * dt;
          if (an.x < an.r + 4 || an.x > width - an.r - 4) an.vx *= -1;
          if (an.y < an.r + 4 || an.y > height - an.r - 4) an.vy *= -1;
          an.x = Math.max(an.r, Math.min(width - an.r, an.x));
          an.y = Math.max(an.r, Math.min(height - an.r, an.y));
        } else if (an.estado === "atacada") {
          an.vida -= dt;
          if (an.vida <= 0) {
            world.anomalies.splice(j, 1);
            burst(an.x, an.y, "#3fd8c8", 12);
            logFnRef.current("Neutralizada", "neu", `«${an.tipo}» neutralizada en el campo con su anticuerpo conocido.`);
          }
        }
      }
      // Reparto de objetivos: una anomalía libre, una sola célula.
      const claimed = new Set<ImmAnomaly>();
      for (const c of world.cells) if (c.target && c.target.estado === "libre") claimed.add(c.target);
      for (const c of world.cells) {
        c.fase += dt * 2;
        if (c.memT > 0) c.memT -= dt;
        let best: ImmAnomaly | null = c.target && c.target.estado === "libre" ? c.target : null;
        if (!best) {
          let bestD = Number.POSITIVE_INFINITY;
          for (const cand of world.anomalies) {
            if (cand.estado !== "libre" || claimed.has(cand)) continue;
            const dx = cand.x - c.x;
            const dy = cand.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = cand; }
          }
          if (best) claimed.add(best);
        }
        c.target = best;
        let desX = 0;
        let desY = 0;
        if (best) {
          if (!best.detectada) {
            best.detectada = true;
            logFnRef.current("Detección", "det", `Célula sobre «${best.tipo}»${bankRef.current.cells.some((cell) => cell.cellKey === best!.cellKey) ? " — reconocida de memoria por su firma" : ""}.`);
          }
          const dx = best.x - c.x;
          const dy = best.y - c.y;
          const dd = Math.hypot(dx, dy) || 1;
          desX = (dx / dd) * 128;
          desY = (dy / dd) * 128;
          if (dd < c.r + best.r + 4) {
            if (best.critico) {
              best.estado = "contenida";
              claimed.delete(best);
              c.target = null;
              burst(best.x, best.y, "#f0a832", 8);
              logFnRef.current("Contenida", "con", `«${best.tipo}» aislada en el campo. Esperando tu verificación y tu «sí».`);
              c.memT = 2.5;
            } else {
              best.estado = "atacada";
              best.vida = 0.9;
              claimed.delete(best);
              c.target = null;
              c.memT = 2.5;
            }
          }
        } else {
          c.wagT -= dt;
          if (c.wagT <= 0) { c.wagX = rnd(30, Math.max(60, width - 30)); c.wagY = rnd(30, Math.max(60, height - 30)); c.wagT = rnd(2.5, 5); }
          const dx = c.wagX - c.x;
          const dy = c.wagY - c.y;
          const dd = Math.hypot(dx, dy) || 1;
          const cruise = 46 * Math.min(1, Math.max(0.22, dd / 70));
          desX = (dx / dd) * cruise;
          desY = (dy / dd) * cruise;
        }
        const k = 1 - Math.exp(-dt * (best ? 7 : 4.5));
        c.vx += (desX - c.vx) * k;
        c.vy += (desY - c.vy) * k;
        c.x = Math.max(c.r, Math.min(width - c.r, c.x + c.vx * dt));
        c.y = Math.max(c.r, Math.min(height - c.r, c.y + c.vy * dt));
      }
      const damp = Math.exp(-dt * 2.6);
      for (let q = world.particles.length - 1; q >= 0; q--) {
        const pa = world.particles[q]!;
        pa.t += dt;
        pa.x += pa.vx * dt;
        pa.y += pa.vy * dt;
        pa.vx *= damp; pa.vy *= damp;
        if (pa.t > pa.vida) world.particles.splice(q, 1);
      }
      for (let q = world.rings.length - 1; q >= 0; q--) {
        const ring = world.rings[q]!;
        ring.t += dt;
        ring.r += dt * 110;
        if (ring.t > 0.55) world.rings.splice(q, 1);
      }
    }
    function draw() {
      const darkNow = darkRef.current;
      if (bgLayer) ctx2d!.drawImage(bgLayer, 0, 0, width, height);
      else ctx2d!.clearRect(0, 0, width, height);
      ctx2d!.fillStyle = darkNow ? "rgba(140,225,235,.9)" : "rgba(13,110,130,.65)";
      for (let pi = 0; pi < world.packets.length; pi++) {
        // Calidad 2: un paquete de cada dos (el flujo se sigue leyendo).
        if (quality >= 2 && pi % 2 === 1) continue;
        const p = world.packets[pi]!;
        const y = ((p.lane + 0.5) * height) / IMM_LANES.length + Math.sin(p.x * 0.012 + p.fase) * 7;
        // Rectángulo diminuto en vez de arco: a 3 px se lee igual y no
        // paga el coste de trazar un círculo por paquete y cuadro.
        const s = p.r * 1.9;
        ctx2d!.fillRect(p.x - s / 2, y - s / 2, s, s);
      }
      ctx2d!.strokeStyle = "rgba(63,216,200,.45)";
      ctx2d!.lineWidth = 1;
      ctx2d!.setLineDash([4, 6]);
      ctx2d!.beginPath();
      let anyLink = false;
      for (const c of world.cells) {
        if (!c.target) continue;
        anyLink = true;
        ctx2d!.moveTo(c.x, c.y); ctx2d!.lineTo(c.target.x, c.target.y);
      }
      if (anyLink) ctx2d!.stroke();
      ctx2d!.setLineDash([]);
      for (const an of world.anomalies) {
        const aSprite = an.critico ? spriteAnomalyCrit : spriteAnomaly;
        if (aSprite) {
          // Estampa del sprite pre-renderizado (antes: polígono de 18
          // vértices + 2 arcos trazados en cada cuadro por anomalía).
          const aSize = an.r * 4.27;
          ctx2d!.save();
          ctx2d!.translate(an.x, an.y);
          ctx2d!.rotate(an.rot);
          ctx2d!.drawImage(aSprite, -aSize / 2, -aSize / 2, aSize, aSize);
          ctx2d!.restore();
        }
        if (an.estado === "contenida") {
          // Anillo de contención SIN setLineDash (cambiar el patrón de
          // trazo por cuadro es caro en GPU modestas): cuatro arcos
          // que giran despacio, el mismo lenguaje visual segmentado.
          ctx2d!.strokeStyle = "#e8930c";
          ctx2d!.lineWidth = 2;
          const ringR = an.r + 13 + Math.sin(tGlobal * 3) * 2;
          for (let s = 0; s < 4; s++) {
            const a0 = tGlobal * 0.9 + (s * Math.PI) / 2;
            ctx2d!.beginPath(); ctx2d!.arc(an.x, an.y, ringR, a0, a0 + Math.PI * 0.36); ctx2d!.stroke();
          }
          if (labelsRef.current) {
            ctx2d!.font = "800 11.5px system-ui, sans-serif";
            ctx2d!.textAlign = "center";
            const heldLabel = "ESPERANDO TU «SÍ»";
            let hw = labelWidthCache.get(heldLabel);
            if (hw == null) { hw = ctx2d!.measureText(heldLabel).width; labelWidthCache.set(heldLabel, hw); }
            ctx2d!.fillStyle = darkNow ? "rgba(3,14,19,.82)" : "rgba(255,255,255,.88)";
            ctx2d!.fillRect(an.x - hw / 2 - 5, an.y - an.r - 34, hw + 10, 16);
            ctx2d!.fillStyle = darkNow ? "#ffc95e" : "#8a5605";
            ctx2d!.fillText(heldLabel, an.x, an.y - an.r - 22);
          }
        }
        if (labelsRef.current) {
          // Nombre de la anomalía sobre pastilla: legible aunque la
          // anomalía cruce carriles, células o la rejilla. El ancho se
          // mide una sola vez por texto (caché), no por cuadro.
          const label = an.tipo.length > 34 ? `${an.tipo.slice(0, 34)}…` : an.tipo;
          ctx2d!.font = "700 11.5px system-ui, sans-serif";
          ctx2d!.textAlign = "center";
          let tw = labelWidthCache.get(label);
          if (tw == null) { tw = ctx2d!.measureText(label).width; if (labelWidthCache.size > 48) labelWidthCache.clear(); labelWidthCache.set(label, tw); }
          ctx2d!.fillStyle = darkNow ? "rgba(3,14,19,.82)" : "rgba(255,255,255,.88)";
          ctx2d!.fillRect(an.x - tw / 2 - 5, an.y + an.r + 5, tw + 10, 16);
          ctx2d!.fillStyle = darkNow ? "rgba(238,251,248,.98)" : "rgba(13,45,40,.95)";
          ctx2d!.fillText(label, an.x, an.y + an.r + 17);
        }
      }
      for (const c of world.cells) {
        const sprite = c.memT > 0 ? spriteMem : spriteCell;
        if (!sprite) continue;
        const pulse = 1 + Math.sin(c.fase) * 0.05;
        const size = 74 * (c.r / 15) * pulse;
        ctx2d!.save();
        ctx2d!.translate(c.x, c.y);
        ctx2d!.rotate(c.fase * 0.45);
        ctx2d!.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx2d!.restore();
      }
      const selIdx = selectedIdxRef.current;
      if (selIdx >= 0 && selIdx < world.cells.length) {
        const sc = world.cells[selIdx]!;
        ctx2d!.strokeStyle = darkNow ? "rgba(240,200,90,.95)" : "rgba(11,125,140,.9)";
        ctx2d!.lineWidth = 2;
        ctx2d!.beginPath(); ctx2d!.arc(sc.x, sc.y, sc.r + 7 + Math.sin(tGlobal * 4) * 1.5, 0, Math.PI * 2); ctx2d!.stroke();
      }
      for (const pa of world.particles) {
        ctx2d!.globalAlpha = Math.max(0, 1 - pa.t / pa.vida);
        ctx2d!.fillStyle = pa.color;
        ctx2d!.beginPath(); ctx2d!.arc(pa.x, pa.y, pa.r, 0, Math.PI * 2); ctx2d!.fill();
      }
      ctx2d!.globalAlpha = 1;
      for (const ring of world.rings) {
        ctx2d!.globalAlpha = Math.max(0, 0.6 - ring.t * 1.1);
        ctx2d!.strokeStyle = "#3fd8c8";
        ctx2d!.lineWidth = 2;
        ctx2d!.beginPath(); ctx2d!.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2); ctx2d!.stroke();
      }
      ctx2d!.globalAlpha = 1;
    }
    function updateHud(now: number, force = false) {
      if (!force && now - hudAt < 200) return;
      hudAt = now;
      const b = bankRef.current;
      const inField = world.anomalies.length;
      let contained = 0;
      for (const a of world.anomalies) if (a.estado === "contenida") contained++;
      const fieldStr = String(inField);
      if (hudFieldRef.current && hudCache.field !== fieldStr) { hudCache.field = fieldStr; hudFieldRef.current.textContent = fieldStr; }
      const peso = Math.min(100, b.conflictCells * 26 + inField * 9 + contained * 7 + (b.knownThreats > 0 && b.neutralizations === 0 ? 12 : 4));
      if (threatFillRef.current && hudCache.peso !== peso) {
        hudCache.peso = peso;
        threatFillRef.current.style.transform = `scaleX(${(Math.max(4, peso) / 100).toFixed(3)})`;
        threatFillRef.current.style.background = peso < 25 ? "#1d8a4e" : peso < 55 ? "#e8930c" : "#e0524a";
        if (threatValRef.current) threatValRef.current.textContent = `${peso < 25 ? "Bajo" : peso < 55 ? "Moderado" : "Alto"} · ${peso}%`;
      }
      const status = pausedRef.current
        ? "Patrulla en pausa"
        : contained > 0
          ? `${contained} contenida${contained === 1 ? "" : "s"} esperando tu «sí»`
          : inField > 0
            ? "Patrulla respondiendo"
            : "Patrulla activa · sin amenazas en el campo";
      if (hudStatusRef.current && hudCache.status !== status) { hudCache.status = status; hudStatusRef.current.textContent = status; }
    }
    function stopLoop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    }
    function loop(t: number) {
      if (!running) return;
      if (!visible || document.hidden || pausedRef.current) {
        // Frame único y a dormir: sin bucle girando en vacío.
        draw();
        updateHud(t, true);
        stopLoop();
        return;
      }
      raf = requestAnimationFrame(loop);
      let dt = (t - last) / 1000;
      last = t;
      // Calidad adaptativa: media móvil del coste real del cuadro. Si
      // se sostiene por encima de ~24 ms durante ~1 s, baja un escalón
      // (primero resolución interna; después, paquetes alternos) y
      // vuelve a medir desde el nuevo escalón — nunca oscila por un
      // tirón aislado ni sube sola a mitad de sesión.
      if (dt > 0 && dt < 0.25) {
        emaFrameMs = emaFrameMs * 0.94 + dt * 1000 * 0.06;
        if (emaFrameMs > 24 && quality < 2) {
          slowFrames++;
          if (slowFrames >= 60) {
            quality++;
            slowFrames = 0;
            emaFrameMs = 16;
            if (quality === 1) { dprScale = 0.7; buildField(); }
          }
        } else if (slowFrames > 0) slowFrames--;
      }
      if (dt > 0.25) dt = 0.25;
      if (dt > 0) {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n++; }
        if (n === 5) acc = 0;
      }
      draw();
      updateHud(t);
    }
    function startLoop() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(loop);
    }
    buildField();
    draw();
    updateHud(performance.now(), true);
    startLoop();
    kickRef.current = startLoop;
    rebuildRef.current = () => { paintBackground(); buildSprites(); draw(); updateHud(performance.now(), true); };
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) startLoop();
    }, { threshold: 0.05 });
    observer.observe(stage);
    const onVisibility = () => { if (!document.hidden) startLoop(); };
    document.addEventListener("visibilitychange", onVisibility);
    let resizeAt: ReturnType<typeof setTimeout> | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeAt) clearTimeout(resizeAt);
      resizeAt = setTimeout(() => { buildField(); draw(); updateHud(performance.now(), true); startLoop(); }, 120);
    });
    resizeObserver.observe(stage);
    return () => {
      stopLoop();
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (resizeAt) clearTimeout(resizeAt);
      kickRef.current = null;
      rebuildRef.current = null;
    };
    // Solo al montar: el mundo y el bucle viven en refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al reanudar desde el botón, el bucle vuelve a girar; al cambiar
  // el tema, fondo y sprites se repintan con la paleta activa.
  useEffect(() => { if (!paused) kickRef.current?.(); }, [paused]);
  useEffect(() => { rebuildRef.current?.(); kickRef.current?.(); }, [dark]);

  // Toque en el campo: busca la célula más cercana con un área de
  // toque generosa (34 px, pensado para el dedo en el A16). Solo
  // actualiza el estado de la ficha y la ref del anillo; el bucle de
  // animación no se entera ni se recrea.
  const tapCell = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const world = worldRef.current;
    let bestIdx = -1;
    let bestD = Number.POSITIVE_INFINITY;
    world.cells.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });
    if (bestIdx < 0 || bestD > 34) {
      selectedIdxRef.current = -1;
      setSelectedCell(null);
      rebuildRef.current?.();
      return;
    }
    const cell = world.cells[bestIdx]!;
    const heldNear = world.anomalies.some((a) => a.estado === "contenida" && Math.hypot(a.x - cell.x, a.y - cell.y) < 90);
    const activity = cell.target
      ? `persiguiendo «${cell.target.tipo}» ahora mismo`
      : cell.memT > 0
        ? "acaba de neutralizar o contener una anomalía"
        : heldNear
          ? "vigilando de cerca una anomalía contenida"
          : "patrullando el flujo de datos";
    selectedIdxRef.current = bestIdx;
    setSelectedCell({ idx: bestIdx, activity });
    rebuildRef.current?.();
  };
  const closeCellCard = () => { selectedIdxRef.current = -1; setSelectedCell(null); rebuildRef.current?.(); };
  const selBankCell = selectedCell ? bank.cells[selectedCell.idx] : undefined;
  const fastest = bank.cells.reduce<number | null>((min, c) => (c.lastResponseMs != null && (min == null || c.lastResponseMs < min) ? c.lastResponseMs : min), null);
  return (
    <div className="immune-root">
      <div className="immune-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="immune-canvas" role="img" aria-label={`Campo en vivo del sistema inmune: ${bank.knownThreats} amenazas conocidas, ${bank.neutralizations} neutralizaciones, ${bank.conflictCells} células en conflicto esperando tu palabra. Toca una célula para ver su ficha: qué error vigila, su anticuerpo y su estado`} onPointerDown={(e) => tapCell(e.clientX, e.clientY)} />
      </div>
      {/* La leyenda vive con el texto, debajo del campo: la animación
          queda limpia, sin chips ni barras encima del lienzo. */}
      <div className="immune-info">
        <div className="immune-hud">
          <span className="immune-chip">En el campo <b ref={hudFieldRef}>0</b></span>
          <span className="immune-chip">Neutralizadas <b>{bank.neutralizations}</b></span>
          <span className="immune-chip immune-chip-gold">Anticuerpos <b>{bank.knownThreats}</b></span>
          <span className="immune-chip immune-chip-status"><span ref={hudStatusRef}>Patrulla activa</span></span>
        </div>
        <div className="immune-threat">
          <span className="immune-threat-lbl">Nivel de amenaza</span>
          <div className="immune-threat-bar"><div className="immune-threat-fill" ref={threatFillRef} /></div>
          <span className="immune-threat-val" ref={threatValRef}>Bajo</span>
        </div>
        <div className="immune-legend">
          <span><i className="immune-sw immune-sw-cell" /> Célula de patrulla</span>
          <span><i className="immune-sw immune-sw-mem" /> Célula de memoria (acaba de neutralizar)</span>
          <span><i className="immune-sw immune-sw-ano" /> Anomalía (error real del banco)</span>
          <span><i className="immune-sw immune-sw-held" /> Contenida (esperando tu «sí»)</span>
          <span><i className="immune-sw immune-sw-flow" /> Flujo de datos (IPV, cuentas, RH, almacén, boletines)</span>
        </div>
        <p className="immune-note">Una <b>célula de memoria</b> guarda la firma de un error real ya corregido y su anticuerpo: si ese error vuelve, lo reconoce al instante y lo neutraliza sin repetir el diagnóstico lento. La célula verde patrulla los carriles; al neutralizar se tiñe <b>dorada</b> por un momento. Una anomalía rodeada por un anillo ámbar está <b>contenida</b>: toca un dominio sensible y no se corrige sola, espera tu «Sí». <b>Toca cualquier célula del campo</b> para ver su ficha: qué error vigila, cuál es su anticuerpo y en qué estado está.</p>
      </div>
      <div className="immune-actions">
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Reanudar la animación del sistema inmune" : "Pausar la animación del sistema inmune"} className="immune-btn">{paused ? "Reanudar" : "Pausar"}</button>
        <button type="button" onClick={() => setLabels((v) => !v)} aria-pressed={labels} aria-label="Mostrar u ocultar las etiquetas de las anomalías" className="immune-btn">Etiquetas {labels ? "activas" : "ocultas"}</button>
      </div>
      {selectedCell && (
        <div className="immune-cell-card" role="group" aria-label="Ficha de la célula tocada">
          <div className="immune-cell-card-head">
            <h4 className="immune-cell-card-title">{selBankCell ? `Célula de memoria · ${selBankCell.module}` : "Célula de patrulla"}</h4>
            <button type="button" onClick={closeCellCard} aria-label="Cerrar la ficha de la célula" className="immune-btn immune-btn-sm">Cerrar</button>
          </div>
          {selBankCell ? (
            <div className="immune-cell-card-body">
              <p><b>Qué error vigila:</b> «{selBankCell.symptoms}»{selBankCell.topic ? <> · {selBankCell.topic}</> : null}</p>
              <p><b>Su firma:</b> <span className="immune-mono">{selBankCell.cellKey}</span> — con esa firma reconoce a este error al instante cuando regresa, sin repetir el diagnóstico.</p>
              <p><b>Su anticuerpo:</b> {selBankCell.antibody || "Aún sin anticuerpo registrado."}</p>
              <p><b>Detecciones:</b> {selBankCell.detections} registrada{selBankCell.detections === 1 ? "" : "s"} en el banco de esta copia.</p>
              {selBankCell.cause && <p><b>Causa conocida:</b> {selBankCell.cause}</p>}
              <p><b>Su estado:</b> {selBankCell.status === "conflicto" ? "en conflicto en el banco — contenida, esperando tu «Sí» para actuar" : "activa en el banco de memoria"}. En el campo está {selectedCell.activity}.</p>
              <p><b>Neutralizaciones:</b> {selBankCell.neutralizations} · <b>veces que el error volvió (recurrencias):</b> {selBankCell.recurrences}{selBankCell.lastNeutralizedAt ? <> · <b>última neutralización:</b> {fmtFull(selBankCell.lastNeutralizedAt.slice(0, 10))}</> : " · aún no neutralizó su primera anomalía"}{selBankCell.lastResponseMs != null ? <> · su respuesta más reciente tardó {selBankCell.lastResponseMs} ms</> : null}</p>
              {selBankCell.requiresApproval && <p><b>Ojo:</b> este anticuerpo toca un dominio sensible (dinero, cuentas, IPV, ADN o permisos): nunca se aplica solo, siempre espera tu «Sí».</p>}
            </div>
          ) : (
            <div className="immune-cell-card-body">
              <p>Esta célula patrulla los carriles del flujo — IPV, cuentas, RH, almacén y boletines — buscando anomalías que perseguir. En el campo está {selectedCell.activity}.</p>
              <p>Todavía no representa a una célula del banco de memoria: cuando un error nuevo se corrige y su corrección queda verificada, nace su célula de memoria con firma y anticuerpo propios, y una patrulla pasa a representarla aquí con su ficha completa.</p>
            </div>
          )}
        </div>
      )}
      {log.length > 0 && (
        <>
          <h4 className="immune-h4">Registro en vivo</h4>
          <ul className="immune-log" aria-label="Registro en vivo del sistema inmune">
            {log.map((entry) => (
              <li key={entry.id}>
                <time>{entry.time}</time>
                <span className={`immune-tag immune-tag-${entry.kind}`}>{entry.tag}</span>
                <span className="immune-log-msg">{entry.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="immune-h4">Banco de memoria</h4>
      {bank.cells.length > 0 ? (
        <div className="immune-bank">
          {bank.cells.slice(0, 8).map((cell) => (
            <span key={cell.cellKey} className="immune-ab">
              <span className="immune-ab-label">{cell.symptoms}</span>
              <b>{cell.neutralizations}</b>
              {cell.status === "conflicto" ? <em>En conflicto</em> : cell.requiresApproval ? <em>Requiere tu «sí»</em> : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="immune-empty">Todavía sin anticuerpos: la primera neutralización real crea la primera célula de memoria.</p>
      )}
      <div className="immune-stats">
        <div className="immune-stat"><b>{bank.knownThreats + bank.conflictCells}</b><span>células en el banco</span></div>
        <div className="immune-stat"><b>{bank.conflictCells}</b><span>en conflicto, por tu palabra</span></div>
        <div className="immune-stat"><b>{fastest != null ? `${fastest} ms` : "—"}</b><span>respuesta más rápida</span></div>
      </div>
    </div>
  );
}
