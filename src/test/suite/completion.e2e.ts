import * as assert from 'node:assert';
import * as vscode from 'vscode';

const OUR_DETAIL = /@(function|mixin) ·/;

function workspaceUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) throw new Error('no workspace folder opened');
  return folder.uri;
}

function fileUri(name: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceUri(), name);
}

/** 이 확장이 만든 완료 항목의 label 만 뽑는다(detail 로 식별). */
async function suggestLabelsAt(
  name: string,
  line: number,
  character: number,
): Promise<string[]> {
  const uri = fileUri(name);
  await vscode.workspace.openTextDocument(uri);

  const result = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >('vscode.executeCompletionItemProvider', uri, new vscode.Position(line, character), '$');

  const items = Array.isArray(result) ? result : (result?.items ?? []);

  return items
    .filter((item) => typeof item.detail === 'string' && OUR_DETAIL.test(item.detail))
    .map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeout = 20000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('timed out waiting for the completion index');
}

suite('Sass/SCSS parameter completion (E2E)', () => {
  suiteSetup(async () => {
    // 확장 활성화 + 워크스페이스 시그니처 인덱싱 완료를 기다린다.
    await waitFor(async () => (await suggestLabelsAt('usage.scss', 1, 18)).includes('$base'));
  });

  test('suggests $base after a positional argument in SCSS', async () => {
    const labels = await suggestLabelsAt('usage.scss', 1, 18);
    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
  });

  test('does not re-suggest a named parameter already used', async () => {
    const labels = await suggestLabelsAt('usage-dup.scss', 1, 29);
    assert.ok(!labels.includes('$base'), `did not expect $base, got [${labels.join(', ')}]`);
  });

  test('suggests $height for a mixin after a positional argument', async () => {
    const labels = await suggestLabelsAt('usage-mixin.scss', 1, 20);
    assert.ok(labels.includes('$height'), `expected $height, got [${labels.join(', ')}]`);
  });

  test('works in indented Sass syntax', async () => {
    const labels = await suggestLabelsAt('usage.sass', 1, 18);
    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
  });
});
