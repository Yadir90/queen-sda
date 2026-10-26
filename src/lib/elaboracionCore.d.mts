export interface ElaborationSettingsShape {
  charcoalSackPrice: number
  hoursPerSack: number
  stovePowerKw: number
  electricTariff: number
  charcoalTimePct: number
  defaultWastePct: number
  defaultOverheadPct: number
  defaultTargetMarginPct: number
  defaultVariationBufferPct: number
}
export interface ElaborationIngredientShape {
  ingredient: string
  amountUsed: number
  unit: string
  purchasePrice: number
  purchasedAmount: number
  note: string
}
export interface ElaborationRecipeShape {
  id: string
  productKey: string
  productName: string
  dept: string
  manual: boolean
  currency: string
  servings: number
  unitsPerServing: number
  wastePct: number
  salePrice: number
  laborWorkerKey: string
  laborWorkerName: string
  laborDailySalarySnapshot: number
  laborMinutes: number
  workdayHours: number
  cookingHours: number
  ingredients: ElaborationIngredientShape[]
  updatedAt: string
  archived: boolean
  restorable: boolean
}
export interface ElaborationWasteLogShape {
  id: string
  productKey: string
  productName: string
  preparedOn: string
  preparedServings: number
  baseAmount: number
  actualWasteAmount: number
  actualWastePct: number
  estimatedWastePct: number
  reason: string
  note: string
}
export interface ElaborationIngredientHistoryShape {
  id: string
  ingredient: string
  unit: string
  unitCost: number
  productName: string
  recordedOn: string
}
export interface ElaborationStoreShape {
  recipes: ElaborationRecipeShape[]
  removedProducts: Array<{ productKey: string; productName: string; dept: string; manual: boolean }>
  manualProducts: Array<{ productKey: string; name: string; dept: string }>
  settings: ElaborationSettingsShape
  wasteLogs: ElaborationWasteLogShape[]
  ingredientHistory: ElaborationIngredientHistoryShape[]
}
export interface RecipeTotals {
  ingredients: number
  ingredientsWithWaste: number
  labor: number
  cooking: number
  direct: number
  overhead: number
  withWaste: number
  perServing: number
  perUnit: number
  profit: number
  margin: number
  tolerance: number
  suggested: number
}
export interface LaborWorker {
  workerKey: string
  name: string
  occupation: string
  dailySalary: number
  daysWorked: number
  sourceDate: string
}
export type RecipeStatus = 'loss' | 'low' | 'healthy' | 'incomplete'
export interface ProfitabilityItem {
  recipe: ElaborationRecipeShape
  product: { productKey: string; name: string; dept: string; salePrice: number | null }
  ingredients: number
  labor: number
  costPerServing: number
  currentSale: number | null
  profit: number | null
  margin: number | null
  targetPrice: number
  status: RecipeStatus
  targetMarginPct: number
}

export declare const ELABORATION_SETTINGS_FALLBACK: ElaborationSettingsShape
export declare function defaultElaborationStore(): ElaborationStoreShape
export declare function charcoalHourCost(settings: ElaborationSettingsShape): number
export declare function electricHourCost(settings: ElaborationSettingsShape): number
export declare function cookingHourCost(settings: ElaborationSettingsShape): number
export declare function dishWasteSuggestion(productName: string): { category: string; min: number; max: number; suggested: number } | null
export declare const EMPTY_INGREDIENT: ElaborationIngredientShape
export declare function ingredientLineCost(item: ElaborationIngredientShape): number
export declare function recipeTotals(draft: { ingredients: ElaborationIngredientShape[]; wastePct: number; laborMinutes: number; workdayHours: number; cookingHours: number; servings: number; unitsPerServing: number; salePrice: number }, laborWorker: LaborWorker | null, hourCost: number, globals: ElaborationSettingsShape): RecipeTotals
export declare function recipeStatus(salePrice: number | null, perServing: number, profit: number | null, margin: number | null, targetMarginPct: number): RecipeStatus
export declare function computeProfitability(recipes: ElaborationRecipeShape[], products: Array<{ productKey: string; name: string; dept: string; salePrice: number | null }>, settings: ElaborationSettingsShape, hourCost: number): { items: ProfitabilityItem[]; summary: { losses: number; lossPerRound: number; low: number; healthy: number; incomplete: number } }
export declare function costSheetExport(recipe: ElaborationRecipeShape, figures: { totals: RecipeTotals; laborWorkerName?: string }, settings: ElaborationSettingsShape, hourCost: number, date: string): unknown
export declare function laborWorkersFromDays(days: Array<{ date: string; rh?: Array<{ nombre: string; ocupacion?: string; dias?: number; salarioDiario?: number }> }>, canonicalKey: (name: string) => string): LaborWorker[]
export declare function ingredientInsights(history: ElaborationIngredientHistoryShape[]): Array<{ key: string; latest: ElaborationIngredientHistoryShape; previous: ElaborationIngredientHistoryShape | null; risePct: number | null; entries: ElaborationIngredientHistoryShape[]; alternatives: Array<{ latest: ElaborationIngredientHistoryShape }> }>
