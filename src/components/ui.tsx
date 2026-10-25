import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

export function EmptyState({ icon = '🌿', title, text, children }: { icon?: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ico" aria-hidden>{icon}</span>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
      {children}
    </div>
  )
}

/** Barras píldora con línea de media (estilo Samsung Health), de datos reales. */
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

/** Barra de nivel con % y cifra. */
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
