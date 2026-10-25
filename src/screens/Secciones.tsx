import type { Section } from '../types'
import { Card, EmptyState } from '../components/ui'

export function QueenScreen() {
  return (
    <div>
      <h1 className="section-title">Queen</h1>
      <Card>
        <EmptyState
          icon="👸"
          title="Queen llega en la siguiente fase"
          text="La asistente del sistema — con su memoria, sus reglas y su forma de responder — se conecta cuando existan el servidor y los datos enlazados. Aquí no hay respuestas de ejemplo ni cifras inventadas."
        />
      </Card>
    </div>
  )
}

const FUTURE: Array<{ name: string; desc: string }> = [
  { name: 'RH y nómina', desc: 'Ciclos de 15 días exactos con pago el día 16; no se confunden con la quincena contable.' },
  { name: 'Almacén', desc: 'Entradas, salidas y existencias enlazadas con los días.' },
  { name: 'Elaboración', desc: 'Productos, paquetes y rendimientos, y referencias de precios.' },
  { name: 'Transferencias', desc: 'Saldo de la tarjeta del negocio y conciliación con los SMS de PAGOxMOVIL.' },
  { name: 'Economía e informes', desc: 'Cierre de mes e informes con estilo premium, solo con datos reales.' },
  { name: 'Documentos y boletines', desc: 'Boletines diarios y documentos exportables.' },
  { name: 'Contactos', desc: 'Tarjetas de personas enlazadas con sus cuentas.' },
]

export function MasScreen({ onNavigate }: { onNavigate: (s: Section) => void }) {
  return (
    <div>
      <h1 className="section-title">Más</h1>
      <Card>
        <h3>Ya funcionando en esta v1</h3>
        <button className="list-row" onClick={() => onNavigate('dias')}><span className="grow">Días<strong className="muted" style={{ fontWeight: 400 }}>Rejilla de días importados y su detalle</strong></span><span>›</span></button>
        <button className="list-row" onClick={() => onNavigate('cuentas')}><span className="grow">Cuentas<strong className="muted" style={{ fontWeight: 400 }}>Cuentas por cobrar por persona y categoría</strong></span><span>›</span></button>
      </Card>
      <Card>
        <h3>Llega en la siguiente fase</h3>
        {FUTURE.map((f) => (
          <div className="list-row" key={f.name}>
            <span className="grow">{f.name}<span className="muted">{f.desc}</span></span>
            <span className="chip">Siguiente fase</span>
          </div>
        ))}
      </Card>
    </div>
  )
}
