/* Sistema de iconos del SDA original: SVG propio, CERO emoji en la UI.
   Port exacto de ICON_PATHS + Icon de client/src/App.tsx del sistema
   original (viewBox 0 0 24 24, fill none, stroke currentColor,
   strokeWidth 1.8, extremos redondos). Los paths no se redibujan:
   son los del original, carácter a carácter. */

import type { ReactNode } from 'react'

export type IconName =
  | 'dashboard' | 'calendar' | 'receipt' | 'wallet' | 'people' | 'sparkle'
  | 'upload' | 'download' | 'settings' | 'plus' | 'alert' | 'check' | 'edit'
  | 'trash' | 'clock' | 'chart' | 'doc' | 'money' | 'chevronL' | 'chevronR'
  | 'x' | 'package' | 'search' | 'transfer' | 'send' | 'eye' | 'eyeOff'
  | 'archive' | 'more' | 'info' | 'star' | 'phone' | 'message' | 'camera'
  | 'grid' | 'list' | 'flask'
  /* Añadidos del dueño (2026-10-26): voz de Queen y biometría WebAuthn
     de esta copia. No existen en el original; se dibujan en el mismo
     lenguaje de trazo (24×24, stroke 1.8, extremos redondos). */
  | 'mic' | 'volume' | 'volumeOff' | 'fingerprint'

export const ICON_PATHS: Record<IconName, ReactNode> = {
  dashboard: (<><rect x="3.5" y="3.5" width="7" height="9" rx="2" /><rect x="13.5" y="3.5" width="7" height="5" rx="2" /><rect x="13.5" y="11.5" width="7" height="9" rx="2" /><rect x="3.5" y="15.5" width="7" height="5" rx="2" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  receipt: (<><path d="M6 3.5h12V20l-2-1.4L14 20l-2-1.4L10 20l-2-1.4L6 20z" /><path d="M9 8.5h6M9 12h6" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16.5 15h.01" /></>),
  people: (<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9.5" r="2.6" /><path d="M16 15.2c2.3.2 3.9 1.6 4.4 4" /></>),
  sparkle: (<><path d="M12 3.5l1.7 4.8L18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" /><path d="M18.5 16l.8 2.2L21.5 19l-2.2.8L18.5 22l-.8-2.2L15.5 19l2.2-.8z" /></>),
  upload: (<><path d="M12 15V4M7.5 8L12 3.5 16.5 8" /><path d="M4.5 15.5V19a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 19.5 19v-3.5" /></>),
  download: (<><path d="M12 4v11M7 10.5L12 15.5l5-5" /><path d="M4.5 19.5h15" /></>),
  settings: (<><path d="M4.5 7.5h9M17.5 7.5h2M4.5 16.5h3M11.5 16.5h8" /><circle cx="15.5" cy="7.5" r="2.2" /><circle cx="9.5" cy="16.5" r="2.2" /></>),
  plus: (<><path d="M12 5v14M5 12h14" /></>),
  alert: (<><path d="M12 4L2.8 19.5h18.4z" /><path d="M12 10v4M12 17.2h.01" /></>),
  check: (<><path d="M4.5 12.5l5 5L19.5 7" /></>),
  edit: (<><path d="M14.5 5.5l4 4L8 20H4v-4z" /><path d="M12.5 7.5l4 4" /></>),
  trash: (<><path d="M4.5 6.5h15M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-13" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  chart: (<><path d="M4 4v16h16" /><path d="M8.5 16v-5M12.5 16V8M16.5 16v-8" /></>),
  doc: (<><path d="M6 3.5h8L19 8v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6 3.5z" /><path d="M13.5 3.5V8H19" /></>),
  money: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v10M15 9.2c-.6-1-1.7-1.4-3-1.4-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.2 0 1.3-1.3 2.2-3 2.2-1.3 0-2.4-.5-3-1.4" /></>),
  chevronL: (<><path d="M14.5 5.5L8 12l6.5 6.5" /></>),
  chevronR: (<><path d="M9.5 5.5L16 12l-6.5 6.5" /></>),
  x: (<><path d="M6 6l12 12M18 6L6 18" /></>),
  package: (<><path d="M12 3l8 4v10l-8 4-8-4V7z" /><path d="M4 7l8 4 8-4M12 11v10M8 5l8 4" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  transfer: (<><path d="M4 7h13M13.5 3.5L17 7l-3.5 3.5" /><path d="M20 17H7M10.5 13.5L7 17l3.5 3.5" /></>),
  send: (<><path d="M4.5 11.5L19.5 4.5l-3.2 15-4.3-6.3z" /><path d="M12 13.2L4.5 11.5" /></>),
  eye: (<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M4 4l16 16" /><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-3.2 3.4M6.7 7A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.2-.2 3.1-.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  archive: (<><rect x="3.5" y="4" width="17" height="4" rx="1.5" /><path d="M5.5 8v10.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V8M9.5 12.5h5" /></>),
  more: (<><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.8h.01" /></>),
  star: (<><path d="M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.7l-5.2 2.7 1-5.8L3.6 9.5l5.8-.8z" /></>),
  phone: (<><path d="M7.2 3.8l2.3 4.3-2 1.8c1.2 2.6 3.1 4.5 5.7 5.7l1.8-2 4.3 2.3-.8 3.8c-.2.9-1.1 1.5-2 1.4C9.4 20.1 3 13.7 2.1 6.6 2 5.7 2.6 4.8 3.5 4.6z" /></>),
  message: (<><path d="M5.5 4.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H10L5 21v-3.5A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5z" /><path d="M7.5 9h9M7.5 13h6" /></>),
  camera: (<><rect x="3.5" y="6" width="17" height="13.5" rx="3" /><path d="M8 6l1.5-2h5L16 6" /><circle cx="12" cy="12.5" r="3.5" /></>),
  grid: (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>),
  list: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" /></>),
  flask: (<><path d="M10 3.5h4M10.5 3.5v5.2L5.6 18a2 2 0 0 0 1.8 3h9.2a2 2 0 0 0 1.8-3L13.5 8.7V3.5" /><path d="M8 15h8" /></>),
  mic: (<><rect x="9" y="2.8" width="6" height="11" rx="3" /><path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4V21M8.6 21h6.8" /></>),
  volume: (<><path d="M4 9.3v5.4h3.4L12 18.6V5.4L7.4 9.3H4z" /><path d="M15.6 9.6a3.6 3.6 0 0 1 0 4.8M18.2 7a7.4 7.4 0 0 1 0 10" /></>),
  volumeOff: (<><path d="M4 9.3v5.4h3.4L12 18.6V5.4L7.4 9.3H4z" /><path d="M16.2 9.6l4.8 4.8M21 9.6l-4.8 4.8" /></>),
  fingerprint: (<><path d="M6.6 5.9A8.2 8.2 0 0 1 20.2 12c0 2.4-.3 4.7-.9 6.9" /><path d="M3.9 9.9a8.2 8.2 0 0 1 1-3.6" /><path d="M8.6 8.7A5.6 5.6 0 0 1 17.2 12c0 2.7-.3 5.2-1 7.5" /><path d="M11.9 10.4a2.9 2.9 0 0 1 2.9 2.9c0 2.3-.2 4.5-.8 6.5" /><path d="M9.3 12.1c.1 2.8-.2 5.3-1 7.7" /></>),
}

export function Icon({ name, size = 20, className = '', strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  )
}

/** Punto de aviso del original (AlertDot): sustituye a los emoji de estado. */
export function AlertDot({ state }: { state: 'ok' | 'warn' | 'bad' }) {
  return <span className="tab-ambient-dot" data-state={state} aria-hidden="true" />
}
