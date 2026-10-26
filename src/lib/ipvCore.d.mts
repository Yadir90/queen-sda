// Declaraciones de tipos para el lector de IPV en Excel (ipvCore.mjs).
// Reflejan el DayPayload del lector original (client/src/xlsx.ts).

export interface IpvProduct {
  name: string
  category: string
  um: string
  cantidadVendida: number
  importeVenta: number
  ganancia: number
  bajas: number
  traslados: number
  precioCosto: number
  precioVenta: number
  existenciaFinal: number | null
  existenciaFuente: 'fisica' | 'teorica' | null
  saldoInicial: number | null
  disponible: number | null
  aLaVenta: number | null
}

export interface IpvDepartment {
  name: string
  venta: number
  costo: number
  ganancia: number
  products: IpvProduct[]
}

export interface IpvEmployee {
  nombre: string
  ocupacion: string
  dias: number
  salarioDiario: number
  totalCobrar: number
  carnet: string
  cuentaBancaria: string
  movil: string
  marcas: number[]
}

export interface IpvFondos {
  efectivo: number
  divisasCUP: number
  totalCuentasPorCobrar: number
  cuentasDetalle: Array<{ nombre: string; saldo: number; observacion: string }>
  zelle: number
  transferencias: number
  totalFondos: number
  ventas: number
  billetes: Array<{ denominacion: number; cantidad: number; subtotal: number }>
  mlc: Array<{ moneda: string; denominacion: number; cantidad: number; tasa: number; conversionCup: number }>
  arqueoGuardado: boolean
  mlcGuardado: boolean
}

export interface IpvDayPayload {
  date: string
  ventasDia: number
  gananciaBruta: number
  gananciaNeta: number
  mermasCosto: number
  cuadre: number
  departments: IpvDepartment[]
  entries: unknown[]
  gastosIpv: Array<{ dept: string; concept: string; um: string; quantity: number; unitValue: number; total: number; category: string; note: string }>
  cuentasPagadas: Array<{ paidDate: string; client: string; amount: number; paymentMethod: 'efectivo' | 'transferencia' }>
  warehouse: unknown[]
  ingresosEntradaMesas: Array<{ concepto: string; importe: number }>
  juegos: { venta: number; pagoEncargado: number; horas: number; utilidad: number } | null
  fondos: IpvFondos | null
  rh: IpvEmployee[]
  rhFechas: string[]
  totalRH: number
  productCount: number
  templateOrigin: { fingerprint: string; date: string } | null
  warnings?: string[]
}

export declare function parseDayFile(file: Blob): Promise<IpvDayPayload>
export declare function ipvPayloadToRawDay(payload: IpvDayPayload): Record<string, unknown>
