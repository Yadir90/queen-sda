import type { Section, StoredData } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { effectiveSaldo, fmtCUP, fmtInt } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Vista «Más» del original: rejilla de tarjetas-botón con insignia de
   48px radio 16 en turquesa suave e icono en #084C5C, etiqueta,
   descripción y chevron; al pie, días importados y dinero en la
   calle (solo cuentas de clientes).
   CONTENIDO (rasero del dueño, 25-oct: copia exacta): las 19
   secciones del sistema que no son Inicio/Cobrar/Queen/Sistema —
   todos los Tab del original menos esos cuatro y el propio «Más» —
   en orden alfabético en español, con los nombres, iconos y
   descripciones LITERALES de la lista `tabs` de su App.tsx
   (App.tsx:2488-2510). Existencias es Tab del original aunque su
   lista de navegación lo omite (se abre desde Productos): por eso
   aquí figura como sección sin destino propio en el clon, con su
   descripción de TAB_BADGES («Libro de existencias»).
   Diferencias de arquitectura del clon, declaradas en la propia
   rejilla: Gastos abre Economía (donde viven los gastos en esta
   copia), Menú abre Documentos (donde se genera el menú) e
   Importar abre Sistema (donde se importa el respaldo/IPV); las
   secciones que el clon aún no tiene se muestran con su estado
   honesto de «siguiente fase», sin fingir que abren algo. La
   pantalla «Cuentas» del clon no es una sección del original (las
   cuentas viven dentro de Cobrar) y por eso ya no figura en esta
   rejilla: sigue accesible desde Cobrar y la barra lateral. */

interface MasItem {
  name: string
  desc: string
  icon: IconName
  go?: Section
}

const ITEMS: MasItem[] = [
  { name: 'Ajustes', desc: 'Perfil, acceso y configuración', icon: 'settings' },
  { name: 'Almacén', desc: 'Control manual de existencias del almacén', icon: 'package', go: 'almacen' },
  { name: 'Archivo', desc: 'Meses cerrados y morosas', icon: 'archive' },
  { name: 'Cronología', desc: 'Registro cronológico interactivo de todo el sistema, por categorías', icon: 'list' },
  { name: 'Días', desc: 'Días importados y detalle diario', icon: 'calendar', go: 'dias' },
  { name: 'Economía', desc: 'Fondos, márgenes y análisis económico', icon: 'chart', go: 'economia' },
  { name: 'Elaboración', desc: 'Fichas de costo de los productos', icon: 'receipt', go: 'elaboracion' },
  { name: 'Entradas', desc: 'Entradas e inversión del IPV', icon: 'package' },
  { name: 'Existencias', desc: 'Libro de existencias', icon: 'archive' },
  { name: 'Gastos', desc: 'Gastos y salidas de caja', icon: 'receipt', go: 'economia' },
  { name: 'Historial', desc: 'Boletines generados y su estado de envío', icon: 'clock', go: 'historial' },
  { name: 'Importar', desc: 'Subir Excel diario del IPV', icon: 'upload', go: 'sistema' },
  { name: 'Inventario', desc: 'Registro independiente de los bienes del local', icon: 'archive' },
  { name: 'Laboratorio', desc: 'Simulación aislada e IPV de prueba que se cuadra a 0, sin tocar datos reales', icon: 'flask', go: 'laboratorio' },
  { name: 'Menú', desc: 'Menú del día desde Productos, editable y en PDF', icon: 'doc', go: 'documentos' },
  { name: 'Otros ingresos', desc: 'Coctelería, pizzería, entrada y mesas', icon: 'plus' },
  { name: 'Productos', desc: 'Ficha maestra: existencia, precios, costo promedio y ganancia', icon: 'package', go: 'productos' },
  { name: 'RH · Pagos', desc: 'Nómina quincenal y historial', icon: 'people', go: 'rh' },
  { name: 'Transferencias', desc: 'Acumulado por pasar al banco', icon: 'transfer', go: 'transferencias' },
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
            <button key={item.name} type="button" className="mas-card" onClick={() => onNavigate(item.go!)} aria-label={`Ir a ${item.name}: ${item.desc}`}>
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
