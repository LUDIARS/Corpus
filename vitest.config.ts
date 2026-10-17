import { defineConfig } from 'vitest/config';

// renderer test は per-file `// @vitest-environment jsdom` pragma で
// jsdom に切り替える (デフォルトは node、 server 系の負荷を避けるため).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Review workers may inherit NODE_ENV=production; React act needs the test build.
    env: { NODE_ENV: 'test' },
    environment: 'node',
    include: ['server/**/*.test.ts', 'public/src/**/*.test.ts'],
  },
});
