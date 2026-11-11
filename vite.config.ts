import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The same headers Vercel sends in production (vercel.json), so `npm run preview`
// proves the app works with "nothing leaves this device" enforced by the browser.
const headers: Record<string, string> = {}
for (const h of JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers[0].headers) {
  headers[h.key] = h.value
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  preview: { headers },
})
