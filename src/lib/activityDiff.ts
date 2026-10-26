/* Diferencia de datos para el registro de actividad (precisión
 * del dueño, 2026-10-26 15:10): la Cronología debe servir para
 * RASTREAR — en las ediciones, qué cambió: campo y, donde importe,
 * valor anterior → valor nuevo, sobre todo en importes.
 *
 * Compara dos fotos de StoredData (antes/después de un guardado) y
 * describe los cambios por colección con el detalle que los datos
 * permiten. Solo describe cambios reales entre las dos fotos; lo
 * que no se puede atribuir a un campo concreto cae en el resumen
 * genérico de su sección, nunca en un detalle inventado. */
import type { Section, StoredData } from '../types'
import { fmtCUP, fmtDate } from './utils'
import type { ActivityKind } from './activityLog'

export interface ActivityDiffEntry {
  kind: ActivityKind
  section: Section
  detail: string
}

const MAX_ENTRIES = 8

function byId<T extends { id: string | number }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [String(i.id), i]))
}
function money(v: number): string {
  return `${fmtCUP(v)} CUP`
}

function diffReceivables(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = byId(prev.receivables)
  const n = byId(next.receivables)
  for (const rec of next.receivables) {
    const old = p.get(String(rec.id))
    if (!old) {
      out.push({ kind: 'edicion', section: 'cobrar', detail: `Creó la cuenta de ${rec.client} por ${money(rec.originalAmount)} (${rec.category})` })
      continue
    }
    const oldPays = new Set((old.payments ?? []).map((x) => x.id))
    for (const pay of rec.payments ?? []) {
      if (!oldPays.has(pay.id)) {
        out.push({ kind: 'edicion', section: 'cobrar', detail: `Registró un abono de ${money(pay.amount)} en la cuenta de ${rec.client} (por ${pay.paymentMethod})` })
      }
    }
    const parts: string[] = []
    if (old.originalAmount !== rec.originalAmount) parts.push(`importe ${money(old.originalAmount)} → ${money(rec.originalAmount)}`)
    if (old.client !== rec.client) parts.push(`nombre «${old.client}» → «${rec.client}»`)
    if (old.date !== rec.date) parts.push(`fecha ${fmtDate(old.date)} → ${fmtDate(rec.date)}`)
    if (old.category !== rec.category) parts.push(`categoría ${old.category} → ${rec.category}`)
    if ((old.detail ?? '') !== (rec.detail ?? '')) parts.push(`detalle «${old.detail ?? ''}» → «${rec.detail ?? ''}»`)
    if (old.status !== rec.status) parts.push(`estado ${old.status} → ${rec.status}`)
    if (!old.isMorosa && rec.isMorosa) parts.push('movida a morosas')
    if (old.isMorosa && !rec.isMorosa) parts.push('devuelta a Cobrar')
    if (parts.length) out.push({ kind: 'edicion', section: 'cobrar', detail: `Editó la cuenta de ${rec.client}: ${parts.join('; ')}` })
  }
  for (const rec of prev.receivables) {
    if (!n.has(String(rec.id))) {
      out.push({ kind: 'borrado', section: 'cobrar', detail: `Eliminó la cuenta de ${rec.client} (importe original ${money(rec.originalAmount)})` })
    }
  }
  const oldLocal = new Set(prev.localPayments.map((x) => x.id))
  for (const lp of next.localPayments) {
    if (oldLocal.has(lp.id)) continue
    const client = next.receivables.find((r) => r.id === lp.receivableId)?.client ?? 'una cuenta'
    out.push({ kind: 'edicion', section: 'cobrar', detail: `Registró un abono de ${money(lp.amount)} en la cuenta de ${client} (por ${lp.method})` })
  }
}

function diffExpenses(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = byId(prev.expenses)
  const n = byId(next.expenses)
  for (const e of next.expenses) {
    const old = p.get(String(e.id))
    if (!old) {
      out.push({ kind: 'edicion', section: 'economia', detail: `Registró el gasto «${e.concept}» por ${money(e.total)} (${e.category})` })
      continue
    }
    const parts: string[] = []
    if (old.total !== e.total) parts.push(`importe ${money(old.total)} → ${money(e.total)}`)
    if (old.concept !== e.concept) parts.push(`concepto «${old.concept}» → «${e.concept}»`)
    if (old.date !== e.date) parts.push(`fecha ${fmtDate(old.date)} → ${fmtDate(e.date)}`)
    if (parts.length) out.push({ kind: 'edicion', section: 'economia', detail: `Editó el gasto «${e.concept}»: ${parts.join('; ')}` })
  }
  for (const e of prev.expenses) {
    if (!n.has(String(e.id))) out.push({ kind: 'borrado', section: 'economia', detail: `Eliminó el gasto «${e.concept}» (${money(e.total)})` })
  }
}

function diffExtras(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = byId(prev.extraIncomes)
  const n = byId(next.extraIncomes)
  for (const x of next.extraIncomes) {
    const old = p.get(x.id)
    if (!old) out.push({ kind: 'edicion', section: 'extras', detail: `Registró el ingreso «${x.concept}» por ${money(x.amount)}` })
    else if (old.amount !== x.amount) out.push({ kind: 'edicion', section: 'extras', detail: `Editó el ingreso «${x.concept}»: importe ${money(old.amount)} → ${money(x.amount)}` })
  }
  for (const x of prev.extraIncomes) {
    if (!n.has(x.id)) out.push({ kind: 'borrado', section: 'extras', detail: `Eliminó el ingreso «${x.concept}» (${money(x.amount)})` })
  }
}

function diffInventory(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = byId(prev.venueInventory)
  const n = byId(next.venueInventory)
  for (const it of next.venueInventory) {
    const old = p.get(String(it.id))
    if (!old) {
      out.push({ kind: 'edicion', section: 'inventario', detail: `Registró el bien «${it.article}» (${it.inventoryId}) en ${it.department}` })
      continue
    }
    const parts: string[] = []
    if (old.quantity !== it.quantity) parts.push(`cantidad ${old.quantity} → ${it.quantity}`)
    if (old.unitCost !== it.unitCost) parts.push(`costo unitario ${old.unitCost == null ? '—' : money(old.unitCost)} → ${it.unitCost == null ? '—' : money(it.unitCost)}`)
    if (old.currentStatus !== it.currentStatus) parts.push(`estado ${old.currentStatus} → ${it.currentStatus}${it.lowReason ? ` (motivo: ${it.lowReason})` : ''}`)
    if (old.department !== it.department) parts.push(`almacén ${old.department} → ${it.department}`)
    if (parts.length) out.push({ kind: 'edicion', section: 'inventario', detail: `Editó el bien «${it.article}» (${it.inventoryId}): ${parts.join('; ')}` })
  }
  for (const it of prev.venueInventory) {
    if (!n.has(String(it.id))) out.push({ kind: 'borrado', section: 'inventario', detail: `Eliminó el bien «${it.article}» (${it.inventoryId})` })
  }
}

function diffAdjustments(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = new Set(prev.inventoryAdjustments.map((a) => a.id))
  for (const a of next.inventoryAdjustments) {
    if (p.has(a.id)) continue
    const label = a.kind === 'inicial' ? 'Existencia inicial' : a.kind === 'baja' ? 'Baja' : 'Traslado'
    out.push({ kind: 'edicion', section: 'existencias', detail: `${label} en existencias: ${a.productName} · ${a.quantity} ${a.um}${a.note ? ` · ${a.note}` : ''}` })
  }
}

function diffTransfers(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = byId(prev.transferMovements)
  const n = byId(next.transferMovements)
  for (const m of next.transferMovements) {
    const old = p.get(m.id)
    if (!old) {
      out.push({ kind: 'edicion', section: 'transferencias', detail: `Registró un movimiento de transferencia por ${money(m.amount)} (${m.detail})` })
      continue
    }
    const parts: string[] = []
    if (old.amount !== m.amount) parts.push(`importe ${money(old.amount)} → ${money(m.amount)}`)
    if (old.excluded !== m.excluded) parts.push(m.excluded ? 'marcado como excluido' : 'vuelto a incluir')
    if (old.detail !== m.detail) parts.push(`detalle «${old.detail}» → «${m.detail}»`)
    if (parts.length) out.push({ kind: 'edicion', section: 'transferencias', detail: `Editó un movimiento de transferencia: ${parts.join('; ')}` })
  }
  for (const m of prev.transferMovements) {
    if (!n.has(m.id)) out.push({ kind: 'borrado', section: 'transferencias', detail: `Eliminó un movimiento de transferencia por ${money(m.amount)} (${m.detail})` })
  }
}

function diffDays(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = new Set(prev.days.map((d) => d.date))
  const n = new Set(next.days.map((d) => d.date))
  for (const d of next.days) {
    if (!p.has(d.date)) out.push({ kind: 'importacion', section: 'dias', detail: `Importó el IPV del ${fmtDate(d.date)} (ventas ${money(d.ventasDia)})` })
  }
  for (const d of prev.days) {
    if (!n.has(d.date)) out.push({ kind: 'borrado', section: 'dias', detail: `Eliminó el día ${fmtDate(d.date)} (ventas ${money(d.ventasDia)})` })
  }
}

function diffRh(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const oldPays = new Set(prev.workerPayments.map((x) => `${x.workerKey}|${x.fecha}|${x.monto}|${x.concepto}`))
  for (const wp of next.workerPayments) {
    if (oldPays.has(`${wp.workerKey}|${wp.fecha}|${wp.monto}|${wp.concepto}`)) continue
    const name = next.workers.find((w) => w.key === wp.workerKey)?.nombre ?? wp.workerKey
    out.push({ kind: 'edicion', section: 'rh', detail: `Registró un pago fuera de nómina a ${name}: ${wp.concepto || 'pago'}${wp.monto ? ` · ${money(wp.monto)}` : ''}` })
  }
  const oldNom = new Set(prev.payrollHistory.map((x) => x.id))
  for (const rec of next.payrollHistory) {
    if (oldNom.has(rec.id)) continue
    out.push({ kind: 'edicion', section: 'rh', detail: `Registró el pago de la nómina ${fmtDate(rec.cycleStart)} — ${fmtDate(rec.cycleEnd)} por ${money(rec.total)} (${rec.workersCount} trabajadores)` })
  }
  const pExt = new Map(prev.workersExtended.map((w) => [w.id, w]))
  for (const w of next.workersExtended) {
    const old = pExt.get(w.id)
    if (!old) continue
    if (!old.contratoCanceladoEl && w.contratoCanceladoEl) {
      out.push({ kind: 'edicion', section: 'rh', detail: `Canceló el contrato de ${w.nombre} (desde el ${fmtDate(w.contratoCanceladoEl)})` })
    } else if (old.contratoCanceladoEl && !w.contratoCanceladoEl) {
      out.push({ kind: 'edicion', section: 'rh', detail: `Reactivó el contrato de ${w.nombre}` })
    }
  }
  const oldHist = new Set(prev.workersHistorial.map((h) => h.key))
  for (const h of next.workersHistorial) {
    if (!oldHist.has(h.key)) out.push({ kind: 'edicion', section: 'rh', detail: `Movió la ficha de ${h.worker.nombre} al historial de RH` })
  }
  const oldExtJson = new Map(prev.workersExtended.map((w) => [w.id, JSON.stringify(w)]))
  const changedFicha = next.workersExtended.some((w) => oldExtJson.has(w.id) && oldExtJson.get(w.id) !== JSON.stringify(w))
  const yaCubierto = out.some((e) => e.section === 'rh')
  if (changedFicha && !yaCubierto) {
    out.push({ kind: 'edicion', section: 'rh', detail: 'Actualizó fichas de trabajadores (datos de ficha, turno, ausencias o evaluación)' })
  }
}

function diffWarehouse(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = new Set(prev.warehouseEntries.map((e) => e.id))
  const added = next.warehouseEntries.filter((e) => !p.has(e.id))
  for (const e of added.slice(0, 3)) {
    out.push({ kind: 'edicion', section: 'almacen', detail: `${e.kind === 'entrada' ? 'Entrada' : 'Rebaja'} en el almacén: ${e.product} · ${e.quantity}${e.note ? ` · ${e.note}` : ''}` })
  }
  if (added.length > 3) out.push({ kind: 'edicion', section: 'almacen', detail: `Registró ${added.length} movimientos en el almacén` })
  else if (added.length === 0 && JSON.stringify(prev.warehouseMeta) !== JSON.stringify(next.warehouseMeta)) {
    out.push({ kind: 'edicion', section: 'almacen', detail: 'Actualizó los datos de productos del almacén' })
  }
}

function diffElaboration(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  if (JSON.stringify(prev.elaboration) === JSON.stringify(next.elaboration)) return
  const p = new Map(prev.elaboration.recipes.map((r) => [r.productKey, r]))
  for (const r of next.elaboration.recipes) {
    if (!p.has(r.productKey)) out.push({ kind: 'edicion', section: 'elaboracion', detail: `Creó la ficha de costo de «${r.productName}»` })
  }
  const n = new Map(next.elaboration.recipes.map((r) => [r.productKey, r]))
  for (const r of prev.elaboration.recipes) {
    const now = n.get(r.productKey)
    if (now && !r.archived && now.archived) out.push({ kind: 'edicion', section: 'elaboracion', detail: `Archivó la ficha de costo de «${r.productName}»` })
    if (now && r.archived && !now.archived) out.push({ kind: 'edicion', section: 'elaboracion', detail: `Restauró la ficha de costo de «${r.productName}»` })
  }
  if (!out.some((e) => e.section === 'elaboracion')) {
    out.push({ kind: 'edicion', section: 'elaboracion', detail: 'Guardó cambios en las fichas de costo de Elaboración' })
  }
}

function diffArchives(prev: StoredData, next: StoredData, out: ActivityDiffEntry[]): void {
  const p = new Set(prev.monthlyArchives.map((a) => a.monthKey))
  for (const a of next.monthlyArchives) {
    if (!p.has(a.monthKey)) out.push({ kind: 'edicion', section: 'archivo', detail: `Archivó el mes ${a.label}` })
  }
}

/** Entradas de actividad que describen el paso de prev a next. */
export function diffActivity(prev: StoredData, next: StoredData): ActivityDiffEntry[] {
  const out: ActivityDiffEntry[] = []
  diffDays(prev, next, out)
  diffReceivables(prev, next, out)
  diffExpenses(prev, next, out)
  diffExtras(prev, next, out)
  diffInventory(prev, next, out)
  diffAdjustments(prev, next, out)
  diffTransfers(prev, next, out)
  diffRh(prev, next, out)
  diffWarehouse(prev, next, out)
  diffElaboration(prev, next, out)
  diffArchives(prev, next, out)
  if (out.length > MAX_ENTRIES) {
    const rest = out.length - (MAX_ENTRIES - 1)
    return [...out.slice(0, MAX_ENTRIES - 1), { kind: 'edicion', section: 'inicio', detail: `…y ${rest} cambios más en la misma tanda de guardado` }]
  }
  return out
}
