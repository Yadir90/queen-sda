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
   lista de navegación lo omite (se abre desde Productos): en esta
   copia Existencias SÍ es destino propio desde esta rejilla, con
   el mismo libro que se ve dentro de Productos.
   Diferencia de arquitectura del clon, declarada en la propia
   rejilla: Gastos abre Economía (donde viven los gastos en esta
   copia). Menú e Importar fueron destinos prestados (Documentos
   y Sistema) hasta el 26-oct: el dueño los reportó como defecto
   (D-R5-03) y desde entonces son secciones propias ('menu' e
   'importar'), como en el original. Desde la oleada 3 las 19
   tarjetas abren una pantalla real: Ajustes, Archivo, Cronología,
   Entradas, Existencias y Otros ingresos dejaron de ser tarjetas
   sin destino. La pantalla «Cuentas» del
   clon no es una sección del original (las cuentas viven dentro
   de Cobrar) y por eso ya no figura en esta rejilla: sigue
   accesible desde Cobrar y la barra lateral. */

interface MasItem {
  name: string
  desc: string
  icon: IconName
  go?: Section
}

const ITEMS: MasItem[] = [
  { name: 'Ajustes', desc: 'Perfil, acceso y configuración', icon: 'settings', go: 'ajustes' },
  { name: 'Almacén', desc: 'Control manual de existencias del almacén', icon: 'package', go: 'almacen' },
  { name: 'Archivo', desc: 'Meses cerrados y morosas', icon: 'archive', go: 'archivo' },
  { name: 'Cronología', desc: 'Registro cronológico interactivo de todo el sistema, por categorías', icon: 'list', go: 'cronologia' },
  { name: 'Días', desc: 'Días importados y detalle diario', icon: 'calendar', go: 'dias' },
  { name: 'Economía', desc: 'Fondos, márgenes y análisis económico', icon: 'chart', go: 'economia' },
  { name: 'Elaboración', desc: 'Fichas de costo de los productos', icon: 'receipt', go: 'elaboracion' },
  { name: 'Entradas', desc: 'Entradas e inversión del IPV', icon: 'package', go: 'entradas' },
  { name: 'Existencias', desc: 'Libro de existencias', icon: 'archive', go: 'existencias' },
  { name: 'Gastos', desc: 'Gastos y salidas de caja', icon: 'receipt', go: 'economia' },
  { name: 'Historial', desc: 'Boletines generados y su estado de envío', icon: 'clock', go: 'historial' },
  { name: 'Importar', desc: 'Subir Excel diario del IPV', icon: 'upload', go: 'importar' },
  { name: 'Inventario', desc: 'Registro independiente de los bienes del local', icon: 'archive', go: 'inventario' },
  { name: 'Laboratorio', desc: 'Simulación aislada e IPV de prueba que se cuadra a 0, sin tocar datos reales', icon: 'flask', go: 'laboratorio' },
  { name: 'Menú', desc: 'Menú del día desde Productos, editable y en PDF', icon: 'doc', go: 'menu' },
  { name: 'Otros ingresos', desc: 'Coctelería, pizzería, entrada y mesas', icon: 'plus', go: 'extras' },
  { name: 'Productos', desc: 'Ficha maestra: existencia, precios, costo promedio y ganancia', icon: 'package', go: 'productos' },
  { name: 'RH · Pagos', desc: 'Nómina quincenal y historial', icon: 'people', go: 'rh' },
  { name: 'Transferencias', desc: 'Acumulado por pasar al banco', icon: 'transfer', go: 'transferencias' },
]

export function MasScreen({ onNavigate, data, hidden = [] }: { onNavigate: (s: Section) => void; data: StoredData; hidden?: Section[] }) {
  /* Las tarjetas cuyo destino no tiene acceso esta sesión no se
     muestran (regla general del dueño: las pestañas de administrador
     no aparecen a ningún otro usuario; matriz de Yan). */
  const dineroCalle = data.receivables
    .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
    .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0 && x.rec.category === 'cliente')
    .reduce((s, x) => s + x.saldo, 0)

  return (
    <div>
      <TabHeader icon="more" title="Más" desc="Todas las secciones del sistema" badge={TAB_BADGES.mas} />
      <div className="mas-grid">
        {ITEMS.filter((item) => !item.go || !hidden.includes(item.go)).map((item) => (
          <button key={item.name} type="button" className="mas-card" onClick={() => onNavigate(item.go!)} aria-label={`Ir a ${item.name}: ${item.desc}`}>
            <span className="mas-ico"><Icon name={item.icon} size={22} /></span>
            <span className="mas-text">
              <span className="mas-name">{item.name}</span>
              <span className="mas-desc">{item.desc}</span>
            </span>
            <span className="mas-chev"><Icon name="chevronR" size={18} /></span>
          </button>
        ))}
      </div>
      <p className="mas-foot">
        {fmtInt(data.days.length)} días importados · Dinero en la calle: {fmtCUP(dineroCalle)} (solo cuentas de clientes)
      </p>
    </div>
  )
}
