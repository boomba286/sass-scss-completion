import * as assert from 'node:assert';
import * as vscode from 'vscode';

const OUR_DETAIL = /@(function|mixin) ·/;
const NAMESPACE_DETAIL = /@use ·/;
const GLOBAL_DETAIL = /\(as \*\)/;
const CUSTOM_PROPERTY_DETAIL = /CSS custom property/;
const SCOPE_VARIABLE_DETAIL = /SCSS variable/;

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
    const labels = await suggestLabelsAt('usage-module.scss', 4, 17, '.');
    assert.ok(labels.includes('scale'), `expected scale, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('flex-center'), `expected flex-center, got [${labels.join(', ')}]`);
  });

  test('lists the members a module re-exports with @forward after a namespace dot', async () => {
    // `users-missing-variables.scss` uses `./forward`, which only re-exports other files.
    const labels = await suggestLabelsAt('users-missing-variables.scss', 3, 31, '.');
    assert.ok(labels.includes('scale'), `expected scale, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('flex-center'), `expected flex-center, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('rem'), `expected rem, got [${labels.join(', ')}]`);
  });

  test('lists the variables a module loads with @use ... as *', async () => {
    const labels = await suggestLabelsAt(
      'users-missing-variables.scss',
      3,
      7,
      '$',
      GLOBAL_DETAIL,
    );
    assert.ok(labels.includes('$colors'), `expected $colors, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('$spacing'), `expected $spacing, got [${labels.join(', ')}]`);
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

  test('reports an unknown CSS property value and accepts keywords, functions, and lengths', async () => {
    const diagnostics = await waitForDiagnostics('usage-missing-properties.scss', 6);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, [
      "Unknown value 'abc' for property 'width'.",
      "Unknown value 'casins()' for property 'text-transform'.",
      "Unknown value 'casinsss()' for property 'text-transform'.",
      "Unknown value 'flexx' for property 'display'.",
      "Unknown value 'notacolor' for property 'color'.",
      "Unknown value 'uppercases' for property 'text-transform'.",
    ]);
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('suggests the custom properties declared in the workspace inside var()', async () => {
    const labels = await suggestLabelsAt(
      'usage-custom-properties.scss',
      8,
      15,
      '-',
      CUSTOM_PROPERTY_DETAIL,
    );

    assert.ok(labels.includes('--main-color'), `expected --main-color, got [${labels.join(', ')}]`);
    assert.ok(
      labels.includes('--basic-padding'),
      `expected --basic-padding, got [${labels.join(', ')}]`,
    );
  });

  test('warns about a var() use of a custom property nothing declares', async () => {
    const diagnostics = await waitForDiagnostics('usage-custom-properties.scss', 1);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, ['Unknown custom property --missing.']);
    assert.ok(
      diagnostics.every(
        (diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning,
      ),
      'expected every diagnostic to be a warning',
    );
  });

  test('suggests the root and loop variables in scope where a `$` is typed', async () => {
    const labels = await suggestLabelsAt(
      'usage-variable-scope.scss',
      12,
      14,
      '$',
      SCOPE_VARIABLE_DETAIL,
    );

    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('$size'), `expected $size, got [${labels.join(', ')}]`);
    assert.ok(!labels.includes('$item'), `did not expect $item, got [${labels.join(', ')}]`);
  });

  test('reports out-of-scope and out-of-order variable uses', async () => {
    const diagnostics = await waitForDiagnostics('usage-variable-scope.scss', 2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, [
      'Used undefined variable $item.',
      'Used undefined variable $later.',
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
