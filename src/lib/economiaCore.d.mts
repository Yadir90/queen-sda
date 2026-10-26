// Declaraciones de tipos para el núcleo compartido economiaCore.mjs
import type { DayData, Expense, LocalPayment, Receivable, TransferMovement } from '../types'

export declare const BANK_COMMISSION: number
export declare function isEffectiveMovement(m: TransferMovement | null | undefined): boolean

export interface TransferSummary {
  balance: number
  totalReceived: number
  totalIpvReceived: number
  totalPagoCuenta: number
  totalManualExtra: number
  manualExtraCount: number
  totalOut: number
  totalPases: number
  totalBankPassed: number
  totalTransferExpenses: number
  lastBankPase: { date: string; amount: number } | null
  movementsCount: number
  effectiveCount: number
  excludedCount: number
  supersededCount: number
}
export declare function transferSummary(movements: TransferMovement[]): TransferSummary

export interface DayConciliation {
  date: string
  dayImported: boolean
  ipv: number | null
  pagosCuenta: number
  otras: number
  registradas: number
  identificadas: number | null
  diferencia: number | null
  movements: TransferMovement[]
}
export declare function conciliationForDay(
  data: { days: DayData[]; transferMovements: TransferMovement[] },
  date: string,
): DayConciliation
export declare function conciliationDates(
  data: { days: DayData[]; transferMovements: TransferMovement[] },
  limit?: number,
): string[]

export declare function monthKeyOf(date: string): string
export declare function daysInMonthOf(monthKey: string): number
export declare function quarterMonthsOf(monthKey: string): string[]

export interface MonthEconomy {
  monthKey: string
  daysCount: number
  firstDay: string | null
  lastDay: string | null
  ventas: number
  bruta: number
  neta: number
  gastos: number
  gastosCount: number
  ingresosExtras: number
  ingresosExtrasCount: number
  extrasList: Array<{ date: string; concepto: string; importe: number }>
  billar: { venta: number; utilidad: number; dias: number }
  barra: number
  cocina: number
  deptSeen: boolean
  rentabilidad: Array<{ name: string; ventas: number; ganancia: number; margen: number | null }>
  inversion: number
  merma: number
  totalCobrado: number
  cobrosCount: number
  efectivoCaja: number | null
  zelleCierre: number | null
  divisasCierre: number | null
  cuentasPorCobrar: {
    total: number
    count: number
    clientes: number
    trabajadores: number
    administrativos: number
    dineroEnLaCalle: number
    morosasTotal: number
    morosasCount: number
  }
  consumo: { total: number; jesus: number; dayami: number; alejandro: number }
  resultado: number
  resultadoEfectivo: number
  reservas: {
    fondoVentasMes: number
    fondoVentasProgreso: number
    diasConIpv: number
    diasDelMes: number
    fondoUtilidadesTrimestre: number
    trimestreNeta: number
    trimestreDias: number
    trimestreProgreso: number
    trimestreDiasTotal: number
    trimestreMeses: string[]
  }
  quincenas: Array<{ from: string; to: string; days: number; ventas: number; bruta: number; neta: number; gastos: number; ingresosExtras: number; resultado: number }>
  gastosPorCategoria: Array<{ name: string; total: number }>
  gastosPorOrigen: Array<{ name: string; total: number }>
  expenses: Expense[]
}
export declare function monthEconomy(
  data: { days: DayData[]; expenses: Expense[]; receivables: Receivable[]; localPayments: LocalPayment[] },
  monthKey: string,
  today: string,
): MonthEconomy
export declare function availableMonths(
  data: { days: DayData[]; expenses: Expense[] },
  today: string,
): string[]
