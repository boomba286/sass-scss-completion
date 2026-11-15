import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// 로컬에 설치된 VS Code 를 그대로 사용한다(다운로드 방지).
const DEFAULT_VSCODE_EXECUTABLE =
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
  const workspacePath = path.resolve(
    extensionDevelopmentPath,
    'test-fixtures',
    'workspace',
  );

  await runTests({
    vscodeExecutablePath:
      process.env.VSCODE_EXECUTABLE_PATH ?? DEFAULT_VSCODE_EXECUTABLE,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, '--disable-gpu', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
