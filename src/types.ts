// Queen SDA — tipos compartidos

import type { Bulletin } from './lib/documentosCore.mjs'
import type { QueenEvolutionSnapshot } from './lib/queenCore.mjs'
import type { AutomationRun, QueenLearningState } from './lib/automatizacionesCore.mjs'

export type { Bulletin }
export type { QueenEvolutionSnapshot }
export type { AutomationRun, QueenLearningState }
export type BulletinStatus = Bulletin['status']

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
  /** Costo unitario que declara la hoja del IPV ese día. */
  precioCosto: number
  um: string
  /** Cadena de existencias del IPV tal como viene: null = la celda no viene escrita. */
  saldoInicial: number | null
  disponible: number | null
  aLaVenta: number | null
  bajas: number
  traslados: number
  /** Saldo final del IPV (conteo físico si existenciaFuente='fisica'; teórico si no). */
  existenciaFinal: number | null
  existenciaFuente: string
}

/** Línea de «Entrada» de un día del IPV (mercancía que entró, a precio de compra). */
export interface DayEntryDetail {
  dept: string
  descripcion: string
  cantidad: number
  um: string
  precioCompra: number
  precioVenta: number
  importe: number
  codigo: string
}

/** Fila de la hoja «Almacén» de un día del IPV (foto de almacén). */
export interface WarehouseRow {
  product: string
  um: string
  saldoInicial: number
  entrada: number
  baja: number
  salida: number
  saldoFinal: number
  precioCompra: number
  valor: number
  observacion: string
}

export interface DayDepartment {
  name: string
  costo: number
  ganancia: number
  ventas: number
  products: DayProduct[]
}

/** Empleado de la foto de RH de un día (hoja RH del IPV). */
export interface DayRhEmployee {
  nombre: string
  ocupacion: string
  dias: number
  salarioDiario: number
  totalCobrar: number
  carnet: string
  cuentaBancaria: string
  movil: string
  /** Marcas por día (1, 0.5 o 0) alineadas con DayData.rhFechas. */
  marcas: number[]
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
    /** Cuentas del Desglose de este día, tal como vienen en el IPV. */
    cuentasDetalle?: Array<{ nombre: string; saldo: number; observacion: string }>
    /** Desglose por denominación del arqueo (lo usa el boletín). */
    billetes?: Array<{ cantidad: number; denominacion: number; subtotal: number }>
  }
  cuentasPagadas: unknown[]
  /** Foto de RH del día (solo si el registro del día la trae). */
  rh?: DayRhEmployee[]
  /** Fechas ISO de las columnas de días de la hoja RH, alineadas con las marcas. */
  rhFechas?: string[]
  /** Inversión del día: suma de «importe» de las entradas del IPV (a precio de compra). */
  entriesImporte: number
  /** Billar del día (tabla de juegos del IPV): venta y utilidad; null si el IPV no la trae. */
  billar: { venta: number; utilidad: number } | null
  /** Ingresos extras del día («ingresosEntradaMesas» del IPV: entradas, alquiler de mesas…). */
  extras: Array<{ concepto: string; importe: number }>
  /** Detalle de las entradas del día (mercancía que entró, con su precio de compra). */
  entriesDetail?: DayEntryDetail[]
  /** Foto de almacén del día (hoja «Almacén» del IPV), tal como entró. */
  warehouse?: WarehouseRow[]
}

/**
 * Observación de precio de una referencia de paquete (Elaboración ·
 * Paquetes y rendimientos): una compra concreta, registrada a mano o
 * archivada sola desde un gasto. Los costos por unidad se DERIVAN de
 * estos datos, nunca se escriben a mano (regla del original).
 */
export interface PackageObservation {
  id: string
  recordedOn: string
  packageCost: number
  unitsPerPackage: number
  subUnitsPerUnit: number
  place: string
  presentation: string
  note: string
  source: 'manual' | 'gasto'
  sourceRef: string
}

/**
 * Referencia de compra de Elaboración: cómo se compra un insumo (qué
 * trae un paquete y cuánto rinde) y cuánto cuesta. La guarda el dueño;
 * Queen solo sugiere las nuevas desde Gastos y compara precios.
 */
export interface PackageReference {
  id: string
  name: string
  variety: string
  packageLabel: string
  unitLabel: string
  unitsPerPackage: number
  subUnitLabel: string
  subUnitsPerUnit: number
  supplier: string
  note: string
  observations: PackageObservation[]
}

/**
 * Movimiento de la tarjeta del negocio (Transferencias). El historial
 * del respaldo viaja tal como el sistema original lo registró: importe
 * con signo (+ entra, − sale), marca «No es de La Reina» (excluded) y
 * anulaciones del propio original (superseded) — esta copia no
 * reescribe ningún importe ni recompone ningún asiento.
 */
export interface TransferMovement {
  id: string
  date: string
  type: 'abono' | 'pase' | 'gasto' | 'reversion'
  source: 'ipv' | 'pago-cuenta' | 'manual' | 'pase' | 'extra' | 'gasto-transferencia'
  amount: number
  detail: string
  excluded: boolean
  superseded: boolean
  paseId: number | null
  manualId: number | null
  paymentCreditId: number | null
  extraId: number | null
  transferExpenseId: number | null
  /** Clase del pase según el registro de pases del respaldo: 'banco' | 'efectivo'. */
  paseKind: 'banco' | 'efectivo' | null
  /** true si se registró en esta copia (no viene del respaldo). */
  local: boolean
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
  /** Identidad estable de la cuenta del IPV: «fecha::persona resuelta». */
  entryKey?: string | null
  /** Persona de la casa a la que pertenece el registro aparte (jesus/dayami/alejandro), si aplica. */
  persona?: string | null
  registro?: string | null
}

/** Gasto del negocio (del respaldo o automático del IPV/nómina). */
export interface Expense {
  id: string
  date: string
  concept: string
  category: string
  dept: string
  quantity: number
  unitValue: number
  total: number
  /** 'manual' | 'ipv-cuentas' | 'auto-rh' | otros orígenes del respaldo */
  origin: string
  /** «fecha::concepto» para los gastos detectados en el Desglose del IPV. */
  sourceKey: string | null
  /** Ciclo de la nómina que lo generó (gastos 'auto-rh'). */
  cycleStart: string | null
  note: string
}

/** Ficha única de un trabajador (registro de RH). */
export interface Worker {
  key: string
  nombre: string
  ocupacion: string
  carnet: string
  cuentaBancaria: string
  movil: string
  notas: string
  origen: 'ipv' | 'manual'
  /** 'direccion' (Jesús, Dayami): ficha informativa, fuera de nómina. */
  roleKind: 'direccion' | 'trabajador'
}

export interface PayrollEmployee {
  nombre: string
  ocupacion: string
  dias: number
  salarioDiario: number
  totalCobrar: number
  pagoEfectivo: number
  pagoTransferencia: number
  carnet: string
  cuentaBancaria: string
  movil: string
}

/** Nómina registrada (historial): el pago real de un ciclo de RH. */
export interface PayrollRecord {
  id: string
  cycleStart: string
  cycleEnd: string
  payDate: string
  total: number
  workersCount: number
  employees: PayrollEmployee[]
}

/** Alias aprendido de identidad: una variante → persona canónica. */
export interface PersonAlias {
  canonicalKey: string
  canonicalDisplay: string
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
  expenses: Expense[]
  workers: Worker[]
  payrollHistory: PayrollRecord[]
  /** Ancla de los ciclos de RH (15 días); def. 2026-09-23. */
  anchorDate: string
  /** Alias aprendidos de identidad de personas (no se pisan). */
  aliases: Record<string, PersonAlias>
  /** Clasificación aprendida por concepto: «gasto» o «cuenta». */
  learnedKinds: Record<string, string>
  /** Decisiones del dueño por entrada concreta: «fecha::clave». */
  cuentasOverrides: Record<string, string>
  /** Entradas suprimidas por el dueño (no se sincronizan). */
  suppressedEntries: string[]
  /** Interruptor «No pagado» de RH: claves de trabajador fuera de nómina. */
  unpaidWorkers: string[]
  /** Ajuste manual de nómina por ciclo (manda sobre la foto de RH). */
  payrollAdjustments: Record<string, PayrollEmployee[]>
  /** Historial de la tarjeta del negocio (Transferencias), del respaldo + registros locales. */
  transferMovements: TransferMovement[]
  /** Referencias de compra de Elaboración (paquetes y rendimientos), guardadas por el dueño. */
  packageReferences: PackageReference[]
  /** Cola de boletines diarios (uno por día importado; ver documentosCore). */
  bulletins: Bulletin[]
  /** Última medición de evolución de Queen guardada como dato (ver queenCore). */
  queenEvolution: QueenEvolutionSnapshot | null
  /** Registro de corridas de las automatizaciones (respaldo, mantenimiento, aprendizaje, boletines). */
  automationRuns: AutomationRun[]
  /** Estado persistente del aprendizaje nocturno de Queen (ver automatizacionesCore). */
  queenLearning: QueenLearningState | null
  expensesCount: number
  payrollCount: number
  workersCount: number
}

export type Section = 'inicio' | 'cobrar' | 'queen' | 'sistema' | 'mas' | 'dias' | 'cuentas' | 'rh' | 'economia' | 'transferencias' | 'productos' | 'elaboracion' | 'almacen' | 'laboratorio' | 'documentos' | 'historial'
