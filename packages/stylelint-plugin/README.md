# @boomba286/stylelint-plugin-sass-scss

Stylelint rules that reuse the analysis engine behind the
[Sass/SCSS IntelliSense & HTML Class Names](https://marketplace.visualstudio.com/items?itemName=boomba286.sass-scss-completion)
VS Code extension.

The extension reports its problems in the editor. These rules expose the same engine to the command
line — `npx stylelint "**/*.scss"`, a JSON report, or a CI step — so the checks run on files that are
not open in an editor, and on a machine with no editor at all.

## Install

```sh
npm install --save-dev @boomba286/stylelint-plugin-sass-scss stylelint postcss-scss
```

The engine parses SCSS with the CSS language service, so it understands SCSS syntax only. Indented
`.sass` is out of scope, matching the extension, which also restricts its value checks to SCSS.

## Usage

```js
// stylelint.config.js
export default {
  plugins: ['@boomba286/stylelint-plugin-sass-scss'],
  overrides: [
    {
      files: ['**/*.scss'],
      customSyntax: 'postcss-scss',
      rules: {
        'sass-scss/property-value-no-unknown': true,
        'sass-scss/no-undefined-custom-property': true,
        'sass-scss/no-undefined-function': true,
        'sass-scss/no-undefined-variable': true,
        'sass-scss/missing-required-arguments': true,
      },
    },
  ],
};
```

## Rules

### `sass-scss/property-value-no-unknown`

Reports a declaration whose value the property does not accept (`display: flexx`). Values the
compiler resolves — a Sass variable, interpolation, a call to a function the project declares — are
left alone.

The core rule `declaration-property-value-no-unknown` covers similar ground with `css-tree`. Unlike
it, this rule judges values against the CSS data shipped with `vscode-css-languageservice` and
treats a function the project declares as a valid value, so `color: theme(primary)` is not reported
when `theme` is a project function. **Enable only one of the two**, or a single typo is reported
twice.

### `sass-scss/no-undefined-custom-property`

Warns about a `var(--name)` whose name nothing declares. The compiler accepts an unknown name, so
this is a warning rather than an error. A name built with interpolation (`var(--a#{$x})`) is left
alone.

Declarations in the linted file count. To accept names a project declares in other files, list
those files in the rule's `referenceFiles` secondary option, as glob patterns:

```js
'sass-scss/no-undefined-custom-property': [
  true,
  { referenceFiles: ['src/styles/tokens/**/*.scss'] },
],
```

### `sass-scss/no-undefined-function`

Reports a call to a function nothing defines, in the SassScript parts of the document (variable
values, `@return`, conditions). The Sass global functions, the plain CSS functions Sass passes
through, and the functions the document declares are accepted. Property values are covered by
`sass-scss/property-value-no-unknown`, so they are excluded here. A mixin call into a module that
does not export it is reported by the same rule.

### `sass-scss/no-undefined-variable`

Reports a `$name` use that nothing declares, taking the Sass scopes into account: a variable
declared later in the same scope, or a loop variable used outside its loop, is reported; a root
declaration is visible anywhere inside a mixin or function body.

### `sass-scss/missing-required-arguments`

Reports a call that omits a required argument, into a built-in module (`sass:math`, `sass:map`, …)
or into a user-defined one. Only calls whose namespace is declared with `@use` are considered, and
a call with an unclosed parenthesis (still being typed) is skipped.

## Cross-file resolution

A rule resolves the `@use` statements of the document it lints against the file system, so members
reached through a user-defined module are judged too:

```scss
// _definitions.scss
@function rem($value, $base: 16) {
  @return $value;
}

// page.scss
@use 'definitions' as d;

.page {
  width: d.rem();
  //    ^ sass-scss/missing-required-arguments: Missing required argument(s) $value in the call to d.rem.
}
```

Members a module re-exports with `@forward` are followed, and `@use '...' as *` brings a module's
variables and functions into scope, so a call to them is not reported as unknown. Only a document
with a file name — a path on the command line, or `codeFilename` — can resolve its `@use`
statements; a snippet with no file name is judged on its own.

## Not covered yet

- A document with a syntax error (an unfinished declaration, say) does not parse under
  `postcss-scss`, so the rules report nothing for it and stylelint raises the parse error instead.
  The editor's parser is fault-tolerant and still reports on a file as it is being typed.

## License

MIT
