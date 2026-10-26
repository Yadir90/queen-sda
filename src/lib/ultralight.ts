/* Modo ultraligero GLOBAL (ronda 26-oct, comparación del dueño):
   en el original vive en la pantalla de acceso y «se aplica a
   todo el sistema y queda activo» — un ajuste del sistema, no de
   una pestaña. Aquí se guarda en la misma clave que ya usaba el
   interruptor de Sistema y se aplica al <html> (data-ultralight)
   desde el arranque, para que valga en todas las pestañas y
   entre sesiones. */
const KEY = 'queen-sda:sistema-ultra:v1'

export function getUltralight(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function applyUltralight(): void {
  document.documentElement.dataset.ultralight = getUltralight() ? 'true' : 'false'
}

export function setUltralight(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* sin almacenamiento: solo esta sesión */ }
  document.documentElement.dataset.ultralight = on ? 'true' : 'false'
}
