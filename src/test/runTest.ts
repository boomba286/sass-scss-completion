import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// Prefer a locally installed VS Code (to avoid downloading); otherwise download a stable build.
const DEFAULT_VSCODE_EXECUTABLE =
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

/** Resolves the VS Code executable to use, or undefined to let the runner download one. */
function resolveExecutable(): string | undefined {
  const fromEnv = process.env.VSCODE_EXECUTABLE_PATH;

  if (fromEnv) return fromEnv;
  if (fs.existsSync(DEFAULT_VSCODE_EXECUTABLE)) return DEFAULT_VSCODE_EXECUTABLE;

  return undefined;
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
  const workspacePath = path.resolve(
    extensionDevelopmentPath,
    'test-fixtures',
    'workspace',
  );

  await runTests({
    vscodeExecutablePath: resolveExecutable(),
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, '--disable-gpu', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
