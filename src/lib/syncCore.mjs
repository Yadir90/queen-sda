// Queen SDA — núcleo de SINCRONIZACIÓN DERIVADA del IPV y de RH.
// Módulo SIN dependencias, compartido por la app (Vite) y por la prueba
// scripts/verify-rh-sync.mjs (Node). Es el puerto fiel de la lógica del
// sistema original (server/src/actions.ts del SDA de Muse):
//
//  - «Foto» de cuentas de un día: su Desglose (fondos.cuentasDetalle)
//    agregado por persona, con su «ok» (pagada) y su «gasto» (salida).
//  - Clasificación de cada fila: marca «gasto» en Observaciones > lo
//    aprendido/decidido por el dueño > heurística de persona (nombre de
//    pila reconocible, persona de la casa o trabajador de RH). Lo que
//    no se reconoce queda «pendiente» y NO crea cuenta ni gasto.
//  - Sincronización de cuentas: identidad estable «fecha::persona
//    resuelta»; una «Pagada» no se toca jamás; reimportar el mismo día
//    re-sincroniza sin duplicar; la cuenta pendiente que ninguna foto
//    sostiene sale del archivo (salvo que tenga abonos registrados).
//  - Identidad de personas: alias aprendidos → nombre oficial del
//    registro de RH → patrón de nombre único (diminutivo/apodo/error
//    de una letra). «Nelson» = «Nelsito» (la misma persona); «Nelson
//    gordo» es otra. Lo resuelto por patrón queda APRENDIDO.
//  - Gastos automáticos «ipv-cuentas» desde las filas clasificadas
//    gasto, con sourceKey estable «fecha::concepto», y gasto «auto-rh»
//    de cada nómina registrada (día de pago, día 16).
//  - RH: registro único de trabajadores (fusión segura de duplicados,
//    relleno solo de campos vacíos), línea continua de marcas desde
//    las fotos de RH (la foto solo certifica hasta su propio día; la
//    más reciente manda), ciclos exactos de 15 días desde el ancla y
//    nómina del ciclo leída de la foto de cierre (nunca del ciclo
//    anterior).
//
// El IPV es la fuente de verdad: este módulo nunca ajusta cifras del
// IPV; solo deriva cuentas, gastos y nómina de lo que el IPV trae.

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round = (v) => Math.round(num(v))

// ============================================================
// Fechas ISO (yyyy-mm-dd), aritmética sin husos horarios.
// ============================================================

export function addDaysISO(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + n)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function diffDays(a, b) {
  const da = new Date(`${String(a).slice(0, 10)}T12:00:00`).getTime()
  const db = new Date(`${String(b).slice(0, 10)}T12:00:00`).getTime()
  return Math.round((db - da) / 86400000)
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function fmtFechaLarga(iso) {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(iso ?? '')
  return `${d} de ${MESES[m - 1]} de ${y}`
}

// ============================================================
// Identidad de personas (puerto del original).
// ============================================================

export function normalizeLoose(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function clientKeyOf(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ')
}

/** «Nelson» y «Nelsito» son la misma persona (mandato del dueño);
 *  «Nelson gordo» es otra y su clave no se toca. */
export function canonicalPersonKey(storedKey, fallbackName = '') {
  const key = clientKeyOf(storedKey || mainNameOf(fallbackName))
  return key === 'nelson' ? 'nelsito' : key
}

const DASH_SPLIT = /[-–—]/
export function mainNameOf(client) {
  return String(client ?? '').split(DASH_SPLIT)[0].trim()
}
export function referenciaOf(client) {
  const raw = String(client ?? '')
  const idx = raw.search(DASH_SPLIT)
  if (idx < 0) return ''
  return raw.slice(idx + 1).trim().replace(/\s+/g, ' ')
}

/** Persona de la casa (registro aparte): Dayami/Daya, Alejandro, Jesús. */
export function personaOf(clientKeyOrName) {
  const main = clientKeyOf(mainNameOf(String(clientKeyOrName ?? '')))
  if (!main) return 'general'
  const first = main.split(' ')[0]
  if (first === 'daya' || first === 'dayami') return 'dayami'
  if (first === 'alejandro') return 'alejandro'
  if (first === 'jesus') return 'jesus'
  return 'general'
}

export function firstNameKeyOf(name) {
  return clientKeyOf(mainNameOf(String(name ?? ''))).split(' ')[0] ?? ''
}

/** Dayami y Jesús son Dirección: ficha sí, nómina nunca. */
export function isDirectionPerson(nameOrKey) {
  const first = firstNameKeyOf(nameOrKey)
  return first === 'dayami' || first === 'daya' || first === 'jesus'
}

function oneEditApart(a, b) {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false
  if (a === b) return true
  if (a.length === b.length) {
    let differences = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++differences > 1) return false
    }
    return differences === 1
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue }
    if (skipped) return false
    skipped = true
    j++
  }
  return true
}

function diminutiveForms(first) {
  const forms = [first]
  for (const suffix of ['cito', 'cita', 'ito', 'ita']) {
    if (first.length > suffix.length + 2 && first.endsWith(suffix)) forms.push(first.slice(0, -suffix.length))
  }
  return forms
}

/** Pares que el dueño confirmó DISTINTOS aunque difieran en una letra. */
const BUILTIN_DISTINCT_FIRST_NAME_PAIRS = new Set(['geidy|leidy'])
export function isBuiltinDistinctPair(aKey, bKey) {
  const fa = firstNameKeyOf(aKey)
  const fb = firstNameKeyOf(bKey)
  if (!fa || !fb || fa === fb) return false
  return BUILTIN_DISTINCT_FIRST_NAME_PAIRS.has([fa, fb].sort().join('|'))
}

/** ¿Dos identidades parecen la misma persona? (puerto conservador del
 *  original: mismo nombre, apodo/diminutivo, o error de una letra con
 *  la misma inicial y apellidos compatibles). */
export function personNameSimilarity(aKey, bKey) {
  if (!aKey || !bKey || aKey === bKey) return { similar: false, reason: '' }
  const firstA = aKey.split(' ')[0] ?? ''
  const firstB = bKey.split(' ')[0] ?? ''
  if (!firstA || !firstB) return { similar: false, reason: '' }
  if (BUILTIN_DISTINCT_FIRST_NAME_PAIRS.has([firstA, firstB].sort().join('|'))) return { similar: false, reason: '' }
  let reason = ''
  if (firstA === firstB) reason = 'mismo nombre'
  else if ((firstA.length >= 4 && firstB.startsWith(firstA)) || (firstB.length >= 4 && firstA.startsWith(firstB))) reason = 'diminutivo o apodo'
  else {
    const formsA = diminutiveForms(firstA)
    const formsB = diminutiveForms(firstB)
    const dimHit = formsA.some((f) => f !== firstA && (f === firstB || formsB.includes(f))) || formsB.some((f) => f !== firstB && f === firstA)
      || formsA.some((f) => f.length >= 4 && f !== firstA && oneEditApart(f, firstB)) || formsB.some((f) => f.length >= 4 && f !== firstB && oneEditApart(f, firstA))
    if (dimHit) reason = 'diminutivo o apodo'
    else if (firstA.length >= 5 && firstB.length >= 5 && oneEditApart(firstA, firstB)) {
      if (firstA[0] !== firstB[0]) return { similar: false, reason: '' }
      const lastA = aKey.split(' ').filter(Boolean).pop() ?? ''
      const lastB = bKey.split(' ').filter(Boolean).pop() ?? ''
      const onlyA = (aKey.split(' ').length > 1) !== (bKey.split(' ').length > 1)
      if (onlyA && lastA && lastB) { /* una sola trae apellido: no basta */ }
      if ((lastA === '') !== (lastB === '')) return { similar: false, reason: '' }
      reason = 'posible error de escritura'
    } else return { similar: false, reason: '' }
  }
  const partsA = aKey.split(' ').filter(Boolean)
  const partsB = bKey.split(' ').filter(Boolean)
  const lastA = partsA.length > 1 ? partsA[partsA.length - 1] : ''
  const lastB = partsB.length > 1 ? partsB[partsB.length - 1] : ''
  if (lastA && lastB && lastA !== lastB && !oneEditApart(lastA, lastB)) return { similar: false, reason: '' }
  return { similar: true, reason }
}

/** Si el nombre de una cuenta corresponde a un trabajador del registro
 *  de RH, su clave oficial: el registro manda sobre cualquier variante. */
export function workerKeyForAccount(accountClient, workers) {
  const accountKey = clientKeyOf(mainNameOf(String(accountClient ?? '')))
  if (!accountKey) return null
  const exact = workers.find((w) => canonicalPersonKey(w.key, w.nombre) === accountKey)
  if (exact) return canonicalPersonKey(exact.key, exact.nombre)
  const first = firstNameKeyOf(accountClient)
  if (!first) return null
  // Nelson/Nelsito: la misma persona (mandato del dueño, unificado el
  // 2026-10-18); su identidad oficial es la ficha de RH. «Nelson
  // gordo» es OTRA persona y jamás entra por esta vía.
  if ((first === 'nelson' || first === 'nelsito') && !accountKey.startsWith('nelson gordo')) {
    const worker = workers.find((w) => firstNameKeyOf(w.nombre) === 'nelson')
    if (worker) {
      const workerKey = canonicalPersonKey(worker.key, worker.nombre)
      const extra = accountKey.split(' ').slice(1).filter(Boolean)
      const compatible = extra.length === 0 || extra.some((t) => workerKey.split(' ').includes(t))
      if (compatible) return workerKey
    }
    return null
  }
  const candidates = new Set(
    workers
      .filter((w) => firstNameKeyOf(w.nombre) === first)
      .map((w) => canonicalPersonKey(w.key, w.nombre))
      .filter(Boolean),
  )
  if (candidates.size === 1) return [...candidates][0] ?? null
  if (candidates.size > 1 || first.length < 5) return null
  const nearCandidates = new Set(
    workers
      .filter((w) => oneEditApart(first, firstNameKeyOf(w.nombre)))
      .map((w) => canonicalPersonKey(w.key, w.nombre))
      .filter(Boolean),
  )
  return nearCandidates.size === 1 ? ([...nearCandidates][0] ?? null) : null
}

export function workerOfficialIdentity(accountClient, workers) {
  const key = workerKeyForAccount(accountClient, workers)
  if (!key) return null
  const worker = workers.find((w) => canonicalPersonKey(w.key, w.nombre) === key)
  return worker ? { key, display: worker.nombre } : null
}

/** Identidad final: normalización + Nelson→Nelsito + alias aprendidos.
 *  `aliases` es un objeto plano { aliasKey: {canonicalKey, canonicalDisplay} }. */
export function resolvePersonIdentity(rawKeyOrName, aliases) {
  const base = canonicalPersonKey(rawKeyOrName, rawKeyOrName)
  const hit = aliases ? aliases[base] : undefined
  if (hit && hit.canonicalKey && hit.canonicalKey !== base) {
    return { key: hit.canonicalKey, display: hit.canonicalDisplay || null, viaAlias: true }
  }
  return { key: base, display: null, viaAlias: false }
}

// ============================================================
// Observaciones del Desglose: «ok» = pagada · «gasto» = salida.
// ============================================================

export function esObservacionOk(obs) {
  return normalizeLoose(String(obs ?? '')).replace(/[^a-z0-9 ]/g, '').trim() === 'ok'
}

export function esObservacionGasto(obs) {
  const tokens = normalizeLoose(String(obs ?? '')).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return tokens.includes('gasto') || tokens.includes('gastos')
}

export function isAnimacionConcept(raw) {
  return normalizeLoose(raw).split(/[^a-zñ]+/).includes('animacion')
}

/** Concepto limpio para el gasto: «cogimos 200 de la caja para
 *  Plátano» → «Plátano». */
export function conceptFromCuentasText(raw) {
  let t = String(raw ?? '').trim().replace(/\s+/g, ' ')
  const para = t.match(/\bpara\s+(.+)$/i)
  if (para?.[1]) t = para[1].trim()
  t = t
    .replace(/^(se\s+)?(cogimos|cogi[oó]|compramos|compr[eé]|compr[oó]|gastamos|gast[oó]|sacamos|sac[oó]|retiramos|retir[oó])\b[^a-záéíóúñ]*?(\bde\s+la\s+caja\b)?/i, '')
    .replace(/\bde\s+la\s+caja\b/gi, '')
    .replace(/\bde\s+caja\b/gi, '')
    .replace(/^\W+|\W+$/g, '')
    .trim()
  if (!t) t = String(raw ?? '').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export const GENERAL_DEPT = 'General / todo el negocio'

export function deptForCuentasConcept(concept, rawName) {
  const n = normalizeLoose(`${concept} ${rawName}`)
  const has = (...words) => words.some((w) => new RegExp(`\\b${w}\\b`).test(n))
  if (has('papel', 'sanitario', 'higienico', 'servilleta', 'detergente', 'jabon', 'cloro', 'lejia', 'desinfectante', 'limpieza', 'escoba', 'trapeador', 'fregona', 'ambientador', 'insecticida', 'toalla', 'bolsa', 'rollo')) return GENERAL_DEPT
  if (has('cerveza', 'ron', 'whisky', 'vodka', 'vino', 'licor', 'ginebra', 'tequila', 'crema', 'sidra', 'espumoso', 'cervezas', 'rones')) return 'Bebidas alcohólicas'
  if (has('refresco', 'jugo', 'agua', 'malta', 'energizante', 'soda', 'limonada', 'batido')) return 'Bebidas no alcohólicas'
  if (has('pizza', 'pizzas')) return 'Pizzas'
  if (has('mojito', 'daiquiri', 'coctel', 'cantina', 'cubalibre')) return 'Cantina'
  if (has('aceite', 'platano', 'arroz', 'harina', 'pollo', 'carne', 'cerdo', 'pescado', 'camaron', 'langosta', 'huevo', 'leche', 'queso', 'pan', 'verdura', 'vianda', 'papa', 'boniato', 'yuca', 'sal', 'azucar', 'frijol', 'pasta', 'salsa', 'condimento', 'marisco', 'mariscos', 'atun', 'jamon', 'salchicha')) return 'Elaboración'
  return GENERAL_DEPT
}

export function categoryForCuentasConcept(concept, rawName) {
  if (isAnimacionConcept(concept) || isAnimacionConcept(rawName)) return 'Salida · Animación'
  const n = normalizeLoose(`${concept} ${rawName}`)
  if (/\b(papel|sanitario|higienico|servilleta|detergente|jabon|cloro|lejia|desinfectante|limpieza|escoba|trapeador|fregona|toalla)\b/.test(n)) return 'Salida · Limpieza'
  return 'Salida de caja'
}

// ============================================================
// Foto de cuentas de un día y clasificación de sus filas.
// ============================================================

/** Agrega el Desglose de un día por persona (clientKey del nombre
 *  completo): suma importes y funde sus marcas «ok»/«gasto». Una fila
 *  sin nombre, o con saldo 0 sin «ok», no es una cuenta. */
export function photoFromDay(day) {
  const detalle = Array.isArray(day?.fondos?.cuentasDetalle) ? day.fondos.cuentasDetalle : null
  if (!detalle) return null
  const byKey = new Map()
  for (const c of detalle) {
    const client = String(c?.nombre ?? '').trim()
    const amount = round(c?.saldo)
    const observacion = typeof c?.observacion === 'string' ? c.observacion : ''
    const paidOk = esObservacionOk(observacion)
    const gastoObs = esObservacionGasto(observacion)
    if (!client || (amount === 0 && !paidOk)) continue
    // Clave canónica de la foto (como en el original: «Nelson» se
    // guarda ya como «nelsito»; «Nelson gordo» no se toca).
    const key = canonicalPersonKey(clientKeyOf(client), client)
    if (!key) continue
    const cur = byKey.get(key)
    if (cur) {
      cur.amount += amount
      cur.paidOk = cur.paidOk || paidOk
      cur.gastoObs = cur.gastoObs || gastoObs
    } else {
      byKey.set(key, { client, clientKey: key, amount, paidOk, gastoObs })
    }
  }
  const items = [...byKey.values()]
  return { date: String(day.date), total: items.reduce((s, i) => s + i.amount, 0), items }
}

const FIRST_NAMES = new Set([
  'alejandro', 'alexander', 'jesus', 'jose', 'juan', 'carlos', 'luis', 'miguel', 'jorge',
  'pedro', 'pablo', 'manuel', 'francisco', 'antonio', 'rafael', 'raul', 'ramon', 'rene',
  'roberto', 'ricardo', 'ruben', 'sergio', 'daniel', 'david', 'dayami', 'daya', 'neivi',
  'yadir', 'ismael', 'nelson', 'nelsito', 'heily', 'monica', 'yadiris', 'rache', 'claudia',
  'geidy', 'yainelis', 'daniely', 'dairelis', 'deyanira', 'yalenny', 'idamay', 'selmira',
  'jean', 'alain', 'diana', 'rosa', 'maria', 'ana', 'carmen', 'julia', 'lucia', 'elena',
  'martha', 'marta', 'isabel', 'teresa', 'laura', 'sofia', 'valentina', 'camila', 'andrea',
  'fernanda', 'gabriela', 'patricia', 'natalia', 'yusimi', 'yoana', 'ileana', 'mariela',
  'lisandra', 'yanelis', 'damaris', 'odalis', 'mileidis', 'yuneisy', 'aracelis', 'beatriz',
  'ernesto', 'orlando', 'lazaro', 'yoel', 'yordanis', 'yunier', 'osvaldo', 'armando',
  'eduardo', 'fernando', 'humberto', 'wilfredo', 'reinier', 'leonardo', 'adrian', 'alaincito',
  'alexide', 'erismelky', 'alberto', 'alfredo', 'andres', 'angel', 'anibal', 'arturo',
  'bernardo', 'braulio', 'cesar', 'claudio', 'cristobal', 'dario', 'diego', 'edgar',
  'edwin', 'elias', 'eliseo', 'emilio', 'enrique', 'esteban', 'eugenio', 'fabian',
  'federico', 'felipe', 'felix', 'fidel', 'flavio', 'gabriel', 'gerardo', 'german',
  'gilberto', 'gonzalo', 'gregorio', 'guillermo', 'gustavo', 'hector', 'henry', 'hugo',
  'ignacio', 'ivan', 'jaime', 'javier', 'jeremias', 'joaquin', 'jonathan', 'josue',
  'juan carlos', 'julio', 'leandro', 'leonel', 'leopoldo', 'lorenzo', 'lucas', 'luciano',
  'marcelo', 'marco', 'marcos', 'mariano', 'mario', 'martin', 'mateo', 'mauricio',
  'maximo', 'melvin', 'nestor', 'nicolas', 'noel', 'norberto', 'octavio',
  'omar', 'oscar', 'osmani', 'pascual', 'patricio', 'paul', 'reinaldo',
  'renato', 'rey', 'reynaldo', 'rigoberto', 'robert', 'robinson', 'rodolfo', 'rodrigo',
  'rogelio', 'rolando', 'roman', 'ronald', 'ronaldo', 'rosendo', 'rudys', 'rufino',
  'salvador', 'samuel', 'santiago', 'santo', 'santos', 'saul', 'sebastian', 'segundo',
  'serafin', 'silvio', 'simon', 'sixto', 'teodoro', 'tomas', 'ubaldo', 'ulises', 'urbano',
  'valentin', 'valerio', 'vicente', 'victor', 'victoriano', 'vidal', 'vladimir', 'waldo',
  'walter', 'wander', 'wilber', 'wilbert', 'wilden', 'wilian', 'wilkin',
  'william', 'willie', 'willis', 'willy', 'wilmer', 'wilnel', 'wilquin', 'wilson',
  'wilton', 'wilver', 'wilvin', 'wilvis', 'wilvor', 'wilyer', 'wilyes', 'wilyn', 'wily',
])

/** Clasificador automático (sin memoria): SOLO decide «cuenta» cuando
 *  la fila trae nombre de persona reconocible; NUNCA manda una fila a
 *  «Gastos» por palabras del concepto (esa vía quedó retirada por el
 *  dueño): el gasto automático solo nace de la marca «gasto» en
 *  Observaciones o de lo aprendido/decidido por el dueño. */
export function classifyCuentasHeuristic(raw) {
  const norm = normalizeLoose(raw)
  if (!norm) return 'pendiente'
  const tokens = norm.split(/[^a-zñ0-9]+/).filter((t) => Boolean(t) && !/^\d+$/.test(t))
  if (tokens.length === 0) return 'pendiente'
  if (personaOf(raw) !== 'general') return 'cuenta'
  const main = mainNameOf(raw)
  const mainTokens = normalizeLoose(main).split(/[^a-zñ]+/).filter(Boolean)
  const firstMain = mainTokens[0] ?? ''
  if (firstMain && FIRST_NAMES.has(firstMain)) return 'cuenta'
  return 'pendiente'
}

/**
 * Construye las entradas de «Cuentas» de TODOS los días, con su
 * clasificación final. Prioridad (la del original):
 *   decisión del dueño para esa entrada (overrides) >
 *   marca «gasto» en Observaciones >
 *   concepto aprendido (learnedKinds) >
 *   heurística (con empujón de persona ya conocida como deudora).
 * `knownPersons`: Set de claves canónicas ya vistas como deudoras.
 */
export function buildCuentasEntries(days, { learnedKinds = {}, overrides = {}, knownPersons = new Set(), suppressed = [] } = {}) {
  const suppressedSet = new Set(suppressed)
  const photos = []
  for (const day of days ?? []) {
    const photo = photoFromDay(day)
    if (photo) photos.push(photo)
  }
  photos.sort((a, b) => a.date.localeCompare(b.date))
  const out = []
  for (const photo of photos) {
    for (const item of photo.items) {
      const rawName = item.client
      const concept = conceptFromCuentasText(rawName)
      const conceptKey = normalizeLoose(concept)
      const rawKey = normalizeLoose(rawName)
      let heuristic = classifyCuentasHeuristic(rawName)
      if (heuristic === 'pendiente' && knownPersons.has(item.clientKey)) heuristic = 'cuenta'
      const learnedKind = learnedKinds[conceptKey] ?? learnedKinds[rawKey] ?? null
      const override = overrides[`${photo.date}::${item.clientKey}`] ?? null
      const marcadoGasto = item.gastoObs ? 'gasto' : null
      const classification = override ?? marcadoGasto ?? learnedKind ?? heuristic
      if (classification === 'cuenta' && (suppressedSet.has(`${photo.date}::${item.clientKey}`) || suppressedSet.has(item.clientKey))) continue
      out.push({
        date: photo.date,
        entryKey: item.clientKey,
        rawName,
        amount: item.amount,
        concept,
        classification,
        defaultClassification: marcadoGasto ?? learnedKind ?? heuristic,
        overridden: override != null,
        learned: override == null && marcadoGasto == null && learnedKind != null,
        needsDecision: classification === 'pendiente',
        sourceKey: `${photo.date}::${item.clientKey}`,
        paidOk: item.paidOk,
        gastoObs: item.gastoObs,
        persona:
          personaOf(rawName) !== 'general'
          || knownPersons.has(item.clientKey)
          || heuristic === 'cuenta'
          || learnedKind === 'cuenta'
          || override === 'cuenta',
      })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rawName.localeCompare(b.rawName)))
}

// ============================================================
// Sincronización derivada: cuentas, gastos del IPV y de nómina.
// ============================================================

const DETAIL_IPV = 'Cuenta del IPV, registrada sola al importar el Excel'
const DETAIL_IPV_OK = 'Pagada al importar: el IPV traía «ok» en Observaciones (cuenta del IPV)'

function categoryForAccount(clientDisplay, clientKey, workers) {
  if (personaOf(clientDisplay) !== 'general') return 'administrativo'
  if (workerKeyForAccount(clientDisplay, workers)) return 'trabajador'
  // Noel entra como chef: cualquier cuenta suya es de trabajador aunque
  // su ficha de RH aún no exista (regla confirmada del original).
  if (firstNameKeyOf(clientDisplay) === 'noel') return 'trabajador'
  return 'cliente'
}

/**
 * Re-sincroniza TODO lo derivado de las fotos de los días:
 * cuentas del IPV en `receivables`, gastos «ipv-cuentas» y gastos
 * «auto-rh» de las nóminas registradas en `expenses`.
 *
 * state: {
 *   days, receivables, localPayments, expenses, workers,
 *   aliases, learnedKinds, cuentasOverrides, suppressedEntries,
 *   payrollHistory,
 *   accountSyncDates?: string[] — fechas cuyos Desgloses sincronizan
 *     cuentas en esta pasada (la del día importado por Excel). Si se
 *     pasa una lista (aunque sea vacía), las cuentas de OTROS días no
 *     se crean, actualizan ni borran: así una importación de respaldo
 *     deja las cuentas EXACTAMENTE como vienen (el original sincroniza
 *     las cuentas día a día, al importar cada IPV; los gastos y el
 *     registro de RH sí se derivan de todo el conjunto). Sin la
 *     opción, la sincronización de cuentas es global.
 * }
 * Devuelve el estado derivado nuevo + los cambios (ids creados/
 * actualizados/borrados) para que cada backend persista lo suyo.
 * Es IDEMPOTENTE: correrla dos veces sobre el mismo estado no cambia
 * nada la segunda vez.
 */
export function syncDerivedData(state) {
  const accountSyncDates = Array.isArray(state.accountSyncDates) ? new Set(state.accountSyncDates) : null
  const accountDateLive = (date) => !accountSyncDates || accountSyncDates.has(date)
  const days = [...(state.days ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const workers = state.workers ?? []
  // Alias incorporado por mandato del dueño (unificación del
  // 2026-10-18): «Nelsito» ES Nelson Aliesky Sánchez Morales, el
  // trabajador de RH. El respaldo no exporta la tabla de alias del
  // original, así que este viaja en el código; solo se aplica si la
  // ficha de RH existe, y un alias aprendido del dueño manda sobre él.
  const builtinAliases = {}
  if (workers.some((w) => canonicalPersonKey(w.key, w.nombre) === 'nelson aliesky sanchez morales')) {
    builtinAliases.nelsito = { canonicalKey: 'nelson aliesky sanchez morales', canonicalDisplay: 'Nelson Aliesky Sánchez Morales' }
  }
  const aliases = { ...builtinAliases, ...(state.aliases ?? {}) }
  const learnedKinds = state.learnedKinds ?? {}
  const overrides = state.cuentasOverrides ?? {}
  const suppressed = state.suppressedEntries ?? []
  const payrollHistory = state.payrollHistory ?? []

  // Personas ya conocidas como deudoras (puerto de loadKnownPersonKeys
  // del original): cuentas del IPV (clave canónica y forma visible),
  // cuentas manuales (canónica) y trabajadores (canónica y SOLO el
  // primer nombre: «Ebelardo» o «Yamilka» a secas ya son persona).
  const knownPersons = new Set()
  for (const r of state.receivables ?? []) {
    knownPersons.add(canonicalPersonKey(r.clientKey, r.client))
    if (r.origin === 'ipv') knownPersons.add(clientKeyOf(r.client))
  }
  for (const w of workers) {
    knownPersons.add(canonicalPersonKey(w.key, w.nombre))
    const first = firstNameKeyOf(w.nombre)
    if (first) knownPersons.add(first)
  }
  for (const t of Object.values(aliases)) knownPersons.add(t.canonicalKey)

  const entries = buildCuentasEntries(days, { learnedKinds, overrides, knownPersons, suppressed })
  const suppressedSet = new Set(suppressed)

  // ---- Cuentas deseadas (solo clasificación «cuenta») ----
  const desiredRaw = new Map()
  for (const e of entries) {
    if (e.classification !== 'cuenta') continue
    if (suppressedSet.has(e.sourceKey) || suppressedSet.has(e.entryKey)) continue
    desiredRaw.set(e.sourceKey, {
      entryKey: e.sourceKey,
      clientKey: e.entryKey,
      client: e.rawName,
      date: e.date,
      amount: e.amount,
      paidOk: e.paidOk,
    })
  }

  // ---- Resolución de identidad (alias → RH oficial → patrón único) ----
  const personRegistry = new Map()
  const registryAdd = (key, display) => { if (key && !personRegistry.has(key)) personRegistry.set(key, display) }
  for (const r of state.receivables ?? []) {
    const resolved = resolvePersonIdentity(r.clientKey ?? r.client, aliases)
    registryAdd(resolved.key, resolved.display ?? r.client)
  }
  for (const w of workers) registryAdd(canonicalPersonKey(w.key, w.nombre), w.nombre)

  const newAliases = {}
  const learnAlias = (aliasKey, aliasDisplay, canonicalKey, canonicalDisplay) => {
    if (!aliasKey || !canonicalKey || aliasKey === canonicalKey) return
    if (aliases[aliasKey]?.canonicalKey === canonicalKey) return
    aliases[aliasKey] = { canonicalKey, canonicalDisplay }
    newAliases[aliasKey] = { canonicalKey, canonicalDisplay }
  }

  const resolvedDesired = new Map()
  for (const a of desiredRaw.values()) {
    let resolved = resolvePersonIdentity(a.clientKey, aliases)
    let display = resolved.display
    if (!resolved.viaAlias) {
      const worker = workerOfficialIdentity(a.client, workers)
      if (worker && worker.key !== resolved.key) {
        learnAlias(resolved.key, a.client, worker.key, worker.display)
        resolved = { key: worker.key, display: worker.display, viaAlias: true }
        display = worker.display
      }
    }
    if (!resolved.viaAlias) {
      const matches = new Map()
      for (const [knownKey, knownDisplay] of personRegistry) {
        if (knownKey === resolved.key) continue
        if (isBuiltinDistinctPair(resolved.key, knownKey)) continue
        if (personNameSimilarity(resolved.key, knownKey).similar) matches.set(knownKey, knownDisplay)
      }
      if (matches.size === 1) {
        const [knownKey, knownDisplay] = [...matches.entries()][0]
        learnAlias(resolved.key, a.client, knownKey, knownDisplay)
        resolved = { key: knownKey, display: knownDisplay, viaAlias: true }
        display = knownDisplay
      }
    }
    if (resolved.key !== a.clientKey) {
      a.clientKey = resolved.key
      a.entryKey = `${a.date}::${resolved.key}`
      if (display) a.client = display
    } else if (display && display !== a.client) {
      a.client = display
    }
    registryAdd(resolved.key, a.client)
    // Dos filas del mismo día que resuelven a la misma persona son la
    // misma cuenta de ese día: se compila una sola vez (la primera).
    if (!resolvedDesired.has(a.entryKey)) resolvedDesired.set(a.entryKey, a)
  }
  const desired = resolvedDesired

  // ---- Índice de cuentas del IPV ya archivadas, por identidad ----
  const resolveStoredKey = (row) => {
    const stored = canonicalPersonKey(row.clientKey, row.client ?? '')
    const resolved = resolvePersonIdentity(stored, aliases)
    if (resolved.viaAlias) return resolved.key
    const worker = workerOfficialIdentity(String(row.client ?? ''), workers)
    return worker && worker.key !== resolved.key ? worker.key : resolved.key
  }
  const receivables = (state.receivables ?? []).map((r) => ({ ...r, payments: [...(r.payments ?? [])] }))
  const byIdentity = new Map()
  for (const row of receivables) {
    if (row.origin !== 'ipv') continue
    const ek = row.entryKey ? String(row.entryKey) : `${row.date}::${resolveStoredKey(row)}`
    if (!byIdentity.has(ek)) byIdentity.set(ek, row)
    // También bajo su identidad resuelta (nombre corto vs oficial).
    const resolvedEk = `${row.date}::${resolveStoredKey(row)}`
    if (!byIdentity.has(resolvedEk)) byIdentity.set(resolvedEk, row)
  }

  // Gemelas manuales: misma persona, fecha e importe → la manual manda.
  const manualTwinKeys = new Set()
  for (const r of receivables) {
    if (r.origin === 'ipv') continue
    const resolved = resolvePersonIdentity(r.clientKey ?? r.client, aliases)
    manualTwinKeys.add(`${resolved.key}|${r.date}|${round(r.originalAmount ?? r.amount)}`)
  }

  const localPayments = (state.localPayments ?? []).map((p) => ({ ...p }))
  const localByRec = new Map()
  for (const p of localPayments) {
    const arr = localByRec.get(p.receivableId) ?? []
    arr.push(p)
    localByRec.set(p.receivableId, arr)
  }

  const createdReceivableIds = []
  const updatedReceivableIds = []
  const deletedReceivableIds = []
  const markUpdated = (row) => { if (!createdReceivableIds.includes(row.id) && !updatedReceivableIds.includes(row.id)) updatedReceivableIds.push(row.id) }

  const newReceivable = (a) => {
    const persona = personaOf(a.client)
    const rec = {
      id: `ipv::${a.entryKey}`,
      client: a.client,
      clientKey: a.clientKey,
      category: categoryForAccount(a.client, a.clientKey, workers),
      date: a.date,
      originalAmount: a.amount,
      amount: a.amount,
      saldoBase: a.amount,
      totalAbonadoBase: 0,
      payments: [],
      status: 'pendiente',
      paidDate: null,
      paymentMethod: null,
      closeKind: null,
      detail: DETAIL_IPV,
      origin: 'ipv',
      entryKey: a.entryKey,
      persona,
      registro: persona === 'general' ? 'general' : 'aparte',
    }
    if (a.paidOk) {
      rec.status = 'pagada'
      rec.saldoBase = 0
      rec.totalAbonadoBase = a.amount
      rec.paidDate = a.date
      rec.detail = DETAIL_IPV_OK
    }
    return rec
  }

  for (const a of desired.values()) {
    if (!accountDateLive(a.date)) continue
    const existing = byIdentity.get(a.entryKey)
    if (!existing && manualTwinKeys.has(`${a.clientKey}|${a.date}|${round(a.amount)}`)) continue
    if (!existing) {
      if (a.paidOk && a.amount <= 0) continue // «ok» sin importe: nada que constatar
      const rec = newReceivable(a)
      receivables.push(rec)
      byIdentity.set(a.entryKey, rec)
      createdReceivableIds.push(rec.id)
      continue
    }
    if (existing.status === 'pagada') {
      // Manda el pago registrado: no se toca importe, fecha ni forma;
      // solo se unifica la identidad si la resuelta difiere.
      if (existing.client !== a.client || existing.clientKey !== a.clientKey || existing.entryKey !== a.entryKey) {
        existing.client = a.client
        existing.clientKey = a.clientKey
        existing.entryKey = a.entryKey
        markUpdated(existing)
      }
      continue
    }
    if (a.paidOk) {
      const totalPagado = a.amount > 0 ? a.amount : round(existing.originalAmount ?? existing.amount)
      existing.client = a.client
      existing.clientKey = a.clientKey
      existing.entryKey = a.entryKey
      existing.originalAmount = totalPagado
      existing.amount = totalPagado
      existing.saldoBase = 0
      existing.totalAbonadoBase = totalPagado
      existing.status = 'pagada'
      existing.paidDate = a.date
      existing.paymentMethod = null
      existing.detail = DETAIL_IPV_OK
      markUpdated(existing)
      continue
    }
    // Pendiente: el importe manda la foto; el saldo descuenta lo abonado.
    const abonadoTotal = Math.max(0, round(existing.originalAmount) - round(existing.saldoBase))
    const saldoEsperado = Math.max(0, a.amount - abonadoTotal)
    if (
      existing.client !== a.client
      || existing.clientKey !== a.clientKey
      || existing.entryKey !== a.entryKey
      || round(existing.originalAmount) !== a.amount
      || round(existing.saldoBase) !== saldoEsperado
    ) {
      existing.client = a.client
      existing.clientKey = a.clientKey
      existing.entryKey = a.entryKey
      existing.originalAmount = a.amount
      existing.amount = a.amount
      existing.saldoBase = saldoEsperado
      existing.totalAbonadoBase = abonadoTotal
      markUpdated(existing)
    }
  }

  // ---- Fusión de duplicados ya archivados, verificada contra el IPV ----
  // Solo cuando la foto sostiene UNA cuenta para esa identidad y todas
  // las copias comparten el mismo importe original que la foto: si no
  // coincide, no se toca nada.
  {
    const groups = new Map()
    for (const row of receivables) {
      if (row.origin !== 'ipv') continue
      const gk = `${row.date}::${resolveStoredKey(row)}`
      groups.set(gk, [...(groups.get(gk) ?? []), row])
    }
    for (const [gk, group] of groups) {
      if (group.length < 2) continue
      if (!accountDateLive(group[0].date)) continue
      const want = desired.get(gk)
      if (!want) continue
      const originals = new Set(group.map((r) => round(r.originalAmount ?? r.amount)))
      if (originals.size !== 1 || !originals.has(round(want.amount))) continue
      const keeper = [...group].sort((x, y) => {
        const px = (x.payments?.length ?? 0) > 0 ? 0 : 1
        const py = (y.payments?.length ?? 0) > 0 ? 0 : 1
        if (px !== py) return px - py
        const sx = x.status === 'pagada' ? 0 : 1
        const sy = y.status === 'pagada' ? 0 : 1
        if (sx !== sy) return sx - sy
        return 0
      })[0]
      for (const dupe of group) {
        if (dupe.id === keeper.id) continue
        keeper.payments = [...(keeper.payments ?? []), ...(dupe.payments ?? [])]
        const abonado = keeper.payments.reduce((s, p) => s + round(p.amount), 0)
        const abonadoBase = Math.max(round(keeper.totalAbonadoBase), round(dupe.totalAbonadoBase), abonado)
        keeper.totalAbonadoBase = abonadoBase
        keeper.saldoBase = Math.max(0, round(keeper.originalAmount) - abonadoBase)
        if (keeper.status !== 'pagada' && dupe.status === 'pagada') {
          keeper.status = 'pagada'
          keeper.paidDate = dupe.paidDate ?? null
          keeper.paymentMethod = dupe.paymentMethod ?? null
          keeper.detail = dupe.detail || keeper.detail
          keeper.saldoBase = 0
        }
        // Los abonos de Cobrar de la copia pasan a la conservada.
        for (const p of localPayments) if (p.receivableId === dupe.id) p.receivableId = keeper.id
        const idx = receivables.indexOf(dupe)
        if (idx >= 0) receivables.splice(idx, 1)
        deletedReceivableIds.push(dupe.id)
        markUpdated(keeper)
      }
      if (keeper.client !== want.client || keeper.clientKey !== want.clientKey || keeper.entryKey !== want.entryKey) {
        keeper.client = want.client
        keeper.clientKey = want.clientKey
        keeper.entryKey = want.entryKey
        markUpdated(keeper)
      }
    }
  }

  // ---- Limpieza: pendiente que ninguna foto sostiene, sale ----
  // Las «Pagadas» no se tocan jamás. Una pendiente con abonos (del
  // respaldo o de Cobrar) tampoco se borra: es dinero registrado.
  for (let i = receivables.length - 1; i >= 0; i--) {
    const row = receivables[i]
    if (row.origin !== 'ipv' || row.status === 'pagada') continue
    if (!accountDateLive(row.date)) continue
    const ek = row.entryKey ? String(row.entryKey) : `${row.date}::${resolveStoredKey(row)}`
    if (desired.has(ek) || desired.has(`${row.date}::${resolveStoredKey(row)}`)) continue
    const hasPayments = (row.payments?.length ?? 0) > 0 || (localByRec.get(row.id)?.length ?? 0) > 0 || round(row.totalAbonadoBase) > 0
    if (hasPayments) continue
    receivables.splice(i, 1)
    deletedReceivableIds.push(row.id)
  }

  // ---- Gastos automáticos del Desglose («ipv-cuentas») ----
  const expenses = (state.expenses ?? []).map((e) => ({ ...e }))
  const createdExpenseIds = []
  const updatedExpenseIds = []
  const deletedExpenseIds = []
  const gastoNote = (e) => {
    if (isAnimacionConcept(e.rawName) || isAnimacionConcept(e.concept)) {
      return 'Botella entregada al animador ese día · salida por animación detectada en Cuentas del IPV (el importe del IPV se usa como valor de la salida; no hay precio de costo separado)'
    }
    return e.gastoObs
      ? `Salida de caja de la hoja Cuentas del IPV · marcado «gasto» en Observaciones · ${e.rawName}`
      : `Detectado en Cuentas del IPV · ${e.rawName}`
  }
  const gastoFields = (e) => {
    const esAnim = isAnimacionConcept(e.rawName) || isAnimacionConcept(e.concept)
    return {
      date: e.date,
      concept: esAnim ? 'Animación' : e.concept,
      category: categoryForCuentasConcept(e.concept, e.rawName),
      dept: deptForCuentasConcept(e.concept, e.rawName),
      quantity: 1,
      unitValue: e.amount,
      total: e.amount,
      note: gastoNote(e),
    }
  }
  const desiredGastos = new Map()
  for (const e of entries) if (e.classification === 'gasto') desiredGastos.set(e.sourceKey, e)
  const entriesByKey = new Map(entries.map((e) => [e.sourceKey, e]))
  const seenGastos = new Set()
  for (let i = expenses.length - 1; i >= 0; i--) {
    const exp = expenses[i]
    if (exp.origin !== 'ipv-cuentas') continue
    const want = exp.sourceKey ? desiredGastos.get(exp.sourceKey) : undefined
    if (!want) {
      /* La fila sigue viva en el Desglose pero esta pasada NO trae
         ninguna señal de clasificación (ni decisión del dueño, ni
         marca «gasto», ni concepto aprendido): su «pendiente» es
         AUSENCIA de aprendizaje, no una reclasificación. El gasto
         guardado es un registro duradero — nació de una decisión —
         y no se destruye por falta de contexto: se conserva y se
         refrescan sus campos desde la fila viva (si el IPV cambió
         el importe, el gasto sigue al IPV). Solo se borra cuando
         hay señal positiva: la fila ya no está en los días, o quedó
         clasificada como cuenta, o el dueño la devolvió a
         «pendiente» con una decisión expresa (overridden). Sin esta
         guarda, un estado sin el aprendizaje sembrado (la semilla
         SQL de producción nunca escribió learnedKinds/overrides)
         borraba en silencio gastos reales del IPV — «SAZON» 160 y
         «MANTENIMIENTO MALECON» 1.250 de octubre de 2026 — y con
         ellos se movían Economía, el boletín y los informes. */
      const entry = exp.sourceKey ? entriesByKey.get(exp.sourceKey) : undefined
      if (
        entry
        && entry.classification === 'pendiente'
        && !entry.overridden
        && !entry.gastoObs
        && entry.defaultClassification === 'pendiente'
      ) {
        seenGastos.add(exp.sourceKey)
        const fields = gastoFields(entry)
        if (
          exp.date !== fields.date || exp.concept !== fields.concept || exp.category !== fields.category
          || exp.dept !== fields.dept || round(exp.total) !== fields.total || (exp.note ?? '') !== fields.note
        ) {
          Object.assign(exp, fields)
          updatedExpenseIds.push(exp.id)
        }
        continue
      }
      expenses.splice(i, 1)
      deletedExpenseIds.push(exp.id)
      continue
    }
    seenGastos.add(exp.sourceKey)
    const fields = gastoFields(want)
    if (
      exp.date !== fields.date || exp.concept !== fields.concept || exp.category !== fields.category
      || exp.dept !== fields.dept || round(exp.total) !== fields.total || (exp.note ?? '') !== fields.note
    ) {
      Object.assign(exp, fields)
      updatedExpenseIds.push(exp.id)
    }
  }
  for (const [key, e] of desiredGastos) {
    if (seenGastos.has(key)) continue
    const exp = { id: `ipv-exp::${key}`, origin: 'ipv-cuentas', sourceKey: key, cycleStart: null, ...gastoFields(e) }
    expenses.push(exp)
    createdExpenseIds.push(exp.id)
  }

  // ---- Gasto automático de nómina («auto-rh») por nómina registrada ----
  for (const rec of payrollHistory) {
    const fields = {
      date: rec.payDate,
      concept: `Pago de nómina RH · ciclo del ${fmtFechaLarga(rec.cycleStart)} al ${fmtFechaLarga(rec.cycleEnd)}`,
      category: 'Nómina RH',
      dept: GENERAL_DEPT,
      quantity: 1,
      unitValue: round(rec.total),
      total: round(rec.total),
      note: 'Gasto automático del pago de nómina del ciclo (se registra el día de pago, día 16). Se actualiza solo si reimportas un día del ciclo; no se edita a mano.',
    }
    const existing = expenses.find((e) => e.origin === 'auto-rh' && e.cycleStart === rec.cycleStart)
    if (!existing) {
      const exp = { id: `auto-rh::${rec.cycleStart}`, origin: 'auto-rh', sourceKey: null, cycleStart: rec.cycleStart, ...fields }
      expenses.push(exp)
      createdExpenseIds.push(exp.id)
    } else if (
      existing.date !== fields.date || round(existing.total) !== fields.total || existing.concept !== fields.concept
    ) {
      Object.assign(existing, fields)
      updatedExpenseIds.push(existing.id)
    }
  }

  return {
    receivables,
    localPayments,
    expenses,
    cuentasEntries: entries,
    aliases,
    newAliases,
    createdReceivableIds,
    updatedReceivableIds,
    deletedReceivableIds,
    createdExpenseIds,
    updatedExpenseIds,
    deletedExpenseIds,
  }
}

/**
 * Concilia la hoja «Cuentas pagadas» de UN día importado: cada fila
 * (cliente, importe, fecha, forma) cierra la cuenta pendiente del
 * mismo importe de esa persona. Si el pago ya está registrado, se
 * omite (nunca se duplica). Una variación de una letra en el nombre
 * solo se admite si identifica de forma única una cuenta con ese
 * importe. Devuelve las cuentas actualizadas (objetos nuevos) y el
 * resumen { paid, skipped, unmatched }.
 *
 * Se aplica como paso separado tras syncDerivedData, solo para el día
 * recién importado (como en el original).
 */
export function applyImportedPaidAccounts(receivables, day) {
  const imported = Array.isArray(day?.cuentasPagadas) ? day.cuentasPagadas : []
  const result = { paid: 0, skipped: 0, unmatched: 0 }
  if (!imported.length) return { receivables, ...result }
  const rows = receivables.map((r) => ({ ...r, payments: [...(r.payments ?? [])] }))
  const nameRank = (importedKey, importedFirst, cand) => {
    if (cand.key === importedKey) return 2
    if (importedFirst.length >= 5 && cand.first.length >= 5 && oneEditApart(importedFirst, cand.first)) return 1
    return 0
  }
  const candidates = rows.map((row) => ({
    row,
    key: canonicalPersonKey(row.clientKey, row.client ?? ''),
    first: firstNameKeyOf(row.client),
    status: String(row.status ?? 'pendiente'),
    balance: Math.max(0, round(row.saldoBase)),
    original: Math.max(0, round(row.originalAmount ?? row.amount)),
  }))
  for (const item of imported) {
    const amount = Math.max(0, round(item?.amount))
    const importedKey = canonicalPersonKey(null, String(item?.client ?? ''))
    const importedFirst = firstNameKeyOf(item?.client)
    if (!importedKey || amount <= 0) { result.unmatched++; continue }
    const alreadyPaid = candidates.filter((c) =>
      c.status === 'pagada' && c.original === amount && nameRank(importedKey, importedFirst, c) > 0)
    if (alreadyPaid.length) { result.skipped++; continue }
    const pending = candidates
      .map((c) => ({ c, rank: nameRank(importedKey, importedFirst, c), exactBalance: c.balance === amount ? 1 : 0 }))
      .filter(({ c, rank }) => c.status === 'pendiente' && rank > 0 && (c.balance === amount || c.original === amount))
      .sort((a, b) => b.rank - a.rank || b.exactBalance - a.exactBalance || a.c.row.date.localeCompare(b.c.row.date))
    const best = pending[0]
    if (!best) { result.unmatched++; continue }
    if (best.rank === 1 && pending.filter((e) => e.rank === 1).length !== 1) { result.unmatched++; continue }
    const row = best.c.row
    const saldo = best.c.balance > 0 ? best.c.balance : best.c.original
    row.payments = [...row.payments, {
      id: `ipv-sheet-${row.id}-${row.payments.length}`,
      amount: saldo,
      paidDate: String(item.paidDate ?? day.date),
      paymentMethod: String(item.paymentMethod ?? ''),
      local: false,
    }]
    row.totalAbonadoBase = Math.max(round(row.totalAbonadoBase), best.c.original)
    row.saldoBase = 0
    row.status = 'pagada'
    row.paidDate = String(item.paidDate ?? day.date)
    row.paymentMethod = item.paymentMethod ? String(item.paymentMethod) : null
    row.closeKind = 'ipv'
    row.detail = 'Pagada al importar: el IPV traía esta cuenta en «Cuentas pagadas»'
    best.c.status = 'pagada'
    result.paid++
  }
  return { receivables: rows, ...result }
}

/**
 * Deriva las SUPRESIONES que el respaldo no exporta como tabla: en el
 * original, una cuenta del IPV eliminada «para siempre» deja una marca
 * (por cuenta «fecha::cliente», o vieja por cliente) que la hace
 * invisible en las entradas. El respaldo trae el RESULTADO (las
 * entradas finales en cuentasEntries) pero no las marcas. Regla de
 * lectura: una fila del Desglose clasificada «cuenta» que NO aparece en
 * las entradas del respaldo, en una fecha que sí trae entradas, está
 * suprimida en esa fecha; si una persona está ausente en TODAS las
 * fechas en que aparece, la marca es de cliente completo (así está
 * «Nathaly»: sin una sola entrada pese a salir en 7 Desgloses).
 */
export function deriveSuppressedEntries(days, entrySourceKeys, { learnedKinds = {}, overrides = {}, knownPersons = new Set() } = {}) {
  const present = new Set(entrySourceKeys ?? [])
  if (!present.size) return []
  const entries = buildCuentasEntries(days, { learnedKinds, overrides, knownPersons, suppressed: [] })
  const suppressed = []
  const byPerson = new Map()
  for (const e of entries) {
    if (e.classification !== 'cuenta') continue
    const missing = !present.has(e.sourceKey)
    const list = byPerson.get(e.entryKey) ?? []
    list.push({ sourceKey: e.sourceKey, missing })
    byPerson.set(e.entryKey, list)
    if (missing) suppressed.push(e.sourceKey)
  }
  for (const [personKey, list] of byPerson) {
    if (list.length && list.every((x) => x.missing)) suppressed.push(personKey)
  }
  return [...new Set(suppressed)]
}

// ============================================================
// RH: registro de trabajadores, marcas, ciclos y nómina.
// ============================================================

export function normalizeWorkerRecord(w) {
  return {
    key: String(w?.key ?? clientKeyOf(w?.nombre ?? '')),
    nombre: String(w?.nombre ?? ''),
    ocupacion: String(w?.ocupacion ?? ''),
    carnet: String(w?.carnet ?? ''),
    cuentaBancaria: String(w?.cuentaBancaria ?? ''),
    movil: String(w?.movil ?? ''),
    notas: String(w?.notas ?? ''),
    origen: w?.origen === 'manual' ? 'manual' : 'ipv',
  }
}

/**
 * Registro único de trabajadores (puerto de la sincronización del
 * original): fusiona fichas duplicadas por nombre visible (se conserva
 * la de clave = nombre completo y rellena sus huecos con la copia),
 * crea la ficha de quien aparece en fotos de RH o en nóminas y aún no
 * tiene, y rellena SOLO los campos vacíos desde la foto más reciente.
 * Lo que ya está escrito nunca se pisa.
 */
export function buildWorkersRegistry(importedWorkers, days, payrollHistory, anchor = DEFAULT_ANCHOR) {
  const rows = []
  const byKey = new Map()
  const addRow = (w) => {
    const rec = normalizeWorkerRecord(w)
    if (!rec.nombre) return
    rec.key = canonicalPersonKey(rec.key, rec.nombre)
    const existing = byKey.get(rec.key)
    if (existing) {
      for (const f of ['ocupacion', 'carnet', 'cuentaBancaria', 'movil', 'notas']) {
        if (!existing[f] && rec[f]) existing[f] = rec[f]
      }
      return
    }
    byKey.set(rec.key, rec)
    rows.push(rec)
  }
  for (const w of importedWorkers ?? []) addRow(w)

  // Fusión de duplicados por nombre visible EXACTO (el caso «Yan» /
  // «Yan Espinosa»): dos fichas con el mismo nombre visible son la
  // misma persona partida; manda la de clave = nombre completo.
  {
    const byDisplay = new Map()
    for (const w of rows) {
      const display = clientKeyOf(w.nombre)
      if (!display) continue
      byDisplay.set(display, [...(byDisplay.get(display) ?? []), w])
    }
    for (const [display, group] of byDisplay) {
      if (group.length < 2) continue
      const keeper = group.find((w) => w.key === display) ?? group[0]
      for (const dup of group) {
        if (dup === keeper) continue
        for (const f of ['ocupacion', 'carnet', 'cuentaBancaria', 'movil', 'notas']) {
          if (!keeper[f] && dup[f]) keeper[f] = dup[f]
        }
        byKey.delete(dup.key)
        rows.splice(rows.indexOf(dup), 1)
      }
    }
  }

  // Quien aparece en una nómina tiene ficha seguro. De las fotos de
  // RH solo crea ficha quien sigue presente en la foto MÁS RECENTE de
  // su ciclo: una fila que solo salió en IPV viejos y desapareció
  // antes del cierre (en el original: «Niurbi», fila duplicada de los
  // IPV del 1–6 oct que el dueño eliminó del registro) no resucita
  // sola al reimportar respaldos antiguos.
  const seenNames = []
  for (const p of payrollHistory ?? []) for (const e of p.employees ?? []) seenNames.push(e)
  {
    const latestByCycle = new Map()
    for (const d of days ?? []) {
      if (!(d.rh?.length ?? 0)) continue
      const idx = cycleIndexFor(anchor, d.date)
      const cur = latestByCycle.get(idx)
      if (!cur || d.date > cur.date) latestByCycle.set(idx, d)
    }
    for (const d of latestByCycle.values()) for (const e of d.rh ?? []) seenNames.push(e)
  }
  for (const e of seenNames) {
    const nombre = String(e?.nombre ?? '')
    if (!nombre) continue
    const key = canonicalPersonKey(null, nombre)
    if (byKey.has(key)) continue
    if (workerKeyForAccount(nombre, rows)) continue
    addRow({ key, nombre, ocupacion: e.ocupacion, carnet: e.carnet, cuentaBancaria: e.cuentaBancaria, movil: e.movil, origen: 'ipv' })
  }

  // Relleno de huecos desde la foto más reciente que traiga el dato.
  const sortedDays = [...(days ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  for (const w of rows) {
    for (const d of sortedDays) {
      const emp = (d.rh ?? []).find((e) => workerKeyForAccount(e.nombre, [w]) === w.key || canonicalPersonKey(null, e.nombre) === w.key)
      if (!emp) continue
      let filled = false
      for (const f of ['ocupacion', 'carnet', 'cuentaBancaria', 'movil']) {
        if (!w[f] && emp[f]) { w[f] = String(emp[f]); filled = true }
      }
      if (filled && sortedDays.indexOf(d) === 0) break
      if (['ocupacion', 'carnet', 'cuentaBancaria', 'movil'].every((f) => w[f])) break
    }
  }

  return rows
    .map((w) => ({ ...w, roleKind: isDirectionPerson(w.nombre) ? 'direccion' : 'trabajador' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Línea continua de marcas por trabajador (puerto de
 * buildMarksByWorker): cada foto de RH certifica solo hasta el día
 * del propio IPV (las columnas futuras no cuentan); la foto más
 * reciente manda sobre las anteriores. Devuelve un objeto
 * { [workerKey]: { [fecha]: marca } } con marcas en [0, 1].
 */
export function buildMarksByWorker(days) {
  const marks = {}
  const ordered = [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  for (const d of ordered) {
    if (!(d.rhFechas?.length ?? 0)) continue
    for (const e of d.rh ?? []) {
      if ((e.marcas?.length ?? 0) !== (d.rhFechas?.length ?? -1)) continue
      const k = canonicalPersonKey(null, e.nombre)
      if (!k) continue
      if (!marks[k]) marks[k] = {}
      d.rhFechas.forEach((f, i) => {
        if (f > d.date) return
        marks[k][f] = Math.max(0, Math.min(1, num(e.marcas[i]) || 0))
      })
    }
  }
  return marks
}

// ---------- Ciclos de 15 días desde el ancla ----------

export const DEFAULT_ANCHOR = '2026-09-23'

export function cycleIndexFor(anchor, date) {
  return Math.floor(diffDays(anchor, date) / 15)
}

export function cycleWindow(anchor, idx) {
  const start = addDaysISO(anchor, idx * 15)
  return { start, end: addDaysISO(start, 14), payDate: addDaysISO(start, 15) }
}

export function cycleForDate(anchor, date) {
  return cycleWindow(anchor, cycleIndexFor(anchor, date))
}

/** Foto de RH vigente de un ciclo: la del ÚLTIMO día importado dentro
 *  de la ventana que trae hoja RH. */
export function latestCyclePhoto(days, start, end) {
  const inCycle = (days ?? []).filter((d) => d.date >= start && d.date <= end && (d.rh?.length ?? 0) > 0)
  return inCycle.length ? inCycle[inCycle.length - 1] : null
}

/**
 * Nómina DERIVADA de un ciclo desde su foto de cierre (o desde el
 * ajuste manual del dueño, que manda sobre la foto). El salario de
 * cada quien se lee de ESA foto: nunca se asume el del ciclo anterior.
 * Dirección (Jesús, Dayami) no entra en nómina; quien tenga el
 * interruptor «No pagado» queda fuera de la lista y del total, con su
 * importe visible aparte como excluido.
 */
export function deriveCyclePayroll(days, cycleStart, { adjustment = null, unpaidKeys = [] } = {}) {
  const end = addDaysISO(cycleStart, 14)
  const payDate = addDaysISO(cycleStart, 15)
  const photoDay = latestCyclePhoto(days, cycleStart, end)
  const source = adjustment ?? photoDay?.rh ?? []
  const unpaidSet = new Set(unpaidKeys)
  const employees = []
  let total = 0
  let excludedTotal = 0
  for (const e of source) {
    const nombre = String(e?.nombre ?? '')
    if (!nombre) continue
    const key = canonicalPersonKey(null, nombre)
    const direccion = isDirectionPerson(nombre)
    const noPagado = !direccion && unpaidSet.has(key)
    const emp = {
      key,
      nombre,
      ocupacion: String(e?.ocupacion ?? ''),
      dias: Math.max(0, num(e?.dias)),
      salarioDiario: Math.max(0, round(e?.salarioDiario)),
      totalCobrar: Math.max(0, round(e?.totalCobrar)),
      pagoEfectivo: e?.pagoEfectivo != null ? Math.max(0, round(e.pagoEfectivo)) : Math.max(0, round(e?.totalCobrar)),
      pagoTransferencia: e?.pagoTransferencia != null ? Math.max(0, round(e.pagoTransferencia)) : 0,
      carnet: String(e?.carnet ?? ''),
      cuentaBancaria: String(e?.cuentaBancaria ?? ''),
      movil: String(e?.movil ?? ''),
      direccion,
      noPagado,
    }
    if (direccion) { employees.push(emp); continue }
    if (noPagado) { excludedTotal += emp.totalCobrar; employees.push(emp); continue }
    total += emp.totalCobrar
    employees.push(emp)
  }
  return {
    cycleStart,
    cycleEnd: end,
    payDate,
    photoDate: photoDay?.date ?? null,
    fromAdjustment: Boolean(adjustment),
    employees,
    total,
    excludedTotal,
    payrollCount: employees.filter((e) => !e.direccion && !e.noPagado).length,
  }
}

/** Nómina REGISTRADA de un ciclo (historial), si existe. */
export function recordedPayroll(payrollHistory, cycleStart) {
  return (payrollHistory ?? []).find((p) => p.cycleStart === cycleStart) ?? null
}

// ---------- Rotación y días esperados (puerto del original) ----------
// Puerto fiel de detectarRotacionInfo / diasEsperadosCiclo /
// excusadosCeroDias / rhBulletinValues / valoresBoletin del SDA
// original (server/src/actions.ts), que el boletín diario usa para
// los días previstos de cada trabajador y el aviso de 0 días.
// Diferencias declaradas del puerto: las marcas del clon son un
// objeto {clave: {fecha: 0|1}} (buildMarksByWorker) en vez de Map;
// la corrección de turno manual de la ficha (turnoCorreccion para
// cargos de turno) no se porta — no es reproducible desde el
// respaldo, igual que en la comparativa validada del boletín.

const NOMBRES_DIA_Q = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dowQ = (iso) => new Date(`${iso}T12:00:00`).getDay()

function diasFijosDeFilaQ(worker) {
  const raw = Array.isArray(worker?.workWeekdays) ? worker.workWeekdays : (worker?.workWeekday != null ? [worker.workWeekday] : [])
  return raw.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
}

export function detectarRotacionInfo(obs, today, opts = {}) {
  const ventana = opts.ventana
  const descansoSemanal = opts.descansoSemanal ?? null
  const diasFijos = (opts.diasFijos ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (diasFijos.length) {
    const setFijos = new Set(diasFijos)
    const expectedU = (iso) => setFijos.has(dowQ(iso))
    let diasEsperadosVentana = null
    let tocoEnVentana = null
    if (ventana) {
      const observadas = new Set(obs.map((o) => o.fecha))
      diasEsperadosVentana = 0
      tocoEnVentana = false
      for (let f = ventana.start; f <= ventana.end; f = addDaysISO(f, 1)) {
        if (expectedU(f)) {
          diasEsperadosVentana++
          if (observadas.has(f)) tocoEnVentana = true
        }
      }
    }
    const proximos = []
    for (let i = 0; i <= 21 && proximos.length < 5; i++) {
      const f = addDaysISO(today, i)
      if (expectedU(f)) proximos.push(f)
    }
    return {
      rotacion: { tipo: 'turnos-semanal', etiqueta: `Trabaja ${diasFijos.map((d) => NOMBRES_DIA_Q[d]).join(', ')} (asignado en su ficha).`, trabajaHoy: expectedU(today), proximos },
      diasEsperadosVentana,
      tocoEnVentana,
    }
  }
  if (!obs.length) {
    return { rotacion: { tipo: 'sin-marcas', etiqueta: 'Sin marcas por día en los IPV importados.', trabajaHoy: null, proximos: [] }, diasEsperadosVentana: null, tocoEnVentana: null }
  }
  const first = obs[0].fecha
  const idx = (iso) => diffDays(first, iso)
  const ons = obs.filter((o) => o.on).length
  const ratio = ons / obs.length
  let expected = null
  let tipo = 'irregular'
  let etiqueta = ''
  const periodica = (periodo, trabaja) => {
    for (let fase = 0; fase < periodo; fase++) {
      const ok = obs.every((o) => ((((idx(o.fecha) + fase) % periodo) + periodo) % periodo < trabaja) === o.on)
      if (ok && ons > 0 && ons < obs.length) {
        return (iso) => ((((idx(iso) + fase) % periodo) + periodo) % periodo < trabaja)
      }
    }
    return null
  }
  if (obs.length >= 4) {
    const p3 = periodica(3, 1)
    if (p3) { tipo = 'rotacion-1x2'; expected = p3; etiqueta = 'Rotación detectada: trabaja 1 día y descansa 2, rotando.' }
  }
  if (!expected && obs.length >= 6) {
    const p6 = periodica(6, 3)
    if (p6) { tipo = 'rotacion-3x3'; expected = p6; etiqueta = 'Rotación detectada: trabaja 3 días y descansa 3.' }
  }
  if (!expected && obs.length >= 10) {
    const patron14 = [true, true, false, false, true, true, true, false, false, true, true, false, false, false]
    for (let fase = 0; fase < 14 && !expected; fase++) {
      const ok = obs.every((o) => patron14[(((idx(o.fecha) + fase) % 14) + 14) % 14] === o.on)
      if (ok && ons > 0 && ons < obs.length) {
        tipo = 'turnos-alternos'
        expected = (iso) => patron14[(((idx(iso) + fase) % 14) + 14) % 14]
        etiqueta = 'Turno alterno detectado: una semana trabaja el bloque largo y la siguiente el bloque corto, alternando con el otro turno.'
      }
    }
  }
  if (!expected && obs.length >= 7) {
    const porDia = new Map()
    let consistente = true
    for (const o of obs) {
      const d = dowQ(o.fecha)
      if (porDia.has(d) && porDia.get(d) !== o.on) { consistente = false; break }
      porDia.set(d, o.on)
    }
    const diasOn = [...porDia.entries()].filter(([, v]) => v).map(([d]) => d)
    const diasOff = [...porDia.entries()].filter(([, v]) => !v).map(([d]) => d)
    if (consistente && diasOn.length && diasOff.length && porDia.size >= 5) {
      tipo = 'turnos-semanal'
      const set = new Set(diasOn)
      expected = (iso) => set.has(dowQ(iso))
      etiqueta = 'Turno detectado por días de la semana.'
    }
  }
  if (!expected && obs.length >= 5 && ratio >= 0.8) {
    tipo = 'casi-diario'
    const descanso = new Set(obs.filter((o) => !o.on).map((o) => dowQ(o.fecha)))
    expected = (iso) => !descanso.has(dowQ(iso))
    etiqueta = descanso.size
      ? `Detectado: trabaja casi a diario; su día de descanso suele ser el ${[...descanso].map((d) => NOMBRES_DIA_Q[d]).join(' y el ')}.`
      : 'Detectado: trabaja casi todos los días de la quincena.'
  }
  if (!expected) {
    return { rotacion: { tipo: 'irregular', etiqueta: `Sin patrón claro todavía: ${ons} de ${obs.length} días marcados como trabajados en la foto; sigo detectando con cada IPV nuevo.`, trabajaHoy: null, proximos: [] }, diasEsperadosVentana: null, tocoEnVentana: null }
  }
  if (descansoSemanal != null) {
    const base = expected
    expected = (iso) => {
      const v = base(iso)
      if (v === null) return null
      return v && dowQ(iso) !== descansoSemanal
    }
  }
  let diasEsperadosVentana = null
  let tocoEnVentana = null
  if (ventana) {
    const observadas = new Set(obs.map((o) => o.fecha))
    diasEsperadosVentana = 0
    tocoEnVentana = false
    for (let f = ventana.start; f <= ventana.end; f = addDaysISO(f, 1)) {
      if (expected(f)) {
        diasEsperadosVentana++
        if (observadas.has(f)) tocoEnVentana = true
      }
    }
  }
  const proximos = []
  for (let i = 0; i <= 21 && proximos.length < 5; i++) {
    const f = addDaysISO(today, i)
    if (expected(f)) proximos.push(f)
  }
  return { rotacion: { tipo, etiqueta, trabajaHoy: expected(today), proximos }, diasEsperadosVentana, tocoEnVentana }
}

/** Divisor real del salario de una quincena (puerto de
 *  diasEsperadosCiclo del original, sin la corrección de turno
 *  manual declarada arriba). marksByWorker: el objeto de
 *  buildMarksByWorker del clon. */
export function diasEsperadosCiclo(worker, workerKey, marksByWorker, absenceDates, cycleStart, cycleEnd, today) {
  const descansoRaw = worker?.restWeekday
  const descansoSemanal = typeof descansoRaw === 'number' && Number.isFinite(descansoRaw)
    ? Math.max(0, Math.min(6, Math.round(descansoRaw)))
    : null
  const diasFijos = diasFijosDeFilaQ(worker ?? {})
  const globalMap = marksByWorker?.[workerKey] ?? {}
  const obs = Object.entries(globalMap)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .filter(([date]) => date <= today && !(absenceDates?.has(date)))
    .map(([fecha, value]) => ({ fecha, on: value > 0 }))
  const detected = detectarRotacionInfo(obs, today, {
    ventana: { start: cycleStart, end: cycleEnd },
    descansoSemanal,
    diasFijos,
  })
  let expected = detected.diasEsperadosVentana
  if (expected == null) {
    expected = 15
    if (diasFijos.length) {
      const fixed = new Set(diasFijos)
      expected = 0
      for (let i = 0; i < 15; i++) {
        if (fixed.has(dowQ(addDaysISO(cycleStart, i)))) expected++
      }
    } else if (descansoSemanal != null) {
      let rests = 0
      for (let i = 0; i < 15; i++) {
        if (dowQ(addDaysISO(cycleStart, i)) === descansoSemanal) rests++
      }
      expected = 15 - rests
    }
  }
  return Math.max(1, expected)
}

/** Claves excusadas del aviso de 0 días (puerto de excusadosCeroDias
 *  con asignaciones y ausencias vacías cuando el respaldo no las
 *  trae: a quien su rotación aún no le trajo el primer día del ciclo
 *  no se le marca). */
export function excusadosCeroDias(days, asignaciones, ventanaStart, ventanaEnd, referencia, ausenciasPorClave) {
  const marksByWorker = buildMarksByWorker(days)
  const out = new Set()
  const keys = new Set([...Object.keys(marksByWorker), ...(asignaciones ? [...asignaciones.keys()] : []), ...(ausenciasPorClave ? [...ausenciasPorClave.keys()] : [])])
  for (const k of keys) {
    const ausFechas = ausenciasPorClave?.get(k)
    if (ausFechas && [...ausFechas].some((f) => f >= ventanaStart && f <= ventanaEnd && f <= referencia)) {
      out.add(k)
      continue
    }
    const asign = asignaciones?.get(k)
    const globalMap = marksByWorker[k] ?? {}
    const ausSet = ausFechas ?? new Set()
    const obs = Object.entries(globalMap)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .filter(([f]) => f <= referencia && !ausSet.has(f))
      .map(([fecha, v]) => ({ fecha, on: v > 0 }))
    const info = detectarRotacionInfo(obs, referencia, {
      ventana: { start: ventanaStart, end: ventanaEnd },
      descansoSemanal: asign?.descanso ?? null,
      diasFijos: asign?.unicos ?? [],
    })
    if (info.tocoEnVentana === false) out.add(k)
  }
  return out
}

/** Valores del boletín para un empleado de la foto RH (puerto de
 *  rhBulletinValues + valoresBoletin del original). */
export function rhBulletinValues(employee, expectedDays) {
  const salarioQuincenal = Math.max(0, Number(employee.totalCobrar) || 0)
  const diasTrabajados = Math.max(0, Number(employee.dias) || 0)
  if (expectedDays == null) {
    const salarioDiario = Math.max(0, Number(employee.salarioDiario) || 0)
    return {
      salarioQuincenal,
      diasEsperados: 0,
      valorDia: salarioDiario,
      acumulado: Math.round(salarioDiario * diasTrabajados),
    }
  }
  const diasEsperados = Math.max(1, Number(expectedDays) || 1)
  const valorDia = salarioQuincenal > 0
    ? salarioQuincenal / diasEsperados
    : Math.max(0, Number(employee.salarioDiario) || 0)
  return {
    salarioQuincenal,
    diasEsperados,
    valorDia,
    acumulado: Math.round(valorDia * diasTrabajados),
  }
}
