import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

/* TODAS las animaciones se pausan con la app en segundo plano, como en
   el original (html[data-queen-motion="paused"] en su theme.css): la
   marca va en el <html> y la regla CSS congela cualquier animación.
   Puerto completo del mecanismo del original (D-60): escucha
   visibilitychange Y pagehide/pageshow, y al volver la marca es
   "running" (la suya), no "active". */
const syncMotionWithVisibility = () => {
  document.documentElement.dataset.queenMotion = document.hidden ? 'paused' : 'running'
}
document.addEventListener('visibilitychange', syncMotionWithVisibility)
window.addEventListener('pagehide', () => { document.documentElement.dataset.queenMotion = 'paused' })
window.addEventListener('pageshow', syncMotionWithVisibility)
syncMotionWithVisibility()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker SOLO en producción: cachea únicamente la carcasa estática.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sin service worker la app sigue funcionando en línea */
    })
  })
}
