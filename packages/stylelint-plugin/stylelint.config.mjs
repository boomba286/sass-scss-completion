// Lints this package's `example/` folder with the plugin's own rules, so the command-line behaviour
// can be checked without installing anything. Run it with `npm run verify:example`.
//
// The plugin is referenced by package name, which Node resolves to this package's own `exports`
// entry (the built `dist/index.mjs`), the same way a consumer would reference it after installing
// from npm. Build first, as `verify:example` does.

export default {
  plugins: ['@boomba286/stylelint-plugin-sass-scss'],
  customSyntax: 'postcss-scss',
  rules: {
    'sass-scss/property-value-no-unknown': true,
    'sass-scss/no-undefined-custom-property': true,
    'sass-scss/no-undefined-function': true,
    'sass-scss/no-undefined-variable': true,
    'sass-scss/missing-required-arguments': true,
  },
};
