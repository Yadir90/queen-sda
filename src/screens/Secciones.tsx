import type { Section, StoredData } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { effectiveSaldo, fmtCUP, fmtInt } from '../lib/utils'

/* Vista «Más» del original: rejilla de tarjetas-botón con TODAS las
   secciones menos Inicio/Cobrar/Queen/Sistema, en orden alfabético en
   español — insignia de 48px radio 16 en turquesa suave con el icono en
   #084C5C, etiqueta, descripción breve y chevron. Al pie: días
   importados y dinero en la calle (solo cuentas de clientes).
   En esta copia navegan Días, Cuentas, RH · Pagos, Economía (con los
   gastos dentro), Transferencias, Productos, Elaboración, Almacén,
   Laboratorio, Documentos e Historial, e Importar (dentro de
   Sistema); el resto se muestra con su estado honesto de
   «siguiente fase», sin fingir que abre algo. */

interface MasItem {
  name: string
  desc: string
  icon: IconName
  go?: Section
}

const ITEMS: MasItem[] = [
  { name: 'Ajustes', desc: 'Perfil, acceso y seguridad', icon: 'settings' },
  { name: 'Almacén', desc: 'Entradas, salidas y existencias desde la foto del IPV', icon: 'package', go: 'almacen' },
  { name: 'Archivo', desc: 'Meses cerrados', icon: 'archive' },
  { name: 'Cronología', desc: 'Registro por categorías', icon: 'list' },
  { name: 'Cuentas', desc: 'Cuentas por cobrar por persona y contacto', icon: 'receipt', go: 'cuentas' },
  { name: 'Días', desc: 'Rejilla de días importados y su detalle', icon: 'calendar', go: 'dias' },
  { name: 'Documentos', desc: 'Nómina, informe, menú, presentación y respaldo descargables', icon: 'doc', go: 'documentos' },
  { name: 'Economía', desc: 'Análisis del período y cierre de mes', icon: 'chart', go: 'economia' },
  { name: 'Elaboración', desc: 'Productos, paquetes, rendimientos y referencias', icon: 'receipt', go: 'elaboracion' },
  { name: 'Entradas', desc: 'Entradas desde el IPV', icon: 'package' },
  { name: 'Gastos', desc: 'Salidas de caja registradas (en Economía)', icon: 'receipt', go: 'economia' },
  { name: 'Historial', desc: 'Boletines diarios enviados y pendientes', icon: 'clock', go: 'historial' },
  { name: 'Importar', desc: 'El respaldo del SDA se importa desde Sistema', icon: 'upload', go: 'sistema' },
  { name: 'Inventario', desc: 'Bienes del local', icon: 'archive' },
  { name: 'Laboratorio', desc: 'Aislado · sin tocar datos reales', icon: 'flask', go: 'laboratorio' },
  { name: 'Menú', desc: 'Para clientes, sin firma ni cuño (en Documentos)', icon: 'doc', go: 'documentos' },
  { name: 'Otros ingresos', desc: 'Ingresos fuera de las ventas del IPV', icon: 'plus' },
  { name: 'Productos', desc: 'Ficha maestra de productos', icon: 'package', go: 'productos' },
  { name: 'RH · Pagos', desc: 'Ciclos de 15 días exactos, pago el día 16', icon: 'people', go: 'rh' },
  { name: 'Transferencias', desc: 'Tarjeta del negocio y pases al banco', icon: 'transfer', go: 'transferencias' },
]

export function MasScreen({ onNavigate, data }: { onNavigate: (s: Section) => void; data: StoredData }) {
  const dineroCalle = data.receivables
    .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
    .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0 && x.rec.category === 'cliente')
    .reduce((s, x) => s + x.saldo, 0)

  return (
    <div>
      <TabHeader icon="more" title="Más" desc="Todas las secciones del sistema" badge={TAB_BADGES.mas} />
      <div className="mas-grid">
        {ITEMS.map((item) => {
          const inner = (
            <>
              <span className="mas-ico"><Icon name={item.icon} size={22} /></span>
              <span className="mas-text">
                <span className="mas-name">{item.name}</span>
                <span className="mas-desc">{item.desc}</span>
              </span>
              {item.go
                ? <span className="mas-chev"><Icon name="chevronR" size={18} /></span>
                : <span className="chip">Siguiente fase</span>}
            </>
          )
          return item.go ? (
            <button key={item.name} type="button" className="mas-card" onClick={() => onNavigate(item.go!)}>
              {inner}
            </button>
          ) : (
            <div key={item.name} className="mas-card is-future" aria-label={`${item.name}: llega en la siguiente fase`}>
              {inner}
            </div>
          )
        })}
      </div>
      <p className="mas-foot">
        {fmtInt(data.days.length)} días importados · Dinero en la calle: {fmtCUP(dineroCalle)} (solo cuentas de clientes)
      </p>
    </div>
  )
}
