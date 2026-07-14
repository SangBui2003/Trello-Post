import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // CRITICAL for Electron: Cường ép Vite dùng relative paths ở dist thay vì root absolute
})
