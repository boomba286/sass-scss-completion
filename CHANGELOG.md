# Changelog

## 0.1.0

- Rewrote the extension in TypeScript.
- Added parameter-name completion for Sass built-in modules (`@use 'sass:math'` and the other six modules).
- Added completion for module members (`namespace.` → functions, mixins, variables) and for `@use` paths.
- Added namespace completion from loaded `@use` statements.
- Added hover documentation for built-in functions, variables, and workspace definitions.
- Added diagnostics for missing required arguments and undefined variables.
- Added support for `.sass` (indented syntax) and `.vue` files.
- Added the `sass-scss-completion.exclude` setting to skip extra directories while indexing.

## 0.0.1

- Initial local release.
- Added parameter-name completion for Sass functions and mixins.
- Avoided suggesting named parameters already used in a call.
