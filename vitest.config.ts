import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'packages/contracts/**', 'packages/cre/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
