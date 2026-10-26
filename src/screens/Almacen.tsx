import { useMemo } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader } from '../components/ui'
import { Icon } from '../components/icons'
import { buildProductsCatalog, buildWarehouse } from '../lib/productosCore.mjs'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'

/* Almacén del externo: se lee de la foto de almacén que trae cada IPV
   (hoja «Almacén»), tal como entró. Diferencia honesta: el registro
   manual de movimientos con fotos y búsqueda por código de barras del
   sistema principal vive en su base y no viaja en el respaldo; aquí no
   se finge — se muestra la foto del IPV y el cuadre de salidas.
   Regla del dueño (2026-10-20): una salida solo se convierte en gasto
   si el producto tiene costo vigente verificado; sin costo queda
   señalada como pendiente de costo y NO se crea gasto. Los gastos
   enlazados se muestran como vista calculada: no se inyectan en
   Gastos para no duplicar las cifras ya verificadas de Economía. */

export default function Almacen({ data }: { data: StoredData }) {
  const catalog = useMemo(() => buildProductsCatalog(data.days), [data.days])
  const wh = useMemo(() => buildWarehouse(data.days, catalog), [data.days, catalog])

  return (
    <div>
      <TabHeader icon="package" title="Almacén" desc="Entradas, salidas y existencias desde la foto de almacén de los IPV" badge="Foto del IPV" />

      {wh.rows.length === 0 ? (
        <EmptyState
          icon="package"
          title="Sin fotos de almacén en los IPV importados"
          text="Cuando un IPV traiga su hoja de Almacén llena, aquí verás saldos, movimientos y qué salidas ya tienen costo para pasar a gasto."
        />
      ) : (
        <>
          <div className="stats">
            <div className="stat"><span className="label">Productos en fotos</span><span className="value">{fmtInt(wh.totals.productos)}</span></div>
            <div className="stat"><span className="label">Fotos registradas</span><span className="value">{fmtInt(wh.totals.fotos)}</span></div>
            <div className="stat"><span className="label">Entradas</span><span className="value">{fmtInt(wh.totals.entradas)}</span></div>
            <div className="stat"><span className="label">Salidas</span><span className="value">{fmtInt(wh.totals.salidas)}</span></div>
            <div className="stat"><span className="label">Pendientes de costo</span><span className="value">{fmtInt(wh.pendientesCosto.length)}</span></div>
          </div>

          <Card>
            <h3>Saldos por producto (última foto)</h3>
            <div className="list">
              {wh.balances.map((b) => (
                <div className="row" key={b.key}>
                  <span>
                    <strong>{b.product}</strong>
                    <span className="small muted"> · última foto {b.lastDate ? fmtDate(b.lastDate) : '—'} · entradas {fmtInt(b.entradas)} · bajas {fmtInt(b.bajas)} · salidas {fmtInt(b.salidas)}</span>
                  </span>
                  <span className="mono">
                    {fmtInt(b.saldo)} {b.um}
                    {b.sinCosto ? <span className="chip warn">Sin costo vigente</span> : <span className="small muted"> · costo {fmtCUP(b.costoVigente ?? 0)}</span>}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3><Icon name="receipt" size={18} /> Salidas → Gastos</h3>
            <p className="small muted">
              Una salida solo pasa a gasto si el producto tiene costo vigente verificado (el del catálogo o el precio
              de compra de la propia foto). Sin costo, queda pendiente y no se crea ningún gasto.
            </p>
            {wh.salidas.length === 0 ? (
              <p className="muted">Las fotos importadas no traen salidas registradas: nada que pasar a gasto por ahora.</p>
            ) : (
              <div className="list">
                {wh.salidas.map((s, i) => (
                  <div className="row" key={`${s.date}-${s.product}-${i}`}>
                    <span><strong>{s.product}</strong><br /><span className="small muted">{fmtDate(s.date)} · salieron {fmtInt(s.cantidad)} {s.um}</span></span>
                    {s.estado === 'con-costo'
                      ? <span className="mono">{fmtCUP(s.importe ?? 0)} <span className="chip ok">Gasto enlazado</span><br /><span className="small muted">costo {fmtCUP(s.costoVigente ?? 0)} ({s.fuenteCosto === 'catalogo' ? 'catálogo' : 'foto del IPV'})</span></span>
                      : <span className="chip warn">Pendiente de costo</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {wh.pendientesCosto.length > 0 ? (
            <Card>
              <h3><Icon name="alert" size={18} /> Productos sin costo vigente</h3>
              <p className="small muted">
                Mientras no tengan costo, sus salidas no pueden pasar a gasto (así quedaron señalados en el sistema
                principal: Papel sanitario, Sazón frezko, Codito y Spageti). El costo se registra en el sistema
                principal o cuando un IPV traiga su precio de compra.
              </p>
              <p>{wh.pendientesCosto.map((n) => <span className="chip warn" key={n} style={{ marginRight: 6 }}>{n}</span>)}</p>
            </Card>
          ) : null}

          <Card>
            <h3>Fotos de almacén por día</h3>
            <div className="list">
              {wh.rows.map((r, i) => (
                <div className="row" key={`${r.date}-${r.product}-${i}`}>
                  <span><strong>{r.product}</strong><br /><span className="small muted">{fmtDate(r.date)}{r.observacion ? ` · ${r.observacion}` : ''}</span></span>
                  <span className="mono small">
                    inicial {fmtInt(r.saldoInicial)} · +{fmtInt(r.entrada)} · baja {fmtInt(r.baja)} · salida {fmtInt(r.salida)} → <strong>{fmtInt(r.saldoFinal)} {r.um}</strong>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
