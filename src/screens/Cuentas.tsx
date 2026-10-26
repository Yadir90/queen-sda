import type { StoredData } from '../types'
import Cobrar from './Cobrar'

/* En el original no existe una pantalla «Cuentas» separada: las cuentas
   viven dentro de Cobrar (vistas Cuentas · Clientes · Comprobantes ·
   Entidades). La entrada «Cuentas» de la navegación abre ese mismo
   Cobrar integrado, directamente en la vista de Clientes — la que
   agrupa por contacto mostrando solo el total que debe hoy.
   NOTA PARA EL COORDINADOR (App.tsx no es de esta área): App.tsx enlaza
   «cuentas» como entrada aparte en la barra lateral (SIDE_MAS). Según el
   original no debería existir como pestaña independiente; si se quiere
   el espejo exacto, ese enlace debe salir de la navegación o apuntar a
   Cobrar. Esta pantalla se mantiene solo como destino compatible de
   esa ruta mientras el coordinador lo ajusta: no añade navegación
   nueva ni contenido propio. */
export default function Cuentas({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  return <Cobrar data={data} isAdmin={isAdmin} onChanged={onChanged} initialView="clientes" />
}
