import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Queen SDA — configuración mínima y ligera (pensada para un Galaxy A16).
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
