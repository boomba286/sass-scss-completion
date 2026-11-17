// Vitest resolves imports with Vite, which — unlike the TypeScript compiler and esbuild — does not
// read the `paths` mapping in tsconfig.json. The plugin reaches the analysis engine at the
// repository root through the `~` alias, so the same target is declared here.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
});
