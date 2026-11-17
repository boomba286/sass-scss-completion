# Contributing

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
