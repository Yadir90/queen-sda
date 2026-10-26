import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/* ===== ActionMenu (puerto del original, su App.tsx:1117) =====
   Acciones progresivas: la tarjeta muestra un único control y revela
   sus operaciones solo cuando se solicitan. Popover en portal con
   colocación medida contra el viewport y auto-curación si quedara
   recortado. Su CSS vive en sectionsMirror.css (bloque «ActionMenu y
   catálogos»). */
export function ActionMenu({ label = 'Acciones', children, className = '' }: { label?: string; children: ReactNode; className?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const [selfHealed, setSelfHealed] = useState(false)

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return
    const triggerBox = trigger.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    const margin = 12
    const gap = 6
    const width = Math.min(248, Math.max(180, viewportWidth - margin * 2))
    const measuredHeight = Math.min(popover.scrollHeight, Math.max(160, viewportHeight * 0.6))
    const roomBelow = viewportHeight - triggerBox.bottom - margin
    const opensAbove = roomBelow < Math.min(measuredHeight, 220) && triggerBox.top > roomBelow
    const top = opensAbove
      ? Math.max(margin, triggerBox.top - measuredHeight - gap)
      : Math.min(viewportHeight - margin - measuredHeight, triggerBox.bottom + gap)
    const left = Math.min(viewportWidth - margin - width, Math.max(margin, triggerBox.right - width))
    setPosition({ top, left, width, visibility: 'visible' })
  }, [])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(placePopover)
    const onViewportChange = () => window.requestAnimationFrame(placePopover)
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (target && !triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('orientationchange', onViewportChange)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('orientationchange', onViewportChange)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, placePopover])

  useEffect(() => {
    if (!open || position.visibility !== 'visible' || selfHealed) return
    const frame = window.requestAnimationFrame(() => {
      const popover = popoverRef.current
      if (!popover) return
      const box = popover.getBoundingClientRect()
      const style = window.getComputedStyle(popover)
      const invisible = box.width < 1 || box.height < 1 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
      const clipped = box.left < 0 || box.top < 0 || box.right > document.documentElement.clientWidth || box.bottom > window.innerHeight
      if (invisible || clipped) {
        const margin = 12
        setSelfHealed(true)
        setPosition({ left: margin, right: margin, bottom: `max(${margin}px, env(safe-area-inset-bottom))`, width: 'auto', top: 'auto', visibility: 'visible' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, position, selfHealed])

  return (
    <div className={`action-menu ${open ? 'is-open' : ''} ${className}`} data-self-healed={selfHealed || undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="action-menu-trigger"
        aria-label={`${open ? 'Cerrar' : 'Abrir'} ${label.toLowerCase()}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPosition({ visibility: 'hidden' })
          setSelfHealed(false)
          setOpen((value) => !value)
        }}
      >
        <Icon name="more" size={18} />
        <span>{label}</span>
        <Icon name="chevronR" size={14} className="action-menu-chevron" />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="action-menu-popover"
          role="menu"
          aria-label={label}
          style={position}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) setOpen(false)
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ===== ViewModeToggle (puerto del original, su App.tsx:1046) ===== */
export type CatalogLayout = 'grid' | 'list'
export function ViewModeToggle({ layout, onToggle, label }: { layout: CatalogLayout; onToggle: () => void; label?: string }) {
  const next = layout === 'grid' ? 'list' : 'grid'
  const nextLabel = next === 'grid' ? 'Vista en cuadrícula' : 'Vista en lista'
  return (
    <button
      type="button"
      onClick={onToggle}
      className="view-mode-toggle"
      aria-label={`${label ? `${label}: ` : ''}cambiar a ${nextLabel.toLowerCase()}`}
      title={`Cambiar a ${nextLabel.toLowerCase()}`}
    >
      <Icon name={next} size={17} />
      <span>{nextLabel}</span>
    </button>
  )
}

/** Gancho de presentación de catálogos del original (useCatalogLayout):
 *  la elección se guarda por módulo en localStorage. */
export function useCatalogLayout(storageKey: string, initial: CatalogLayout): [CatalogLayout, () => void] {
  const [layout, setLayout] = useState<CatalogLayout>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === 'grid' || saved === 'list' ? saved : initial
    } catch {
      return initial
    }
  })
  const toggle = () => setLayout((current) => {
    const next: CatalogLayout = current === 'grid' ? 'list' : 'grid'
    try { localStorage.setItem(storageKey, next) } catch { /* sin almacenamiento */ }
    return next
  })
  return [layout, toggle]
}

/* ===== InfoHelp (puerto del original, su App.tsx:1231) =====
   Ayuda detrás del icono ⓘ: la explicación no se pierde, queda
   escondida hasta que se pide. CSS en sectionsMirror.css. */
export function InfoHelp({ label = 'Cómo funciona esta pestaña', children, className = '' }: { label?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`info-help ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? `Cerrar explicación: ${label}` : `Ver explicación: ${label}`}
        title={label}
        className={`info-help-btn ${open ? 'is-open' : ''}`}
      >
        <Icon name="info" size={15} />
      </button>
      {open && (
        <span className="info-help-panel" role="note" aria-label={label}>
          <span className="info-help-head">
            <span className="info-help-title">{label}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar explicación" className="info-help-close"><Icon name="x" size={12} /></button>
          </span>
          <span className="info-help-body">{children}</span>
        </span>
      )}
    </span>
  )
}
