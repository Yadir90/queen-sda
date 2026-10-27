/* Capacidades por rol (decisiones del dueño, 2026-10-26).
 *
 * Capa de acceso multiusuario de ESTA copia: no es paridad con el
 * original (que es monousuario en la práctica), es la política que
 * el dueño fijó para Jesús, Dayami y Yan (rol «lectura»):
 *
 *  - Exportar: el rol lectura puede usar TODAS las exportaciones
 *    del sistema (informes, boletines, nómina, facturas, menú,
 *    presentaciones, Excel de fichas, IPV cuadrado) SIN candado
 *    biométrico. El candado sigue guardando las exportaciones del
 *    ADMINISTRADOR, como hasta ahora.
 *  - Respaldos: quedan SOLO del administrador, con su candado.
 *  - Queen: el rol lectura conversa con Queen igual que el
 *    administrador (preguntar, consultar, análisis — solo texto;
 *    la voz se eliminó el 26-oct, D-R5-02). Ninguna
 *    acción de Queen sobre dinero, cuentas, saldos o ajustes se
 *    abre con esto: esas siguen exigiendo al administrador.
 *  - Modificar (editar, borrar, ajustes): solo el administrador.
 */
import type { Role } from '../types'

/** Exportaciones ordinarias: cualquier sesión iniciada. */
export function canExport(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'lectura'
}

/** Respaldos del sistema: solo el administrador. */
export function canExportBackup(role: Role | null | undefined): boolean {
  return role === 'admin'
}

/** El candado biométrico guarda las exportaciones del administrador;
 *  para el rol lectura las exportaciones van sin candado (dueño,
 *  2026-10-26). */
export function exportNeedsBiometric(role: Role | null | undefined): boolean {
  return role === 'admin'
}

/** Conversar con Queen (solo texto, consultas y análisis):
 *  cualquier sesión iniciada. */
export function canUseQueen(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'lectura'
}

/** Editar, borrar o cambiar ajustes: solo el administrador. */
export function canModify(role: Role | null | undefined): boolean {
  return role === 'admin'
}

/* ===== Acceso por sección (matriz de Yan + regla general) =====
 * Decisiones del dueño, 2026-10-26 14:58 y 15:00:
 *  - REGLA GENERAL: las pestañas reservadas al administrador
 *    (Ajustes, Archivo, Cronología, Días, Historial y Sistema) NO
 *    aparecen a ningún otro usuario —ni en la navegación ni por
 *    acceso directo— sea cual sea su perfil.
 *  - YAN tiene matriz propia por sección (sustituye al rol lectura
 *    genérico): solo lectura en Inicio, Transferencias, Menú,
 *    Documentos, Almacén, Entradas y RH; Queen solo el chat;
 *    lectura y escritura en Gastos/Economía, Inventario,
 *    Laboratorio, Otros ingresos (= Extras), Existencias,
 *    Productos, Elaboración, Cobrar e Importar; sin acceso a las
 *    seis pestañas de administrador. (D-R5-03: Menú e Importar son
 *    secciones propias desde el 26-oct; antes Menú caía en
 *    Documentos e Importar en Sistema.)
 *  - Jesús y Dayami: lectura general en el resto, como antes.
 * La imposición en el servidor (RLS) queda para el despliegue: esta
 * matriz es de interfaz, como el resto de roles de la copia. */
import type { Section, Session } from '../types'

export type SectionAccess = 'none' | 'read' | 'write' | 'chat'

export const ADMIN_ONLY_SECTIONS: Section[] = ['ajustes', 'archivo', 'cronologia', 'dias', 'historial', 'sistema']

const YAN_MATRIX: Partial<Record<Section, SectionAccess>> = {
  inicio: 'read',
  transferencias: 'read',
  documentos: 'read',
  menu: 'read',
  almacen: 'read',
  entradas: 'read',
  rh: 'read',
  queen: 'chat',
  economia: 'write',
  inventario: 'write',
  laboratorio: 'write',
  extras: 'write',
  existencias: 'write',
  productos: 'write',
  elaboracion: 'write',
  cobrar: 'write',
  cuentas: 'write',
  importar: 'write',
  ajustes: 'none',
  archivo: 'none',
  cronologia: 'none',
  dias: 'none',
  historial: 'none',
  sistema: 'none',
}

export function sectionAccess(session: Session | null | undefined, section: Section): SectionAccess {
  if (!session) return 'none'
  /* «Más» es el contenedor de navegación móvil, no una sección con
     datos: siempre visible; lo que se filtra es su contenido. */
  if (section === 'mas') return session.role === 'admin' ? 'write' : 'read'
  if (session.role === 'admin') return 'write'
  if (ADMIN_ONLY_SECTIONS.includes(section)) return 'none'
  if (session.profileId === 'yan') return YAN_MATRIX[section] ?? 'none'
  return 'read'
}

/** ¿Puede esta sesión modificar datos dentro de esta sección? */
export function canModifyIn(session: Session | null | undefined, section: Section): boolean {
  const a = sectionAccess(session, section)
  return a === 'write'
}
