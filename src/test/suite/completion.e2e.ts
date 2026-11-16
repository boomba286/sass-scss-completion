import * as assert from 'node:assert';
import * as vscode from 'vscode';

const OUR_DETAIL = /@(function|mixin) ·/;
const NAMESPACE_DETAIL = /@use ·/;

function workspaceUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) throw new Error('no workspace folder opened');
  return folder.uri;
}

function fileUri(name: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceUri(), name);
}

/** Collect only the labels of completion items created by this extension (identified by detail). */
async function suggestLabelsAt(
  name: string,
  line: number,
  character: number,
  trigger = '$',
  detail: RegExp = OUR_DETAIL,
): Promise<string[]> {
  const uri = fileUri(name);
  await vscode.workspace.openTextDocument(uri);

  const result = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >('vscode.executeCompletionItemProvider', uri, new vscode.Position(line, character), trigger);

  const items = Array.isArray(result) ? result : (result?.items ?? []);

  return items
    .filter((item) => typeof item.detail === 'string' && detail.test(item.detail))
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

/** Filter to only the diagnostics created by this extension and wait until at least `minimum` appear. */
async function waitForDiagnostics(
  name: string,
  minimum: number,
): Promise<vscode.Diagnostic[]> {
  const uri = fileUri(name);
  await vscode.workspace.openTextDocument(uri);

  let diagnostics: vscode.Diagnostic[] = [];

  await waitFor(async () => {
    diagnostics = vscode.languages
      .getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === 'sass-scss-completion');

    return diagnostics.length >= minimum;
  });

  return diagnostics;
}

suite('Sass/SCSS parameter completion (E2E)', () => {
  suiteSetup(async () => {
    // Wait for extension activation and completion of workspace signature indexing.
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

  test('suggests a built-in module parameter resolved through @use', async () => {
    const labels = await suggestLabelsAt('usage-builtin.scss', 4, 23);
    assert.ok(labels.includes('$number2'), `expected $number2, got [${labels.join(', ')}]`);
  });

  test('lists built-in module members after a namespace dot', async () => {
    const labels = await suggestLabelsAt('usage-member.scss', 3, 22, '.');
    assert.ok(labels.includes('adjust'), `expected adjust, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('mix'), `expected mix, got [${labels.join(', ')}]`);
  });

  test('lists workspace module members resolved from @use', async () => {
    const labels = await suggestLabelsAt('usage-module.scss', 3, 17, '.');
    assert.ok(labels.includes('scale'), `expected scale, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('flex-center'), `expected flex-center, got [${labels.join(', ')}]`);
  });

  test('suggests a loaded namespace by its prefix', async () => {
    const labels = await suggestLabelsAt('usage-namespace.scss', 4, 11, '$', NAMESPACE_DETAIL);
    assert.ok(labels.includes('color'), `expected color, got [${labels.join(', ')}]`);
  });

  test('reports an error when a required built-in argument is missing', async () => {
    const diagnostics = await waitForDiagnostics('usage-diagnostic.scss', 1);

    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
    assert.ok(
      diagnostics[0].message.includes('$number2'),
      `expected $number2 in "${diagnostics[0].message}"`,
    );
  });

  test('reports an undefined variable as an error', async () => {
    const diagnostics = await waitForDiagnostics('usage-builtin.scss', 1);
    const undefinedIssue = diagnostics.find((diagnostic) => diagnostic.message.includes('$ss'));

    assert.ok(
      undefinedIssue,
      `expected a $ss diagnostic, got [${diagnostics.map((d) => d.message).join(', ')}]`,
    );
    assert.strictEqual(undefinedIssue.severity, vscode.DiagnosticSeverity.Error);
  });

  test('reports members a workspace module does not export', async () => {
    const diagnostics = await waitForDiagnostics('usage-unknown-member.scss', 3);
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    assert.ok(
      messages.includes('Undefined function d.rem2.'),
      `expected the unknown function, got [${messages.join(', ')}]`,
    );
    assert.ok(
      messages.includes('Undefined mixin d.box2.'),
      `expected the unknown mixin, got [${messages.join(', ')}]`,
    );
    assert.ok(
      messages.includes('Undefined variable d.$missing.'),
      `expected the unknown variable, got [${messages.join(', ')}]`,
    );
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('reports a call that omits a required argument of a workspace module', async () => {
    const diagnostics = await waitForDiagnostics('usage-missing-arg.scss', 2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    assert.deepStrictEqual(messages.sort(), [
      'Missing required argument(s) $value in the call to d.rem.',
      'Missing required argument(s) $width in the call to d.box.',
    ]);
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('shows built-in function documentation on hover', async () => {
    const uri = fileUri('usage-builtin.scss');
    await vscode.workspace.openTextDocument(uri);

    let text = '';

    await waitFor(async () => {
      const hovers =
        (await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          new vscode.Position(4, 12),
        )) ?? [];

      text = hovers
        .flatMap((hover) => hover.contents)
        .map((content) => (typeof content === 'string' ? content : content.value))
        .join('\n');

      return text.includes('math.div');
    });

    assert.ok(text.includes('math.div'), `expected math.div docs, got "${text}"`);
  });
});
