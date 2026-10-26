import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

export function EmptyState({ icon = 'sparkle', title, text, children }: { icon?: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ico" aria-hidden><Icon name={icon} size={34} /></span>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
      {children}
    </div>
  )
}

/** Distintivos (chips) de cada pestaña, los del original (TAB_BADGES). */
export const TAB_BADGES: Record<string, string> = {
  panorama: 'Tablero principal',
  economia: 'Análisis del período',
  elaboracion: 'Fichas de costo',
  laboratorio: 'Aislado · sin tocar datos reales',
  dias: 'Detalle por día',
  archivo: 'Meses cerrados',
  entradas: 'Desde el IPV',
  productos: 'Ficha maestra',
  menu: 'Para clientes',
  almacen: 'Control manual',
  inventario: 'Bienes del local',
  gastos: 'Salidas de caja',
  extras: '4 categorías',
  cobrar: 'Dinero en la calle',
  transferencias: 'Pases al banco',
  existencias: 'Libro de existencias',
  rh: 'Ciclos de 15 días',
  queen: 'Asistente del sistema',
  documentos: 'PDF y respaldo',
  sistema: 'Núcleo de Queen',
  importar: 'Excel diario del IPV',
  historial: 'Boletines',
  cronologia: 'Registro por categorías',
  ajustes: 'Perfil y acceso',
  mas: 'Todas las secciones',
}

/* Encabezado de pestaña del original (TabHeader): tarjeta única y
   compartida por TODAS las pestañas — insignia con el icono de la
   sección, título Georgia, descripción breve y chip distintivo. */
export function TabHeader({ icon, title, desc, badge }: { icon: IconName; title: string; desc: string; badge: string }) {
  return (
    <div className="tab-header">
      <div className="tab-header-main">
        <span className="tab-header-badge"><Icon name={icon} size={26} /></span>
        <div style={{ minWidth: 0 }}>
          <h2 className="font-display">{title}</h2>
          <p className="tab-header-desc">{desc}</p>
        </div>
      </div>
      <span className="tab-header-chip"><Icon name={icon} size={15} /> {badge}</span>
    </div>
  )
}

/** Barras píldora con línea de media (estilo Samsung Health), de datos reales.
 *  @deprecated Sustituido por ColumnChart (components/charts.tsx), el port
 *  fiel del original con tocar = detalle. Se conserva por compatibilidad. */
export function PillBars({ values, labels }: { values: number[]; labels: string[] }) {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const meanPct = (mean / max) * 100
  return (
    <div className="bars" role="img" aria-label="Gráfico de barras">
      <div className="mean-line" style={{ bottom: `calc(${(meanPct * 0.82).toFixed(1)}% + 18px)` }}>
        <span className="mean-tag">Media {new Intl.NumberFormat('es-CU', { maximumFractionDigits: 0 }).format(mean)}</span>
      </div>
      {values.map((v, i) => (
        <div className="bar-col" key={i} title={`${labels[i]}: ${v}`}>
          <div className="bar" style={{ height: `${Math.max(4, (v / max) * 82)}%` }} />
          <span className="bar-label">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

/** Barra de nivel con % y cifra.
 *  @deprecated Sustituido por RowChart (components/charts.tsx). */
export function LevelRow({ name, value, max, display }: { name: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="level-row">
      <span className="level-name">{name}</span>
      <span className="level-track"><span className="level-fill" style={{ width: `${pct}%`, display: 'block' }} /></span>
      <span className="level-val">{display}</span>
    </div>
  )
}
