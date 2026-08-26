import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Demo fixtures must never leak into production code paths; the quarantine
    // test scans src/ imports, so it runs in the normal pool.
    pool: 'threads',
  },
})
