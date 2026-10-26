import { useMemo, useState } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { buildProductsCatalog, buildPriceSuggestions } from '../lib/productosCore.mjs'
import { fmtCUP } from '../lib/utils'

/* Laboratorio: pestaña principal independiente, como en el original.
   Espacio de pruebas AISLADO: simula precios y márgenes con los datos
   reales como punto de partida, pero todo lo que se toca aquí vive
   solo en esta pantalla — no guarda, no escribe y no toca ni un dato
   real. La tabla parte de las sugerencias de Queen (que nunca cambia
   un precio sola); simular un precio aquí tampoco lo aplica. */

export default function Laboratorio({ data }: { data: StoredData }) {
  const catalog = useMemo(() => buildProductsCatalog(data.days), [data.days])
  const suggestions = useMemo(() => buildPriceSuggestions(catalog), [catalog])
  const [sim, setSim] = useState<Record<string, string>>({})

  const rows = useMemo(
    () => suggestions.items.filter((i) => i.salePrice != null && i.costPrice != null),
    [suggestions],
  )

  return (
    <div>
      <TabHeader
        icon="flask"
        title="Laboratorio"
        desc="Espacio de pruebas aislado: simula precios y cuadra escenarios sin tocar los datos reales."
        badge={TAB_BADGES.laboratorio}
      />

      <Card>
        <h3><Icon name="flask" size={18} /> Simulador de precios</h3>
        <p className="small muted">
          Escribe un precio de prueba en cualquier fila y mira el margen resultante al momento. Es solo una
          simulación en esta pantalla: <strong>nada se guarda ni se aplica</strong> — los precios reales solo cambian
          en el IPV, y la sugerencia de Queen sigue visible como referencia.
        </p>
        {rows.length === 0 ? (
          <EmptyState icon="flask" title="Sin productos con precio y costo" text="El simulador necesita productos con precio de venta y costo vigentes del catálogo." />
        ) : (
          <div className="list">
            {rows.slice(0, 40).map((i) => {
              const simPrice = Number(sim[i.productKey])
              const hasSim = sim[i.productKey] !== undefined && sim[i.productKey] !== '' && Number.isFinite(simPrice) && simPrice > 0
              const simMargin = hasSim ? Math.round(((simPrice - (i.costPrice ?? 0)) / simPrice) * 1000) / 10 : null
              return (
                <div className="row" key={i.productKey}>
                  <span>
                    <strong>{i.name}</strong> <span className="small muted">· {i.dept}</span><br />
                    <span className="small muted">
                      Real: venta {fmtCUP(i.salePrice ?? 0)} · costo {fmtCUP(i.costPrice ?? 0)} · margen {i.marginPct} %
                      {i.suggestedPrice != null ? ` · Queen sugiere ${fmtCUP(i.suggestedPrice)}` : ''}
                    </span>
                  </span>
                  <span className="lab-sim">
                    <input
                      aria-label={`Precio simulado para ${i.name}`}
                      inputMode="decimal"
                      placeholder={String(i.salePrice ?? '')}
                      value={sim[i.productKey] ?? ''}
                      onChange={(e) => setSim((m) => ({ ...m, [i.productKey]: e.target.value }))}
                    />
                    {simMargin != null ? <span className={`chip ${simMargin < 0 ? 'danger' : simMargin < i.targetPct ? 'warn' : 'ok'}`}>{simMargin} %</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {rows.length > 40 ? <p className="small muted">Se muestran los primeros 40 productos con datos; el resto se simula igual en el sistema principal.</p> : null}
      </Card>

      <Card>
        <h3>IPV de prueba</h3>
        <p className="small muted">
          En el sistema principal, el Laboratorio también cuadra IPV de prueba sin importarlos. En esta copia ese
          panel llega con la fase de documentos: importar un IPV aquí NO se ofrece, para que ningún archivo de
          prueba pueda colarse entre los datos reales por error.
        </p>
      </Card>
    </div>
  )
}
