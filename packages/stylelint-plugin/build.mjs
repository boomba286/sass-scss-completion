// Bundles the plugin into a single ES module, the form stylelint 16 loads plugins in.
//
// The analysis engine lives in the repository root (`../../src`) rather than in this package, so it
// is bundled in: the published artifact stays self-contained and can never drift from the engine
// version it was built against. `stylelint` itself stays external, since it is a peer dependency.

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['stylelint'],
  // A dependency of the CSS language service reaches for `fs` through `require`. The ESM output has
  // no `require` of its own, so it is defined here; esbuild's fallback throws when a bundle needs
  // one it cannot resolve statically. The import is aliased so a bundled package that also imports
  // `createRequire` from `node:module` does not collide with this declaration.
  banner: {
    js: "import { createRequire as __sassScssCreateRequire } from 'node:module'; const require = __sassScssCreateRequire(import.meta.url);",
  },
  // `vscode-css-languageservice` ships two builds. The CommonJS one wraps its dependencies in a
  // UMD factory and calls `require` through a parameter, which a bundler cannot follow; the ESM
  // build imports them directly. Pointing at the ESM build lets the package be bundled in, so the
  // published plugin has no runtime dependencies besides stylelint.
  alias: {
    'vscode-css-languageservice': 'vscode-css-languageservice/lib/esm/cssLanguageService.js',
  },
  logLevel: 'info',
});


