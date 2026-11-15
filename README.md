# Sass/SCSS Parameter Completion

Autocomplete Sass function and mixin parameter names while editing `.scss`, `.sass`, and Vue files.

For example, given this function:

```scss
@function rem($value, $base: 16) {
  @return math.div($value, $base) * 1rem;
}
```

Typing `rem(12, $` offers `$base`. Parameters already supplied by name are omitted, so `$base` is not suggested again after `rem(12, $base: 10, $`.

## Features

- Reads `@function` and `@mixin` signatures from SCSS and Sass files in the current workspace.
- Suggests parameter names when typing `$`, after a comma, or just after an opening parenthesis.
- Avoids suggesting named parameters already used in the current call.
- Accounts for preceding positional arguments.
- Works in SCSS, indented Sass, and Vue files.

## Development

Requirements: Node.js and VS Code (or a compatible editor such as Trae).

Install dependencies and build the extension:

```sh
npm install
npm run build
```

Press `F5` to launch the Extension Development Host, then open an SCSS or Sass file in that host and try a function or mixin call.

### Tests

Core logic (Vitest):

```sh
npm test
```

End-to-end against a real VS Code host:

```sh
npm run test:e2e
```

The E2E run uses a locally installed VS Code by default. Set `VSCODE_EXECUTABLE_PATH` to point at a different executable.

## Install From VSIX

Package the extension with the VS Code Extension Manager CLI:

```sh
npx @vscode/vsce package
```

Then install the generated `.vsix` file from the editor's Extensions view using **Install from VSIX**.

## Current Limitations

- Function and mixin definitions are indexed by name across the workspace; module namespaces and Sass module visibility are not resolved.
- If multiple definitions share a name, the first definition found is used.
- Only definitions in `.scss` and `.sass` files are indexed.

## License

MIT. See [LICENSE](LICENSE).
