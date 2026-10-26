import type { StoredData } from '../types'
import Cobrar from './Cobrar'

/* En el original no existe una pantalla «Cuentas» separada: las cuentas
   viven dentro de Cobrar (vistas Cuentas · Clientes · Comprobantes ·
   Entidades). La entrada «Cuentas» de la navegación abre ese mismo
   Cobrar integrado, directamente en la vista de Clientes — la que
   agrupa por contacto mostrando solo el total que debe hoy. */
export default function Cuentas({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  return <Cobrar data={data} isAdmin={isAdmin} onChanged={onChanged} initialView="clientes" />
}
