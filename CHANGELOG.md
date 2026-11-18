# Changelog

## 0.4.1

- Variables, mixins, and functions brought in by `@import` are now resolved the same way as `@use '...' as *`, so a variable a legacy stylesheet imports at the top of the file is no longer reported as undefined.
- Diagnostics are re-run after workspace indexing finishes. Previously a file that was already open when the extension started could show an undefined-variable error that the completed index resolves.
- A custom property name built with interpolation in a loop is now indexed. A loop over a map (`@each $name, $value in $sizes`) or a flat list (`@each $state in $states`) in the same file contributes its exact names, so `var(--font-size-xl)` is accepted when the file publishes `--font-size-#{$name}`.
- When the loop walks a list declared in another module, only the fixed part of the name can be read from the publishing file. That part is recorded as a family, so `var(--font-size-xl)` is accepted while a name outside the family, such as `var(--font-siz-xl)`, is still reported. The family itself is never offered as a completion.
- The `@boomba286/stylelint-plugin-sass-scss` package reuses the same engine, so the `@import` and custom-property fixes apply to it as well.

## 0.4.0

- Narrowed template completion to **HTML** and **Vue**. `Svelte` and `Astro` are dropped: the extension no longer registers its completion provider for `.svelte` and `.astro` files, and no longer lists them among the supported languages. The Sass and SCSS features are unaffected.

## 0.3.1

- Added the `sass-scss-completion.rules` setting, which sets the severity of each diagnostic. Set a rule to `off` to silence it, to `warn` to report it as a warning, or to `error` to report it as an error. A rule left out keeps its default, so an existing project sees no change: `error` for every check except `no-undefined-custom-property`, which stays `warn`.
- A rule name matches the rules of the `@boomba286/stylelint-plugin-sass-scss` package, and a name no rule has or a value outside the three is ignored, so a typo in `settings.json` leaves the rule at its default rather than silencing it.
- Renamed the extension to **Sass/SCSS IntelliSense & HTML Class Names**, so the name states the whole range it covers: Sass and SCSS signatures, and the class, id, and attribute names it completes in a template.

## 0.3.0

- Added completion for the class names, ids, and attribute selectors a workspace stylesheet defines, inside the `class`, `id`, and other attributes of an HTML, Vue, Svelte, or Astro template.
- The selectors are read from `.scss`, `.sass`, and plain `.css` files, so a stylesheet written in CSS contributes its class, id, and attribute names — and its `--custom` properties — to the templates it is grouped with. A `.css` file is not indexed for Sass signatures and takes no part in `@use` resolution, so it adds no diagnostics of its own.
- The names are read from the selectors themselves, so BEM (`&__element`) and `#{$name}` interpolation over a literal list (`$name: a, b`, or the items of an `@each`) are covered.
- Added the `sass-scss-completion.groups` setting, which pairs stylesheet globs with the template globs they apply to, so a stylesheet completes only in the templates its group targets.
- A template suggestion shows the `label` of the group its stylesheet belongs to next to it — or its source path when the group has no label — and the comment written above the selector in the documentation panel.

## 0.2.1

- Fixed `namespace.` completion to include the module's variables, so `namespace.` now lists variables together with the functions and mixins. Previously a variable was offered only after `namespace.$`.

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
