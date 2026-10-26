// Núcleo de Productos / Elaboración / Almacén del clon externo de
// Queen SDA — puerto fiel de la lógica del sistema original
// (server/src/actions.ts: computeInventoryBook, computeProductsCatalog,
// computePriceSuggestions y el aprendizaje de referencias de paquetes),
// funcionando SOLO con los datos que viajan en el respaldo: los días del
// IPV con su cadena de existencias, el detalle de entradas y la foto de
// almacén de cada día, más los gastos y las referencias guardadas.
//
// Diferencias honestas con el original, asumidas y documentadas:
// - El original mezcla datos de su base que NO viajan en el respaldo:
//   ajustes manuales de existencia (bajas/traslados/iniciales),
//   reasignaciones y alias entre departamentos, excepciones de precio,
//   cambios de precio/costo registrados a mano, fichas de costo
//   (recetas), configuración de Barra · ml y perfiles de producto
//   (foto, código de barras, familia aprendida). Sin esos datos, el
//   libro, el catálogo y las sugerencias se calculan igual pero SOLO
//   desde el IPV y los gastos: si un producto tiene cambio manual en el
//   original, aquí puede diferir.
// - Las referencias de paquetes se guardan en el clon (StoredData /
//   tabla package_references) con sus observaciones; el aprendizaje
//   desde Gastos (actualizar precios, archivar productos nuevos con
//   rendimiento escrito, sugerir los de formato sin rendimiento) se
//   calcula AL LEER, sin escribir nada solo: las referencias virtuales
//   aprendidas se marcan como tales y el dueño las confirma con un
//   toque para guardarlas.
// - Las salidas de almacén a gasto se presentan como VISTA calculada
//   con su gasto enlazado (origin 'almacen'), sin inyectarlas en
//   StoredData.expenses: Economía ya cuenta los gastos del respaldo y
//   duplicarlos rompería sus cifras verificadas.
// Todos los cálculos son puros: mismas entradas → mismas salidas, sin
// red ni reloj (salvo el «hoy» que la pantalla pasa explícitamente).

/* ============ utilidades (las mismas del original) ============ */

export function normalizeLoose(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

const round2 = (n) => Math.round(n * 100) / 100

/** Clave estable de producto en todo el sistema (original: inventoryProductKey). */
export function productKeyOf(dept, name, um) {
  return `${normalizeLoose(dept ?? '')}||${normalizeLoose(name ?? '')}||${normalizeLoose(um ?? '')}`
}

/** Departamento canónico de menú desde el departamento del IPV (original: menuDeptOf). */
export function menuDeptOf(dept) {
  const d = normalizeLoose(dept ?? '')
  if (d.includes('no alcohol')) return 'Bebidas no alcohólicas'
  if (d.includes('alcohol')) return 'Bebidas alcohólicas'
  if (d.includes('elabor') || d.includes('cocina')) return 'Elaboración'
  if (d.includes('pizza')) return 'Pizzas'
  if (d.includes('cantina') || d.includes('coctel')) return 'Cantina'
  return String(dept ?? '').trim()
}

const MENU_FAMILY_RULES = {
  'Elaboración': [
    ['Postres', /\b(flan|helado|postre|dulce|tarta|pastel|brownie|gelatina|natilla|arroz con leche)\b/],
    ['Pescados y mariscos', /\b(pescado|pescados|langosta|camaron|camarones|marisco|mariscos|calamar|calamares|pulpo|cangrejo|atun|sardina|sardinas|mero|pargo|trucha|salmon|ostion|almeja|mejillon)\b/],
    ['Arroces', /\b(arroz|arroses|congri|paella|risotto|moros|cristianos)\b/],
    ['Entrantes y picaderas', /\b(croqueta|croquetas|calentico|calenticos|toston|tostones|papita|papitas|papas fritas|chicharron|chicharrones|empanada|empanadas|tamal|tamales|pastelito|pastelitos|tequeno|tequenos|bocadito|bocaditos|picadera|entrante|entrantes)\b/],
    ['Acompañamientos', /\b(ensalada|ensaladas|vianda|viandas|boniato|yuca|platano|platanos|fufu|pure|vegetal|vegetales|guarnicion|guarniciones|lechuga|col\b|tomate|tomates|zanahoria)\b/],
    ['Platos fuertes', /\b(cerdo|pollo|bistec|bisteces|asado|asados|carne|carnes|res|puerco|lechon|ropa vieja|picadillo|albondiga|albondigas|costilla|costillas|pavo|milanesa|milaneza|pernil|higado|fricase|estofado|guisado|chuleta|chuletas|filete|filetes|brocheta|brochetas)\b/],
  ],
  'Pizzas': [
    ['Pizzas', /\b(pizza|pizzas|pizzeta|pizzetas)\b/],
  ],
  'Cantina': [
    ['De la casa', /\b(de la casa|la reina|especial de la casa|de autor|signature)\b/],
    ['Cócteles clásicos', /\b(mojito|mojitos|daiquiri|daiquiris|cuba libre|cubalibre|caipirinha|caipirinhas|margarita|margaritas|pina colada|pinacolada|presidente el|cubanito|ron collins|gin tonic|sangria|bloody mary|manhattan|negroni|aperol|spritz|mimosa|bellini|long island|sex on the beach|blue hawaii|coctel|cocteles|cocktail|trago|tragos)\b/],
  ],
  'Bebidas alcohólicas': [
    ['Cervezas', /\b(cerveza|cervezas|cristal|kroon|hollandia|bucanero|mayabe|cacique|heineken|corona|estrella|presidente|lagger|lager|pilsener|clara|clara radler)\b/],
    ['Vinos', /\b(vino|vinos|espumoso|espumosos|sidra|sidras|cava|cavas|champan|champagne|prosecco|lambrusco|rioja|tinto|tintos|rosado|rosados|sangria)\b/],
    ['Cremas y licores dulces', /\b(crema|cremas|baileys|licor|licores|amaretto|kahlua|frangelico|anis|anise|elexir|elixir)\b/],
    ['Whisky', /\b(whisky|whiskey|bourbon|scotch|jack daniel|johnnie|chivas|dewars|ballantine|grants|grant|jameson|jim beam|wild turkey)\b/],
    ['Vodka y licores blancos', /\b(vodka|vodkas|ginebra|ginebras|gin|gins|tequila|tequilas|aguardiente|aguardientes|pisco|piscos|blanco|blanca)\b/],
    ['Rones', /\b(ron|rones|rum|anejo|anejos|havana|santiago|caney|mulata|legendario|varadero|cubay|arecha|bacardi|zapaca|diplomatico)\b/],
  ],
  'Bebidas no alcohólicas': [
    ['Maltas y energizantes', /\b(malta|maltas|energizante|energizantes|energetica|energeticas|red bull|monster|power king|volt)\b/],
    ['Jugos y batidos', /\b(jugo|jugos|batido|batidos|natural|naturales|limonada|limonadas|naranjada|zumo|zumos|smoothie|smoothies|extracto|extractos)\b/],
    ['Aguas', /\b(agua|aguas)\b/],
    ['Refrescos', /\b(refresco|refrescos|cola|colas|soda|sodas|gaseosa|gaseosas|tukola|tropi|ironbeer|iron beer|cienfuegos)\b/],
  ],
}

/** Familia automática por palabras del nombre (original: autoMenuFamily). */
export function autoMenuFamily(dept, name) {
  const canonical = menuDeptOf(dept)
  const rules = MENU_FAMILY_RULES[canonical] ?? []
  const n = normalizeLoose(name)
  for (const [family, rx] of rules) if (rx.test(n)) return family
  return 'Por clasificar'
}

/* ============ Libro de existencias (original: computeInventoryBook) ============
   La cadena se encadena con lo que trae cada IPV y, si se le pasan,
   con los ajustes manuales del original (inventoryAdjustments:
   «inicial» fija el saldo inicial de su fecha y reencadena desde
   ahí; «baja» y «traslado» suman a las bajas/traslados manuales de
   su fecha). Sin ajustes (la llamada por defecto), el libro es solo
   la foto de los IPV: los ajustes del servidor original no viajan
   en el respaldo; los de esta copia viven en su propio almacén. */

export function buildInventoryBook(daysIn, adjustments = []) {
  const days = [...(daysIn ?? [])].filter((d) => d && d.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const meta = new Map()
  const moves = new Map()
  const remember = (dept, name, um) => {
    const key = productKeyOf(dept, name, um)
    if (!meta.has(key)) meta.set(key, { key, dept: String(dept ?? '').trim(), name: String(name ?? '').trim(), um: String(um ?? '').trim() })
    return key
  }
  const move = (key, date) => {
    if (!moves.has(key)) moves.set(key, new Map())
    const byDate = moves.get(key)
    if (!byDate.has(date)) {
      byDate.set(date, {
        date, conFila: false, entradas: 0, entradasIpv: 0, ventas: 0,
        bajasIpv: 0, trasladosIpv: 0,
        ipvSaldoFinal: null, ipvFuente: null, ipvSaldoInicial: null, ipvDisponible: null, ipvALaVenta: null,
      })
    }
    return byDate.get(date)
  }
  for (const day of days) {
    for (const deptRow of day.departments ?? []) {
      for (const p of deptRow.products ?? []) {
        const key = remember(deptRow.name || p.category, p.name, p.um)
        const m = move(key, day.date)
        m.conFila = true
        m.ventas += p.cantidadVendida ?? 0
        m.bajasIpv += p.bajas ?? 0
        m.trasladosIpv += p.traslados ?? 0
        if (p.existenciaFinal != null) { m.ipvSaldoFinal = p.existenciaFinal; m.ipvFuente = p.existenciaFuente ?? null }
        if (p.saldoInicial != null) m.ipvSaldoInicial = p.saldoInicial
        if (p.disponible != null) m.ipvDisponible = p.disponible
        if (p.aLaVenta != null) m.ipvALaVenta = p.aLaVenta
      }
    }
    for (const e of day.entriesDetail ?? []) {
      if (!(e.cantidad > 0)) continue
      const key = remember(e.dept, e.descripcion, e.um)
      const m = move(key, day.date)
      m.entradas += e.cantidad
      m.entradasIpv += e.cantidad
    }
  }
  // Ajustes manuales por producto y fecha (forma del servidor
  // original): se aplican sobre los días del libro — un ajuste con
  // fecha sin día importado no crea un día fantasma en la cadena.
  const dayDates = new Set(days.map((d) => d.date))
  const adjByKey = new Map()
  for (const adj of adjustments ?? []) {
    if (!adj || !adj.productKey || !adj.date || !dayDates.has(adj.date)) continue
    const key = remember(adj.dept, adj.productName, adj.um)
    if (key !== adj.productKey) continue
    move(key, adj.date)
    if (!adjByKey.has(key)) adjByKey.set(key, new Map())
    const byDate = adjByKey.get(key)
    const slot = byDate.get(adj.date) ?? { inicial: null, baja: 0, traslado: 0, list: [] }
    if (adj.kind === 'inicial') slot.inicial = Number(adj.quantity) || 0
    else if (adj.kind === 'traslado') slot.traslado += Number(adj.quantity) || 0
    else slot.baja += Number(adj.quantity) || 0
    slot.list.push(adj)
    byDate.set(adj.date, slot)
  }

  const products = []
  const descuadres = []
  for (const [key, m] of meta) {
    const byDate = moves.get(key) ?? new Map()
    const dates = [...byDate.keys()].sort()
    const history = []
    let prevContado = null
    let prevEsperado = null
    dates.forEach((date, idx) => {
      const mv = byDate.get(date)
      const adj = adjByKey.get(key)?.get(date) ?? null
      // Regla del dueño (2026-10-09): si el IPV de ESE día trae
      // saldoInicial, ese manda y la cadena se reencadena desde ahí;
      // solo si no lo trae se continúa la cadena anterior. Un ajuste
      // «inicial» fijado a mano manda sobre ambos (es la corrección
      // expresa del saldo de apertura, como en el servidor original).
      const saldoInicial = adj?.inicial != null
        ? round2(adj.inicial)
        : mv.ipvSaldoInicial != null
          ? round2(mv.ipvSaldoInicial)
          : idx === 0 ? 0 : round2(prevContado ?? prevEsperado ?? 0)
      const disponible = round2(saldoInicial + mv.entradas)
      const bajasManual = adj?.baja ?? 0
      const trasladosManual = adj?.traslado ?? 0
      const bajas = round2(mv.bajasIpv + bajasManual)
      const traslados = round2(mv.trasladosIpv + trasladosManual)
      const aLaVenta = round2(disponible - bajas - traslados)
      const saldoFinal = round2(aLaVenta - mv.ventas)
      const esFisico = mv.ipvSaldoFinal != null && mv.ipvFuente === 'fisica'
      const diferencia = esFisico ? round2(mv.ipvSaldoFinal - saldoFinal) : null
      const row = {
        date,
        conFila: mv.conFila,
        saldoInicial,
        ipvSaldoInicial: mv.ipvSaldoInicial,
        aperturaEsperada: idx > 0 ? prevContado : null,
        cuadraApertura: true,
        diferenciaApertura: null,
        entradas: round2(mv.entradas),
        entradasIpv: round2(mv.entradasIpv),
        disponible,
        ipvDisponible: mv.ipvDisponible,
        bajas,
        traslados,
        bajasIpv: round2(mv.bajasIpv),
        trasladosIpv: round2(mv.trasladosIpv),
        bajasManual: round2(bajasManual),
        trasladosManual: round2(trasladosManual),
        adjustments: adj?.list ?? [],
        aLaVenta,
        ipvALaVenta: mv.ipvALaVenta,
        ventas: round2(mv.ventas),
        saldoFinal,
        ipvSaldoFinal: mv.ipvSaldoFinal,
        ipvFuente: mv.ipvFuente,
        diferencia,
      }
      history.push(row)
      if (esFisico) prevContado = mv.ipvSaldoFinal
      prevEsperado = saldoFinal
    })
    const last = history[history.length - 1] ?? null
    const lastWithIpv = [...history].reverse().find((h) => h.ipvSaldoFinal != null && h.ipvFuente === 'fisica') ?? null
    const lastDiferencia = [...history].reverse().find((h) => h.diferencia != null)?.diferencia ?? null
    const lastRow = history[history.length - 1]
    const currentStock = lastRow
      ? (lastRow.ipvSaldoFinal != null && lastRow.ipvFuente === 'fisica' ? round2(lastRow.ipvSaldoFinal) : lastRow.saldoFinal)
      : 0
    const primeraFila = history.find((h) => h.conFila) ?? null
    const hasInitialSet = [...(adjByKey.get(key)?.values() ?? [])].some((slot) => slot.inicial != null)
    const faltaSaldoInicial = !hasInitialSet && (primeraFila
      ? primeraFila.ipvSaldoInicial == null && primeraFila.entradas <= 0 &&
        !history.some((h) => h.ipvSaldoInicial != null) &&
        !history.some((h) => h.ipvSaldoFinal != null && h.ipvFuente === 'fisica')
      : history.length > 0 && history[0].ipvSaldoInicial == null)
    products.push({
      ...m,
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
      history,
      currentStock,
      lastIpvSaldoFinal: lastWithIpv ? lastWithIpv.ipvSaldoFinal : null,
      lastDiferencia,
      hasDescuadre: lastDiferencia != null && Math.abs(lastDiferencia) > 0.001,
      hasInitialSet,
      faltaSaldoInicial,
    })
    for (const h of history) {
      if (h.diferencia != null && Math.abs(h.diferencia) > 0.001) {
        descuadres.push({
          productKey: key, dept: m.dept, name: m.name, um: m.um, date: h.date,
          diferencia: h.diferencia, esperado: h.saldoFinal, contado: h.ipvSaldoFinal,
          texto: `${m.name} (${h.date}): el conteo físico del IPV da ${h.ipvSaldoFinal} y el libro esperaba ${h.saldoFinal} — diferencia de ${h.diferencia} ${m.um || 'U'}.`,
        })
      }
    }
    void last
  }
  products.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name))
  descuadres.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)))
  return {
    products,
    descuadres,
    latestDate: days.length ? days[days.length - 1].date : null,
    totalProductos: products.length,
    conExistencia: products.filter((p) => p.currentStock > 0.001).length,
  }
}

/* ============ Catálogo maestro (original: computeProductsCatalog) ============
   Costo promedio ponderado cronológico alimentado por las entradas
   (Entrada del IPV) y por el costo que declara la hoja; precio vigente
   desde los puntos del IPV; historial de precios y contraste de
   importes por día vendido (priceChecks) como el original. Sin
   cambios manuales ni excepciones (no viajan en el respaldo): la
   historia de precios sale solo de los puntos del IPV. */

export function buildProductsCatalog(daysIn, adjustments = []) {
  const days = [...(daysIn ?? [])].filter((d) => d && d.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  /* Con los ajustes manuales de existencia de esta copia (los
     mismos que aplica Existencias al construir su libro): sin
     ellos, el catálogo — y el menú, que nace de él — contradecía
     al almacén tras cualquier baja, traslado o alta a mano. */
  const book = buildInventoryBook(days, adjustments)
  const bookByKey = new Map(book.products.map((p) => [p.key, p]))
  // Ventas por fecha y producto; entradas por fecha y producto.
  const saleByKey = new Map()
  const entriesByKey = new Map()
  for (const day of days) {
    for (const deptRow of day.departments ?? []) {
      for (const p of deptRow.products ?? []) {
        const key = productKeyOf(deptRow.name || p.category, p.name, p.um)
        if (!saleByKey.has(key)) saleByKey.set(key, new Map())
        const perDate = saleByKey.get(key)
        const cur = perDate.get(day.date) ?? { qty: 0, importe: 0, precioVenta: 0, precioCosto: 0, ganancia: 0 }
        cur.qty += p.cantidadVendida ?? 0
        cur.importe += p.importeVenta ?? 0
        if ((p.precioVenta ?? 0) > 0) cur.precioVenta = p.precioVenta
        if ((p.precioCosto ?? 0) > 0) cur.precioCosto = p.precioCosto
        cur.ganancia += p.ganancia ?? 0
        perDate.set(day.date, cur)
      }
    }
    for (const e of day.entriesDetail ?? []) {
      if (!(e.cantidad > 0)) continue
      const key = productKeyOf(e.dept, e.descripcion, e.um)
      if (!entriesByKey.has(key)) entriesByKey.set(key, [])
      entriesByKey.get(key).push({
        date: day.date, cantidad: e.cantidad, precioCompra: e.precioCompra ?? 0,
        importe: e.importe ?? e.cantidad * (e.precioCompra ?? 0), precioVenta: e.precioVenta ?? 0,
      })
    }
  }

  const products = []
  const sinExplicar = []
  for (const prod of book.products) {
    const key = prod.key
    const saleByDate = saleByKey.get(key) ?? new Map()
    const entries = entriesByKey.get(key) ?? []
    // ---- Costo promedio ponderado cronológico (el mismo del original).
    const entradasPorFecha = new Map()
    for (const e of entries) {
      const cur = entradasPorFecha.get(e.date) ?? { cantidad: 0, importe: 0 }
      cur.cantidad += e.cantidad
      cur.importe += e.importe
      entradasPorFecha.set(e.date, cur)
    }
    const entradasListas = new Set()
    let avg = null
    let lastSheetCosto = null
    const entradasHistorial = []
    const historyByDate = new Map(prod.history.map((h) => [h.date, h]))
    for (const h of prod.history) {
      const saleDay = saleByDate.get(h.date)
      const ent = entradasPorFecha.get(h.date)
      if (ent && ent.cantidad > 0) {
        entradasListas.add(h.date)
        const costoEntrada = ent.importe / ent.cantidad
        const existenciaAntes = Math.max(0, h.saldoInicial)
        const costoAnterior = avg ?? (lastSheetCosto ?? (h.saldoInicial > 0 && saleDay && saleDay.precioCosto > 0 ? saleDay.precioCosto : null))
        const nuevo = costoAnterior == null || existenciaAntes <= 0
          ? costoEntrada
          : (existenciaAntes * costoAnterior + ent.cantidad * costoEntrada) / (existenciaAntes + ent.cantidad)
        entradasHistorial.push({
          date: h.date, cantidad: round2(ent.cantidad), importe: round2(ent.importe),
          costoEntrada: round2(costoEntrada), costoAnterior: costoAnterior == null ? null : round2(costoAnterior),
          costoPromedio: round2(nuevo), distinto: costoAnterior != null && Math.abs(costoEntrada - costoAnterior) > 0.001,
        })
        avg = nuevo
      } else if (avg == null && saleDay && saleDay.precioCosto > 0) {
        avg = saleDay.precioCosto
      }
      if (saleDay && saleDay.precioCosto > 0) lastSheetCosto = saleDay.precioCosto
    }
    for (const [date, ent] of entradasPorFecha) {
      if (entradasListas.has(date) || !(ent.cantidad > 0)) continue
      const costoEntrada = ent.importe / ent.cantidad
      entradasHistorial.push({
        date, cantidad: round2(ent.cantidad), importe: round2(ent.importe),
        costoEntrada: round2(costoEntrada), costoAnterior: avg == null ? null : round2(avg),
        costoPromedio: round2(costoEntrada), distinto: avg != null && Math.abs(costoEntrada - avg) > 0.001,
      })
      avg = costoEntrada
    }
    entradasHistorial.sort((a, b) => (a.date < b.date ? -1 : 1))
    const costoPromedio = avg == null ? null : round2(avg)
    const costoUltimaEntrada = entradasHistorial.length ? entradasHistorial[entradasHistorial.length - 1].costoEntrada : null
    const ultimoCostoIpv = (() => {
      for (const sale of [...saleByDate.values()].reverse()) if (sale.precioCosto > 0) return sale.precioCosto
      return null
    })()
    // Precio vigente: en el clon no hay cambios manuales; manda el
    // último punto del IPV (misma regla del original).
    const precioCompraVigente = costoPromedio ?? ultimoCostoIpv
    // ---- Historial de precios de venta desde los puntos del IPV.
    const ipvPoints = []
    for (const [date, sale] of [...saleByDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (sale.precioVenta > 0) ipvPoints.push({ date, precio: sale.precioVenta })
    }
    const precioHistorial = []
    let prevIpv = null
    for (const pt of ipvPoints) {
      if (prevIpv == null || Math.abs(pt.precio - prevIpv.precio) > 0.001) {
        precioHistorial.push({ date: pt.date, oldPrice: prevIpv ? prevIpv.precio : null, newPrice: pt.precio, source: 'ipv', note: '' })
      }
      prevIpv = pt
    }
    const cambiosPrecio = precioHistorial.filter((e) => e.oldPrice != null).length
    const cambiosCosto = entradasHistorial.filter((e) => e.distinto).length
    const lastIpv = ipvPoints.length ? ipvPoints[ipvPoints.length - 1] : null
    const precioVentaVigente = lastIpv ? round2(lastIpv.precio) : null
    let precioCambioHoy = null
    if (book.latestDate) {
      const hoyEvents = precioHistorial.filter((e) => e.date === book.latestDate && e.oldPrice != null && Math.abs(e.newPrice - e.oldPrice) > 0.001)
      const ult = hoyEvents[hoyEvents.length - 1]
      if (ult) precioCambioHoy = `Hoy ${round2(ult.oldPrice)} → ${round2(ult.newPrice)}`
    }
    // ---- Contraste de importes por día vendido (priceChecks).
    const priceChecks = []
    const ipvPriceOn = (date) => {
      const pts = ipvPoints.filter((p) => p.date <= date)
      return pts.length ? pts[pts.length - 1].precio : null
    }
    const ipvPriceBefore = (date) => {
      const pts = ipvPoints.filter((p) => p.date < date)
      return pts.length ? pts[pts.length - 1].precio : null
    }
    for (const d of [...saleByDate.keys()].sort()) {
      const s = saleByDate.get(d)
      if (!(s.qty > 0) || !(s.importe > 0)) continue
      const unico = s.precioVenta > 0 ? s.precioVenta : (ipvPriceOn(d) ?? 0)
      if (!(unico > 0)) continue
      const esperado = s.qty * unico
      const dif = s.importe - esperado
      if (Math.abs(dif) <= 1) {
        priceChecks.push({
          date: d, unidades: s.qty, importeVenta: round2(s.importe), precioUnico: round2(unico),
          esperadoUnico: round2(esperado), diferencia: round2(dif), estado: 'ok',
          texto: `${prod.name}: ${s.qty} × ${round2(unico)} = ${round2(esperado)} CUP, cuadra con el importe del IPV.`,
          unidadesPrecioViejo: null, unidadesPrecioNuevo: null, precioViejo: null, precioNuevo: null,
        })
        continue
      }
      const oldP = ipvPriceBefore(d)
      const newP = unico
      let explicada = null
      if (oldP != null && newP > 0 && Math.abs(oldP - newP) > 0.001) {
        const a = (s.importe - s.qty * newP) / (oldP - newP)
        const aRound = Math.round(a)
        if (aRound >= 0 && aRound <= s.qty && Math.abs(a - aRound) <= 0.02 && Math.abs(aRound * oldP + (s.qty - aRound) * newP - s.importe) <= 1) {
          explicada = {
            date: d, unidades: s.qty, importeVenta: round2(s.importe), precioUnico: round2(unico),
            esperadoUnico: round2(esperado), diferencia: round2(dif), estado: 'explicada',
            texto: `${prod.name}: cambio de precio ${round2(oldP)} → ${round2(newP)} a mitad del día (${aRound} a ${round2(oldP)}, ${s.qty - aRound} a ${round2(newP)}). El importe cuadra con los dos tramos: no es un descuadre.`,
            unidadesPrecioViejo: aRound, unidadesPrecioNuevo: s.qty - aRound, precioViejo: round2(oldP), precioNuevo: round2(newP),
          }
        }
      }
      if (explicada) { priceChecks.push(explicada); continue }
      priceChecks.push({
        date: d, unidades: s.qty, importeVenta: round2(s.importe), precioUnico: round2(unico),
        esperadoUnico: round2(esperado), diferencia: round2(dif), estado: 'sin-explicar',
        texto: `${prod.name} (${d}): el importe del IPV (${round2(s.importe)} CUP por ${s.qty}) no cuadra con ${s.qty} × ${round2(unico)} = ${round2(esperado)} CUP y no hay cambio de precio registrado ese día que lo explique. Diferencia ${round2(dif)} CUP: revísalo.`,
        unidadesPrecioViejo: null, unidadesPrecioNuevo: null, precioViejo: oldP == null ? null : round2(oldP), precioNuevo: round2(newP),
      })
    }
    const ultimoPriceCheck = priceChecks.length ? priceChecks[priceChecks.length - 1] : null
    for (const c of priceChecks.filter((x) => x.estado === 'sin-explicar')) {
      sinExplicar.push({ productKey: key, dept: prod.dept, name: prod.name, um: prod.um, date: c.date, texto: c.texto, diferencia: c.diferencia })
    }
    const gananciaUnidad = precioVentaVigente != null && precioCompraVigente != null ? round2(precioVentaVigente - precioCompraVigente) : null
    const margenPct = gananciaUnidad != null && precioVentaVigente != null && precioVentaVigente > 0 ? round2((gananciaUnidad / precioVentaVigente) * 100) : null
    const ventasReales = [...saleByDate.values()]
    const unidadesVendidas = round2(ventasReales.reduce((sum, sale) => sum + sale.qty, 0))
    const ventaHistorica = round2(ventasReales.reduce((sum, sale) => sum + sale.importe, 0))
    const gananciaHistorica = round2(ventasReales.reduce((sum, sale) => sum + sale.ganancia, 0))
    const diasConVenta = ventasReales.filter((sale) => sale.qty > 0).length
    const promedioVentaDiaria = diasConVenta > 0 ? round2(unidadesVendidas / diasConVenta) : 0
    const coberturaDias = promedioVentaDiaria > 0 ? round2(prod.currentStock / promedioVentaDiaria) : null
    const stockStatus = prod.currentStock <= 0.001
      ? 'agotado'
      : coberturaDias == null
        ? 'sin-ritmo'
        : coberturaDias <= 1
          ? 'critico'
          : coberturaDias <= 3
            ? 'bajo'
            : 'normal'
    const entryDates = entradasHistorial.map((e) => e.date)
    products.push({
      ...prod,
      productKey: key,
      unidadesVendidas,
      ventaHistorica,
      gananciaHistorica,
      diasConVenta,
      promedioVentaDiaria,
      coberturaDias,
      stockStatus,
      precioVentaVigente,
      precioVentaFuente: precioVentaVigente != null ? 'ipv' : null,
      precioCambioHoy,
      costoPromedio,
      costoUltimaEntrada,
      precioCompraVigente,
      gananciaUnidad,
      margenPct,
      valorCosto: costoPromedio == null ? null : round2(prod.currentStock * costoPromedio),
      valorVenta: precioVentaVigente == null ? null : round2(prod.currentStock * precioVentaVigente),
      primeraVez: prod.firstSeen,
      primeraEntrada: entryDates.length ? entryDates[0] : null,
      ultimaEntrada: entryDates.length ? entryDates[entryDates.length - 1] : null,
      entradasHistorial,
      precioHistorial,
      cambiosPrecio,
      cambiosCosto,
      priceChecks,
      ultimoPriceCheck,
      menuFamily: autoMenuFamily(prod.dept, prod.name),
    })
    void bookByKey
  }
  products.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name))
  sinExplicar.sort((a, b) => (a.date < b.date ? 1 : -1) || a.name.localeCompare(b.name))
  return {
    products,
    descuadres: book.descuadres,
    latestDate: book.latestDate,
    totalProductos: products.length,
    conExistencia: products.filter((p) => p.currentStock > 0.001).length,
    sinExplicar,
  }
}

/* ============ Cambios de precio entre IPV (avisos, nunca aplicados) ============
   En el original estos cambios quedan como constancias persistidas al
   importar ('ipv-consecutivo' para la venta, 'ipv-entrada' para la
   compra). En el clon se derivan al leer del catálogo: el mismo
   contenido, sin escribir nada. Queen los SEÑALA; jamás aplica un
   cambio de precio sola. */

export function detectPriceChanges(daysIn) {
  const catalog = buildProductsCatalog(daysIn)
  const changes = []
  for (const p of catalog.products) {
    for (const e of p.precioHistorial) {
      if (e.oldPrice == null) continue
      changes.push({
        productKey: p.productKey, dept: p.dept, name: p.name, um: p.um,
        date: e.date, kind: 'venta', source: 'ipv-consecutivo',
        oldPrice: e.oldPrice, newPrice: e.newPrice,
      })
    }
    for (const e of p.entradasHistorial) {
      if (!e.distinto) continue
      changes.push({
        productKey: p.productKey, dept: p.dept, name: p.name, um: p.um,
        date: e.date, kind: 'compra', source: 'ipv-entrada',
        oldPrice: e.costoAnterior, newPrice: e.costoEntrada,
      })
    }
  }
  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name, 'es') || (a.kind < b.kind ? -1 : 1)))
  return changes
}

/* ============ Sugerencias de precio de Queen (original: computePriceSuggestions) ============
   Puerto fiel: metas 60 % elaborados / 35 % bebidas (solo los dos
   departamentos de bebidas cuentan como 'bebidas'; Cantina y Pizzas
   cuentan como elaborados, como en el original). La sugerencia
   MANTIENE la ganancia histórica del producto (regla del dueño): el
   piso es el precio de equilibrio con el gasto general; encima, el
   precio que conserva la ganancia que el negocio ya logró. Queen
   SUGIERE: nunca cambia un precio sola. */

export const PRICE_TARGET_ELABORADOS_PCT = 60
export const PRICE_TARGET_BEBIDAS_PCT = 35
export const PRICE_DEFAULT_OVERHEAD_PCT = 10

export function priceCategoryOf(dept) {
  const d = menuDeptOf(dept)
  return d === 'Bebidas alcohólicas' || d === 'Bebidas no alcohólicas' ? 'bebidas' : 'elaborados'
}

function roundUpToTen(n) {
  return Math.ceil(n / 10) * 10
}

export function buildPriceSuggestions(catalog, overheadPct = PRICE_DEFAULT_OVERHEAD_PCT) {
  const items = []
  let sinDatos = 0
  for (const p of catalog.products ?? []) {
    const category = priceCategoryOf(p.dept)
    const targetPct = category === 'bebidas' ? PRICE_TARGET_BEBIDAS_PCT : PRICE_TARGET_ELABORADOS_PCT
    const salePrice = p.precioVentaVigente ?? 0
    const costPrice = p.precioCompraVigente ?? 0
    if (!(salePrice > 0) || !(costPrice > 0)) {
      sinDatos += 1
      // Sin precio o sin costo no hay margen que analizar: se cuenta y
      // no se sugiere nada (nada inventado).
      items.push({
        productKey: p.productKey, name: p.name, dept: p.dept, um: p.um, category,
        salePrice: salePrice > 0 ? salePrice : null, costPrice: costPrice > 0 ? costPrice : null,
        marginPct: null, targetPct, status: 'sin-datos', breakEvenPrice: null,
        suggestedPrice: null, suggestionBasis: null, history: null,
      })
      continue
    }
    const marginPct = Math.round(((salePrice - costPrice) / salePrice) * 1000) / 10
    const breakEvenPrice = roundUpToTen(costPrice * (1 + overheadPct / 100))
    let status
    if (salePrice < costPrice) status = 'perdida'
    else if (salePrice < breakEvenPrice) status = 'riesgo'
    else if (marginPct < targetPct) status = 'bajo'
    else status = 'sano'
    // Sugerencia con memoria: mantener la ganancia histórica.
    let entradasTotales = 0
    let importeEntradas = 0
    for (const entrada of p.entradasHistorial ?? []) {
      entradasTotales += entrada.cantidad
      importeEntradas += entrada.importe
    }
    const costoPromedioHistorico = entradasTotales > 0 ? Math.round((importeEntradas / entradasTotales) * 100) / 100 : null
    let preciosVentaDistintos = 0
    let ventaPromedioHistorica = null
    if (p.precioHistorial && p.precioHistorial.length > 0) {
      const precios = []
      for (const evento of p.precioHistorial) if (evento.oldPrice != null && evento.oldPrice > 0) precios.push(evento.oldPrice)
      if (p.precioVentaVigente && p.precioVentaVigente > 0) precios.push(p.precioVentaVigente)
      const distintos = [...new Set(precios)]
      preciosVentaDistintos = distintos.length
      if (distintos.length > 0) ventaPromedioHistorica = Math.round((distintos.reduce((s, v) => s + v, 0) / distintos.length) * 100) / 100
    }
    let gananciaHistoricaUnitaria = null
    if (ventaPromedioHistorica != null && costoPromedioHistorico != null) {
      gananciaHistoricaUnitaria = Math.round((ventaPromedioHistorica - costoPromedioHistorico) * 100) / 100
    } else if ((p.unidadesVendidas ?? 0) > 0) {
      gananciaHistoricaUnitaria = Math.round(((p.gananciaHistorica ?? 0) / p.unidadesVendidas) * 100) / 100
    }
    let precioSugeridoHistorico = null
    if (gananciaHistoricaUnitaria != null) {
      precioSugeridoHistorico = roundUpToTen((costoPromedioHistorico ?? costPrice) + Math.max(0, gananciaHistoricaUnitaria))
    }
    let suggestedPrice
    let suggestionBasis
    if (precioSugeridoHistorico != null) {
      suggestedPrice = Math.max(breakEvenPrice, precioSugeridoHistorico)
      suggestionBasis = 'historico'
    } else {
      suggestedPrice = roundUpToTen((costPrice * (1 + overheadPct / 100)) / (1 - targetPct / 100))
      suggestionBasis = 'meta'
    }
    items.push({
      productKey: p.productKey, name: p.name, dept: p.dept, um: p.um, category,
      salePrice, costPrice, marginPct, targetPct, status, breakEvenPrice, suggestedPrice, suggestionBasis,
      history: {
        entradasRegistradas: entradasTotales,
        costoPromedioHistorico,
        preciosVentaRegistrados: preciosVentaDistintos,
        ventaPromedioHistorica,
        margenHistoricoPct: ventaPromedioHistorica != null && ventaPromedioHistorica > 0 && costoPromedioHistorico != null
          ? Math.round(((ventaPromedioHistorica - costoPromedioHistorico) / ventaPromedioHistorica) * 1000) / 10
          : null,
        diasConVenta: p.diasConVenta ?? 0,
        precioSugeridoHistorico,
      },
    })
  }
  const withMargin = items.filter((i) => i.marginPct != null)
  const avgOf = (list) => (list.length ? Math.round((list.reduce((s, i) => s + i.marginPct, 0) / list.length) * 10) / 10 : null)
  const counts = { perdida: 0, riesgo: 0, bajo: 0, sano: 0 }
  for (const i of withMargin) counts[i.status] += 1
  items.sort((a, b) => (a.marginPct ?? Number.POSITIVE_INFINITY) - (b.marginPct ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name, 'es'))
  return {
    targets: { elaborados: PRICE_TARGET_ELABORADOS_PCT, bebidas: PRICE_TARGET_BEBIDAS_PCT },
    overheadPct,
    averages: {
      elaborados: avgOf(withMargin.filter((i) => i.category === 'elaborados')),
      bebidas: avgOf(withMargin.filter((i) => i.category === 'bebidas')),
      general: avgOf(withMargin),
    },
    sinDatos,
    counts,
    items,
  }
}

/* ============ Almacén (foto del IPV) y salidas → gasto ============
   El almacén del clon se lee de la foto de almacén que trae cada IPV
   (el registro manual con fotos/códigos del original vive en su base
   y no viaja). Regla del dueño (2026-10-20): una salida SOLO se
   convierte en gasto si el producto tiene costo vigente verificado
   (precioCompraVigente del catálogo por nombre exacto normalizado, sin
   ambigüedad; si no, el precio de compra que la propia foto registra).
   Sin costo: queda señalada como pendiente de costo, sin gasto. */

export function warehouseProductKey(product) {
  return normalizeLoose(product ?? '')
}

export function buildWarehouse(daysIn, catalog) {
  const days = [...(daysIn ?? [])].filter((d) => d && d.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  // Costo vigente por nombre normalizado; si el nombre coincide con
  // productos de costos distintos, el costo es ambiguo y no se usa.
  const costByName = new Map()
  for (const p of catalog?.products ?? []) {
    if (!(p.precioCompraVigente > 0)) continue
    const k = warehouseProductKey(p.name)
    if (!costByName.has(k)) costByName.set(k, new Set())
    costByName.get(k).add(p.precioCompraVigente)
  }
  const resolveCost = (product, fotoPrecio) => {
    const set = costByName.get(warehouseProductKey(product))
    if (set && set.size === 1) return { costo: [...set][0], fuente: 'catalogo' }
    if (set && set.size > 1) return { costo: null, fuente: 'ambiguo' }
    if (fotoPrecio > 0) return { costo: fotoPrecio, fuente: 'foto-ipv' }
    return { costo: null, fuente: 'sin-costo' }
  }
  const rows = []
  const byProduct = new Map()
  for (const day of days) {
    for (const w of day.warehouse ?? []) {
      if (!String(w.product ?? '').trim()) continue
      const row = { date: day.date, ...w }
      rows.push(row)
      const k = warehouseProductKey(w.product)
      const cur = byProduct.get(k) ?? {
        key: k, product: w.product, um: w.um, saldo: 0, lastDate: null,
        entradas: 0, bajas: 0, salidas: 0, fotos: 0, costoResuelto: null,
      }
      cur.entradas += w.entrada ?? 0
      cur.bajas += w.baja ?? 0
      cur.salidas += w.salida ?? 0
      cur.fotos += 1
      if (cur.lastDate == null || day.date >= cur.lastDate) {
        cur.saldo = w.saldoFinal ?? 0
        cur.lastDate = day.date
        cur.um = w.um
      }
      byProduct.set(k, cur)
    }
  }
  const salidas = []
  const pendientesCosto = new Set()
  for (const row of rows) {
    if (!((row.salida ?? 0) > 0)) continue
    const { costo, fuente } = resolveCost(row.product, row.precioCompra ?? 0)
    const importe = costo != null ? round2(row.salida * costo) : null
    if (importe == null) pendientesCosto.add(row.product)
    salidas.push({
      date: row.date, product: row.product, um: row.um, cantidad: row.salida,
      precioCompraFoto: row.precioCompra ?? 0, costoVigente: costo, fuenteCosto: fuente,
      importe,
      estado: importe != null ? 'con-costo' : 'pendiente-costo',
      // Gasto enlazado como lo crearía el original (vista calculada;
      // no se inyecta en Gastos para no duplicar cifras verificadas).
      gasto: importe != null
        ? { origin: 'almacen', sourceKey: `ipv-almacen:${row.date}::${warehouseProductKey(row.product)}`, date: row.date, concept: row.product, quantity: row.salida, unitValue: costo, total: importe }
        : null,
    })
  }
  const balances = [...byProduct.values()].map((b) => {
    const { costo } = resolveCost(b.product, 0)
    return { ...b, costoVigente: costo, sinCosto: costo == null }
  }).sort((a, b) => a.product.localeCompare(b.product, 'es'))
  for (const b of balances) if (b.sinCosto) pendientesCosto.add(b.product)
  return {
    rows,
    balances,
    salidas,
    pendientesCosto: [...pendientesCosto].sort((a, b) => a.localeCompare(b, 'es')),
    totals: {
      productos: balances.length,
      fotos: rows.length,
      entradas: round2(rows.reduce((s, r) => s + (r.entrada ?? 0), 0)),
      bajas: round2(rows.reduce((s, r) => s + (r.baja ?? 0), 0)),
      salidas: round2(rows.reduce((s, r) => s + (r.salida ?? 0), 0)),
      importeSalidasConCosto: round2(salidas.reduce((s, x) => s + (x.importe ?? 0), 0)),
    },
  }
}

/* ============ Regla de cocina del menú (vigilancia) ============
   El menú de clientes NUNCA lleva camarón, langosta, res ni tortuga
   (regla del dueño). Esta función es la vigilancia que usará la fase
   de Menú: señala nombres de MENÚ que la violan. No se aplica al
   catálogo de productos del IPV (la plantilla interna no es el menú). */

const MENU_BANNED_WORDS = ['camaron', 'camarones', 'langosta', 'langostas', 'tortuga', 'tortugas']

export function findMenuRuleConflicts(menuItemNames) {
  const out = []
  for (const name of menuItemNames ?? []) {
    const loose = normalizeLoose(name)
    const words = loose.split(/[^a-z0-9]+/).filter(Boolean)
    if (MENU_BANNED_WORDS.some((w) => words.includes(w)) || words.includes('res')) {
      out.push({ name, motivo: 'Regla de cocina: el menú nunca lleva camarón, langosta, res ni tortuga.' })
    }
  }
  return out
}

/* ============ Referencias de paquetes (Elaboración · Paquetes) ============
   Puerto del aprendizaje del original (learnPackageFromExpense +
   loadPackageReferences), calculado AL LEER sobre los gastos y las
   referencias guardadas:
   - Gasto que coincide con una referencia → su valor unitario es el
     precio nuevo del formato: si difiere más de un 0,5 % y no es más
     viejo que el último precio, la referencia aprende el precio y
     queda la constancia en el historial (fuente «gasto»).
   - Gasto nuevo con el rendimiento escrito («20 cabezas») → se
     archiva SOLO como referencia nueva (virtual hasta que el dueño la
     confirme con un toque: en el clon nada se guarda solo).
   - Gasto con formato (ristra, caja, saco…) sin rendimiento legible →
     sugerencia de Queen para completarla con un toque.
   Los gastos de nómina automática, de «Cuentas» del IPV y de almacén
   no son compras de insumos y se excluyen, como en el original. */

export function packageDerivedCosts(packageCost, unitsPerPackage, subUnitsPerUnit) {
  const unitCost = unitsPerPackage > 0 ? packageCost / unitsPerPackage : 0
  const totalSubUnits = unitsPerPackage > 0 && subUnitsPerUnit > 0 ? unitsPerPackage * subUnitsPerUnit : null
  const subUnitCost = totalSubUnits != null && totalSubUnits > 0 ? packageCost / totalSubUnits : null
  return { unitCost, totalSubUnits, subUnitCost }
}

const PACKAGE_FORMAT_WORDS = ['ristra', 'paquete', 'caja', 'saco', 'mano', 'cesta', 'bolsa', 'carton', 'huacal', 'lata', 'pomo', 'botella', 'galon', 'bidon', 'cubeta', 'tanqueta']
const PACKAGE_NAME_STOPWORDS = new Set(['para', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'y', 'a'])

export function detectPackageLabel(concept) {
  const words = normalizeLoose(concept).split(/[^a-z0-9]+/).filter(Boolean)
  for (const word of words) {
    if (PACKAGE_FORMAT_WORDS.includes(word)) return word === 'carton' ? 'cartón' : word
  }
  return null
}

export function matchPackageReference(concept, refs) {
  const conceptLoose = normalizeLoose(concept)
  if (!conceptLoose) return null
  const conceptWords = new Set(conceptLoose.split(/[^a-z0-9]+/).filter(Boolean))
  let best = null
  let bestScore = 0
  for (const ref of refs ?? []) {
    const nameLoose = normalizeLoose(ref.name)
    let score = 0
    if (nameLoose && conceptLoose.includes(nameLoose)) {
      score += 3
    } else {
      const tokens = nameLoose.split(/[^a-z0-9]+/).filter((token) => token && !PACKAGE_NAME_STOPWORDS.has(token))
      if (tokens.length > 0) {
        const hits = tokens.filter((token) => conceptWords.has(token)).length
        if (hits > 0 && hits / tokens.length >= 0.5) score += 2
      }
    }
    if (score === 0) continue
    const labelLoose = normalizeLoose(ref.packageLabel || 'paquete')
    if (labelLoose && conceptWords.has(labelLoose)) score += 1
    if (ref.variety && conceptLoose.includes(normalizeLoose(ref.variety))) score += 1
    if (score > bestScore) { best = ref; bestScore = score }
  }
  return bestScore >= 2 ? best : null
}

const YIELD_SKIP_WORDS = new Set([...PACKAGE_FORMAT_WORDS, 'lb', 'lbs', 'libra', 'libras', 'kg', 'kilo', 'kilos', 'gramo', 'gramos', 'ml', 'litro', 'litros', 'onza', 'onzas', 'cada', 'trae', 'aprox', 'aproximadamente', 'unidad', 'unidades', 'precio', 'costo', 'total', 'aproximado'])

export function parseYieldFromText(text) {
  const loose = normalizeLoose(text)
  for (const match of loose.matchAll(/(\d+(?:[.,]\d+)?)\s+([a-z]{3,})/g)) {
    const units = Number((match[1] ?? '').replace(',', '.'))
    const word = match[2] ?? ''
    if (!(units > 0) || !word || YIELD_SKIP_WORDS.has(word) || PACKAGE_NAME_STOPWORDS.has(word)) continue
    return { units, unitLabel: word }
  }
  return null
}

function suggestedNameFromConcept(conceptKey, extraSkip) {
  const words = conceptKey.split(/[^a-z0-9]+/).filter((word) => word && !/^\d+$/.test(word) && !extraSkip.has(word) && !PACKAGE_NAME_STOPWORDS.has(word))
  return words.length ? words.join(' ').replace(/^./, (c) => c.toUpperCase()) : ''
}

const packageExpenseEligible = (e) => e && e.origin !== 'auto-rh' && e.origin !== 'ipv-cuentas' && e.origin !== 'almacen'

function entryFromObservation(obs, packageId, packageName, seq) {
  const derived = packageDerivedCosts(obs.packageCost ?? 0, obs.unitsPerPackage ?? 0, obs.subUnitsPerUnit ?? 0)
  return {
    id: obs.id ?? `obs-${packageId}-${seq}`,
    packageId, packageName,
    recordedOn: obs.recordedOn ?? '',
    packageCost: obs.packageCost ?? 0,
    unitsPerPackage: obs.unitsPerPackage ?? 0,
    subUnitsPerUnit: obs.subUnitsPerUnit ?? 0,
    unitCost: derived.unitCost,
    subUnitCost: derived.subUnitCost,
    note: obs.note ?? '',
    source: obs.source === 'gasto' ? 'gasto' : 'manual',
    sourceRef: obs.sourceRef ?? '',
    place: obs.place ?? '',
    presentation: obs.presentation ?? '',
    seq,
  }
}

export function derivePackageReferences(storedRefs, expenses) {
  // Referencias de trabajo: las guardadas + las que Queen archiva
  // sola desde Gastos durante esta misma lectura (virtuales).
  const work = []
  for (const ref of storedRefs ?? []) {
    const entries = (ref.observations ?? []).map((obs, i) => entryFromObservation(obs, ref.id, ref.name, i))
    entries.sort((a, b) => (a.recordedOn < b.recordedOn ? 1 : a.recordedOn > b.recordedOn ? -1 : b.seq - a.seq))
    work.push({
      id: ref.id, stored: true, aprendida: false,
      name: ref.name ?? '', variety: ref.variety ?? '', packageLabel: ref.packageLabel || 'paquete',
      unitLabel: ref.unitLabel ?? '', unitsPerPackage: ref.unitsPerPackage ?? 0,
      subUnitLabel: ref.subUnitLabel ?? '', subUnitsPerUnit: ref.subUnitsPerUnit ?? 0,
      supplier: ref.supplier ?? '', note: ref.note ?? '',
      lastSource: entries.length && entries[0].source === 'gasto' ? 'gasto' : 'manual',
      packageCost: entries.length ? entries[0].packageCost : null,
      entries,
    })
  }
  const suggestions = []
  const chronological = (expenses ?? []).filter(packageExpenseEligible)
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const expense of chronological) {
    if (!(expense.total > 0) || !(expense.quantity >= 1) || !String(expense.concept ?? '').trim()) continue
    const candidate = Math.round((expense.unitValue > 0 ? expense.unitValue : expense.total / expense.quantity) * 100) / 100
    if (!(candidate > 0)) continue
    const conceptKey = normalizeLoose(expense.concept)
    const matched = matchPackageReference(expense.concept, work)
    if (matched) {
      const latestHist = matched.entries[0] ?? null
      const isOlderThanLatest = latestHist != null && expense.date < latestHist.recordedOn
      const current = matched.packageCost
      const tolerance = Math.max(1, (current ?? 0) * 0.005)
      if (!isOlderThanLatest && current != null && Math.abs(candidate - current) > tolerance) {
        matched.entries.unshift(entryFromObservation({
          id: `gasto-${expense.id}`,
          recordedOn: expense.date,
          packageCost: candidate,
          unitsPerPackage: matched.unitsPerPackage,
          subUnitsPerUnit: matched.subUnitsPerUnit,
          note: `Aprendido de Gastos: «${String(expense.concept).trim()}» — ${expense.quantity} × ${Math.round(expense.unitValue)} CUP.`,
          source: 'gasto',
          sourceRef: `${String(expense.concept).trim()} · gasto del ${expense.date}`,
          presentation: matched.packageLabel || 'paquete',
        }, matched.id, matched.name, matched.entries.length))
        matched.packageCost = candidate
        matched.lastSource = 'gasto'
        matched.aprendida = true
      }
      for (let i = suggestions.length - 1; i >= 0; i--) if (suggestions[i].conceptKey === conceptKey) suggestions.splice(i, 1)
      continue
    }
    const labelDetected = detectPackageLabel(expense.concept)
    const textLoose = normalizeLoose(`${expense.concept} ${expense.note ?? ''}`)
    const label = labelDetected ?? (/\b(lb|lbs|libra|libras)\b/.test(textLoose) ? 'libra' : 'paquete')
    const parsed = parseYieldFromText(`${expense.concept} ${expense.note ?? ''}`)
    if (parsed) {
      const skip = new Set([normalizeLoose(label), normalizeLoose(parsed.unitLabel)])
      const name = suggestedNameFromConcept(conceptKey, skip) || String(expense.concept).trim()
      const id = `auto:${conceptKey}`
      const entry = entryFromObservation({
        id: `gasto-${expense.id}`,
        recordedOn: expense.date,
        packageCost: candidate,
        unitsPerPackage: parsed.units,
        subUnitsPerUnit: 0,
        note: `Archivado automáticamente desde Gastos: «${String(expense.concept).trim()}» — ${expense.quantity} × ${Math.round(expense.unitValue)} CUP.`,
        source: 'gasto',
        sourceRef: `${String(expense.concept).trim()} · gasto del ${expense.date}`,
        presentation: label,
      }, id, name, 0)
      work.push({
        id, stored: false, aprendida: true,
        name, variety: '', packageLabel: label, unitLabel: parsed.unitLabel,
        unitsPerPackage: parsed.units, subUnitLabel: '', subUnitsPerUnit: 0,
        supplier: '', note: `Archivado automáticamente desde Gastos: «${String(expense.concept).trim()}» del ${expense.date}.`,
        lastSource: 'gasto', packageCost: candidate, entries: [entry],
      })
      for (let i = suggestions.length - 1; i >= 0; i--) if (suggestions[i].conceptKey === conceptKey) suggestions.splice(i, 1)
      continue
    }
    if (!labelDetected) continue
    const skip = new Set([normalizeLoose(labelDetected)])
    const suggestedName = suggestedNameFromConcept(conceptKey, skip) || String(expense.concept).trim()
    const suggestion = {
      conceptKey, concept: String(expense.concept).trim(), date: expense.date,
      quantity: expense.quantity, unitValue: candidate, total: expense.total,
      packageLabel: labelDetected, suggestedName,
    }
    const existingIndex = suggestions.findIndex((item) => item.conceptKey === conceptKey)
    if (existingIndex >= 0) suggestions[existingIndex] = suggestion
    else suggestions.unshift(suggestion)
  }

  // Derivados por referencia (los mismos del original).
  const packages = work.map((w) => {
    const entries = w.entries
    const latest = entries[0] ?? null
    const sameUnitsEntries = entries.filter((entry) => Math.abs(entry.unitsPerPackage - w.unitsPerPackage) < 0.001)
    const currentIdx = w.packageCost == null ? -1 : sameUnitsEntries.findIndex((entry) => Math.abs(entry.packageCost - w.packageCost) < 0.001)
    const previous = currentIdx >= 0 ? (sameUnitsEntries[currentIdx + 1] ?? null) : (sameUnitsEntries[0] ?? null)
    const derived = packageDerivedCosts(w.packageCost ?? 0, w.unitsPerPackage, w.subUnitsPerUnit)
    const previousCost = previous ? previous.packageCost : null
    const changeAmount = previousCost != null && w.packageCost != null ? w.packageCost - previousCost : null
    const changePct = previousCost != null && previousCost > 0 && changeAmount != null ? (changeAmount / previousCost) * 100 : null
    const trend = previousCost == null ? 'sin-historial' : changeAmount != null && changeAmount > 0.001 ? 'subio' : changeAmount != null && changeAmount < -0.001 ? 'bajo' : 'igual'
    const observedUnitCosts = entries.map((entry) => entry.unitCost).filter((value) => value > 0)
    const fairUnitCost = observedUnitCosts.length > 0 ? Math.round((observedUnitCosts.reduce((sum, value) => sum + value, 0) / observedUnitCosts.length) * 100) / 100 : null
    return {
      id: w.id, stored: w.stored, aprendida: w.aprendida,
      name: w.name, variety: w.variety, packageLabel: w.packageLabel || 'paquete',
      unitLabel: w.unitLabel, unitsPerPackage: w.unitsPerPackage,
      packageCost: w.packageCost,
      subUnitLabel: w.subUnitLabel, subUnitsPerUnit: w.subUnitsPerUnit,
      supplier: w.supplier, note: w.note, lastSource: w.lastSource,
      costPerUnit: w.packageCost == null ? null : derived.unitCost,
      totalSubUnitsPerPackage: derived.totalSubUnits,
      costPerSubUnit: w.packageCost == null ? null : derived.subUnitCost,
      previousCost, changeAmount, changePct, trend,
      historyCount: entries.length,
      lastRecordedOn: latest ? latest.recordedOn : null,
      fairUnitCost,
      fairPackageCost: fairUnitCost != null ? Math.round(fairUnitCost * w.unitsPerPackage * 100) / 100 : null,
      minUnitCost: observedUnitCosts.length > 0 ? Math.min(...observedUnitCosts) : null,
      maxUnitCost: observedUnitCosts.length > 0 ? Math.max(...observedUnitCosts) : null,
      entries,
    }
  })
  packages.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  // Historial global (orden cronológico inverso, como el original).
  const allEntries = []
  for (const p of packages) for (const e of p.entries) allEntries.push(e)
  allEntries.sort((a, b) => (a.recordedOn < b.recordedOn ? 1 : a.recordedOn > b.recordedOn ? -1 : b.seq - a.seq))
  const history = allEntries.map((row, index, all) => {
    const prev = all.slice(index + 1).find((candidate) => candidate.packageId === row.packageId) ?? null
    const samePresentation = prev != null && Math.abs(prev.unitsPerPackage - row.unitsPerPackage) < 0.001
    const changeBasis = prev == null ? 'ninguna' : samePresentation ? 'paquete' : 'unidad'
    const prevCost = prev == null ? null : samePresentation ? prev.packageCost : prev.unitCost
    const changeAmount = prevCost != null ? (samePresentation ? row.packageCost : row.unitCost) - prevCost : null
    const changePct = prevCost != null && prevCost > 0 && changeAmount != null ? (changeAmount / prevCost) * 100 : null
    return { ...row, prevCost, changeAmount, changePct, changeBasis }
  })
  return { packages, history, suggestions }
}

/** Queen compara cada gasto entrante contra la referencia: el precio
 * del formato en el gasto (su valor unitario = precio por paquete
 * comprado) frente al costo justo del paquete (promedio de todas las
 * observaciones) o, sin historial, al precio vigente del paquete —
 * paquete contra paquete, como hace el aprendizaje del original. */
export function expenseComparisons(expenses, packages) {
  const out = []
  for (const expense of (expenses ?? []).filter(packageExpenseEligible)) {
    if (!(expense.total > 0) || !(expense.quantity >= 1)) continue
    const candidate = Math.round((expense.unitValue > 0 ? expense.unitValue : expense.total / expense.quantity) * 100) / 100
    if (!(candidate > 0)) continue
    const matched = matchPackageReference(expense.concept, packages ?? [])
    if (!matched) continue
    const refPackage = matched.fairPackageCost ?? matched.packageCost
    if (!(refPackage > 0)) continue
    const diffPct = Math.round(((candidate - refPackage) / refPackage) * 1000) / 10
    out.push({
      expenseId: expense.id, date: expense.date, concept: expense.concept,
      quantity: expense.quantity, unitValue: candidate, total: expense.total,
      referenceId: matched.id, referenceName: matched.name,
      refPackageCost: refPackage, refBasis: matched.fairPackageCost != null ? 'costo justo del paquete' : 'precio vigente del paquete',
      diffPct,
      verdict: Math.abs(diffPct) <= 0.5 ? 'en-linea' : diffPct > 0 ? 'mas-caro' : 'mas-barato',
    })
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1))
  return out
}
