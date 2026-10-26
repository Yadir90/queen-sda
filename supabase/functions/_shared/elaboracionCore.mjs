// Queen SDA — núcleo de Elaboración (fichas de costo).
//
// Puerto LITERAL de las fórmulas del original (su client/src/App.tsx,
// bloque de Elaboración ~19080–21375): ajustes globales y costos de
// cocción, merma automática por tipo de plato, totales de la ficha,
// rentabilidad contra el precio vigente y el volcado a la exportación
// XLSX (CostSheetExport de ipvRoundTrip.ts). Nada de esto se
// reimplementó «parecido»: son las mismas cuentas, con las mismas
// constantes, para que el mismo dato dé el mismo centavo (eje
// REGLAS-Y-FORMULAS.md).
//
// Las fichas NO viajan en el respaldo (viven en la base del original):
// en esta copia nacen vacías y se crean/continúan aquí; los ingredientes
// se precian con lo que sí viaja (catálogo del IPV, gastos y
// referencias de paquetes).

/** Plantilla de Ajustes globales del original (ELABORATION_SETTINGS_FALLBACK). */
export const ELABORATION_SETTINGS_FALLBACK = {
  charcoalSackPrice: 1500, hoursPerSack: 40, stovePowerKw: 2, electricTariff: 10, charcoalTimePct: 70,
  defaultWastePct: 10, defaultOverheadPct: 10, defaultTargetMarginPct: 60, defaultVariationBufferPct: 15,
}

export function defaultElaborationStore() {
  return {
    recipes: [],
    removedProducts: [],
    manualProducts: [],
    settings: { ...ELABORATION_SETTINGS_FALLBACK },
    wasteLogs: [],
    ingredientHistory: [],
  }
}

/** Costo por hora de cada fuente de cocción y PROMEDIO PONDERADO. */
export function charcoalHourCost(settings) {
  return settings.hoursPerSack > 0 ? settings.charcoalSackPrice / settings.hoursPerSack : 0
}
export function electricHourCost(settings) {
  return settings.stovePowerKw * settings.electricTariff
}
export function cookingHourCost(settings) {
  const pct = Math.min(100, Math.max(0, settings.charcoalTimePct)) / 100
  return pct * charcoalHourCost(settings) + (1 - pct) * electricHourCost(settings)
}

/** Merma automática por tipo de plato (rangos del dueño, 2026-10-16):
 *  ensaladas 5–10 %, arroz y granos 0 %, frituras 15–20 %, plancha
 *  20–25 %, horneados 10–15 %; se sugiere el punto medio. */
export function dishWasteSuggestion(productName) {
  const name = ` ${productName.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '')} `
  const has = (...words) => words.some((word) => name.includes(word))
  const rule = (category, min, max) => ({ category, min, max, suggested: Math.round((min + max) / 2) })
  if (has('ensalada', 'crudo', 'vegetal')) return rule('ensalada / vegetales crudos', 5, 10)
  if (has('arroz', 'frijol', 'granos', 'congri', 'paella', 'garbanzo', 'lenteja', 'chicharo')) return rule('arroz y granos', 0, 0)
  if (has('frit', 'empaniz', 'croqueta', 'chicharrit', 'toston', 'salchipapa', 'empanada')) return rule('fritura', 15, 20)
  if (has('plancha', 'bistec', 'filete', 'grille', 'parrilla')) return rule('carne a la plancha', 20, 25)
  if (has('pizza', 'horno', 'hornead', 'asad', 'gratin')) return rule('horneado', 10, 15)
  return null
}

export const EMPTY_INGREDIENT = { ingredient: '', amountUsed: 0, unit: '', purchasePrice: 0, purchasedAmount: 0, note: '' }

/** Costo de UNA línea de ingrediente: cantidad usada × precio de
 *  compra ÷ rendimiento comprado. Sin rendimiento no hay costo (0),
 *  nunca se inventa. */
export function ingredientLineCost(item) {
  return item.purchasedAmount > 0 ? item.amountUsed * item.purchasePrice / item.purchasedAmount : 0
}

/** Totales EN VIVO de la ficha abierta (el useMemo `totals` del
 *  original): ingredientes, con merma, mano de obra prorrateada del
 *  salario diario, cocción al promedio ponderado, gastos generales,
 *  costo por ración/unidad, ganancia, margen, tolerancia y precio
 *  sugerido (redondeado hacia arriba a múltiplo de 5). */
export function recipeTotals(draft, laborWorker, hourCost, globals) {
  const ingredients = draft.ingredients.reduce((sum, item) => sum + ingredientLineCost(item), 0)
  const ingredientsWithWaste = ingredients * (1 + draft.wastePct / 100)
  const labor = laborWorker && draft.laborMinutes > 0 && draft.workdayHours > 0 ? laborWorker.dailySalary * draft.laborMinutes / (draft.workdayHours * 60) : 0
  const cooking = draft.cookingHours * hourCost
  const direct = ingredientsWithWaste + labor + cooking
  const overhead = direct * globals.defaultOverheadPct / 100
  const withWaste = direct + overhead
  const perServing = draft.servings > 0 ? withWaste / draft.servings : 0
  const perUnit = draft.servings > 0 && draft.unitsPerServing > 0 ? withWaste / (draft.servings * draft.unitsPerServing) : 0
  const profit = draft.salePrice - perServing
  const margin = draft.salePrice > 0 ? profit / draft.salePrice * 100 : 0
  const tolerance = perServing > 0 ? Math.max(0, (draft.salePrice / perServing - 1) * 100) : 0
  const targetBase = 1 - globals.defaultTargetMarginPct / 100
  const suggestedRaw = targetBase > 0 ? perServing / targetBase * (1 + globals.defaultVariationBufferPct / 100) : 0
  const suggested = suggestedRaw > 0 ? Math.ceil(suggestedRaw / 5) * 5 : 0
  return { ingredients, ingredientsWithWaste, labor, cooking, direct, overhead, withWaste, perServing, perUnit, profit, margin, tolerance, suggested }
}

/** Estado de la ficha (borrador o guardada): la misma lógica de tres
 *  estados del original — pérdida / margen bajo la meta / ganancia —
 *  y «incomplete» cuando falta precio o costo. El semáforo se lee en
 *  la ETIQUETA de la tarjeta: el borde es siempre neutro (regla del
 *  dueño, 2026-10-17, theme.css ~8783). */
export function recipeStatus(salePrice, perServing, profit, margin, targetMarginPct) {
  if (salePrice == null || salePrice <= 0 || perServing <= 0) return 'incomplete'
  if (profit != null && profit < 0) return 'loss'
  if (margin != null && margin < targetMarginPct) return 'low'
  return 'healthy'
}

/** Rentabilidad de las fichas GUARDADAS contra el precio de venta
 *  VIGENTE del catálogo (el useMemo `profitability` del original,
 *  con su orden: pérdida, margen bajo, rentables, incompletos). */
export function computeProfitability(recipes, products, settings, hourCost) {
  const statusOrder = { loss: 0, low: 1, healthy: 2, incomplete: 3 }
  const items = recipes.flatMap((recipe) => {
    const product = products.find((candidate) => candidate.productKey === recipe.productKey)
    if (!product) return []
    const ingredients = recipe.ingredients.reduce((sum, item) => sum + ingredientLineCost(item), 0)
    const ingredientsWithWaste = ingredients * (1 + recipe.wastePct / 100)
    const labor = recipe.laborMinutes > 0 && recipe.workdayHours > 0 ? recipe.laborDailySalarySnapshot * recipe.laborMinutes / (recipe.workdayHours * 60) : 0
    const directCost = ingredientsWithWaste + labor + recipe.cookingHours * hourCost
    const costPerServing = recipe.servings > 0 ? directCost * (1 + settings.defaultOverheadPct / 100) / recipe.servings : 0
    const currentSale = product.salePrice
    const profit = currentSale != null ? currentSale - costPerServing : null
    const margin = currentSale != null && currentSale > 0 && profit != null ? profit / currentSale * 100 : null
    const targetBase = 1 - settings.defaultTargetMarginPct / 100
    const targetPriceRaw = targetBase > 0 ? costPerServing / targetBase * (1 + settings.defaultVariationBufferPct / 100) : costPerServing
    const targetPrice = targetPriceRaw > 0 ? Math.ceil(targetPriceRaw / 5) * 5 : 0
    const status = recipeStatus(currentSale, costPerServing, profit, margin, settings.defaultTargetMarginPct)
    return [{ recipe, product, ingredients, labor, costPerServing, currentSale, profit, margin, targetPrice, status, targetMarginPct: settings.defaultTargetMarginPct }]
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (a.profit ?? Number.POSITIVE_INFINITY) - (b.profit ?? Number.POSITIVE_INFINITY) || a.product.name.localeCompare(b.product.name, 'es'))
  const losses = items.filter((item) => item.status === 'loss')
  const summary = {
    losses: losses.length,
    lossPerRound: losses.reduce((sum, item) => sum + Math.abs(item.profit ?? 0), 0),
    low: items.filter((item) => item.status === 'low').length,
    healthy: items.filter((item) => item.status === 'healthy').length,
    incomplete: items.filter((item) => item.status === 'incomplete').length,
  }
  return { items, summary }
}

/** Volcado de una ficha al formato de exportación XLSX
 *  (CostSheetExport de ipvRoundTrip.ts), con los escenarios
 *  +0/+10/+20 % del original. `figures` sale de recipeTotals para la
 *  ficha abierta o se recalcula aquí para una guardada. */
export function costSheetExport(recipe, figures, settings, hourCost, date) {
  const { totals, laborWorkerName } = figures
  return {
    productName: recipe.productName,
    dept: recipe.dept,
    date,
    currency: recipe.currency,
    servings: recipe.servings,
    unitsPerServing: recipe.unitsPerServing,
    wastePct: recipe.wastePct,
    laborWorkerName: laborWorkerName ?? recipe.laborWorkerName ?? '',
    laborMinutes: recipe.laborMinutes,
    laborCost: totals.labor,
    cookingHours: recipe.cookingHours,
    charcoalUsePct: settings.charcoalTimePct,
    cookingCostPerHour: hourCost,
    cookingCost: totals.cooking,
    overheadPct: settings.defaultOverheadPct,
    overheadCost: totals.overhead,
    salePrice: recipe.salePrice,
    targetMarginPct: settings.defaultTargetMarginPct,
    variationBufferPct: settings.defaultVariationBufferPct,
    ingredientsRawCost: totals.ingredients,
    ingredientsCost: totals.ingredientsWithWaste,
    tolerancePct: totals.tolerance,
    totalRecipeCost: totals.withWaste,
    costPerServing: totals.perServing,
    costPerUnit: totals.perUnit,
    profitPerServing: totals.profit,
    marginPct: totals.margin,
    suggestedPrice: totals.suggested,
    scenarios: [0, 10, 20].map((rise) => {
      const scenarioCost = totals.perServing * (1 + rise / 100)
      return { rise, costPerServing: scenarioCost, profit: recipe.salePrice - scenarioCost, marginPct: recipe.salePrice > 0 ? (recipe.salePrice - scenarioCost) / recipe.salePrice * 100 : 0 }
    }),
    ingredients: recipe.ingredients.map((item) => ({ ...item, cost: ingredientLineCost(item) })),
  }
}

/** Personas de mano de obra: las del RH del ÚLTIMO IPV importado
 *  (nombre, ocupación, salario diario y días), como las sirve el
 *  original en laborWorkers. workerKey = clave canónica del nombre. */
export function laborWorkersFromDays(days, canonicalKey) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1))
  for (let i = sorted.length - 1; i >= 0; i--) {
    const day = sorted[i]
    if (Array.isArray(day.rh) && day.rh.length > 0) {
      return day.rh.map((w) => ({
        workerKey: canonicalKey(w.nombre),
        name: w.nombre,
        occupation: w.ocupacion ?? '',
        dailySalary: w.salarioDiario ?? 0,
        daysWorked: w.dias ?? 0,
        sourceDate: day.date,
      }))
    }
  }
  return []
}

/** Historial de precios de ingredientes (el useMemo
 *  `ingredientInsights` del original): agrupa por ingrediente+unidad,
 *  último contra anterior distinto, con alternativas más baratas de
 *  la misma unidad cuando la subida es ≥ 20 %. */
export function ingredientInsights(history) {
  const groups = new Map()
  for (const row of history) {
    const key = `${row.ingredient.trim().toLocaleLowerCase('es')}::${row.unit.trim().toLocaleLowerCase('es')}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const latestByGroup = [...groups.entries()].flatMap(([key, entries]) => {
    const sorted = [...entries].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || String(b.id).localeCompare(String(a.id)))
    const latest = sorted[0]
    if (!latest) return []
    const previous = sorted.find((entry) => entry.id !== latest.id && Math.abs(entry.unitCost - latest.unitCost) > 0.000001) ?? null
    const risePct = previous && previous.unitCost > 0 ? (latest.unitCost - previous.unitCost) / previous.unitCost * 100 : null
    return [{ key, latest, previous, risePct, entries: sorted }]
  })
  return latestByGroup.map((group) => ({
    ...group,
    alternatives: latestByGroup.filter((candidate) => candidate.key !== group.key && candidate.latest.unit.trim().toLocaleLowerCase('es') === group.latest.unit.trim().toLocaleLowerCase('es') && candidate.latest.unitCost < group.latest.unitCost).sort((a, b) => a.latest.unitCost - b.latest.unitCost).slice(0, 3),
  })).sort((a, b) => (b.risePct ?? -Infinity) - (a.risePct ?? -Infinity) || a.latest.ingredient.localeCompare(b.latest.ingredient, 'es'))
}
