import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * Tests resolve the whale's type-only @deepseek-ai imports and the cordis
 * context through the DSH snapshot's TypeScript sources (tsconfig.vitest.json
 * paths → ../.dsh/source/current); runtime faces are stubbed inside the
 * specs, so no snapshot package is loaded at runtime. React resolves from
 * this repo's own install.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.vitest.json'] })],
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environmentOptions: {
      jsdom: {
        // A real origin is required for window.localStorage to exist.
        url: 'http://localhost:3000/',
        storageQuota: 10000000,
      },
    },
  },
})
