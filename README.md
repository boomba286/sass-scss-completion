# Sass/SCSS Parameter Completion

[![CI](https://img.shields.io/github/actions/workflow/status/boomba286/sass-scss-completion/ci.yml?label=CI)](https://github.com/boomba286/sass-scss-completion/actions/workflows/ci.yml)
[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-%5E1.75.0-007ACC)](https://code.visualstudio.com/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dart Sass](https://img.shields.io/badge/Dart%20Sass-%E2%89%A51.79-CF649A?logo=sass&logoColor=white)](https://sass-lang.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/boomba286/sass-scss-completion/blob/main/LICENSE)

🚀 Autocomplete parameter names for Sass functions and mixins in the `.scss` and `.sass` files of any project — React, Angular, Vue, or plain HTML.

✨ Parameters you have already passed by name are never suggested twice, and preceding positional arguments are taken into account. Built-in Sass modules (`sass:math`, `sass:color`, …) are supported out of the box, and so are the functions, mixins, and variables you `@use` from your own files.

```scss
@function rem($value, $base: 16) {
  @return math.div($value, $base) * 1rem;
}

.card {
  /* 💡 typing `$` after the positional argument suggests `$base` */
  width: rem(12, $);
}
```

## ✨ Features

### 🧵 Your own functions, mixins, and variables

- ✅ Suggests parameter names when you type `$`, a comma, or just after an opening parenthesis.
- ✅ Works for the `@function` and `@mixin` definitions in your project, called by bare name or through a `@use`d module.
- ✅ After a `@use`d module's `namespace.` completes its functions and mixins, and after `namespace.$` completes its variables, resolved from the file the `@use` points at.
- ✅ Skips named parameters already used in the current call and accounts for preceding positional arguments.
- ✅ Indexes `@function`, `@mixin`, and `$variable` declarations from the SCSS and Sass files in the workspace.

### 🎨 Built-in Sass modules

- ✅ Recognizes namespaces loaded with `@use 'sass:<module>'` (including `as <alias>`).
- ✅ Completes parameters for built-in functions and mixins, marking each as **required**, **optional (with default)**, or **rest**.
- ✅ Completes built-in module members after `namespace.` and built-in variables after `namespace.$` (for example `math.$pi`).
- ✅ Works for all seven built-in modules (`math`, `string`, `color`, `list`, `map`, `selector`, and `meta`).

### 🔗 Namespace and `@use` completion

- ✅ In `@use 'sass:…` completes built-in module ids together with a short description.
- ✅ Completes the names of namespaces already loaded with `@use`.

### 💬 Hover documentation

- ✅ Hovering a built-in function or mixin shows its signature, per-parameter descriptions (required/optional/default), a usage example, and a link to the official documentation.
- ✅ Hovering a built-in variable shows its description and documentation link.
- ✅ Hovering a workspace module member shows its signature.

### 🚨 Diagnostics

- ✅ Underlines built-in module calls that are missing required arguments.
- ✅ Underlines workspace module calls (`ns.fn(...)`, `@include ns.mixin(...)`) that omit a parameter without a default value.
- ✅ Underlines uses of undefined `$variables`.
- ✅ Underlines references to a member a `@use`d module does not export: `ns.unknown(...)`, `@include ns.unknown(...)`, and `ns.$unknown`.

## 🌐 Supported Languages

| Language      | Extensions | Completion | Hover | Diagnostics |
| ------------- | ---------- | :--------: | :---: | :---------: |
| SCSS          | `.scss`    |     ✅     |  ✅   |     ✅      |
| Indented Sass | `.sass`    |     ✅     |  ✅   |     ✅      |
| Vue           | `.vue`     |     ✅     |  ✅   |     ➖      |

## 🧩 Framework Support

The extension works on the `.scss` and `.sass` files in a project, independent of the framework. Any framework that keeps its styles in real Sass files is covered.

| Framework            | How Sass is used                                                                 | Support                                          |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| React / Next.js      | `import styles from './Button.module.scss'` (CSS Modules), or global `.scss`      | ✅ completes inside the `.scss` files            |
| Angular              | `styleUrls: ['./button.component.scss']`, or standalone component style files     | ✅ completes inside component `.scss` files      |
| Vue                  | `<style lang="scss">` in an SFC, or standalone `.scss` files                       | ✅ completes inside `.vue` and `.scss` files     |
| Plain HTML / others  | Standalone `.scss` / `.sass` files                                                 | ✅ completes inside `.scss` and `.sass` files    |

❌ Styles that are not backed by a Sass document are **not** covered, because there is no SCSS text to complete in:

- CSS-in-JS template literals (for example `styled-components` or `emotion`).
- Angular inline `styles: ['...']` string literals.

## ⚙️ Configuration

| Setting                      | Type       | Default | Description                                                                                                                                                                                          |
| ---------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sass-scss-completion.exclude` | `string[]` | `[]`    | Additional glob patterns excluded from workspace indexing, on top of the built-in list (dependency, build output, and cache directories). Each entry must be a single pattern, for example `vendor-legacy` or `**/generated/**`. |

Example:

```json
{
  "sass-scss-completion.exclude": ["vendor-legacy", "**/generated/**"]
}
```

The workspace index is rebuilt automatically when files change and whenever this setting changes.

## 📖 Usage

💡 = where to type for suggestions · ❌ = an error is shown · ✅ = no error

### 1. 🧵 Parameters of your own functions and mixins

Define a function or mixin anywhere in the workspace, then call it — by bare name after `@use`, or through the module namespace. Typing `$` (or a comma) suggests the parameters that are still unfilled.

```scss
/* _definitions.scss */
@function rem($value, $base: 16) {
  @return $value;
}

@mixin box($width, $height: 10) {
  width: $width;
  height: $height;
}

/* usage.scss */
@use 'definitions';

.usage {
  /* 💡 typing `$` suggests `$base` (the positional `12` fills `$value`) */
  width: rem(12, $);
}

.card {
  /* 💡 typing `$` suggests `$height` (the positional `100px` fills `$width`) */
  @include definitions.box(100px, $);
}
```

A parameter already passed by name is not suggested again.

```scss
.card {
  /* 💡 `$height` is already used, so only `$width` remains */
  @include definitions.box($height: 10px, $);
}
```

### 2. 📦 Members and variables of an imported module

After a `@use`d module's namespace, its functions and mixins are suggested; after `namespace.$`, its variables are suggested.

```scss
/* _tokens.scss */
$spacing: 8px;

@function scale($factor, $base: 16) {
  @return $factor * $base;
}

@mixin flex-center($gap: 0) {
  display: flex;
  gap: $gap;
}

/* usage.scss */
@use 'tokens';

.grid {
  /* 💡 after `tokens.` suggests `scale` and `flex-center` */
  padding: tokens.scale(2, 8px);
}

.grid {
  /* 💡 after `tokens.$` suggests `$spacing` */
  margin: tokens.$spacing;
}
```

### 3. 🎨 Built-in Sass modules

The built-in modules are treated the same way as your own files: parameters, members, and variables are all completed.

```scss
@use 'sass:color';
@use 'sass:math';

.button {
  /* 💡 typing `$` here suggests the remaining channel parameters */
  color: color.adjust(#036, $lightness: 20%);
}

.grid {
  /* 💡 after `math.` suggests `div`, `ceil`, `floor`, `percentage`, … */
  width: math.div(10px, 2);
}

.circle {
  /* 💡 after `math.$` suggests `$e`, `$pi`, `$max-number`, … */
  circumference: 2 * math.$pi;
}
```

The modules covered are `math`, `string`, `color`, `list`, `map`, `selector`, and `meta`. Hovering a member shows its signature, per-parameter descriptions (required/optional/default), an example, and a link to the official documentation.

### 4. 🔗 Module paths and loaded namespaces

Inside the quotes of `@use`, the built-in module ids are completed together with a short description. Namespaces already loaded with `@use` are completed by prefix.

```scss
/* 💡 typing inside the quotes suggests built-in modules with descriptions */
@use 'sass:ma';

@use 'sass:color';
@use 'tokens' as t;

.alert {
  /* 💡 typing `co` suggests the `color` namespace */
  color: co;
}
```

### 5. 🚨 Diagnostics

Common mistakes are underlined as errors while you type, before anything reaches the compiler.

```scss
@use 'sass:math';
@use 'definitions' as d;

.a {
  /* ❌ Missing required argument(s) $number2 in the call to math.div. */
  width: math.div(12);
}

.b {
  /* ❌ Missing required argument(s) $value in the call to d.rem. */
  width: d.rem();
}

.c {
  /* ❌ Undefined function d.rem2. */
  width: d.rem2(12);
}

.d {
  /* ❌ Undefined variable d.$missing. */
  margin: d.$missing;
}

.e {
  /* ❌ Used undefined variable $undefined. */
  padding: $undefined;
}
```

A parameter counts as required when it has no default value and is not variadic, so omitting a defaulted one is not an error:

```scss
.card {
  /* ✅ `$base` defaults to 16 */
  width: d.rem(12);
}

.badge {
  /* ✅ the required `$value` is passed by name */
  width: d.rem($value: 12);
}
```

## 📦 Installation

**From the Marketplace:** search for **Sass/SCSS Parameter Completion** and install it.

**From a VSIX package:** package the extension and install it through **Install from VSIX** in the Extensions view:

```sh
npx @vscode/vsce package
```

## 🛠️ Development

Requirements: Node.js 20 or later and VS Code 1.75 or later (or a compatible editor such as Trae).

```sh
npm install
npm run build
```

Press `F5` to launch the Extension Development Host, then open an SCSS or Sass file in that host and try a function or mixin call.

### ✅ Tests

Core logic (Vitest):

```sh
npm test
```

End-to-end against a real VS Code host:

```sh
npm run test:e2e
```

The E2E run uses a locally installed VS Code by default. Set `VSCODE_EXECUTABLE_PATH` to point at a different executable. On a headless machine, download a VS Code build by unsetting that variable, or run it under a virtual display such as `xvfb-run -a`.

## ⚠️ Known Limitations

- Workspace functions and mixins are indexed by name across the workspace; module visibility is not fully resolved.
- If multiple definitions share a name, the first definition found is used.
- Only definitions in `.scss` and `.sass` files are indexed.
- Workspace variables are completed through `namespace.$`; a bare `$variable` name outside a call is not completed.
- Missing-required-argument diagnostics apply to built-in module calls and to `@use`d workspace modules that the extension can resolve; a parameter counts as required when it has no default value and is not variadic.
- The unknown-member check applies to `@use`d modules that the extension can resolve in the workspace; a module that re-exports members with `@forward` is skipped.

## 📄 License

MIT. See [LICENSE](https://github.com/boomba286/sass-scss-completion/blob/main/LICENSE).
