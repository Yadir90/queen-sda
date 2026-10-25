// Queen SDA — tipos compartidos

export type Role = 'admin' | 'lectura'
export type Category = 'cliente' | 'trabajador' | 'administrativo'

export interface Profile {
  id: string
  name: string
  email: string
  role: Role
}

export interface Session {
  profileId: string
  name: string
  email: string
  role: Role
}

export interface DayProduct {
  name: string
  category: string
  cantidadVendida: number
  precioVenta: number
  importeVenta: number
  ganancia: number
}

export interface DayDepartment {
  name: string
  costo: number
  ganancia: number
  ventas: number
  products: DayProduct[]
}

export interface DayData {
  date: string
  ventasDia: number
  gananciaBruta: number
  gananciaNeta: number
  cuadre: number
  departments: DayDepartment[]
  entriesCount: number
  gastosIpv: number
  mermasCosto: number
  fondos: {
    efectivo: number
    transferencias: number
    totalCuentasPorCobrar: number
    divisasCUP: number
    zelle: number
    totalFondos: number
    ventas: number
  }
  cuentasPagadas: unknown[]
}

export interface Payment {
  id: string
  amount: number
  paidDate: string
  paymentMethod: string
  local: boolean
}

export interface Receivable {
  id: string
  client: string
  clientKey: string
  category: Category
  date: string
  originalAmount: number
  amount: number
  saldoBase: number
  totalAbonadoBase: number
  payments: Payment[]
  status: string
  paidDate: string | null
  paymentMethod: string | null
  closeKind: string | null
  detail: string
  origin: string
}

/** Abono registrado localmente en Cobrar (capa sobre los datos importados). */
export interface LocalPayment {
  id: string
  receivableId: string
  clientKey: string
  amount: number
  date: string
  method: 'efectivo' | 'transferencia'
  createdAt: string
}

export interface BackupSummary {
  count: number
  from: string | null
  to: string | null
  ventas: number
  gananciaBruta: number
  gananciaNeta: number
  cuadreTotal: number
  allSquared: boolean
}

export interface StoredData {
  version: number
  importedAt: string | null
  exportedAt: string | null
  backupOf: string
  days: DayData[]
  receivables: Receivable[]
  localPayments: LocalPayment[]
  expensesCount: number
  payrollCount: number
  workersCount: number
}

export type Section = 'inicio' | 'cobrar' | 'queen' | 'sistema' | 'mas' | 'dias' | 'cuentas'
