import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['test/view/**', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**', 'media/**'],
      exclude: ['src/extension.ts', '**/*.d.ts'],
    },
  },
});
