import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run Foundry's own unit/integration tests. blueprints/** is template
    // payload and is never executed by Vitest.
    include: ['packages/**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'blueprints/**', '**/dist/**'],
    environment: 'node',
  },
});
