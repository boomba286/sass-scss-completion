# Changelog

## 0.2.0

- Added completion for the members a module re-exports with `@forward`: `namespace.` and `namespace.$` now include the functions, mixins, and variables of the forwarded files, resolved recursively.
- Added completion for the members loaded with `@use '...' as *`: a bare `$` suggests the variables and a bare name the functions and mixins, with no namespace.
- Added a diagnostic for a call to a function that no module, workspace file, or Sass global defines, for example `casins(1)` in a variable value or a `@return`.
- Added a diagnostic for a CSS property value that the property does not accept, for example `text-transform: uppercases`, `display: flexx`, `color: notacolor`, or `text-transform: casinsss()`. The value is checked against the property's value definition syntax; a value the compiler resolves (a Sass variable, interpolation, or a call of a function something else defines) is left alone.
- Added completion for CSS custom properties (`--name`): inside a `var()` call the names declared anywhere in the workspace are suggested.
- Added a warning for a `var(--name)` use whose `--name` nothing declares. The compiler accepts an unknown name, so it is a warning rather than an error.
- Added completion for the variables in scope at the cursor: a `$` now offers the file's own declarations in order, `@mixin`/`@function` parameters, and `@each`/`@for` loop variables.
- Rewrote the undefined-variable check to follow Sass scoping: a loop variable used outside its loop, an out-of-order declaration, or a variable local to another scope is now reported.

## 0.1.1

- Added a diagnostic for calls that omit a required argument of a `@use`d workspace function or mixin. A parameter counts as required when it has no default value and is not variadic.
- Added a diagnostic for references to a member a `@use`d workspace module does not export: `ns.unknown(...)`, `@include ns.unknown(...)`, and `ns.$unknown`.
- Skipped `@use`d modules that re-export their members with `@forward`, since the index cannot see those members.

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
