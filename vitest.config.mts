import { defineConfig } from 'vitest/config';

// The stylelint plugin under `packages/` is a standalone package: it ships its own dependencies and
// its own Vitest configuration for the `~` alias, and is tested from its own folder. Scope the root
// run to this package so it neither loads the plugin's tests nor needs the plugin's dependencies.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
